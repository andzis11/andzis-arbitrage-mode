import { BacktestResult } from "./backtest";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Format backtest result for console output
 */
export function formatBacktestReport(result: BacktestResult): string {
  const lines: string[] = [];

  lines.push("═".repeat(70));
  lines.push("📊 BACKTEST REPORT");
  lines.push("═".repeat(70));
  lines.push("");

  // Configuration
  lines.push("⚙️  CONFIGURATION");
  lines.push("─".repeat(70));
  lines.push(`  Pair: ${result.config.inputMint.slice(0, 8)}... → ${result.config.outputMint.slice(0, 8)}...`);
  lines.push(`  Period: ${new Date(result.startTime).toLocaleString()} → ${new Date(result.endTime).toLocaleString()}`);
  lines.push(`  Duration: ${formatDuration(result.totalDuration)}`);
  lines.push(`  Trade Size: ${result.config.tradeSizeSol} SOL`);
  lines.push(`  Slippage: ${(result.config.slippageBps / 100).toFixed(2)}%`);
  lines.push(`  Auto Threshold: ${(result.config.autoThreshold * 100).toFixed(2)}%`);
  lines.push(`  Manual Threshold: ${(result.config.manualThreshold * 100).toFixed(2)}%`);
  lines.push(`  Jito Tip: ${result.config.includeJitoTip ? `${result.config.jitoTipLamports / 1e9} SOL` : "Disabled"}`);
  lines.push(`  Realistic Fees: ${result.config.useRealisticFees ? "Yes" : "No"}`);
  lines.push("");

  // Performance Summary
  lines.push("💰 PERFORMANCE SUMMARY");
  lines.push("─".repeat(70));
  lines.push(`  Net PnL: ${formatSol(result.netPnL)} SOL (${(result.netPnLPercent * 100).toFixed(3)}%)`);
  lines.push(`  Total Input: ${formatSol(result.totalInput)} SOL`);
  lines.push(`  Total Output: ${formatSol(result.totalOutput)} SOL`);
  lines.push(`  Total Fees: ${formatSol(result.totalFees)} SOL`);
  lines.push(`  Total Jito Tips: ${formatSol(result.totalJitoTips)} SOL`);
  lines.push(`  Total Slippage Cost: ${formatSol(result.totalSlippageCost)} SOL`);
  lines.push("");

  // Trade Statistics
  lines.push("📈 TRADE STATISTICS");
  lines.push("─".repeat(70));
  lines.push(`  Total Signals: ${result.totalTrades}`);
  lines.push(`  Successful: ${result.successfulTrades} (${((result.successfulTrades / result.totalTrades) * 100).toFixed(1)}%)`);
  lines.push(`  Failed: ${result.failedTrades} (${((result.failedTrades / result.totalTrades) * 100).toFixed(1)}%)`);
  lines.push(`  Skipped: ${result.skippedTrades} (${((result.skippedTrades / result.totalTrades) * 100).toFixed(1)}%)`);
  lines.push(`  Win Rate: ${result.winRate.toFixed(2)}%`);
  lines.push(`  Trades/Hour: ${result.tradesPerHour.toFixed(2)}`);
  lines.push("");

  // Profit/Loss Details
  lines.push("💵 PROFIT/LOSS DETAILS");
  lines.push("─".repeat(70));
  lines.push(`  Best Trade: ${formatSol(result.bestTrade)} SOL`);
  lines.push(`  Worst Trade: ${formatSol(result.worstTrade)} SOL`);
  lines.push(`  Avg Profit: ${formatSol(result.avgProfit)} SOL`);
  lines.push(`  Avg Loss: ${formatSol(result.avgLoss)} SOL`);
  lines.push(`  Profit Factor: ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`);
  lines.push("");

  // Risk Metrics
  lines.push("🛡️  RISK METRICS");
  lines.push("─".repeat(70));
  lines.push(`  Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`);
  lines.push(`  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
  lines.push(`  Max Consecutive Losses: ${result.maxConsecutiveLosses}`);
  lines.push("");

  // Verdict
  lines.push("🎯 VERDICT");
  lines.push("─".repeat(70));
  const verdict = generateVerdict(result);
  lines.push(`  ${verdict}`);
  lines.push("");
  lines.push("═".repeat(70));

  return lines.join("\n");
}

/**
 * Format backtest result as HTML for Telegram
 */
export function formatBacktestTelegram(result: BacktestResult): string {
  const pnlEmoji = result.netPnL >= 0 ? "✅" : "❌";
  const winRateEmoji = result.winRate >= 50 ? "🟢" : "🔴";

  return `
📊 <b>BACKTEST RESULTS</b>

${pnlEmoji} <b>Net PnL:</b> <b>${formatSol(result.netPnL)} SOL</b> (${(result.netPnLPercent * 100).toFixed(3)}%)

📈 <b>Statistics:</b>
${winRateEmoji} Win Rate: ${result.winRate.toFixed(2)}%
🔢 Total Signals: ${result.totalTrades}
✅ Successful: ${result.successfulTrades}
❌ Failed: ${result.failedTrades}
⏭️ Skipped: ${result.skippedTrades}

💰 <b>Trade Details:</b>
🏆 Best: ${formatSol(result.bestTrade)} SOL
💀 Worst: ${formatSol(result.worstTrade)} SOL
📊 Avg Profit: ${formatSol(result.avgProfit)} SOL
📉 Avg Loss: ${formatSol(result.avgLoss)} SOL

🛡️ <b>Risk Metrics:</b>
📉 Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%
📊 Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}
⚠️ Max Consecutive Losses: ${result.maxConsecutiveLosses}

⏱️ <b>Period:</b> ${formatDuration(result.totalDuration)}
`;
}

/**
 * Export backtest result as CSV
 */
export function exportToCSV(result: BacktestResult): string {
  const headers = "Timestamp,Input,Expected Output,Actual Output,Fees,Jito Tip,Slippage,Net Profit,Net %,Status,Reason\n";

  const rows = result.trades.map((trade) => {
    return [
      trade.timestamp,
      trade.inputAmount,
      trade.expectedOutput,
      trade.actualOutput,
      trade.feesPaid,
      trade.jitoTip,
      trade.slippageCost,
      trade.netProfit,
      (trade.netProfitPercent * 100).toFixed(4),
      trade.status,
      trade.reason || "",
    ].join(",");
  }).join("\n");

  return headers + rows;
}

/**
 * Generate verdict based on backtest results
 */
function generateVerdict(result: BacktestResult): string {
  const parts: string[] = [];

  // Overall profitability
  if (result.netPnL > 0) {
    parts.push(`✅ Strategy is profitable: +${formatSol(result.netPnL)} SOL`);
  } else {
    parts.push(`❌ Strategy is not profitable: ${formatSol(result.netPnL)} SOL`);
  }

  // Win rate assessment
  if (result.winRate >= 60) {
    parts.push(`🟢 Excellent win rate: ${result.winRate.toFixed(1)}%`);
  } else if (result.winRate >= 50) {
    parts.push(`🟡 Good win rate: ${result.winRate.toFixed(1)}%`);
  } else if (result.winRate >= 40) {
    parts.push(`🟠 Low win rate: ${result.winRate.toFixed(1)}% - Consider adjusting thresholds`);
  } else {
    parts.push(`🔴 Very low win rate: ${result.winRate.toFixed(1)}% - Strategy needs optimization`);
  }

  // Risk assessment
  if (result.maxDrawdown > 0.1) {
    parts.push(`⚠️ High drawdown: ${(result.maxDrawdown * 100).toFixed(1)}% - Consider reducing trade size`);
  }

  // Sharpe ratio
  if (result.sharpeRatio > 1.5) {
    parts.push(`🟢 Excellent risk-adjusted returns (Sharpe: ${result.sharpeRatio.toFixed(2)})`);
  } else if (result.sharpeRatio > 1.0) {
    parts.push(`🟡 Good risk-adjusted returns (Sharpe: ${result.sharpeRatio.toFixed(2)})`);
  } else if (result.sharpeRatio > 0) {
    parts.push(`🟠 Moderate risk-adjusted returns (Sharpe: ${result.sharpeRatio.toFixed(2)})`);
  } else {
    parts.push(`🔴 Negative Sharpe ratio: ${result.sharpeRatio.toFixed(2)} - Strategy not viable`);
  }

  // Recommendations
  if (result.netPnL > 0 && result.winRate >= 50 && result.sharpeRatio > 1) {
    parts.push("");
    parts.push("💡 RECOMMENDATION: Strategy looks good for live trading!");
  } else if (result.netPnL < 0) {
    parts.push("");
    parts.push("💡 RECOMMENDATION: Increase thresholds or reduce trade size to improve profitability.");
  }

  return parts.join("\n  ");
}

/**
 * Format SOL amount for display
 */
function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6);
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
