import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestPost,
} from "../cloud-functions/internal/llm-proxy.js";

function context({
  body,
  headers = {},
  env = {},
  fetchImpl,
}) {
  return {
    request: new Request("https://makers.example/internal/llm-proxy", {
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

test("Cloud Function model proxy authenticates and forwards Makers requests", async () => {
  let captured;
  const env = {
    ADMIN_TOKEN: "admin-secret",
    MAKERS_MODELS_KEY: "makers-secret",
  };
  const denied = await onRequestPost(context({
    body: { provider: "makers", payload: {} },
    env,
  }));
  assert.equal(denied.status, 401);

  const response = await onRequestPost(context({
    body: {
      provider: "makers",
      payload: {
        model: "attacker-model",
        messages: [{ role: "user", content: "ping" }],
      },
    },
    headers: { authorization: "Bearer admin-secret" },
    env,
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

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://ai-gateway.edgeone.link/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer makers-secret");
  assert.equal(
    JSON.parse(captured.init.body).model,
    "@makers/deepseek-v4-flash",
  );
});

test("Cloud Function model proxy selects the direct DeepSeek route", async () => {
  let captured;
  const response = await onRequestPost(context({
    body: {
      provider: "deepseek",
      payload: { messages: [{ role: "user", content: "ping" }] },
    },
    headers: { authorization: "Bearer admin-secret" },
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_DEEPSEEK_API_KEY: "deepseek-secret",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response('{"ok":true}', { status: 200 });
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer deepseek-secret");
  assert.equal(JSON.parse(captured.init.body).model, "deepseek-v4-flash");
});
