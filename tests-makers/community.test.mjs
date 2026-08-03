import assert from "node:assert/strict";
import test from "node:test";

import { PROMPT_SPEC } from "../edge-functions/_generated/prompt-data.js";
import {
  CommunityStore,
  normalizePublicPagination,
} from "../edge-functions/_lib/community.js";
import { sha256Hex } from "../edge-functions/_lib/keys.js";
import { FakeKV } from "./fake-kv.mjs";

function service() {
  return new CommunityStore(new FakeKV(), { now: () => 1_700_000_000_000 });
}

async function hiddenFormula(community) {
  return community.ensureFormula({
    a: "需求", b: "会议", result: "排期", emoji: "📅",
    comment: "需求一开会就有了日期。", source: "llm",
    discoverer: "全球首发者", playerId: "publisher",
  });
}

test("Makers formula publication requires a server-recorded reproduction", async () => {
  const community = service();
  const formula = await hiddenFormula(community);
  assert.deepEqual(await community.listPublic(), []);
  await assert.rejects(() => community.publish(formula.id, "stranger"), /实际复现/);
  const published = await community.publish(formula.id, "publisher");
  assert.equal(published.first_publisher, "publisher");
  assert.equal((await community.listPublic())[0].result, "排期");
});

test("Makers votes switch and cancel without duplicating a player", async () => {
  const community = service();
  const formula = await hiddenFormula(community);
  await community.publish(formula.id, "publisher");
  assert.equal((await community.vote(formula.id, "voter", 1)).net_score, 1);
  assert.equal((await community.vote(formula.id, "voter", -1)).net_score, -1);
  const cancelled = await community.vote(formula.id, "voter", 0);
  assert.deepEqual([cancelled.up_votes, cancelled.down_votes], [0, 0]);
});

test("Makers public formulas can be selected by result for the wall", async () => {
  const community = service();
  const first = await hiddenFormula(community);
  await community.publish(first.id, "publisher");
  await community.vote(first.id, "voter", 1);
  const second = await community.ensureFormula({
    a: "产品", b: "日历", result: "排期", emoji: "🗓️",
    comment: "新的排期。", source: "llm",
    discoverer: "另一个首发者", playerId: "publisher",
  });
  await community.publish(second.id, "publisher");
  await community.vote(second.id, "down-voter", -1);

  const formulas = await community.publicByResults(["排期"], "voter");

  assert.equal(formulas["排期"].id, first.id);
  assert.equal(formulas["排期"].net_score, 1);
  assert.equal(formulas["排期"].my_vote, 1);
});

test("Makers result reactions toggle and group by result", async () => {
  const community = service();

  assert.deepEqual(await community.voteResult("排期", "p1", 1), {
    up_votes: 1,
    down_votes: 0,
    net_score: 1,
    my_vote: 1,
  });
  assert.deepEqual(await community.voteResult("排期", "p1", 1), {
    up_votes: 0,
    down_votes: 0,
    net_score: 0,
    my_vote: null,
  });
  const disliked = await community.voteResult("排期", "p1", -1);
  assert.equal(disliked.down_votes, 1);
  assert.equal(disliked.net_score, -1);
  assert.equal(disliked.my_vote, -1);

  const reactions = await community.reactionsByResults(["排期", "未知"], "p1");
  assert.equal(reactions["排期"].my_vote, -1);
  assert.deepEqual(reactions["未知"], {
    up_votes: 0,
    down_votes: 0,
    net_score: 0,
    my_vote: null,
  });
});

test("Makers hidden active formulas can receive votes without becoming public", async () => {
  const community = service();
  const formula = await hiddenFormula(community);

  const voted = await community.vote(formula.id, "early-voter", 1);

  assert.deepEqual(voted, {
    id: formula.id,
    visibility: "hidden",
    status: "active",
    up_votes: 1,
    down_votes: 0,
    net_score: 1,
    my_vote: 1,
  });
  assert.equal(Object.hasOwn(voted, "result"), false);
  assert.equal(Object.hasOwn(voted, "comment"), false);
  assert.deepEqual(await community.listPublic(), []);
});

test("Makers retirement preserves v1 and allows an active v2", async () => {
  const community = service();
  const first = await hiddenFormula(community);
  await community.publish(first.id, "publisher");
  await community.moderate(first.id, "retire", "community_quality");
  assert.equal((await community.combinationState("需求", "会议")).status, "retired");
  const second = await community.ensureFormula({
    a: "需求", b: "会议", result: "需求排期", emoji: "🗓️",
    comment: "重新生成。", source: "llm", discoverer: "second", playerId: "second",
  });
  assert.equal(second.version, 2);
  assert.equal((await community.combinationState("需求", "会议")).status, "active");
});

test("Makers public listing globally ranks the bounded catalogue before pagination", async () => {
  const community = service();
  const formulas = [];
  for (let index = 0; index < 105; index += 1) {
    const formula = await community.ensureFormula({
      a: `输入${index}`, b: "会议", result: `结果${index}`, emoji: "🗓️",
      comment: "跨页排序。", source: "llm", discoverer: "测试鹅", playerId: "publisher",
    });
    await community.publish(formula.id, "publisher");
    for (let vote = 0; vote < 105 - index; vote += 1) {
      await community.vote(formula.id, `voter-${index}-${vote}`, 1);
    }
    formulas.push(formula);
  }

  const top = await community.listPublic({ limit: 10, offset: 0 });
  assert.deepEqual(top.map((item) => item.id), formulas.slice(0, 10).map((item) => item.id));

  const page = await community.listPublic({ limit: 10, offset: 100 });
  assert.equal(page.length, 5);
  assert.deepEqual(page.map((item) => item.id), formulas.slice(100).map((item) => item.id));
  assert.ok(page.every((item, index, items) =>
    index === 0 || items[index - 1].net_score >= item.net_score,
  ));
  assert.equal((await community.listPublic({ limit: 999, offset: 0 })).length, 100);
});

test("Makers public list uses SQLite BINARY descending ID order for equal scores", async () => {
  const ids = ["a", "B", "Z"];
  const kv = new FakeKV({
    community_public_formulas: JSON.stringify(ids),
    ...Object.fromEntries(ids.map((id) => [
      `community_formula_${id}`,
      JSON.stringify({
        id,
        a: "输入",
        b: "会议",
        result: `结果${id}`,
        emoji: "🗓️",
        comment: "同分同时间。",
        visibility: "public",
        status: "active",
        up_votes: 7,
        down_votes: 0,
        published_at: 1_700_000_000,
      }),
    ])),
  });
  const community = new CommunityStore(kv);

  assert.deepEqual(
    (await community.listPublic({ limit: 10 })).map((item) => item.id),
    ["a", "Z", "B"],
  );
});

