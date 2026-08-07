import assert from "node:assert/strict";
import test from "node:test";

import {
  llmConfiguration,
  parseModelCombination,
  requestModelCombination,
  testLLMConnection,
} from "../edge-functions/_lib/llm.js";
import {
  DEFAULT_COMMENT,
  normalizeComment,
} from "../edge-functions/_lib/comments.js";
import { createGameService } from "../edge-functions/_lib/game-service.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { CommunityStore } from "../edge-functions/_lib/community.js";
import { COMBINATIONS } from "../edge-functions/_generated/seed-data.js";
import {
  MAX_COMBINE_ELEMENT_LENGTH,
  MAX_DISCOVERER_LENGTH,
  MAX_SESSION_ID_LENGTH,
} from "../edge-functions/_generated/runtime-contract-data.js";
import {
  entityKey,
  normalizePair,
} from "../edge-functions/_lib/keys.js";
import { FakeKV } from "./fake-kv.mjs";

function makeService({ env = {}, fetchImpl } = {}) {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  return {
    kv,
    store,
    service: createGameService({
      store,
      env,
      fetchImpl,
      now: () => 1_700_000_000_000,
      random: () => 0,
    }),
  };
}

async function recordElementWrites(kv, elementName, operation) {
  const canonicalKey = await entityKey("element", elementName);
  const writes = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value) => {
    writes.push({ key, value });
    return put(key, value);
  };
  try {
    await operation();
  } finally {
    kv.put = put;
  }
  return {
    canonical: writes.filter(({ key }) => key === canonicalKey).length,
    index: writes.filter(({ key, value }) => {
      if (!key.startsWith("index_element_") || typeof value !== "string") {
        return false;
      }
      return Object.hasOwn(JSON.parse(value)?.items || {}, canonicalKey);
    }).length,
  };
}

test("model parser accepts clean or fenced JSON and rejects invalid output", () => {
  assert.deepEqual(parseModelCombination('{"name":"智能水","emoji":"🧠"}'), {
    name: "智能水",
    emoji: "🧠",
    comment: DEFAULT_COMMENT,
  });
  assert.deepEqual(
    parseModelCombination(
      '```json\\n{"name":"工位床位","emoji":"🛏️","comment":"工位完成了居住属性升级。"}\\n```',
    ),
    {
      name: "工位床位",
      emoji: "🛏️",
      comment: "工位完成了居住属性升级。",
    },
  );
  assert.equal(parseModelCombination('{"name":"","emoji":"🧠"}'), null);
  assert.equal(
    parseModelCombination('{"name":"这是一个超过十个字符的超长结果","emoji":"🧠"}'),
    null,
  );
  assert.equal(
    parseModelCombination('{"name":"危险结果","emoji":"<img onerror=alert(1)>"}'),
    null,
  );
});

test("Makers comments use the same safe degradation policy as FastAPI", () => {
  assert.equal(
    normalizeComment("  一次生成，长期复用。  "),
    "一次生成，长期复用。",
  );
  for (const value of [null, "", "第一行\n第二行", "超".repeat(31)]) {
    assert.equal(normalizeComment(value), DEFAULT_COMMENT);
  }
  assert.deepEqual(
    parseModelCombination(
      '{"name":"合法结果","emoji":"✨","comment":"第一行\\n第二行"}',
    ),
    {
      name: "合法结果",
      emoji: "✨",
      comment: DEFAULT_COMMENT,
    },
  );
});

test("Makers configuration ignores local DeepSeek variables", () => {
  const config = llmConfiguration({
    LLM_API_KEY: "local-only-key",
    LLM_BASE_URL: "https://api.deepseek.com",
    LLM_MODEL: "deepseek-v4-flash",
    LLM_TIMEOUT: "60",
  });

  assert.equal(config.configured, false);
  assert.equal(config.provider, "edgeone-makers-models");
  assert.equal(config.baseUrl, "https://ai-gateway.edgeone.link/v1");
  assert.equal(config.model, "@makers/deepseek-v4-flash");
  assert.equal(config.timeoutSeconds, 15);
});

