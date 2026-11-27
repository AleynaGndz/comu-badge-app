import { processOwnRefund } from "@/lib/deposits";
import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { recordAttendance } from "@/lib/attendance";

export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const result = await recordAttendance(user.id, uuid(input.event_id), input.qr_token);
    // Queueing is transactional in record_attendance; submitting a refund must
    // not invalidate an otherwise successful attendance record.
    let refund: unknown = null;
    try { refund = await processOwnRefund(user.id, result.attendance.event_id); }
    catch { refund = { state: "pending", message: "Use /api/rsvp/refund to reconcile the refund" }; }
    if (!result.created) return json({ success: false, message: "Already attended" }, 409);
    return json({ success: true, message: "Attendance recorded successfully", attendance: result.attendance, refund }, 201);
  } catch (error) { return apiError(error); }
}
