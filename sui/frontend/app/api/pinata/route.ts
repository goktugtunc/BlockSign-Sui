// app/api/ipfs/pin/route.ts
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const filename = req.headers.get("x-filename") || `file-${Date.now()}`;
    const contentType = req.headers.get("x-mime") || "application/octet-stream";
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      return new Response(JSON.stringify({ ok: false, error: "PINATA_JWT missing" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    // Body’yi al (raw bytes)
    const arrayBuf = await req.arrayBuffer();
    const blob = new Blob([arrayBuf], { type: contentType });

    // multipart form-data hazırlığı
    const form = new FormData();
    form.append("file", blob, filename);
    // (opsiyonel) metadata
    form.append(
      "pinataMetadata",
      JSON.stringify({ name: filename, keyvalues: { app: "blocksign-sui" } })
    );

    const upstream = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
      body: form,
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ ok: false, status: upstream.status, error: text }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    const cid = json.IpfsHash || json.Hash || json.cid;
    const gw =
      (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://gateway.pinata.cloud").replace(/\/+$/, "");
    const viewUrl = cid ? `${gw}/ipfs/${cid}` : "";

    return new Response(JSON.stringify({ ok: true, cid, viewUrl, raw: json }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