test("Makers public list normalizes direct pagination inputs like the HTTP contract", async () => {
  const ids = ["page_3", "page_2", "page_1"];
  const kv = new FakeKV({
    community_public_formulas: JSON.stringify(ids),
    ...Object.fromEntries(ids.map((id, index) => [
      `community_formula_${id}`,
      JSON.stringify({
        id,
        a: "输入",
        b: "会议",
        result: `结果${id}`,
        emoji: "🗓️",
        comment: "分页边界。",
        visibility: "public",
        status: "active",
        up_votes: 3 - index,
        down_votes: 0,
        published_at: 1_700_000_000 - index,
      }),
    ])),
  });
  const community = new CommunityStore(kv);

  for (const { options, expected } of [
    { options: {}, expected: ids },
    { options: { limit: undefined }, expected: ids },
    { options: { limit: null }, expected: ids },
    { options: { limit: "" }, expected: ids },
    { options: { limit: "nope" }, expected: ids },
    { options: { limit: Number.NaN }, expected: ids },
    { options: { limit: Number.POSITIVE_INFINITY }, expected: ids },
    { options: { limit: "0x0" }, expected: ids },
    { options: { limit: "0b0" }, expected: ids },
    { options: { limit: "0o0" }, expected: ids },
    { options: { limit: "0_0" }, expected: ids },
    { options: { limit: "\uFEFF1" }, expected: ids },
    { options: { limit: 0 }, expected: ["page_3"] },
    { options: { limit: -1 }, expected: ["page_3"] },
    { options: { limit: 2.8 }, expected: ["page_3", "page_2"] },
    { options: { limit: " \t2.8\r" }, expected: ["page_3", "page_2"] },
    { options: { limit: ".5" }, expected: ["page_3"] },
    { options: { limit: "1." }, expected: ["page_3"] },
    { options: { limit: "1e2" }, expected: ids },
    { options: { limit: 999 }, expected: ids },
    { options: { offset: undefined }, expected: ids },
    { options: { offset: null }, expected: ids },
    { options: { offset: "" }, expected: ids },
    { options: { offset: "nope" }, expected: ids },
    { options: { offset: Number.NaN }, expected: ids },
    { options: { offset: Number.POSITIVE_INFINITY }, expected: ids },
    { options: { offset: "0x1" }, expected: ids },
    { options: { offset: "0b1" }, expected: ids },
    { options: { offset: "0o1" }, expected: ids },
    { options: { offset: "0_0" }, expected: ids },
    { options: { offset: "\uFEFF1" }, expected: ids },
    { options: { offset: -2 }, expected: ids },
    { options: { offset: 1.8 }, expected: ["page_2", "page_1"] },
    { options: { offset: "1e0" }, expected: ["page_2", "page_1"] },
    { options: { offset: ".5" }, expected: ids },
    { options: { offset: 10_000_001 }, expected: [] },
  ]) {
    assert.deepEqual(
      (await community.listPublic(options)).map((item) => item.id),
      expected,
      JSON.stringify(options),
    );
  }
  assert.deepEqual(
    normalizePublicPagination({ limit: 999, offset: 10_000_001 }),
    { limit: 100, offset: 10_000_000 },
  );
  assert.deepEqual(
    normalizePublicPagination({ limit: "0x0", offset: "\uFEFF1" }),
    { limit: 50, offset: 0 },
  );
});

test("Makers public formula detail includes the caller vote and hides non-public formulas", async () => {
  const community = service();
  const target = await hiddenFormula(community);
  await community.publish(target.id, "publisher");
  await community.vote(target.id, "voter", 1);

  const detail = await community.publicFormula(target.id, "voter");
  assert.equal(detail.id, target.id);
  assert.equal(detail.my_vote, 1);

  const hidden = await community.ensureFormula({
    a: "隐藏", b: "会议", result: "隐藏结果", emoji: "🙈",
    comment: "不公开。", source: "llm", discoverer: "测试鹅", playerId: "player",
  });
  assert.equal(await community.publicFormula(hidden.id, "player"), null);

  await community.moderate(target.id, "takedown", "unsafe");
  assert.equal(await community.publicFormula(target.id, "player"), null);
});

test("Makers feedback can supply more examples when prompt limits increase", async () => {
  const positiveIds = Array.from(
    { length: 101 },
    (_, index) => `positive_${index}`,
  );
  const negativeIds = Array.from(
    { length: 101 },
    (_, index) => `negative_${index}`,
  );
  const initial = {
    community_public_formulas: JSON.stringify([...positiveIds, ...negativeIds]),
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
  for (const [index, id] of negativeIds.entries()) {
    initial[`community_formula_${id}`] = JSON.stringify({
      id,
      result: `退役结果${index}`,
      visibility: "hidden",
      status: "retired",
      up_votes: 0,
      down_votes: 0,
      updated_at: index,
    });
  }
  const community = new CommunityStore(new FakeKV(initial));

  const feedback = await community.feedback(
    {},
    { positiveLimit: 101, negativeLimit: 101 },
  );

  assert.equal(feedback.positives.length, 101);
  assert.equal(feedback.positives.at(-1).name, "社区结果0");
  assert.equal(feedback.negatives.length, 101);
  assert.equal(feedback.negatives.at(-1), "退役结果0");
});

test("Makers feedback reads the complete catalogue in 50-record batches before ranking", async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `formula_${index}`);
  const initial = {
    community_public_formulas: JSON.stringify(ids),
  };
  for (const [index, id] of ids.entries()) {
    initial[`community_formula_${id}`] = JSON.stringify({
      id,
      a: "社区输入",
      b: "会议",
      result: `目录结果${index}`,
      emoji: "🗓️",
      comment: "目录示例",
      visibility: index === 0 ? "public" : "hidden",
      status: index === 1 ? "retired" : "active",
      up_votes: index === 0 ? 20 : 0,
      down_votes: 0,
    });
  }
  const kv = new FakeKV(initial);
  const community = new CommunityStore(kv);

  const feedback = await community.feedback(
    {},
    { positiveLimit: 1, negativeLimit: 1 },
  );

  assert.deepEqual(feedback.positives.map((item) => item.name), ["目录结果0"]);
  assert.deepEqual(feedback.negatives, ["目录结果1"]);
  assert.equal(
    kv.getCalls,
    102,
    "one public-index read, two 50-record catalogue batches, and retirement index",
  );
});

