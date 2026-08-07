import {
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../_generated/bounty-content.js";
import { createContentInitializer } from "../_lib/content-initializer.js";
import { errorResponse } from "../_lib/http.js";
import {
  createRouter,
  publicContentStatus,
} from "../_lib/router.js";
import { resolveRuntimeKv } from "../_lib/runtime-config.js";

function validKvNamespace(kv) {
  return (
    kv &&
    typeof kv.get === "function" &&
    typeof kv.put === "function" &&
    typeof kv.delete === "function" &&
    typeof kv.list === "function"
  );
}

function isReadyContentState(status) {
  return (
    status?.status === "ready" &&
    Number(status.epoch) === CONTENT_EPOCH &&
    status.catalog_digest === CATALOG_DIGEST
  );
}

const PUBLIC_INITIALIZATION_ERROR_CODES = new Set([
  "CONTENT_RESET_NOT_AUTHORIZED",
  "CONTENT_RESET_RECEIPT_INVALID",
]);
const PUBLIC_INITIALIZATION_ERROR_REASONS = new Set([
  "differential_conflict",
  "higher_epoch",
  "missing_receipt",
  "ready_conflict",
  "receipt_missing_verify",
  "receipt_shape",
  "source_conflict",
]);
const MIGRATION_SAFE_PATHS = new Set([
  "/api/elements",
  "/api/health",
  "/api/starters",
]);
const KV_DESTROY_PATH = "/api/admin/kv/destroy";

export async function onRequest({ request, env }) {
  const runtime = resolveRuntimeKv({
    request,
    productionKv: typeof test === "undefined" ? undefined : test,
  });
  if (!runtime.ok) {
    return errorResponse(500, runtime.message);
  }
  if (!validKvNamespace(runtime.kv)) {
    return errorResponse(
      500,
      "生产 KV 绑定无效：请确认 test → infinite_craft",
      undefined,
      "KV_BINDING_INVALID",
    );
  }
  const path = new URL(request.url).pathname.replace(/\/+$/u, "") || "/";
  if (path === KV_DESTROY_PATH) {
    return createRouter({
      kv: runtime.kv,
      env: { ...(env || {}), APP_ENV: runtime.appEnv },
      modelProxyUrl: new URL("/internal/llm-proxy", request.url).href,
    }).handle(request);
  }

  let initializer = null;
  let initialization;
  let initializationErrorCode = "";
  let initializationErrorReason = "";
  try {
    initializer = createContentInitializer({
      kv: runtime.kv,
      batchSize: 20,
      scanBatchSize: 100,
      workBudget: 1,
    });
    initialization = await initializer.ensureInitialized();
  } catch (error) {
    initializationErrorCode = PUBLIC_INITIALIZATION_ERROR_CODES.has(
      error?.code,
    )
      ? error.code
      : "";
    initializationErrorReason = PUBLIC_INITIALIZATION_ERROR_REASONS.has(
      error?.reason,
    )
      ? error.reason
      : "";
    let status = null;
    if (initializer) {
      try {
        status = await initializer.readStatus();
      } catch {
        // Health must remain available even when content-state reads fail.
      }
    }
    const ready = isReadyContentState(status);
    initialization = {
      ready,
      failed: !ready,
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
  const publicStatus = publicContentStatus(initialization.status, {
    initializationFailed: initialization.failed === true,
    initializationErrorCode,
    initializationErrorReason,
  });
  if (!initialization.ready && !isReadyContentState(initialization.status)) {
    if (MIGRATION_SAFE_PATHS.has(path)) {
      return createRouter({
        kv: runtime.kv,
        env: { ...(env || {}), APP_ENV: runtime.appEnv },
        contentStatus: publicStatus,
        modelProxyUrl: new URL("/internal/llm-proxy", request.url).href,
      }).handle(request);
    }
    return errorResponse(
      503,
      "内容初始化中，请稍后重试",
      { content: publicStatus },
      "CONTENT_INITIALIZING",
    );
  }

  return createRouter({
    kv: runtime.kv,
    env: { ...(env || {}), APP_ENV: runtime.appEnv },
    contentStatus: publicStatus,
    modelProxyUrl: new URL("/internal/llm-proxy", request.url).href,
  }).handle(request);
}
