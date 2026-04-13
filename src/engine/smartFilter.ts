import { CONFIG } from "../config";

export interface RouteInfo {
  marketInfos?: any[];
  priceImpactPct?: number;
  outAmount?: string | number;
  feeBps?: number;
  routePlan?: any[];
}

export interface SmartFilterResult {
  passed: boolean;
  reason?: string;
}

/**
 * Smart Filter - Strategy Layer
 * Filters out low-quality routes before execution
 */
export class SmartFilter {

  /**
   * Apply all filters to a route
   */
  static apply(route: RouteInfo): SmartFilterResult {
    // Filter 1: Minimum market infos
    if (!route.marketInfos || route.marketInfos.length < 1) {
      return { passed: false, reason: "No market info" };
    }

    // Filter 2: Skip routes with too many hops (high failure rate)
    if (route.marketInfos.length > 3) {
      return { passed: false, reason: "Too many hops" };
    }

    // Filter 3: Price impact too high
    if (route.priceImpactPct && route.priceImpactPct > 1.0) {
      return { passed: false, reason: "Price impact too high" };
    }

    // Filter 4: Output amount validation
    if (!route.outAmount || Number(route.outAmount) <= 0) {
      return { passed: false, reason: "Invalid output amount" };
    }

    // Filter 5: Fee check
    if (route.feeBps && route.feeBps > 500) {
      return { passed: false, reason: "Fees too high" };
    }

    return { passed: true };
  }

  /**
   * Score route quality (higher = better)
   */
  static score(route: RouteInfo): number {
    let score = 100;

    // Fewer hops = better
    score -= (route.marketInfos?.length || 1) * 10;

    // Lower impact = better
    score -= (route.priceImpactPct || 0) * 20;

    // Lower fees = better
    score -= (route.feeBps || 0) * 0.1;

    return Math.max(0, score);
  }

  /**
   * Check if pair is worth trading (liquidity filter)
   */
  static checkLiquidity(
    dailyVolume: number,
    minDailyVolume: number = 100000
  ): boolean {
    return dailyVolume >= minDailyVolume;
  }

  /**
   * Check if pair has enough spread to be profitable
   */
  static checkSpread(
    buyPrice: number,
    sellPrice: number,
    minSpreadBps: number = 15
  ): boolean {
    const spread = Math.abs(sellPrice - buyPrice) / Math.min(buyPrice, sellPrice);
    const spreadBps = spread * 10000;
    return spreadBps >= minSpreadBps;
  }
}
