import assert from "node:assert/strict";
import test from "node:test";

import { firstHonorFor } from "../frontend/wall/first-honor.js";

test("first honor uses direct base-four first counts", () => {
  for (const [firsts, expected] of [
    [0, { crowns: 0, suns: 0, moons: 0, stars: 0, icons: [] }],
    [1, { crowns: 0, suns: 0, moons: 0, stars: 1, icons: ["🌟"] }],
    [4, { crowns: 0, suns: 0, moons: 1, stars: 0, icons: ["🌙"] }],
    [16, { crowns: 0, suns: 1, moons: 0, stars: 0, icons: ["🌞"] }],
    [64, { crowns: 1, suns: 0, moons: 0, stars: 0, icons: ["👑"] }],
    [76, { crowns: 1, suns: 0, moons: 3, stars: 0, icons: ["👑", "🌙", "🌙", "🌙"] }],
  ]) {
    const honor = firstHonorFor(firsts);
    assert.deepEqual(
      {
        crowns: honor.crowns,
        suns: honor.suns,
        moons: honor.moons,
        stars: honor.stars,
        icons: honor.displayItems.map((item) => item.text),
      },
      expected,
    );
  }
});

test("first honor normalizes invalid counts to zero", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "not-a-number"]) {
    const honor = firstHonorFor(value);
    assert.equal(honor.firsts, 0);
    assert.equal(honor.ariaLabel, "尚未获得首发星星");
    assert.deepEqual(honor.displayItems, []);
  }
});

test("first honor shows twenty icons directly and aggregates above twenty", () => {
  const boundary = firstHonorFor(1_280);
  assert.equal(boundary.iconCount, 20);
  assert.equal(boundary.aggregated, false);
  assert.equal(boundary.displayItems.length, 20);
  assert.ok(boundary.displayItems.every((item) => item.text === "👑"));

  const overflow = firstHonorFor(1_344);
  assert.equal(overflow.iconCount, 21);
  assert.equal(overflow.aggregated, true);
  assert.deepEqual(overflow.displayItems, [
    { tier: "crowns", icon: "👑", count: 21, text: "👑 × 21" },
  ]);
  assert.equal(overflow.ariaLabel, "首发荣誉等级：21个皇冠");
});
