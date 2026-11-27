import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { depositView, prepareDeposit, reconcileDeposit } from "@/lib/deposits";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const result = await prepareDeposit(user.id, uuid(input.event_id));
    return json({ success: true, ...result });
  } catch (error) { return apiError(error); }
}
export async function GET(request: Request) {
  try {
    const user = await requireUser("student");
    const eventId = uuid(new URL(request.url).searchParams.get("event"));
    const { data, error } = await supabase.from("event_deposits").select("*").eq("user_id", user.id).eq("event_id", eventId).maybeSingle();
    if (error) throw error;
    const { data: payouts, error: payoutError } = await supabase.from("sol_payouts")
      .select("id,kind,state,lamports,tx_signature").eq("user_id", user.id).eq("event_id", eventId);
    if (payoutError) throw payoutError;
    if (!data) return json({ success: true, deposit: null, payouts });
    const result = data.state === "submitted" || data.state === "review_required" ? await reconcileDeposit(data) : { status: 200, deposit: depositView(data) };
    const response = json({ success: result.deposit.state === "confirmed", processing: result.status === 202, deposit: result.deposit, payouts }, result.status);
    if (result.status === 202) response.headers.set("Retry-After", "3");
    return response;
  } catch (error) { return apiError(error); }
}
