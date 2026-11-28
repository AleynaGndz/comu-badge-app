import "server-only";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
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
type RpcClient = { connection: Connection; verifiedAt: number; checking?: Promise<void> };
const shared = globalThis as typeof globalThis & { campusDepositRpcClients?: Map<string, RpcClient> };
const clients = shared.campusDepositRpcClients ??= new Map<string, RpcClient>();
const guardedMethods = new Set(["getGenesisHash", "getBalance", "getBlockHeight", "getLatestBlockhash", "getFeeForMessage", "getTransaction", "sendRawTransaction"]);
function guardedConnection(rpcUrl: string) {
  const connection = new Connection(rpcUrl, { commitment: "finalized", confirmTransactionInitialTimeout: 15000,
    disableRetryOnRateLimit: true });
  let blockedUntil = 0;
  return new Proxy(connection, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    if (!guardedMethods.has(String(key))) return value.bind(target);
    return async (...args: unknown[]) => {
      if (Date.now() < blockedUntil) throw new ApiError("Solana Devnet servisi yoğun; birkaç saniye sonra tekrar deneyin.", 503, Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)));
      try { return await value.apply(target, args); }
      catch (error) {
        if (error instanceof ApiError) throw error;
        if (/429|rate.?limit/i.test(String((error as { message?: unknown })?.message ?? ""))) blockedUntil = Date.now() + 5000;
        // Never expose credential-bearing RPC URLs or raw provider errors.
        throw new ApiError("Solana Devnet servisi şu an yoğun. 5 saniye bekleyip tekrar deneyin; işlem kaydınız korunuyor.", 503, 5);
      }
    };
  } });
}
export async function devnetConnection(rpcUrl = process.env.SOLANA_RPC_URL) {
  if (!rpcUrl) throw new ApiError("SOLANA_RPC_URL is missing", 503);
  let client = clients.get(rpcUrl);
  if (!client) {
    client = { connection: guardedConnection(rpcUrl), verifiedAt: 0 };
    clients.set(rpcUrl, client);
  }
  // One keep-alive client per endpoint, including across Next route bundles/HMR.
  // Coalesce network checks and revalidate at least once per minute.
  if (Date.now() - client.verifiedAt >= 60000) {
    const current = client;
    if (!current.checking) current.checking = (async () => {
      if (await current.connection.getGenesisHash() !== DEVNET_GENESIS) throw new ApiError("Deposits are enabled on Solana Devnet only", 503);
      current.verifiedAt = Date.now();
    })();
    try { await current.checking; } finally { current.checking = undefined; }
  }
  return client.connection;
}
export async function prepareSolTransfer(connection: Connection, from: string, to: string, lamports: number, reference: string, feePayer = from) {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new ApiError("Invalid transfer amount", 500);
  const latest = await connection.getLatestBlockhash("finalized");
  const transaction = new Transaction({ feePayer: new PublicKey(feePayer), ...latest }).add(
    // Explicit fees keep Phantom from adding instructions after proposal storage.
    // 100k CU covers a native transfer plus memo; priority fee is 100 lamports.
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports }),
    new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(reference, "utf8") }),
  );
  return { transaction, lastValidBlockHeight: latest.lastValidBlockHeight };
}
export function decodeSignedPayment(encoded: unknown, studentWallet?: string) {
  if (typeof encoded !== "string" || encoded.length > 2400) throw new ApiError("Invalid signed transaction", 400);
  try {
    const transaction = Transaction.from(Buffer.from(encoded, "base64"));
    if (!transaction.verifySignatures(!studentWallet)) throw new Error();
    if (studentWallet && !transaction.signatures.find(s => s.publicKey.toBase58() === studentWallet)?.signature) throw new Error();
    if (!studentWallet && !transaction.signature) throw new Error();
    return { transaction, signature: transaction.signature ? bs58.encode(transaction.signature) : null,
      message: transaction.serializeMessage().toString("base64"),
      signed: transaction.serialize({ requireAllSignatures: !studentWallet }).toString("base64") };
  } catch { throw new ApiError("Invalid transaction signature", 400); }
}

export function proposalHasExplicitFees(encoded: string, feePayer?: string) {
  const transaction = Transaction.from(Buffer.from(encoded, "base64"));
  return (!feePayer || (transaction.feePayer?.toBase58() === feePayer && transaction.compileMessage().header.numRequiredSignatures === 2))
    && transaction.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId));
}

// The server only co-signs an immutable, owner-bound proposal it created itself.
// No sponsor signature is returned to the browser, even on a submission failure.
export function sponsorDepositPayment(payment: ReturnType<typeof decodeSignedPayment>, expectedMessage: string,
  studentWallet: string, signer: Keypair) {
  const transaction = payment.transaction;
  if (payment.message !== expectedMessage || transaction.feePayer?.toBase58() !== signer.publicKey.toBase58()
    || studentWallet === signer.publicKey.toBase58() || transaction.compileMessage().header.numRequiredSignatures !== 2
    || !transaction.signatures.find(s => s.publicKey.toBase58() === studentWallet)?.signature
    || !transaction.verifySignatures(false)) {
    throw new ApiError("Payment does not match the sponsored deposit proposal", 400);
  }
  transaction.partialSign(signer);
  if (!transaction.verifySignatures() || !transaction.signature) throw new ApiError("Incomplete deposit signatures", 400);
  return { signature: bs58.encode(transaction.signature), message: payment.message, signed: transaction.serialize().toString("base64") };
}