test("Makers feedback ranks enabled qualified formulas and recent retirements", async () => {
  let now = 1_700_000_000_000;
  const community = new CommunityStore(new FakeKV(), { now: () => now });
  const formulas = [];
  for (const [result, upVotes, downVotes, enabled] of [
    ["第二净赞", 13, 1, true],
    ["禁止进入AI", 99, 0, false],
    ["最高净赞", 15, 1, true],
  ]) {
    const formula = await community.ensureFormula({
      a: `${result}输入`, b: "会议", result, emoji: "🗓️", comment: "反馈排序。",
      source: "llm", discoverer: "测试鹅", playerId: "publisher",
    });
    await community.publish(formula.id, "publisher");
    for (let vote = 0; vote < upVotes; vote += 1) {
      await community.vote(formula.id, `${result}-up-${vote}`, 1);
    }
    for (let vote = 0; vote < downVotes; vote += 1) {
      await community.vote(formula.id, `${result}-down-${vote}`, -1);
    }
    if (!enabled) {
      const stored = await community.get(`community_formula_${formula.id}`);
      stored.ai_positive_enabled = false;
      await community.put(`community_formula_${formula.id}`, stored);
    }
    formulas.push(formula);
  }

  const earlyRetirement = await community.ensureFormula({
    a: "先退役输入", b: "会议", result: "先退役", emoji: "🗓️", comment: "退役时序。",
    source: "llm", discoverer: "测试鹅", playerId: "publisher",
  });
  await community.publish(earlyRetirement.id, "publisher");
  now += 1_000;
  await community.moderate(earlyRetirement.id, "retire", "community_quality");
  const lateRetirement = await community.ensureFormula({
    a: "后退役输入", b: "会议", result: "后退役", emoji: "🗓️", comment: "退役时序。",
    source: "llm", discoverer: "测试鹅", playerId: "publisher",
  });
  await community.publish(lateRetirement.id, "publisher");
  now += 1_000;
  await community.moderate(lateRetirement.id, "retire", "community_quality");

  const feedback = await community.feedback({
    FORMULA_UP_THRESHOLD: "10",
    FORMULA_UP_MIN_VOTES: "12",
  });

  assert.deepEqual(
    feedback.positives.map((item) => item.name),
    ["最高净赞", "第二净赞"],
  );
  assert.ok(!feedback.positives.some((item) => item.name === "禁止进入AI"));
  assert.deepEqual(feedback.negatives.slice(0, 2), ["后退役", "先退役"]);
});

test("Makers feedback preserves legacy retirement source order when times tie", async () => {
  const community = new CommunityStore(new FakeKV({
    community_retired_formulas: JSON.stringify([
      { id: "a_index_first", result: "索引先", retired_at: 0 },
      { id: "b_index_second", result: "索引后", retired_at: 0 },
    ]),
    community_public_formulas: JSON.stringify([
      "z_public_first",
      "y_public_second",
      "new_public",
    ]),
    community_formula_z_public_first: JSON.stringify({
      id: "z_public_first", result: "公开先", visibility: "public", status: "retired",
    }),
    community_formula_y_public_second: JSON.stringify({
      id: "y_public_second", result: "公开后", visibility: "public", status: "retired", updated_at: 0,
    }),
    community_formula_new_public: JSON.stringify({
      id: "new_public", result: "较新退役", visibility: "public", status: "retired", updated_at: 20,
    }),
  }));

  const feedback = await community.feedback({}, { positiveLimit: 0, negativeLimit: 5 });

  assert.deepEqual(feedback.negatives, [
    "较新退役",
    "索引先",
    "索引后",
    "公开先",
    "公开后",
  ]);
});

test("Makers retirement catalogue is retryable without affecting takedowns", async () => {
  class RetirementIndexFaultKV extends FakeKV {
    constructor() {
      super();
      this.failRetirementIndex = true;
    }

    async put(key, value) {
      if (key === "community_retired_formulas" && this.failRetirementIndex) {
        this.failRetirementIndex = false;
        throw new Error("retirement index unavailable");
      }
      return super.put(key, value);
    }
  }

  const kv = new RetirementIndexFaultKV();
  const community = new CommunityStore(kv);
  const retired = await hiddenFormula(community);
  const takenDown = await community.ensureFormula({
    a: "下架", b: "会议", result: "下架结果", emoji: "🚫", comment: "不应记入退役。",
    source: "llm", discoverer: "测试鹅", playerId: "publisher",
  });

  await assert.rejects(
    () => community.moderate(retired.id, "retire", "community_quality"),
    /retirement index unavailable/,
  );
  assert.equal((await community.get(`community_formula_${retired.id}`)).status, "retired");
  await community.moderate(retired.id, "retire", "community_quality");
  await community.moderate(takenDown.id, "takedown", "unsafe");

  const catalogue = await community.get("community_retired_formulas");
  assert.deepEqual(catalogue.map((item) => item.id), [retired.id]);
  assert.equal((await community.get(`community_formula_${takenDown.id}`)).status, "takedown");
});

test("Makers retirement catalogue retains its newest unique records", async () => {
  const community = service();
  const capacity = PROMPT_SPEC.capacities.community_formula_catalog;
  for (let index = 0; index <= capacity; index += 1) {
    await community.rememberRetired({
      id: `retired_${index}`,
      result: `退役结果${index}`,
      retired_at: index,
    });
  }
  await community.rememberRetired({
    id: "retired_1",
    result: "重试后的退役结果",
    retired_at: capacity + 1,
  });

  const catalogue = await community.get("community_retired_formulas");
  assert.equal(catalogue.length, capacity);
  assert.deepEqual(catalogue[0], {
    id: "retired_1",
    result: "重试后的退役结果",
    retired_at: capacity + 1,
  });
  assert.equal(catalogue.filter((item) => item.id === "retired_1").length, 1);
  assert.equal(catalogue.some((item) => item.id === "retired_0"), false);
});

