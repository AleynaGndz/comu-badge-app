import { apiError, ApiError, body, json, requireUser, uuid, wallet } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const sponsor = await requireUser("sponsor");
    const input = await body(request);
    const rewardId = uuid(input.reward_id);
    const address = wallet(input.wallet_address);
    const { data: reward, error } = await supabase.from("rewards")
      .select("id, required_badges, required_badge_key, active, expires_at").eq("id", rewardId).eq("sponsor_id", sponsor.id).maybeSingle();
    if (error) throw error;
    if (!reward) throw new ApiError("Reward not found or access denied", 404);
    const { count, error: countError } = await supabase.from("badge_mint_jobs")
      .select("id", { count: "exact", head: true }).eq("wallet_address", address).eq("state", "confirmed");
    if (countError) throw countError;
    const { data: student, error: userError } = await supabase.from("users")
      .select("id").eq("wallet_address", address).eq("role", "student").maybeSingle();
    if (userError) throw userError;
    let couponStatus = null;
    let spentBadges = 0;
    if (student) {
      const { data: coupons, error: couponError } = await supabase.from("coupons")
        .select("reward_id,status,badge_cost").eq("user_id", student.id);
      if (couponError) throw couponError;
      couponStatus = coupons?.find(c => c.reward_id === rewardId)?.status ?? null;
      spentBadges = (coupons ?? []).reduce((sum, c) => sum + Number(c.badge_cost), 0);
    }
    let hasRequiredBadge = reward.required_badge_key == null;
    if (student && !hasRequiredBadge) {
      const { data: keys, error: keyError } = await supabase.rpc("student_verified_badge_keys", { p_user_id: student.id });
      if (keyError) throw keyError;
      hasRequiredBadge = Array.isArray(keys) && keys.includes(reward.required_badge_key);
    }
    const available = Math.max(0, (count ?? 0) - spentBadges);
    const open = reward.active && (!reward.expires_at || Date.parse(reward.expires_at) > Date.now());
    return json({ success: true, eligible: Boolean(student && open && (couponStatus === "unused" || hasRequiredBadge) && (couponStatus === "unused" || available >= reward.required_badges) && couponStatus !== "used"),
      badgeCount: available, totalBadgeCount: count ?? 0, spentBadges, required_badges: reward.required_badges, coupon_status: couponStatus,
      required_badge_key: reward.required_badge_key ?? null, has_required_badge: hasRequiredBadge,
      basis: "verified_app_issued_badges" });
  } catch (error) { return apiError(error); }
}
