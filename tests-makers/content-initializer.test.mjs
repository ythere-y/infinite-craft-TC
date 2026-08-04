import assert from "node:assert/strict";
import test from "node:test";

import {
  BOUNTY_CONTENT,
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../edge-functions/_generated/bounty-content.js";
import { createContentInitializer } from "../edge-functions/_lib/content-initializer.js";
import {
  entityKey,
  normalizePair,
  sha256Hex,
} from "../edge-functions/_lib/keys.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { FakeKV } from "./fake-kv.mjs";

const NOW = 1_700_000_000_000;

function readyKv(overrides = {}, options = {}) {
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
  }, options);
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

test("an older initializer never regresses a higher persisted epoch", async () => {
  const future = {
    epoch: CONTENT_EPOCH + 1,
    catalog_digest: "sha256:future-epoch",
    catalog_version: "3.0.0",
    status: "ready",
    mode: "ready",
    phase: "ready",
    cursor: null,
    index: 0,
    started_at: NOW,
    completed_at: NOW,
    error: "",
  };
  const kv = new FakeKV({
    system_content_state: JSON.stringify(future),
    future_runtime_data: JSON.stringify({ keep: true }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.ready, false);
  assert.equal(result.blocked_by_newer_target, true);
  assert.deepEqual(result.status, future);
  assert.equal(kv.putCalls, 0);
  assert.equal(kv.deleteCalls, 0);
  assert.ok(await kv.get("future_runtime_data"));
});

test("same-epoch rolling deploys preserve a higher catalog semver", async () => {
  const currentVersion = BOUNTY_CONTENT.catalog.meta.version;
  const future = {
    epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:future-catalog",
    catalog_version: `${Number(currentVersion.split(".")[0]) + 1}.0.0`,
    status: "ready",
    mode: "ready",
    phase: "ready",
    cursor: null,
    index: 0,
    started_at: NOW,
    completed_at: NOW,
    error: "",
  };
  const kv = new FakeKV({
    system_content_state: JSON.stringify(future),
    future_runtime_data: JSON.stringify({ keep: true }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.ready, false);
  assert.equal(result.blocked_by_newer_target, true);
  assert.deepEqual(result.status, future);
  assert.equal(kv.putCalls, 0);
  assert.equal(kv.deleteCalls, 0);
  assert.ok(await kv.get("future_runtime_data"));
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

test("differential offset scans remove all 400 stale seed combinations", async () => {
  const kv = readyKv(
    { catalog_digest: "sha256:obsolete" },
    { cursorMode: "offset" },
  );
  const staleKeys = [];
  for (let index = 0; index < 400; index += 1) {
    const a = `旧种子甲${index}`;
    const b = `旧种子乙${index}`;
    const key = await entityKey("combo", normalizePair(a, b));
    staleKeys.push(key);
    await kv.put(key, JSON.stringify({
      a,
      b,
      result: `旧种子结果${index}`,
      emoji: "🧹",
      source: "seed",
      content_epoch: CONTENT_EPOCH,
      catalog_digest: "sha256:obsolete",
    }));
  }
  const initializer = createContentInitializer({
    kv,
    batchSize: 37,
    workBudget: 1,
    now: () => NOW,
  });

  await runToReady(initializer);

  assert.deepEqual(
    staleKeys.filter((key) => kv.values.has(key)),
    [],
  );
});

test("delayed state writes cannot regress ready content back to migrating", async () => {
  class DelayedFirstMigrationWriteKV extends FakeKV {
    constructor() {
      super();
      this.armed = false;
      this.delayed = false;
      this.readyObserved = new Promise((resolve) => {
        this.resolveReadyObserved = resolve;
      });
    }

    arm() {
      this.armed = true;
    }

    async put(key, value) {
      const state = key === "system_content_state"
        ? JSON.parse(value)
        : null;
      if (
        this.armed &&
        !this.delayed &&
        state?.status === "migrating"
      ) {
        this.delayed = true;
        await Promise.race([
          this.readyObserved,
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
      await super.put(key, value);
      if (this.armed && state?.status === "ready") {
        this.resolveReadyObserved();
      }
    }
  }

  const kv = new DelayedFirstMigrationWriteKV();
  await runToReady(createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  }));
  await kv.put("system_content_state", JSON.stringify({
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode: "differential",
    phase: "verify_catalog",
    cursor: null,
    index: 0,
    scan: null,
    started_at: NOW,
    completed_at: null,
    error: "",
  }));
  kv.arm();
  const slow = createContentInitializer({
    kv,
    batchSize: 1,
    workBudget: 1,
    now: () => NOW,
  });
  const fast = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });

  await Promise.all([
    slow.ensureInitialized(),
    fast.ensureInitialized(),
  ]);

  const status = JSON.parse(await kv.get("system_content_state"));
  const sampleKey = await entityKey("combo", normalizePair("电脑", "网络"));
  assert.equal(status.status, "ready");
  assert.equal(status.mode, "ready");
  assert.equal(status.phase, "ready");
  assert.equal(JSON.parse(await kv.get(sampleKey)).result, "互联网");
});

test("replayed stale purge preserves already-current seed records", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      mode: "epoch_reset",
      phase: "purge_runtime_data",
      cursor: null,
      index: 0,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
  });
  const store = new KvStore(kv, { now: () => NOW });
  await store.putCombination("电脑", "网络", {
    result: "互联网",
    emoji: "🌐",
    comment: "电脑通过网络连接成互联网。",
    source: "seed",
    chain: "internet",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
  });
  const sampleKey = await entityKey("combo", normalizePair("电脑", "网络"));

  await createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 1,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(JSON.parse(await kv.get(sampleKey)).result, "互联网");
});

test("differential retirement preserves a shared LLM result and exact indexes", async () => {
  const kv = readyKv({ catalog_digest: "sha256:obsolete" });
  const store = new KvStore(kv, { now: () => NOW });
  await store.putCombination("动态甲", "动态乙", {
    result: "共享旧结果",
    emoji: "✨",
    comment: "玩家动态公式。",
    source: "llm",
    chain: "ai",
  });
  await store.putCombination("旧种子甲", "旧种子乙", {
    result: "共享旧结果",
    emoji: "🧹",
    comment: "需要退休的旧固定公式。",
    source: "seed",
    chain: "legacy",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:obsolete",
  });

  const dynamicPair = normalizePair("动态甲", "动态乙");
  const stalePair = normalizePair("旧种子甲", "旧种子乙");
  const dynamicComboKey = await entityKey("combo", dynamicPair);
  const staleComboKey = await entityKey("combo", stalePair);
  const dynamicRecipeKey =
    `recipe_${await sha256Hex("共享旧结果")}_${await sha256Hex(dynamicPair)}`;
  const staleRecipeKey =
    `recipe_${await sha256Hex("共享旧结果")}_${await sha256Hex(stalePair)}`;
  const elementKey = await entityKey("element", "共享旧结果");
  const indexKey = store.indexKey(
    "element",
    store.shardForCanonicalKey("element", elementKey),
  );

  await runToReady(createContentInitializer({
    kv,
    batchSize: 13,
    workBudget: 1,
    now: () => NOW,
  }));

  assert.ok(await kv.get(dynamicComboKey));
  assert.ok(await kv.get(dynamicRecipeKey));
  assert.equal(await kv.get(staleComboKey), null);
  assert.equal(await kv.get(staleRecipeKey), null);
  assert.equal((await store.getElement("共享旧结果")).source, "llm");
  assert.equal(
    JSON.parse(await kv.get(indexKey)).items[elementKey].source,
    "llm",
  );
});

test("recipe-first combination deletion completes after a second-step failure", async () => {
  class FailSecondTargetDeleteKV extends FakeKV {
    constructor(initial) {
      super(initial);
      this.targets = new Set();
      this.steps = 0;
      this.armed = false;
    }

    arm(targets) {
      this.targets = new Set(targets);
      this.steps = 0;
      this.armed = true;
    }

    async delete(key) {
      if (this.armed && this.targets.has(key)) {
        this.steps += 1;
        if (this.steps === 2) {
          this.armed = false;
          throw new Error("second combination delete failed");
        }
      }
      return super.delete(key);
    }
  }

  const kv = new FailSecondTargetDeleteKV(
    Object.fromEntries(readyKv({
      catalog_digest: "sha256:obsolete",
    }).values),
  );
  const store = new KvStore(kv, { now: () => NOW });
  await store.putCombination("旧配方甲", "旧配方乙", {
    result: "旧配方结果",
    emoji: "🧹",
    source: "seed",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:obsolete",
  });
  const pair = normalizePair("旧配方甲", "旧配方乙");
  const comboKey = await entityKey("combo", pair);
  const recipeKey =
    `recipe_${await sha256Hex("旧配方结果")}_${await sha256Hex(pair)}`;
  kv.arm([recipeKey, comboKey]);
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });

  await assert.rejects(
    initializer.ensureInitialized(),
    /second combination delete failed/,
  );
  await runToReady(initializer);

  assert.equal(await kv.get(recipeKey), null);
  assert.equal(await kv.get(comboKey), null);
});

