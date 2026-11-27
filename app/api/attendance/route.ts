import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { recordAttendance } from "@/lib/attendance";

export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const result = await recordAttendance(user.id, uuid(input.event_id), input.qr_token);
    if (!result.created) return json({ success: false, message: "Already attended" }, 409);
    return json({ success: true, message: "Attendance recorded successfully", attendance: result.attendance }, 201);
  } catch (error) { return apiError(error); }
}
