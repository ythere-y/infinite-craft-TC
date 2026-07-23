import { errorResponse } from "../_lib/http.js";
import { createRouter } from "../_lib/router.js";

export async function onRequest({ request, env }) {
  if (typeof test === "undefined") {
    return errorResponse(
      500,
      "KV 未绑定：请将 infinite_craft 命名空间以变量名 test 绑定到项目",
    );
  }
  return createRouter({ kv: test, env }).handle(request);
}
