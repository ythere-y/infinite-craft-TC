import assert from "node:assert/strict";
import test from "node:test";

import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { createRouter } from "../edge-functions/_lib/router.js";
import {
  MAX_COMBINE_ELEMENT_LENGTH,
  MAX_DISCOVERER_LENGTH,
  MAX_RECIPE_FIELD_LENGTH,
  MAX_SESSION_ID_LENGTH,
  MAX_VERIFY_RECIPES,
} from "../edge-functions/_generated/runtime-contract-data.js";
import { FakeKV } from "./fake-kv.mjs";

function request(path, { method = "GET", body, headers = {} } = {}) {
  return new Request(`https://makers.example${path}`, {
    method,
    headers: {
      ...(body == null ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

function makeRouter({
  kv = new FakeKV(),
  fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '{"name":"边缘咖啡","emoji":"☕","comment":"边缘一杯，灵感起飞。"}',
            },
          },
        ],
      }),
      { status: 200 },
    ),
} = {}) {
  return createRouter({
    kv,
    env: {
      APP_ENV: "test",
      DASHBOARD_PUBLIC: "1",
      ADMIN_TOKEN: "test-admin",
      SESSION_SECRET: "test-secret",
      MAKERS_MODELS_KEY: "secret",
      AI_GATEWAY_MODEL: "test-model",
    },
    now: () => 1_700_000_000_000,
    random: () => 0,
    fetchImpl,
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
  assert.equal(starters.body.starters.length, 11);
  assert.deepEqual(
    starters.body.starters.find((item) => item.name === "水")?.icon,
    {
      base: "💧",
      palette: "nature",
      source: "fallback",
    },
  );

  const elements = await json(router, "/api/elements");
  assert.ok(elements.body.elements["企鹅"]);
  assert.deepEqual(elements.body.elements["企鹅"].icon, {
    base: "🐧",
    palette: "product",
    source: "fallback",
  });

  const tiers = await json(router, "/api/tiers");
  assert.deepEqual(tiers.body, {
    tiers: [],
    level_rules: {
      base_star_cost: 300,
      star_cost_step: 20,
      merge_base: 4,
      icons: ["👑", "🌞", "🌙", "🌟"],
    },
  });

  const rank = await json(router, "/api/rank?total=59520");
  assert.equal(rank.body.total, 59_520);
  assert.equal(rank.body.icons, "👑🌟");
  assert.equal(rank.body.level_units, 65);
  assert.equal(rank.body.topped, false);
  assert.ok(!("to_next" in rank.body));
  assert.ok(!("next_floor" in rank.body));

  const defaultPage = await json(router, "/api/wall/page");
  assert.equal(defaultPage.body.limit, 100);

  const health = await json(router, "/api/health");
  assert.equal(health.body.kv, "ok");
  assert.equal(health.body.llm, "configured");
  assert.equal(health.body.llm_config.model, "test-model");
  assert.equal("apiKey" in health.body.llm_config, false);
  assert.equal(health.body.security.dashboard, "public");
  assert.equal(health.body.security.model_calls_per_minute, 20);
});

test("aliases resolve before fixed formula lookup", async () => {
  const kv = new FakeKV();
  const router = makeRouter({ kv });
  const response = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "地下城与勇士",
      b: "QQ会员",
      discoverer: "测试鹅",
      session_id: "alias-test",
    },
  });

  assert.equal(response.body.result, "黑钻");
  assert.equal(response.body.a, "DNF");
  assert.equal(response.body.b, "QQ会员");

  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  const stored = await store.getCombination("DNF", "QQ会员");
  assert.equal(stored.a, "DNF");
  assert.equal(
    await store.getCombination("地下城与勇士", "QQ会员"),
    null,
  );
  const analytics = await json(router, "/api/analytics/combinations");
  assert.equal(analytics.body.items[0].key, "DNF + QQ会员");

  const verified = await json(router, "/api/recipes/verify", {
    method: "POST",
    body: {
      recipes: [
        {
          a: "地下城与勇士",
          b: "QQ会员",
          result: "黑钻",
          emoji: "💬",
        },
      ],
    },
  });
  assert.deepEqual(verified.body.valid, [
    {
      a: "DNF",
      b: "QQ会员",
      result: "黑钻",
      emoji: "💬",
    },
  ]);
});

