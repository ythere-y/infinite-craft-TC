import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeKv } from "../edge-functions/_lib/runtime-config.js";

const productionKv = { name: "production" };
const developmentKv = { name: "development" };

test("APP_ENV=dev selects only the development KV binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://127.0.0.1:8088/api/health"),
    env: { APP_ENV: "dev" },
    productionKv,
    developmentKv,
  });

  assert.equal(result.ok, true);
  assert.equal(result.kv, developmentKv);
  assert.equal(result.appEnv, "dev");
});

test("a remote production request defaults to the production KV binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
    env: {},
    productionKv,
    developmentKv,
  });

  assert.equal(result.ok, true);
  assert.equal(result.kv, productionKv);
  assert.equal(result.appEnv, "makers");
});

test("missing development KV fails without falling back to production", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://localhost:8088/api/health"),
    env: { APP_ENV: "dev" },
    productionKv,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /test_dev/);
});

test("an unmarked local request is rejected before production KV access", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://localhost:8088/api/health"),
    env: {},
    productionKv,
    developmentKv,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /APP_ENV=dev/);
});

test("missing production KV reports the production binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
    env: { APP_ENV: "prod" },
    developmentKv,
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /\btest\b/);
  assert.doesNotMatch(result.message, /test_dev/);
});
