import {
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../_generated/bounty-content.js";
import { createContentInitializer } from "../_lib/content-initializer.js";
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

  const initializer = createContentInitializer({ kv: runtime.kv });
  let initialization;
  try {
    initialization = await initializer.ensureInitialized();
  } catch (error) {
    let status = null;
    try {
      status = await initializer.readStatus();
    } catch {
      // Health must remain available even when content-state reads fail.
    }
    initialization = {
      ready: false,
      status: status || {
        epoch: CONTENT_EPOCH,
        catalog_digest: CATALOG_DIGEST,
        status: "migrating",
        mode: "unknown",
        phase: "detect",
        cursor: null,
        index: 0,
        started_at: null,
        completed_at: null,
        error: `${error?.name || "Error"}: ${
          error?.message || String(error)
        }`,
      },
    };
  }
  const path = new URL(request.url).pathname.replace(/\/+$/u, "") || "/";
  if (!initialization.ready) {
    if (path === "/api/health") {
      return createRouter({
        kv: runtime.kv,
        env: { ...(env || {}), APP_ENV: runtime.appEnv },
        contentStatus: initialization.status,
      }).handle(request);
    }
    return errorResponse(
      503,
      "内容初始化中，请稍后重试",
      { content: initialization.status },
      "CONTENT_INITIALIZING",
    );
  }

  return createRouter({
    kv: runtime.kv,
    env: { ...(env || {}), APP_ENV: runtime.appEnv },
    contentStatus: initialization.status,
  }).handle(request);
}
