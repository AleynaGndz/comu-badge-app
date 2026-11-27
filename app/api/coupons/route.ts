import { randomBytes } from "node:crypto";
import { apiError, body, json, requireUser, uuid } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const user = await requireUser("student");
    const { data, error } = await supabase.from("coupons")
      .select("id, reward_id, code, status, created_at, used_at").eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return json({ success: true, coupons: data });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const rewardId = uuid(input.reward_id);
    const { data, error } = await supabase.rpc("issue_reward_coupon", {
      p_user_id: user.id, p_reward_id: rewardId, p_code: randomBytes(24).toString("hex"),
    });
    if (error) throw error;
    return json({ success: true, coupon: data });
  } catch (error) { return apiError(error); }
}
