import "server-only";
import { NextResponse } from "next/server";
import bs58 from "bs58";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function apiError(error: unknown) {
  if (error instanceof ApiError) return json({ success: false, message: error.message }, error.status);
  const code = (error as { code?: string })?.code;
  if (code && /^PT[45]\d\d$/.test(code)) {
    return json({ success: false, message: (error as { message: string }).message }, Number(code.slice(2)));
  }
  console.error("Backend request failed", error);
  return json({ success: false, message: "Backend request failed" }, 500);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Invalid request", 400);
  return value;
}
export function wallet(value: unknown): string {
  if (typeof value !== "string" || value.length > 44) throw new ApiError("Invalid wallet", 400);
  try { if (bs58.decode(value).length === 32) return value; } catch { /* Invalid base58. */ }
  throw new ApiError("Invalid wallet", 400);
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError("Invalid ID", 400);
  return value;
}
export async function requireUser(role?: "student" | "admin" | "sponsor") {
  const session = await getSession();
  if (!session) throw new ApiError("Unauthorized", 401);
  const { data, error } = await supabase.from("users").select("id, wallet_address, role")
    .eq("id", session.userId).eq("wallet_address", session.walletAddress).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Unauthorized", 401);
  if (role && data.role !== role) throw new ApiError(`${role} access required`, 403);
  return data as { id: string; wallet_address: string; role: string };
}
