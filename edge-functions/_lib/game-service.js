import {
  COMBINATIONS,
  DEPTHS,
  ELEMENTS,
} from "../_generated/seed-data.js";
import { normalizePair, cleanText } from "./keys.js";
import { requestModelCombination } from "./llm.js";
import { scoreFor, shouldExplode } from "./kpi.js";

const FALLBACK = {
  result: "未知产物",
  emoji: "❓",
  source: "fallback",
  chain: null,
};

function validDiscoverer(value) {
  const name = cleanText(value);
  return ["", "seed", "system", "匿名鹅"].includes(name.toLowerCase())
    ? "匿名鹅"
    : name;
}

export function createGameService({
  store,
  env = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!store) throw new TypeError("Game service requires a KV store");

  async function resolveCombination(a, b) {
    const cached = await store.getCombination(a, b);
    if (cached?.result) return cached;

    const seeded = COMBINATIONS[normalizePair(a, b)];
    if (seeded?.result) return seeded;

    const recent = await store.recentFirsts(30);
    const generated = await requestModelCombination({
      a,
      b,
      avoidWords: recent.map((item) => item.result),
      env,
      fetchImpl,
    });
    if (!generated) return null;
    return store.putCombination(a, b, {
      result: generated.name,
      emoji: generated.emoji,
      source: "llm",
      chain: null,
    });
  }

  async function depthFor(a, b, result) {
    const dynamic = await store.dynamicElements();
    const aDepth = DEPTHS[a] ?? dynamic[a]?.depth;
    const bDepth = DEPTHS[b] ?? dynamic[b]?.depth;
    const current = DEPTHS[result] ?? dynamic[result]?.depth;
    if (aDepth == null || bDepth == null) return current ?? 3;
    const candidate = Math.max(Number(aDepth), Number(bDepth)) + 1;
    return current == null ? candidate : Math.min(Number(current), candidate);
  }

  async function combine(input) {
    const a = cleanText(input?.a);
    const b = cleanText(input?.b);
    if (!a || !b) {
      const error = new TypeError("a/b 不能为空");
      error.status = 400;
      throw error;
    }
    const sessionId = cleanText(input?.session_id) || "default";
    const discoverer = validDiscoverer(input?.discoverer);
    if (cleanText(input?.discoverer)) {
      await store.touchNickname(cleanText(input.discoverer));
    }

    const hit = (await resolveCombination(a, b)) || FALLBACK;
    const source = hit.source || "seed";
    const chain = hit.chain || null;
    let isFirst = false;
    let recordedDiscoverer = null;
    let depth = 0;
    let kpi = { delta: 0, reason: "" };

    if (source !== "fallback") {
      const first = await store.recordFirst(
        hit.result,
        hit.emoji,
        discoverer,
      );
      isFirst = first.created;
      recordedDiscoverer = first.record?.discoverer || null;
      depth = await depthFor(a, b, hit.result);
      await store.rememberElement(hit.result, {
        emoji: hit.emoji,
        category: chain || ELEMENTS[hit.result]?.category || "ai",
        depth,
      });
      kpi = scoreFor(chain, isFirst);
      await store.addKpi(sessionId, kpi.delta, kpi.reason);
    }

    await store.recordCombineActivity({
      sessionId,
      a,
      b,
      result: hit.result,
      emoji: hit.emoji,
      source,
      chain,
      ts: now() / 1_000,
    });

    return {
      a,
      b,
      result: hit.result,
      emoji: hit.emoji,
      source,
      chain,
      is_first: isFirst,
      discoverer: recordedDiscoverer,
      explode: shouldExplode(chain, hit.result),
      kpi_delta: kpi.delta,
      kpi_reason: kpi.reason,
      depth,
      full_score: 10 * depth * depth,
    };
  }

  return { combine, resolveCombination };
}
