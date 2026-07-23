import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMBINATIONS,
  DEPTHS,
  ELEMENTS,
  RECIPES_BY_RESULT,
  STARTERS,
} from "../edge-functions/_generated/seed-data.js";

function comboKey(a, b) {
  return [a.trim(), b.trim()].sort().join(" + ");
}

test("generated Makers data retains all seed elements and starters", async () => {
  const source = JSON.parse(
    await readFile("backend/seed_elements.json", "utf8"),
  );

  assert.equal(STARTERS.length, source.starters.length);
  assert.equal(Object.keys(ELEMENTS).length, Object.keys(source.elements).length);
  assert.deepEqual(
    new Set(STARTERS.map((item) => item.name)),
    new Set(source.starters.map((item) => item.name)),
  );
});

test("generated combinations use order-independent lookup keys", () => {
  const forward = COMBINATIONS[comboKey("水", "火")];
  const reverse = COMBINATIONS[comboKey("火", "水")];

  assert.equal(forward.result, "蒸汽");
  assert.deepEqual(reverse, forward);
  assert.equal(forward.source, "seed");
});

test("generated data contains recipe indexes and stable depths", () => {
  assert.ok(Array.isArray(RECIPES_BY_RESULT["蒸汽"]));
  assert.ok(
    RECIPES_BY_RESULT["蒸汽"].some(
      (recipe) => new Set([recipe.a, recipe.b]).has("水"),
    ),
  );
  assert.equal(DEPTHS["水"], 0);
  assert.equal(DEPTHS["火"], 0);
  assert.equal(DEPTHS["蒸汽"], 1);
});
