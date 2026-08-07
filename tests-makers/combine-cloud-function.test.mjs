import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestPost,
} from "../cloud-functions/api/combine.js";

function context({ body, env = {}, fetchImpl, headers = {} }) {
  return {
    request: new Request("https://game.example/api/combine", {
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

test("Cloud combine orchestrates Edge preparation, model call, and Edge completion", async () => {
  const calls = [];
  const result = {
    a: "云",
    b: "人",
    result: "云上鹅",
    emoji: "🪿",
    source: "llm",
  };
  const response = await onRequestPost(context({
    body: { a: "云", b: "人", session_id: "cloud-combine" },
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_MODELS_KEY: "makers-secret",
      MAKERS_INTERNAL_ORIGIN: "https://internal.example",
    },
    headers: { cookie: "craft_player=existing" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === "https://internal.example/api/internal/combine/prepare") {
        return new Response(JSON.stringify({
          state: "model_required",
          provider: "makers",
          payload: {
            messages: [{ role: "user", content: "combine" }],
          },
        }), { status: 200 });
      }
      if (url === "https://ai-gateway.edgeone.link/v1/chat/completions") {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content:
                '{"name":"云上鹅","emoji":"🪿","comment":"云端合成成功。"}',
            },
          }],
        }), { status: 200 });
      }
      if (url === "https://internal.example/api/internal/combine/complete") {
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "set-cookie": "craft_player=created; Path=/" },
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer admin-secret",
  );
  assert.equal(calls[0].init.headers.cookie, "craft_player=existing");
  assert.equal(
    calls[1].init.headers.authorization,
    "Bearer makers-secret",
  );
  const completion = JSON.parse(calls[2].init.body);
  assert.equal(completion.generated.name, "云上鹅");
  assert.match(response.headers.get("set-cookie"), /craft_player=created/u);
});

test("Cloud combine returns known Edge results without calling a model", async () => {
  let calls = 0;
  const known = {
    a: "水",
    b: "火",
    result: "蒸汽",
    emoji: "💨",
    source: "seed",
  };
  const response = await onRequestPost(context({
    body: { a: "水", b: "火", session_id: "known-combine" },
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_INTERNAL_ORIGIN: "https://internal.example",
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        state: "complete",
        result: known,
      }), { status: 200 });
    },
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), known);
  assert.equal(calls, 1);
});
