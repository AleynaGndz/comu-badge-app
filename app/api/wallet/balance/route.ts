import { PublicKey } from "@solana/web3.js";
import { ApiError, apiError, json, requireUser, wallet } from "@/lib/api";
import { devnetConnection } from "@/lib/deposit-chain";

export const runtime = "nodejs";
type Entry = { expires: number; result: Promise<number> };
const shared = globalThis as typeof globalThis & { campusBalanceCache?: Map<string, Entry> };
const cache = shared.campusBalanceCache ??= new Map<string, Entry>();

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const address = wallet(new URL(request.url).searchParams.get("wallet"));
    if (address !== user.wallet_address) throw new ApiError("Bağlı cüzdanınızla yeniden giriş yapın.", 403);
    const key = `${process.env.SOLANA_RPC_URL}:${address}`;
    let entry = cache.get(key);
    if (!entry || entry.expires <= Date.now()) {
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      entry = { expires: Date.now() + 15000, result: (async () => {
        const connection = await devnetConnection();
        return connection.getBalance(new PublicKey(address), "confirmed");
      })() };
      cache.set(key, entry);
    }
    let lamports: number;
    try { lamports = await entry.result; }
    catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
    return json({ success: true, wallet: address, lamports, network: "devnet" });
  } catch (error) { return apiError(error); }
}