test("prototype-named non-alias combine inputs remain strings", async () => {
  const router = makeRouter();

  for (const name of ["toString", "constructor", "__proto__"]) {
    const response = await json(router, "/api/combine", {
      method: "POST",
      body: {
        a: name,
        b: "未知搭档",
        discoverer: "测试鹅",
        session_id: `prototype-combine-${name}`,
      },
    });

    assert.equal(response.response.status, 200, name);
    assert.equal(response.body.a, name);
    assert.equal(typeof response.body.a, "string");
  }
});

test("prototype-named non-alias recipe targets remain strings", async () => {
  const router = makeRouter();

  for (const name of ["toString", "constructor", "__proto__"]) {
    const response = await json(
      router,
      `/api/element/${encodeURIComponent(name)}/recipes`,
    );

    assert.equal(response.response.status, 200, name);
    assert.equal(response.body.result, name);
    assert.ok(Array.isArray(response.body.recipes));
  }
});

test("aliases stay canonical through model, KV, community and recipe lookups", async () => {
  const kv = new FakeKV();
  let modelBody;
  const router = makeRouter({
    kv,
    fetchImpl: async (_url, init) => {
      modelBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"name":"宠物搭档","emoji":"🎮","comment":"宠物也找到了并肩作战的搭档。"}',
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const response = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "Q宠大乱斗",
      b: "未知搭档",
      discoverer: "测试鹅",
      session_id: "alias-model-test",
    },
  });

  assert.equal(response.body.a, "Q宠大乐斗");
  assert.equal(response.body.b, "未知搭档");
  assert.match(modelBody.messages.at(-1).content, /Q宠大乐斗/u);
  assert.doesNotMatch(modelBody.messages.at(-1).content, /Q宠大乱斗/u);

  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  const stored = await store.getCombination("Q宠大乐斗", "未知搭档");
  assert.equal(stored.a, "Q宠大乐斗");
  assert.equal(
    await store.getCombination("Q宠大乱斗", "未知搭档"),
    null,
  );
  const formula = JSON.parse(
    kv.values.get(`community_formula_${response.body.formula_id}`),
  );
  assert.equal(formula.a, "Q宠大乐斗");
  assert.equal(formula.b, "未知搭档");
  const analytics = await json(router, "/api/analytics/combinations");
  assert.equal(analytics.body.items[0].key, "Q宠大乐斗 + 未知搭档");

  const recipes = await json(
    router,
    `/api/element/${encodeURIComponent("Q宠大乱斗")}/recipes`,
  );
  assert.equal(recipes.body.result, "Q宠大乐斗");
  assert.equal(recipes.body.count, 1);
  assert.equal(recipes.body.recipes[0].a, "QQ宠物");
});

test("dynamic KV metadata never overwrites authoritative seed elements", async () => {
  const persistedIcon = {
    base: "🪨",
    badge: "🧭",
    palette: "place",
    source: "generated",
  };
  const router = createRouter({
    kv: new FakeKV({
      snapshot_elements: JSON.stringify({
        "企鹅": {
          emoji: "❌",
          category: "ai",
          depth: 99,
          icon: persistedIcon,
        },
      }),
    }),
    env: {},
  });
  const elements = await json(router, "/api/elements");
  assert.equal(elements.body.elements["企鹅"].emoji, "🐧");
  assert.equal(elements.body.elements["企鹅"].category, "tencent");
  assert.deepEqual(elements.body.elements["企鹅"].icon, persistedIcon);
});