test("Makers reconciliation retires a conflicting published formula and is write-idempotent", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  await community.publish(old.id, "seed-player");
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null, playerId: "seed-player",
  };

  const active = await community.reconcileAuthoritativeFormula(seed);

  assert.equal(active.version, 2);
  assert.equal(active.result, "水塘");
  assert.equal(active.source, "seed");
  assert.equal(active.visibility, "hidden");
  const retired = await community.get(`community_formula_${old.id}`);
  assert.equal(retired.status, "retired");
  assert.equal(retired.visibility, "hidden");
  assert.deepEqual(
    (await community.get("community_retired_formulas")).map((item) => item.id),
    [old.id],
  );

  const writes = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value) => {
    writes.push({ key, value });
    return put(key, value);
  };
  try {
    const repeated = await community.reconcileAuthoritativeFormula(seed);
    assert.equal(repeated.id, active.id);
    assert.equal(repeated.version, active.version);
  } finally {
    kv.put = put;
  }
  assert.deepEqual(writes, []);
});

test("Makers reconciliation retries a failed pointer update without another active seed version", async () => {
  class PointerFaultKV extends FakeKV {
    constructor() {
      super();
      this.failPointer = false;
    }

    async put(key, value) {
      if (this.failPointer && key.startsWith("community_active_")) {
        this.failPointer = false;
        throw new Error("active pointer unavailable");
      }
      return super.put(key, value);
    }
  }

  const kv = new PointerFaultKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  kv.failPointer = true;
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null, playerId: "seed-player",
  };

  await assert.rejects(
    () => community.reconcileAuthoritativeFormula(seed),
    /active pointer unavailable/,
  );
  const active = await community.reconcileAuthoritativeFormula(seed);

  assert.equal(active.version, 2);
  assert.equal((await community.combinationState("水", "水")).version, 2);
  const activeSeeds = [...kv.values.values()]
    .map((value) => JSON.parse(value))
    .filter((value) => value?.combo_key === "水 + 水" && value.status === "active" && value.source === "seed");
  assert.equal(activeSeeds.length, 1);
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired");
});

test("Makers reconciliation discovers and retires v1 when its active pointer is missing", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  await community.publish(old.id, "seed-player");
  await community.vote(old.id, "voter", 1);
  await kv.delete(`community_active_${await sha256Hex("水 + 水")}`);

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  const retired = await community.get(`community_formula_${old.id}`);
  assert.equal(retired.status, "retired");
  assert.equal(retired.visibility, "hidden");
  assert.equal(retired.up_votes, 1);
  assert.equal(active.version, 2);
  assert.equal(active.source, "seed");
  assert.deepEqual(
    (await community.get("community_retired_formulas")).map((item) => item.id),
    [old.id],
  );
});

test("Makers reconciliation retries a temporarily unreadable pointed record before changing state", async () => {
  class OneReadLagKV extends FakeKV {
    constructor() {
      super();
      this.hiddenKey = null;
      this.hidden = false;
    }

    async get(key, options) {
      if (key === this.hiddenKey && !this.hidden) {
        this.hidden = true;
        return null;
      }
      return super.get(key, options);
    }
  }

  const kv = new OneReadLagKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  kv.hiddenKey = `community_formula_${old.id}`;

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.version, 2);
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired");
  const activeRecords = [...kv.values.values()]
    .map((value) => JSON.parse(value))
    .filter((value) => value?.combo_key === "水 + 水" && value.status === "active");
  assert.deepEqual(activeRecords.map((value) => value.version), [2]);
});

test("Makers reconciliation returns its authoritative seed when pointer readback is stale", async () => {
  class StalePointerReadKV extends FakeKV {
    constructor() {
      super();
      this.stalePointer = null;
    }

    async put(key, value) {
      if (key.startsWith("community_active_") && this.values.has(key)) {
        this.stalePointer = this.values.get(key);
      }
      return super.put(key, value);
    }

    async get(key, options) {
      if (key.startsWith("community_active_") && this.stalePointer) {
        const stale = this.stalePointer;
        this.stalePointer = null;
        return typeof options === "string" && options === "json" ? JSON.parse(stale) : stale;
      }
      return super.get(key, options);
    }
  }

  const kv = new StalePointerReadKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.version, 2);
  assert.equal(active.source, "seed");
  assert.equal(active.result, "水塘");
});

async function activePointerKey(a, b) {
  return `community_active_${await sha256Hex(`${a} + ${b}`)}`;
}

test("Makers reconciliation advances a validated v32 pointer to seed v33", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.createFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅",
  }, 32);
  await community.put(`community_formula_${old.id}`, old);
  await community.put(await activePointerKey("水", "水"), { id: old.id, version: 32 });

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.version, 33);
  assert.equal(active.source, "seed");
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired");
});

test("Makers reconciliation globally inventories an unmarked orphan seed v33 before recreating a missing pointer", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const orphan = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null,
  }, 33);
  await community.put(`community_formula_${orphan.id}`, orphan);

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.id, orphan.id);
  assert.equal(active.version, 33);
  const activeRecords = [...kv.values.values()]
    .map((value) => JSON.parse(value))
    .filter((value) => value?.combo_key === "水 + 水" && value.status === "active");
  assert.deepEqual(activeRecords.map((value) => value.version), [33]);
});

test("Makers reconciliation creates v1 for a brand-new authoritative pair after a complete inventory", async () => {
  const community = new CommunityStore(new FakeKV(), { now: () => 1_700_000_000_000 });

  const active = await community.reconcileAuthoritativeFormula({
    a: "全新甲", b: "全新乙", result: "全新种子", emoji: "✨",
    comment: "全新权威公式。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.version, 1);
  assert.equal(active.source, "seed");
});

test("Makers reconciliation fails closed with zero writes when a pointed record misses twice", async () => {
  class DoubleMissKV extends FakeKV {
    constructor() {
      super();
      this.hiddenKey = null;
      this.puts = [];
    }

    async get(key, options) {
      if (key === this.hiddenKey) return null;
      return super.get(key, options);
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }
  }

  const kv = new DoubleMissKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  kv.puts = [];
  kv.hiddenKey = `community_formula_${old.id}`;

  await assert.rejects(
    () => community.reconcileAuthoritativeFormula({
      a: "水", b: "水", result: "水塘", emoji: "💧",
      comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
    }),
    (error) => error?.status === 503 && error?.retryable === true,
  );
  assert.deepEqual(kv.puts, []);
});

test("Makers reconciliation returns its seed when both pointer readbacks are stale", async () => {
  class DoubleStalePointerKV extends FakeKV {
    constructor() {
      super();
      this.stalePointer = null;
      this.staleReads = 0;
    }

    async put(key, value) {
      if (key.startsWith("community_active_") && this.values.has(key)) {
        this.stalePointer = this.values.get(key);
        this.staleReads = 2;
      }
      return super.put(key, value);
    }

    async get(key, options) {
      if (key.startsWith("community_active_") && this.staleReads > 0) {
        this.staleReads -= 1;
        return this.stalePointer;
      }
      return super.get(key, options);
    }
  }

  const kv = new DoubleStalePointerKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });

  const active = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });

  assert.equal(active.version, 2);
  assert.equal(active.source, "seed");
});

