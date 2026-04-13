import { PublicKey } from "@solana/web3.js";
import { getPoolState, PoolState, WATCHED_POOLS } from "../dex/raydiumRealtime";
import { detectArb, detectMultiArb, ArbOpportunity } from "../engine/arbEngine";
import { CONFIG } from "../config";

export interface PoolPrice {
  dex: string;
  price: number;
  tokenMint: string;
  poolId: string;
  lastUpdate: number;
}

// Price cache for latency optimization
class PriceCache {
  private cache: Map<string, { price: number; timestamp: number }> = new Map();

  get(poolId: string): number | null {
    const entry = this.cache.get(poolId);
    if (!entry) return null;

    // Check if cache is fresh
    if (Date.now() - entry.timestamp > CONFIG.CACHE_PRICE_MS) {
      this.cache.delete(poolId);
      return null;
    }

    return entry.price;
  }

  set(poolId: string, price: number): void {
    this.cache.set(poolId, { price, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > CONFIG.CACHE_PRICE_MS * 2) {
        this.cache.delete(key);
      }
    }
  }
}

export const priceCache = new PriceCache();

// Multi-pair parallel scanner
export async function scanAllPoolsParallel(): Promise<PoolPrice[]> {
  const startTime = Date.now();

  // Parallel scanning for speed
  const poolPromises = WATCHED_POOLS.map(async (poolConfig) => {
    const poolId = poolConfig.poolId;

    // Check cache first
    const cachedPrice = priceCache.get(poolId);
    if (cachedPrice !== null) {
      return {
        dex: "Raydium",
        price: cachedPrice,
        tokenMint: poolConfig.token0,
        poolId,
        lastUpdate: Date.now(),
      };
    }

    try {
      const poolState = await getPoolState(new PublicKey(poolId));

      if (poolState) {
        // Cache the price
        priceCache.set(poolId, poolState.price0In1);

        return {
          dex: "Raydium",
          price: poolState.price0In1,
          tokenMint: poolConfig.token0,
          poolId,
          lastUpdate: Date.now(),
        };
      }
    } catch (error: any) {
      console.error(`❌ Error scanning pool ${poolId}:`, error.message);
    }

    return null;
  });

  const results = await Promise.allSettled(poolPromises);

  // Filter out nulls and rejections
  const validPrices = results
    .filter(
      (r): r is PromiseFulfilledResult<PoolPrice> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);

  const scanTime = Date.now() - startTime;

  // Log only if scan took too long (latency monitoring)
  if (scanTime > 1000) {
    console.warn(`⚠️ Slow scan: ${scanTime}ms for ${WATCHED_POOLS.length} pools`);
  }

  // Cleanup old cache entries periodically
  if (Math.random() < 0.1) { // 10% chance each scan
    priceCache.cleanup();
  }

  return validPrices;
}

// Detect arbitrage opportunities from scanned prices
export function detectArbFromScan(prices: PoolPrice[]): ArbOpportunity[] {
  // Group prices by token
  const tokenPrices: Map<string, { dex: string; price: number; tokenMint: string }[]> = new Map();

  for (const price of prices) {
    if (!tokenPrices.has(price.tokenMint)) {
      tokenPrices.set(price.tokenMint, []);
    }
    tokenPrices.get(price.tokenMint)!.push({
      dex: price.dex,
      price: price.price,
      tokenMint: price.tokenMint,
    });
  }

  const opportunities: ArbOpportunity[] = [];

  // Check for arb opportunities within each token
  for (const [tokenMint, tokenPriceList] of tokenPrices.entries()) {
    for (let i = 0; i < tokenPriceList.length; i++) {
      for (let j = i + 1; j < tokenPriceList.length; j++) {
        const arb = detectArb(
          tokenPriceList[i].price,
          tokenPriceList[j].price,
          tokenPriceList[i].dex,
          tokenPriceList[j].dex,
          tokenMint
        );

        if (arb) {
          opportunities.push(arb);
        }
      }
    }
  }

  // Sort by profit percent (best first)
  return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
}

// Simulate prices from different DEXs for demo (remove when you add real DEX integrations)
export function simulateMultiDexPrices(basePrice: number): PoolPrice[] {
  const now = Date.now();

  return [
    {
      dex: "Raydium",
      price: basePrice,
      tokenMint: "So11111111111111111111111111111111111111112",
      poolId: "raydium_pool_1",
      lastUpdate: now,
    },
    {
      dex: "Orca",
      price: basePrice * (1 + (Math.random() - 0.5) * 0.01),
      tokenMint: "So11111111111111111111111111111111111111112",
      poolId: "orca_pool_1",
      lastUpdate: now,
    },
    {
      dex: "Jupiter",
      price: basePrice * (1 + (Math.random() - 0.5) * 0.015),
      tokenMint: "So11111111111111111111111111111111111111112",
      poolId: "jupiter_pool_1",
      lastUpdate: now,
    },
  ];
}
