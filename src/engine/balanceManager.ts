import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export interface PositionState {
  totalCapitalSol: number;
  allocatedPerTrade: number;
  maxConcurrentTrades: number;
  currentAllocatedSol: number;
  freeCapitalSol: number;
  utilizationPercent: number;
}

export interface BalanceManagerState {
  initialBalance: number;
  currentBalance: number;
  peakBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalFeesPaid: number;
  totalPnL: number;
  dailyPnL: number;
  positionState: PositionState;
}

class BalanceManager {
  private state: BalanceManagerState;
  private dailyResetTimestamp: number = Date.now();

  constructor(initialBalanceSol: number) {
    this.state = {
      initialBalance: initialBalanceSol,
      currentBalance: initialBalanceSol,
      peakBalance: initialBalanceSol,
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalFeesPaid: 0,
      totalPnL: 0,
      dailyPnL: 0,
      positionState: {
        totalCapitalSol: initialBalanceSol,
        allocatedPerTrade: 0.1, // Default 0.1 SOL per trade
        maxConcurrentTrades: 1,
        currentAllocatedSol: 0,
        freeCapitalSol: initialBalanceSol,
        utilizationPercent: 0,
      },
    };
  }

  /**
   * Update balance after trade
   */
  updateBalance(pnL: number, feesPaid: number): void {
    this.state.currentBalance += pnL;
    this.state.totalPnL += pnL;
    this.state.dailyPnL += pnL;
    this.state.totalFeesPaid += feesPaid;

    // Update peak
    if (this.state.currentBalance > this.state.peakBalance) {
      this.state.peakBalance = this.state.currentBalance;
    }

    // Update position state
    this.state.positionState.totalCapitalSol = this.state.currentBalance;
    this.state.positionState.freeCapitalSol =
      this.state.currentBalance - this.state.positionState.currentAllocatedSol;
    this.state.positionState.utilizationPercent =
      (this.state.positionState.currentAllocatedSol /
        this.state.currentBalance) *
      100;
  }

  /**
   * Get optimal trade size based on current balance and risk
   */
  getOptimalTradeSize(riskPercent: number = 0.02): number {
    // Kelly criterion simplified
    const kellySize = this.state.currentBalance * riskPercent * 0.25;
    const maxSize = Math.min(
      kellySize,
      this.state.currentBalance * 0.5 // Max 50% of balance
    );

    return Math.max(maxSize, 0.01); // Min 0.01 SOL
  }

  /**
   * Allocate capital for a trade
   */
  allocateCapital(amountSol: number): boolean {
    if (amountSol > this.state.positionState.freeCapitalSol) {
      return false; // Not enough free capital
    }

    this.state.positionState.currentAllocatedSol += amountSol;
    this.state.positionState.freeCapitalSol -= amountSol;
    this.state.positionState.utilizationPercent =
      (this.state.positionState.currentAllocatedSol /
        this.state.currentBalance) *
      100;

    return true;
  }

  /**
   * Release allocated capital after trade
   */
  releaseCapital(amountSol: number): void {
    this.state.positionState.currentAllocatedSol = Math.max(
      0,
      this.state.positionState.currentAllocatedSol - amountSol
    );
    this.state.positionState.freeCapitalSol =
      this.state.currentBalance - this.state.positionState.currentAllocatedSol;
  }

  /**
   * Check if we have enough balance to continue
   */
  isBalanceHealthy(minBalanceSol: number = 0.05): boolean {
    return this.state.currentBalance >= minBalanceSol;
  }

  /**
   * Get drawdown percentage
   */
  getDrawdownPercent(): number {
    if (this.state.peakBalance === 0) return 0;
    return (
      (this.state.peakBalance - this.state.currentBalance) /
      this.state.peakBalance
    );
  }

  /**
   * Get balance summary
   */
  getSummary(): BalanceManagerState {
    return { ...this.state };
  }

  /**
   * Reset daily PnL
   */
  resetDailyPnL(): void {
    this.state.dailyPnL = 0;
    this.dailyResetTimestamp = Date.now();
  }

  /**
   * Record deposit
   */
  recordDeposit(amountSol: number): void {
    this.state.totalDeposits += amountSol;
    this.state.currentBalance += amountSol;
    this.state.positionState.totalCapitalSol = this.state.currentBalance;
  }

  /**
   * Record withdrawal
   */
  recordWithdrawal(amountSol: number): boolean {
    if (amountSol > this.state.currentBalance) return false;

    this.state.totalWithdrawals += amountSol;
    this.state.currentBalance -= amountSol;
    this.state.positionState.totalCapitalSol = this.state.currentBalance;
    return true;
  }

  /**
   * Format for display
   */
  formatSummary(): string {
    const s = this.state;
    const drawdown = this.getDrawdownPercent();

    return `
💰 <b>Balance Manager</b>

📊 Current: <b>${s.currentBalance.toFixed(4)} SOL</b>
📈 Peak: ${s.peakBalance.toFixed(4)} SOL
💵 PnL: <b>${s.totalPnL >= 0 ? "+" : ""}${s.totalPnL.toFixed(4)} SOL</b>
📉 Drawdown: ${drawdown.toFixed(2)}%

💸 Total Fees: ${s.totalFeesPaid.toFixed(6)} SOL
📊 Daily PnL: ${s.dailyPnL >= 0 ? "+" : ""}${s.dailyPnL.toFixed(4)} SOL

🎯 Capital Utilization:
   Allocated: ${s.positionState.currentAllocatedSol.toFixed(4)} SOL
   Free: ${s.positionState.freeCapitalSol.toFixed(4)} SOL
   Utilization: ${s.positionState.utilizationPercent.toFixed(1)}%
`;
  }
}

export const balanceManager = new BalanceManager(0);

export function initBalanceManager(initialBalanceSol: number): void {
  // @ts-ignore - reinitialize
  balanceManager["state"] = {
    initialBalance: initialBalanceSol,
    currentBalance: initialBalanceSol,
    peakBalance: initialBalanceSol,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalFeesPaid: 0,
    totalPnL: 0,
    dailyPnL: 0,
    positionState: {
      totalCapitalSol: initialBalanceSol,
      allocatedPerTrade: 0.1,
      maxConcurrentTrades: 1,
      currentAllocatedSol: 0,
      freeCapitalSol: initialBalanceSol,
      utilizationPercent: 0,
    },
  };
}

export { BalanceManager };
