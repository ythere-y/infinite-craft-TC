import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wall uses visibility-aware incremental polling instead of SSE", async () => {
  const source = await readFile("frontend/wall/wall.js", "utf8");

  assert.doesNotMatch(source, /new EventSource\s*\(/);
  assert.match(source, /\/api\/wall\/page\?offset=0&limit=/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pollNewFirsts/);
});