test("Makers reconciliation never overwrites an observed mismatched target version", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  await community.put(await community.formulaInventoryKey("水 + 水"), {
    schema_version: 1,
    pair: "水 + 水",
    complete: true,
  });
  const conflictingTarget = await community.createFormula({
    a: "水", b: "水", result: "抢占目标", emoji: "⚠️",
    comment: "冲突的目标版本。", source: "llm", discoverer: "旧鹅",
  }, 2);
  await community.put(`community_formula_${conflictingTarget.id}`, conflictingTarget);

  await assert.rejects(
    () => community.reconcileAuthoritativeFormula({
      a: "水", b: "水", result: "水塘", emoji: "💧",
      comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
    }),
    (error) => error?.status === 503 && /目标版本/.test(error.message),
  );

  assert.equal((await community.get(`community_formula_${old.id}`)).status, "active");
  assert.equal((await community.get(`community_formula_${conflictingTarget.id}`)).result, "抢占目标");
});

test("Makers formula markers enumerate every paginated version without a discovery window", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  for (let version = 1; version <= 257; version += 1) {
    await community.put(await community.formulaMarkerKey(pair, version), {
      schema_version: 1,
      pair,
      version,
      id: await community.formulaId(pair, version),
    });
  }

  const markers = await community.listFormulaMarkers(pair);

  assert.equal(markers.length, 257);
  assert.deepEqual([markers[0].version, markers.at(-1).version], [1, 257]);
  assert.ok(kv.listCalls >= 2);
});

test("Makers reconciliation retries marker, formula, ready, and pointer write phases without losing the old formula", async () => {
  class PhaseFaultKV extends FakeKV {
    constructor() {
      super();
      this.failure = null;
    }

    async put(key, value) {
      if (this.failure?.(key)) {
        this.failure = null;
        throw new Error(`failed ${key}`);
      }
      return super.put(key, value);
    }
  }

  for (const { name: phase, matches } of [
    { name: "marker", matches: (key) => key.startsWith("community_formula_marker_") },
    { name: "formula", matches: (key) => /^community_formula_[a-f0-9]{32}$/u.test(key) },
    { name: "ready", matches: (key) => key.startsWith("community_formula_ready_") },
    { name: "pointer", matches: (key) => key.startsWith("community_active_") },
  ]) {
    const kv = new PhaseFaultKV();
    const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
    const old = await community.ensureFormula({
      a: "水", b: "水", result: "错误水", emoji: "❌",
      comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
    });
    kv.failure = matches;
    const seed = {
      a: "水", b: "水", result: "水塘", emoji: "💧",
      comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
    };

    await assert.rejects(() => community.reconcileAuthoritativeFormula(seed));
    if (phase !== "pointer") {
      assert.equal((await community.get(`community_formula_${old.id}`)).status, "active", phase);
    }
    const active = await community.reconcileAuthoritativeFormula(seed);

    assert.equal(active.version, 2, phase);
    assert.equal(active.source, "seed", phase);
    assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired", phase);
    const activeRecords = [...kv.values.values()]
      .map((value) => JSON.parse(value))
      .filter((value) => value?.combo_key === "水 + 水" && value.status === "active");
    assert.deepEqual(activeRecords.map((value) => value.version), [2], phase);
  }
});

test("Makers ensureFormula marks an active legacy pointer ready before returning it", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  const formula = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "llm", discoverer: "旧鹅",
  }, 1);
  await community.put(`community_formula_${formula.id}`, formula);
  await community.put(await activePointerKey("水", "水"), { id: formula.id, version: 1 });

  const ensured = await community.ensureFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "llm", discoverer: "旧鹅", playerId: "new-player",
  });

  assert.equal(ensured.id, formula.id);
  assert.ok(await community.readFormulaMarker(pair, formula.version));
  assert.ok(await community.readFormulaReady(pair, formula.version));
});

test("Makers reconciliation backfills a valid unmarked pointer despite a complete inventory", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  const seed = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null,
  }, 1);
  await community.put(`community_formula_${seed.id}`, seed);
  await community.put(await activePointerKey("水", "水"), { id: seed.id, version: 1 });
  await community.put(await community.formulaInventoryKey(pair), {
    schema_version: 1, pair, complete: true,
  });
  const governed = await community.get(`community_formula_${seed.id}`);
  governed.protected = true;
  governed.ai_positive_enabled = false;
  await community.put(`community_formula_${seed.id}`, governed);

  const first = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });
  assert.equal(first.id, seed.id);
  assert.equal((await community.get(`community_formula_${seed.id}`)).protected, true);
  assert.equal((await community.get(`community_formula_${seed.id}`)).ai_positive_enabled, false);
  assert.ok(await community.readFormulaMarker(pair, 1));
  await kv.delete(await activePointerKey("水", "水"));
  const recovered = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  });
  assert.equal(recovered.id, seed.id);
  assert.equal((await community.get(`community_formula_${seed.id}`)).protected, true);
  assert.equal((await community.get(`community_formula_${seed.id}`)).ai_positive_enabled, false);
});

test("Makers ensureFormula refuses a missing-pointer target with different immutable marker intent", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  const old = await community.createFormula({
    a: "水", b: "水", result: "旧历史", emoji: "🕰️",
    comment: "旧公式不能覆盖。", source: "llm", discoverer: "旧鹅",
  }, 1);
  await community.put(`community_formula_${old.id}`, old);
  await community.put(await community.formulaMarkerKey(pair, 1), {
    schema_version: 1, pair, version: 1, id: old.id, formula: old,
  });
  await community.put(await community.formulaInventoryKey(pair), {
    schema_version: 1, pair, complete: true,
  });

  await assert.rejects(
    () => community.ensureFormula({
      a: "水", b: "水", result: "新公式", emoji: "✨",
      comment: "不能覆盖旧历史。", source: "llm", discoverer: "新鹅", playerId: "new-player",
    }),
    (error) => error?.status === 503,
  );
  assert.equal((await community.get(`community_formula_${old.id}`)).result, "旧历史");
});

