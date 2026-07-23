import {
  COMBINATIONS,
  ELEMENTS,
  RECIPES_BY_RESULT,
  STARTERS,
} from "../_generated/seed-data.js";
import { buildBounty, buildCategory } from "./bounty.js";
import { createGameService } from "./game-service.js";
import {
  CORS_HEADERS,
  HttpError,
  errorResponse,
  jsonResponse,
  optionsResponse,
  readJson,
} from "./http.js";
import { TIERS, rankFor } from "./kpi.js";
import { cleanText, normalizePair } from "./keys.js";
import { KvStore } from "./kv-store.js";
import { llmConfiguration } from "./llm.js";
import {
  generateNickname,
  nicknameStats,
  randomSuffix,
} from "./nickname.js";

const MAX_VERIFY_RECIPES = 500;
const MAX_RECIPE_FIELD_LENGTH = 80;
const VERIFY_READ_BATCH = 20;

function intParam(searchParams, name, fallback, minimum, maximum) {
  const raw = searchParams.get(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function decoded(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, `${label} 编码无效`);
  }
}

function requireMethod(request, expected) {
  if (request.method !== expected) {
    throw new HttpError(405, `只支持 ${expected} 请求`);
  }
}

function dynamicAndSeedElements(dynamic) {
  return { ...(dynamic || {}), ...ELEMENTS };
}

async function mapInBatches(items, batchSize, worker) {
  const output = [];
  for (let index = 0; index < items.length; index += batchSize) {
    output.push(
      ...(await Promise.all(
        items.slice(index, index + batchSize).map(worker),
      )),
    );
  }
  return output;
}

