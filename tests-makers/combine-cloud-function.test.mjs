import assert from "node:assert/strict";
import test from "node:test";

import {
  onRequestPost,
} from "../cloud-functions/api/combine.js";
import {
  entityKey,
  normalizePair,
} from "../edge-functions/_lib/keys.js";
import { FakeKV } from "./fake-kv.mjs";

function context({ body, env = {}, fetchImpl, headers = {}, kv }) {
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
    kv,
  };
}

test("Cloud combine uses the bound KV and calls the selected model directly", async () => {
  const calls = [];
  const kv = new FakeKV();
  const response = await onRequestPost(context({
    body: {
      a: "Cloud直连甲",
      b: "Cloud直连乙",
      session_id: "cloud-combine",
    },
    kv,
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
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
      throw new Error(`unexpected URL ${url}`);
    },
  }));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.result, "云上鹅");
  assert.equal(result.source, "llm");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].init.headers.authorization,
    "Bearer makers-secret",
  );
  assert.equal(
    JSON.parse(calls[0].init.body).model,
    "@makers/deepseek-v4-flash",
  );
  assert.equal(
    JSON.parse(await kv.get(
      await entityKey(
        "combo",
        normalizePair("Cloud直连甲", "Cloud直连乙"),
      ),
    )).result,
    "云上鹅",
  );
});

test("Cloud combine reuses its KV cache without a second model request", async () => {
  const kv = new FakeKV();
  let modelCalls = 0;
  const options = {
    body: { a: "缓存云", b: "缓存鹅", session_id: "cached-combine" },
    kv,
    env: {
      ADMIN_TOKEN: "admin-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content:
              '{"name":"缓存产物","emoji":"💾","comment":"一次生成，后续复用。"}',
          },
        }],
      }), { status: 200 });
    },
  };
  const first = await onRequestPost(context(options));
  const second = await onRequestPost(context(options));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).result, "缓存产物");
  assert.equal(modelCalls, 1);
});
