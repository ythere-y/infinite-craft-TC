const DEFAULT_BASE_URL = "https://ai-gateway.edgeone.link/v1";
const DEFAULT_MODEL = "@makers/deepseek-v4-flash";

const SYSTEM_PROMPT = `你是《鹅厂无限合成 ♾️》的合成裁判。
用户给你两个元素，请给出一个“意料之外、情理之中”的合成结果。
优先考虑鹅厂/互联网职场文化、打工人日常、中文互联网梗、自造词、具体场景词和中英混搭。
除非一方在语义上明显会吞噬另一方，否则不要原样返回输入。
输出必须遵循内容安全策略；不确定时使用中性的场景词。
只返回 JSON，格式严格为 {"name":"2-8字元素名","emoji":"单个emoji"}，不要解释或 Markdown。`;

const EXAMPLES = [
  ["咖啡", "夜宵券", "续命二连", "☕"],
  ["会议", "会议", "会议套娃", "🪆"],
  ["工位", "折叠椅", "工位床位", "🛏️"],
  ["周报", "ChatGPT", "AI代笔", "🤖"],
  ["厕所", "手机", "带薪冥想", "🧘"],
  ["周五", "下班", "GG时刻", "🎉"],
  ["虚空", "加班", "虚空", "🕳️"],
];

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

function promptFor(a, b, avoidWords = [], bountyCandidates = []) {
  const lines = [SYSTEM_PROMPT, "", "示例："];
  for (const [left, right, name, emoji] of EXAMPLES) {
    lines.push(
      `${JSON.stringify({ a: left, b: right })} -> ${JSON.stringify({ name, emoji })}`,
    );
  }
  if (avoidWords.length) {
    lines.push("", `禁用最近结果：${avoidWords.slice(0, 30).join("、")}`);
  }
  if (bountyCandidates.length) {
    lines.push(
      "",
      "若语义自然，可优先命中以下尚未解锁的悬赏词：",
      bountyCandidates
        .slice(0, 12)
        .map((item) => `${item.name}${item.emoji || ""}`)
        .join("、"),
    );
  }
  lines.push("", `本次输入：${JSON.stringify({ a, b })}`, "输出：");
  return lines.join("\n");
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
  if (!name || !emoji || [...name].length > 10) return null;
  return { name, emoji };
}

export async function requestModelCombination({
  a,
  b,
  avoidWords = [],
  bountyCandidates = [],
  env = {},
  fetchImpl = globalThis.fetch,
}) {
  const config = llmConfiguration(env);
  if (!config.configured || typeof fetchImpl !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutSeconds * 1_000,
  );
  try {
    const response = await fetchImpl(completionUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.85,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: promptFor(a, b, avoidWords, bountyCandidates),
          },
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
    clearTimeout(timeout);
  }
}