test("legacy KV elements gain response icons across element projections", async () => {
  const legacySnapshot = JSON.stringify({
    "旧咖啡": { emoji: "☕", category: "ai", depth: 2 },
  });
  const kv = new FakeKV({ snapshot_elements: legacySnapshot });
  const router = createRouter({ kv, env: {} });
  const expected = {
    base: "☕",
    badge: "🧩",
    palette: "product",
    source: "generated",
  };

  const elements = await json(router, "/api/elements");
  assert.deepEqual(elements.body.elements["旧咖啡"], {
    emoji: "☕",
    category: "ai",
    depth: 2,
    icon: expected,
  });

  const category = await json(router, "/api/wall/category/ai");
  const legacyItem = category.body.items.find(
    (item) => item.name === "旧咖啡",
  );
  assert.deepEqual(legacyItem.icon, expected);
  assert.equal(kv.values.get("snapshot_elements"), legacySnapshot);
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
  assert.deepEqual(combine.body.icon, {
    base: "♨️",
    palette: "nature",
    source: "fallback",
  });

  const page = await json(router, "/api/wall/page?offset=0&limit=40");
  assert.equal(page.body.total, 1);
  assert.equal(page.body.items[0].discoverer, "测试鹅");
  assert.deepEqual(page.body.items[0].icon, combine.body.icon);
  assert.deepEqual(page.body.items[0].reaction, {
    up_votes: 0,
    down_votes: 0,
    net_score: 0,
    my_vote: null,
  });

  const playerCookie = combine.response.headers.get("set-cookie");
  const reaction = await json(router, `/api/wall/elements/${encodeURIComponent("蒸汽")}/vote`, {
    method: "PUT",
    headers: playerCookie ? { cookie: playerCookie } : {},
    body: { value: 1 },
  });
  assert.equal(reaction.body.net_score, 1);
  assert.equal(reaction.body.my_vote, 1);
  const reactionCancelled = await json(router, `/api/wall/elements/${encodeURIComponent("蒸汽")}/vote`, {
    method: "PUT",
    headers: playerCookie ? { cookie: playerCookie } : {},
    body: { value: 1 },
  });
  assert.equal(reactionCancelled.body.net_score, 0);
  assert.equal(reactionCancelled.body.my_vote, null);

  const publish = await json(router, `/api/community/formulas/${combine.body.formula_id}/publish`, {
    method: "POST",
    headers: playerCookie ? { cookie: playerCookie } : {},
  });
  assert.equal(publish.response.status, 200);
  const pageWithFormula = await json(router, "/api/wall/page?offset=0&limit=40", {
    headers: playerCookie ? { cookie: playerCookie } : {},
  });
  assert.equal(pageWithFormula.body.items[0].formula.id, combine.body.formula_id);
  assert.equal(pageWithFormula.body.items[0].formula.a, "水");
  assert.equal(pageWithFormula.body.items[0].formula.b, "火");
  assert.deepEqual(
    pageWithFormula.body.items[0].formula.result_icon,
    combine.body.icon,
  );
  assert.deepEqual(pageWithFormula.body.items[0].formula.a_icon, {
    base: "💧",
    palette: "nature",
    source: "fallback",
  });
  assert.deepEqual(pageWithFormula.body.items[0].formula.b_icon, {
    base: "🔥",
    palette: "nature",
    source: "fallback",
  });

  const formulas = await json(router, "/api/community/formulas");
  assert.deepEqual(formulas.body.items[0].result_icon, combine.body.icon);
  assert.deepEqual(
    formulas.body.items[0].a_icon,
    pageWithFormula.body.items[0].formula.a_icon,
  );
  assert.deepEqual(
    formulas.body.items[0].b_icon,
    pageWithFormula.body.items[0].formula.b_icon,
  );

  const leaderboard = await json(
    router,
    "/api/wall/leaderboard?limit=20&me=%E6%B5%8B%E8%AF%95%E9%B9%85",
  );
  assert.deepEqual(leaderboard.body.me, { rank: 1, firsts: 1 });

  const bounty = await json(router, "/api/wall/bounty");
  assert.ok(bounty.body.total > 0);
  assert.ok(Array.isArray(bounty.body.groups));
  const riot = bounty.body.groups
    .flatMap((group) => group.items)
    .find((item) => item.name === "Riot Games");
  assert.deepEqual(riot.icon, {
    base: "👊",
    badge: "🎮",
    palette: "studio",
    source: "curated",
  });

  const admin = await json(router, "/api/admin/stats");
  assert.equal(admin.body.approximate, true);
  assert.equal(admin.body.total_calls, 1);
  assert.equal(admin.body.firsts_total, 1);
  assert.equal(admin.body.nick_count, 1);
  assert.equal(admin.body.recent_firsts[0].result, "蒸汽");
  assert.deepEqual(admin.body.recent_firsts[0].icon, combine.body.icon);
});

