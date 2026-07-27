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
