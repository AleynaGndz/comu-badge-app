import { apiError, ApiError, body, json, requireUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const sponsor = await requireUser("sponsor");
    const input = await body(request);
    if (typeof input.code !== "string" || !/^[a-f0-9]{48}$/.test(input.code)) {
      throw new ApiError("Invalid coupon code", 400);
    }
    const { data, error } = await supabase.rpc("redeem_reward_coupon", {
      p_sponsor_id: sponsor.id, p_code: input.code,
    });
    if (error) throw error;
    return json({ success: true, coupon: data });
  } catch (error) { return apiError(error); }
}