test("merged fixed community flow keeps formula, player, pagination and admin contracts", async () => {
  const router = makeRouter();
  const combined = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "火",
      b: "火",
      discoverer: "测试鹅",
      session_id: "community-contract-session",
    },
  });
  assert.equal(combined.response.status, 200);
  assert.equal(combined.body.result, "光");
  assert.equal(typeof combined.body.formula_id, "string");
  const playerCookie = combined.response.headers.get("set-cookie");
  assert.match(playerCookie, /^craft_player=/);
  const formulaId = combined.body.formula_id;

  const published = await json(router, `/api/community/formulas/${formulaId}/publish`, {
    method: "POST",
    headers: { cookie: playerCookie },
  });
  assert.equal(published.response.status, 200);
  assert.deepEqual(
    {
      id: published.body.formula.id,
      result: published.body.formula.result,
      version: published.body.formula.version,
      net_score: published.body.formula.net_score,
      my_vote: published.body.formula.my_vote,
    },
    {
      id: formulaId,
      result: "光",
      version: 1,
      net_score: 0,
      my_vote: null,
    },
  );

  const vote = await json(router, `/api/community/formulas/${formulaId}/vote`, {
    method: "PUT",
    headers: { cookie: playerCookie },
    body: { value: 1 },
  });
  assert.equal(vote.response.status, 200);
  assert.deepEqual(
    {
      id: vote.body.id,
      result: vote.body.result,
      version: vote.body.version,
      net_score: vote.body.net_score,
      my_vote: vote.body.my_vote,
    },
    {
      id: formulaId,
      result: "光",
      version: 1,
      net_score: 1,
      my_vote: 1,
    },
  );

  const page = await json(router, "/api/community/formulas?limit=7&offset=0", {
    headers: { cookie: playerCookie },
  });
  assert.equal(page.response.status, 200);
  const listed = page.body.items.find((item) => item.id === formulaId);
  assert.deepEqual(
    {
      id: listed?.id,
      result: listed?.result,
      version: listed?.version,
      net_score: listed?.net_score,
      my_vote: listed?.my_vote,
    },
    {
      id: formulaId,
      result: "光",
      version: 1,
      net_score: 1,
      my_vote: null,
    },
  );

  const detail = await json(router, `/api/community/formulas/${formulaId}`, {
    headers: { cookie: playerCookie },
  });
  assert.equal(detail.response.status, 200);
  assert.deepEqual(
    {
      id: detail.body.id,
      result: detail.body.result,
      version: detail.body.version,
      net_score: detail.body.net_score,
      my_vote: detail.body.my_vote,
    },
    {
      id: formulaId,
      result: "光",
      version: 1,
      net_score: 1,
      my_vote: 1,
    },
  );

  const login = await json(router, "/api/community/admin/login", {
    method: "POST",
    body: { key: "test-admin" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.ok, true);
  const adminCookie = login.response.headers.get("set-cookie");
  assert.match(adminCookie, /^craft_admin=/);

  const logout = await json(router, "/api/community/admin/logout", {
    method: "POST",
    headers: { cookie: adminCookie },
  });
  assert.equal(logout.response.status, 200);
  assert.equal(logout.body.ok, true);
  assert.match(logout.response.headers.get("set-cookie"), /craft_admin=;/);
  assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
  assert.match(logout.response.headers.get("set-cookie"), /Path=\//);
  assert.match(logout.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(logout.response.headers.get("set-cookie"), /SameSite=Strict/);
  assert.match(logout.response.headers.get("set-cookie"), /Secure/);

  const crossOriginLogout = await json(router, "/api/community/admin/logout", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(crossOriginLogout.response.status, 403);
});

test("community list HTTP accepts tolerant pagination inputs", async () => {
  const router = makeRouter();
  const formulas = [];
  for (const [index, pair] of [["水", "火"], ["水", "土"], ["火", "火"]].entries()) {
    const combined = await json(router, "/api/combine", {
      method: "POST",
      body: {
        a: pair[0],
        b: pair[1],
        discoverer: "测试鹅",
        session_id: `community-page-${index}`,
      },
    });
    const cookie = combined.response.headers.get("set-cookie");
    await json(router, `/api/community/formulas/${combined.body.formula_id}/publish`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    });
    formulas.push(combined.body.formula_id);
  }

  for (const [suffix, length] of [
    ["", 3],
    ["?limit=", 3],
    ["?limit=nope", 3],
    ["?limit=Infinity", 3],
    ["?limit=0x0", 3],
    ["?limit=0b0", 3],
    ["?limit=0o0", 3],
    ["?limit=0_0", 3],
    ["?limit=%EF%BB%BF1", 3],
    ["?limit=2.8", 2],
    ["?limit=.5", 1],
    ["?limit=1.", 1],
    ["?limit=1e2", 3],
    ["?limit=-1", 1],
    ["?limit=0", 1],
    ["?limit=999", 3],
    ["?offset=", 3],
    ["?offset=nope", 3],
    ["?offset=Infinity", 3],
    ["?offset=0x1", 3],
    ["?offset=0b1", 3],
    ["?offset=0o1", 3],
    ["?offset=0_0", 3],
    ["?offset=%EF%BB%BF1", 3],
    ["?offset=1.8", 2],
    ["?offset=1e0", 2],
    ["?offset=-1", 3],
    ["?offset=10000001", 0],
    ["?limit=1&limit=2", 2],
    ["?limit=&limit=2", 2],
    ["?offset=0&offset=1", 2],
  ]) {
    const page = await json(router, `/api/community/formulas${suffix}`);
    assert.equal(page.response.status, 200, `status ${suffix}`);
    assert.equal(page.body.items.length, length, suffix);
  }
  assert.equal(formulas.length, 3);
});

test("community detail returns 404 after an administrator takedown", async () => {
  const router = makeRouter();
  const combined = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "水",
      b: "火",
      discoverer: "测试鹅",
      session_id: "community-takedown-session",
    },
  });
  const playerCookie = combined.response.headers.get("set-cookie");
  const formulaId = combined.body.formula_id;
  await json(router, `/api/community/formulas/${formulaId}/publish`, {
    method: "POST",
    headers: playerCookie ? { cookie: playerCookie } : {},
  });
  const beforeTakedown = await json(router, `/api/community/formulas/${formulaId}`);
  assert.equal(beforeTakedown.response.status, 200);

  const login = await json(router, "/api/community/admin/login", {
    method: "POST",
    body: { key: "test-admin" },
  });
  const adminCookie = login.response.headers.get("set-cookie");
  const moderated = await json(router, `/api/community/admin/formulas/${formulaId}/moderate`, {
    method: "POST",
    headers: adminCookie ? { cookie: adminCookie } : {},
    body: { action: "takedown", reason_code: "unsafe" },
  });
  assert.equal(moderated.response.status, 200);

  const detail = await json(router, `/api/community/formulas/${formulaId}`);
  assert.equal(detail.response.status, 404);
});

