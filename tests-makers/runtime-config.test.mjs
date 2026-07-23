import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeKv } from "../edge-functions/_lib/runtime-config.js";

const productionKv = { name: "production" };

test("a remote request always selects the production KV", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
    productionKv,
    env: { APP_ENV: "dev" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kv, productionKv);
  assert.equal(result.appEnv, "makers");
});

test("a loopback Makers request is rejected before KV access", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const result = resolveRuntimeKv({
      request: new Request(`http://${host}:8088/api/health`),
      productionKv,
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /npm run dev/u);
  }
});

test("missing production KV reports the test binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /\btest\b/u);
  assert.doesNotMatch(result.message, /test_dev/u);
});