test("Makers configuration selects the official DeepSeek route explicitly", () => {
  for (const flag of ["1", "true", "TRUE", "yes", "on"]) {
    const config = llmConfiguration({
      MAKERS_USE_OWN_DEEPSEEK: flag,
      MAKERS_DEEPSEEK_API_KEY: "direct-secret",
      MAKERS_MODELS_KEY: "makers-secret",
      AI_GATEWAY_BASE_URL: "https://wrong.example/v1",
      AI_GATEWAY_MODEL: "wrong-model",
    });

    assert.equal(config.configured, true);
    assert.equal(config.provider, "deepseek-direct");
    assert.equal(config.apiKey, "direct-secret");
    assert.equal(config.baseUrl, "https://api.deepseek.com");
    assert.equal(config.model, "deepseek-v4-flash");
  }
});

test("selected official DeepSeek route never falls back to the Makers key", () => {
  const config = llmConfiguration({
    MAKERS_USE_OWN_DEEPSEEK: "1",
    MAKERS_DEEPSEEK_API_KEY: "   ",
    MAKERS_MODELS_KEY: "makers-secret",
  });

  assert.equal(config.configured, false);
  assert.equal(config.provider, "deepseek-direct");
  assert.equal(config.apiKey, "");
});

test("model request uses Makers environment variables and OpenAI endpoint", async () => {
  let captured;
  let randomCalls = 0;
  const result = await requestModelCombination({
    a: "AI",
    b: "水",
    avoidWords: ["旧结果"],
    bountyCandidates: [
      { name: "CSIG", emoji: "☁️", category: "bg" },
    ],
    communityExamples: [
      {
        a: "需求",
        b: "会议",
        name: "排期",
        emoji: "🗓️",
        comment: "需求一进会议室，就有了截止日期。",
      },
    ],
    random: () => {
      randomCalls += 1;
      return randomCalls === 1 ? 0 : 0.30;
    },
    env: {
      MAKERS_MODELS_KEY: "secret",
      AI_GATEWAY_BASE_URL: "https://example.test/v1/",
      AI_GATEWAY_MODEL: "demo-model",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"name":"智能水","emoji":"🧠","comment":"水也完成了智能升级。"}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(result, {
    name: "智能水",
    emoji: "🧠",
    comment: "水也完成了智能升级。",
  });
  assert.equal(captured.url, "https://example.test/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "demo-model");
  assert.equal(body.temperature, 0.85);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 128);
  assert.equal(body.messages.length, 2);
  assert.match(body.messages[1].content, /旧结果/);
  assert.match(body.messages[0].content, /【多样性硬要求】/);
  assert.match(body.messages[1].content, /社区高质量示例/);
  assert.match(body.messages[1].content, /本次偏好】偏自造词/);
  assert.match(body.messages[1].content, /优先组合常见字/);
  assert.match(body.messages[1].content, /悬赏候选/);
  assert.equal(randomCalls, 1);
});

test("model request sends the same bounded contract to official DeepSeek", async () => {
  let captured;
  await requestModelCombination({
    a: "AI",
    b: "咖啡",
    env: {
      MAKERS_USE_OWN_DEEPSEEK: "1",
      MAKERS_DEEPSEEK_API_KEY: "direct-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"name":"直连咖啡","emoji":"☕"}',
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(
    captured.init.headers.authorization,
    "Bearer direct-secret",
  );
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 128);
});

test("LLM requests omit unsupported Edge Function fetch signals", async () => {
  let requestInit;
  const result = await testLLMConnection({
    provider: "makers",
    env: {MAKERS_MODELS_KEY: "secret"},
    fetchImpl: async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({
        choices: [{message: {content: "OK"}}],
      }), {status: 200});
    },
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(requestInit, "signal"), false);
  assert.deepEqual(JSON.parse(requestInit.body).thinking, {type: "disabled"});
});

test("LLM availability tests expose safe upstream HTTP diagnostics", async () => {
  const result = await testLLMConnection({
    provider: "makers",
    env: {MAKERS_MODELS_KEY: "secret"},
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "invalid_api_key",
        message: "secret credential should not be returned",
      },
    }), {status: 401}),
  });

  assert.deepEqual(result, {
    ok: false,
    provider: "makers",
    message: "连接失败（HTTP 401 · invalid_api_key）",
    latency_ms: result.latency_ms,
    http_status: 401,
    error_code: "invalid_api_key",
  });
  assert.doesNotMatch(JSON.stringify(result), /secret credential/u);
});

