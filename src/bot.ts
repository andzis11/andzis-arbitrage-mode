import dotenv from "dotenv";
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { WATCHED_POOLS } from "./dex/raydiumRealtime";
import {
  decide,
  TradeAction,
  updateLastTradeTime,
  getConsecutiveErrors,
  resetErrorCount,
} from "./engine/decision";
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
import { CONFIG } from "./config";

dotenv.config();

// Initialize wallet from private key
function initWallet(): Keypair {
  const privateKeyString = process.env.PRIVATE_KEY!;
  const secretKey = bs58.decode(privateKeyString);
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

// Track last log time for minimal logging
let lastLogTime = 0;
const MIN_LOG_INTERVAL = CONFIG.MIN_LOG_INTERVAL_MS;

function logIfDue(message: string): void {
  const now = Date.now();
  if (now - lastLogTime >= MIN_LOG_INTERVAL) {
    console.log(message);
    lastLogTime = now;
  }
}

// Main arbitrage loop with multi-pair parallel scanning
async function runArbitrageLoop(wallet: Keypair, connection: Connection) {
  console.log("🚀 Starting Andzis Arbitrage Mode...");
  console.log(`🔑 Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...`);
  console.log(`📊 Monitoring ${WATCHED_POOLS.length} pools`);
  console.log(`💵 Trade amount: ${dynamicConfig.tradeSizeSol} SOL`);

  let loopCount = 0;
  let startTime = Date.now();

  while (true) {
    try {
      loopCount++;
      const loopStart = Date.now();

      // Check failsafes
      const failsafeStatus = await failsafe.checkAll(
        connection,
        wallet.publicKey,
      );

      if (!failsafeStatus.canContinue) {
        console.error("🛑 Failsafe triggered:");
        failsafeStatus.issues.forEach((issue) => console.error(`  ${issue}`));
        await sleep(10000); // Wait longer when failsafe is active
        continue;
      }

      // Check if bot is running
      if (!isBotRunning()) {
        logIfDue("⏸️ Bot paused. Use /startbot to resume.");
        await sleep(5000);
        continue;
      }

      // Check risk limits
      if (shouldStopTrading()) {
        console.error("🛑 Risk limit reached. Stopping trades.");
        setBotRunning(false);
        sendNotification(
          "🛑 Trading stopped due to risk limits. Check /pnl for details.",
        );
        await sleep(30000); // Long pause
        continue;
      }

      // MULTI-PAIR PARALLEL SCAN
      const prices = await scanAllPoolsParallel();

      if (prices.length === 0) {
        logIfDue("⚠️ No price data available, waiting...");
        await sleep(5000);
        continue;
      }

      // For now, simulate multi-DEX prices (remove this when you add real DEX integrations)
      // In production, you'd have real prices from multiple DEXs
      if (prices.length > 0) {
        const basePrice = prices[0].price;
        const simulatedPrices = simulateMultiDexPrices(basePrice);

        // Detect arbitrage opportunities
        const opportunities = detectArbFromScan(simulatedPrices);

        if (opportunities.length > 0) {
          const bestArb = opportunities[0];

          console.log(
            `🔍 Arb detected: ${(bestArb.profitPercent * 100).toFixed(3)}% | ${bestArb.buyDex}→${bestArb.sellDex}`,
          );

          const action = decide(bestArb, dynamicConfig.forceManual);

          if (action === "auto") {
            console.log("⚡ AUTO EXECUTING TRADE...");
            updateLastTradeTime();

            const tradeAmount = dynamicConfig.tradeSizeSol * LAMPORTS_PER_SOL;
            const result = await executeTrade(
              bestArb,
              wallet,
              connection,
              tradeAmount,
            );

            if (result.success) {
              const profitMsg = result.profitReal
                ? `${(result.profitReal * 100).toFixed(3)}%`
                : result.profitPercent
                  ? `${(result.profitPercent * 100).toFixed(3)}%`
                  : "N/A";

              sendNotification(
                `✅ Auto trade executed! Profit: ${profitMsg}${result.signature ? `\nSig: ${result.signature}` : ""}`,
              );
              failsafe.recordSuccess();
            } else {
              console.error(`❌ Trade failed: ${result.error}`);
              failsafe.recordError();
            }
          } else if (action === "manual") {
            console.log("📩 SENDING TELEGRAM SIGNAL...");
            sendSignal(bestArb);
          }
        }
      }

      // Log status periodically
      if (loopCount % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const loopTime = Date.now() - loopStart;
        const stats = pnlTracker.getStats();

        console.log(`\n📈 === Loop #${loopCount} ===`);
        console.log(`⏱️ Uptime: ${elapsed.toFixed(0)}s`);
        console.log(`🔄 Loop time: ${loopTime}ms`);
        console.log(
          `📊 Trades: ${stats.todayTrades} today, ${stats.totalTrades} total`,
        );
        console.log(`💰 Today PnL: ${stats.todayPnL.toFixed(6)} SOL`);
        console.log(`✅ Win Rate: ${stats.winRate.toFixed(1)}%`);
        console.log(`🛑 ${failsafe.getStatusSummary()}`);
        console.log(`========================\n`);
      }

      // Dynamic sleep based on loop time
      const loopDuration = Date.now() - loopStart;
      const targetLoopTime = dynamicConfig.cooldownMs;
      const sleepTime = Math.max(100, targetLoopTime - loopDuration);

      await sleep(sleepTime);
    } catch (error: any) {
      console.error("❌ Error in arbitrage loop:", error.message);
      failsafe.recordError();

      await sleep(5000); // Longer wait on error
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Entry point
async function main() {
  try {
    console.log("=".repeat(60));
    console.log("🚀 ANDZIS ARBITRAGE MODE v1.1 - MULTI-AGGREGATOR");
    console.log("⚡ Jupiter + Titan Auto-Router");
    console.log("=".repeat(60));

    // Initialize wallet
    const wallet = initWallet();
    console.log(
      `🔑 Wallet loaded: ${wallet.publicKey.toBase58().slice(0, 8)}...`,
    );

    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    console.log(`💰 Balance: ${balanceSol.toFixed(4)} SOL`);

    if (balanceSol < CONFIG.MIN_BALANCE_SOL) {
      console.error(
        `⚠️ Balance too low! Minimum: ${CONFIG.MIN_BALANCE_SOL} SOL`,
      );
      process.exit(1);
    }

    // Initialize Telegram bot with config reference
    init(async (trade) => {
      console.log("📩 Manual trade execution triggered...");
      const tradeAmount = dynamicConfig.tradeSizeSol * LAMPORTS_PER_SOL;

      const result = await executeTrade(trade, wallet, connection, tradeAmount);

      if (result.success) {
        const profitMsg = result.profitReal
          ? `${(result.profitReal * 100).toFixed(3)}%`
          : result.profitPercent
            ? `${(result.profitPercent * 100).toFixed(3)}%`
            : "N/A";

        sendNotification(
          `✅ Manual trade executed! Profit: ${profitMsg}\nSignature: ${result.signature}`,
        );
        failsafe.recordSuccess();
      } else {
        sendNotification(`❌ Manual trade failed: ${result.error}`);
        failsafe.recordError();
      }
    }, dynamicConfig);

    // Start the arbitrage loop
    await runArbitrageLoop(wallet, connection);
  } catch (error: any) {
    console.error("💥 Fatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down gracefully...");
  const stats = pnlTracker.getStats();
  console.log(`\n📊 Final Stats:`);
  console.log(`  Total Trades: ${stats.totalTrades}`);
  console.log(`  Total PnL: ${stats.totalPnL.toFixed(6)} SOL`);
  console.log(`  Win Rate: ${stats.winRate.toFixed(1)}%`);
  console.log(`  Today PnL: ${stats.todayPnL.toFixed(6)} SOL`);
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n👋 Shutting down gracefully...");
  process.exit(0);
});

// Start the bot
main();