test("Makers reconciliation retries a marker readback gap before retiring old history", async () => {
  class MarkerReadbackFaultKV extends FakeKV {
    constructor() {
      super();
      this.markerKey = null;
      this.hiddenReads = 0;
    }

    async put(key, value) {
      const result = await super.put(key, value);
      if (key === this.markerKey) this.hiddenReads = 2;
      return result;
    }

    async get(key, options) {
      if (key === this.markerKey && this.hiddenReads > 0) {
        this.hiddenReads -= 1;
        return null;
      }
      return super.get(key, options);
    }
  }

  const kv = new MarkerReadbackFaultKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  kv.markerKey = await community.formulaMarkerKey("水 + 水", 2);
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  };

  await assert.rejects(() => community.reconcileAuthoritativeFormula(seed));
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "active");
  await assert.rejects(() => community.reconcileAuthoritativeFormula(seed));
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "active");
  assert.equal((await community.reconcileAuthoritativeFormula(seed)).version, 2);
});

test("Makers marker pagination fails closed for malformed, empty, missing, or repeated cursors", async () => {
  const prefix = "community_formula_marker_test_";
  for (const response of [
    null,
    { keys: [], complete: false, cursor: "next" },
    { keys: [{ key: `${prefix}one` }], complete: false },
  ]) {
    class FaultyListKV extends FakeKV {
      async list() {
        return response;
      }
    }
    const community = new CommunityStore(new FaultyListKV());
    await assert.rejects(
      () => community.listCompleteKeys(prefix),
      (error) => error?.status === 503,
    );
  }
  class RepeatedCursorKV extends FakeKV {
    constructor() {
      super();
      this.calls = 0;
    }

    async list() {
      this.calls += 1;
      return {
        keys: [{ key: `${prefix}${this.calls}` }],
        complete: false,
        cursor: "stuck",
      };
    }
  }
  await assert.rejects(
    () => new CommunityStore(new RepeatedCursorKV()).listCompleteKeys(prefix),
    (error) => error?.status === 503,
  );
});

test("Makers reconciliation never rewrites a ready formula that is temporarily unreadable", async () => {
  class ReadyReadFaultKV extends FakeKV {
    constructor() {
      super();
      this.hiddenKey = null;
      this.puts = [];
    }

    async get(key, options) {
      if (key === this.hiddenKey) return null;
      return super.get(key, options);
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }
  }

  const kv = new ReadyReadFaultKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  };
  const active = await community.reconcileAuthoritativeFormula(seed);
  assert.ok(await community.readFormulaReady("水 + 水", active.version));
  kv.puts = [];
  kv.hiddenKey = `community_formula_${active.id}`;
  const marker = await community.readFormulaMarker("水 + 水", active.version);

  await assert.rejects(
    () => community.materializeFormulaMarker("水 + 水", marker),
    (error) => error?.status === 503,
  );
  assert.deepEqual(kv.puts, []);
});

test("Makers reconciliation retries a failed ready write before exposing or retiring formulas", async () => {
  class ReadyWriteFaultKV extends FakeKV {
    constructor() {
      super();
      this.failKey = null;
      this.failed = false;
    }

    async put(key, value) {
      if (key === this.failKey && !this.failed) {
        this.failed = true;
        throw new Error("ready write failed");
      }
      return super.put(key, value);
    }
  }

  const kv = new ReadyWriteFaultKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const old = await community.ensureFormula({
    a: "水", b: "水", result: "错误水", emoji: "❌",
    comment: "冲突的旧公式。", source: "llm", discoverer: "旧鹅", playerId: "seed-player",
  });
  kv.failKey = await community.formulaReadyKey("水 + 水", 2);
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  };

  await assert.rejects(() => community.reconcileAuthoritativeFormula(seed));
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "active");
  assert.equal((await community.get(await activePointerKey("水", "水"))).id, old.id);

  const recovered = await community.reconcileAuthoritativeFormula(seed);
  assert.equal(recovered.version, 2);
  assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired");
  assert.ok(await community.readFormulaReady("水 + 水", recovered.version));
});

test("Makers ready marker discovery preserves published, voted, and protected fields", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed-player",
  };
  const active = await community.reconcileAuthoritativeFormula(seed);
  await community.publish(active.id, "seed-player");
  await community.vote(active.id, "voter", 1);
  await community.moderate(active.id, "protect", "community_quality");
  await kv.delete(await activePointerKey("水", "水"));

  const recovered = await community.reconcileAuthoritativeFormula(seed);
  const stored = await community.get(`community_formula_${recovered.id}`);

  assert.equal(recovered.id, active.id);
  assert.equal(stored.visibility, "public");
  assert.equal(stored.up_votes, 1);
  assert.equal(stored.protected, true);
});

test("Makers committed backfill marker cannot reconstruct a temporarily missing live formula", async () => {
  class TrackingKV extends FakeKV {
    constructor() {
      super();
      this.hiddenKey = null;
      this.puts = [];
    }

    async get(key, options) {
      if (key === this.hiddenKey) return null;
      return super.get(key, options);
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }
  }

  const kv = new TrackingKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  const formula = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "llm", discoverer: "旧鹅",
  }, 1);
  formula.up_votes = 7;
  formula.protected = true;
  formula.ai_positive_enabled = false;
  await community.put(`community_formula_${formula.id}`, formula);
  await community.put(await community.formulaMarkerKey(pair, 1), {
    schema_version: 2,
    pair,
    version: 1,
    id: formula.id,
    materializable: false,
    intent: {
      id: formula.id, a: formula.a, b: formula.b, combo_key: pair,
      result: formula.result, emoji: formula.emoji, comment: formula.comment,
      source: formula.source, version: 1, global_discoverer: formula.global_discoverer,
    },
  });
  const marker = await community.readFormulaMarker(pair, 1);
  kv.puts = [];
  kv.hiddenKey = `community_formula_${formula.id}`;

  await assert.rejects(
    () => community.materializeFormulaMarker(pair, marker),
    (error) => error?.status === 503,
  );
  assert.deepEqual(kv.puts, []);
  kv.hiddenKey = null;
  const stored = await community.get(`community_formula_${formula.id}`);
  assert.deepEqual(
    [stored.up_votes, stored.protected, stored.ai_positive_enabled],
    [7, true, false],
  );
});

test("Makers completes a crash between legacy ready and committed-marker backfill", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const formula = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "llm", discoverer: "旧鹅",
  }, 1);
  await community.put(`community_formula_${formula.id}`, formula);
  await community.rememberFormulaReady("水 + 水", formula);
  await community.put(await activePointerKey("水", "水"), { id: formula.id, version: 1 });

  const ensured = await community.ensureFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "llm", discoverer: "new-discoverer", playerId: "p2",
  });
  const marker = await community.readFormulaMarker("水 + 水", 1);

  assert.equal(ensured.id, formula.id);
  assert.equal(marker.materializable, false);
});

