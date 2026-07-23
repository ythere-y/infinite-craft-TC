const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function resolveRuntimeKv({ request, productionKv } = {}) {
  if (isLocalRequest(request)) {
    return {
      ok: false,
      message:
        "Makers Edge Function 不用于本地开发；请运行 npm run dev",
    };
  }

  if (!productionKv) {
    return {
      ok: false,
      message: "生产 KV 未绑定：请确认 test → infinite_craft",
    };
  }

  return {
    ok: true,
    kv: productionKv,
    appEnv: "makers",
  };
}
