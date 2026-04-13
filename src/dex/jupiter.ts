import axios from "axios";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { CONFIG } from "../config";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface JupiterSwapParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number; // in lamports (smallest unit)
  slippageBps?: number;
}

export async function getJupiterQuote(
  params: JupiterSwapParams,
): Promise<JupiterQuote | null> {
  try {
    const quote = await axios.get(`${CONFIG.JUPITER_API_URL}/quote`, {
      params: {
        inputMint: params.inputMint.toBase58(),
        outputMint: params.outputMint.toBase58(),
        amount: params.amount,
        slippageBps: params.slippageBps || CONFIG.SLIPPAGE_BPS,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      },
    });

    return quote.data;
  } catch (error) {
    console.error("Error getting Jupiter quote:", error);
    return null;
  }
}

export async function getJupiterSwapTransaction(
  quoteResponse: any,
  userPublicKey: string,
): Promise<VersionedTransaction | null> {
  try {
    const swapResponse = await axios.post(
      `${CONFIG.JUPITER_API_URL}/swap`,
      {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        useTokenLedger: false,
        computeUnitPriceMicroLamports: 1000000, // Priority fee
        dynamicComputeUnitLimit: true,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    const swapTransaction = swapResponse.data.swapTransaction;
    const transactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(transactionBuf);

    return transaction;
  } catch (error) {
    console.error("Error getting Jupiter swap transaction:", error);
    return null;
  }
}

export async function checkPriceImpact(
  quote: JupiterQuote,
  maxImpact: number = 1.0,
): Promise<boolean> {
  return quote.priceImpactPct <= maxImpact;
}

export async function getMultipleQuotes(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
): Promise<JupiterQuote[]> {
  const quotes: JupiterQuote[] = [];

  try {
    const quote = await getJupiterQuote({ inputMint, outputMint, amount });
    if (quote) {
      quotes.push(quote);
    }
  } catch (error) {
    console.error("Error fetching quote:", error);
  }

  return quotes;
}

// Standardized quote format for multi-aggregator routing
export interface JupiterQuoteResult {
  route: any;
  outAmount: number;
  inAmount: number;
  profit: number;
  profitPercent: number;
  priceImpact: number;
  fees: number;
  source: "jupiter";
}

export function convertToStandardQuote(
  quote: JupiterQuote,
  inAmount: number,
): JupiterQuoteResult | null {
  if (!quote) return null;

  const outAmount = quote.outAmount || 0;
  const profit = outAmount - inAmount;
  const profitPercent = inAmount > 0 ? profit / inAmount : 0;

  return {
    route: quote,
    outAmount,
    inAmount,
    profit,
    profitPercent,
    priceImpact: quote.priceImpactPct || 0,
    fees: 0, // Jupiter fees are included in the route
    source: "jupiter",
  };
}