test("Makers missing-pointer ensureFormula reuses semantic matches despite pair order or discoverer", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const first = await community.ensureFormula({
    a: "火", b: "水", result: "蒸汽", emoji: "♨️",
    comment: "火和水化作蒸汽。", source: "llm", discoverer: "first", playerId: "p1",
  });
  const pointerKey = `community_active_${await sha256Hex(first.combo_key)}`;
  await kv.delete(pointerKey);

  const recovered = await community.ensureFormula({
    a: "水", b: "火", result: "蒸汽", emoji: "♨️",
    comment: "火和水化作蒸汽。", source: "llm", discoverer: "second", playerId: "p2",
  });
  assert.equal(recovered.id, first.id);

  for (const differing of [
    { result: "云", emoji: "♨️", comment: "火和水化作蒸汽。", source: "llm" },
    { result: "蒸汽", emoji: "☁️", comment: "火和水化作蒸汽。", source: "llm" },
    { result: "蒸汽", emoji: "♨️", comment: "不同评论。", source: "llm" },
    { result: "蒸汽", emoji: "♨️", comment: "火和水化作蒸汽。", source: "seed" },
  ]) {
    await kv.delete(pointerKey);
    await assert.rejects(
      () => community.ensureFormula({
        a: "水", b: "火", ...differing, discoverer: "third", playerId: "p3",
      }),
      (error) => error?.status === 503,
    );
    assert.equal((await community.get(`community_formula_${first.id}`)).result, "蒸汽");
  }
});

test("Makers MAX_SAFE mismatched seed preflight performs no writes with or without a pointer", async () => {
  class TrackingKV extends FakeKV {
    constructor() {
      super();
      this.puts = [];
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }
  }

  for (const withPointer of [true, false]) {
    const kv = new TrackingKV();
    const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
    const formula = await community.createFormula({
      a: "水", b: "水", result: "旧水", emoji: "❌",
      comment: "旧公式。", source: "llm", discoverer: "old",
    }, Number.MAX_SAFE_INTEGER);
    await community.put(`community_formula_${formula.id}`, formula);
    if (withPointer) {
      await community.put(await activePointerKey("水", "水"), {
        id: formula.id, version: Number.MAX_SAFE_INTEGER,
      });
    }
    kv.puts = [];
    await assert.rejects(
      () => community.reconcileAuthoritativeFormula({
        a: "水", b: "水", result: "水塘", emoji: "💧",
        comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed",
      }),
      (error) => error?.status === 503,
    );
    assert.deepEqual(kv.puts, [], `withPointer=${withPointer}`);
  }
});

test("Makers safely recovers an authoritative MAX_SAFE formula without advancing", async () => {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const formula = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null,
  }, Number.MAX_SAFE_INTEGER);
  await community.put(`community_formula_${formula.id}`, formula);
  await community.put(await activePointerKey("水", "水"), {
    id: formula.id, version: Number.MAX_SAFE_INTEGER,
  });

  const recovered = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed",
  });
  assert.equal(recovered.id, formula.id);
  assert.ok(await community.readFormulaReady("水 + 水", formula.version));
});

test("Makers commits a new marker before mutable formula state can be exposed", async () => {
  class StaleReadKV extends FakeKV {
    constructor() {
      super();
      this.hidden = new Set();
      this.puts = [];
      this.staleFormulaList = false;
    }

    async get(key, options) {
      if (this.hidden.has(key)) return null;
      return super.get(key, options);
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }

    async list(options) {
      if (this.staleFormulaList && options?.prefix === "community_formula_") {
        return { keys: [], complete: true };
      }
      return super.list(options);
    }
  }

  const kv = new StaleReadKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const seed = {
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed",
  };
  const formula = await community.reconcileAuthoritativeFormula(seed);
  const pair = "水 + 水";
  const marker = await community.readFormulaMarker(pair, formula.version);
  assert.equal(marker.materializable, false);
  await community.publish(formula.id, "seed");
  await community.vote(formula.id, "voter", 1);
  await community.moderate(formula.id, "protect", "community_quality");
  const formulaKey = `community_formula_${formula.id}`;
  const expected = await community.get(formulaKey);

  kv.puts = [];
  kv.staleFormulaList = true;
  for (const key of [
    formulaKey,
    await activePointerKey("水", "水"),
    await community.formulaReadyKey(pair, formula.version),
  ]) kv.hidden.add(key);
  await assert.rejects(
    () => community.materializeFormulaMarker(pair, marker),
    (error) => error?.status === 503,
  );
  await assert.rejects(
    () => community.reconcileAuthoritativeFormula(seed),
    (error) => error?.status === 503,
  );
  assert.deepEqual(kv.puts, []);
  kv.hidden.clear();
  assert.deepEqual(await community.get(formulaKey), expected);
});

test("Makers upgrades readable schema1 history to committed markers and rejects a missing record", async () => {
  class TrackingKV extends FakeKV {
    constructor() {
      super();
      this.puts = [];
    }

    async put(key, value) {
      this.puts.push({ key, value });
      return super.put(key, value);
    }
  }

  const pair = "水 + 水";
  const kv = new TrackingKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const v1 = await community.createFormula({
    a: "水", b: "水", result: "旧水", emoji: "❌",
    comment: "旧公式。", source: "llm", discoverer: "old",
  }, 1);
  v1.status = "retired";
  v1.visibility = "hidden";
  const v2 = await community.createFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", discoverer: null,
  }, 2);
  await community.put(`community_formula_${v1.id}`, v1);
  await community.put(`community_formula_${v2.id}`, v2);
  await community.put(await community.formulaMarkerKey(pair, 1), {
    schema_version: 1, pair, version: 1, id: v1.id,
  });
  await community.put(await activePointerKey("水", "水"), { id: v2.id, version: 2 });
  await community.put(await community.formulaInventoryKey(pair), {
    schema_version: 1, pair, complete: true,
  });

  const recovered = await community.reconcileAuthoritativeFormula({
    a: "水", b: "水", result: "水塘", emoji: "💧",
    comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed",
  });
  assert.equal(recovered.id, v2.id);
  assert.equal((await community.get(`community_formula_${v1.id}`)).status, "retired");
  assert.equal((await community.readFormulaMarker(pair, 1)).materializable, false);
  assert.ok(await community.readFormulaReady(pair, 1));

  const missingKv = new TrackingKV();
  const missing = new CommunityStore(missingKv, { now: () => 1_700_000_000_000 });
  await missing.put(await missing.formulaMarkerKey(pair, 1), {
    schema_version: 1, pair, version: 1, id: await missing.formulaId(pair, 1),
  });
  await missing.put(await missing.formulaInventoryKey(pair), {
    schema_version: 1, pair, complete: true,
  });
  missingKv.puts = [];
  await assert.rejects(
    () => missing.reconcileAuthoritativeFormula({
      a: "水", b: "水", result: "水塘", emoji: "💧",
      comment: "两滴水先汇成池塘。", source: "seed", playerId: "seed",
    }),
    (error) => error?.status === 503,
  );
  assert.deepEqual(missingKv.puts, []);
});

