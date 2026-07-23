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

test("primary docs describe local development and Makers production", async () => {
  const readme = await readFile("README.md", "utf8");
  const guide = await readFile("docs/makers-development.md", "utf8");
  const agents = (await exists("AGENTS.md"))
    ? await readFile("AGENTS.md", "utf8")
    : "";

  assert.notEqual(agents, "", "AGENTS.md must exist");

  for (const source of [readme, guide, agents]) {
    assert.match(source, /npm run dev/u);
    assert.match(source, /LLM_API_KEY/u);
    assert.match(source, /\bmain\b/u);
    assert.doesNotMatch(source, /npm run makers:dev/u);
    assert.doesNotMatch(source, /edgeone makers link/u);
    assert.doesNotMatch(source, /edgeone login/u);
  }

  for (const source of [readme, guide]) {
    assert.match(source, /test → infinite_craft/u);
    assert.match(source, /Makers/u);
    assert.match(source, /Redis/u);
    assert.match(source, /SQLite/u);
    assert.match(source, /自动发布/u);
  }

  assert.match(readme, /Render.*暂停/su);
  assert.doesNotMatch(readme, /方式 3：EdgeOne Makers/u);
});