test("router carries raised prompt limits and one style draw into the model request", async () => {
  const positiveIds = Array.from({ length: 9 }, (_, index) => `positive_${index}`);
  const retiredIds = ["retired_priority", "retired_recent_duplicate"];
  const initial = {
    snapshot_recent: JSON.stringify({
      items: Array.from({ length: 31 }, (_, index) => ({
        result: `最近结果${index}`,
        emoji: "🧪",
        discoverer: "测试鹅",
        ts: index,
        seq: index + 1,
      })),
      total: 31,
      initialized: true,
    }),
    snapshot_elements: JSON.stringify({
      "测试输入甲": { emoji: "🅰️", category: "tencent" },
      "测试输入乙": { emoji: "🅱️", category: "tencent" },
    }),
    community_public_formulas: JSON.stringify([
      ...positiveIds,
      ...retiredIds,
    ]),
  };
  for (const [index, id] of positiveIds.entries()) {
    initial[`community_formula_${id}`] = JSON.stringify({
      id,
      a: `社区输入${index}`,
      b: "会议",
      result: `社区结果${index}`,
      emoji: "🗓️",
      comment: "有效示例",
      visibility: "public",
      status: "active",
      up_votes: 20,
      down_votes: 0,
      updated_at: index,
    });
  }
  initial.community_formula_retired_priority = JSON.stringify({
    id: "retired_priority",
    result: "退役优先",
    visibility: "public",
    status: "retired",
  });
  initial.community_formula_retired_recent_duplicate = JSON.stringify({
    id: "retired_recent_duplicate",
    result: "最近结果30",
    visibility: "public",
    status: "retired",
  });

  let capturedBody;
  let randomCalls = 0;
  const router = createRouter({
    kv: new FakeKV(initial),
    env: {
      APP_ENV: "test",
      SESSION_SECRET: "test-secret",
      MAKERS_MODELS_KEY: "secret",
    },
    promptLimits: {
      avoid_words: 31,
      community_examples: 9,
      bounty_candidates: 13,
    },
    random: () => {
      randomCalls += 1;
      return 0.30;
    },
    now: () => 1_700_000_000_000,
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content:
                '{"name":"共享上限","emoji":"📏","comment":"上游不再提前截断。"}',
            },
          }],
        }),
        { status: 200 },
      );
    },
  });

  const response = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "测试输入甲",
      b: "测试输入乙",
      discoverer: "测试鹅",
      session_id: "prompt-limit-session",
    },
  });

  assert.equal(response.body.result, "共享上限");
  const user = capturedBody.messages[1].content;
  assert.match(user, /最近结果30/u);
  assert.match(user, /社区输入8/u);
  const avoidSection = user
    .split("【avoid_words（禁词，不要再用）】\n")[1]
    .split("\n\n【悬赏候选")[0];
  const avoidWords = avoidSection.split("、");
  assert.equal(avoidWords.length, 31);
  assert.deepEqual(avoidWords.slice(0, 2), ["退役优先", "最近结果30"]);
  assert.equal(
    avoidWords.filter((item) => item === "最近结果30").length,
    1,
  );
  assert.equal(avoidWords.at(-1), "最近结果1");
  assert.equal(avoidWords.includes("最近结果0"), false);
  const bountySection = user
    .split("【悬赏候选（未解锁 · 若语义顺理成章，请优先产出其中一个）】")[1]
    .split("（以上词语义不合适就忽略，不要硬塞。）")[0];
  assert.equal((bountySection.match(/^- /gmu) || []).length, 13);
  assert.match(user, /【本次偏好】偏具体场景/u);
  assert.equal(randomCalls, 1);
});

