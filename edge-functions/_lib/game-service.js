import {
  COMBINATIONS,
  DEPTHS,
  ELEMENTS,
  STARTERS,
} from "../_generated/seed-data.js";
import { selectBountyCandidates } from "./bounty.js";
import { normalizePair, cleanText } from "./keys.js";
import {
  llmConfiguration,
  requestModelCombination,
} from "./llm.js";
import { scoreFor, shouldExplode } from "./kpi.js";
import {
  DEFAULT_COMMENT,
  normalizeComment,
} from "./comments.js";

const FALLBACK = {
  result: "未知产物",
  emoji: "❓",
  comment: DEFAULT_COMMENT,
  source: "fallback",
  chain: null,
};

function badRequest(message) {
  const error = new TypeError(message);
  error.status = 400;
  return error;
}

function tooManyRequests(message) {
  const error = new Error(message);
  error.status = 429;
  return error;
}

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
  const modelConfigured = llmConfiguration(env).configured;
  const modelCallsPerMinute = Math.max(
    1,
    Math.min(1_000, Number(env.MODEL_CALLS_PER_MINUTE) || 20),
  );

  async function resolveCombination(a, b, clientIdentity = "anonymous") {
    const seeded = COMBINATIONS[normalizePair(a, b)];
    if (seeded?.result) return seeded;

    const cached = await store.getCombination(a, b);
    if (cached?.result) return cached;
    if (!modelConfigured) return null;

    const quota = await store.consumeRateLimit(clientIdentity, {
      limit: modelCallsPerMinute,
      windowSeconds: 60,
    });
    if (!quota.allowed) {
      throw tooManyRequests("新组合生成过于频繁，请稍后再试");
    }

    const firsts = await store.allFirsts();
    const generated = await requestModelCombination({
      a,
      b,
      avoidWords: firsts.slice(0, 30).map((item) => item.result),
      bountyCandidates: selectBountyCandidates({
        a,
        b,
        elements: { ...(await store.dynamicElements()), ...ELEMENTS },
        starters: STARTERS,
        firsts,
      }),
      env,
      fetchImpl,
    });
    if (!generated) return null;
    return store.putCombination(a, b, {
      result: generated.name,
      emoji: generated.emoji,
      comment: generated.comment,
      source: "llm",
      chain: null,
    });
  }

  async function depthFor(a, b, result) {
    const dynamicDepth = async (name) =>
      DEPTHS[name] ?? (await store.getElement(name))?.depth;
    const [aDepth, bDepth, current] = await Promise.all([
      dynamicDepth(a),
      dynamicDepth(b),
      dynamicDepth(result),
    ]);
    if (aDepth == null || bDepth == null) return current ?? 3;
    const candidate = Math.max(Number(aDepth), Number(bDepth)) + 1;
    return current == null ? candidate : Math.min(Number(current), candidate);
  }

  async function combine(input) {
    const a = cleanText(input?.a);
    const b = cleanText(input?.b);
    if (!a || !b) {
      throw badRequest("a/b 不能为空");
    }
    if ([...a].length > 80 || [...b].length > 80) {
      throw badRequest("a/b 过长");
    }
    const sessionId = cleanText(input?.session_id) || "default";
    const clientIdentity =
      cleanText(input?.client_identity) || sessionId;
    if ([...sessionId].length > 128) throw badRequest("session_id 过长");
    if ([...cleanText(input?.discoverer)].length > 80) {
      throw badRequest("discoverer 过长");
    }
    const discoverer = validDiscoverer(input?.discoverer);
    if (cleanText(input?.discoverer)) {
      await store.touchNickname(cleanText(input.discoverer));
    }

    const hit =
      (await resolveCombination(a, b, clientIdentity)) || FALLBACK;
    const source = hit.source || "seed";
    const chain = hit.chain || null;
    const comment = normalizeComment(hit.comment);
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
      comment,
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
