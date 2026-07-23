import { errorResponse } from "../_lib/http.js";
import { createRouter } from "../_lib/router.js";
import { resolveRuntimeKv } from "../_lib/runtime-config.js";

export async function onRequest({ request, env }) {
  const runtime = resolveRuntimeKv({
    request,
    productionKv: typeof test === "undefined" ? undefined : test,
  });
  if (!runtime.ok) {
    return errorResponse(500, runtime.message);
  }
  return createRouter({
    kv: runtime.kv,
    env: { ...(env || {}), APP_ENV: runtime.appEnv },
  }).handle(request);
}