export function createRouter({
  kv,
  env = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  random = Math.random,
} = {}) {
  const store = new KvStore(kv, { now });
  const game = createGameService({ store, env, fetchImpl, now, random });

  async function candidateNickname() {
    return generateNickname({ random });
  }

  async function allocateNickname() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const nickname = await candidateNickname();
      if (await store.claimNickname(nickname)) return nickname;
    }
    const base = await candidateNickname();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const nickname = `${base}_${randomSuffix(3, random)}`;
      if (await store.claimNickname(nickname)) return nickname;
    }
    const nickname = `${base}_${randomSuffix(6, random)}`;
    await store.touchNickname(nickname);
    return nickname;
  }

  async function combinedElements() {
    return dynamicAndSeedElements(await store.dynamicElements());
  }

  async function getKnownCombination(a, b) {
    return (
      COMBINATIONS[normalizePair(a, b)] ||
      (await store.getCombination(a, b)) ||
      null
    );
  }

  async function recipePayload(target) {
    const elements = await combinedElements();
    const seeded = RECIPES_BY_RESULT[target] || [];
    const dynamic = await store.dynamicRecipes(target);
    const seen = new Set();
    const recipes = [];
    for (const recipe of [...seeded, ...dynamic]) {
      const pair = normalizePair(recipe.a, recipe.b);
      if (seen.has(pair)) continue;
      seen.add(pair);
      recipes.push({
        a: recipe.a,
        b: recipe.b,
        a_emoji: elements[recipe.a]?.emoji || "❓",
        b_emoji: elements[recipe.b]?.emoji || "❓",
        source: recipe.source || null,
        chain: recipe.chain || null,
        hit_count: Number(recipe.hit_count) || 0,
      });
      if (recipes.length >= 100) break;
    }
    return {
      result: target,
      result_emoji: elements[target]?.emoji || "❓",
      count: recipes.length,
      recipes,
    };
  }

  async function adminPayload() {
    const [base, firsts, nickCount] = await Promise.all([
      store.adminStats(),
      store.allFirsts(),
      store.nicknameCount(),
    ]);
    const leaderboard = await store.leaderboard({
      limit: 10,
      items: firsts,
    });
    return {
      ...base,
      env: env.APP_ENV || "makers",
      nick_count: nickCount,
      firsts_total: firsts.length,
      top_discoverers: leaderboard.top,
      recent_firsts: firsts.slice(0, 15),
    };
  }

  function dashboardAccessMode() {
    if (cleanText(env.DASHBOARD_PUBLIC) === "1") return "public";
    if (cleanText(env.ADMIN_TOKEN)) return "protected";
    return "disabled";
  }

  function requireDashboardAccess(request) {
    if (dashboardAccessMode() === "public") return;
    const expected = cleanText(env.ADMIN_TOKEN);
    if (!expected) {
      throw new HttpError(
        503,
        "管理面板已关闭：请配置 ADMIN_TOKEN，或显式设置 DASHBOARD_PUBLIC=1",
      );
    }
    const authorization = cleanText(request.headers.get("authorization"));
    const bearer = authorization.match(/^Bearer\s+(.+)$/iu)?.[1] || "";
    const explicit = cleanText(request.headers.get("x-admin-token"));
    if (bearer !== expected && explicit !== expected) {
      throw new HttpError(401, "管理面板凭据无效");
    }
  }

  async function handleApi(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return optionsResponse();

    if (path === "/api/tiers") {
      requireMethod(request, "GET");
      return jsonResponse({ tiers: TIERS });
    }
    if (path === "/api/starters") {
      requireMethod(request, "GET");
      return jsonResponse({ starters: STARTERS });
    }
    if (path === "/api/elements") {
      requireMethod(request, "GET");
      return jsonResponse({ elements: await combinedElements() });
    }
    if (path === "/api/health") {
      requireMethod(request, "GET");
      const config = llmConfiguration(env);
      let kvStatus = "ok";
      try {
        await kv.get("snapshot_health");
      } catch (error) {
        kvStatus = `error: ${error?.name || "KVError"}`;
      }
      return jsonResponse({
        kv: kvStatus,
        redis: "replaced_by_edgeone_kv",
        redis_dbsize: null,
        sqlite: null,
        app_env: env.APP_ENV || "makers",
        llm: config.configured ? "configured" : "not_configured",
        llm_config: {
          configured: config.configured,
          provider: "edgeone-makers-models",
          base_url: config.baseUrl,
          model: config.model,
        },
        security: {
          dashboard: dashboardAccessMode(),
          model_calls_per_minute: Math.max(
            1,
            Math.min(
              1_000,
              Number(env.MODEL_CALLS_PER_MINUTE) || 20,
            ),
          ),
        },
      });
    }

    if (path === "/api/nickname" || path === "/api/nickname/peek") {
      requireMethod(request, "GET");
      const nickname =
        path === "/api/nickname"
          ? await allocateNickname()
          : await candidateNickname();
      return jsonResponse({ nickname });
    }
    if (path === "/api/nickname/claim") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const nickname = cleanText(body?.nickname);
      if (!nickname) throw new HttpError(400, "nickname 不能为空");
      if ([...nickname].length > 80) {
        throw new HttpError(400, "nickname 过长");
      }
      if (await store.claimNickname(nickname)) {
        return jsonResponse({ ok: true, nickname });
      }
      return jsonResponse({
        ok: false,
        nickname: await candidateNickname(),
        reason: "已被占用，已重抽一个",
      });
    }
    if (path === "/api/nickname/touch") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const nickname = cleanText(body?.nickname);
      if ([...nickname].length > 80) {
        throw new HttpError(400, "nickname 过长");
      }
      return jsonResponse(await store.touchNickname(nickname));
    }
    if (path === "/api/nickname/stats") {
      requireMethod(request, "GET");
      return jsonResponse(nicknameStats());
    }

    if (path === "/api/combine") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const sessionId = cleanText(body?.session_id) || "anonymous";
      const clientIp = cleanText(request.eo?.clientIp);
      return jsonResponse(
        await game.combine({
          ...body,
          client_identity: clientIp
            ? `${clientIp}:${sessionId}`
            : sessionId,
        }),
      );
    }
    if (path === "/api/session/kpi") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const sessionId = cleanText(body?.session_id);
      if (!sessionId) throw new HttpError(400, "session_id 不能为空");
      if ([...sessionId].length > 128) {
        throw new HttpError(400, "session_id 过长");
      }
      const delta = Math.max(
        -1_000_000,
        Math.min(1_000_000, Number(body?.delta) || 0),
      );
      const total = await store.addKpi(
        sessionId,
        delta,
        cleanText(body?.reason).slice(0, 200),
      );
      return jsonResponse({ ok: true, total });
    }
    if (path === "/api/recipes/verify") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const input = Array.isArray(body?.recipes) ? body.recipes : [];
      if (input.length > MAX_VERIFY_RECIPES) {
        throw new HttpError(
          400,
          `每次最多校验 ${MAX_VERIFY_RECIPES} 条配方`,
        );
      }
      const valid = [];
      const invalid = [];
      const unknown = [];
      const candidates = [];
      for (const recipe of input) {
        const a = cleanText(recipe?.a);
        const b = cleanText(recipe?.b);
        const result = cleanText(recipe?.result);
        if (!a || !b || !result) {
          invalid.push({ a, b, reason: "缺少必填字段" });
          continue;
        }
        if (
          [...a].length > MAX_RECIPE_FIELD_LENGTH ||
          [...b].length > MAX_RECIPE_FIELD_LENGTH ||
          [...result].length > MAX_RECIPE_FIELD_LENGTH
        ) {
          invalid.push({ a, b, reason: "字段过长" });
          continue;
        }
        candidates.push({ a, b, result });
      }

      const checks = await mapInBatches(
        candidates,
        VERIFY_READ_BATCH,
        async (recipe) => ({
          ...recipe,
          hit: await getKnownCombination(recipe.a, recipe.b),
        }),
      );
      for (const { a, b, result, hit } of checks) {
        if (!hit) {
          unknown.push({ a, b });
        } else if (hit.result !== result) {
          invalid.push({
            a,
            b,
            expected: hit.result,
            got: result,
            reason: "result 与全球配方不一致",
          });
        } else {
          valid.push({ a, b, result: hit.result, emoji: hit.emoji });
        }
      }
      return jsonResponse({
        valid,
        invalid,
        unknown,
        total_input: input.length,
      });
    }

    if (path === "/api/rank") {
      requireMethod(request, "GET");
      const total = intParam(
        url.searchParams,
        "total",
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      return jsonResponse({ total, ...rankFor(total) });
    }
    const sessionRank = path.match(/^\/api\/session\/([^/]+)\/rank$/);
    if (sessionRank) {
      requireMethod(request, "GET");
      const sessionId = decoded(sessionRank[1], "session_id");
      const total = await store.kpiTotal(sessionId);
      return jsonResponse({ session_id: sessionId, total, ...rankFor(total) });
    }

    if (path === "/api/wall/stream") {
      requireMethod(request, "GET");
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (path === "/api/wall/recent") {
      requireMethod(request, "GET");
      const limit = intParam(url.searchParams, "limit", 50, 1, 500);
      return jsonResponse({ items: await store.recentFirsts(limit) });
    }
    if (path === "/api/wall/page") {
      requireMethod(request, "GET");
      return jsonResponse(
        await store.firstPage({
          offset: intParam(url.searchParams, "offset", 0, 0, 10_000_000),
          limit: intParam(url.searchParams, "limit", 100, 1, 500),
        }),
      );
    }
    if (path === "/api/wall/leaderboard") {
      requireMethod(request, "GET");
      return jsonResponse(
        await store.leaderboard({
          limit: intParam(url.searchParams, "limit", 20, 1, 100),
          me: url.searchParams.get("me"),
        }),
      );
    }
    if (path === "/api/wall/bounty") {
      requireMethod(request, "GET");
      return jsonResponse(
        buildBounty({
          elements: await combinedElements(),
          starters: STARTERS,
          firsts: await store.allFirsts(),
        }),
      );
    }
    const categoryMatch = path.match(/^\/api\/wall\/category\/([^/]+)$/);
    if (categoryMatch) {
      requireMethod(request, "GET");
      const category = cleanText(decoded(categoryMatch[1], "category"));
      if (!category) throw new HttpError(400, "category 不能为空");
      return jsonResponse(
        buildCategory({
          category,
          elements: await combinedElements(),
          starters: STARTERS,
          firsts: await store.allFirsts(),
        }),
      );
    }

    if (path === "/api/admin/stats") {
      requireMethod(request, "GET");
      requireDashboardAccess(request);
      return jsonResponse(await adminPayload());
    }
    if (path === "/api/analytics/chains") {
      requireMethod(request, "GET");
      requireDashboardAccess(request);
      const limit = intParam(url.searchParams, "limit", 10, 1, 100);
      return jsonResponse({ items: await store.analyticsChains(limit) });
    }
    if (path === "/api/analytics/discoverers") {
      requireMethod(request, "GET");
      requireDashboardAccess(request);
      const limit = intParam(url.searchParams, "limit", 10, 1, 100);
      const result = await store.leaderboard({ limit });
      return jsonResponse({
        items: result.top.map(({ discoverer, firsts }) => ({
          discoverer,
          firsts,
        })),
      });
    }
    if (path === "/api/analytics/combinations") {
      requireMethod(request, "GET");
      requireDashboardAccess(request);
      const limit = intParam(url.searchParams, "limit", 20, 1, 100);
      return jsonResponse({
        items: await store.analyticsCombinations(limit),
      });
    }

    const recipeMatch = path.match(/^\/api\/element\/([^/]+)\/recipes$/);
    if (recipeMatch) {
      requireMethod(request, "GET");
      const target = cleanText(decoded(recipeMatch[1], "name"));
      if (!target) throw new HttpError(400, "name 不能为空");
      return jsonResponse(await recipePayload(target));
    }

    return errorResponse(404, "API 不存在");
  }

  async function handle(request) {
    try {
      return await handleApi(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message, error.details);
      }
      if (Number(error?.status) >= 400 && Number(error?.status) < 600) {
        return errorResponse(Number(error.status), error.message || "请求失败");
      }
      return errorResponse(500, "服务暂时不可用");
    }
  }

  return { handle };
}
