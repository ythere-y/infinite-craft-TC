export const CORS_HEADERS = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-admin-token",
};

export function jsonResponse(
  value,
  { status = 200, headers = {} } = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

export function errorResponse(status, message, details = undefined) {
  const payload = { detail: message };
  if (details !== undefined) payload.details = details;
  return jsonResponse(payload, { status });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function readJson(request, { maxBytes = 1_000_000 } = {}) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) {
    throw new HttpError(413, "请求体过大");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "请求体过大");
  }
  if (!text.trim()) throw new HttpError(400, "请求体不能为空");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "请求体不是合法 JSON");
  }
}

export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}
