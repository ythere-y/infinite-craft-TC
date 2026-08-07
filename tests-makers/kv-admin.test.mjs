import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Makers admin exposes a guarded, batched KV destruction control", async () => {
  const [html, source] = await Promise.all([
    readFile("frontend/admin/index.html", "utf8"),
    readFile("frontend/admin/kv-admin.js", "utf8"),
  ]);

  assert.match(html, /data-admin-tab="danger"/u);
  assert.match(html, /id="kv-destroy"/u);
  assert.match(html, /不会访问或删除本地 SQLite、Redis/u);
  assert.match(source, /\/api\/admin\/kv\/destroy/u);
  assert.match(source, /DESTROY_ALL_MAKERS_KV/u);
  assert.match(source, /清空 Makers KV/u);
  assert.match(source, /MAX_BATCHES/u);
});
