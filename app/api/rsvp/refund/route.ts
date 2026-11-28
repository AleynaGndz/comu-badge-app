import { apiError, ApiError, body, json, requireUser, uuid } from "@/lib/api";
import { processOwnRefund } from "@/lib/deposits";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const payout = await processOwnRefund(user.id, uuid(input.event_id));
    if (!payout) throw new ApiError("Verified paid attendance is required for a refund", 409);
    return json({ success: payout.state === "confirmed", payout }, payout.state === "confirmed" ? 200 : 202);
  } catch (error) { return apiError(error); }
}
