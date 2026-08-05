import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import { errorResponse } from "../edge-functions/_lib/http.js";

const execFileAsync = promisify(execFile);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("retired root entrypoints are removed or organized under scripts", async () => {
  assert.equal(await exists("render.yaml"), false);
  assert.equal(await exists("deploy/legacy/render.yaml"), false);
  assert.equal(await exists("run.sh"), false);
  assert.equal(await exists("reset.sh"), false);
  assert.equal(await exists("scripts/local/run-conda.sh"), true);
  assert.equal(await exists("scripts/local/reset-redis.sh"), true);

  for (const path of [
    "scripts/local/run-conda.sh",
    "scripts/local/reset-redis.sh",
  ]) {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--stage", "--", path],
      { encoding: "utf8" },
    );
    assert.match(stdout, /^100755\s/u, `${path} is executable in Git`);
  }
});

test("AI process documents use the tracked dated agent directory", async () => {
  assert.equal(await exists(".agent/README.md"), true);
  assert.equal(await exists("docs/plans"), false);
  assert.equal(await exists("docs/improvements"), false);
  assert.equal(await exists("docs/superpowers"), false);

  const names = (await readdir(".agent/docs"))
    .filter((name) => name.endsWith(".md"));
  assert.notEqual(names.length, 0);
  for (const name of names) {
    assert.match(name, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/u);
  }
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

test("HTTP errors support an optional stable code without changing legacy calls", async () => {
  const coded = errorResponse(
    503,
    "内容初始化中，请稍后重试",
    { content: { status: "migrating" } },
    "CONTENT_INITIALIZING",
  );
  assert.equal(coded.status, 503);
  assert.deepEqual(await coded.json(), {
    detail: "内容初始化中，请稍后重试",
    code: "CONTENT_INITIALIZING",
    details: { content: { status: "migrating" } },
  });

  const legacy = errorResponse(400, "旧错误", { field: "a" });
  assert.deepEqual(await legacy.json(), {
    detail: "旧错误",
    details: { field: "a" },
  });
});