async function retirementHistoryFixture({ count = 501, activeResult = "权威水" } = {}) {
  const kv = new FakeKV();
  const community = new CommunityStore(kv, { now: () => 1_700_000_000_000 });
  const pair = "水 + 水";
  const retired = [];
  const storeFormula = async (formula) => {
    await community.put(`community_formula_${formula.id}`, formula);
    await community.put(await community.formulaMarkerKey(pair, formula.version), {
      schema_version: 2,
      pair,
      version: formula.version,
      id: formula.id,
      intent: {
        id: formula.id,
        a: formula.a,
        b: formula.b,
        combo_key: pair,
        result: formula.result,
        emoji: formula.emoji,
        comment: formula.comment,
        source: formula.source,
        version: formula.version,
        global_discoverer: formula.global_discoverer,
      },
      materializable: false,
    });
    await community.put(await community.formulaReadyKey(pair, formula.version), {
      schema_version: 1, pair, version: formula.version, id: formula.id,
    });
  };
  for (let version = 1; version <= count; version += 1) {
    const formula = await community.createFormula({
      a: "水", b: "水", result: `退役水${version}`, emoji: "🕰️",
      comment: `退役公式${version}。`, source: "llm", discoverer: `旧鹅${version}`,
    }, version);
    formula.status = "retired";
    formula.visibility = "hidden";
    formula.retired_at = version;
    formula.updated_at = version;
    retired.push(formula);
    await storeFormula(formula);
  }
  const active = await community.createFormula({
    a: "水", b: "水", result: activeResult, emoji: "💧",
    comment: "当前权威公式。", source: activeResult === "权威水" ? "seed" : "llm",
    discoverer: activeResult === "权威水" ? null : "当前鹅",
  }, count + 1);
  await storeFormula(active);
  await community.put(await activePointerKey("水", "水"), {
    id: active.id, version: active.version,
  });
  await community.put(await community.formulaInventoryKey(pair), {
    schema_version: 1, pair, complete: true,
  });
  const newest500 = retired.slice(-500).reverse().map(({ id, result, retired_at }) => ({
    id, result, retired_at,
  }));
  return { kv, community, pair, retired, active, newest500 };
}

const authoritativeWaterSeed = {
  a: "水", b: "水", result: "权威水", emoji: "💧",
  comment: "当前权威公式。", source: "seed", playerId: "",
};

test("Makers reconciliation leaves an already-canonical newest-500 retirement catalogue untouched", async () => {
  const { kv, community, newest500 } = await retirementHistoryFixture();
  await community.put("community_retired_formulas", newest500);
  const retiredIndexWrites = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value) => {
    if (key === "community_retired_formulas") {
      retiredIndexWrites.push(JSON.parse(value));
      throw new Error("canonical retirement catalogue must not be rewritten");
    }
    return put(key, value);
  };

  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);
  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);

  assert.deepEqual(retiredIndexWrites, []);
  assert.deepEqual(await community.get("community_retired_formulas"), newest500);
});

test("Makers reconciliation repairs a missing or stale retirement catalogue with one newest-500 write", async () => {
  const { kv, community, newest500 } = await retirementHistoryFixture();
  const retiredIndexWrites = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value) => {
    if (key === "community_retired_formulas") {
      retiredIndexWrites.push(JSON.parse(value));
      if (retiredIndexWrites.length > 1) throw new Error("retirement catalogue written twice");
    }
    return put(key, value);
  };

  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);

  assert.equal(retiredIndexWrites.length, 1);
  assert.deepEqual(retiredIndexWrites[0], newest500);

  await put("community_retired_formulas", JSON.stringify([newest500.at(-1)]));
  retiredIndexWrites.length = 0;
  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);
  assert.equal(retiredIndexWrites.length, 1);
  assert.deepEqual(retiredIndexWrites[0], newest500);
});

test("Makers reconciliation batches a newly retired active formula into the newest 500", async () => {
  const { kv, community, retired, active, newest500 } = await retirementHistoryFixture({
    activeResult: "冲突水",
  });
  await community.put("community_retired_formulas", newest500);
  const retiredIndexWrites = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value) => {
    if (key === "community_retired_formulas") {
      retiredIndexWrites.push(JSON.parse(value));
      if (retiredIndexWrites.length > 1) throw new Error("retirement catalogue written twice");
    }
    return put(key, value);
  };

  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);

  assert.equal(retiredIndexWrites.length, 1);
  assert.equal(retiredIndexWrites[0].length, 500);
  assert.equal(retiredIndexWrites[0][0].id, active.id);
  assert.deepEqual(
    retiredIndexWrites[0].slice(1).map((item) => item.id),
    retired.slice(-499).reverse().map((item) => item.id),
  );
});

test("Makers retirement batch preserves existing source order for equal or missing timestamps", async () => {
  const { community, retired } = await retirementHistoryFixture({ count: 4 });
  const existing = retired.slice(0, 3).map(({ id, result }, index) => (
    index === 1 ? { id, result, retired_at: 0 } : { id, result }
  ));
  for (const [index, formula] of retired.entries()) {
    if (index === 1) formula.retired_at = 0;
    else delete formula.retired_at;
    formula.updated_at = 0;
    await community.put(`community_formula_${formula.id}`, formula);
  }
  await community.put("community_retired_formulas", existing);

  await community.reconcileAuthoritativeFormula(authoritativeWaterSeed);

  assert.deepEqual(
    (await community.get("community_retired_formulas")).map((item) => item.id),
    retired.map((item) => item.id),
  );
  const feedback = await community.feedback({}, { positiveLimit: 0, negativeLimit: 4 });
  assert.deepEqual(feedback.negatives, retired.map((item) => item.result));
});
