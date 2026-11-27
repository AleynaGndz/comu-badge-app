import "server-only";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { ApiError } from "@/lib/api";

export const DEPOSIT_LAMPORTS = 500_000_000;
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export function depositSigner() {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.DEPOSIT_SECRET_KEY || "null"); }
  catch { throw new ApiError("DEPOSIT_SECRET_KEY has an invalid format", 503); }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(n => Number.isInteger(n) && n>=0 && n<=255)) {
    throw new ApiError("DEPOSIT_SECRET_KEY must be configured with a separate 64-byte Devnet key", 503);
  }
  const signer = Keypair.fromSecretKey(Uint8Array.from(parsed));
  if (process.env.MINT_SECRET_KEY && process.env.MINT_SECRET_KEY.replace(/\s/g, "") === JSON.stringify(parsed)) {
    throw new ApiError("Deposit custody must use a separate wallet", 503);
  }
  return signer;
}
export async function devnetConnection(rpcUrl = process.env.SOLANA_RPC_URL) {
  if (!rpcUrl) throw new ApiError("SOLANA_RPC_URL is missing", 503);
  const connection = new Connection(rpcUrl, { commitment: "finalized", confirmTransactionInitialTimeout: 15000 });
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new ApiError("Deposits are enabled on Solana Devnet only", 503);
  return connection;
}
export async function prepareSolTransfer(connection: Connection, from: string, to: string, lamports: number, reference: string) {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new ApiError("Invalid transfer amount", 500);
  const latest = await connection.getLatestBlockhash("finalized");
  const transaction = new Transaction({ feePayer: new PublicKey(from), ...latest }).add(
    SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }),
    new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(reference, "utf8") }),
  );
  return { transaction, lastValidBlockHeight: latest.lastValidBlockHeight };
}
export function decodeSignedPayment(encoded: unknown) {
  if (typeof encoded !== "string" || encoded.length > 2400) throw new ApiError("Invalid signed transaction", 400);
  try {
    const transaction = Transaction.from(Buffer.from(encoded, "base64"));
    if (!transaction.verifySignatures() || !transaction.signature) throw new Error();
    return { transaction, signature: bs58.encode(transaction.signature),
      message: transaction.serializeMessage().toString("base64"),
      signed: transaction.serialize().toString("base64") };
  } catch { throw new ApiError("Invalid transaction signature", 400); }
}
