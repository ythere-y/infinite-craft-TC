(function exposeStartupApi(root) {
  class StartupRequestError extends Error {
    constructor(message, {
      status = 0,
      code = "",
      details = null,
    } = {}) {
      super(message);
      this.name = "StartupRequestError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  const defaultSleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function requestJson(path, fetchImpl) {
    const response = await fetchImpl(path, { cache: "no-store" });
    let body = null;
    try {
      body = await response.json();
    } catch {
      throw new StartupRequestError(
        response.ok ? "接口返回了无效数据" : `HTTP ${response.status}`,
        { status: response.status },
      );
    }
    if (!response.ok) {
      throw new StartupRequestError(
        body?.detail || body?.message || `HTTP ${response.status}`,
        {
          status: response.status,
          code: body?.code || "",
          details: body?.details || null,
        },
      );
    }
    return body;
  }

  async function loadInitialCatalog({
    fetchImpl = root.fetch.bind(root),
    maxAttempts = 4,
    retryDelayMs = 500,
    sleepImpl = defaultSleep,
  } = {}) {
    const attempts = Math.max(1, Number(maxAttempts) || 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const [starterBody, elementBody] = await Promise.all([
          requestJson("/api/starters", fetchImpl),
          requestJson("/api/elements", fetchImpl),
        ]);
        if (
          !Array.isArray(starterBody?.starters) ||
          !elementBody?.elements ||
          typeof elementBody.elements !== "object" ||
          Array.isArray(elementBody.elements)
        ) {
          throw new StartupRequestError("初始元素接口返回格式无效");
        }
        return {
          starters: starterBody.starters,
          elements: elementBody.elements,
        };
      } catch (error) {
        const retryable = (
          error?.status === 503 &&
          error?.code === "CONTENT_INITIALIZING"
        );
        if (!retryable || attempt >= attempts) throw error;
        await sleepImpl(retryDelayMs * attempt);
      }
    }
    throw new StartupRequestError("初始元素加载失败");
  }

  function startupErrorMessage(error) {
    if (Number(error?.status) === 401) {
      return "访问链接已过期或当前网络区域受限，请从 EdgeOne 控制台重新打开预览链接";
    }
    if (
      Number(error?.status) === 503 &&
      error?.code === "CONTENT_INITIALIZING"
    ) {
      return "游戏内容正在初始化，页面会在后台继续准备，请稍后再试";
    }
    return "加载初始元素失败，请稍后重试";
  }

  async function warmContentUntilReady({
    fetchImpl = root.fetch.bind(root),
    maxAttempts = 240,
    intervalMs = 1_000,
    sleepImpl = defaultSleep,
    onProgress = () => {},
  } = {}) {
    const attempts = Math.max(1, Number(maxAttempts) || 1);
    let latest = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const body = await requestJson("/api/health", fetchImpl);
      latest = body?.content || null;
      if (latest) onProgress(latest);
      if (latest?.status === "ready") return latest;
      if (latest?.error_code) {
        throw new StartupRequestError(
          latest.error || "内容初始化失败",
          {
            status: 503,
            code: latest.error_code,
            details: { content: latest },
          },
        );
      }
      if (attempt < attempts) await sleepImpl(intervalMs);
    }
    return latest || { status: "migrating", phase: "detect" };
  }

  root.STARTUP_API = Object.freeze({
    StartupRequestError,
    loadInitialCatalog,
    startupErrorMessage,
    warmContentUntilReady,
  });
})(typeof window === "undefined" ? globalThis : window);
