// app/api/walrus/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs"; // Edge değil
export const dynamic = "force-dynamic"; // SSR önbellek olmasın
export const maxDuration = 60;
export const preferredRegion = "auto";
export const fetchCache = "default-no-store";

export const POST = async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const epochs = url.searchParams.get("epochs") || "5";

    const aggUrl =
      process.env.WALRUS_AGGREGATOR_URL ||
      "https://aggregator.walrus.xyz/v1/store";

    console.log("[Walrus Proxy] Incoming POST →", url.toString());
    console.log("[Walrus Proxy] Using aggregator:", aggUrl);

    const bodyArrayBuffer = await req.arrayBuffer();
    const buf = Buffer.from(bodyArrayBuffer);
    console.log("[Walrus Proxy] Received body bytes:", buf.length);

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    const mime = req.headers.get("x-blob-mime");
    if (mime) headers["X-Blob-Mime"] = mime;

    const targetUrl = `${aggUrl}?epochs=${encodeURIComponent(epochs)}`;
    console.log("[Walrus Proxy] Forwarding →", targetUrl);

    const upstream = await fetch(targetUrl, {
      method: "POST",
      body: buf,
      headers,
    });

    const text = await upstream.text();

    console.log(
      `[Walrus Proxy] Upstream responded (${upstream.status}):`,
      text.slice(0, 300)
    );

    if (!upstream.ok) {
      console.error("[Walrus Proxy] ❌ Upstream error:", upstream.status, text);
      return new Response(
        JSON.stringify({
          ok: false,
          status: upstream.status,
          error: text.slice(0, 2000),
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    // JSON parse deneyelim
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    const blobId = json.blobId || json.id || json.blob_id;
    const gatewayBase =
      process.env.NEXT_PUBLIC_WALRUS_GATEWAY?.replace(/\/+$/, "") ||
      "https://gateway.walrus.xyz";
    const viewUrl = blobId ? `${gatewayBase}/v1/blobs/${blobId}` : "";

    console.log("[Walrus Proxy] ✅ Success:", { blobId, viewUrl });

    return new Response(
      JSON.stringify({ ok: true, blobId, viewUrl, raw: json }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[Walrus Proxy] 💥 Fatal error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
