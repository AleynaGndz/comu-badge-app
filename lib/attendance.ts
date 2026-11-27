import "server-only";
import { supabase } from "@/lib/supabase";
import { ApiError } from "@/lib/api";

export async function recordAttendance(userId: string, eventId: string, token: unknown) {
  if (typeof token !== "string" || !token || token.length > 128) throw new ApiError("QR token is required", 400);
  const { data, error } = await supabase.rpc("record_attendance", {
    p_user_id: userId, p_event_id: eventId, p_qr_token: token,
  });
  if (error) throw error;
  return data as { created: boolean; attendance: { id: string; event_id: string; mint_status: string } };
}
