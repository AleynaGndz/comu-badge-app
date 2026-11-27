import { apiError, json, requireUser } from "@/lib/api";
import { managedClubs } from "@/lib/clubs";

export async function GET() {
  try {
    const user = await requireUser("admin");
    const clubs = await managedClubs(user.id);
    return json({ success: true, clubs });
  } catch (error) { return apiError(error); }
}