test("index-first element deletion completes after a second-step failure", async () => {
  class FailSecondElementDeleteStepKV extends FakeKV {
    arm({ elementKey, indexKey }) {
      this.elementKey = elementKey;
      this.indexKey = indexKey;
      this.steps = 0;
      this.armed = true;
    }

    async put(key, value) {
      if (
        this.armed &&
        key === this.indexKey &&
        !Object.hasOwn(JSON.parse(value).items, this.elementKey)
      ) {
        this.steps += 1;
        if (this.steps === 2) {
          this.armed = false;
          throw new Error("second element delete step failed");
        }
      }
      return super.put(key, value);
    }

    async delete(key) {
      if (this.armed && key === this.elementKey) {
        this.steps += 1;
        if (this.steps === 2) {
          this.armed = false;
          throw new Error("second element delete step failed");
        }
      }
      return super.delete(key);
    }
  }

  const kv = new FailSecondElementDeleteStepKV(
    Object.fromEntries(readyKv({
      catalog_digest: "sha256:obsolete",
    }).values),
  );
  const store = new KvStore(kv, { now: () => NOW });
  await store.rememberElement("旧孤立元素", {
    emoji: "🧹",
    category: "legacy",
    source: "seed",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:obsolete",
  });
  const elementKey = await entityKey("element", "旧孤立元素");
  const indexKey = store.indexKey(
    "element",
    store.shardForCanonicalKey("element", elementKey),
  );
  kv.arm({ elementKey, indexKey });
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });

  await assert.rejects(
    initializer.ensureInitialized(),
    /second element delete step failed/,
  );
  await runToReady(initializer);

  assert.equal(await kv.get(elementKey), null);
  assert.equal(
    Object.hasOwn(JSON.parse(await kv.get(indexKey)).items, elementKey),
    false,
  );
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