test("model request selects weighted style hints at fixed boundaries", async () => {
  async function promptAt(value) {
    let captured;
    await requestModelCombination({
      a: "需求",
      b: "咖啡",
      random: () => value,
      env: { MAKERS_MODELS_KEY: "secret" },
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"name":"需求续杯","emoji":"☕","comment":"需求没闭环，咖啡先续上。"}',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    return captured.messages[1].content;
  }

  assert.match(await promptAt(0.30), /本次偏好】偏具体场景/);
  assert.match(await promptAt(0.99), /本次偏好】偏古今对照/);
});

test("seed combinations keep the existing response contract and persist firsts", async () => {
  const { service, store } = makeService();
  const first = await service.combine({
    a: "水",
    b: "火",
    discoverer: "勇敢鹅",
    session_id: "session-1",
  });
  const repeat = await service.combine({
    a: "火",
    b: "水",
    discoverer: "后来鹅",
    session_id: "session-2",
  });

  assert.equal(first.result, "蒸汽");
  assert.equal(first.source, "seed");
  assert.equal(first.is_first, true);
  assert.equal(first.discoverer, "勇敢鹅");
  assert.equal(first.depth, 1);
  assert.equal(first.full_score, 10);
  assert.equal(first.comment, DEFAULT_COMMENT);
  assert.deepEqual(first.icon, {
    base: "♨️",
    palette: "nature",
    source: "fallback",
  });
  assert.equal(repeat.is_first, false);
  assert.equal(repeat.discoverer, "勇敢鹅");
  assert.equal((await store.firstPage()).total, 1);
});

test("seeded combination hits do not rewrite canonical or indexed elements", async () => {
  const { service, kv } = makeService();

  const writes = await recordElementWrites(kv, "蒸汽", () =>
    service.combine({
      a: "水",
      b: "火",
      discoverer: "种子鹅",
      session_id: "seed-write-count",
    }),
  );

  assert.deepEqual(writes, { canonical: 0, index: 0 });
});

test("authoritative seed combinations cannot be shadowed by KV", async () => {
  const comboKey = await entityKey("combo", normalizePair("水", "火"));
  const kv = new FakeKV({
    [comboKey]: JSON.stringify({
      a: "水",
      b: "火",
      result: "错误覆盖",
      emoji: "❌",
      source: "llm",
    }),
  });
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  const service = createGameService({ store, env: {} });

  const result = await service.combine({
    a: "水",
    b: "火",
    discoverer: "种子鹅",
    session_id: "seed-session",
  });
  assert.equal(result.result, "蒸汽");
  assert.equal(result.source, "seed");
});

test("authoritative seed reconciliation supersedes stale cache and conflicting active formula", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  await community.publish(old.id, "seed-player");
  await store.putCombination("水", "水", {
    result: "缓存错误", emoji: "❌", comment: "缓存覆盖。", source: "llm", chain: null,
  });
  for (let count = 0; count < 3; count += 1) {
    await store.incrementCombinationHit("水", "水");
  }
  const service = createGameService({ store, env: {}, now: () => 1_700_000_000_000 });

  const result = await service.combine({
    a: "水", b: "水", discoverer: "种子鹅", session_id: "seed-session", player_id: "seed-player",
  });

  assert.equal(result.result, COMBINATIONS[normalizePair("水", "水")].result);
  assert.equal(result.emoji, COMBINATIONS[normalizePair("水", "水")].emoji);
  assert.equal(result.comment, normalizeComment(COMBINATIONS[normalizePair("水", "水")].comment));
  assert.equal(result.source, "seed");
  const cached = await store.getCombination("水", "水");
  assert.equal(cached.result, result.result);
  assert.equal(cached.emoji, result.emoji);
  assert.equal(cached.comment, result.comment);
  assert.equal(cached.source, "seed");
  assert.equal(cached.hit_count, 4);
  const formula = await community.get(`community_formula_${result.formula_id}`);
  assert.equal(formula.emoji, result.emoji);
  assert.equal(formula.comment, result.comment);
  assert.equal(formula.source, "seed");
  assert.equal((await community.combinationState("水", "水")).version, 2);
});

