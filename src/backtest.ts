/**
 * Backtest CLI Script
 *
 * Usage:
 *   npm run backtest
 *   npm run backtest -- --days 7 --size 0.5
 *   npm run backtest -- --auto 0.015 --manual 0.005
 */

import { BacktestEngine, BacktestConfig } from "./engine/backtest";
import {
  formatBacktestReport,
  formatBacktestTelegram,
  exportToCSV,
} from "./engine/backtestReport";
import * as fs from "fs";
import * as path from "path";

// Parse command line arguments
function parseArgs(): Partial<BacktestConfig> {
  const args = process.argv.slice(2);
  const config: Partial<BacktestConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--days":
        config.endTime = Date.now();
        config.startTime =
          Date.now() - parseInt(args[++i]) * 24 * 60 * 60 * 1000;
        break;
      case "--size":
        config.tradeSizeSol = parseFloat(args[++i]);
        break;
      case "--auto":
        config.autoThreshold = parseFloat(args[++i]);
        break;
      case "--manual":
        config.manualThreshold = parseFloat(args[++i]);
        break;
      case "--slippage":
        config.slippageBps = parseInt(args[++i]);
        break;
      case "--interval":
        config.intervalMs = parseInt(args[++i]);
        break;
      case "--no-jito":
        config.includeJitoTip = false;
        break;
      case "--jito-tip":
        config.jitoTipLamports = parseInt(args[++i]);
        break;
      case "--output":
        config.outputFile = args[++i];
        break;
    }
  }

  return config;
}

/**
 * Generate simulated historical price data
 * In production, replace this with real data from your RPC or API
 */
function generateHistoricalData(
  startTime: number,
  endTime: number,
  intervalMs: number,
): Array<{ timestamp: number; priceA: number; priceB: number }> {
  console.log("📊 Generating simulated historical data...");

  const data: Array<{ timestamp: number; priceA: number; priceB: number }> = [];
  const duration = endTime - startTime;
  const numPoints = Math.floor(duration / intervalMs);

  // Base price (SOL/USDC example)
  let basePrice = 100;

  for (let i = 0; i < numPoints; i++) {
    const timestamp = startTime + i * intervalMs;

    // Simulate price movement with random walk
    const priceChange = (Math.random() - 0.5) * 0.002; // ±0.1% per interval
    basePrice *= 1 + priceChange;

    // Price A (Raydium)
    const priceA = basePrice;

    // Price B (Jupiter/Other DEX) - slightly different with random spread
    const spread = (Math.random() - 0.5) * 0.01; // ±0.5% spread
    const priceB = priceA * (1 + spread);

    data.push({
      timestamp,
      priceA,
      priceB,
    });
  }

  console.log(`   Generated ${data.length} data points`);
  return data;
}

/**
 * Main backtest function
 */
async function runBacktest() {
  console.log("🚀 ANDZIS ARBITRAGE BACKTEST");
  console.log("═".repeat(60));

  // Parse arguments
  const userConfig = parseArgs();

  // Default configuration
  const config: BacktestConfig = {
    inputMint: "So11111111111111111111111111111111111111112", // SOL
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    tradeSizeSol: userConfig.tradeSizeSol || 0.1,
    slippageBps: userConfig.slippageBps || 100,
    autoThreshold: userConfig.autoThreshold || 0.01,
    manualThreshold: userConfig.manualThreshold || 0.003,
    startTime: userConfig.startTime || Date.now() - 7 * 24 * 60 * 60 * 1000, // Default: 7 days
    endTime: userConfig.endTime || Date.now(),
    intervalMs: userConfig.intervalMs || 2000, // 2 seconds
    useRealisticFees: true,
    includeJitoTip: userConfig.includeJitoTip !== false,
    jitoTipLamports: userConfig.jitoTipLamports || 50000,
  };

  console.log("\n⚙️  Configuration:");
  console.log(`   Trade Size: ${config.tradeSizeSol} SOL`);
  console.log(
    `   Period: ${new Date(config.startTime).toLocaleString()} → ${new Date(config.endTime).toLocaleString()}`,
  );
  console.log(`   Auto Threshold: ${(config.autoThreshold * 100).toFixed(2)}%`);
  console.log(
    `   Manual Threshold: ${(config.manualThreshold * 100).toFixed(2)}%`,
  );
  console.log(`   Slippage: ${(config.slippageBps / 100).toFixed(2)}%`);
  console.log(
    `   Jito Tip: ${config.includeJitoTip ? `${config.jitoTipLamports / 1e9} SOL` : "Disabled"}`,
  );
  console.log("");

  // Generate historical data
  const priceData = generateHistoricalData(
    config.startTime,
    config.endTime,
    config.intervalMs,
  );

  if (priceData.length === 0) {
    console.error("❌ No price data generated!");
    process.exit(1);
  }

  // Run backtest
  const engine = new BacktestEngine(config);
  const result = engine.run(priceData);

  // Display report
  console.log("");
  console.log(formatBacktestReport(result));

  // Save CSV if requested
  const outputFile = config.outputFile;
  if (outputFile) {
    const csv = exportToCSV(result);
    const filePath = path.resolve(outputFile);
    fs.writeFileSync(filePath, csv);
    console.log(`\n💾 CSV exported to: ${filePath}`);
  }

  // Save report to file
  const reportDir = path.join(__dirname, "../backtest-reports");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportFile = path.join(reportDir, `backtest-${timestamp}.txt`);
  fs.writeFileSync(reportFile, formatBacktestReport(result));
  console.log(`\n💾 Report saved to: ${reportFile}`);

  // Save Telegram-formatted report
  const telegramFile = path.join(
    reportDir,
    `backtest-${timestamp}-telegram.txt`,
  );
  fs.writeFileSync(telegramFile, formatBacktestTelegram(result));
  console.log(`💾 Telegram report saved to: ${telegramFile}`);

  // Exit with appropriate code
  if (result.netPnL > 0) {
    console.log("\n✅ Backtest completed - Strategy is profitable!");
    process.exit(0);
  } else {
    console.log(
      "\n⚠️  Backtest completed - Strategy is NOT profitable. Consider adjusting parameters.",
    );
    process.exit(1);
  }
}

// Run backtest
runBacktest().catch((error) => {
  console.error("❌ Backtest failed:", error);
  process.exit(1);
});
