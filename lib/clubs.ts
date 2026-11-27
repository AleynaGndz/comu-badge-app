import "server-only";
import { ApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function managedClubs(userId: string) {
  const { data, error } = await supabase.rpc("managed_clubs", { p_user_id: userId });
  if (error) throw error;
  return data as { id: string; name: string; admin_id: string | null }[];
}
export async function requireClubAdmin(userId: string, clubId: string) {
  const { data, error } = await supabase.rpc("can_manage_club", { p_user_id: userId, p_club_id: clubId });
  if (error) throw error;
  if (!data) throw new ApiError("Club access denied", 403);
}