test("combine responses expose increasing global popularity", async () => {
  const router = makeRouter();
  const body = {
    a: "水",
    b: "火",
    discoverer: "测试鹅",
    session_id: "popularity-session",
  };

  const first = await json(router, "/api/combine", {
    method: "POST",
    body,
  });
  const repeated = await json(router, "/api/combine", {
    method: "POST",
    body: { ...body, a: "火", b: "水" },
  });

  assert.equal(first.body.result, "蒸汽");
  assert.equal(first.body.hit_count, 1);
  assert.equal(repeated.body.result, "蒸汽");
  assert.equal(repeated.body.hit_count, 2);
});

test("fallback combines do not create popularity records", async () => {
  const kv = new FakeKV();
  const router = createRouter({
    kv,
    env: { APP_ENV: "test" },
    now: () => 1_700_000_000_000,
  });
  const fallback = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "不存在甲",
      b: "不存在乙",
      discoverer: "测试鹅",
      session_id: "fallback-session",
    },
  });

  assert.equal(fallback.body.source, "fallback");
  assert.equal(fallback.body.hit_count, 0);
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  assert.equal(await store.getCombination("不存在甲", "不存在乙"), null);
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
  const waterRecipe = recipes.body.recipes.find((item) => item.a === "水");
  assert.ok(waterRecipe);
  assert.deepEqual(recipes.body.result_icon, {
    base: "♨️",
    palette: "nature",
    source: "fallback",
  });
  assert.deepEqual(waterRecipe.a_icon, {
    base: "💧",
    palette: "nature",
    source: "fallback",
  });
  assert.deepEqual(waterRecipe.b_icon, {
    base: "🔥",
    palette: "nature",
    source: "fallback",
  });
  assert.equal(waterRecipe.comment, "");

  const kpi = await json(router, "/api/session/kpi", {
    method: "POST",
    body: { session_id: "s", delta: 30, reason: "测试" },
  });
  assert.equal(kpi.body.total, 30);

  const score = await json(router, "/api/session/score", {
    method: "POST",
    body: { session_id: "score-session", delta: 300, reason: "测试" },
  });
  assert.equal(score.body.total, 300);

  const sessionRank = await json(router, "/api/session/s/rank");
  assert.equal(sessionRank.body.total, 30);

  for (const path of [
    "/api/analytics/chains",
    "/api/analytics/discoverers",
    "/api/analytics/combinations",
    "/api/nickname/stats",
  ]) {
    const result = await json(router, path);
    assert.equal(result.response.status, 200, path);
  }

  const recent = await json(router, "/api/wall/recent");
  assert.deepEqual(recent.body.items, []);
  const category = await json(router, "/api/wall/category/tencent");
  assert.ok(category.body.items.length > 0);
  assert.ok(category.body.items.every((item) => item.icon));
});

