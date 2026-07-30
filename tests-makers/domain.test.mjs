import assert from "node:assert/strict";
import test from "node:test";

import {
  levelThreshold,
  MAX_LEVEL_SCORE,
  normalizeScore,
  rankFor,
  scoreFor,
  shouldExplode,
} from "../edge-functions/_lib/kpi.js";
import {
  generateNickname,
  nicknameStats,
} from "../edge-functions/_lib/nickname.js";
import {
  buildBounty,
  selectBountyCandidates,
} from "../edge-functions/_lib/bounty.js";
import { jsonResponse } from "../edge-functions/_lib/http.js";
import { ELEMENTS, STARTERS } from "../edge-functions/_generated/seed-data.js";

test("score level uses increasing star costs and unlimited base-four icons", () => {
  assert.equal(levelThreshold(0), 0);
  assert.equal(levelThreshold(1), 300);
  assert.equal(levelThreshold(4), 1_320);
  assert.equal(levelThreshold(16), 7_200);
  assert.equal(levelThreshold(64), 59_520);
  assert.equal(levelThreshold(128), 200_960);
  assert.equal(rankFor(300).icons, "🌟");
  assert.equal(rankFor(300).emoji, "🌟");
  assert.equal(rankFor(1_320).icons, "🌙");
  assert.equal(rankFor(7_200).icons, "🌞");
  assert.equal(rankFor(59_520).icons, "👑");
  assert.equal(rankFor(200_960).icons, "👑👑");
});

test("score-level boundaries do not cap at crowns", () => {
  for (const units of [1, 4, 16, 64, 65, 128, 1024]) {
    const floor = levelThreshold(units);
    assert.equal(rankFor(floor - 1).level_units, units - 1);
    assert.equal(rankFor(floor).level_units, units);
    assert.equal(rankFor(floor).progress, 0);
    assert.equal(rankFor(floor).topped, false);
  }
});

test("rank inputs use the finite nonnegative JavaScript safe integer contract", () => {
  const zero = rankFor(0);
  assert.deepEqual(rankFor("not-a-number"), zero);
  assert.deepEqual(rankFor(Number.NaN), zero);
  assert.deepEqual(rankFor(Number.POSITIVE_INFINITY), zero);
  assert.deepEqual(rankFor(-1), zero);
  assert.deepEqual(rankFor(10 ** 100), rankFor(MAX_LEVEL_SCORE));
});

test("Edge ranks cap independently from raw score normalization", () => {
  assert.equal(
    normalizeScore(MAX_LEVEL_SCORE + 500),
    MAX_LEVEL_SCORE + 500,
  );
  assert.equal(rankFor(MAX_LEVEL_SCORE + 500).level_units, 65_535);
});

test("KPI effects keep their established scores and explosion rules", () => {
  assert.deepEqual(scoreFor("tencent", true), {
    delta: 80,
    reason: "tencent +30 / 首发 +50",
  });
  assert.equal(shouldExplode("easter_egg", "普通结果"), true);
  assert.equal(shouldExplode(null, "生产故障"), true);
});

test("nickname generator preserves the established display format", () => {
  const nickname = generateNickname({ random: () => 0 });
  const stats = nicknameStats();
  assert.match(nickname, /^.{4}的.+鹅$/u);
  assert.equal(stats.source, "bundled");
  assert.ok(stats.chengyu >= 7_000);
  assert.ok(stats.thuocl_states >= 4_000);
  assert.ok(stats.effective_combo_space >= 30_000_000);
});

test("bounty hides role group while retaining starter discoveries and first metadata", () => {
  const bounty = buildBounty({
    elements: ELEMENTS,
    starters: STARTERS,
    firsts: [
      {
        result: "腾讯大厦",
        emoji: "🏢",
        discoverer: "测试鹅",
        ts: 1_700_000_000,
        seq: 1,
      },
    ],
  });

  assert.equal(bounty.tabs[0].key, "tencent");
  assert.ok(!bounty.groups.some((group) => group.category === "boss"));
  assert.ok(!bounty.groups.some((group) => group.label === "角色"));
  const tencent = bounty.groups.find((group) => group.category === "tencent");
  assert.ok(tencent.items.find((item) => item.name === "企鹅").discovered);
  const buildings = bounty.groups.find((group) => group.category === "building");
  const tower = buildings.items.find((item) => item.name === "腾讯大厦");
  assert.equal(tower.discoverer, "测试鹅");
  assert.equal(tower.seq, 1);
});

test("bounty candidates do not prioritize hidden role targets", () => {
  const candidates = selectBountyCandidates({
    a: "创始人",
    b: "代码",
    elements: ELEMENTS,
    starters: STARTERS,
    firsts: [],
  });
  assert.ok(!candidates.some((item) => item.category === "boss"));
});

test("bounty candidates preserve input-aware Makers model hints", () => {
  const candidates = selectBountyCandidates({
    a: "云",
    b: "企鹅",
    elements: ELEMENTS,
    starters: STARTERS,
    firsts: [],
  });
  assert.ok(candidates.some((item) => item.name === "CSIG"));
  assert.ok(candidates.length <= 12);
});

test("JSON responses avoid unsupported Response.json static helper", async () => {
  const response = jsonResponse({ ok: true }, { status: 201 });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { ok: true });
});
