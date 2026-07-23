import assert from "node:assert/strict";
import test from "node:test";

import {
  entityKey,
  normalizePair,
} from "../edge-functions/_lib/keys.js";
import { DEFAULT_COMMENT } from "../edge-functions/_lib/comments.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { FakeKV } from "./fake-kv.mjs";

test("KV keys are legal, stable and combination order independent", async () => {
  assert.equal(normalizePair(" 水 ", "火"), normalizePair("火", "水"));

  const keyA = await entityKey("combo", normalizePair("水", "火"));
  const keyB = await entityKey("combo", normalizePair("火", "水"));
  assert.equal(keyA, keyB);
  assert.match(keyA, /^combo_[a-f0-9]{64}$/);
  assert.doesNotMatch(keyA, /[\u4e00-\u9fff: +]/);
});

test("dynamic combinations are created as JSON records", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });

  assert.equal(await store.getCombination("水", "AI"), null);
  await store.putCombination("水", "AI", {
    result: "智能水",
    emoji: "🧠",
    comment: DEFAULT_COMMENT,
    source: "llm",
    chain: null,
  });

  assert.deepEqual(await store.getCombination("AI", "水"), {
    a: "AI",
    b: "水",
    result: "智能水",
    emoji: "🧠",
    comment: DEFAULT_COMMENT,
    source: "llm",
    chain: null,
    hit_count: 0,
    ts: 1_700_000_000,
  });
});

test("JSON records are decoded from plain Makers KV text reads", async () => {
  class TextOnlyKV extends FakeKV {
    async get(key, options) {
      if (options !== undefined) {
        throw new Error("typed JSON reads are unavailable");
      }
      return super.get(key);
    }
  }

  const store = new KvStore(
    new TextOnlyKV({
      snapshot_recent: JSON.stringify({ items: [{ result: "蒸汽" }] }),
    }),
  );

  assert.deepEqual(await store.getJson("snapshot_recent"), {
    items: [{ result: "蒸汽" }],
  });
  assert.deepEqual(await store.getJson("missing", { items: [] }), {
    items: [],
  });
});

test("first discovery keeps the earliest claimant and powers pagination", async () => {
  let now = 1_700_000_000_000;
  const store = new KvStore(new FakeKV(), { now: () => now });

  const first = await store.recordFirst("蒸汽", "♨️", "勇敢鹅");
  now += 1_000;
  const duplicate = await store.recordFirst("蒸汽", "♨️", "后来鹅");
  const second = await store.recordFirst("云", "☁️", "后来鹅");

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.discoverer, "勇敢鹅");
  assert.equal(second.record.seq, 2);

  const page = await store.firstPage({ offset: 0, limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.has_more, true);
  assert.equal(page.items[0].result, "云");

  const leaderboard = await store.leaderboard({ limit: 10, me: "勇敢鹅" });
  assert.deepEqual(leaderboard.me, { rank: 1, firsts: 1 });
  assert.equal(leaderboard.total_players, 2);
});

test("nickname claims, session KPI and key listing use the namespace", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });

  assert.equal(await store.claimNickname("全力以赴的KPI鹅"), true);
  assert.equal(await store.claimNickname("全力以赴的KPI鹅"), false);
  assert.deepEqual(await store.touchNickname("另一个鹅"), {
    ok: true,
    nickname: "另一个鹅",
    created: true,
  });
  assert.equal(await store.nicknameCount(), 2);
  const nicknameListCalls = kv.listCalls;
  assert.equal(await store.nicknameCount(), 2);
  assert.equal(kv.listCalls, nicknameListCalls);
  assert.ok(
    [...kv.values.keys()].filter((key) => key.startsWith("nickcount_")).length <=
      16,
  );

  assert.equal(await store.addKpi("session 中文", 30, "tencent +30"), 30);
  assert.equal(await store.addKpi("session 中文", 20, "worker +20"), 50);
  assert.equal(await store.kpiTotal("session 中文"), 50);
});