test("authoritative cache overwrite preserves hit count while dynamic callers remain first-write", async () => {
  const { store } = makeService();
  await store.putCombination("水", "水", {
    result: "缓存错误", emoji: "❌", comment: "缓存覆盖。", source: "llm", chain: null,
  });
  for (let count = 0; count < 3; count += 1) {
    await store.incrementCombinationHit("水", "水");
  }

  const dynamic = await store.putCombination("水", "水", {
    result: "仍然错误", emoji: "❌", comment: "动态不能覆盖。", source: "llm", chain: null,
  }, { overwrite: true });
  const seed = await store.putCombination("水", "水", {
    result: "水塘", emoji: "💧", comment: DEFAULT_COMMENT, source: "seed", chain: "geo",
  }, { rememberElement: false, overwrite: true });

  assert.equal(dynamic.result, "缓存错误");
  assert.equal(seed.result, "水塘");
  assert.equal(seed.hit_count, 3);
  assert.equal((await store.getCombination("水", "水")).hit_count, 3);
});

test("LLM misses are cached in KV and reused without another model request", async () => {
  let calls = 0;
  const { service, store } = makeService({
    env: { MAKERS_MODELS_KEY: "secret" },
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"name":"智能咖啡","emoji":"☕"}' } },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const first = await service.combine({
    a: "AI",
    b: "咖啡",
    discoverer: "模型鹅",
    session_id: "s",
  });
  const repeat = await service.combine({
    a: "咖啡",
    b: "AI",
    discoverer: "模型鹅",
    session_id: "s",
  });

  assert.equal(first.result, "智能咖啡");
  assert.equal(first.source, "llm");
  assert.equal(first.comment, DEFAULT_COMMENT);
  assert.equal(repeat.result, "智能咖啡");
  assert.equal(repeat.comment, DEFAULT_COMMENT);
  assert.deepEqual(first.icon, {
    base: "☕",
    palette: "product",
    source: "generated",
    badge: "🧩",
  });
  assert.deepEqual(repeat.icon, first.icon);
  assert.equal(calls, 1);
  assert.deepEqual(
    (await store.getCombination("AI", "咖啡")).icon,
    first.icon,
  );
  assert.deepEqual((await store.getElement("智能咖啡")).icon, first.icon);
});

