export const CONFIG = {
  AUTO_THRESHOLD: 0.01,
  MANUAL_THRESHOLD: 0.003,
  COOLDOWN_MS: 2000,

  JITO_ENDPOINT: "https://mainnet.block-engine.jito.wtf/api/v1/transactions",

  JITO_TIP_LAMPORTS: 50000,

  // Slippage basis points (100 = 1%)
  SLIPPAGE_BPS: 100,

  // Max retries for transactions
  MAX_RETRIES: 2,

  // Raydium program ID
  RAYDIUM_PROGRAM_ID: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",

  // Jupiter API URL
  JUPITER_API_URL: "https://quote-api.jup.ag/v6",

  // Risk Management
  MAX_DAILY_LOS: 0.5, // Max daily loss in SOL
  MAX_TRADE_SIZE_SOL: 1, // Max SOL per trade
  MIN_BALANCE_SOL: 0.05, // Minimum balance before stopping

  // Failsafe
  MAX_CONSECUTIVE_ERRORS: 10,
  RPC_TIMEOUT_MS: 10000,
  ERROR_RATE_LIMIT: 5, // Errors per minute before pause

  // Latency
  CACHE_PRICE_MS: 500, // Cache price for 500ms
  MIN_LOG_INTERVAL_MS: 5000, // Minimum log interval

  // Dynamic trade size
  DEFAULT_TRADE_SIZE_SOL: 0.1,

  // Trading pairs (multi-pair parallel)
  TRADING_PAIRS: [
    {
      name: "SOL/USDC",
      input: "So11111111111111111111111111111111111111112",
      output: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      minVolume: 100000,
      enabled: true,
    },
    {
      name: "SOL/USDT",
      input: "So11111111111111111111111111111111111111112",
      output: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      minVolume: 50000,
      enabled: true,
    },
  ],

  // Multi-hop settings
  ENABLE_MULTI_HOP: true,
  MAX_HOPS: 3,
  MIN_MULTI_HOP_PROFIT_BPS: 10, // 0.1%

  // Fast mode (lower latency, skip some checks)
  FAST_MODE: false,
};

// Token constants
export const TOKENS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3y6B9V5gE6x6L8g8r8r8r8r8r8",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
};
