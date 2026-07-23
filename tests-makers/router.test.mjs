import assert from "node:assert/strict";
import test from "node:test";

import { createRouter } from "../edge-functions/_lib/router.js";
import { FakeKV } from "./fake-kv.mjs";

function request(path, { method = "GET", body } = {}) {
  return new Request(`https://makers.example${path}`, {
    method,
    headers: body == null ? {} : { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

function makeRouter() {
  return createRouter({
    kv: new FakeKV(),
    env: {
      APP_ENV: "test",
      MAKERS_MODELS_KEY: "secret",
      LLM_MODEL: "test-model",
    },
    now: () => 1_700_000_000_000,
    random: () => 0,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '{"name":"边缘咖啡","emoji":"☕"}' } },
          ],
        }),
        { status: 200 },
      ),
  });
}

async function json(router, path, options) {
  const response = await router.handle(request(path, options));
  return { response, body: await response.json() };
}

test("static, health and rank routes keep their public contracts", async () => {
  const router = makeRouter();

  const starters = await json(router, "/api/starters");
  assert.equal(starters.response.status, 200);
  assert.equal(starters.body.starters.length, 10);

  const elements = await json(router, "/api/elements");
  assert.ok(elements.body.elements["企鹅"]);

  const tiers = await json(router, "/api/tiers");
  assert.equal(tiers.body.tiers[0].grade, "3-");

  const rank = await json(router, "/api/rank?total=8000");
  assert.equal(rank.body.grade, "瑞雪");
  assert.equal(rank.body.total, 8000);

  const defaultPage = await json(router, "/api/wall/page");
  assert.equal(defaultPage.body.limit, 100);

  const health = await json(router, "/api/health");
  assert.equal(health.body.kv, "ok");
  assert.equal(health.body.llm, "configured");
  assert.equal(health.body.llm_config.model, "test-model");
  assert.equal("apiKey" in health.body.llm_config, false);
});

test("dynamic KV metadata never overwrites authoritative seed elements", async () => {
  const router = createRouter({
    kv: new FakeKV({
      snapshot_elements: JSON.stringify({
        "企鹅": { emoji: "❌", category: "ai", depth: 99 },
      }),
    }),
    env: {},
  });
  const elements = await json(router, "/api/elements");
  assert.equal(elements.body.elements["企鹅"].emoji, "🐧");
  assert.equal(elements.body.elements["企鹅"].category, "tencent");
});

test("nickname, combine, wall, bounty and admin routes share KV state", async () => {
  const router = makeRouter();

  const peek = await json(router, "/api/nickname/peek");
  assert.match(peek.body.nickname, /鹅$/u);

  const claim = await json(router, "/api/nickname/claim", {
    method: "POST",
    body: { nickname: "测试鹅" },
  });
  assert.deepEqual(claim.body, { ok: true, nickname: "测试鹅" });

  const combine = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "水",
      b: "火",
      discoverer: "测试鹅",
      session_id: "session-1",
    },
  });
  assert.equal(combine.body.result, "蒸汽");
  assert.equal(combine.body.is_first, true);

  const page = await json(router, "/api/wall/page?offset=0&limit=40");
  assert.equal(page.body.total, 1);
  assert.equal(page.body.items[0].discoverer, "测试鹅");

  const leaderboard = await json(
    router,
    "/api/wall/leaderboard?limit=20&me=%E6%B5%8B%E8%AF%95%E9%B9%85",
  );
  assert.deepEqual(leaderboard.body.me, { rank: 1, firsts: 1 });

  const bounty = await json(router, "/api/wall/bounty");
  assert.ok(bounty.body.total > 0);
  assert.ok(Array.isArray(bounty.body.groups));

  const admin = await json(router, "/api/admin/stats");
  assert.equal(admin.body.total_calls, 1);
  assert.equal(admin.body.firsts_total, 1);
  assert.equal(admin.body.nick_count, 1);
  assert.equal(admin.body.recent_firsts[0].result, "蒸汽");
});

test("recipes, verification, KPI and analytics routes remain available", async () => {
  const router = makeRouter();

  const verify = await json(router, "/api/recipes/verify", {
    method: "POST",
    body: {
      recipes: [
        { a: "水", b: "火", result: "蒸汽", emoji: "♨️" },
        { a: "水", b: "火", result: "错误", emoji: "❌" },
        { a: "甲", b: "乙", result: "未知", emoji: "❓" },
      ],
    },
  });
  assert.equal(verify.body.valid.length, 1);
  assert.equal(verify.body.invalid.length, 1);
  assert.equal(verify.body.unknown.length, 1);

  const recipes = await json(
    router,
    `/api/element/${encodeURIComponent("蒸汽")}/recipes`,
  );
  assert.ok(recipes.body.recipes.some((item) => item.a === "水"));

  const kpi = await json(router, "/api/session/kpi", {
    method: "POST",
    body: { session_id: "s", delta: 30, reason: "测试" },
  });
  assert.equal(kpi.body.total, 30);

  const sessionRank = await json(router, "/api/session/s/rank");
  assert.equal(sessionRank.body.total, 30);

  for (const path of [
    "/api/analytics/chains",
    "/api/analytics/discoverers",
    "/api/analytics/combinations",
    "/api/nickname/stats",
    "/api/wall/recent",
    "/api/wall/category/tencent",
  ]) {
    const result = await json(router, path);
    assert.equal(result.response.status, 200, path);
  }
});

test("router returns safe JSON errors, CORS preflight and stream shutdown", async () => {
  const router = makeRouter();

  const bad = await json(router, "/api/combine", {
    method: "POST",
    body: { a: "", b: "火" },
  });
  assert.equal(bad.response.status, 400);
  assert.match(bad.body.detail, /不能为空/);

  const tooLong = await json(router, "/api/combine", {
    method: "POST",
    body: { a: "a".repeat(81), b: "火" },
  });
  assert.equal(tooLong.response.status, 400);
  assert.match(tooLong.body.detail, /过长/);

  const missing = await json(router, "/api/not-found");
  assert.equal(missing.response.status, 404);

  const options = await router.handle(
    request("/api/combine", { method: "OPTIONS" }),
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");

  const stream = await router.handle(request("/api/wall/stream"));
  assert.equal(stream.status, 204);
});

test("Edge Function entry reads the console binding named test as a global", async () => {
  globalThis.test = new FakeKV();
  try {
    const { onRequest } = await import("../edge-functions/api/[[default]].js");
    const response = await onRequest({
      request: request("/api/starters"),
      env: {},
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).starters.length, 10);
  } finally {
    delete globalThis.test;
  }
});
