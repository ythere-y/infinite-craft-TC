import { createRouter } from "../../edge-functions/_lib/router.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validKvNamespace(kv) {
  return (
    kv &&
    typeof kv.get === "function" &&
    typeof kv.put === "function" &&
    typeof kv.delete === "function" &&
    typeof kv.list === "function"
  );
}

export async function onRequestPost(context) {
  const kv = context.kv || globalThis.test;
  if (!validKvNamespace(kv)) {
    return json({
      detail: "生产 KV 绑定无效：请确认 test → infinite_craft",
    }, 500);
  }
  return createRouter({
    kv,
    env: {
      ...(context.env || {}),
      APP_ENV: context.env?.APP_ENV || "makers",
    },
    fetchImpl: context.fetchImpl || globalThis.fetch,
  }).handle(context.request);
}
