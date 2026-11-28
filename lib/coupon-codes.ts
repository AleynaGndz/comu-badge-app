import "server-only";
import { randomBytes } from "node:crypto";

// 32 symbols, no 0/O or 1/I; masking is uniform (50 random bits per code).
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function createCouponCode() {
  const token = Array.from(randomBytes(10), byte => ALPHABET[byte & 31]).join("");
  return `CP-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}`;
}
export function normalizeCouponCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 100) return null;
  const trimmed = value.trim();
  // Previously issued codes remain valid; stored legacy codes are lowercase hex.
  if (/^[a-f0-9]{48}$/i.test(trimmed)) return trimmed.toLowerCase();
  const compact = trimmed.replace(/[\s-]/g, "").toUpperCase();
  if (!/^CP[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(compact)) return null;
  const token = compact.slice(2);
  return `CP-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}`;
}
