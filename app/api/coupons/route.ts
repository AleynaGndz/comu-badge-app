import { createCouponCode } from "@/lib/coupon-codes";
import { apiError, ApiError, body, json, requireUser, uuid } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const user = await requireUser("student");
    const { data, error } = await supabase.from("coupons")
      .select("id, reward_id, code, status, created_at, used_at, badge_cost").eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    const { data: balance, error: balanceError } = await supabase.rpc("coupon_badge_balance", { p_user_id: user.id });
    if (balanceError) throw balanceError;
    return json({ success: true, coupons: data, balance });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const rewardId = uuid(input.reward_id);
    // Unique index is authoritative. A rare random-code collision gets a new code;
    // existing student/reward coupons are returned by the RPC without duplication.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.rpc("issue_reward_coupon", {
        p_user_id: user.id, p_reward_id: rewardId, p_code: createCouponCode(),
      });
      if (!error) return json({ success: true, coupon: data });
      if (error.code === "PT403" && error.message === "Required verified badge is missing") {
        return json({ success: false, code: "REQUIRED_BADGE_MISSING", message: "Bu ödül için gerekli doğrulanmış rozete sahip değilsiniz." }, 403);
      }
      if (error.code === "PT403" && error.message === "Not enough unspent verified badges") {
        const { data: balance, error: balanceError } = await supabase.rpc("coupon_badge_balance", { p_user_id: user.id });
        if (balanceError) throw balanceError;
        throw new ApiError(`Yetersiz rozet bakiyesi. Harcanabilir bakiyeniz: ${Number(balance?.available ?? 0)} rozet.`, 403);
      }
      if (error.code !== "23505") throw error;
    }
    throw new ApiError("Kupon kodu oluşturulamadı; tekrar deneyin.", 503);
  } catch (error) { return apiError(error); }
}
