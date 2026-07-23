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
