import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestPost,
} from "../cloud-functions/api/model/combine.js";
import {
  signModelTicket,
  verifyModelTicket,
} from "../edge-functions/_lib/model-ticket.js";

test("Cloud model route verifies a task and signs the generated result", async () => {
  const now = 1_700_000_000_000;
  const requestTicket = await signModelTicket("ticket-secret", {
    kind: "model_request",
    exp: now + 60_000,
    input: {
      a: "票据甲",
      b: "票据乙",
      session_id: "ticket-session",
      player_id: "p_ticket",
    },
    provider: "makers",
    payload: { messages: [{ role: "user", content: "combine" }] },
  });
  let captured;
  const response = await onRequestPost({
    request: new Request("https://game.example/api/model/combine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: requestTicket }),
    }),
    env: {
      ADMIN_TOKEN: "ticket-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    now: () => now,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content:
              '{"name":"票据产物","emoji":"🎫","comment":"签名链路完成。"}',
          },
        }],
      }), { status: 200 });
    },
  });
  const body = await response.json();
  const completed = await verifyModelTicket(
    "ticket-secret",
    body.ticket,
    { now },
  );

  assert.equal(response.status, 200);
  assert.equal(captured.url, "https://ai-gateway.edgeone.link/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer makers-secret");
  assert.equal(completed.kind, "model_result");
  assert.equal(completed.generated.name, "票据产物");
  assert.equal(completed.input.player_id, "p_ticket");
});

test("Cloud model route rejects an invalid task before model access", async () => {
  let modelCalls = 0;
  const response = await onRequestPost({
    request: new Request("https://game.example/api/model/combine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: "invalid" }),
    }),
    env: {
      ADMIN_TOKEN: "ticket-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async () => {
      modelCalls += 1;
      throw new Error("must not call");
    },
  });

  assert.equal(response.status, 401);
  assert.equal(modelCalls, 0);
});
