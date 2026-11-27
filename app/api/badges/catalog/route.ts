import { json } from "@/lib/api";
import { badgeCatalog } from "@/lib/badge-catalog";

export async function GET() {
  return json({ success: true, badges: Object.entries(badgeCatalog)
    .map(([badge_key, metadata_uri]) => ({ badge_key, metadata_uri })) });
}
