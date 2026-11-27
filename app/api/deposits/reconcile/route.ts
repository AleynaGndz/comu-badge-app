import { apiError, ApiError, body, json, requireUser, uuid } from "@/lib/api";
import { requireClubAdmin } from "@/lib/clubs";
import { supabase } from "@/lib/supabase";
import { processPayout, reconcileDeposit } from "@/lib/deposits";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireUser("admin");
    const input = await body(request);
    const eventId = uuid(input.event_id);
    const { data: event, error } = await supabase.from("events").select("club_id").eq("id", eventId).maybeSingle();
    if (error) throw error;
    if (!event) throw new ApiError("Event not found", 404);
    await requireClubAdmin(user.id, event.club_id);
    const { data: deposits, error: depositError } = await supabase.from("event_deposits").select("*")
      .eq("event_id", eventId).in("state", ["submitted", "review_required"]).order("id").limit(10);
    if (depositError) throw depositError;
    const results = [];
    for (const deposit of deposits) {
      try { results.push(await reconcileDeposit(deposit)); }
      catch { results.push({ id: deposit.id, state: "pending_review" }); }
    }
    const { data: payouts, error: payoutError } = await supabase.from("sol_payouts").select("*")
      .eq("event_id", eventId).neq("state", "confirmed").order("id").limit(10);
    if (payoutError) throw payoutError;
    for (const payout of payouts) {
      try { results.push(await processPayout(payout)); }
      catch { results.push({ id: payout.id, state: "pending_review" }); }
    }
    return json({ success: true, results });
  } catch (error) { return apiError(error); }
}