test("legacy seed records without an epoch are reconciled", async () => {
  const kv = readyKv({ catalog_digest: "sha256:obsolete" });
  const store = new KvStore(kv, { now: () => NOW });
  await store.putCombination("旧甲", "旧乙", {
    result: "旧结果",
    emoji: "🧹",
    source: "seed",
  });
  await store.rememberElement("孤立旧元素", {
    emoji: "🧹",
    category: "legacy",
    source: "seed",
  });

  await runToReady(createContentInitializer({
    kv,
    batchSize: 11,
    workBudget: 1,
    now: () => NOW,
  }));

  assert.equal(await store.getCombination("旧甲", "旧乙"), null);
  assert.equal(await store.getElement("旧结果"), null);
  assert.equal(await store.getElement("孤立旧元素"), null);
});

test("malformed combo and element JSON are quarantined without retry loops", async () => {
  const comboKey = `combo_${"a".repeat(64)}`;
  const elementKey = `element_${"b".repeat(64)}`;
  const kv = readyKv(
    { catalog_digest: "sha256:obsolete" },
    { cursorMode: "offset" },
  );
  await kv.put(comboKey, "{broken combo");
  await kv.put(elementKey, "{broken element");

  await runToReady(createContentInitializer({
    kv,
    batchSize: 17,
    workBudget: 1,
    now: () => NOW,
  }));

  assert.equal(await kv.get(comboKey), null);
  assert.equal(await kv.get(elementKey), null);
});