test("legacy cached combinations reuse a valid persisted element icon", async () => {
  const { service, store, kv } = makeService();
  const persisted = {
    base: "🫘",
    badge: "⚙️",
    palette: "office",
    source: "generated",
  };
  await store.rememberElement("缓存咖啡", {
    emoji: "☕",
    category: "ai",
    icon: persisted,
  });
  const key = await entityKey("combo", normalizePair("缓存甲", "缓存乙"));
  await kv.put(
    key,
    JSON.stringify({
      a: "缓存甲",
      b: "缓存乙",
      result: "缓存咖啡",
      emoji: "☕",
      comment: DEFAULT_COMMENT,
      source: "llm",
      chain: "ai",
      hit_count: 0,
      ts: 1_700_000_000,
    }),
  );

  const result = await service.combine({
    a: "缓存甲",
    b: "缓存乙",
    discoverer: "缓存鹅",
    session_id: "cached-icon",
  });

  assert.deepEqual(result.icon, persisted);
  assert.deepEqual((await store.getElement("缓存咖啡")).icon, persisted);
});

test("cached combinations with valid element metadata stay read-only", async () => {
  const { service, store, kv } = makeService();
  const icon = {
    base: "🫘",
    badge: "⚙️",
    palette: "office",
    source: "generated",
  };
  await store.rememberElement("只读缓存", {
    emoji: "☕",
    category: "ai",
    depth: 2,
    icon,
  });
  await kv.put(
    await entityKey("combo", normalizePair("缓存左", "缓存右")),
    JSON.stringify({
      a: "缓存右",
      b: "缓存左",
      result: "只读缓存",
      emoji: "☕",
      comment: DEFAULT_COMMENT,
      source: "llm",
      chain: "ai",
      icon,
      hit_count: 0,
      ts: 1_700_000_000,
    }),
  );

  const writes = await recordElementWrites(kv, "只读缓存", () =>
    service.combine({
      a: "缓存左",
      b: "缓存右",
      discoverer: "缓存鹅",
      session_id: "cache-write-count",
    }),
  );

  assert.deepEqual(writes, { canonical: 0, index: 0 });
});

test("new dynamic combinations persist icon and depth in one element write", async () => {
  const { service, kv } = makeService({
    env: { MAKERS_MODELS_KEY: "secret" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"name":"一次写入","emoji":"☕"}' } },
          ],
        }),
        { status: 200 },
      ),
  });

  const writes = await recordElementWrites(kv, "一次写入", () =>
    service.combine({
      a: "AI",
      b: "咖啡豆",
      discoverer: "模型鹅",
      session_id: "dynamic-write-count",
    }),
  );

  assert.deepEqual(writes, { canonical: 1, index: 1 });
});

test("legacy elements repair missing icons with one merged element write", async () => {
  const { service, kv } = makeService();
  const elementKey = await entityKey("element", "待修复缓存");
  await kv.put(
    elementKey,
    JSON.stringify({
      name: "待修复缓存",
      emoji: "☕",
      category: "ai",
      depth: 2,
      updated_at: 1_700_000_000,
      storage_key: elementKey,
    }),
  );
  await kv.put(
    await entityKey("combo", normalizePair("旧左", "旧右")),
    JSON.stringify({
      a: "旧右",
      b: "旧左",
      result: "待修复缓存",
      emoji: "☕",
      comment: DEFAULT_COMMENT,
      source: "llm",
      chain: "ai",
      hit_count: 0,
      ts: 1_700_000_000,
    }),
  );

  const writes = await recordElementWrites(kv, "待修复缓存", () =>
    service.combine({
      a: "旧左",
      b: "旧右",
      discoverer: "修复鹅",
      session_id: "repair-write-count",
    }),
  );

  assert.deepEqual(writes, { canonical: 1, index: 1 });
  assert.deepEqual((await new KvStore(kv).getElement("待修复缓存")).icon, {
    base: "☕",
    badge: "⚡",
    palette: "product",
    source: "generated",
  });
});

