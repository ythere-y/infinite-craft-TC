const encoder = new TextEncoder();

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizePair(a, b) {
  return [cleanText(a), cleanText(b)].sort().join(" + ");
}

export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function entityKey(prefix, identity) {
  const safePrefix = cleanText(prefix).toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(safePrefix)) {
    throw new TypeError(`Invalid KV key prefix: ${prefix}`);
  }
  return `${safePrefix}_${await sha256Hex(identity)}`;
}
