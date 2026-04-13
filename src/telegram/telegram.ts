import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { CONFIG } from "../config";
import { pnlTracker } from "../engine/pnl";
import { ArbOpportunity } from "../engine/arbEngine";
import { formatRouterStats, resetRouterStats } from "../executor/router";
import { balanceManager } from "../engine/balanceManager";

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: false });

const chatId = process.env.CHAT_ID!;

let pending: ArbOpportunity | null = null;
let botInitialized = false;
let botRunning = true;

// Dynamic configuration (can be changed via Telegram)
let dynamicConfig = {
  tradeSizeSol: CONFIG.DEFAULT_TRADE_SIZE_SOL,
  autoThreshold: CONFIG.AUTO_THRESHOLD,
  manualThreshold: CONFIG.MANUAL_THRESHOLD,
  slippageBps: CONFIG.SLIPPAGE_BPS,
  cooldownMs: CONFIG.COOLDOWN_MS,
  forceManual: false,
  fastMode: CONFIG.FAST_MODE,
};

export function sendSignal(trade: ArbOpportunity): void {
  if (!botRunning) return;

  pending = trade;

  const message = `
🔥 <b>Arbitrage Opportunity Detected!</b>

💰 Profit: <b>${(trade.profitPercent * 100).toFixed(3)}%</b>
📊 Buy: ${trade.buyPrice} (${trade.buyDex})
📈 Sell: ${trade.sellPrice} (${trade.sellDex})
💵 Token: ${trade.tokenMint.slice(0, 8)}...
⏰ Time: ${new Date(trade.timestamp).toLocaleTimeString()}

<b>Reply within 5 seconds to execute.</b>
`;

  bot
    .sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Execute", callback_data: "execute_trade" },
            { text: "❌ Skip", callback_data: "skip_trade" },
          ],
        ],
      },
    })
    .catch((err) => console.error("Telegram send error:", err));

  // Auto-clear after 5 seconds
  setTimeout(() => {
    pending = null;
  }, 5000);
}

