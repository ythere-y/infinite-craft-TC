import { normalizeComment } from "./comments.js";
import { PROMPT_SPEC } from "../_generated/prompt-data.js";
import { buildPromptMessagesFromSpec } from "./prompt.js";

const DEFAULT_BASE_URL = "https://ai-gateway.edgeone.link/v1";
const DEFAULT_MODEL = "@makers/deepseek-v4-flash";
const DIRECT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DIRECT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function enabled(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export function defaultLLMProvider(env = {}) {
  return enabled(env.MAKERS_USE_OWN_DEEPSEEK) ? "deepseek" : "makers";
}

export function llmConfiguration(env = {}, provider = null) {
  const useOwnDeepSeek = provider
    ? provider === "deepseek"
    : defaultLLMProvider(env) === "deepseek";
  const apiKey = String(
    useOwnDeepSeek
      ? env.MAKERS_DEEPSEEK_API_KEY || ""
      : env.MAKERS_MODELS_KEY || "",
  ).trim();
  const baseUrl = useOwnDeepSeek
    ? DIRECT_DEEPSEEK_BASE_URL
    : env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL;
  const model = useOwnDeepSeek
    ? DIRECT_DEEPSEEK_MODEL
    : env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
  const timeoutSeconds = Math.max(
    1,
    Math.min(60, Number(env.AI_GATEWAY_TIMEOUT) || 15),
  );
  return {
    configured: Boolean(apiKey),
    provider: useOwnDeepSeek
      ? "deepseek-direct"
      : "edgeone-makers-models",
    apiKey,
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    model,
    timeoutSeconds,
  };
}

function completionUrl(baseUrl) {
  return baseUrl.endsWith("/chat/completions")
    ? baseUrl
    : `${baseUrl}/chat/completions`;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutSeconds) {
  let timer = null;
  try {
    return await Promise.race([
      fetchImpl(url, init),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("模型请求超时");
          error.code = "MODEL_TIMEOUT";
          reject(error);
        }, timeoutSeconds * 1_000);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

function safeUpstreamCode(value) {
  const code = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(code) ? code : "";
}

async function upstreamFailure(response) {
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
    // HTTP status remains enough for a safe diagnostic.
  }
  return {
    message: `连接失败（HTTP ${response.status}${code ? ` · ${code}` : ""}）`,
    http_status: response.status,
    ...(code ? { error_code: code } : {}),
  };
}

export function parseModelCombination(text) {
  if (!text) return null;
  const source = String(text).trim();
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    const match = source.match(/\{[^{}]*"name"[^{}]*"emoji"[^{}]*\}/s);
    if (!match) return null;
    try {
      value = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  const name = String(value?.name || "").trim();
  const emoji = String(value?.emoji || "").trim();
  if (
    !name ||
    !emoji ||
    [...name].length > 10 ||
    [...emoji].length > 16 ||
    /[<>&"'`]/u.test(emoji)
  ) {
    return null;
  }
  return {
    name,
    emoji,
    comment: normalizeComment(value?.comment),
  };
}

export async function requestModelCombination({
  a,
  b,
  avoidWords = [],
  bountyCandidates = [],
  communityExamples = [],
  env = {},
  fetchImpl = globalThis.fetch,
  random = Math.random,
  promptLimits,
  promptSpec = PROMPT_SPEC,
  provider = null,
}) {
  const config = llmConfiguration(env, provider);
  if (!config.configured || typeof fetchImpl !== "function") return null;

  try {
    const messages = buildPromptMessagesFromSpec({
      ...promptSpec,
      limits: promptLimits || promptSpec.limits || PROMPT_SPEC.limits,
    }, {
      a,
      b,
      avoid_words: avoidWords,
      bounty_candidates: bountyCandidates,
      community_examples: communityExamples,
      style_value: random(),
    });
    const response = await fetchWithTimeout(
      fetchImpl,
      completionUrl(config.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: messages.temperature,
          thinking: { type: "disabled" },
          max_tokens: 128,
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
        }),
      },
      config.timeoutSeconds,
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const text =
      payload?.choices?.[0]?.message?.content ||
      payload?.answer ||
      payload?.text ||
      payload?.output ||
      payload?.result ||
      "";
    return parseModelCombination(text);
  } catch {
    return null;
  }
}

export async function testLLMConnection({
  env = {},
  provider,
  fetchImpl = globalThis.fetch,
}) {
  const config = llmConfiguration(env, provider);
  const started = Date.now();
  if (!config.configured) {
    return {
      ok: false,
      provider,
      message: "接口未配置",
      latency_ms: 0,
    };
  }
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      completionUrl(config.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          thinking: { type: "disabled" },
          max_tokens: 32,
          messages: [
            {role: "system", content: "Reply with exactly OK."},
            {role: "user", content: "ping"},
          ],
        }),
      },
      config.timeoutSeconds,
    );
    if (!response.ok) {
      return {
        ok: false,
        provider,
        ...(await upstreamFailure(response)),
        latency_ms: Math.max(0, Date.now() - started),
      };
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    const ok = typeof content === "string" && Boolean(content.trim());
    return {
      ok,
      provider,
      message: ok ? "连接成功" : "连接失败（模型响应为空）",
      latency_ms: Math.max(0, Date.now() - started),
    };
  } catch (error) {
    const timedOut = error?.code === "MODEL_TIMEOUT";
    return {
      ok: false,
      provider,
      message: timedOut ? "连接失败（请求超时）" : "连接失败（请求未发出）",
      latency_ms: Math.max(0, Date.now() - started),
      ...(timedOut ? { error_code: "MODEL_TIMEOUT" } : {}),
    };
  }
}
