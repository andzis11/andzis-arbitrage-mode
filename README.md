# 🚀 Andzis Arbitrage Mode

High-frequency MEV arbitrage bot for Solana DEXs with multi-aggregator routing (Jupiter + Titan), Jito execution, and comprehensive risk management.

---

## ✨ Features

- **Multi-Aggregator Router** - Auto-selects best route from Jupiter & Titan
- **Jito Bundle Execution** - Fast transaction inclusion with tips
- **Real-Time PnL Tracking** - Complete statistics & daily reports
- **Risk Management** - Daily loss limit, auto-pause, balance monitoring
- **Telegram Control** - Full remote control via Telegram bot
- **Backtesting** - Test strategies with historical data
- **Global Failsafe** - RPC health, error rate, and balance monitoring

---

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your RPC, private key, and Telegram token

# 3. Run
npm start
```

---

## ⚙️ Configuration

**`.env`**
```env
RPC_URL=https://your-rpc-endpoint
PRIVATE_KEY=your_base58_private_key
TELEGRAM_TOKEN=your_bot_token
CHAT_ID=your_chat_id
```

**Thresholds** (`src/config.ts`)
```typescript
AUTO_THRESHOLD: 0.01,       // 1% for auto execution
MANUAL_THRESHOLD: 0.003,    // 0.3% for manual signals
COOLDOWN_MS: 2000,          // 2s between trades
MAX_DAILY_LOS: 0.5,         // Max 0.5 SOL daily loss
```

---

## 📱 Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Bot status & config |
| `/pnl` | PnL report |
| `/router` | Multi-aggregator stats |
| `/size [sol]` | Set trade size |
| `/threshold [auto] [manual]` | Set thresholds |
| `/slippage [bps]` | Set slippage |
| `/startbot` | Start trading |
| `/stopbot` | Stop trading |

---

## 📊 Backtesting

```bash
npm run backtest:quick   # 1 day, 0.1 SOL
npm run backtest:week    # 7 days, 0.5 SOL
npm run backtest:month   # 30 days, 1.0 SOL

# Custom parameters
npm run backtest -- --days 7 --auto 0.015 --manual 0.005 --size 0.5
```

---

## 📁 Project Structure

```
src/
├── bot.ts                      # Main entry point
├── config.ts                   # Configuration
├── rpc.ts                      # Solana connection
├── dex/                        # DEX integrations
│   ├── raydiumRealtime.ts      # Raydium pool decoding
│   └── jupiter.ts              # Jupiter API
├── executor/                   # Trade execution
│   ├── executor.ts             # Trade executor
│   ├── jito.ts                 # Jito bundles
│   ├── titan.ts                # Titan aggregator
│   └── router.ts               # Smart router
├── engine/                     # Core logic
│   ├── arbEngine.ts            # Arbitrage detection
│   ├── decision.ts             # Trade decisions
│   ├── risk.ts                 # Risk management
│   ├── pnl.ts                  # PnL tracking
│   ├── failsafe.ts             # Global failsafe
│   └── backtest.ts             # Backtesting engine
├── scanner/                    # Price scanning
│   └── multiPairScanner.ts     # Parallel scanner
└── telegram/                   # Telegram bot
    └── telegram.ts             # Bot commands
```

---

## ⚠️ Requirements

- **RPC**: Fast, paid RPC (Helius, QuickNode, Triton)
- **Balance**: Minimum 0.1 SOL for trading
- **Node.js**: v16 or higher

---

## ⚠️ Disclaimer

This bot is for educational purposes. Trading cryptocurrency involves significant risk. Use only risk capital you can afford to lose. The authors are not responsible for any losses.

**Trade responsibly:**
- Start small (0.1 SOL or less)
- Test extensively before scaling
- Monitor PnL regularly
- Set appropriate risk limits

---

**Version 1.1 - Production Ready**
