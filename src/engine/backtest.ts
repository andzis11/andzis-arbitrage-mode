import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CONFIG } from "../config";

export interface BacktestConfig {
  // Token pair to test
  inputMint: string;
  outputMint: string;

  // Trade parameters
  tradeSizeSol: number;
  slippageBps: number;
  autoThreshold: number;
  manualThreshold: number;

  // Time range
  startTime: number; // Unix timestamp
  endTime: number; // Unix timestamp

  // Simulation settings
  intervalMs: number; // How often to check (ms)
  useRealisticFees: boolean;
  includeJitoTip: boolean;
  jitoTipLamports: number;

  // Output
  outputFile?: string;
}

export interface BacktestTrade {
  timestamp: number;
  inputAmount: number;
  expectedOutput: number;
  actualOutput: number;
  feesPaid: number;
  jitoTip: number;
  slippageCost: number;
  netProfit: number;
  netProfitPercent: number;
  status: "success" | "failed" | "skipped";
  reason?: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  skippedTrades: number;
  winRate: number;

  // PnL metrics
  totalInput: number;
  totalOutput: number;
  totalFees: number;
  totalJitoTips: number;
  totalSlippageCost: number;
  netPnL: number;
  netPnLPercent: number;

  // Trade metrics
  avgProfit: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  avgTradeDuration: number;

  // Risk metrics
  maxDrawdown: number;
  sharpeRatio: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  profitFactor: number;

  // Time metrics
  startTime: number;
  endTime: number;
  totalDuration: number;
  tradesPerHour: number;

