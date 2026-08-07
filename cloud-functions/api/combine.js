import {
  requestPreparedModelCombination,
} from "../../edge-functions/_lib/llm.js";

const DEFAULT_INTERNAL_ORIGIN =
  "http://5f43541ba5b63b76a1598026e2918ac2.makers-preview.qcdntest.net";

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function cookiePair(setCookie) {
  return String(setCookie || "").split(";", 1)[0];
}

async function forwardResponse(response, setCookie = "") {
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ||
        "application/json; charset=utf-8",
      ...(setCookie ? { "set-cookie": setCookie } : {}),
    },
  });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const adminToken = String(env.ADMIN_TOKEN || "").trim();
  if (!adminToken) {
    return json({ detail: "合成服务未配置内部凭据" }, 503);
  }

  let input;
  try {
    input = await context.request.json();
  } catch {
    return json({ detail: "请求体不是合法 JSON" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ detail: "请求体必须是对象" }, 400);
  }

  const fetchImpl = context.fetchImpl || globalThis.fetch;
  const internalOrigin = String(
    env.MAKERS_INTERNAL_ORIGIN || DEFAULT_INTERNAL_ORIGIN,
  ).replace(/\/+$/u, "");
  const originalCookie = context.request.headers.get("cookie") || "";
  const internalRequest = (path, body, cookie = originalCookie) =>
    fetchImpl(`${internalOrigin}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${adminToken}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  let preparedResponse;
  try {
    preparedResponse = await internalRequest(
      "/api/internal/combine/prepare",
      input,
    );
  } catch {
    return json({ detail: "合成状态服务暂不可用" }, 502);
  }
  const preparedCookie = preparedResponse.headers.get("set-cookie") || "";
  if (!preparedResponse.ok) {
    return forwardResponse(preparedResponse, preparedCookie);
  }

  let prepared;
  try {
    prepared = await preparedResponse.json();
  } catch {
    return json({ detail: "合成状态响应无效" }, 502);
  }
  if (prepared?.state === "complete") {
    return json(prepared.result, 200, {
      ...(preparedCookie ? { "set-cookie": preparedCookie } : {}),
    });
  }
  if (
    prepared?.state !== "model_required" ||
    !["makers", "deepseek"].includes(prepared?.provider) ||
    !prepared?.payload ||
    typeof prepared.payload !== "object"
  ) {
    return json({ detail: "合成状态响应无效" }, 502);
  }

  const generated = await requestPreparedModelCombination({
    env,
    fetchImpl,
    payload: prepared.payload,
    provider: prepared.provider,
  });
  if (!generated) {
    return json({ detail: "模型未能生成有效合成结果" }, 502);
  }

  const completionCookie =
    originalCookie || cookiePair(preparedCookie);
  let completedResponse;
  try {
    completedResponse = await internalRequest(
      "/api/internal/combine/complete",
      { input, generated },
      completionCookie,
    );
  } catch {
    return json({ detail: "合成结果保存失败" }, 502);
  }
  const completedCookie =
    completedResponse.headers.get("set-cookie") || preparedCookie;
  return forwardResponse(completedResponse, completedCookie);
}
