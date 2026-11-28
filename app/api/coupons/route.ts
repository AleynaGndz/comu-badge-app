import { randomBytes } from "node:crypto";
import { ApiError, apiError, body, json, requireUser, uuid } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const user = await requireUser("student");
    const { data, error } = await supabase
      .from("coupons")
      .select("id, reward_id, code, status, created_at, used_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return json({ success: true, coupons: data });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("student");
    const input = await body(request);
    const rewardId = uuid(input.reward_id);

    const [
      { data: targetReward, error: rewardErr },
      { data: activeRewards, error: activeErr },
      { data: existingCoupons, error: couponErr },
      { count: totalBadges, error: badgeErr },
    ] = await Promise.all([
      supabase.from("rewards").select("id, required_badges").eq("id", rewardId).maybeSingle(),
      supabase.from("rewards").select("id, required_badges").eq("active", true),
      supabase.from("coupons").select("reward_id").eq("user_id", user.id),
      supabase.from("attendances").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);

    if (rewardErr) throw rewardErr;
    if (activeErr) throw activeErr;
    if (couponErr) throw couponErr;
    if (badgeErr) throw badgeErr;
    if (!targetReward) throw new ApiError("Kampanya bulunamadı.", 404);

    const alreadyIssued = (existingCoupons || []).some((c) => c.reward_id === rewardId);
    if (!alreadyIssued) {
      const rewardCostMap = new Map(
        (activeRewards || []).map((r) => [r.id, Number(r.required_badges) || 0])
      );

      const spentBadges = (existingCoupons || []).reduce((sum, item) => {
        return sum + (rewardCostMap.get(item.reward_id) ?? 0);
      }, 0);

      const availableBadges = Math.max(0, Number(totalBadges ?? 0) - spentBadges);
      const requiredBadges = Number(targetReward.required_badges) || 0;

      if (availableBadges < requiredBadges) {
        throw new ApiError(
          `Yetersiz rozet bakiyesi. Harcanabilir bakiyeniz: ${availableBadges} rozet, gereken: ${requiredBadges} rozet.`,
          400
        );
      }
    }

    const { data, error } = await supabase.rpc("issue_reward_coupon", {
      p_user_id: user.id,
      p_reward_id: rewardId,
      p_code: randomBytes(24).toString("hex"),
    });
    if (error) throw error;
    return json({ success: true, coupon: data });
  } catch (error) {
    return apiError(error);
  }
}