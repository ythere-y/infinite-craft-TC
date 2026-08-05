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

test("stable pool fixtures are diverse and never repeat the base", () => {
  const fallbackCases = cases.filter(
    (fixture) => fixture.group === "stable-pool",
  );

  assert.ok(
    new Set(fallbackCases.map((fixture) => fixture.expected.badge)).size >= 4,
  );
  for (const fixture of fallbackCases) {
    assert.notEqual(fixture.expected.badge, fixture.emoji);
  }
});

test("historic brain badge remains unchanged", () => {
  const persisted = {
    base: "☕",
    badge: "🧠",
    palette: "product",
    source: "generated",
  };

  assert.deepEqual(
    resolveIconRecipe({
      name: "智能咖啡",
      emoji: "☕",
      category: "ai",
      parents: ["AI", "咖啡"],
      comment: "咖啡完成智能升级",
      persisted,
    }),
    persisted,
  );
});

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

test("exact map names win before reviewed alias fallback", () => {
  assert.deepEqual(presetIcon("小马哥"), {
    base: "🐎",
    badge: "👔",
    palette: "product",
    source: "generated",
  });
  assert.deepEqual(presetIcon("Riot"), {
    base: "👊",
    badge: "🎮",
    palette: "studio",
    source: "curated",
  });
  assert.deepEqual(presetIcon("Epic"), {
    base: "🛡️",
    badge: "🎮",
    palette: "studio",
    source: "curated",
  });
});
