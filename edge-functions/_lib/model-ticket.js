const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value) {
  const normalized = String(value)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - normalized.length % 4) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(secret, encodedPayload) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(encodedPayload),
    ),
  ));
}

function equal(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signModelTicket(secret, payload) {
  const signingSecret = String(secret || "").trim();
  if (!signingSecret) throw new TypeError("Model ticket secret is required");
  const encoded = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  return `${encoded}.${await signature(signingSecret, encoded)}`;
}

export async function verifyModelTicket(
  secret,
  ticket,
  { now = Date.now() } = {},
) {
  const signingSecret = String(secret || "").trim();
  const value = String(ticket || "");
  if (!signingSecret || value.length > 200_000) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const expected = await signature(signingSecret, parts[0]);
    if (!equal(expected, parts[1])) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    const expiresAt = Number(payload?.exp);
    if (
      !payload ||
      typeof payload !== "object" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Number(now)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