  // Generated at
  generatedAt: number;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private trades: BacktestTrade[] = [];
  private balance: number;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.balance = config.tradeSizeSol * LAMPORTS_PER_SOL;
  }

  /**
   * Run backtest with price data
   */
  run(
    priceData: Array<{
      timestamp: number;
      priceA: number;
      priceB: number;
    }>,
  ): BacktestResult {
    console.log(`🔍 Running backtest...`);
    console.log(
      `   Period: ${new Date(this.config.startTime).toLocaleString()} → ${new Date(this.config.endTime).toLocaleString()}`,
    );
    console.log(`   Data points: ${priceData.length}`);
    console.log(`   Trade size: ${this.config.tradeSizeSol} SOL`);
    console.log("");

    let peakBalance = this.balance;
    let maxDrawdown = 0;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    for (const data of priceData) {
      const trade = this.simulateTrade(data, peakBalance);
      this.trades.push(trade);

      // Update balance tracking
      if (trade.status === "success") {
        this.balance += trade.netProfit;

        if (this.balance > peakBalance) {
          peakBalance = this.balance;
        }

        const drawdown = (peakBalance - this.balance) / peakBalance;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }

        if (trade.netProfit <= 0) {
          consecutiveLosses++;
          if (consecutiveLosses > maxConsecutiveLosses) {
            maxConsecutiveLosses = consecutiveLosses;
          }
        } else {
          consecutiveLosses = 0;
        }
      }
    }

    return this.generateResult(maxDrawdown, maxConsecutiveLosses);
  }

  /**
   * Simulate a single trade
   */
  private simulateTrade(
    data: { timestamp: number; priceA: number; priceB: number },
    peakBalance: number,
  ): BacktestTrade {
    const inputAmount = this.config.tradeSizeSol * LAMPORTS_PER_SOL;

    // Calculate arbitrage opportunity
    const priceDiff = Math.abs(data.priceB - data.priceA);
    const profitPercent = priceDiff / Math.min(data.priceA, data.priceB);

    // Skip if below threshold
    if (profitPercent < this.config.manualThreshold) {
      return {
        timestamp: data.timestamp,
        inputAmount,
        expectedOutput: 0,
        actualOutput: 0,
        feesPaid: 0,
        jitoTip: 0,
        slippageCost: 0,
        netProfit: 0,
        netProfitPercent: 0,
        status: "skipped",
        reason: `Below threshold (${(profitPercent * 100).toFixed(3)}% < ${(this.config.manualThreshold * 100).toFixed(3)}%)`,
      };
    }

    // Calculate expected output
    const expectedOutput = inputAmount * (1 + profitPercent);

    // Calculate costs
    const networkFee = 5000; // ~0.000005 SOL
    const jitoTip = this.config.includeJitoTip
      ? this.config.jitoTipLamports
      : 0;
    const slippageBps = this.config.slippageBps / 10000;
    const slippageCost = expectedOutput * slippageBps;
    const totalFees = networkFee + jitoTip;

    // Realistic simulation: add some randomness
    const randomness = 1 + (Math.random() - 0.5) * 0.002; // ±0.1% variance
    const actualOutput = expectedOutput * randomness;

    // Calculate net profit
    const netProfit = actualOutput - inputAmount - totalFees - slippageCost;
    const netProfitPercent = netProfit / inputAmount;

    // Check if profitable after costs
    if (netProfit <= 0 && this.config.useRealisticFees) {
      return {
        timestamp: data.timestamp,
        inputAmount,
        expectedOutput,
        actualOutput,
        feesPaid: totalFees,
        jitoTip,
        slippageCost,
        netProfit,
        netProfitPercent,
        status: "failed",
        reason: "Not profitable after fees",
      };
    }

    return {
      timestamp: data.timestamp,
      inputAmount,
      expectedOutput,
      actualOutput,
      feesPaid: totalFees,
      jitoTip,
      slippageCost,
      netProfit,
      netProfitPercent,
      status: "success",
    };
  }

  /**
   * Generate backtest result
   */
  private generateResult(
    maxDrawdown: number,
    maxConsecutiveLosses: number,
  ): BacktestResult {
    const successfulTrades = this.trades.filter((t) => t.status === "success");
    const failedTrades = this.trades.filter((t) => t.status === "failed");
    const skippedTrades = this.trades.filter((t) => t.status === "skipped");

    const winningTrades = successfulTrades.filter((t) => t.netProfit > 0);
    const losingTrades = successfulTrades.filter((t) => t.netProfit <= 0);

    const totalInput = this.trades.reduce((sum, t) => sum + t.inputAmount, 0);
    const totalOutput = this.trades.reduce((sum, t) => sum + t.actualOutput, 0);
    const totalFees = this.trades.reduce((sum, t) => sum + t.feesPaid, 0);
    const totalJitoTips = this.trades.reduce((sum, t) => sum + t.jitoTip, 0);
    const totalSlippageCost = this.trades.reduce(
      (sum, t) => sum + t.slippageCost,
      0,
    );
    const netPnL = this.trades.reduce((sum, t) => sum + t.netProfit, 0);
    const netPnLPercent = totalInput > 0 ? netPnL / totalInput : 0;

    const avgProfit =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + t.netProfit, 0) /
          winningTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + t.netProfit, 0) /
          losingTrades.length
        : 0;

    const bestTrade =
      winningTrades.length > 0
        ? Math.max(...winningTrades.map((t) => t.netProfit))
        : 0;

    const worstTrade =
      losingTrades.length > 0
        ? Math.min(...losingTrades.map((t) => t.netProfit))
        : 0;

    // Calculate Sharpe ratio (simplified)
    const returns = successfulTrades.map((t) => t.netProfitPercent);
    const avgReturn =
      returns.length > 0
        ? returns.reduce((a, b) => a + b, 0) / returns.length
        : 0;
    const stdDev =
      returns.length > 1
        ? Math.sqrt(
            returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
              (returns.length - 1),
          )
        : 0;
    const sharpeRatio =
      stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252 * 24) : 0; // Annualized

    // Profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.netProfit, 0);
    const grossLoss = Math.abs(
      losingTrades.reduce((sum, t) => sum + t.netProfit, 0),
    );
    const profitFactor =
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const totalDuration = this.config.endTime - this.config.startTime;
    const tradesPerHour =
      successfulTrades.length > 0
        ? (successfulTrades.length / totalDuration) * 3600000
        : 0;

    return {
      config: this.config,
      trades: this.trades,
      totalTrades: this.trades.length,
      successfulTrades: successfulTrades.length,
      failedTrades: failedTrades.length,
      skippedTrades: skippedTrades.length,
      winRate:
        successfulTrades.length > 0
          ? (winningTrades.length / successfulTrades.length) * 100
          : 0,

      totalInput,
      totalOutput,
      totalFees,
      totalJitoTips,
      totalSlippageCost,
      netPnL,
      netPnLPercent,

      avgProfit,
      avgLoss,
      bestTrade,
      worstTrade,
      avgTradeDuration: 0,

      maxDrawdown,
      sharpeRatio,
      consecutiveLosses: 0,
      maxConsecutiveLosses,
      profitFactor,

      startTime: this.config.startTime,
      endTime: this.config.endTime,
      totalDuration,
      tradesPerHour,

      generatedAt: Date.now(),
    };
  }
}
