import { createHmac, randomBytes } from "node:crypto";
import { apiError, body, json, wallet } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const input = await body(request);
    const address = wallet(input.wallet_address);
    const nonce = randomBytes(32).toString("hex");
    let requesterHash: string | null = null;
    // Enable only behind a proxy that overwrites this header. Global and wallet
    // limits remain active when no trusted proxy is configured.
    if (process.env.TRUST_PROXY === "true") {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
      const secret = process.env.JWT_SECRET;
      if (ip && secret) requesterHash = createHmac("sha256", secret).update(ip).digest("hex");
    }
    const { data, error } = await supabase.rpc("issue_login_nonce", {
      p_wallet: address, p_nonce: nonce, p_requester_hash: requesterHash,
    });
    if (error) throw error;
    if (!data) {
      const response = json({ success: false, message: "Too many login attempts" }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
    return json({ success: true, nonce,
      message: `CampusPass Login\nWallet: ${address}\nNonce: ${nonce}`,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (error) { return apiError(error); }
}
