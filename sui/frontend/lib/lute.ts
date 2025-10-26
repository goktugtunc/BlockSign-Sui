// lib/lute.ts
import LuteConnect, { SignTxnsError } from "lute-connect"

// .env.local içine örnek:
// NEXT_PUBLIC_ALGO_GENESIS_ID=testnet-v1.0  // veya mainnet-v1.0
const GENESIS_ID = process.env.NEXT_PUBLIC_ALGO_GENESIS_ID ?? "testnet-v1.0"

let _lute: LuteConnect | null = null
function lute(): LuteConnect {
  if (!_lute) _lute = new LuteConnect()
  return _lute
}

/**
 * Lute ile cüzdan bağlat. **Bir buton tıklaması zincirinde çağırılmalı.**
 * genesisID, Lute docs'a göre zorunlu ve ağla uyumlu olmalı (testnet/mainnet).
 * Docs: https://github.com/GalaxyPay/lute-connect → README (connect/signTxns uyarıları)
 */
export async function luteConnect(): Promise<string[]> {
  try {
    // Burada doğrudan ENV’den alıyoruz. İstersen backend / build cevabından ağı okuyup eşleştir.
    const addrs = await lute().connect(GENESIS_ID)
    if (!Array.isArray(addrs) || addrs.length === 0) {
      throw new Error("Lute: Adres alınamadı. Cüzdan boş olabilir ya da yanlış ağ seçili.")
    }
    return addrs
  } catch (err: any) {
    throw new Error(`Lute bağlanma hatası: ${err?.message || String(err)}`)
  }
}

/**
 * Backend'in /blocksign/create/build döndürdüğü unsigned tx grubunu imzalatır.
 * **Bir buton tıklaması zincirinde çağırılmalı.**
 */
export async function luteSignUnsignedGroup(unsignedGroupB64: string[]): Promise<string[]> {
  try {
    if (!Array.isArray(unsignedGroupB64) || unsignedGroupB64.length === 0) {
      throw new Error("İmzalanacak işlem grubu boş.")
    }
    const signed = await lute().signTxns(unsignedGroupB64)
    if (!Array.isArray(signed) || signed.length === 0) {
      throw new Error("Lute: İmzalı sonuç dönmedi (kullanıcı iptal etmiş olabilir).")
    }
    return signed
  } catch (err: any) {
    if (err instanceof SignTxnsError) {
      // Lute lib özel hata tipi — kullanıcı reddi vb. kod içerir
      throw new Error(`Lute imzalama reddedildi/kesildi (code: ${err.code})`)
    }
    throw new Error(`Lute imzalama hatası: ${err?.message || String(err)}`)
  }
}
