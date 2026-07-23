import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("tracked configuration exposes the safe Makers team workflow", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const envExample = await readFile(".env.example", "utf8");

  assert.equal(
    packageJson.scripts["makers:dev"],
    "node scripts/dev-makers.mjs",
  );
  assert.equal("dev" in packageJson.scripts, false);
  assert.match(envExample, /^APP_ENV=dev$/mu);
  assert.match(envExample, /^MAKERS_MODELS_KEY=$/mu);
  assert.match(envExample, /test_dev → infinite_craft_dev/u);
});

test("Render is archived outside the repository root", async () => {
  assert.equal(await exists("render.yaml"), false);
  assert.equal(await exists("deploy/legacy/render.yaml"), true);

  const legacyRender = await readFile(
    "deploy/legacy/render.yaml",
    "utf8",
  );
  assert.match(legacyRender, /暂停|legacy|inactive/iu);
});

test("primary docs describe Makers development and both KV namespaces", async () => {
  const readme = await readFile("README.md", "utf8");
  const guide = await readFile("docs/makers-development.md", "utf8");

  for (const source of [readme, guide]) {
    assert.match(source, /edgeone makers link/u);
    assert.match(source, /npm run makers:dev/u);
    assert.match(source, /\btest_dev\b/u);
    assert.match(source, /\binfinite_craft_dev\b/u);
    assert.match(source, /\btest\b/u);
    assert.match(source, /\binfinite_craft\b/u);
  }

  assert.match(readme, /Render.*暂停/su);
  assert.doesNotMatch(readme, /方式 3：EdgeOne Makers/u);
});
