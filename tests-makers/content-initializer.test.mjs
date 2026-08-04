import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../edge-functions/_generated/bounty-content.js";
import { createContentInitializer } from "../edge-functions/_lib/content-initializer.js";
import { entityKey, normalizePair } from "../edge-functions/_lib/keys.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { FakeKV } from "./fake-kv.mjs";

const NOW = 1_700_000_000_000;

function readyKv(overrides = {}) {
  return new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "ready",
      mode: "ready",
      phase: "ready",
      cursor: null,
      index: 0,
      started_at: NOW,
      completed_at: NOW,
      error: "",
      ...overrides,
    }),
  });
}

async function runToReady(initializer, firstResult = null) {
  let result = firstResult ?? await initializer.ensureInitialized();
  for (let attempt = 0; attempt < 10_000 && !result.ready; attempt += 1) {
    result = await initializer.ensureInitialized();
  }
  assert.equal(result.ready, true, "initializer did not converge");
  return result;
}

test("epoch 1 KV is purged and seeded in resumable batches", async () => {
  const kv = new FakeKV({
    combo_legacy: JSON.stringify({
      a: "打工鹅",
      b: "时间",
      result: "美团",
      source: "seed",
    }),
    first_legacy: JSON.stringify({ result: "美团" }),
  });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  });

  const first = await initializer.ensureInitialized();
  assert.equal(first.ready, false);
  assert.equal(first.status.epoch, CONTENT_EPOCH);
  assert.equal(first.status.status, "migrating");
  assert.ok(kv.deleteCalls <= 2);

  const result = await runToReady(initializer, first);
  assert.equal(result.status.status, "ready");
  assert.equal(kv.values.has("combo_legacy"), false);
  assert.equal(kv.values.has("first_legacy"), false);

  const sampleKey = await entityKey("combo", normalizePair("电脑", "网络"));
  const sample = JSON.parse(await kv.get(sampleKey));
  assert.equal(sample.result, "互联网");
  assert.equal(sample.source, "seed");
  assert.equal(sample.content_epoch, CONTENT_EPOCH);
  assert.equal(sample.catalog_digest, CATALOG_DIGEST);
});

test("ready matching epoch and digest performs no writes", async () => {
  const kv = readyKv();
  const before = new Map(kv.values);
  const beforePuts = kv.putCalls;
  const beforeDeletes = kv.deleteCalls;

  const result = await createContentInitializer({ kv }).ensureInitialized();

  assert.equal(result.ready, true);
  assert.deepEqual(kv.values, before);
  assert.equal(kv.putCalls, beforePuts);
  assert.equal(kv.deleteCalls, beforeDeletes);
});

test("same epoch digest change preserves dynamic records", async () => {
  const kv = readyKv({ catalog_digest: "sha256:obsolete" });
  const store = new KvStore(kv, { now: () => NOW });
  await store.putCombination("动态甲", "动态乙", {
    result: "动态结果",
    emoji: "✨",
    comment: "由测试 AI 生成。",
    source: "llm",
  });
  await store.rememberElement("玩家元素", {
    emoji: "🧑",
    category: "dynamic",
    source: "llm",
  });
  await store.putCombination("旧种子甲", "旧种子乙", {
    result: "旧种子结果",
    emoji: "🧹",
    comment: "已从当前目录删除。",
    source: "seed",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:obsolete",
  });

  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
  });
  const result = await runToReady(initializer);

  assert.equal(result.status.mode, "ready");
  assert.ok(await store.getCombination("动态甲", "动态乙"));
  assert.ok(await store.getElement("玩家元素"));
  assert.equal(await store.getCombination("旧种子甲", "旧种子乙"), null);
  assert.equal(await store.getElement("旧种子结果"), null);
});

test("failed purge persists an error and resumes idempotently", async () => {
  class OneDeleteFailureKV extends FakeKV {
    constructor(initial) {
      super(initial);
      this.shouldFail = true;
    }

    async delete(key) {
      if (this.shouldFail && key === "combo_legacy") {
        this.shouldFail = false;
        throw new Error("simulated purge interruption");
      }
      return super.delete(key);
    }
  }

  const kv = new OneDeleteFailureKV({
    combo_legacy: JSON.stringify({ source: "seed" }),
    first_legacy: JSON.stringify({ result: "legacy" }),
  });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  });

  await assert.rejects(
    initializer.ensureInitialized(),
    /simulated purge interruption/,
  );
  const failed = await initializer.readStatus();
  assert.equal(failed.status, "migrating");
  assert.equal(failed.phase, "purge_runtime_data");
  assert.match(failed.error, /simulated purge interruption/);

  await runToReady(initializer);
  assert.equal(kv.values.has("combo_legacy"), false);
  assert.equal(kv.values.has("first_legacy"), false);
});

test("an in-progress epoch reset stays destructive across a digest change", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: "sha256:interrupted",
      status: "migrating",
      mode: "epoch_reset",
      phase: "purge_runtime_data",
      cursor: "opaque-old-cursor",
      index: 20,
      started_at: NOW - 1_000,
      completed_at: null,
      error: "interrupted",
    }),
    first_legacy: JSON.stringify({ result: "must be purged" }),
  });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  });

  const first = await initializer.ensureInitialized();
  assert.equal(first.status.mode, "epoch_reset");
  assert.equal(first.status.started_at, NOW - 1_000);

  await runToReady(initializer, first);
  assert.equal(kv.values.has("first_legacy"), false);
});

test("purge rescans safely when offset cursors shift after deletion", async () => {
  const legacy = Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `legacy_${String(index).padStart(2, "0")}`,
      JSON.stringify({ index }),
    ]),
  );
  const kv = new FakeKV(legacy, { cursorMode: "offset" });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  });

  await runToReady(initializer);

  assert.deepEqual(
    [...kv.values.keys()].filter((key) => key.startsWith("legacy_")),
    [],
  );
});

test("concurrent initializers converge through persisted idempotent state", async () => {
  const kv = new FakeKV({
    ...Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [
        `legacy_${String(index).padStart(2, "0")}`,
        JSON.stringify({ index }),
      ]),
    ),
    system_content_state: JSON.stringify({
      epoch: 1,
      catalog_digest: "sha256:epoch1",
      status: "ready",
      phase: "ready",
    }),
  });
  const left = createContentInitializer({
    kv,
    batchSize: 3,
    workBudget: 1,
  });
  const right = createContentInitializer({
    kv,
    batchSize: 3,
    workBudget: 1,
  });

  let results = [{ ready: false }, { ready: false }];
  for (
    let attempt = 0;
    attempt < 10_000 && !results.every((item) => item.ready);
    attempt += 1
  ) {
    results = await Promise.all([
      left.ensureInitialized(),
      right.ensureInitialized(),
    ]);
  }

  const status = JSON.parse(await kv.get("system_content_state"));
  const sampleKey = await entityKey("combo", normalizePair("电脑", "网络"));
  const sample = JSON.parse(await kv.get(sampleKey));
  assert.equal(status.status, "ready");
  assert.equal(status.epoch, CONTENT_EPOCH);
  assert.equal(status.catalog_digest, CATALOG_DIGEST);
  assert.equal(sample.result, "互联网");
  assert.equal(
    [...kv.values.keys()].filter((key) => key === sampleKey).length,
    1,
  );
  assert.deepEqual(
    [...kv.values.keys()].filter((key) => key.startsWith("legacy_")),
    [],
  );
});
