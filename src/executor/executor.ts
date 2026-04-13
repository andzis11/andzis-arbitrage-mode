import {
  Keypair,
  PublicKey,
  Connection,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getJupiterQuote,
  getJupiterSwapTransaction,
  checkPriceImpact,
  JupiterQuote,
} from "../dex/jupiter";
import {
  getBestRoute,
  AggregatorQuoteResult,
  AggregatorSource,
} from "./router";
import { getTitanSwapTransaction } from "./titan";
import { sendTransactionWithJito } from "./jito";
import { validateTrade, calculateRealProfit } from "../engine/risk";
import { ArbOpportunity } from "../engine/arbEngine";
import { pnlTracker, TradeRecord } from "../engine/pnl";
import { recordTradeSuccess, recordTradeError } from "../engine/decision";
import { CONFIG } from "../config";

export interface TradeResult {
  success: boolean;
  signature?: string;
  error?: string;
  profit?: number;
  profitReal?: number;
  profitPercent?: number;
  timestamp: number;
  retries: number;
  aggregatorUsed: AggregatorSource;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeTrade(
  arb: ArbOpportunity,
  wallet: Keypair,
  connection: Connection,
  amount: number, // Amount in lamports to trade
): Promise<TradeResult> {
  let lastError: string = "Unknown error";

  // Retry loop
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`🔄 Retry attempt ${attempt}/${CONFIG.MAX_RETRIES}...`);
        await sleep(1000 * attempt); // Exponential backoff
      }

      console.log(`🚀 EXECUTING TRADE (Attempt ${attempt + 1})...`);
      console.log(`  Buy on ${arb.buyDex} @ ${arb.buyPrice}`);
      console.log(`  Sell on ${arb.sellDex} @ ${arb.sellPrice}`);
      console.log(
        `  Expected profit: ${(arb.profitPercent * 100).toFixed(3)}%`,
      );

      // MULTI-AGGREGATOR: Get best route from Jupiter + Titan
      const inputMint = new PublicKey(arb.tokenMint);
      const outputMint = new PublicKey(arb.tokenMint);

      const bestRoute = await getBestRoute(
        inputMint,
        outputMint,
        amount,
        CONFIG.SLIPPAGE_BPS,
      );

      if (!bestRoute) {
        lastError = "All aggregators failed to provide quotes";
        continue;
      }

      console.log(
        `📊 Best route: ${bestRoute.source.toUpperCase()} (out: ${bestRoute.outAmount / 1e9})`,
      );

      // Check price impact
      if (bestRoute.priceImpact > 0.5) {
        lastError = "Price impact too high";
        continue;
      }

      // Validate the trade
      const isValid = validateTrade(
        arb.profitPercent,
        bestRoute.priceImpact,
        bestRoute.priceImpact,
        0,
        amount / LAMPORTS_PER_SOL,
      );

      if (!isValid) {
        lastError = "Trade validation failed";
        continue;
      }

      // Get swap transaction from the selected aggregator
      const swapTx = await getSwapTransaction(
        bestRoute,
        wallet.publicKey.toBase58(),
      );

      if (!swapTx) {
        lastError = "Failed to get swap transaction from aggregator";
        continue;
      }

      // Sign the transaction
      swapTx.sign([wallet]);

      // Send via Jito with retry
      let signature: string;
      try {
        signature = await sendTransactionWithJito(swapTx, wallet, connection);
      } catch (jitoError: any) {
        console.error("Jito send failed, trying direct send...");

        // Fallback: send directly to RPC
        signature = await connection.sendTransaction(swapTx, {
          maxRetries: 3,
        });
      }

      // CONFIRM TRANSACTION (Critical!)
      console.log(`⏳ Waiting for confirmation: ${signature}`);
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          ...(await connection.getLatestBlockhash("confirmed")),
        },
        "confirmed",
      );

      if (confirmation.value.err) {
        lastError = `Transaction failed: ${JSON.stringify(confirmation.value.err)}`;
        console.error(`❌ ${lastError}`);

        // Record failed trade
        recordFailedTrade(arb, amount, signature, lastError);
        recordTradeError();
        continue;
      }

      console.log(`✅ Trade confirmed! Signature: ${signature}`);

      // Calculate REAL profit
      const profitCalc = calculateRealProfit(
        amount,
        bestRoute.inAmount,
        bestRoute.outAmount,
        bestRoute.fees + 5000, // Aggregator fees + network fees
        CONFIG.SLIPPAGE_BPS,
      );

      console.log(
        `💰 Real Profit: ${profitCalc.netProfit.toFixed(6)} SOL (${(profitCalc.netProfitPercent * 100).toFixed(3)}%)`,
      );

      // Record successful trade
      recordSuccessfulTrade(
        arb,
        amount,
        bestRoute.outAmount,
        profitCalc.netProfit / LAMPORTS_PER_SOL,
        profitCalc.netProfitPercent,
        signature,
        bestRoute.source,
      );
      recordTradeSuccess();

      return {
        success: true,
        signature,
        profit: arb.profitPercent,
        profitReal: profitCalc.netProfitPercent,
        profitPercent: profitCalc.netProfitPercent,
        timestamp: Date.now(),
        retries: attempt,
        aggregatorUsed: bestRoute.source,
      };
    } catch (error: any) {
      lastError = error.message;
      console.error(
        `❌ Trade execution failed (Attempt ${attempt + 1}):`,
        error.message,
      );
      recordTradeError();
    }
  }

  // All retries failed
  console.error(
    `❌ Trade failed after ${CONFIG.MAX_RETRIES + 1} attempts: ${lastError}`,
  );

  return {
    success: false,
    error: lastError,
    timestamp: Date.now(),
    retries: CONFIG.MAX_RETRIES,
    aggregatorUsed: "unknown",
  };
}

