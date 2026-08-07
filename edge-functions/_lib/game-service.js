import {
  COMBINATIONS,
  DEPTHS,
  ELEMENTS,
  STARTERS,
} from "../_generated/seed-data.js";
import { PROMPT_SPEC } from "../_generated/prompt-data.js";
import {
  MAX_COMBINE_ELEMENT_LENGTH,
  MAX_DISCOVERER_LENGTH,
  MAX_SESSION_ID_LENGTH,
} from "../_generated/runtime-contract-data.js";
import {
  normalizeBountyAlias,
  selectBountyCandidates,
} from "./bounty.js";
import { normalizePair, cleanText } from "./keys.js";
import {
  defaultLLMProvider,
  llmConfiguration,
  requestModelCombination,
} from "./llm.js";
import { scoreFor, shouldExplode } from "./kpi.js";
import {
  DEFAULT_COMMENT,
  normalizeComment,
} from "./comments.js";
import { CommunityStore } from "./community.js";
import {
  normalizeIcon,
  resolveIconRecipe,
} from "./icon-recipes.js";
import { PromptStore } from "./prompt-store.js";

const FALLBACK = {
  result: "未知产物",
  emoji: "❓",
  comment: DEFAULT_COMMENT,
  source: "fallback",
  chain: null,
};
const ELEMENT_WRITE_NEEDED = Symbol("element-write-needed");

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
  random = Math.random,
  promptLimits,
  modelProxyUrl = "",
} = {}) {
  if (!store) throw new TypeError("Game service requires a KV store");
  const community = new CommunityStore(store.kv, { now });
  const prompts = new PromptStore(store.kv, { now, random });
  const modelCallsPerMinute = Math.max(
    1,
    Math.min(1_000, Number(env.MODEL_CALLS_PER_MINUTE) || 20),
  );

  async function elementInfo(name) {
    const dynamic = (await store.getElement(name)) || {};
    const seed = ELEMENTS[name] || {};
    const dynamicIcon = normalizeIcon(dynamic.icon);
    const seedIcon = normalizeIcon(seed.icon);
    return {
      info: {
        ...dynamic,
        ...seed,
        ...(dynamicIcon ? { icon: dynamicIcon } : {}),
      },
      dynamicIcon,
      seedIcon,
    };
  }

  async function withResolvedIcon(hit, a, b) {
    if (!hit?.result) return hit;
    try {
      const {
        info,
        dynamicIcon,
        seedIcon,
      } = await elementInfo(hit.result);
      const persisted =
        dynamicIcon ||
        seedIcon ||
        normalizeIcon(hit.icon);
      const icon = resolveIconRecipe({
        name: hit.result,
        emoji: hit.emoji,
        category: info.category || hit.chain || "ai",
        parents: [a, b],
        chain: hit.chain || null,
        comment: normalizeComment(hit.comment),
        persisted,
      });
      const enriched = { ...hit, icon };
      Object.defineProperty(enriched, ELEMENT_WRITE_NEEDED, {
        value: !dynamicIcon && !seedIcon,
      });
      return enriched;
    } catch {
      return hit;
    }
  }

  async function resolveCombination(a, b, clientIdentity = "anonymous") {
    const seeded = COMBINATIONS[normalizePair(a, b)];
    if (seeded?.result) return withResolvedIcon(seeded, a, b);
    const communityState = await community.combinationState(a, b);
    const cached = await store.getCombination(a, b);
    if (communityState?.status === "active" && communityState.version > 1 && cached?.result) {
      return withResolvedIcon(cached, a, b);
    }
    if (communityState?.status !== "retired") {
      if (cached?.result) return withResolvedIcon(cached, a, b);
    }
    const provider = await store.llmProvider(defaultLLMProvider(env));
    if (!llmConfiguration(env, provider).configured) return null;

    const quota = await store.consumeRateLimit(clientIdentity, {
      limit: modelCallsPerMinute,
      windowSeconds: 60,
    });
    if (!quota.allowed) {
      throw tooManyRequests("新组合生成过于频繁，请稍后再试");
    }

    const promptSpec = await prompts.activeSpec();
    const effectivePromptLimits =
      promptLimits || promptSpec.limits || PROMPT_SPEC.limits;
    const firsts = await store.allFirsts();
    const feedback = await community.feedback(env, {
      positiveLimit: effectivePromptLimits.community_examples,
      negativeLimit: effectivePromptLimits.avoid_words,
    });
    const avoidWords = [
      ...new Set([
        ...feedback.negatives,
        ...firsts.map((item) => item.result),
      ]),
    ].slice(0, effectivePromptLimits.avoid_words);
    const generated = await requestModelCombination({
      a,
      b,
      avoidWords,
      communityExamples: feedback.positives,
      bountyCandidates: selectBountyCandidates({
        a,
        b,
        elements: { ...(await store.dynamicElements()), ...ELEMENTS },
        starters: STARTERS,
        firsts,
        limit: effectivePromptLimits.bounty_candidates,
      }),
      env,
      fetchImpl,
      random,
      promptLimits: effectivePromptLimits,
      promptSpec,
      proxyToken: env.ADMIN_TOKEN,
      proxyUrl: modelProxyUrl,
      provider,
    });
    if (!generated) return null;
    const generatedHit = await withResolvedIcon(
      {
        result: generated.name,
        emoji: generated.emoji,
        comment: generated.comment,
        source: "llm",
        chain: null,
      },
      a,
      b,
    );
    const stored = await store.putCombination(a, b, {
      result: generated.name,
      emoji: generated.emoji,
      comment: generated.comment,
      source: "llm",
      chain: null,
      ...(generatedHit.icon ? { icon: generatedHit.icon } : {}),
    }, {
      rememberElement: false,
    });
    Object.defineProperty(stored, ELEMENT_WRITE_NEEDED, {
      value: generatedHit[ELEMENT_WRITE_NEEDED] !== false,
      configurable: true,
    });
    return stored;
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
    const a = normalizeBountyAlias(input?.a);
    const b = normalizeBountyAlias(input?.b);
    if (!a || !b) {
      throw badRequest("a/b 不能为空");
    }
    if (
      [...a].length > MAX_COMBINE_ELEMENT_LENGTH ||
      [...b].length > MAX_COMBINE_ELEMENT_LENGTH
    ) {
      throw badRequest("a/b 过长");
    }
    const sessionId = cleanText(input?.session_id) || "default";
    const clientIdentity =
      cleanText(input?.client_identity) || sessionId;
    if ([...sessionId].length > MAX_SESSION_ID_LENGTH) {
      throw badRequest("session_id 过长");
    }
    if (
      [...cleanText(input?.discoverer)].length >
      MAX_DISCOVERER_LENGTH
    ) {
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
    const icon = normalizeIcon(hit.icon);
    let isFirst = false;
    let recordedDiscoverer = null;
    let depth = 0;
    // Retain the legacy kpi field names for response compatibility.
    let kpi = { delta: 0, reason: "" };
    let hitCount = 0;

    if (source !== "fallback") {
      const first = await store.recordFirst(
        hit.result,
        hit.emoji,
        discoverer,
        comment,
      );
      isFirst = first.created;
      recordedDiscoverer = first.record?.discoverer || null;
      depth = await depthFor(a, b, hit.result);
      if (hit[ELEMENT_WRITE_NEEDED]) {
        await store.rememberElement(hit.result, {
          emoji: hit.emoji,
          category: chain || ELEMENTS[hit.result]?.category || "ai",
          depth,
          ...(icon ? { icon } : {}),
        });
      }
      // The store method keeps legacy kpi_* score records for compatibility.
      kpi = scoreFor(chain, isFirst);
      await store.addKpi(sessionId, kpi.delta, kpi.reason);
      try {
        await store.putCombination(a, b, {
          result: hit.result,
          emoji: hit.emoji,
          comment,
          source,
          chain,
          ...(icon ? { icon } : {}),
        }, {
          rememberElement: false,
          overwrite: source === "seed",
        });
        const counted = await store.incrementCombinationHit(a, b);
        hitCount = Math.max(1, Number(counted?.hit_count) || 1);
      } catch {
        hitCount = 1;
      }
    }

    let formula = null;
    if (source === "seed") {
      formula = await community.reconcileAuthoritativeFormula({
        a, b, result: hit.result, emoji: hit.emoji, comment, source,
        discoverer: recordedDiscoverer, playerId: cleanText(input?.player_id) || null,
      });
    } else if (source !== "fallback" && cleanText(input?.player_id)) {
      formula = await community.ensureFormula({
        a, b, result: hit.result, emoji: hit.emoji, comment, source,
        discoverer: recordedDiscoverer, playerId: cleanText(input.player_id),
      });
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
      ...(icon ? { icon } : {}),
      comment,
      source,
      chain,
      is_first: isFirst,
      discoverer: recordedDiscoverer,
      explode: shouldExplode(chain, hit.result),
      // Legacy compatibility response fields; clients use depth/full_score.
      kpi_delta: kpi.delta,
      kpi_reason: kpi.reason,
      depth,
      full_score: 10 * depth * depth,
      formula_id: formula?.id || null,
      hit_count: source === "fallback" ? 0 : hitCount,
    };
  }

  return { combine, resolveCombination };
}
