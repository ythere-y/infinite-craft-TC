import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

function signature(secret, encodedPayload) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function signModelTicket(secret, payload) {
  const signingSecret = String(secret || "").trim();
  if (!signingSecret) throw new TypeError("Model ticket secret is required");
  const encoded = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  return `${encoded}.${signature(signingSecret, encoded)}`;
}

export function verifyModelTicket(
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
    const expected = Buffer.from(
      signature(signingSecret, parts[0]),
      "utf8",
    );
    const received = Buffer.from(parts[1], "utf8");
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
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
