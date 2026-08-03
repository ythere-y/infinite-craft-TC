import { normalizeComment } from "./comments.js";
import { buildPromptMessages } from "./prompt.js";

const DEFAULT_BASE_URL = "https://ai-gateway.edgeone.link/v1";
const DEFAULT_MODEL = "@makers/deepseek-v4-flash";

export function llmConfiguration(env = {}) {
  const apiKey =
    env.AI_GATEWAY_API_KEY ||
    env.MAKERS_MODELS_KEY ||
    env.LLM_API_KEY ||
    "";
  const baseUrl =
    env.AI_GATEWAY_BASE_URL || env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const model = env.AI_GATEWAY_MODEL || env.LLM_MODEL || DEFAULT_MODEL;
  const timeoutSeconds = Math.max(
    1,
    Math.min(60, Number(env.LLM_TIMEOUT) || 15),
  );
  return {
    configured: Boolean(apiKey),
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
}) {
  const config = llmConfiguration(env);
  if (!config.configured || typeof fetchImpl !== "function") return null;

  const controller = new AbortController();
  const timeout =
    typeof setTimeout === "function"
      ? setTimeout(
          () => controller.abort(),
          config.timeoutSeconds * 1_000,
        )
      : null;
  try {
    const messages = buildPromptMessages({
      a,
      b,
      avoid_words: avoidWords,
      bounty_candidates: bountyCandidates,
      community_examples: communityExamples,
      style_value: random(),
    });
    const response = await fetchImpl(completionUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: messages.temperature,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
      signal: controller.signal,
    });
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
  } finally {
    if (timeout != null && typeof clearTimeout === "function") {
      clearTimeout(timeout);
    }
  }
}
