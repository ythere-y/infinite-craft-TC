import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  MEME_POOL,
  nicknameStats,
} from "../edge-functions/_lib/nickname.js";
import {
  buildBounty,
  selectBountyCandidates,
} from "../edge-functions/_lib/bounty.js";
import { jsonResponse } from "../edge-functions/_lib/http.js";
import { ELEMENTS, STARTERS } from "../edge-functions/_generated/seed-data.js";

test("score level includes a score-free starting star", () => {
  assert.equal(levelThreshold(0), 0);
  assert.equal(levelThreshold(1), 300);
  assert.equal(levelThreshold(4), 1_320);
  assert.equal(levelThreshold(16), 7_200);
  assert.equal(levelThreshold(64), 59_520);
  assert.equal(levelThreshold(128), 200_960);
  for (const [score, levelUnits, icons] of [
    [0, 1, "🌟"],
    [299, 1, "🌟"],
    [300, 2, "🌟🌟"],
    [620, 3, "🌟🌟🌟"],
    [960, 4, "🌙"],
    [1_320, 5, "🌙🌟"],
    [57_960, 64, "👑"],
  ]) {
    const rank = rankFor(score);
    assert.equal(rank.level_units, levelUnits);
    assert.equal(rank.icons, icons);
  }
  assert.equal(rankFor(300).emoji, "🌟");
});

test("earned score boundaries add exactly one display unit", () => {
  for (const earnedUnits of [1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024, 65_534]) {
    const threshold = levelThreshold(earnedUnits);
    assert.equal(rankFor(threshold - 1).level_units, earnedUnits);
    const rank = rankFor(threshold);
    assert.equal(rank.level_units, Math.min(65_535, earnedUnits + 1));
    assert.equal(rank.progress, earnedUnits === 65_534 ? 1 : 0);
    assert.equal(rank.topped, false);
  }
  const maxRank = rankFor(MAX_LEVEL_SCORE);
  assert.equal(maxRank.level_units, 65_535);
  assert.equal(maxRank.progress, 1);
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

test("nickname generator uses the committed shared corpus", async () => {
  const source = JSON.parse(
    await readFile("shared/nickname-data.json", "utf8"),
  );
  const nickname = generateNickname({ random: () => 0 });
  const stats = nicknameStats();
  assert.match(nickname, /^.{4}的.+鹅$/u);
  assert.equal(source.schema_version, 1);
  assert.equal(source.chengyu.length, 7_831);
  assert.equal(source.states.length, 4_350);
  assert.deepEqual(stats, {
    source: "bundled",
    chengyu: 7_831,
    thuocl_states: 4_350,
    meme_pool: MEME_POOL.length,
    meme_weight: 0.4,
    effective_combo_space: 7_831 * (MEME_POOL.length + 4_350),
  });
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

test("bounty candidate supply grows beyond the former producer cap", () => {
  const elements = {
    ...ELEMENTS,
    "测试输入甲": { emoji: "🅰️", category: "tencent" },
    "测试输入乙": { emoji: "🅱️", category: "tencent" },
  };

  const candidates = selectBountyCandidates({
    a: "测试输入甲",
    b: "测试输入乙",
    elements,
    starters: STARTERS,
    firsts: [],
    limit: 51,
  });

  assert.equal(candidates.length, 51);
});

test("JSON responses avoid unsupported Response.json static helper", async () => {
  const response = jsonResponse({ ok: true }, { status: 201 });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { ok: true });
});
