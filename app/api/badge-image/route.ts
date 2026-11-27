import { NextRequest, NextResponse } from "next/server";

// Keep this list explicit: arbitrary hosts and redirects would reopen SSRF.
const GATEWAY = "sapphire-known-weasel-75.mypinata.cloud";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;

class AssetError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function assetUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.startsWith("ipfs://")
      ? `https://${GATEWAY}/ipfs/${value.slice(7)}`
      : value);
  } catch {
    throw new AssetError("Invalid asset URL", 400);
  }
  if (url.protocol !== "https:" || url.hostname !== GATEWAY ||
      url.port || url.username || url.password || url.search || url.hash ||
      !/^\/ipfs\/[a-zA-Z0-9]+(?:\/[^?#]*)?$/.test(url.pathname)) {
    throw new AssetError("Asset URL is not allowed", 400);
  }
  return url;
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const size = Number(response.headers.get("content-length"));
  if (size > MAX_BYTES) {
    await response.body?.cancel();
    throw new AssetError("Asset is too large", 413);
  }
  if (!response.body) throw new AssetError("Empty upstream response", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new AssetError("Asset is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri");
  if (!uri) return new NextResponse("Missing uri", { status: 400 });

  const controller = new AbortController();
  // One deadline covers metadata, image headers and both response bodies.
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = assetUrl(uri);
    for (let depth = 0; depth < 2; depth++) {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AssetError("Upstream asset request failed", 502);
      }
      const contentType = (response.headers.get("content-type") || "")
        .split(";")[0].trim().toLowerCase();
      const bytes = await readLimited(response);
      if (contentType.startsWith("image/")) {
        return new NextResponse(bytes as BodyInit, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      }
      if (depth === 1) throw new AssetError("No image found in metadata", 404);
      let metadata;
      try {
        metadata = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new AssetError("Invalid asset metadata", 502);
      }
      if (!metadata || typeof metadata.image !== "string") {
        throw new AssetError("No image found in metadata", 404);
      }
      // Metadata image URLs must pass the same checks as the initial input.
      url = assetUrl(metadata.image);
    }
    return new NextResponse("No image found in metadata", { status: 404 });
  } catch (error) {
    if (controller.signal.aborted) {
      return new NextResponse("Asset request timed out", { status: 504 });
    }
    return new NextResponse(
      error instanceof AssetError ? error.message : "Failed to resolve IPFS asset",
      { status: error instanceof AssetError ? error.status : 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