test("canonical first and element records repair overwritten view snapshots", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });

  await store.recordFirst("元素甲", "🅰️", "甲鹅");
  await store.recordFirst("元素乙", "🅱️", "乙鹅");
  await store.rememberElement("元素甲", {
    emoji: "🅰️",
    category: "ai",
    depth: 3,
  });
  await store.rememberElement("元素乙", {
    emoji: "🅱️",
    category: "ai",
    depth: 4,
  });

  await kv.put("snapshot_recent", JSON.stringify({ items: [] }));
  await kv.put("snapshot_elements", JSON.stringify({}));

  const page = await store.firstPage({ offset: 0, limit: 10 });
  const elements = await store.dynamicElements();
  assert.equal(page.total, 2);
  assert.deepEqual(
    new Set(page.items.map((item) => item.result)),
    new Set(["元素甲", "元素乙"]),
  );
  assert.equal(elements["元素甲"].depth, 3);
  assert.equal(elements["元素乙"].depth, 4);
  assert.ok([...kv.values.keys()].some((key) => key.startsWith("element_")));
});

test("recipes and sharded KPI totals survive session cache loss", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });

  await store.putCombination("甲", "乙", {
    result: "共同结果",
    emoji: "✨",
    source: "llm",
    chain: null,
  });
  await store.putCombination("丙", "丁", {
    result: "共同结果",
    emoji: "✨",
    source: "llm",
    chain: null,
  });
  for (const key of [...kv.values.keys()]) {
    if (key.startsWith("recipes_")) await kv.delete(key);
  }

  await store.addKpi("recoverable-session", 30, "one");
  await store.addKpi("recoverable-session", 20, "two");
  for (const key of [...kv.values.keys()]) {
    if (key.startsWith("session_")) {
      await kv.put(key, JSON.stringify({ total: 0, events: [] }));
    }
  }

  assert.equal((await store.dynamicRecipes("共同结果")).length, 2);
  assert.equal(await store.kpiTotal("recoverable-session"), 50);
  assert.ok([...kv.values.keys()].some((key) => key.startsWith("recipe_")));
  assert.ok([...kv.values.keys()].some((key) => key.startsWith("kpi_")));
});

test("first and element indexes reconcile incrementally instead of scanning hot paths", async () => {
  let now = 1_700_000_000_000;
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => now });

  await store.recordFirst("可恢复首发", "🧭", "索引鹅");
  await store.rememberElement("可恢复元素", {
    emoji: "🧭",
    category: "ai",
    depth: 8,
  });

  await store.firstPage({ offset: 0, limit: 40 });
  await store.dynamicElements();
  const reconciledCalls = kv.listCalls;
  await store.firstPage({ offset: 0, limit: 40 });
  await store.dynamicElements();
  assert.equal(kv.listCalls, reconciledCalls);

  now += 61_000;
  await store.firstPage({ offset: 0, limit: 40 });
  await store.dynamicElements();
  assert.ok(kv.listCalls > reconciledCalls);
  assert.ok(kv.listCalls <= reconciledCalls + 2);
});

test("rotating reconciliation restores canonical records lost from an index shard", async () => {
  let now = 1_700_000_000_000;
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => now });
  await store.recordFirst("索引丢失首发", "🧯", "修复鹅");
  await store.rememberElement("索引丢失元素", {
    emoji: "🧯",
    category: "ai",
    depth: 9,
  });
  for (const key of [...kv.values.keys()]) {
    if (key.startsWith("index_first_") || key.startsWith("index_element_")) {
      await kv.delete(key);
    }
  }
  await kv.put("snapshot_recent", JSON.stringify({ items: [], total: 0 }));
  await kv.put("snapshot_elements", JSON.stringify({}));

  let page;
  let elements;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    page = await store.firstPage({ offset: 0, limit: 40 });
    elements = await store.dynamicElements();
    now += 61_000;
  }
  assert.ok(page.items.some((item) => item.result === "索引丢失首发"));
  assert.equal(elements["索引丢失元素"].depth, 9);
  assert.ok(kv.listCalls <= 32);
});

