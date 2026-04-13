import { PublicKey } from "@solana/web3.js";
import { getJupiterQuote, convertToStandardQuote, JupiterQuoteResult } from "../dex/jupiter";
import { getTitanQuote, TitanQuoteResult } from "./titan";
import { CONFIG } from "../config";

export type AggregatorSource = "jupiter" | "titan" | "unknown";

export interface AggregatorQuoteResult {
  route: any;
  outAmount: number;
  inAmount: number;
  profit: number;
  profitPercent: number;
  priceImpact: number;
  fees: number;
  source: AggregatorSource;
}

export interface RouterStats {
  jupiterWins: number;
  titanWins: number;
  totalQueries: number;
  avgSavingsPercent: number;
  lastUpdateTime: number;
}

const routerStats: RouterStats = {
  jupiterWins: 0,
  titanWins: 0,
  totalQueries: 0,
  avgSavingsPercent: 0,
  lastUpdateTime: 0,
};

/**
 * Smart Router - Automatically selects the best route from multiple aggregators
 *
 * Strategy:
 * 1. Query Jupiter and Titan in parallel
 * 2. Compare outputs (after fees & slippage)
 * 3. Return the best route
 * 4. Track statistics for optimization
 */
export async function getBestRoute(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  slippageBps: number = CONFIG.SLIPPAGE_BPS
): Promise<AggregatorQuoteResult | null> {
  const startTime = Date.now();
  routerStats.totalQueries++;

  console.log("🔍 Scanning aggregators for best route...");

  // Query both aggregators in parallel
  const [jupiterQuote, titanQuote] = await Promise.allSettled([
    getJupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    }),
    getTitanQuote(inputMint, outputMint, amount, slippageBps),
  ]);

  // Process results
  let jupiter: AggregatorQuoteResult | null = null;
  let titan: AggregatorQuoteResult | null = null;

  if (jupiterQuote.status === "fulfilled" && jupiterQuote.value) {
    jupiter = convertToStandardQuote(jupiterQuote.value, amount);
  }

  if (titanQuote.status === "fulfilled" && titanQuote.value) {
    titan = titanQuote.value;
  }

  // Handle cases where one or both failed
  if (!jupiter && !titan) {
    console.error("❌ Both aggregators failed!");
    return null;
  }

  if (!jupiter && titan) {
    console.log(`⚡ Using Titan (Jupiter failed)`);
    routerStats.titanWins++;
    updateStats(startTime, titan);
    return titan;
  }

  if (jupiter && !titan) {
    console.log(`⚡ Using Jupiter (Titan unavailable)`);
    routerStats.jupiterWins++;
    updateStats(startTime, jupiter);
    return jupiter;
  }

  // Both succeeded - compare and pick best
  const jupiterOut = jupiter!.outAmount;
  const titanOut = titan!.outAmount;

  const diff = Math.abs(jupiterOut - titanOut);
  const diffPercent = (diff / amount) * 100;

  console.log(`📊 Aggregator Comparison:`);
  console.log(`   Jupiter: ${jupiterOut / 1e9} SOL`);
  console.log(`   Titan:   ${titanOut / 1e9} SOL`);
  console.log(`   Diff:    ${diffPercent.toFixed(4)}%`);

  let best: AggregatorQuoteResult;

  if (titanOut > jupiterOut) {
    best = titan!;
    routerStats.titanWins++;
    console.log(`✅ Selected Titan (+${diffPercent.toFixed(4)}%)`);
  } else if (jupiterOut > titanOut) {
    best = jupiter!;
    routerStats.jupiterWins++;
    console.log(`✅ Selected Jupiter (+${diffPercent.toFixed(4)}%)`);
  } else {
    // Identical - prefer Jupiter (more stable)
    best = jupiter!;
    routerStats.jupiterWins++;
    console.log(`✅ Selected Jupiter (identical output)`);
  }

  updateStats(startTime, best);
  return best;
}

/**
 * Get best routes for multiple token pairs in parallel
 */
export async function getBestRoutesMulti(
  pairs: Array<{
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: number;
  }>,
  slippageBps: number = CONFIG.SLIPPAGE_BPS
): Promise<AggregatorQuoteResult[]> {
  const promises = pairs.map(({ inputMint, outputMint, amount }) =>
    getBestRoute(inputMint, outputMint, amount, slippageBps)
  );

  const results = await Promise.allSettled(promises);

  return results
    .filter(
      (r): r is PromiseFulfilledResult<AggregatorQuoteResult> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}

/**
 * Get router statistics
 */
export function getRouterStats(): RouterStats {
  return { ...routerStats };
}

/**
 * Format router stats for display
 */
export function formatRouterStats(): string {
  const stats = getRouterStats();
  const total = stats.jupiterWins + stats.titanWins;
  const jupiterPct = total > 0 ? ((stats.jupiterWins / total) * 100).toFixed(1) : "0";
  const titanPct = total > 0 ? ((stats.titanWins / total) * 100).toFixed(1) : "0";

  return `
📊 <b>Router Statistics</b>

🔍 Total Queries: ${stats.totalQueries}
🏆 Jupiter Wins: ${stats.jupiterWins} (${jupiterPct}%)
🏆 Titan Wins: ${stats.titanWins} (${titanPct}%)
📈 Avg Savings: ${stats.avgSavingsPercent.toFixed(4)}%
⏱️ Last Update: ${stats.lastUpdateTime > 0 ? new Date(stats.lastUpdateTime).toLocaleTimeString() : "Never"}
`;
}

/**
 * Reset router statistics
 */
export function resetRouterStats(): void {
  routerStats.jupiterWins = 0;
  routerStats.titanWins = 0;
  routerStats.totalQueries = 0;
  routerStats.avgSavingsPercent = 0;
  routerStats.lastUpdateTime = 0;
}

/**
 * Update router stats after a successful route selection
 */
function updateStats(startTime: number, selected: AggregatorQuoteResult): void {
  const queryTime = Date.now() - startTime;
  routerStats.lastUpdateTime = Date.now();

  // Log if query was slow
  if (queryTime > 2000) {
    console.warn(`⚠️ Slow aggregator query: ${queryTime}ms`);
  }
}