/**
 * Get swap transaction from the selected aggregator
 */
async function getSwapTransaction(
  route: AggregatorQuoteResult,
  userPublicKey: string,
): Promise<VersionedTransaction | null> {
  try {
    switch (route.source) {
      case "jupiter":
        return await getJupiterSwapTransaction(route.route, userPublicKey);

      case "titan":
        const titanData = await getTitanSwapTransaction(
          route.route,
          userPublicKey,
        );
        if (!titanData || !titanData.swapTransaction) {
          return null;
        }
        const transactionBuf = Buffer.from(titanData.swapTransaction, "base64");
        return VersionedTransaction.deserialize(transactionBuf);

      default:
        console.error(`❌ Unknown aggregator source: ${route.source}`);
        return null;
    }
  } catch (error: any) {
    console.error(
      `❌ Error getting swap transaction from ${route.source}:`,
      error.message,
    );
    return null;
  }
}

function recordSuccessfulTrade(
  arb: ArbOpportunity,
  inputAmount: number,
  outputAmount: number,
  profitSol: number,
  profitPercent: number,
  signature: string,
  aggregator: AggregatorSource,
): void {
  const tradeRecord: TradeRecord = {
    timestamp: Date.now(),
    tokenMint: arb.tokenMint,
    buyDex: `${arb.buyDex} (via ${aggregator})`,
    sellDex: arb.sellDex,
    inputAmount,
    outputAmount,
    feesPaid: 5000 / LAMPORTS_PER_SOL,
    profitLoss: profitSol,
    profitPercent,
    signature,
    status: "success",
  };

  pnlTracker.recordTrade(tradeRecord);
}

function recordFailedTrade(
  arb: ArbOpportunity,
  inputAmount: number,
  signature?: string,
  error?: string,
): void {
  const tradeRecord: TradeRecord = {
    timestamp: Date.now(),
    tokenMint: arb.tokenMint,
    buyDex: arb.buyDex,
    sellDex: arb.sellDex,
    inputAmount,
    outputAmount: 0,
    feesPaid: 0,
    profitLoss: 0,
    profitPercent: 0,
    signature,
    status: "failed",
  };

  pnlTracker.recordTrade(tradeRecord);
}

export async function executeReverseTrade(
  arb: ArbOpportunity,
  wallet: Keypair,
  connection: Connection,
  amount: number,
): Promise<TradeResult> {
  return executeTrade(arb, wallet, connection, amount);
}
