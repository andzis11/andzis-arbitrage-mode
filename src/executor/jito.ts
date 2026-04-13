import axios from "axios";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  Connection,
} from "@solana/web3.js";
import { CONFIG } from "../config";

// Jito Bundle API
export interface JitoBundle {
  transactions: string[];
}

// Jito tip account (randomly select from known accounts)
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export function getRandomTipAccount(): PublicKey {
  const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
}

export function createJitoTipTransaction(
  payer: PublicKey,
  tipAmount: number = CONFIG.JITO_TIP_LAMPORTS
): Transaction {
  const tipAccount = getRandomTipAccount();

  const tipInstruction = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount,
    lamports: tipAmount,
  });

  const transaction = new Transaction().add(tipInstruction);

  return transaction;
}

export async function createJitoBundle(
  swapTransaction: VersionedTransaction,
  payer: Keypair,
  connection: Connection,
  tipAmount?: number
): Promise<string[]> {
  const recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;

  // Create tip transaction
  const tipTx = createJitoTipTransaction(
    payer.publicKey,
    tipAmount || CONFIG.JITO_TIP_LAMPORTS
  );
  tipTx.recentBlockhash = recentBlockhash;
  tipTx.feePayer = payer.publicKey;

  // Sign tip transaction
  tipTx.sign(payer);

  // Serialize transactions
  const serializedSwap = Buffer.from(
    swapTransaction.serialize()
  ).toString("base64");
  const serializedTip = Buffer.from(tipTx.serialize()).toString("base64");

  return [serializedTip, serializedSwap];
}

export async function sendToJito(
  bundle: string[]
): Promise<any> {
  try {
    const response = await axios.post(
      CONFIG.JITO_ENDPOINT,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [bundle],
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Jito bundle sent:", response.data);
    return response.data;
  } catch (error: any) {
    console.error("❌ Jito bundle failed:", error.response?.data || error.message);
    throw error;
  }
}

export async function sendTransactionWithJito(
  transaction: VersionedTransaction,
  payer: Keypair,
  connection: Connection,
  tipAmount?: number
): Promise<string> {
  try {
    // Create bundle
    const bundle = await createJitoBundle(
      transaction,
      payer,
      connection,
      tipAmount
    );

    // Send to Jito
    const result = await sendToJito(bundle);

    return result?.result || "";
  } catch (error) {
    console.error("Error sending transaction with Jito:", error);
    throw error;
  }
}

// Check Jito bundle status
export async function checkBundleStatus(
  bundleId: string
): Promise<any> {
  try {
    const response = await axios.post(
      "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
      }
    );

    return response.data;
  } catch (error) {
    console.error("Error checking bundle status:", error);
    return null;
  }
}
