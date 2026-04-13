import { PublicKey } from "@solana/web3.js";
import { getJupiterQuote, convertToStandardQuote } from "../dex/jupiter";
import { CONFIG } from "../config";

export interface HopQuote {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;
  outAmount: number;
  priceImpact: number;
  route: any;
}

export interface MultiHopRoute {
  hops: HopQuote[];
  finalOutput: number;
  profit: number;
  profitPercent: number;
  totalPriceImpact: number;
  path: string[];
}

/**
 * Multi-Hop Arbitrage Engine
 * Finds profitable paths: A → B → C → A
 */
export class MultiHopEngine {
  private static readonly MAX_HOPS = 3;
  private static readonly MIN_PROFIT_BPS = 10; // 0.1% minimum

  /**
   * Find multi-hop arbitrage opportunities
   */
  static async findMultiHopArb(
    startMint: PublicKey,
    intermediateTokens: PublicKey[],
    amount: number,
    slippageBps: number = CONFIG.SLIPPAGE_BPS
  ): Promise<MultiHopRoute | null> {
    const routes: MultiHopRoute[] = [];

    // 2-hop: A → B → A
    for (const intermediate of intermediateTokens) {
      const route = await this.findTwoHopRoute(
        startMint,
        intermediate,
        amount,
        slippageBps
      );
      if (route && this.isProfitable(route)) {
        routes.push(route);
      }
    }

    // 3-hop: A → B → C → A
    if (intermediateTokens.length >= 2) {
      for (let i = 0; i < intermediateTokens.length; i++) {
        for (let j = 0; j < intermediateTokens.length; j++) {
          if (i === j) continue;

          const route = await this.findThreeHopRoute(
            startMint,
            intermediateTokens[i],
            intermediateTokens[j],
            amount,
            slippageBps
          );
          if (route && this.isProfitable(route)) {
            routes.push(route);
          }
        }
      }
    }

    // Return best route
    if (routes.length === 0) return null;

    return routes.sort((a, b) => b.profitPercent - a.profitPercent)[0];
  }

  /**
   * Find 2-hop route: A → B → A
   */
  private static async findTwoHopRoute(
    tokenA: PublicKey,
    tokenB: PublicKey,
    amount: number,
    slippageBps: number
  ): Promise<MultiHopRoute | null> {
    try {
      // Hop 1: A → B
      const quote1 = await getJupiterQuote({
        inputMint: tokenA,
        outputMint: tokenB,
        amount,
        slippageBps,
      });

      if (!quote1) return null;

      const outAmount1 = quote1.outAmount;

      // Hop 2: B → A
      const quote2 = await getJupiterQuote({
        inputMint: tokenB,
        outputMint: tokenA,
        amount: outAmount1,
        slippageBps,
      });

      if (!quote2) return null;

      const finalOutput = quote2.outAmount;
      const profit = finalOutput - amount;
      const profitPercent = profit / amount;
      const totalPriceImpact =
        (quote1.priceImpactPct || 0) + (quote2.priceImpactPct || 0);

      return {
        hops: [
          {
            inputMint: tokenA,
            outputMint: tokenB,
            amount,
            outAmount: outAmount1,
            priceImpact: quote1.priceImpactPct || 0,
            route: quote1,
          },
          {
            inputMint: tokenB,
            outputMint: tokenA,
            amount: outAmount1,
            outAmount: finalOutput,
            priceImpact: quote2.priceImpactPct || 0,
            route: quote2,
          },
        ],
        finalOutput,
        profit,
        profitPercent,
        totalPriceImpact,
        path: [tokenA.toBase58(), tokenB.toBase58(), tokenA.toBase58()],
      };
    } catch {
      return null;
    }
  }

  /**
   * Find 3-hop route: A → B → C → A
   */
  private static async findThreeHopRoute(
    tokenA: PublicKey,
    tokenB: PublicKey,
    tokenC: PublicKey,
    amount: number,
    slippageBps: number
  ): Promise<MultiHopRoute | null> {
    try {
      // Hop 1: A → B
      const quote1 = await getJupiterQuote({
        inputMint: tokenA,
        outputMint: tokenB,
        amount,
        slippageBps,
      });

      if (!quote1) return null;

      const outAmount1 = quote1.outAmount;

      // Hop 2: B → C
      const quote2 = await getJupiterQuote({
        inputMint: tokenB,
        outputMint: tokenC,
        amount: outAmount1,
        slippageBps,
      });

      if (!quote2) return null;

      const outAmount2 = quote2.outAmount;

      // Hop 3: C → A
      const quote3 = await getJupiterQuote({
        inputMint: tokenC,
        outputMint: tokenA,
        amount: outAmount2,
        slippageBps,
      });

      if (!quote3) return null;

      const finalOutput = quote3.outAmount;
      const profit = finalOutput - amount;
      const profitPercent = profit / amount;
      const totalPriceImpact =
        (quote1.priceImpactPct || 0) +
        (quote2.priceImpactPct || 0) +
        (quote3.priceImpactPct || 0);

      return {
        hops: [
          {
            inputMint: tokenA,
            outputMint: tokenB,
            amount,
            outAmount: outAmount1,
            priceImpact: quote1.priceImpactPct || 0,
            route: quote1,
          },
          {
            inputMint: tokenB,
            outputMint: tokenC,
            amount: outAmount1,
            outAmount: outAmount2,
            priceImpact: quote2.priceImpactPct || 0,
            route: quote2,
          },
          {
            inputMint: tokenC,
            outputMint: tokenA,
            amount: outAmount2,
            outAmount: finalOutput,
            priceImpact: quote3.priceImpactPct || 0,
            route: quote3,
          },
        ],
        finalOutput,
        profit,
        profitPercent,
        totalPriceImpact,
        path: [
          tokenA.toBase58(),
          tokenB.toBase58(),
          tokenC.toBase58(),
          tokenA.toBase58(),
        ],
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if route is profitable
   */
  private static isProfitable(route: MultiHopRoute): boolean {
    const profitBps = route.profitPercent * 10000;
    return profitBps >= this.MIN_PROFIT_BPS && route.totalPriceImpact < 2.0;
  }

  /**
   * Format path for display
   */
  static formatPath(path: string[]): string {
    return path.map((p) => p.slice(0, 6)).join(" → ");
  }
}
