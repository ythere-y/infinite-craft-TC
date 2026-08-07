const MAKERS_BASE_URL = "https://ai-gateway.edgeone.link/v1";
const MAKERS_MODEL = "@makers/deepseek-v4-flash";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

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

function providerConfiguration(env, provider) {
  if (provider === "deepseek") {
    return {
      apiKey: String(env.MAKERS_DEEPSEEK_API_KEY || "").trim(),
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEEPSEEK_MODEL,
    };
  }
  return {
    apiKey: String(env.MAKERS_MODELS_KEY || "").trim(),
    baseUrl: String(env.AI_GATEWAY_BASE_URL || MAKERS_BASE_URL)
      .replace(/\/+$/u, ""),
    model: String(env.AI_GATEWAY_MODEL || MAKERS_MODEL),
  };
}

export async function forwardModelRequest({
  body,
  env = {},
  fetchImpl = globalThis.fetch,
}) {
  const provider = body?.provider;
  if (!["makers", "deepseek"].includes(provider)) {
    return json({ detail: "provider 无效" }, 400);
  }
  const config = providerConfiguration(env, provider);
  if (!config.apiKey) return json({ detail: "模型接口未配置" }, 503);
  if (!body?.payload || typeof body.payload !== "object") {
    return json({ detail: "payload 无效" }, 400);
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        ...body.payload,
        model: config.model,
      }),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return json({ error: { code: "proxy_fetch_failed" } }, 502);
  }
}

export async function onRequestPost(context) {
  const expected = String(context.env?.ADMIN_TOKEN || "").trim();
  if (!expected || bearer(context.request) !== expected) {
    return json({ detail: "模型代理凭据无效" }, 401);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ detail: "请求体不是合法 JSON" }, 400);
  }
  return forwardModelRequest({
    body,
    env: context.env || {},
    fetchImpl: context.fetchImpl || globalThis.fetch,
  });
}
