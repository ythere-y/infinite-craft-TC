import {
  requestPreparedModelCombination,
} from "../../../edge-functions/_lib/llm.js";
import {
  signModelTicket,
  verifyModelTicket,
} from "../../../edge-functions/_lib/model-ticket.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const secret = String(
    env.SESSION_SECRET || env.ADMIN_TOKEN || "",
  ).trim();
  if (!secret) {
    return json({ detail: "模型中继服务未配置签名密钥" }, 503);
  }
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ detail: "请求体不是合法 JSON" }, 400);
  }
  const now = typeof context.now === "function"
    ? Number(context.now())
    : Date.now();
  const task = await verifyModelTicket(secret, body?.ticket, { now });
  if (
    task?.kind !== "model_request" ||
    !["makers", "deepseek"].includes(task?.provider) ||
    !task?.input ||
    typeof task.input !== "object" ||
    !task?.payload ||
    typeof task.payload !== "object"
  ) {
    return json({ detail: "模型任务无效或已过期" }, 401);
  }

  const generated = await requestPreparedModelCombination({
    env,
    fetchImpl: context.fetchImpl || globalThis.fetch,
    payload: task.payload,
    provider: task.provider,
  });
  if (!generated) {
    return json({ detail: "模型未能生成有效合成结果" }, 502);
  }
  const ticket = await signModelTicket(secret, {
    kind: "model_result",
    exp: Math.min(Number(task.exp), now + 60_000),
    input: task.input,
    generated,
  });
  return json({ state: "model_complete", ticket });
}
