import { CONFIG } from "../config";
import { ArbOpportunity } from "./arbEngine";
import { pnlTracker } from "./pnl";
import { shouldStopTrading } from "./risk";

export type TradeAction = "auto" | "manual" | "skip";

interface TradeState {
  lastTradeTime: number;
  consecutiveErrors: number;
  lastErrorTime: number;
}

const state: TradeState = {
  lastTradeTime: 0,
  consecutiveErrors: 0,
  lastErrorTime: 0,
};

export function decide(
  arb: ArbOpportunity | null,
  forceManual: boolean = false,
): TradeAction {
  if (!arb) return "skip";

  // Check if we should stop trading due to risk limits
  if (shouldStopTrading()) {
    return "skip";
  }

  const now = Date.now();

  // Check cooldown
  if (now - state.lastTradeTime < CONFIG.COOLDOWN_MS) {
    return "skip";
  }

  // Check error rate limit
  if (state.consecutiveErrors >= CONFIG.MAX_CONSECUTIVE_ERRORS) {
    console.error(
      `🛑 Too many consecutive errors (${state.consecutiveErrors}). Pausing...`,
    );
    return "skip";
  }

  // Force manual mode for review
  if (forceManual) {
    if (arb.profitPercent > CONFIG.MANUAL_THRESHOLD) {
      return "manual";
    }
    return "skip";
  }

  // Auto mode: execute if profit exceeds threshold
  if (arb.profitPercent > CONFIG.AUTO_THRESHOLD) {
    state.lastTradeTime = now;
    return "auto";
  }

  // Manual review for medium profit
  if (arb.profitPercent > CONFIG.MANUAL_THRESHOLD) {
    return "manual";
  }

  return "skip";
}

export function getTradeState(): TradeState {
  return { ...state };
}

export function recordTradeSuccess(): void {
  state.consecutiveErrors = 0;
}

export function recordTradeError(): void {
  state.consecutiveErrors++;
  state.lastErrorTime = Date.now();

  // Reset error count after 5 minutes
  setTimeout(
    () => {
      if (Date.now() - state.lastErrorTime > 5 * 60 * 1000) {
        state.consecutiveErrors = Math.max(0, state.consecutiveErrors - 1);
      }
    },
    5 * 60 * 1000,
  );
}

export function updateLastTradeTime(): void {
  state.lastTradeTime = Date.now();
}

export function getConsecutiveErrors(): number {
  return state.consecutiveErrors;
}

export function resetErrorCount(): void {
  state.consecutiveErrors = 0;
}