test("malformed persisted state conservatively restarts epoch reset", async () => {
  const kv = new FakeKV({
    system_content_state: "{broken state",
    player_runtime_data: JSON.stringify({ keep: false }),
  });
  const initializer = createContentInitializer({
    kv,
    batchSize: 3,
    workBudget: 1,
    now: () => NOW,
  });

  const first = await initializer.ensureInitialized();
  const persisted = JSON.parse(await kv.get("system_content_state"));

  assert.equal(first.status.mode, "epoch_reset");
  assert.equal(persisted.epoch, CONTENT_EPOCH);
  assert.equal(persisted.catalog_digest, CATALOG_DIGEST);
  assert.equal(persisted.status, "migrating");
  assert.equal(kv.values.has("player_runtime_data"), false);
});

test("differential state cannot enter purge_runtime_data", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      mode: "differential",
      phase: "purge_runtime_data",
      cursor: null,
      index: 0,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
    player_runtime_data: JSON.stringify({ keep: true }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.status.mode, "differential");
  assert.notEqual(result.status.phase, "purge_runtime_data");
  assert.ok(await kv.get("player_runtime_data"));
});

test("migrating state cannot claim the ready phase", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      mode: "differential",
      phase: "ready",
      cursor: null,
      index: 0,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.ready, false);
  assert.notEqual(result.status.phase, "ready");
});

test("missing mode at purge conservatively restarts epoch reset", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      phase: "purge_runtime_data",
      cursor: null,
      index: 0,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
    player_runtime_data: JSON.stringify({ keep: false }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.status.mode, "epoch_reset");
  assert.equal(kv.values.has("player_runtime_data"), false);
});

test("epoch reset cannot skip purge without durable completion proof", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      mode: "epoch_reset",
      phase: "seed_elements",
      cursor: null,
      index: 50,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
    player_runtime_data: JSON.stringify({ keep: false }),
  });

  const result = await createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 2,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.status.mode, "epoch_reset");
  assert.equal(result.status.purge_completed, true);
  assert.equal(kv.values.has("player_runtime_data"), false);
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

test("one purge work unit never deletes more than batchSize records", async () => {
  const kv = new FakeKV({
    ...Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `legacy_${String(index).padStart(2, "0")}`,
        JSON.stringify({ index }),
      ]),
    ),
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "migrating",
      mode: "epoch_reset",
      phase: "purge_runtime_data",
      cursor: "3",
      index: 3,
      purge_pass: 0,
      purge_deleted: 3,
      purge_completed: false,
      started_at: NOW,
      completed_at: null,
      error: "",
    }),
  }, { cursorMode: "offset" });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  });
  const beforeDeletes = kv.deleteCalls;

  await initializer.ensureInitialized();

  assert.ok(kv.deleteCalls - beforeDeletes <= 2);
});