test("KPI persistence uses a fixed number of shards per session", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  for (let index = 0; index < 100; index += 1) {
    await store.addKpi("bounded-session", 1, "bounded");
  }

  assert.equal(await store.kpiTotal("bounded-session"), 100);
  const keys = [...kv.values.keys()].filter((key) => key.startsWith("kpi_"));
  assert.ok(keys.length <= 32);
});

test("analytics aggregate bounded stats shards instead of one global counter", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  await store.recordCombineActivity({
    sessionId: "stats-a",
    a: "水",
    b: "火",
    result: "蒸汽",
    emoji: "♨️",
    source: "seed",
    chain: "classic",
  });
  await store.recordCombineActivity({
    sessionId: "stats-b",
    a: "企鹅",
    b: "工牌",
    result: "打工鹅",
    emoji: "🐧",
    source: "seed",
    chain: "tencent",
  });
  await kv.put("snapshot_stats", JSON.stringify({ total_calls: 0 }));

  const stats = await store.adminStats();
  assert.equal(stats.total_calls, 2);
  assert.equal(stats.active_sessions, 2);
  assert.equal(stats.top_combinations.length, 2);
  const keys = [...kv.values.keys()].filter((key) => /^stats_[a-f]$/u.test(key));
  assert.ok(keys.length <= 16);
});

test("recent wall snapshots stay bounded while deep history remains pageable", async () => {
  let now = 1_700_000_000_000;
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => now });
  for (let index = 0; index < 520; index += 1) {
    await store.recordFirst(`历史元素${index}`, "🧱", "历史鹅");
    now += 1_000;
  }

  const recent = JSON.parse(kv.values.get("snapshot_recent"));
  assert.equal(recent.items.length, 500);
  assert.ok(
    new TextEncoder().encode(kv.values.get("snapshot_recent")).byteLength <
      1_000_000,
  );

  const deep = await store.firstPage({ offset: 500, limit: 20 });
  assert.equal(deep.items.length, 20);
  assert.equal(deep.items[0].result, "历史元素19");
  assert.equal(deep.items[19].result, "历史元素0");
  assert.equal(deep.has_more, false);
  assert.equal(deep.total, 520);
});

test("ten thousand indexed firsts use bounded hot-path KV operations", async () => {
  const initial = {
    indexmeta_first: JSON.stringify({
      next_shard: 0,
      next_reconcile_at: 1_800_000_000,
    }),
  };
  const recentItems = [];
  const shards = "0123456789abcdef";
  const shardSnapshots = Object.fromEntries(
    [...shards].map((shard) => [
      shard,
      { items: {}, reconciled_at: 1_700_000_000 },
    ]),
  );
  for (let index = 0; index < 10_000; index += 1) {
    const record = {
      result: `规模元素${index}`,
      emoji: "🧪",
      discoverer: `规模鹅${index % 100}`,
      ts: 1_700_000_000 + index,
      seq: index + 1,
    };
    const shard = shards[index % shards.length];
    const key = `first_${shard}${String(index).padStart(63, "0")}`;
    shardSnapshots[shard].items[key] = record;
    if (index >= 9_500) recentItems.unshift(record);
  }
  for (const shard of shards) {
    initial[`index_first_${shard}`] = JSON.stringify(
      shardSnapshots[shard],
    );
  }
  initial.snapshot_recent = JSON.stringify({
    items: recentItems,
    total: 10_000,
    initialized: true,
  });
  for (const [key, value] of Object.entries(initial)) {
    assert.ok(
      new TextEncoder().encode(value).byteLength < 1_000_000,
      `${key} must stay below the strict Makers KV value limit`,
    );
  }

  const kv = new FakeKV(initial);
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  const page = await store.firstPage({ offset: 0, limit: 40 });
  assert.equal(page.items.length, 40);
  assert.equal(page.total, 10_000);
  assert.equal(kv.listCalls, 0);
  assert.ok(kv.getCalls <= 2);

  kv.getCalls = 0;
  const leaderboard = await store.leaderboard({ limit: 10 });
  assert.equal(leaderboard.total_players, 100);
  assert.equal(kv.listCalls, 0);
  assert.ok(kv.getCalls <= 18);
});