test("LLM comments are persisted in KV and reused with the cached result", async () => {
  let calls = 0;
  const { service, store } = makeService({
    env: { MAKERS_MODELS_KEY: "secret" },
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"name":"需求气球","emoji":"🎈","comment":"一开会，需求就自动膨胀。"}',
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const first = await service.combine({
    a: "需求甲",
    b: "会议乙",
    discoverer: "点评鹅",
    session_id: "comment-session",
  });
  const repeat = await service.combine({
    a: "会议乙",
    b: "需求甲",
    discoverer: "点评鹅",
    session_id: "comment-session",
  });

  assert.equal(first.comment, "一开会，需求就自动膨胀。");
  assert.equal(repeat.comment, first.comment);
  assert.equal(
    (await store.getCombination("需求甲", "会议乙")).comment,
    first.comment,
  );
  assert.equal(
    (await store.firstPage({ offset: 0, limit: 1 })).items[0].comment,
    first.comment,
  );
  assert.equal(calls, 1);
});

test("model misses have a bounded per-visitor KV rate limit", async () => {
  let calls = 0;
  const { service, kv } = makeService({
    env: {
      MAKERS_MODELS_KEY: "secret",
      MODEL_CALLS_PER_MINUTE: "1",
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"name":"限流结果","emoji":"🧱"}' } },
          ],
        }),
        { status: 200 },
      );
    },
  });

  await service.combine({
    a: "限流甲",
    b: "限流乙",
    discoverer: "限流鹅",
    session_id: "same-visitor",
  });
  await assert.rejects(
    service.combine({
      a: "限流丙",
      b: "限流丁",
      discoverer: "限流鹅",
      session_id: "same-visitor",
    }),
    (error) => error?.status === 429 && /频繁/.test(error.message),
  );
  assert.equal(calls, 1);
  assert.equal(
    [...kv.values.keys()].filter((key) => key.startsWith("modelrate_")).length,
    1,
  );
});

test("missing model configuration degrades to the established fallback", async () => {
  const { service } = makeService();
  const result = await service.combine({
    a: "不存在甲",
    b: "不存在乙",
    discoverer: "匿名鹅",
    session_id: "s",
  });

  assert.equal(result.source, "fallback");
  assert.equal(result.result, "未知产物");
  assert.equal(result.is_first, false);
  assert.equal(result.kpi_delta, 0);
  assert.equal(result.comment, DEFAULT_COMMENT);
  assert.equal(result.icon, undefined);
});

test("Makers combine accepts exact astral code-point boundaries", async () => {
  assert.equal(MAX_COMBINE_ELEMENT_LENGTH, 80);
  assert.equal(MAX_DISCOVERER_LENGTH, 80);
  assert.equal(MAX_SESSION_ID_LENGTH, 128);
  const { service } = makeService();
  const astral = "🪿";

  const result = await service.combine({
    a: astral.repeat(80),
    b: astral.repeat(80),
    discoverer: astral.repeat(80),
    session_id: astral.repeat(128),
  });

  assert.equal(result.a, astral.repeat(80));
  assert.equal(result.b, astral.repeat(80));
  assert.equal(result.source, "fallback");
});

test("Makers combine rejects overlong fields before KV or model side effects", async () => {
  const astral = "🪿";
  const cases = [
    ["a", astral.repeat(81), /a\/b 过长/u],
    ["b", astral.repeat(81), /a\/b 过长/u],
    ["discoverer", astral.repeat(81), /discoverer 过长/u],
    ["session_id", astral.repeat(129), /session_id 过长/u],
  ];

  for (const [field, value, message] of cases) {
    let modelCalls = 0;
    const { kv, service } = makeService({
      env: { MAKERS_MODELS_KEY: "secret" },
      fetchImpl: async () => {
        modelCalls += 1;
        throw new Error("model must not be called");
      },
    });
    const input = {
      a: "甲",
      b: "乙",
      discoverer: "测试鹅",
      session_id: "session",
      [field]: value,
    };

    await assert.rejects(
      service.combine(input),
      (error) => error?.status === 400 && message.test(error.message),
    );
    assert.equal(kv.getCalls, 0, field);
    assert.equal(kv.values.size, 0, field);
    assert.equal(modelCalls, 0, field);
  }
});
