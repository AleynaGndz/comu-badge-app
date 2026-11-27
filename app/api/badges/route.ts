import { apiError, ApiError, json, wallet } from "@/lib/api";
import { supabase } from "@/lib/supabase";

// Publicly verifiable badges issued by this app, not a DAS wallet-asset inventory.
export async function GET(request: Request) {
  try {
    const address = wallet(new URL(request.url).searchParams.get("wallet"));
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError("Invalid offset", 400);
    const { data, error } = await supabase.from("badge_mint_jobs")
      .select("id, title, metadata_uri, confirmed_at, tx_signature, asset_id")
      .eq("wallet_address", address).eq("state", "confirmed")
      .order("confirmed_at", { ascending: false }).order("id").range(offset, offset + 99);
    if (error) throw error;
    return json({ success: true, badges: data.map(item => ({
      id: item.id, title: item.title, image_url: item.metadata_uri,
      claimed_at: item.confirmed_at, tx_signature: item.tx_signature, asset_id: item.asset_id,
    })), next_offset: data.length === 100 ? offset + 100 : null,
    source: "campuspass_issued_badges" });
  } catch (error) { return apiError(error); }
}