test("dynamic recipe responses preserve their generated comment", async () => {
  const router = makeRouter();
  const generated = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "Riot",
      b: "水",
      discoverer: "测试鹅",
      session_id: "recipe-comment-session",
    },
  });
  assert.equal(generated.body.result, "边缘咖啡");

  const generatedRecipes = await json(
    router,
    `/api/element/${encodeURIComponent("边缘咖啡")}/recipes`,
  );
  assert.equal(generatedRecipes.body.recipes.length, 1);
  assert.equal(
    generatedRecipes.body.recipes[0].comment,
    "边缘一杯，灵感起飞。",
  );
});

test("recipe verification rejects oversized imports and bounds KV concurrency", async () => {
  const oversizedRouter = makeRouter();
  const oversized = await json(oversizedRouter, "/api/recipes/verify", {
    method: "POST",
    body: {
      recipes: Array.from({ length: 501 }, (_, index) => ({
        a: `甲${index}`,
        b: `乙${index}`,
        result: `结果${index}`,
      })),
    },
  });
  assert.equal(oversized.response.status, 400);
  assert.match(oversized.body.detail, /500/);

  class ObservedKV extends FakeKV {
    activeComboReads = 0;
    maxComboReads = 0;

    async get(key, options) {
      if (!key.startsWith("combo_")) return super.get(key, options);
      this.activeComboReads += 1;
      this.maxComboReads = Math.max(
        this.maxComboReads,
        this.activeComboReads,
      );
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await super.get(key, options);
      } finally {
        this.activeComboReads -= 1;
      }
    }
  }

  const kv = new ObservedKV();
  const router = createRouter({ kv, env: {} });
  const bounded = await json(router, "/api/recipes/verify", {
    method: "POST",
    body: {
      recipes: Array.from({ length: 41 }, (_, index) => ({
        a: `未知甲${index}`,
        b: `未知乙${index}`,
        result: `未知结果${index}`,
      })),
    },
  });
  assert.equal(bounded.response.status, 200);
  assert.equal(bounded.body.unknown.length, 41);
  assert.ok(kv.maxComboReads > 1);
  assert.ok(kv.maxComboReads <= 20);
});

test("Makers generated runtime contract exposes the canonical limits", () => {
  assert.deepEqual(
    {
      MAX_COMBINE_ELEMENT_LENGTH,
      MAX_DISCOVERER_LENGTH,
      MAX_SESSION_ID_LENGTH,
      MAX_VERIFY_RECIPES,
      MAX_RECIPE_FIELD_LENGTH,
    },
    {
      MAX_COMBINE_ELEMENT_LENGTH: 80,
      MAX_DISCOVERER_LENGTH: 80,
      MAX_SESSION_ID_LENGTH: 128,
      MAX_VERIFY_RECIPES: 500,
      MAX_RECIPE_FIELD_LENGTH: 80,
    },
  );
});

test("Makers recipe validation rejects unsafe entries before KV reads", async () => {
  const astral = "🪿";

  {
    const kv = new FakeKV();
    const router = createRouter({ kv, env: {} });
    const oversized = await json(router, "/api/recipes/verify", {
      method: "POST",
      body: { recipes: Array.from({ length: 501 }, () => ({})) },
    });
    assert.equal(oversized.response.status, 400);
    assert.equal(kv.getCalls, 0);
  }

  {
    const kv = new FakeKV();
    const router = createRouter({ kv, env: {} });
    const primitive = await json(router, "/api/recipes/verify", {
      method: "POST",
      body: { recipes: [null, 7, "not-an-object"] },
    });
    assert.equal(primitive.response.status, 200);
    assert.deepEqual(primitive.body.invalid, [
      { a: "", b: "", reason: "缺少必填字段" },
      { a: "", b: "", reason: "缺少必填字段" },
      { a: "", b: "", reason: "缺少必填字段" },
    ]);
    assert.equal(kv.getCalls, 0);
  }

  for (const field of ["a", "b", "result"]) {
    const kv = new FakeKV();
    const router = createRouter({ kv, env: {} });
    const recipe = { a: "甲", b: "乙", result: "结果" };
    recipe[field] = astral.repeat(81);
    const overlong = await json(router, "/api/recipes/verify", {
      method: "POST",
      body: { recipes: [recipe] },
    });
    assert.equal(overlong.response.status, 200);
    assert.deepEqual(overlong.body.invalid, [
      { a: recipe.a, b: recipe.b, reason: "字段过长" },
    ]);
    assert.equal(kv.getCalls, 0, field);
  }
});

