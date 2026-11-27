import { apiError, ApiError, body, json, requireUser, uuid } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { recordAttendance } from "@/lib/attendance";
import { metadataForBadge } from "@/lib/badge-catalog";
import { processMint } from "@/lib/claim";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const eventId = uuid(input.event_id ?? input.eventId);
    if (input.walletAddress !== undefined && input.walletAddress !== user.wallet_address) {
      throw new ApiError("Wallet does not match the authenticated session", 403);
    }
    const { data: event, error: eventError } = await supabase.from("events")
      .select("id, title, badge_key").eq("id", eventId).maybeSingle();
    if (eventError) throw eventError;
    if (!event) throw new ApiError("Event not found", 404);
    if (!event.badge_key) throw new ApiError("Event badge has not been configured", 409);
    metadataForBadge(event.badge_key);

    const { data: existing, error: attendanceError } = await supabase.from("attendance")
      .select("id, mint_status, tx_signature, nft_asset_id").eq("user_id", user.id).eq("event_id", eventId).maybeSingle();
    if (attendanceError) throw attendanceError;
    const attendance = existing ?? (await recordAttendance(user.id, eventId, input.qr_token ?? input.qrToken ?? input.token)).attendance;
    // Assignment cannot change after this attendance exists; re-read after the
    // transactional attendance check to avoid racing an admin badge assignment.
    const { data: currentEvent, error: currentError } = await supabase.from("events")
      .select("title, badge_key").eq("id", eventId).single();
    if (currentError) throw currentError;
    const metadataUri = metadataForBadge(currentEvent.badge_key);
    if (existing && (existing.mint_status !== "pending" || existing.tx_signature || existing.nft_asset_id)) {
      const { data: knownJob, error: knownError } = await supabase.from("badge_mint_jobs")
        .select("*").eq("attendance_id", existing.id).maybeSingle();
      if (knownError) throw knownError;
      if (!knownJob) throw new ApiError("Legacy mint requires operator review; a second mint is blocked", 409);
      const result = await processMint(knownJob, input.retry_failed === true);
      return json(result.data, result.status);
    }
    const { error: insertError } = await supabase.from("badge_mint_jobs").upsert({
      attendance_id: attendance.id, wallet_address: user.wallet_address,
      title: currentEvent.title, metadata_uri: metadataUri,
    }, { onConflict: "attendance_id", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data: job, error: jobError } = await supabase.from("badge_mint_jobs")
      .select("*").eq("attendance_id", attendance.id).single();
    if (jobError) throw jobError;
    const result = await processMint(job, input.retry_failed === true);
    const response = json(result.data, result.status);
    if (result.status === 202) response.headers.set("Retry-After", "3");
    return response;
  } catch (error) { return apiError(error); }
}
