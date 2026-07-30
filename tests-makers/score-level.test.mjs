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

test("browser score levels match domain boundaries", async () => {
  const levels = await loadScoreLevel();
  assert.equal(levels.rankFor(300).icons, "🌟");
  assert.equal(levels.rankFor(1_320).icons, "🌙");
  assert.equal(levels.rankFor(7_200).icons, "🌞");
  assert.equal(levels.rankFor(59_520).icons, "👑");
  assert.equal(levels.rankFor(200_960).icons, "👑👑");
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
