import assert from "node:assert/strict";
import test from "node:test";

import { PROMPT_SPEC } from "../edge-functions/_generated/prompt-data.js";
import {
  CommunityStore,
  normalizePublicPagination,
} from "../edge-functions/_lib/community.js";
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
