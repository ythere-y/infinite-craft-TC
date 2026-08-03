import assert from "node:assert/strict";
import test from "node:test";

import { CommunityStore } from "../edge-functions/_lib/community.js";
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
  assert.equal(feedback.positives.at(-1).name, "社区结果100");
  assert.equal(feedback.negatives.length, 101);
  assert.equal(feedback.negatives.at(-1), "退役结果100");
});

test("Makers feedback stops catalog reads after both requested sets are full", async () => {
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
  assert.ok(
    kv.getCalls < ids.length + 1,
    `expected early catalog stop, observed ${kv.getCalls} KV reads`,
  );
});
