import { apiError, json, requireUser } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const user = await requireUser("admin");
    const { data, error } = await supabase.from("clubs").select("id, name")
      .eq("admin_id", user.id).order("name");
    if (error) throw error;
    return json({ success: true, clubs: data });
  } catch (error) { return apiError(error); }
}