test("Makers recipe validation treats non-string fields as missing before KV reads", async () => {
  const nonStrings = [7, true, ["数组"], { 对象: "值" }];
  for (const field of ["a", "b", "result"]) {
    for (const value of nonStrings) {
      const kv = new FakeKV();
      const router = createRouter({ kv, env: {} });
      const recipe = { a: "甲", b: "乙", result: "结果" };
      recipe[field] = value;

      const response = await json(router, "/api/recipes/verify", {
        method: "POST",
        body: { recipes: [recipe] },
      });

      assert.equal(response.response.status, 200);
      assert.deepEqual(response.body.invalid, [{
        a: typeof recipe.a === "string" ? recipe.a : "",
        b: typeof recipe.b === "string" ? recipe.b : "",
        reason: "缺少必填字段",
      }], `${field}: ${JSON.stringify(value)}`);
      assert.deepEqual(response.body.unknown, []);
      assert.equal(kv.getCalls, 0, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test("Makers recipe and session score accept exact astral boundaries", async () => {
  const kv = new FakeKV();
  const router = createRouter({ kv, env: {} });
  const astral = "🪿";
  const recipe = await json(router, "/api/recipes/verify", {
    method: "POST",
    body: {
      recipes: [{
        a: astral.repeat(80),
        b: astral.repeat(80),
        result: astral.repeat(80),
      }],
    },
  });
  assert.equal(recipe.response.status, 200);
  assert.deepEqual(recipe.body.invalid, []);
  assert.deepEqual(recipe.body.unknown, [
    { a: astral.repeat(80), b: astral.repeat(80) },
  ]);
  assert.ok(kv.getCalls > 0);

  const score = await json(router, "/api/session/score", {
    method: "POST",
    body: {
      session_id: astral.repeat(128),
      delta: 1,
      reason: "测试",
    },
  });
  assert.equal(score.response.status, 200);
  assert.equal(score.body.total, 1);

  const writesBeforeRejection = kv.values.size;
  const overlong = await json(router, "/api/session/score", {
    method: "POST",
    body: {
      session_id: astral.repeat(129),
      delta: 1,
      reason: "测试",
    },
  });
  assert.equal(overlong.response.status, 400);
  assert.match(overlong.body.detail, /session_id 过长/u);
  assert.equal(kv.values.size, writesBeforeRejection);
});

test("admin and analytics routes support an optional bearer token", async () => {
  const router = createRouter({
    kv: new FakeKV(),
    env: { ADMIN_TOKEN: "private-dashboard-token" },
  });

  const denied = await json(router, "/api/admin/stats");
  assert.equal(denied.response.status, 401);
  assert.match(denied.body.detail, /凭据/);

  const analyticsDenied = await json(router, "/api/analytics/chains");
  assert.equal(analyticsDenied.response.status, 401);

  const allowed = await json(router, "/api/admin/stats", {
    headers: { authorization: "Bearer private-dashboard-token" },
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.approximate, true);
});

test("admin routes fail closed when no access mode is configured", async () => {
  const router = createRouter({ kv: new FakeKV(), env: {} });
  const result = await json(router, "/api/admin/stats");
  assert.equal(result.response.status, 503);
  assert.match(result.body.detail, /ADMIN_TOKEN/);
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
  assert.equal(options.headers.get("access-control-allow-origin"), null);

  const stream = await router.handle(request("/api/wall/stream"));
  assert.equal(stream.status, 204);
});

test("Edge Function entry uses only the production KV global", async () => {
  const productionKv = new FakeKV();
  globalThis.test = productionKv;
  try {
    const { onRequest } = await import("../edge-functions/api/[[default]].js");

    const production = await onRequest({
      request: request("/api/health"),
      env: { APP_ENV: "dev" },
    });
    assert.equal(production.status, 200);
    assert.equal((await production.json()).app_env, "makers");
    assert.equal(productionKv.getCalls, 1);

    const local = await onRequest({
      request: new Request("http://127.0.0.1:8088/api/health"),
      env: {},
    });
    assert.equal(local.status, 500);
    assert.match((await local.json()).detail, /npm run dev/u);
    assert.equal(productionKv.getCalls, 1);
  } finally {
    delete globalThis.test;
  }
});
