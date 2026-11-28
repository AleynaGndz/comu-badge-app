import "server-only";
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import { parseLeafFromMintV2Transaction } from "@metaplex-foundation/mpl-bubblegum";
import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";
import { mintRpc, prepareBadgeMint } from "@/lib/mint";

export interface MintJob {
  id: string; attendance_id: string; wallet_address: string; title: string; metadata_uri: string;
  state: "pending" | "preparing" | "prepared" | "submitted" | "confirmed" | "failed" | "review_required";
  lease_id: string | null; lease_expires_at: string | null;
  signed_transaction: string | null; tx_signature: string | null;
  last_valid_block_height: number | null; rpc_url: string | null; tree_address: string | null;
  asset_id: string | null; confirmed_at: string | null;
}
async function readJob(id: string): Promise<MintJob> {
  const { data, error } = await supabase.from("badge_mint_jobs").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}
function result(job: MintJob) {
  const done = job.state === "confirmed";
  return { success: done, processing: !done && job.state !== "failed" && job.state !== "review_required",
    mint_status: job.state, txSignature: job.tx_signature, assetId: job.asset_id };
}

async function finalizedMintStatus(umi: ReturnType<typeof mintRpc>, signature: string) {
  const receipt = await umi.rpc.call<{ meta?: { err: unknown } | null } | null>("getTransaction", [signature,
    { encoding: "json", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (!receipt) return null;
  if (!receipt.meta || !Object.prototype.hasOwnProperty.call(receipt.meta, "err")) throw new ApiError("Mint receipt is incomplete; retry later", 503);
  return { commitment: "finalized" as const, error: receipt.meta.err };
}

export async function processMint(job: MintJob, retryFailed = false) {
  if (job.state === "confirmed") return { status: 200, data: result(job) };
  if (job.state === "failed") {
    if (!retryFailed) throw new ApiError("Mint failed on-chain; retry with retry_failed=true", 409);
    if (!job.tx_signature || !job.rpc_url) throw new ApiError("Failed mint record requires operator review", 409);
    const status = await finalizedMintStatus(mintRpc(process.env.SOLANA_RPC_URL || job.rpc_url), job.tx_signature);
    if (status?.commitment !== "finalized" || !status.error) {
      throw new ApiError("A new mint requires a proven finalized failure", 409);
    }
    const { error } = await supabase.rpc("reset_failed_badge_mint", { p_job_id: job.id, p_signature: job.tx_signature });
    if (error) throw error;
    job = await readJob(job.id);
  }

  if (job.state === "pending" || job.state === "preparing") {
    if (!process.env.SOLANA_RPC_URL || !process.env.MINT_SECRET_KEY || !process.env.MERKLE_TREE_ADDRESS) {
      throw new ApiError("Mint configuration is incomplete", 503);
    }
    const lease = randomUUID();
    const { data: locked, error } = await supabase.from("badge_mint_jobs")
      .update({ state: "preparing", lease_id: lease, lease_expires_at: new Date(Date.now() + 60000).toISOString() })
      .eq("id", job.id).in("state", ["pending", "preparing"])
      .or(`lease_expires_at.is.null,lease_expires_at.lt.${new Date().toISOString()}`)
      .select("*").maybeSingle();
    if (error) throw error;
    if (!locked) return { status: 202, data: result(await readJob(job.id)) };
    try {
      const prepared = await prepareBadgeMint(job.wallet_address, job.title, job.metadata_uri);
      const { data: saved, error: saveError } = await supabase.from("badge_mint_jobs")
        .update({ ...prepared, state: "prepared", lease_id: null, lease_expires_at: null })
        .eq("id", job.id).eq("state", "preparing").eq("lease_id", lease).select("*").maybeSingle();
      if (saveError) throw saveError;
      if (!saved) return { status: 202, data: result(await readJob(job.id)) };
      job = saved;
    } catch (error) {
      // No broadcast has happened. A lost save response cannot reset a prepared job.
      await supabase.from("badge_mint_jobs").update({ state: "pending", lease_id: null, lease_expires_at: null })
        .eq("id", job.id).eq("state", "preparing").eq("lease_id", lease);
      console.error("Mint preparation failed", error);
      throw new ApiError("Mint preparation failed; retry later", 503);
    }
  }

  if (!job.tx_signature || !job.rpc_url || !job.signed_transaction || job.last_valid_block_height == null) {
    throw new ApiError("Mint record requires operator review", 409);
  }
  const umi = mintRpc(process.env.SOLANA_RPC_URL || job.rpc_url);
  const signature = bs58.decode(job.tx_signature);
  try {
    const status = await finalizedMintStatus(umi, job.tx_signature);
    if (status?.commitment === "finalized") {
      if (status.error) {
        const { error } = await supabase.from("badge_mint_jobs").update({ state: "failed" })
          .eq("id", job.id).eq("tx_signature", job.tx_signature).neq("state", "confirmed");
        if (error) throw error;
        throw new ApiError("Mint failed on-chain; retry with retry_failed=true", 409);
      }
      const leaf = await parseLeafFromMintV2Transaction(umi, signature);
      if (leaf.owner !== job.wallet_address) throw new ApiError("Mint owner mismatch; operator review is required", 409);
      const { error } = await supabase.rpc("complete_badge_mint", {
        p_job_id: job.id, p_signature: job.tx_signature, p_asset_id: leaf.id,
      });
      if (error) throw error;
      return { status: 200, data: result(await readJob(job.id)) };
    }
    if (status) return { status: 202, data: result(job) };

    const height = await umi.rpc.call<number>("getBlockHeight", [{ commitment: "finalized" }]);
    if (height > job.last_valid_block_height) {
      // Absence from RPC history is not proof of failure. Never create a fresh
      // transaction here: that could duplicate a successfully minted badge.
      const { error } = await supabase.from("badge_mint_jobs").update({ state: "review_required" })
        .eq("id", job.id).in("state", ["prepared", "submitted", "review_required"]);
      if (error) throw error;
      throw new ApiError("Transaction expired with an unknown result; operator review is required", 409);
    }
    if (job.state === "review_required") throw new ApiError("Mint requires operator review", 409);
    const transaction = umi.transactions.deserialize(Buffer.from(job.signed_transaction, "base64"));
    const sentSignature = await umi.rpc.sendTransaction(transaction, { commitment: "finalized" });
    if (bs58.encode(sentSignature) !== job.tx_signature) throw new ApiError("Unexpected transaction signature", 502);
    const { error } = await supabase.from("badge_mint_jobs").update({ state: "submitted" })
      .eq("id", job.id).eq("state", "prepared");
    if (error) throw error;
    job = await readJob(job.id);
    return { status: job.state === "confirmed" ? 200 : 202, data: result(job) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("Mint confirmation pending", error);
    // Keep the persisted signed transaction after network errors. Retrying sends
    // identical bytes/signature, even across processes or after a restart.
    return { status: 202, data: { ...result(job), processing: true, message: "Confirmation pending; retry this claim" } };
  }
}