export function init(
  executeFn: (trade: ArbOpportunity) => Promise<void>,
  configRef: typeof dynamicConfig,
): void {
  if (botInitialized) return;
  botInitialized = true;

  // Command handlers
  bot.onText(/\/start/, () => {
    const message = `
🤖 <b>Andzis Arbitrage Bot</b>

Bot is currently: ${botRunning ? "🟢 RUNNING" : "🔴 STOPPED"}

Use /help to see available commands.
`;
    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  });

  bot.onText(/\/help/, () => {
    const message = `
<b>📖 Bot Commands:</b>

<b>📊 Monitoring:</b>
/status - Bot status & config
/pnl - PnL report
/router - Multi-aggregator stats
/balance - Capital & position management
/trades - Recent trades

<b>⚙️ Configuration:</b>
/size [sol] - Set trade size (e.g., /size 0.5)
/threshold [auto] [manual] - Set thresholds
/slippage [bps] - Set slippage (e.g., /slippage 100)
/cooldown [ms] - Set cooldown (e.g., /cooldown 2000)
/manual - Toggle manual/auto mode

<b>🎮 Control:</b>
/startbot - Start trading
/stopbot - Stop trading
/fast - ⚡ Fast mode (lower latency)
/safe - 🛡️ Safe mode (full validation)
/reset - Reset daily PnL
/resetrouter - Reset router stats

<b>⚠️ Examples:</b>
/size 0.5 → Trade 0.5 SOL
/threshold 0.015 0.005 → Auto 1.5%, Manual 0.5%
/fast → Enable fast mode
`;
    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  });

  bot.onText(/\/status/, () => {
    const stats = pnlTracker.getStats();

    const message = `
<b>📊 Bot Status</b>

🟢 Running: ${botRunning}
🔧 Mode: ${configRef.forceManual ? "MANUAL" : "AUTO"}

<b>Current Config:</b>
💵 Trade Size: ${configRef.tradeSizeSol} SOL
⚡ Auto Threshold: ${(configRef.autoThreshold * 100).toFixed(2)}%
📩 Manual Threshold: ${(configRef.manualThreshold * 100).toFixed(2)}%
📊 Slippage: ${(configRef.slippageBps / 100).toFixed(2)}%
⏱️ Cooldown: ${configRef.cooldownMs}ms

<b>Stats:</b>
🔢 Total Trades: ${stats.totalTrades}
📈 Today: ${stats.todayTrades} trades
💰 Today PnL: ${stats.todayPnL.toFixed(6)} SOL
✅ Win Rate: ${stats.winRate.toFixed(1)}%
📉 Consecutive Losses: ${stats.consecutiveLosses}
`;
    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  });

  bot.onText(/\/pnl/, () => {
    const report = pnlTracker.formatPnLReport();
    bot.sendMessage(chatId, report, { parse_mode: "HTML" });
  });

  bot.onText(/\/trades/, () => {
    const recentTrades = pnlTracker.getRecentTrades(5);

    if (recentTrades.length === 0) {
      bot.sendMessage(chatId, "📭 No trades yet.");
      return;
    }

    let message = "<b>📜 Recent Trades:</b>\n\n";
    recentTrades.forEach((trade, i) => {
      const emoji =
        trade.status === "success"
          ? trade.profitLoss > 0
            ? "✅"
            : "❌"
          : "💀";

      message += `${emoji} <b>Trade ${i + 1}</b>
  ${trade.buyDex} → ${trade.sellDex}
  P/L: ${trade.profitLoss.toFixed(6)} SOL (${(trade.profitPercent * 100).toFixed(3)}%)
  ${trade.signature ? `Sig: ${trade.signature.slice(0, 12)}...` : ""}

`;
    });

    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
  });

  bot.onText(/\/size\s+([\d.]+)/, (msg, match) => {
    const newSize = parseFloat(match![1]);

    if (newSize <= 0 || newSize > CONFIG.MAX_TRADE_SIZE_SOL) {
      bot.sendMessage(
        chatId,
        `❌ Invalid size. Must be between 0 and ${CONFIG.MAX_TRADE_SIZE_SOL} SOL`,
        { parse_mode: "HTML" },
      );
      return;
    }

    configRef.tradeSizeSol = newSize;
    bot.sendMessage(chatId, `✅ Trade size updated: <b>${newSize} SOL</b>`, {
      parse_mode: "HTML",
    });
  });

  bot.onText(/\/threshold\s+([\d.]+)\s+([\d.]+)/, (msg, match) => {
    const newAuto = parseFloat(match![1]);
    const newManual = parseFloat(match![2]);

    if (newAuto <= 0 || newManual <= 0 || newManual >= newAuto) {
      bot.sendMessage(chatId, `❌ Invalid thresholds. Auto must be > Manual`, {
        parse_mode: "HTML",
      });
      return;
    }

    configRef.autoThreshold = newAuto;
    configRef.manualThreshold = newManual;
    bot.sendMessage(
      chatId,
      `✅ Thresholds updated:\nAuto: <b>${(newAuto * 100).toFixed(2)}%</b>\nManual: <b>${(newManual * 100).toFixed(2)}%</b>`,
      { parse_mode: "HTML" },
    );
  });

  bot.onText(/\/slippage\s+(\d+)/, (msg, match) => {
    const newSlippage = parseInt(match![1]);

    if (newSlippage < 10 || newSlippage > 500) {
      bot.sendMessage(
        chatId,
        `❌ Invalid slippage. Must be between 10 and 500 bps`,
        { parse_mode: "HTML" },
      );
      return;
    }

    configRef.slippageBps = newSlippage;
    bot.sendMessage(
      chatId,
      `✅ Slippage updated: <b>${(newSlippage / 100).toFixed(2)}%</b> (${newSlippage} bps)`,
      { parse_mode: "HTML" },
    );
  });

  bot.onText(/\/cooldown\s+(\d+)/, (msg, match) => {
    const newCooldown = parseInt(match![1]);

    if (newCooldown < 500 || newCooldown > 30000) {
      bot.sendMessage(
        chatId,
        `❌ Invalid cooldown. Must be between 500 and 30000 ms`,
        { parse_mode: "HTML" },
      );
      return;
    }

    configRef.cooldownMs = newCooldown;
    bot.sendMessage(chatId, `✅ Cooldown updated: <b>${newCooldown}ms</b>`, {
      parse_mode: "HTML",
    });
  });

  bot.onText(/\/manual/, () => {
    configRef.forceManual = !configRef.forceManual;
    bot.sendMessage(
      chatId,
      `✅ Mode updated: <b>${configRef.forceManual ? "MANUAL" : "AUTO"}</b>`,
      { parse_mode: "HTML" },
    );
  });

  bot.onText(/\/startbot/, () => {
    botRunning = true;
    bot.sendMessage(chatId, `🟢 Bot <b>STARTED</b>`, { parse_mode: "HTML" });
  });

  bot.onText(/\/stopbot/, () => {
    botRunning = false;
    bot.sendMessage(chatId, `🔴 Bot <b>STOPPED</b>`, { parse_mode: "HTML" });
  });

  bot.onText(/\/reset/, () => {
    pnlTracker.clearTrades();
    bot.sendMessage(chatId, `✅ PnL history cleared`, { parse_mode: "HTML" });
  });

  bot.onText(/\/router/, () => {
    const stats = formatRouterStats();
    bot.sendMessage(chatId, stats, { parse_mode: "HTML" });
  });

  bot.onText(/\/resetrouter/, () => {
    resetRouterStats();
    bot.sendMessage(chatId, `✅ Router statistics cleared`, {
      parse_mode: "HTML",
    });
  });

  // Fast mode - lower latency, skip manual approval
  bot.onText(/\/fast/, () => {
    configRef.fastMode = true;
    bot.sendMessage(
      chatId,
      `⚡ <b>FAST MODE ON</b>\nLower latency, auto-execute profitable trades`,
      {
        parse_mode: "HTML",
      },
    );
  });

  // Safe mode - more checks, higher thresholds
  bot.onText(/\/safe/, () => {
    configRef.fastMode = false;
    bot.sendMessage(
      chatId,
      `🛡️ <b>SAFE MODE ON</b>\nFull validation, manual approval for medium profits`,
      {
        parse_mode: "HTML",
      },
    );
  });

  // Balance check
  bot.onText(/\/balance/, () => {
    const summary = balanceManager.formatSummary();
    bot.sendMessage(chatId, summary, { parse_mode: "HTML" });
  });

  // Callback query handler
  bot.on("callback_query", async (q) => {
    try {
      if (q.data === "execute_trade" && pending) {
        await bot.answerCallbackQuery(q.id, { text: "Executing trade..." });
        await executeFn(pending);
        pending = null;

        await bot.sendMessage(chatId, "✅ Trade executed successfully!", {
          parse_mode: "HTML",
        });
      } else if (q.data === "skip_trade") {
        await bot.answerCallbackQuery(q.id, { text: "Trade skipped" });
        pending = null;

        await bot.sendMessage(chatId, "❌ Trade skipped", {
          parse_mode: "HTML",
        });
      } else {
        await bot.answerCallbackQuery(q.id);
      }
    } catch (error: any) {
      console.error("Telegram callback error:", error.message);
    }
  });

  console.log("🤖 Telegram bot initialized");
}

export function sendNotification(message: string): void {
  if (!botRunning) return;

  bot
    .sendMessage(chatId, message, { parse_mode: "HTML" })
    .catch((err) => console.error("Telegram notification error:", err));
}

export function getPendingTrade(): ArbOpportunity | null {
  return pending;
}

export function isBotRunning(): boolean {
  return botRunning;
}

export function setBotRunning(running: boolean): void {
  botRunning = running;
}

export function getDynamicConfig(): typeof dynamicConfig {
  return { ...dynamicConfig };
}

export { dynamicConfig };
