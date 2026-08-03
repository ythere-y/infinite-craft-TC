import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  attachIcon,
  normalizeIcon,
  presetIcon,
  resolveIconRecipe,
} from "../edge-functions/_lib/icon-recipes.js";

const cases = JSON.parse(
  await readFile("tests/fixtures/icon-resolution-cases.json", "utf8"),
);

for (const fixture of cases) {
  test(`Makers resolves the shared ${fixture.name} icon fixture`, () => {
    assert.deepEqual(resolveIconRecipe(fixture), fixture.expected);
  });
}

test("valid persisted icon JSON wins over an exact preset", () => {
  const persisted = {
    base: "🪨",
    badge: "🧭",
    palette: "place",
    source: "generated",
  };

  assert.deepEqual(
    resolveIconRecipe({
      name: "Riot",
      emoji: "⚡",
      category: "studio",
      persisted: JSON.stringify(persisted),
    }),
    persisted,
  );
});

test("malformed icon recipes normalize to null", () => {
  for (const value of [
    null,
    "",
    "{broken",
    { base: "", palette: "place", source: "fallback" },
    { base: "☕", palette: "missing", source: "fallback" },
    { base: "☕", badge: "☕", palette: "product", source: "generated" },
  ]) {
    assert.equal(normalizeIcon(value), null);
  }
});

test("preset lookup and attachment return copies with canonical icons", () => {
  const original = { emoji: "⚡", category: "studio", extra: true };
  const preset = presetIcon("Riot");
  const enriched = attachIcon("Riot", original);

  assert.deepEqual(enriched, { ...original, icon: preset });
  assert.deepEqual(original, { emoji: "⚡", category: "studio", extra: true });
  assert.deepEqual(preset, cases[0].expected);
});