test("epoch reset wins an interleaved migrating-mode conflict", async () => {
  class InterleavedModeKV extends FakeKV {
    async put(key, value) {
      await super.put(key, value);
      const state = key === "system_content_state"
        ? JSON.parse(value)
        : null;
      if (
        !this.injected &&
        state?.status === "migrating" &&
        state?.mode === "epoch_reset"
      ) {
        this.injected = true;
        await super.put(key, JSON.stringify({
          ...state,
          mode: "differential",
          phase: "verify_catalog",
          purge_completed: false,
        }));
      }
    }
  }

  const kv = new InterleavedModeKV({
    system_content_state: JSON.stringify({
      epoch: 1,
      catalog_digest: "sha256:epoch1",
      status: "ready",
      mode: "ready",
      phase: "ready",
    }),
    player_runtime_data: JSON.stringify({ keep: false }),
  });
  const result = await createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => NOW,
  }).ensureInitialized();

  assert.equal(result.status.mode, "epoch_reset");
  assert.equal(kv.values.has("player_runtime_data"), false);
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

test("catalog verification rejects incorrect fixed element fields", async () => {
  const kv = new FakeKV();
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });
  await runToReady(initializer);
  const elementKey = await entityKey("element", "水");
  const element = JSON.parse(await kv.get(elementKey));
  await kv.put(elementKey, JSON.stringify({
    ...element,
    emoji: "❌",
  }));
  await kv.put("system_content_state", JSON.stringify({
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode: "differential",
    phase: "verify_catalog",
    cursor: null,
    index: 0,
    scan: null,
    started_at: NOW,
    completed_at: null,
    error: "",
  }));

  await assert.rejects(
    initializer.ensureInitialized(),
    /catalog verification failed for element:水/,
  );
});

test("catalog verification rejects incorrect fixed combination fields", async () => {
  const kv = new FakeKV();
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });
  await runToReady(initializer);
  const comboKey = await entityKey("combo", normalizePair("电脑", "网络"));
  const combo = JSON.parse(await kv.get(comboKey));
  await kv.put(comboKey, JSON.stringify({
    ...combo,
    emoji: "❌",
  }));
  await kv.put("system_content_state", JSON.stringify({
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode: "differential",
    phase: "verify_catalog",
    cursor: null,
    index: 0,
    scan: null,
    started_at: NOW,
    completed_at: null,
    error: "",
  }));

  await assert.rejects(
    initializer.ensureInitialized(),
    /catalog verification failed for combination:电脑 \+ 网络/,
  );
});

test("catalog verification rejects a missing exact recipe record", async () => {
  const kv = new FakeKV();
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });
  await runToReady(initializer);
  const pair = normalizePair("电脑", "网络");
  const recipeKey =
    `recipe_${await sha256Hex("互联网")}_${await sha256Hex(pair)}`;
  await kv.delete(recipeKey);
  await kv.put("system_content_state", JSON.stringify({
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode: "differential",
    phase: "verify_catalog",
    cursor: null,
    index: 0,
    scan: null,
    started_at: NOW,
    completed_at: null,
    error: "",
  }));

  await assert.rejects(
    initializer.ensureInitialized(),
    /catalog verification failed for combination:电脑 \+ 网络/,
  );
});

test("catalog verification rejects a missing exact element index entry", async () => {
  const kv = new FakeKV();
  const initializer = createContentInitializer({
    kv,
    batchSize: 256,
    workBudget: 10_000,
    now: () => NOW,
  });
  await runToReady(initializer);
  const store = new KvStore(kv, { now: () => NOW });
  const elementKey = await entityKey("element", "水");
  const indexKey = store.indexKey(
    "element",
    store.shardForCanonicalKey("element", elementKey),
  );
  const index = JSON.parse(await kv.get(indexKey));
  delete index.items[elementKey];
  await kv.put(indexKey, JSON.stringify(index));
  await kv.put("system_content_state", JSON.stringify({
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode: "differential",
    phase: "verify_catalog",
    cursor: null,
    index: 0,
    scan: null,
    started_at: NOW,
    completed_at: null,
    error: "",
  }));

  await assert.rejects(
    initializer.ensureInitialized(),
    /catalog verification failed for element:水/,
  );
});
