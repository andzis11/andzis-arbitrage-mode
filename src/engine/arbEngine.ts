export interface ArbOpportunity {
  profit: number;
  profitPercent: number;
  buyPrice: number;
  sellPrice: number;
  buyDex: string;
  sellDex: string;
  tokenMint: string;
  timestamp: number;
}

export function detectArb(
  priceA: number,
  priceB: number,
  dexA: string = "Raydium",
  dexB: string = "Jupiter",
  tokenMint: string = ""
): ArbOpportunity | null {
  if (priceA <= 0 || priceB <= 0) return null;

  // Calculate arb in both directions
  const buyASellB = {
    profit: priceB - priceA,
    profitPercent: (priceB - priceA) / priceA,
    buyPrice: priceA,
    sellPrice: priceB,
    buyDex: dexA,
    sellDex: dexB,
  };

  const buyBSellA = {
    profit: priceA - priceB,
    profitPercent: (priceA - priceB) / priceB,
    buyPrice: priceB,
    sellPrice: priceA,
    buyDex: dexB,
    sellDex: dexA,
  };

  // Choose the profitable direction
  const best = buyASellB.profitPercent > buyBSellA.profitPercent
    ? buyASellB
    : buyBSellA;

  if (best.profitPercent <= 0) return null;

  return {
    ...best,
    tokenMint,
    timestamp: Date.now(),
  };
}

export function detectMultiArb(
  prices: { dex: string; price: number; tokenMint: string }[]
): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  for (let i = 0; i < prices.length; i++) {
    for (let j = i + 1; j < prices.length; j++) {
      if (prices[i].tokenMint === prices[j].tokenMint) {
        const arb = detectArb(
          prices[i].price,
          prices[j].price,
          prices[i].dex,
          prices[j].dex,
          prices[i].tokenMint
        );
        if (arb) {
          opportunities.push(arb);
        }
      }
    }
  }

  return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
}
