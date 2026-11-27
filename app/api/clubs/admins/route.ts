import { apiError, body, json, requireUser, uuid, wallet, ApiError } from "@/lib/api";
import { requireClubAdmin } from "@/lib/clubs";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const user = await requireUser("admin");
    const clubId = uuid(new URL(request.url).searchParams.get("club_id"));
    await requireClubAdmin(user.id, clubId);
    const { data, error } = await supabase.from("club_admins")
      .select("user_id, created_at, users(id, name, wallet_address, role)").eq("club_id", clubId);
    if (error) throw error;
    return json({ success: true, admins: data });
  } catch (error) { return apiError(error); }
}
async function changeAdmin(request: Request, enabled: boolean) {
  const owner = await requireUser("admin");
  const input = await body(request);
  const clubId = uuid(input.club_id);
  // Check ownership before looking up the target user's private database ID.
  const { data: club, error: clubError } = await supabase.from("clubs")
    .select("id").eq("id", clubId).eq("admin_id", owner.id).maybeSingle();
  if (clubError) throw clubError;
  if (!club) throw new ApiError("Only the club owner can manage administrators", 403);
  const address = wallet(input.wallet_address);
  const { data: target, error: userError } = await supabase.from("users")
    .select("id").eq("wallet_address", address).maybeSingle();
  if (userError) throw userError;
  if (!target) throw new ApiError("User must complete wallet login first", 404);
  const { error } = await supabase.rpc("set_club_admin", {
    p_owner_id: owner.id, p_club_id: clubId, p_user_id: target.id, p_enabled: enabled,
  });
  if (error) throw error;
  return json({ success: true });
}
export async function POST(request: Request) {
  try { return await changeAdmin(request, true); } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try { return await changeAdmin(request, false); } catch (error) { return apiError(error); }
}
