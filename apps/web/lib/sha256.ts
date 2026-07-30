// Tarayıcıda (Web Crypto API) bir dosyanın SHA-256'sını hesaplar — sunucu
// bunu yeniden hesaplayıp karşılaştırır (bkz. apps/api ChecksumMismatchError).
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
