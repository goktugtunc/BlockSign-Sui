// lib/walrus.ts

type WalrusStoreOpts = {
  mime?: string;        // bilgilendirme amaçlı
  epochs?: number;      // saklama süresi (aggregator bu ismi bekliyor olabilir)
  viaProxy?: boolean;   // önce /api/walrus ile gönder
};

export async function walrusStore(
  data: Uint8Array | ArrayBuffer | Blob,
  opts: WalrusStoreOpts = {},
) {
  const epochs = Number.isFinite(opts.epochs as number) ? Number(opts.epochs) : 5;

  // Gövdeyi Blob'a normalize et
  const blob =
    data instanceof Blob
      ? data
      : new Blob([data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)], {
          type: "application/octet-stream",
        });

  // 1) Önce proxy ile dene (CORS/boyut limitini aşmamak için)
  if (opts.viaProxy) {
    const url = `/api/walrus?epochs=${encodeURIComponent(String(epochs))}`;
    const r = await fetch(url, {
      method: "POST",
      body: blob,
      headers: {
        "Content-Type": "application/octet-stream",
        ...(opts.mime ? { "X-Blob-Mime": opts.mime } : {}),
      },
    });

    const text = await r.text();
    if (!r.ok) {
      // Proxy’nin döndürdüğü upstream hatasını da ilet
      throw new Error(`Walrus store failed via proxy (HTTP ${r.status}): ${text.slice(0, 500)}`);
    }

    // proxy JSON döndürür
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Walrus proxy returned non-JSON: ${text.slice(0, 200)}`);
    }

    const blobId = json.blobId || json.id || json.blob_id;
    const gatewayBase =
      process.env.NEXT_PUBLIC_WALRUS_GATEWAY?.replace(/\/+$/, "") || "https://gateway.walrus.xyz";
    const viewUrl = blobId ? `${gatewayBase}/v1/blobs/${blobId}` : "";

    return { blobId, viewUrl, raw: json };
  }

  // 2) Doğrudan aggregator’a dene
  const agg =
    (typeof process !== "undefined" &&
      (process.env.WALRUS_AGGREGATOR_URL as string)) ||
    "https://aggregator.walrus.xyz/v1/store";

  const directUrl = `${agg}${agg.includes("?") ? "&" : "?"}epochs=${encodeURIComponent(
    String(epochs),
  )}`;

  const resp = await fetch(directUrl, {
    method: "POST",
    body: blob,
    headers: {
      "Content-Type": "application/octet-stream",
      ...(opts.mime ? { "X-Blob-Mime": opts.mime } : {}),
    },
  });

  const txt = await resp.text();
  if (!resp.ok) {
    throw new Error(`Walrus store failed (HTTP ${resp.status}): ${txt.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error(`Walrus aggregator returned non-JSON: ${txt.slice(0, 200)}`);
  }

  const blobId = json.blobId || json.id || json.blob_id;
  const gatewayBase =
    process.env.NEXT_PUBLIC_WALRUS_GATEWAY?.replace(/\/+$/, "") || "https://gateway.walrus.xyz";
  const viewUrl = blobId ? `${gatewayBase}/v1/blobs/${blobId}` : "";

  return { blobId, viewUrl, raw: json };
}
