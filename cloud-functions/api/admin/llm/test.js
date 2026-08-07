import {
  forwardModelRequest,
} from "../../../internal/llm-proxy.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bearer(request) {
  return String(request.headers.get("authorization") || "")
    .match(/^Bearer\s+(.+)$/iu)?.[1] || "";
}

function safeUpstreamCode(value) {
  const code = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(code) ? code : "";
}

async function failureDetails(response) {
  let code = "";
  try {
    const payload = await response.json();
    code = safeUpstreamCode(
      payload?.error?.code ||
      payload?.code ||
      payload?.error?.type ||
      payload?.type,
    );
  } catch {
    // The HTTP status is sufficient when the upstream body is not JSON.
  }
  return {
    message: `连接失败（HTTP ${response.status}${code ? ` · ${code}` : ""}）`,
    http_status: response.status,
    ...(code ? { error_code: code } : {}),
  };
}

export async function onRequestPost(context) {
  const started = Date.now();
  const expected = String(context.env?.ADMIN_TOKEN || "").trim();
  if (!expected || bearer(context.request) !== expected) {
    return json({ detail: "管理凭据无效" }, 401);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ detail: "请求体不是合法 JSON" }, 400);
  }
  const provider = String(body?.provider || "").trim();
  if (!["makers", "deepseek"].includes(provider)) {
    return json({ detail: "provider 必须是 makers 或 deepseek" }, 400);
  }

  const response = await forwardModelRequest({
    body: {
      provider,
      payload: {
        temperature: 0,
        thinking: { type: "disabled" },
        max_tokens: 32,
        messages: [
          { role: "system", content: "Reply with exactly OK." },
          { role: "user", content: "ping" },
        ],
      },
    },
    env: context.env || {},
    fetchImpl: context.fetchImpl || globalThis.fetch,
  });
  const latencyMs = Math.max(0, Date.now() - started);

  if (!response.ok) {
    return json({
      ok: false,
      provider,
      ...(await failureDetails(response)),
      latency_ms: latencyMs,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const content = payload?.choices?.[0]?.message?.content;
  const ok = typeof content === "string" && Boolean(content.trim());
  return json({
    ok,
    provider,
    message: ok ? "连接成功" : "连接失败（模型响应为空）",
    latency_ms: latencyMs,
  });
}
