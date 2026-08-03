import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadScoreLevel() {
  const source = await readFile("frontend/score-level.js", "utf8");
  const window = {};
  vm.runInNewContext(source, { window, Number, Math, Object });
  return window.SCORE_LEVEL;
}

test("browser score levels include a score-free starting star", async () => {
  const levels = await loadScoreLevel();
  for (const [score, levelUnits, icons] of [
    [0, 1, "🌟"],
    [299, 1, "🌟"],
    [300, 2, "🌟🌟"],
    [620, 3, "🌟🌟🌟"],
    [960, 4, "🌙"],
    [1_320, 5, "🌙🌟"],
    [57_960, 64, "👑"],
  ]) {
    const rank = levels.rankFor(score);
    assert.equal(rank.level_units, levelUnits);
    assert.equal(rank.icons, icons);
  }
  const maxRank = levels.rankFor(levels.MAX_LEVEL_SCORE);
  assert.equal(maxRank.level_units, 65_535);
  assert.equal(maxRank.progress, 1);
});

test("browser score normalization is finite, nonnegative, and safe", async () => {
  const levels = await loadScoreLevel();
  assert.equal(levels.normalizeScore("not-a-number"), 0);
  assert.equal(levels.normalizeScore(Number.NaN), 0);
  assert.equal(levels.normalizeScore(Number.POSITIVE_INFINITY), 0);
  assert.equal(levels.normalizeScore(-1), 0);
  assert.equal(
    levels.normalizeScore(Number.MAX_SAFE_INTEGER + 100),
    Number.MAX_SAFE_INTEGER,
  );
});

test("browser retains raw score above the display-level cap", async () => {
  const levels = await loadScoreLevel();
  assert.equal(
    levels.normalizeScore(levels.MAX_LEVEL_SCORE + 500),
    levels.MAX_LEVEL_SCORE + 500,
  );
  assert.equal(
    levels.rankFor(levels.MAX_LEVEL_SCORE + 500).level_units,
    65_535,
  );
  assert.deepEqual(Array.from(levels.transitionSteps(65_535, 65_535)), []);
});

test("transition steps describe each base-four carry", async () => {
  const levels = await loadScoreLevel();
  assert.deepEqual(
    Array.from(levels.transitionSteps(3, 4), (step) => ({ ...step })),
    [
      { type: "gain", icon: "🌟" },
      { type: "merge", from: "🌟", to: "🌙" },
    ],
  );
  assert.deepEqual(
    Array.from(levels.transitionSteps(63, 64), (step) => ({ ...step })),
    [
      { type: "gain", icon: "🌟" },
      { type: "merge", from: "🌟", to: "🌙" },
      { type: "merge", from: "🌙", to: "🌞" },
      { type: "merge", from: "🌞", to: "👑" },
    ],
  );
});
