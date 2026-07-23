const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function normalizedAppEnv(env) {
  return String(env?.APP_ENV || "").trim().toLowerCase();
}

function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function resolveRuntimeKv({
  request,
  env = {},
  productionKv,
  developmentKv,
} = {}) {
  const configuredEnv = normalizedAppEnv(env);
  const development = configuredEnv === "dev";

  if (isLocalRequest(request) && !development) {
    return {
      ok: false,
      message:
        "本地 Makers 开发必须使用 APP_ENV=dev；请运行 npm run makers:dev",
    };
  }

  const kv = development ? developmentKv : productionKv;
  if (!kv) {
    return {
      ok: false,
      message: development
        ? "开发 KV 未绑定：请确认 test_dev → infinite_craft_dev"
        : "生产 KV 未绑定：请确认 test → infinite_craft",
    };
  }

  return {
    ok: true,
    kv,
    appEnv: development ? "dev" : configuredEnv || "makers",
  };
}
