import { CONFIG } from "../config";
import { pnlTracker } from "./pnl";

export interface RiskParams {
  maxTradeSize: number;
  maxSlippage: number;
  maxPriceImpact: number;
  minLiquidity: number;
  maxConsecutiveLosses: number;
  maxDailyLoss: number;
}

export const DEFAULT_RISK: RiskParams = {
  maxTradeSize: CONFIG.MAX_TRADE_SIZE_SOL,
  maxSlippage: 0.01, // 1%
  maxPriceImpact: 0.5, // 0.5%
  minLiquidity: 10000,
  maxConsecutiveLosses: 5,
  maxDailyLoss: CONFIG.MAX_DAILY_LOS,
};

export interface ProfitCalculation {
  inputAmount: number;
  expectedOutput: number;
  actualOutput: number;
  feesPaid: number;
  slippageCost: number;
  netProfit: number;
  netProfitPercent: number;
}

// Real profit validation with fees and slippage
export function calculateRealProfit(
  inputAmount: number,
  expectedOutput: number,
  actualOutput: number,
  feesPaid: number,
  slippageBps: number = 100,
): ProfitCalculation {
  const slippageCost = expectedOutput * (slippageBps / 10000);
  const grossProfit = actualOutput - inputAmount;
  const netProfit = grossProfit - feesPaid - slippageCost;
  const netProfitPercent = netProfit / inputAmount;

  return {
    inputAmount,
    expectedOutput,
    actualOutput,
    feesPaid,
    slippageCost,
    netProfit,
    netProfitPercent,
  };
}

export function validateTrade(
  profitPercent: number,
  slippage: number = 0,
  priceImpact: number = 0,
  liquidity: number = 0,
  tradeSize: number = 0,
): boolean {
  // Must be profitable after fees
  if (profitPercent <= 0) return false;

  // Check slippage
  if (slippage > DEFAULT_RISK.maxSlippage) return false;

  // Check price impact
  if (priceImpact > DEFAULT_RISK.maxPriceImpact) return false;

  // Check liquidity
  if (liquidity > 0 && liquidity < DEFAULT_RISK.minLiquidity) return false;

  // Check trade size
  if (tradeSize > DEFAULT_RISK.maxTradeSize) return false;

  return true;
}

export function safe(profitPercent: number): boolean {
  return profitPercent > 0.002; // At least 0.2% profit
}

export function calculatePositionSize(
  profitPercent: number,
  balance: number,
  riskPerTrade: number = 0.02, // 2% risk per trade
): number {
  // Kelly criterion simplified
  const kellyFraction = profitPercent / riskPerTrade;
  const positionSize = balance * kellyFraction * 0.25; // Quarter Kelly

  // Cap at max trade size
  return Math.min(positionSize, DEFAULT_RISK.maxTradeSize);
}

export function checkRiskLimits(
  consecutiveLosses: number,
  dailyLoss: number,
  maxDailyLoss?: number,
): boolean {
  const limit = maxDailyLoss ?? DEFAULT_RISK.maxDailyLoss;

  if (consecutiveLosses >= DEFAULT_RISK.maxConsecutiveLosses) return false;
  if (dailyLoss < -limit) return false;

  return true;
}

// Check if we should stop trading due to losses
export function shouldStopTrading(): boolean {
  const stats = pnlTracker.getStats();

  // Daily loss limit reached
  if (stats.dailyLossLimitReached) {
    console.error("🛑 Daily loss limit reached! Stopping trades.");
    return true;
  }

  // Too many consecutive losses
  if (stats.consecutiveLosses >= DEFAULT_RISK.maxConsecutiveLosses) {
    console.error("🛑 Too many consecutive losses! Pausing trading.");
    return true;
  }

  return false;
}
