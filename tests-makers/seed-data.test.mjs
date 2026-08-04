import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { generateMakersData } from "../scripts/generate-makers-data.mjs";
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

test("generated Makers data merges the compiled bounty catalog", async () => {
  const source = JSON.parse(
    await readFile("backend/generated/bounty-content.json", "utf8"),
  );

  assert.equal(STARTERS.length, 11);
  assert.equal(Object.keys(ELEMENTS).length, Object.keys(source.elements).length);
  assert.equal(
    Object.keys(COMBINATIONS).length,
    Object.keys(source.combinations).length,
  );
  assert.deepEqual(DEPTHS, source.depths);
  assert.deepEqual(
    new Set(STARTERS.map((item) => item.name)),
    new Set(source.starters.map((item) => item.name)),
  );
});

test("generated Makers elements include every preset icon recipe", async () => {
  const [source, presets] = await Promise.all([
    readFile("backend/seed_elements.json", "utf8").then(JSON.parse),
    readFile(
      "frontend/assets/icons/generated/element-icon-map.json",
      "utf8",
    ).then(JSON.parse),
  ]);

  for (const name of Object.keys(source.elements)) {
    assert.deepEqual(ELEMENTS[name].icon, presets[name].icon, name);
  }
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
  assert.equal(DEPTHS["微信"] > 0, true);
  assert.equal(DEPTHS["工位"] > 0, true);
  assert.equal(DEPTHS["电脑"], 0);
  assert.equal(DEPTHS["手机"], 0);
  assert.equal(DEPTHS["网络"], 0);
});

test("Makers generator writes the merged artifact to an isolated output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "makers-seed-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = resolve(directory, "seed-data.js");

  assert.equal(await generateMakersData({ outputPath }), outputPath);
  const generated = await import(
    `${pathToFileURL(outputPath).href}?test=${Date.now()}`
  );

  assert.deepEqual(generated.STARTERS, STARTERS);
  assert.deepEqual(generated.ELEMENTS, ELEMENTS);
  assert.deepEqual(generated.COMBINATIONS, COMBINATIONS);
  assert.deepEqual(generated.DEPTHS, DEPTHS);
});

test("Makers generator rejects malformed compiled bounty content", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "makers-seed-invalid-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bountyContentPath = resolve(directory, "bounty-content.json");
  const outputPath = resolve(directory, "seed-data.js");
  const source = JSON.parse(
    await readFile("backend/generated/bounty-content.json", "utf8"),
  );
  source.combinations["malformed pair"] = {
    result: "错误结果",
    emoji: "❌",
    source: "target",
  };
  await writeFile(bountyContentPath, JSON.stringify(source), "utf8");

  await assert.rejects(
    generateMakersData({ bountyContentPath, outputPath }),
    /compiled bounty|pair|recipe/i,
  );
});
