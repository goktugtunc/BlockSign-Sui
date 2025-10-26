// lib/ipfs-utils.ts
export async function uploadToIPFS(bytes: Uint8Array, filename: string, mime = "application/pdf") {
  const res = await fetch("/api/ipfs/pin", {
    method: "POST",
    headers: {
      "x-filename": filename,
      "x-mime": mime,
    },
    body: bytes, // raw
  });

  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Upload failed with status ${res.status}`);
  }
  return data.cid as string;
}

export function ipfsViewUrl(cid: string) {
  const gw =
    (process.env.NEXT_PUBLIC_IPFS_GATEWAY || "https://gateway.pinata.cloud").replace(/\/+$/, "");
  return `${gw}/ipfs/${cid}`;
}
