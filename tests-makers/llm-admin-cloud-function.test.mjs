import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestPost,
} from "../cloud-functions/api/admin/llm/test.js";

function context({
  body,
  headers = {},
  env = {},
  fetchImpl,
}) {
  return {
    request: new Request("https://makers.example/api/admin/llm/test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
    fetchImpl,
  };
}

test("admin LLM test runs from the Cloud Function runtime", async () => {
  let captured;
  const response = await onRequestPost(context({
    body: { provider: "makers" },
    headers: { authorization: "Bearer admin-secret" },
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.provider, "makers");
  assert.equal(body.message, "连接成功");
  assert.equal(
    captured.url,
    "https://ai-gateway.edgeone.link/v1/chat/completions",
  );
  assert.equal(captured.init.headers.authorization, "Bearer makers-secret");
});

test("admin LLM test preserves authentication and safe upstream errors", async () => {
  const env = {
    ADMIN_TOKEN: "admin-secret",
    MAKERS_DEEPSEEK_API_KEY: "deepseek-secret",
  };
  const denied = await onRequestPost(context({
    body: { provider: "deepseek" },
    env,
  }));
  assert.equal(denied.status, 401);

  const failed = await onRequestPost(context({
    body: { provider: "deepseek" },
    headers: { authorization: "Bearer admin-secret" },
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: "invalid_request_error", message: "secret details" },
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  }));
  const body = await failed.json();

  assert.equal(failed.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.provider, "deepseek");
  assert.equal(body.http_status, 400);
  assert.equal(body.error_code, "invalid_request_error");
  assert.doesNotMatch(JSON.stringify(body), /secret details/u);
});
