import "server-only";
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import { PublicKey, type Connection } from "@solana/web3.js";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { decodeSignedPayment, depositSigner, devnetConnection, prepareSolTransfer, proposalHasExplicitFees, sponsorDepositPayment } from "@/lib/deposit-chain";

export interface Deposit {
  id: string; user_id: string; event_id: string; wallet_address: string; treasury_address: string;
  lamports: number; state: string; rpc_url: string; payment_signature: string | null;
  signed_transaction: string | null; payment_message: string | null; last_valid_block_height: number | null;
}
export interface SolPayout {
  id: string; event_id: string; user_id: string; wallet_address: string; treasury_address: string;
  lamports: number; state: string; rpc_url: string; tx_signature: string | null;
  signed_transaction: string | null; last_valid_block_height: number | null; kind: string;
}
// Finalized receipts avoid the history-status RPC endpoint, which some providers
// throttle independently. A failed read is uncertainty, never a missing payment.
async function finalizedStatus(connection: Connection, signature: string) {
  const receipt = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!receipt) return null;
  if (!receipt.meta || !Object.prototype.hasOwnProperty.call(receipt.meta, "err")) throw new ApiError("İşlem sonucu henüz doğrulanamadı.", 503);
  return { confirmationStatus: "finalized" as const, err: receipt.meta.err };
}
async function readPayout(id: string): Promise<SolPayout> {
  const { data, error } = await supabase.from("sol_payouts").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
function payoutView(row: SolPayout) {
  return { id: row.id, kind: row.kind, state: row.state, lamports: Number(row.lamports), tx_signature: row.tx_signature };
}
export async function prepareDeposit(userId: string, eventId: string) {
  const signer = depositSigner();
  const connection = await devnetConnection();
  const treasuryBalance = await connection.getBalance(signer.publicKey, "finalized");
  if (treasuryBalance < 10_000_000) {
    throw new ApiError("Fund the separate custody wallet with at least 0.01 Devnet SOL for network fees", 503);
  }
  const { data, error } = await supabase.rpc("create_deposit_intent", {
    p_user_id: userId, p_event_id: eventId, p_treasury: signer.publicKey.toBase58(), p_rpc_url: process.env.SOLANA_RPC_URL,
  });
  if (error) throw error;
  const deposit = data as Deposit;
  if (deposit.state !== "pending") return { deposit: depositView(deposit) };
  if (deposit.treasury_address !== signer.publicKey.toBase58()) throw new ApiError("Custody key changed; preserve the original key", 409);
  const { data: latest, error: latestError } = await supabase.from("deposit_proposals")
    .select("unsigned_transaction,last_valid_block_height").eq("deposit_id", deposit.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  if (latest && proposalHasExplicitFees(latest.unsigned_transaction, deposit.treasury_address) && await connection.getBlockHeight("finalized") < Number(latest.last_valid_block_height) - 10) {
    return { deposit: depositView(deposit), transaction: latest.unsigned_transaction };
  }
  const prepared = await prepareSolTransfer(connection, deposit.wallet_address, deposit.treasury_address,
    Number(deposit.lamports), `CampusPass deposit:${deposit.id}`, deposit.treasury_address);
  const fee = (await connection.getFeeForMessage(prepared.transaction.compileMessage(), "finalized")).value;
  const studentBalance = await connection.getBalance(new PublicKey(deposit.wallet_address), "finalized");
  if (studentBalance < Number(deposit.lamports)) {
    throw new ApiError("The student wallet needs exactly 0.5 Devnet SOL; network fees are sponsored", 402);
  }
  if (fee == null || treasuryBalance < fee) {
    throw new ApiError("Fund the custody wallet for sponsored network fees", 503);
  }
  const encoded = prepared.transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const { error: saveError } = await supabase.from("deposit_proposals").upsert({
    deposit_id: deposit.id, message: prepared.transaction.serializeMessage().toString("base64"),
    unsigned_transaction: encoded, last_valid_block_height: prepared.lastValidBlockHeight,
  }, { onConflict: "deposit_id,message", ignoreDuplicates: true });
  if (saveError) throw saveError;
  return { deposit: depositView(deposit), transaction: encoded };
}
export function depositView(row: Deposit) {
  return { id: row.id, event_id: row.event_id, state: row.state, lamports: Number(row.lamports),
    treasury_address: row.treasury_address, payment_signature: row.payment_signature };
}
export async function submitDeposit(userId: string, depositId: string, encoded: unknown) {
  const { data: row, error: rowError } = await supabase.from("event_deposits").select("*")
    .eq("id", depositId).eq("user_id", userId).maybeSingle();
  if (rowError) throw rowError;
  if (!row) throw new ApiError("Deposit not found", 404);
  const partial = decodeSignedPayment(encoded, row.wallet_address);
  if (row.payment_signature) {
    if (partial.message !== row.payment_message) throw new ApiError("Another payment is bound; reconcile it first", 409);
    return reconcileDeposit(row as Deposit);
  }
  const { data: proposal, error: proposalError } = await supabase.from("deposit_proposals")
    .select("message,last_valid_block_height").eq("deposit_id", row.id).eq("message", partial.message).maybeSingle();
  if (proposalError) throw proposalError;
  if (!proposal) throw new ApiError("Unrecognized payment transaction", 400);
  const signer = depositSigner();
  if (row.treasury_address !== signer.publicKey.toBase58()) throw new ApiError("Original custody key is required", 503);
  const connection = await devnetConnection(row.rpc_url); // Refuse sponsorship outside Devnet before signing.
  if (await connection.getBlockHeight("finalized") > Number(proposal.last_valid_block_height)) {
    throw new ApiError("İmzanın süresi dolmuş. Henüz ödeme gönderilmedi; tekrar deneyin.", 409);
  }
  const payment = sponsorDepositPayment(partial, proposal.message, row.wallet_address, signer);
  const { data, error } = await supabase.rpc("bind_deposit_payment", {
    p_user_id: userId, p_deposit_id: depositId, p_signature: payment.signature,
    p_signed: payment.signed, p_message: payment.message,
  });
  if (error) throw error;
  return reconcileDeposit(data as Deposit);
}
export async function reconcileDeposit(row: Deposit) {
  if (row.state === "confirmed") return { status: 200, deposit: depositView(row) };
  if (!row.payment_signature || !row.signed_transaction) return { status: 200, deposit: depositView(row) };
  if (row.state === "failed") throw new ApiError("Deposit failed on-chain; no registration was granted", 409);
  const connection = await devnetConnection(row.rpc_url);
  let status;
  try { status = await finalizedStatus(connection, row.payment_signature); }
  catch { return { status: 202, deposit: depositView(row) }; }
  if (status?.confirmationStatus === "finalized") {
    if (status.err) {
      const { error } = await supabase.from("event_deposits").update({ state: "failed" }).eq("id", row.id).neq("state", "confirmed");
      if (error) throw error;
      throw new ApiError("Deposit failed on-chain; no registration was granted", 409);
    }
    const { error } = await supabase.rpc("confirm_deposit_payment", { p_deposit_id: row.id, p_signature: row.payment_signature });
    if (error) throw error;
    return { status: 200, deposit: depositView({ ...row, state: "confirmed" }) };
  }
  if (!status) {
    const height = await connection.getBlockHeight("finalized");
    if (height > Number(row.last_valid_block_height)) {
      const { error } = await supabase.from("event_deposits").update({ state: "review_required" }).eq("id", row.id).eq("state", "submitted");
      if (error) throw error;
      throw new ApiError("Ödemenin süresi dolmuş; kayıtlı işlem sonucu yönetici tarafından kontrol edilmeli. Yeni ödeme engellendi.", 409);
    }
    if (row.state === "submitted") {
      try {
        const sent = await connection.sendRawTransaction(Buffer.from(row.signed_transaction, "base64"), { skipPreflight: false, maxRetries: 2 });
        if (sent !== row.payment_signature) throw new ApiError("Unexpected deposit signature", 502);
      } catch (error) { if (error instanceof ApiError && error.status === 502) throw error; /* Keep the signed payment for retries. */ }
    }
  }
  return { status: 202, deposit: depositView(row) };
}

export async function processPayout(row: SolPayout) {
  if (row.state === "confirmed") return payoutView(row);
  if (row.state === "failed") throw new ApiError("Payout has a finalized failure; operator review is required", 409);
  if (row.state === "pending" || row.state === "preparing") {
    const lease = randomUUID();
    const { data: locked, error } = await supabase.from("sol_payouts").update({ state: "preparing", lease_id: lease,
      lease_expires_at: new Date(Date.now() + 60000).toISOString() }).eq("id", row.id)
      .in("state", ["pending", "preparing"]).or(`lease_expires_at.is.null,lease_expires_at.lt.${new Date().toISOString()}`)
      .select("*").maybeSingle();
    if (error) throw error;
    if (!locked) return payoutView(await readPayout(row.id));
    try {
      const signer = depositSigner();
      if (signer.publicKey.toBase58() !== row.treasury_address) throw new ApiError("Original custody key is required", 503);
      const connection = await devnetConnection(row.rpc_url);
      const prepared = await prepareSolTransfer(connection, row.treasury_address, row.wallet_address,
        Number(row.lamports), `CampusPass ${row.kind}:${row.id}`);
      const fee = (await connection.getFeeForMessage(prepared.transaction.compileMessage(), "finalized")).value;
      const balance = await connection.getBalance(signer.publicKey, "finalized");
      if (fee == null || balance < Number(row.lamports) + fee) throw new ApiError("Fund the Devnet custody wallet to cover the payout and network fee", 503);
      prepared.transaction.sign(signer);
      const raw = prepared.transaction.serialize();
      const signature = bs58.encode(prepared.transaction.signature!);
      const { data: saved, error: saveError } = await supabase.from("sol_payouts").update({ state: "prepared",
        signed_transaction: raw.toString("base64"), tx_signature: signature,
        last_valid_block_height: prepared.lastValidBlockHeight, lease_id: null, lease_expires_at: null,
      }).eq("id", row.id).eq("state", "preparing").eq("lease_id", lease).select("*").maybeSingle();
      if (saveError) throw saveError;
      if (!saved) return payoutView(await readPayout(row.id));
      row = saved;
    } catch (error) {
      await supabase.from("sol_payouts").update({ state: "pending", lease_id: null, lease_expires_at: null })
        .eq("id", row.id).eq("state", "preparing").eq("lease_id", lease);
      throw error;
    }
  }
  if (!row.tx_signature || !row.signed_transaction || row.last_valid_block_height == null) throw new ApiError("Incomplete payout record", 409);
  const connection = await devnetConnection(row.rpc_url);
  let status;
  try { status = await finalizedStatus(connection, row.tx_signature); }
  catch { return payoutView(row); }
  if (status?.confirmationStatus === "finalized") {
    const state = status.err ? "failed" : "confirmed";
    const { error } = await supabase.from("sol_payouts").update({ state, confirmed_at: state === "confirmed" ? new Date().toISOString() : null })
      .eq("id", row.id).eq("tx_signature", row.tx_signature).in("state", ["prepared", "submitted", "review_required"]);
    if (error) throw error;
    if (status.err) throw new ApiError("Payout failed on-chain; operator review is required", 409);
    return payoutView(await readPayout(row.id));
  }
  if (!status) {
    if (await connection.getBlockHeight("finalized") > Number(row.last_valid_block_height)) {
      const { error } = await supabase.from("sol_payouts").update({ state: "review_required" })
        .eq("id", row.id).in("state", ["prepared", "submitted"]);
      if (error) throw error;
      throw new ApiError("Payout result is unknown after expiry; a second transfer is blocked", 409);
    }
    if (row.state === "review_required") throw new ApiError("Payout requires operator review", 409);
    try {
      const sent = await connection.sendRawTransaction(Buffer.from(row.signed_transaction, "base64"), { skipPreflight: false, maxRetries: 2 });
      if (sent !== row.tx_signature) throw new ApiError("Unexpected payout signature", 502);
      const { error } = await supabase.from("sol_payouts").update({ state: "submitted" }).eq("id", row.id).eq("state", "prepared");
      if (error) throw error;
    } catch (error) { if (error instanceof ApiError && error.status === 502) throw error; /* Reconcile/resend the same signed bytes. */ }
  }
  return payoutView(await readPayout(row.id));
}
export async function processOwnRefund(userId: string, eventId: string) {
  const { error } = await supabase.rpc("queue_deposit_refund", { p_user_id: userId, p_event_id: eventId });
  if (error) throw error;
  const { data, error: queryError } = await supabase.from("sol_payouts").select("*")
    .eq("user_id", userId).eq("event_id", eventId).eq("kind", "refund").maybeSingle();
  if (queryError) throw queryError;
  if (!data) return null;
  return processPayout(data as SolPayout);
}
