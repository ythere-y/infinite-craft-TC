import assert from "node:assert/strict";
import test from "node:test";

import {
  parseModelCombination,
  requestModelCombination,
} from "../edge-functions/_lib/llm.js";
import { createGameService } from "../edge-functions/_lib/game-service.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
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

test("model parser accepts clean or fenced JSON and rejects invalid output", () => {
  assert.deepEqual(parseModelCombination('{"name":"智能水","emoji":"🧠"}'), {
    name: "智能水",
    emoji: "🧠",
  });
  assert.deepEqual(
    parseModelCombination('```json\\n{"name":"工位床位","emoji":"🛏️"}\\n```'),
    { name: "工位床位", emoji: "🛏️" },
  );
  assert.equal(parseModelCombination('{"name":"","emoji":"🧠"}'), null);
  assert.equal(
    parseModelCombination('{"name":"这是一个超过十个字符的超长结果","emoji":"🧠"}'),
    null,
  );
});

test("model request uses Makers environment variables and OpenAI endpoint", async () => {
  let captured;
  const result = await requestModelCombination({
    a: "AI",
    b: "水",
    avoidWords: ["旧结果"],
    env: {
      MAKERS_MODELS_KEY: "secret",
      LLM_BASE_URL: "https://example.test/v1/",
      LLM_MODEL: "demo-model",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"name":"智能水","emoji":"🧠"}' } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(result, { name: "智能水", emoji: "🧠" });
  assert.equal(captured.url, "https://example.test/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "demo-model");
  assert.match(body.messages[1].content, /旧结果/);
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
  assert.equal(repeat.is_first, false);
  assert.equal(repeat.discoverer, "勇敢鹅");
  assert.equal((await store.firstPage()).total, 1);
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
  assert.equal(repeat.result, "智能咖啡");
  assert.equal(calls, 1);
  assert.equal((await store.getCombination("AI", "咖啡")).result, "智能咖啡");
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
});
