import { PROMPT_SPEC } from "../_generated/prompt-data.js";

function selectStyle(spec, value) {
  const roll = Math.max(0, Math.min(0.9999999999999999, Number(value)));
  const styles = spec.styles.filter((item) => item.enabled !== false);
  let cumulative = 0;
  for (const style of styles) {
    cumulative += Number(style.weight);
    if (roll < cumulative) return style;
  }
  return styles[styles.length - 1];
}

export function buildPromptMessagesFromSpec(spec, {
  a,
  b,
  avoid_words = [],
  bounty_candidates = [],
  community_examples = [],
  style_value,
  random = Math.random,
}) {
  const style = selectStyle(
    spec,
    style_value === undefined ? random() : style_value,
  );
  const system = [...spec.system_modules]
    .filter((item) => item.enabled !== false)
    .sort((left, right) => left.order - right.order)
    .map((item) => item.content)
    .join("\n\n");
  const { limits } = spec;
  const lines = ["【示例】"];

  for (const example of spec.examples) {
    if (example.enabled === false) continue;
    const input = { a: example.input.a, b: example.input.b };
    const output = {
      name: example.output.name,
      emoji: example.output.emoji,
      comment: example.output.comment,
    };
    lines.push(`输入：${JSON.stringify(input)}`);
    lines.push(`输出：${JSON.stringify(output)}`);
  }
  lines.push("");

  const positiveExamples = (spec.positive_examples || [])
    .filter((item) => item.enabled !== false)
    .map((item) => item.content);
  const negativeExamples = (spec.negative_examples || [])
    .filter((item) => item.enabled !== false)
    .map((item) => item.content);
  if (positiveExamples.length) {
    lines.push("【正面案例】", ...positiveExamples, "");
  }
  if (negativeExamples.length) {
    lines.push("【负面案例】", ...negativeExamples, "");
  }

  if (community_examples.length) {
    lines.push("【社区高质量示例（仅参考风格，不要照抄）】");
    for (const item of community_examples.slice(0, limits.community_examples)) {
      const input = { a: item.a ?? "", b: item.b ?? "" };
      const output = {
        name: item.name ?? "",
        emoji: item.emoji ?? "",
        comment: item.comment ?? "",
      };
      lines.push(`输入：${JSON.stringify(input)} 输出：${JSON.stringify(output)}`);
    }
    lines.push("");
  }

  if (avoid_words.length) {
    lines.push("【avoid_words（禁词，不要再用）】");
    lines.push(avoid_words.slice(0, limits.avoid_words).join("、"));
    lines.push("");
  }

  if (bounty_candidates.length) {
    lines.push("【悬赏候选（未解锁 · 若语义顺理成章，请优先产出其中一个）】");
    for (const item of bounty_candidates.slice(0, limits.bounty_candidates)) {
      if (item.name) {
        lines.push(`- ${item.name} ${item.emoji ?? ""}  [${item.category ?? ""}]`);
      }
    }
    lines.push("（以上词语义不合适就忽略，不要硬塞。）");
    lines.push("");
  }

  lines.push(
    `【本次偏好】${style.label}`,
    style.guidance,
    "",
    "【本次输入】",
    `输入：${JSON.stringify({ a, b })}`,
    "输出：",
  );
  return {
    system,
    user: lines.join("\n"),
    temperature: Number(spec.temperature),
    style_id: style.id,
  };
}

export function buildPromptMessages(input) {
  return buildPromptMessagesFromSpec(PROMPT_SPEC, input);
}
