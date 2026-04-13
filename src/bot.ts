import dotenv from "dotenv";
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { WATCHED_POOLS } from "./dex/raydiumRealtime";
import { decide, updateLastTradeTime } from "./engine/decision";
import { executeTrade, TradeResult } from "./executor/executor";
import {
  sendSignal,
  init,
  sendNotification,
  isBotRunning,
  setBotRunning,
  dynamicConfig,
} from "./telegram/telegram";
import { connection } from "./rpc";
import { pnlTracker } from "./engine/pnl";
import { shouldStopTrading } from "./engine/risk";
import { failsafe } from "./engine/failsafe";
import {
  scanAllPoolsParallel,
  detectArbFromScan,
  simulateMultiDexPrices,
} from "./scanner/multiPairScanner";
import { CONFIG, TOKENS } from "./config";
import { MultiHopEngine } from "./engine/multiHopEngine";
import { SmartFilter } from "./engine/smartFilter";
import { initBalanceManager, balanceManager } from "./engine/balanceManager";

dotenv.config();

// Initialize wallet
function initWallet(): Keypair {
  const privateKeyString = process.env.PRIVATE_KEY!;
  const secretKey = bs58.decode(privateKeyString);
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

// Minimal logging
let lastLogTime = 0;
function logIfDue(message: string): void {
  const now = Date.now();
  if (now - lastLogTime >= CONFIG.MIN_LOG_INTERVAL_MS) {
    console.log(message);
    lastLogTime = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// MULTI-PAIR PARALLEL SCANNER WITH PER-PAIR COOLDOWN
// ============================================================

interface PairCooldown {
  lastTradeTime: number;
  consecutiveErrors: number;
}

const pairCooldowns: Map<string, PairCooldown> = new Map();

interface TradingPair {
  name: string;
  input: string;
  output: string;
  minVolume: number;
  enabled: boolean;
}

async function scanPair(
  pair: TradingPair,
  wallet: Keypair,
  connection: Connection,
  cooldown: PairCooldown,
): Promise<void> {
  const now = Date.now();

  // Check per-pair cooldown
  if (now - cooldown.lastTradeTime < dynamicConfig.cooldownMs) {
    return;
  }

  // Skip if pair has too many errors
  if (cooldown.consecutiveErrors > CONFIG.MAX_CONSECUTIVE_ERRORS) {
    logIfDue(`⚠️ ${pair.name} paused due to errors`);
    return;
  }

  const amount = dynamicConfig.tradeSizeSol * LAMPORTS_PER_SOL;

  // Get best route from multi-aggregator router
  const { getBestRoute } = await import("./executor/router");

  const bestRoute = await getBestRoute(
    new PublicKey(pair.input),
    new PublicKey(pair.output),
    amount,
    dynamicConfig.slippageBps,
  );

  if (!bestRoute) {
    cooldown.consecutiveErrors++;
    return;
  }

  // SMART FILTER - Strategy layer
  const filterResult = SmartFilter.apply(bestRoute.route);
  if (!filterResult.passed) {
    return; // Silently skip
  }

  // Check if profitable enough
  if (bestRoute.profitPercent < dynamicConfig.manualThreshold) {
    return;
  }

  // Create arb opportunity
  const arb = {
    profit: bestRoute.profit,
    profitPercent: bestRoute.profitPercent,
    buyPrice: bestRoute.inAmount,
    sellPrice: bestRoute.outAmount,
    buyDex: "Raydium",
    sellDex: pair.name,
    tokenMint: pair.input,
    timestamp: now,
  };

  // Decision
  const action = decide(arb, dynamicConfig.forceManual);

  if (
    action === "auto" ||
    (dynamicConfig.fastMode &&
      bestRoute.profitPercent > dynamicConfig.autoThreshold)
  ) {
    updateLastTradeTime();
    cooldown.lastTradeTime = now;

    const result = await executeTrade(arb, wallet, connection, amount);

    if (result.success) {
      cooldown.consecutiveErrors = 0;

      // Update balance manager
      const profitSol = result.profitReal || result.profitPercent || 0;
      const feesEstimate = 0.00001; // Network fees estimate
      balanceManager.updateBalance(
        profitSol * dynamicConfig.tradeSizeSol,
        feesEstimate,
      );

      const profitMsg = result.profitReal
        ? `${(result.profitReal * 100).toFixed(3)}%`
        : result.profitPercent
          ? `${(result.profitPercent * 100).toFixed(3)}%`
          : "N/A";

      sendNotification(
        `✅ [${pair.name}] Auto trade! Profit: ${profitMsg} (via ${result.aggregatorUsed})${result.signature ? `\nSig: ${result.signature.slice(0, 16)}...` : ""}`,
      );
      failsafe.recordSuccess();
    } else {
      cooldown.consecutiveErrors++;
      failsafe.recordError();
    }
  } else if (action === "manual") {
    sendSignal(arb);
  }
}

// ============================================================
// MULTI-HOP ARBITRAGE SCANNER
// ============================================================

async function scanMultiHop(
  wallet: Keypair,
  connection: Connection,
): Promise<void> {
  if (!CONFIG.ENABLE_MULTI_HOP) return;

  const amount = dynamicConfig.tradeSizeSol * LAMPORTS_PER_SOL;

  // Scan SOL → USDC → SOL (2-hop)
  const solMint = new PublicKey(TOKENS.SOL);
  const intermediates = [
    new PublicKey(TOKENS.USDC),
    new PublicKey(TOKENS.USDT),
  ];

  const multiHopRoute = await MultiHopEngine.findMultiHopArb(
    solMint,
    intermediates,
    amount,
    dynamicConfig.slippageBps,
  );

  if (!multiHopRoute) return;

  console.log(
    `🔄 Multi-hop found: ${MultiHopEngine.formatPath(multiHopRoute.path)} (${(multiHopRoute.profitPercent * 100).toFixed(3)}%)`,
  );

  if (multiHopRoute.profitPercent < dynamicConfig.autoThreshold) return;

  // Execute multi-hop trade
  const arb = {
    profit: multiHopRoute.profit,
    profitPercent: multiHopRoute.profitPercent,
    buyPrice: multiHopRoute.hops[0].amount,
    sellPrice: multiHopRoute.finalOutput,
    buyDex: "Multi-Hop",
    sellDex: `${multiHopRoute.hops.length}-hop`,
    tokenMint: TOKENS.SOL,
    timestamp: Date.now(),
  };

  const action = decide(arb, dynamicConfig.forceManual);

  if (action === "auto") {
    updateLastTradeTime();

    const result = await executeTrade(arb, wallet, connection, amount);

    if (result.success) {
      failsafe.recordSuccess();
      sendNotification(
        `✅ Multi-hop trade! ${multiHopRoute.hops.length}-hop, Profit: ${(multiHopRoute.profitPercent * 100).toFixed(3)}%`,
      );
    } else {
      failsafe.recordError();
    }
  }
}

// ============================================================
// MAIN ARBITRAGE LOOP
// ============================================================

async function runArbitrageLoop(wallet: Keypair, connection: Connection) {
  console.log("🚀 Starting Andzis Arbitrage Mode v1.2...");
  console.log(`🔑 Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...`);
  console.log(`📊 Monitoring ${WATCHED_POOLS.length} pools`);
  console.log(`💵 Trade amount: ${dynamicConfig.tradeSizeSol} SOL`);
  console.log(`⚡ Fast mode: ${dynamicConfig.fastMode ? "ON" : "OFF"}`);

  // Initialize balance manager
  const balance = await connection.getBalance(wallet.publicKey);
  initBalanceManager(balance / LAMPORTS_PER_SOL);
  console.log(`💰 Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  let loopCount = 0;
  let startTime = Date.now();

  // Initialize pair cooldowns
  const pairs: TradingPair[] = CONFIG.TRADING_PAIRS.filter((p) => p.enabled);
  pairs.forEach((pair) => {
    pairCooldowns.set(pair.name, { lastTradeTime: 0, consecutiveErrors: 0 });
  });

  while (true) {
    try {
      loopCount++;
      const loopStart = Date.now();

      // Failsafe checks
      const failsafeStatus = await failsafe.checkAll(
        connection,
        wallet.publicKey,
      );
      if (!failsafeStatus.canContinue) {
        console.error("🛑 Failsafe triggered:");
        failsafeStatus.issues.forEach((issue) => console.error(`  ${issue}`));
        await sleep(10000);
        continue;
      }

      // Check if bot is running
      if (!isBotRunning()) {
        logIfDue("⏸️ Bot paused. Use /startbot to resume.");
        await sleep(5000);
        continue;
      }

      // Risk limits check
      if (shouldStopTrading()) {
        console.error("🛑 Risk limit reached. Stopping trades.");
        setBotRunning(false);
        sendNotification("🛑 Trading stopped due to risk limits. Check /pnl");
        await sleep(30000);
        continue;
      }

      // Balance check
      if (!balanceManager.isBalanceHealthy(CONFIG.MIN_BALANCE_SOL)) {
        console.error("🛑 Balance too low. Stopping.");
        setBotRunning(false);
        await sleep(30000);
        continue;
      }

      // PARALLEL SCAN all pairs
      const pairPromises = pairs.map((pair) => {
        const cooldown = pairCooldowns.get(pair.name)!;
        return scanPair(pair, wallet, connection, cooldown);
      });

      await Promise.allSettled(pairPromises);

      // Multi-hop scan (periodically)
      if (loopCount % 5 === 0) {
        await scanMultiHop(wallet, connection);
      }

      // Status log periodically
      if (loopCount % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const loopTime = Date.now() - loopStart;
        const stats = pnlTracker.getStats();

        console.log(`\n📈 === Loop #${loopCount} ===`);
        console.log(`⏱️ Uptime: ${elapsed.toFixed(0)}s | Loop: ${loopTime}ms`);
        console.log(
          `📊 Trades: ${stats.todayTrades} today, ${stats.totalTrades} total`,
        );
        console.log(
          `💰 Today PnL: ${stats.todayPnL.toFixed(6)} SOL | Win Rate: ${stats.winRate.toFixed(1)}%`,
        );
        console.log(`🛑 ${failsafe.getStatusSummary()}`);
        console.log(`========================\n`);
      }

      // Dynamic sleep
      const loopDuration = Date.now() - loopStart;
      const sleepTime = Math.max(100, dynamicConfig.cooldownMs - loopDuration);
      await sleep(sleepTime);
    } catch (error: any) {
      console.error("❌ Error in arbitrage loop:", error.message);
      failsafe.recordError();
      await sleep(5000);
    }
  }
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("🚀 ANDZIS ARBITRAGE MODE v1.2 - KILLER EDITION");
    console.log("⚡ Multi-Hop + Multi-Pair + Smart Filter + Balance Mgmt");
    console.log("=".repeat(60));

    const wallet = initWallet();
    console.log(`🔑 Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...`);

    // Telegram init
    init(async (trade) => {
      console.log("📩 Manual trade execution...");
      const tradeAmount = dynamicConfig.tradeSizeSol * LAMPORTS_PER_SOL;

      const result = await executeTrade(trade, wallet, connection, tradeAmount);

      if (result.success) {
        const profitMsg = result.profitReal
          ? `${(result.profitReal * 100).toFixed(3)}%`
          : result.profitPercent
            ? `${(result.profitPercent * 100).toFixed(3)}%`
            : "N/A";

        sendNotification(
          `✅ Manual trade! Profit: ${profitMsg}\nSig: ${result.signature}`,
        );
        failsafe.recordSuccess();
      } else {
        sendNotification(`❌ Manual trade failed: ${result.error}`);
        failsafe.recordError();
      }
    }, dynamicConfig);

    // Start loop
    await runArbitrageLoop(wallet, connection);
  } catch (error: any) {
    console.error("💥 Fatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down...");
  const stats = pnlTracker.getStats();
  console.log(
    `\n📊 Final: ${stats.totalTrades} trades, ${stats.totalPnL.toFixed(6)} SOL, ${stats.winRate.toFixed(1)}% WR`,
  );
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n👋 Shutting down...");
  process.exit(0);
});

main();
