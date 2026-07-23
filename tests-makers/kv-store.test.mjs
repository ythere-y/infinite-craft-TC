import assert from "node:assert/strict";
import test from "node:test";

import {
  entityKey,
  normalizePair,
} from "../edge-functions/_lib/keys.js";
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
    source: "llm",
    chain: null,
  });

  assert.deepEqual(await store.getCombination("AI", "水"), {
    a: "AI",
    b: "水",
    result: "智能水",
    emoji: "🧠",
    source: "llm",
    chain: null,
    hit_count: 0,
    ts: 1_700_000_000,
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

  assert.equal(await store.addKpi("session 中文", 30, "tencent +30"), 30);
  assert.equal(await store.addKpi("session 中文", 20, "worker +20"), 50);
  assert.equal(await store.kpiTotal("session 中文"), 50);
});
