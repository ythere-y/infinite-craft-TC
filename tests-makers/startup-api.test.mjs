import assert from "node:assert/strict";
import test from "node:test";

await import("../frontend/startup-api.js");

const {
  loadInitialCatalog,
  startupErrorMessage,
  warmContentUntilReady,
} = globalThis.STARTUP_API;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("initial catalog retries a migrating response before returning data", async () => {
  let attempt = 0;
  const sleeps = [];
  const fetchImpl = async (path) => {
    const currentAttempt = Math.floor(attempt / 2);
    attempt += 1;
    if (currentAttempt === 0) {
      return jsonResponse({
        code: "CONTENT_INITIALIZING",
        details: { content: { status: "migrating" } },
      }, 503);
    }
    if (path === "/api/starters") {
      return jsonResponse({
        starters: [{ name: "水", emoji: "💧" }],
      });
    }
    return jsonResponse({
      elements: { 水: { emoji: "💧", category: "classic" } },
    });
  };

  const result = await loadInitialCatalog({
    fetchImpl,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
  });

  assert.equal(attempt, 4);
  assert.deepEqual(sleeps, [25]);
  assert.equal(result.starters[0].name, "水");
  assert.equal(result.elements["水"].emoji, "💧");
});

test("startup errors distinguish expired access from content migration", () => {
  assert.equal(
    startupErrorMessage({ status: 401 }),
    "访问链接已过期或当前网络区域受限，请从 EdgeOne 控制台重新打开预览链接",
  );
  assert.equal(
    startupErrorMessage({ status: 503, code: "CONTENT_INITIALIZING" }),
    "游戏内容正在初始化，页面会在后台继续准备，请稍后再试",
  );
});

test("content warmup polls health sequentially until migration is ready", async () => {
  const phases = [
    { status: "migrating", phase: "seed_elements", index: 20 },
    { status: "migrating", phase: "verify_catalog", index: 20 },
    { status: "ready", phase: "ready" },
  ];
  const progress = [];
  let calls = 0;

  const result = await warmContentUntilReady({
    fetchImpl: async () => {
      const content = phases[calls];
      calls += 1;
      return jsonResponse({ content });
    },
    maxAttempts: 5,
    intervalMs: 10,
    sleepImpl: async () => {},
    onProgress: (content) => progress.push(content.phase),
  });

  assert.equal(calls, 3);
  assert.equal(result.status, "ready");
  assert.deepEqual(progress, [
    "seed_elements",
    "verify_catalog",
    "ready",
  ]);
});
