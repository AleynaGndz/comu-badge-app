import catalog from "@/badges.json";
import { ApiError } from "@/lib/api";

export const badgeCatalog: Record<string, string> = catalog;
export function metadataForBadge(value: unknown): string {
  if (typeof value !== "string" || !Object.hasOwn(badgeCatalog, value)) {
    throw new ApiError("Select a valid badge_key", 400);
  }
  return badgeCatalog[value];
}
