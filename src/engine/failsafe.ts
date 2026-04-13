import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CONFIG } from "../config";

export interface FailsafeStatus {
  rpcHealthy: boolean;
  balanceSufficient: boolean;
  errorRateOk: boolean;
  canContinue: boolean;
  issues: string[];
}

class FailsafeSystem {
  private consecutiveErrors: number = 0;
  private errorTimestamps: number[] = [];
  private lastRpcCheck: number = 0;
  private lastBalanceCheck: number = 0;
  private rpcHealthy: boolean = true;
  private botStopped: boolean = false;
  private stopReason: string = "";

  // Check all failsafes
  async checkAll(
    connection: Connection,
    walletPublicKey: PublicKey
  ): Promise<FailsafeStatus> {
    const issues: string[] = [];
    let canContinue = true;

    // Check RPC health (every 30 seconds)
    const now = Date.now();
    if (now - this.lastRpcCheck > 30000) {
      this.rpcHealthy = await this.checkRpcHealth(connection);
      this.lastRpcCheck = now;
    }

    if (!this.rpcHealthy) {
      issues.push("❌ RPC unhealthy");
      canContinue = false;
    }

    // Check balance (every 60 seconds)
    if (now - this.lastBalanceCheck > 60000) {
      const balanceOk = await this.checkBalance(connection, walletPublicKey);
      this.lastBalanceCheck = now;

      if (!balanceOk) {
        issues.push("❌ Balance too low");
        canContinue = false;
      }
    }

    // Check error rate
    const errorRateOk = this.checkErrorRate();
    if (!errorRateOk) {
      issues.push("❌ Error rate too high");
      canContinue = false;
    }

    // Check if bot was manually stopped
    if (this.botStopped) {
      issues.push(`🛑 Bot stopped: ${this.stopReason}`);
      canContinue = false;
    }

    return {
      rpcHealthy: this.rpcHealthy,
      balanceSufficient: issues.filter(i => i.includes("Balance")).length === 0,
      errorRateOk,
      canContinue,
      issues,
    };
  }

  // Check RPC health
  private async checkRpcHealth(connection: Connection): Promise<boolean> {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("RPC timeout")), CONFIG.RPC_TIMEOUT_MS)
      );

      await Promise.race([
        connection.getSlot(),
        timeoutPromise,
      ]);

      this.consecutiveErrors = 0;
      return true;
    } catch (error: any) {
      console.error("❌ RPC health check failed:", error.message);
      this.consecutiveErrors++;
      return false;
    }
  }

  // Check balance
  private async checkBalance(
    connection: Connection,
    walletPublicKey: PublicKey
  ): Promise<boolean> {
    try {
      const balance = await connection.getBalance(walletPublicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;

      if (balanceSol < CONFIG.MIN_BALANCE_SOL) {
        console.error(
          `⚠️ Low balance: ${balanceSol.toFixed(4)} SOL (min: ${CONFIG.MIN_BALANCE_SOL} SOL)`
        );
        return false;
      }

      return true;
    } catch (error: any) {
      console.error("❌ Balance check failed:", error.message);
      return false;
    }
  }

  // Check error rate
  private checkErrorRate(): boolean {
    const now = Date.now();

    // Remove errors older than 1 minute
    this.errorTimestamps = this.errorTimestamps.filter(
      (ts) => now - ts < 60000
    );

    // Check if error rate exceeds limit
    return this.errorTimestamps.length < CONFIG.ERROR_RATE_LIMIT;
  }

  // Record an error
  recordError(): void {
    this.errorTimestamps.push(Date.now());
    this.consecutiveErrors++;

    // Auto-stop if too many consecutive errors
    if (this.consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
      this.stopBot("Too many consecutive errors");
      console.error(
        `🛑 Auto-stopped bot due to ${this.consecutiveErrors} consecutive errors`
      );
    }
  }

  // Record success
  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  // Manually stop bot
  stopBot(reason: string): void {
    this.botStopped = true;
    this.stopReason = reason;
  }

  // Manually start bot
  startBot(): void {
    this.botStopped = false;
    this.stopReason = "";
    this.consecutiveErrors = 0;
    this.errorTimestamps = [];
  }

  // Check if bot is stopped
  isStopped(): boolean {
    return this.botStopped;
  }

  // Get stop reason
  getStopReason(): string {
    return this.stopReason;
  }

  // Reset all
  reset(): void {
    this.consecutiveErrors = 0;
    this.errorTimestamps = [];
    this.lastRpcCheck = 0;
    this.lastBalanceCheck = 0;
    this.rpcHealthy = true;
    this.botStopped = false;
    this.stopReason = "";
  }

  // Get status summary
  getStatusSummary(): string {
    const parts: string[] = [];

    parts.push(`RPC: ${this.rpcHealthy ? "🟢" : "🔴"}`);
    parts.push(`Errors: ${this.consecutiveErrors}/${CONFIG.MAX_CONSECUTIVE_ERRORS}`);
    parts.push(`Recent errors (1m): ${this.errorTimestamps.length}/${CONFIG.ERROR_RATE_LIMIT}`);
    parts.push(`Status: ${this.botStopped ? "🛑 STOPPED" : "🟢 RUNNING"}`);

    if (this.botStopped && this.stopReason) {
      parts.push(`Reason: ${this.stopReason}`);
    }

    return parts.join(" | ");
  }
}

export const failsafe = new FailsafeSystem();
