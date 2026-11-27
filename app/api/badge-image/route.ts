import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri");
  if (!uri) {
    return new NextResponse("Missing uri", { status: 400 });
  }

  try {
    const res = await fetch(uri, { cache: "force-cache" });
    const contentType = res.headers.get("content-type") || "";

    // Eğer link doğrudan bir resimse (PNG, SVG, JPG vb.) resmi döndür
    if (contentType.startsWith("image/")) {
      const buffer = await res.arrayBuffer();
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Eğer link NFT JSON metadata dosyasıysa içindeki "image" alanını çekip yönlendir
    const text = await res.text();
    const json = JSON.parse(text);
    if (json.image) {
      return NextResponse.redirect(json.image);
    }

    return new NextResponse("No image found in metadata", { status: 404 });
  } catch {
    return new NextResponse("Failed to resolve IPFS asset", { status: 502 });
  }
}