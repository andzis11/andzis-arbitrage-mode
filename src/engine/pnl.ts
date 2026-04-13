import { CONFIG } from "../config";

export interface TradeRecord {
  timestamp: number;
  tokenMint: string;
  buyDex: string;
  sellDex: string;
  inputAmount: number;
  outputAmount: number;
  feesPaid: number;
  profitLoss: number;
  profitPercent: number;
  signature?: string;
  status: "success" | "failed" | "timeout";
}

export interface PnLStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalFees: number;
  avgProfit: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  todayPnL: number;
  todayTrades: number;
  consecutiveLosses: number;
  dailyLossLimitReached: boolean;
  lastTradeTime: number;
}

class PnLTracker {
  private trades: TradeRecord[] = [];
  private dailyResetTimestamp: number = Date.now();

  // Record a completed trade
  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);

    // Reset daily stats at midnight UTC
    const now = Date.now();
    if (now - this.dailyResetTimestamp > 24 * 60 * 60 * 1000) {
      this.resetDaily();
    }
  }

  // Get comprehensive stats
  getStats(): PnLStats {
    const successfulTrades = this.trades.filter(t => t.status === "success");
    const failedTrades = this.trades.filter(t => t.status === "failed");

    const wins = successfulTrades.filter(t => t.profitLoss > 0);
    const losses = successfulTrades.filter(t => t.profitLoss <= 0);

    const totalPnL = successfulTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const totalFees = successfulTrades.reduce((sum, t) => sum + t.feesPaid, 0);

    const todayTrades = this.getTodayTrades();
    const todayPnL = todayTrades.reduce((sum, t) => sum + t.profitLoss, 0);

    // Calculate consecutive losses
    const consecutiveLosses = this.calculateConsecutiveLosses();

    return {
      totalTrades: this.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length + failedTrades.length,
      winRate: successfulTrades.length > 0
        ? (wins.length / successfulTrades.length) * 100
        : 0,
      totalPnL,
      totalFees,
      avgProfit: wins.length > 0
        ? wins.reduce((sum, t) => sum + t.profitLoss, 0) / wins.length
        : 0,
      avgLoss: losses.length > 0
        ? losses.reduce((sum, t) => sum + t.profitLoss, 0) / losses.length
        : 0,
      bestTrade: wins.length > 0
        ? Math.max(...wins.map(t => t.profitLoss))
        : 0,
      worstTrade: losses.length > 0
        ? Math.min(...losses.map(t => t.profitLoss))
        : 0,
      todayPnL,
      todayTrades: todayTrades.length,
      consecutiveLosses,
      dailyLossLimitReached: this.checkDailyLossLimit(todayPnL),
      lastTradeTime: this.trades.length > 0
        ? this.trades[this.trades.length - 1].timestamp
        : 0,
    };
  }

  // Get today's PnL
  getTodayPnL(): number {
    const todayTrades = this.getTodayTrades();
    return todayTrades.reduce((sum, t) => sum + t.profitLoss, 0);
  }

  // Get today's trade count
  getTodayTradeCount(): number {
    return this.getTodayTrades().length;
  }

  // Check if daily loss limit reached
  checkDailyLossLimit(todayPnL?: number): boolean {
    const pnl = todayPnL ?? this.getTodayPnL();
    const dailyLimit = CONFIG.MAX_DAILY_LOS * 1e9; // Convert SOL to lamports
    return pnl < -dailyLimit;
  }

  // Calculate consecutive losses
  calculateConsecutiveLosses(): number {
    let count = 0;
    for (let i = this.trades.length - 1; i >= 0; i--) {
      const trade = this.trades[i];
      if (trade.status === "success" && trade.profitLoss > 0) {
        break;
      }
      if (trade.status === "success" && trade.profitLoss <= 0) {
        count++;
      }
      if (trade.status === "failed") {
        count++;
      }
    }
    return count;
  }

  // Get recent trades
  getRecentTrades(limit: number = 10): TradeRecord[] {
    return this.trades.slice(-limit).reverse();
  }

  // Format PnL report for Telegram
  formatPnLReport(): string {
    const stats = this.getStats();

    return `
📊 <b>PnL Report</b>

💰 Total PnL: <b>${stats.totalPnL.toFixed(6)} SOL</b>
📈 Today PnL: <b>${stats.todayPnL.toFixed(6)} SOL</b>

🔢 Total Trades: ${stats.totalTrades}
📊 Today Trades: ${stats.todayTrades}
✅ Win Rate: <b>${stats.winRate.toFixed(1)}%</b>

🏆 Best Trade: ${stats.bestTrade.toFixed(6)} SOL
💀 Worst Trade: ${stats.worstTrade.toFixed(6)} SOL

📉 Consecutive Losses: ${stats.consecutiveLosses}
💸 Total Fees: ${stats.totalFees.toFixed(6)} SOL

⏱️ Last Trade: ${stats.lastTradeTime > 0
  ? new Date(stats.lastTradeTime).toLocaleString()
  : "Never"}
`;
  }

  // Reset daily tracking
  resetDaily(): void {
    this.dailyResetTimestamp = Date.now();
  }

  // Clear all trades
  clearTrades(): void {
    this.trades = [];
  }

  // Get trades from today
  private getTodayTrades(): TradeRecord[] {
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    return this.trades.filter(t => t.timestamp >= startOfDay);
  }
}

export const pnlTracker = new PnLTracker();
