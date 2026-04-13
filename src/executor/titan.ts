import axios from "axios";
import { PublicKey } from "@solana/web3.js";
import { CONFIG } from "../config";

export interface TitanQuoteResponse {
  route: any;
  outAmount: number;
  inAmount: number;
  priceImpact: number;
  fees: number;
}

export interface TitanQuoteResult {
  route: any;
  outAmount: number;
  inAmount: number;
  profit: number;
  profitPercent: number;
  priceImpact: number;
  fees: number;
  source: "titan";
}

/**
 * Get quote from Titan aggregator
 * Falls back to null if Titan is unavailable
 */
export async function getTitanQuote(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  slippageBps: number = CONFIG.SLIPPAGE_BPS
): Promise<TitanQuoteResult | null> {
  try {
    // Titan API endpoint (may require API key for production)
    const titanApiUrl = "https://api.titan.exchange/v1/quote";

    const response = await axios.post(
      titanApiUrl,
      {
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        amount: amount.toString(),
        slippageBps,
      },
      {
        timeout: 5000, // 5 second timeout
        headers: {
          "Content-Type": "application/json",
          // Add API key if you have one
          // "X-API-Key": process.env.TITAN_API_KEY,
        },
      }
    );

    const data = response.data;

    if (!data || !data.outAmount) {
      console.log("⚠️ Titan returned invalid response");
      return null;
    }

    const outAmount = Number(data.outAmount);
    const profit = outAmount - amount;
    const profitPercent = profit / amount;
    const priceImpact = data.priceImpactPct || 0;
    const fees = data.fees || 0;

    return {
      route: data,
      outAmount,
      inAmount: amount,
      profit,
      profitPercent,
      priceImpact,
      fees,
      source: "titan",
    };
  } catch (error: any) {
    // Titan may be unavailable - this is expected
    console.log("⚠️ Titan unavailable, will fallback to Jupiter");
    return null;
  }
}

/**
 * Get swap transaction from Titan
 */
export async function getTitanSwapTransaction(
  quoteResponse: any,
  userPublicKey: string
): Promise<any | null> {
  try {
    const titanSwapUrl = "https://api.titan.exchange/v1/swap";

    const response = await axios.post(
      titanSwapUrl,
      {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
      },
      {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          // "X-API-Key": process.env.TITAN_API_KEY,
        },
      }
    );

    return response.data;
  } catch (error: any) {
    console.error("❌ Titan swap transaction failed:", error.message);
    return null;
  }
}
