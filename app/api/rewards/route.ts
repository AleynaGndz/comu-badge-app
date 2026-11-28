import { apiError, ApiError, body, json, requireUser, uuid } from "@/lib/api";
import { metadataForBadge } from "@/lib/badge-catalog";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    let query = supabase.from("rewards").select("id, sponsor_id, title, description, required_badges, required_badge_key, active, expires_at");
    if (new URL(request.url).searchParams.get("mine") === "true") {
      query = query.eq("sponsor_id", (await requireUser("sponsor")).id);
    } else {
      query = query.eq("active", true).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    }
    const { data, error } = await query.order("title");
    if (error) throw error;
    if (new URL(request.url).searchParams.get("eligibility") === "true") {
      const student = await requireUser("student");
      const { data: keys, error: keyError } = await supabase.rpc("student_verified_badge_keys", { p_user_id: student.id });
      if (keyError) throw keyError;
      const owned = new Set<string>(keys ?? []);
      return json({ success: true, rewards: (data ?? []).map(reward => ({ ...reward,
        has_required_badge: reward.required_badge_key == null || owned.has(reward.required_badge_key),
      })) });
    }
    return json({ success: true, rewards: data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const sponsor = await requireUser("sponsor");
    const input = await body(request);
    if (typeof input.title !== "string" || input.title.trim().length < 3 || input.title.trim().length > 150 ||
      (input.description != null && (typeof input.description !== "string" || input.description.length > 2000)) ||
      !Number.isInteger(input.required_badges) || Number(input.required_badges) < 1 || Number(input.required_badges) > 10000) {
      throw new ApiError("Invalid reward details", 400);
    }
    const requiredBadgeKey = input.required_badge_key ?? null;
    if (requiredBadgeKey !== null) metadataForBadge(requiredBadgeKey);
    let expiresAt: string | null = null;
    if (input.expires_at != null) {
      if (typeof input.expires_at !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(input.expires_at) ||
          !Number.isFinite(Date.parse(input.expires_at)) || Date.parse(input.expires_at) <= Date.now()) {
        throw new ApiError("Invalid reward expiry", 400);
      }
      expiresAt = new Date(input.expires_at).toISOString();
    }
    const { data, error } = await supabase.from("rewards").insert({ sponsor_id: sponsor.id,
      title: input.title.trim(), description: input.description ?? "", required_badges: input.required_badges,
      expires_at: expiresAt, active: true, required_badge_key: requiredBadgeKey,
    }).select("id, title, description, required_badges, required_badge_key, expires_at, active").single();
    if (error) throw error;
    return json({ success: true, reward: data }, 201);
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const sponsor = await requireUser("sponsor");
    const input = await body(request);
    const id = uuid(input.reward_id);
    if (typeof input.active !== "boolean") throw new ApiError("active must be a boolean", 400);
    const { data, error } = await supabase.from("rewards").update({ active: input.active })
      .eq("id", id).eq("sponsor_id", sponsor.id).select("id, active").maybeSingle();
    if (error) throw error;
    if (!data) throw new ApiError("Reward not found or access denied", 404);
    return json({ success: true, reward: data });
  } catch (error) { return apiError(error); }
}
