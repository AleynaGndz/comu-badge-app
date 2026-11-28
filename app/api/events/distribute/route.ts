import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { processPayout } from "@/lib/deposits";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireUser("admin");
    const input = await body(request);
    const eventId = uuid(input.event_id);
    const { data: distribution, error } = await supabase.rpc("distribute_no_show_deposits", { p_admin_id: user.id, p_event_id: eventId });
    if (error) throw error;
    const { data: rows, error: queryError } = await supabase.from("sol_payouts").select("*")
      .eq("event_id", eventId).eq("kind", "bonus").neq("state", "confirmed").order("id").limit(10);
    if (queryError) throw queryError;
    const results = [];
    for (const row of rows) {
      try { results.push(await processPayout(row)); }
      catch { results.push({ id: row.id, state: "pending_review", message: "Reconcile this payout; no replacement was sent" }); }
    }
    return json({ success: true, distribution, payouts: results, message: "Repeat to reconcile batches of up to 10 payouts" });
  } catch (error) { return apiError(error); }
}
