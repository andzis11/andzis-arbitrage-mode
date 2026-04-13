import { Connection, PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import BN from "bn.js";

export interface PoolState {
  poolId: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  token0Reserves: BN;
  token1Reserves: BN;
  price0In1: number;
  price1In0: number;
}

// Raydium AMM program ID
const RAYDIUM_PROGRAM = new PublicKey(
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
);

// Common pool addresses (update with actual pools you want to monitor)
export const WATCHED_POOLS: {
  poolId: string;
  token0: string;
  token1: string;
}[] = [
  // Example: SOL/USDC Raydium pool
  {
    poolId: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    token0: "So11111111111111111111111111111111111111112",
    token1: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  // Add more pools here
];

const AMM_LAYOUT = {
  ammId: 0,
  status: 8,
  nonce: 9,
  orderNum: 10,
  depth: 11,
  coinDecimals: 12,
  pcDecimals: 13,
  state: 14,
  resetFlag: 15,
  minSize: 16,
  volMaxCutRatio: 24,
  amountWaveRatio: 32,
  coinLotSize: 40,
  pcLotSize: 48,
  minPriceMultiplier: 56,
  maxPriceMultiplier: 64,
  systemDecimalsValue: 72,
  minSeparateNumerator: 73,
  minSeparateDenominator: 81,
  tradeFeeNumerator: 89,
  tradeFeeDenominator: 97,
  pnlNumerator: 105,
  pnlDenominator: 113,
  swapFeeNumerator: 121,
  swapFeeDenominator: 129,
  needTakePnlCoin: 137,
  needTakePnlPc: 145,
  totalPnlPc: 153,
  totalPnlCoin: 161,
  poolOpenTime: 169,
  punPcAmount: 177,
  punCoinAmount: 185,
  lastOrderTime: 193,
  ownerPcAmount: 201,
  ownerCoinAmount: 209,
  coinVault: 217,
  pcVault: 249,
  coinVaultMint: 281,
  pcVaultMint: 313,
  targetOrders: 345,
  withdrawQueue: 425,
  openOrders: 457,
  marketId: 521,
  marketProgramId: 553,
};

async function fetchPoolReserves(
  poolId: PublicKey
): Promise<{ coinReserves: BN; pcReserves: BN } | null> {
  try {
    const accountInfo = await connection.getAccountInfo(poolId);
    if (!accountInfo || accountInfo.data.length < 752) {
      return null;
    }

    // Parse the AMM state data
    const coinReserves = new BN(
      accountInfo.data.slice(153, 161),
      "le"
    );
    const pcReserves = new BN(
      accountInfo.data.slice(161, 169),
      "le"
    );

    return { coinReserves, pcReserves };
  } catch (error) {
    console.error(`Error fetching pool ${poolId.toBase58()}:`, error);
    return null;
  }
}

export async function getPoolState(poolId: PublicKey): Promise<PoolState | null> {
  try {
    const reserves = await fetchPoolReserves(poolId);
    if (!reserves) return null;

    const { coinReserves, pcReserves } = reserves;

    // Calculate prices
    const priceCoinInPc = pcReserves.toNumber() / coinReserves.toNumber();
    const pricePcInCoin = coinReserves.toNumber() / pcReserves.toNumber();

    return {
      poolId,
      token0Mint: PublicKey.default,
      token1Mint: PublicKey.default,
      token0Reserves: coinReserves,
      token1Reserves: pcReserves,
      price0In1: priceCoinInPc,
      price1In0: pricePcInCoin,
    };
  } catch (error) {
    console.error("Error getting pool state:", error);
    return null;
  }
}

export async function getAllPoolPrices(): Promise<PoolState[]> {
  const pools: PoolState[] = [];

  for (const poolConfig of WATCHED_POOLS) {
    const poolId = new PublicKey(poolConfig.poolId);
    const poolState = await getPoolState(poolId);
    if (poolState) {
      poolState.token0Mint = new PublicKey(poolConfig.token0);
      poolState.token1Mint = new PublicKey(poolConfig.token1);
      pools.push(poolState);
    }
  }

  return pools;
}

// WebSocket subscription for real-time updates
let subscriptions: number[] = [];

export function subscribeToPoolUpdates(
  poolId: PublicKey,
  callback: (poolState: PoolState) => void
): number {
  const subId = connection.onAccountChange(
    poolId,
    async (accountInfo) => {
      if (accountInfo.data.length >= 752) {
        const poolState = await getPoolState(poolId);
        if (poolState) {
          callback(poolState);
        }
      }
    },
    "confirmed"
  );

  subscriptions.push(subId);
  return subId;
}

export function unsubscribeAll(): void {
  subscriptions.forEach((subId) => {
    connection.removeAccountChangeListener(subId);
  });
  subscriptions = [];
}
