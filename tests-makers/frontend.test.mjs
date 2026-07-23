import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectUnseenPrefix,
  mergeFirstItems,
} from "../frontend/wall/polling.js";

test("wall uses visibility-aware incremental polling instead of SSE", async () => {
  const source = await readFile("frontend/wall/wall.js", "utf8");

  assert.doesNotMatch(source, /new EventSource\s*\(/);
  assert.match(source, /offset=\$\{offset\}&limit=\$\{POLL_PAGE_SIZE\}/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pollNewFirsts/);
});

test("wall polling stops at the first known row instead of replaying history", () => {
  const known = new Set(["已见最新", "旧记录"]);
  const result = collectUnseenPrefix(
    [
      { result: "新记录2", seq: 102 },
      { result: "新记录1", seq: 101 },
      { result: "已见最新", seq: 100 },
      { result: "旧记录", seq: 99 },
    ],
    known,
  );

  assert.equal(result.boundaryFound, true);
  assert.deepEqual(
    result.items.map((item) => item.result),
    ["新记录2", "新记录1"],
  );
  assert.deepEqual(
    mergeFirstItems(
      [{ result: "已见最新", seq: 100 }],
      result.items,
    ).map((item) => item.result),
    ["新记录2", "新记录1", "已见最新"],
  );
});

test("an established 40-row wall does not treat rows 41-500 as fresh", () => {
  const incoming = Array.from({ length: 500 }, (_, index) => ({
    result: `历史${500 - index}`,
    seq: 500 - index,
  }));
  const known = new Set(incoming.slice(0, 40).map((item) => item.result));

  const result = collectUnseenPrefix(incoming, known);
  assert.equal(result.boundaryFound, true);
  assert.deepEqual(result.items, []);
});

test("frontend supports protected admin stats and batched recipe verification", async () => {
  const [admin, app] = await Promise.all([
    readFile("frontend/admin/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
  ]);

  assert.match(admin, /sessionStorage\.getItem\("infinity_admin_token"\)/);
  assert.match(admin, /authorization:\s*`Bearer \$\{token\}`/);
  assert.match(app, /const VERIFY_BATCH_SIZE = 500/);
  assert.match(app, /formatValid\.slice\(index, index \+ VERIFY_BATCH_SIZE\)/);
});
