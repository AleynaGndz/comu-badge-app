import { apiError, ApiError, body, json, requireUser, uuid, wallet } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const sponsor = await requireUser("sponsor");
    const input = await body(request);
    const rewardId = uuid(input.reward_id);
    const address = wallet(input.wallet_address);
    const { data: reward, error } = await supabase.from("rewards")
      .select("id, required_badges, active, expires_at").eq("id", rewardId).eq("sponsor_id", sponsor.id).maybeSingle();
    if (error) throw error;
    if (!reward) throw new ApiError("Reward not found or access denied", 404);
    const { count, error: countError } = await supabase.from("badge_mint_jobs")
      .select("id", { count: "exact", head: true }).eq("wallet_address", address).eq("state", "confirmed");
    if (countError) throw countError;
    const { data: student, error: userError } = await supabase.from("users")
      .select("id").eq("wallet_address", address).eq("role", "student").maybeSingle();
    if (userError) throw userError;
    let couponStatus = null;
    if (student) {
      const { data: coupon, error: couponError } = await supabase.from("coupons")
        .select("status").eq("reward_id", rewardId).eq("user_id", student.id).maybeSingle();
      if (couponError) throw couponError;
      couponStatus = coupon?.status ?? null;
    }
    const open = reward.active && (!reward.expires_at || Date.parse(reward.expires_at) > Date.now());
    return json({ success: true, eligible: Boolean(student && open && (count ?? 0) >= reward.required_badges && couponStatus !== "used"),
      badgeCount: count ?? 0, required_badges: reward.required_badges, coupon_status: couponStatus,
      basis: "verified_app_issued_badges" });
  } catch (error) { return apiError(error); }
}
