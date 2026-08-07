import {
  COMBINATIONS,
  ELEMENTS,
  RECIPES_BY_RESULT,
  STARTERS,
} from "../_generated/seed-data.js";
import {
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../_generated/bounty-content.js";
import {
  MAX_RECIPE_FIELD_LENGTH,
  MAX_SESSION_ID_LENGTH,
  MAX_VERIFY_RECIPES,
} from "../_generated/runtime-contract-data.js";
import {
  buildBounty,
  buildCategory,
  normalizeBountyAlias,
} from "./bounty.js";
import { createGameService } from "./game-service.js";
import {
  CORS_HEADERS,
  HttpError,
  errorResponse,
  jsonResponse,
  optionsResponse,
  readJson,
} from "./http.js";
import {
  BASE_STAR_COST,
  LEVEL_ICONS,
  MERGE_BASE,
  rankFor,
  STAR_COST_STEP,
} from "./kpi.js";
import { cleanText, normalizePair } from "./keys.js";
import { KvStore } from "./kv-store.js";
import { PromptStore } from "./prompt-store.js";
import {
  defaultLLMProvider,
  llmConfiguration,
  testLLMConnection,
} from "./llm.js";
import {
  generateNickname,
  nicknameStats,
  randomSuffix,
} from "./nickname.js";
import {
  adminSessionCookie,
  clearAdminSessionCookie,
  CommunityStore,
  hasAdminSession,
  normalizePublicPagination,
  playerIdentity,
} from "./community.js";
import {
  attachIcon,
  normalizeIcon,
  resolveIconRecipe,
} from "./icon-recipes.js";

const VERIFY_READ_BATCH = 20;
const KV_DESTROY_BATCH_SIZE = 100;
const KV_DESTROY_CONFIRMATION = "DESTROY_ALL_MAKERS_KV";
const PUBLIC_CONTENT_MODES = new Set([
  "ready",
  "bootstrap",
  "epoch_reset",
  "differential",
  "unknown",
]);
const PUBLIC_CONTENT_ERROR_CODES = new Set([
  "CONTENT_RESET_NOT_AUTHORIZED",
  "CONTENT_RESET_RECEIPT_INVALID",
]);
const PUBLIC_CONTENT_ERROR_REASONS = new Set([
  "differential_conflict",
  "higher_epoch",
  "missing_receipt",
  "ready_conflict",
  "receipt_missing_verify",
  "receipt_shape",
  "source_conflict",
]);
const PUBLIC_CONTENT_PHASES = new Set([
  "detect",
  "purge_runtime_data",
  "seed_starters",
  "seed_elements",
  "seed_recipes",
  "rebuild_indexes",
  "verify_catalog",
  "ready",
]);
export function publicContentStatus(
  value,
  {
    initializationFailed = false,
    initializationErrorCode = "",
    initializationErrorReason = "",
  } = {},
) {
  const epoch = Number(value?.epoch);
  const rawStatus = cleanText(value?.status);
  const rawMode = cleanText(value?.mode);
  const rawPhase = cleanText(value?.phase);
  const rawDigest = cleanText(value?.catalog_digest);
  const index = Number(value?.index);
  const hasError = initializationFailed || Boolean(cleanText(value?.error));
  const requestedErrorCode = cleanText(
    initializationErrorCode || value?.error_code,
  );
  const publicErrorCode = PUBLIC_CONTENT_ERROR_CODES.has(requestedErrorCode)
    ? requestedErrorCode
    : "CONTENT_INITIALIZATION_FAILED";
  const requestedErrorReason = cleanText(
    initializationErrorReason || value?.error_reason,
  );
  const publicErrorReason = PUBLIC_CONTENT_ERROR_REASONS.has(
    requestedErrorReason,
  )
    ? requestedErrorReason
    : "";
  const currentTarget = (
    epoch === CONTENT_EPOCH &&
    rawDigest === CATALOG_DIGEST
  );
  const ready = (
    currentTarget &&
    rawStatus === "ready" &&
    rawMode === "ready" &&
    rawPhase === "ready" &&
    !hasError
  );
  const migrating = currentTarget && rawStatus === "migrating";

  return {
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: ready ? "ready" : "migrating",
    mode: ready
      ? "ready"
      : migrating &&
          PUBLIC_CONTENT_MODES.has(rawMode) &&
          rawMode !== "ready"
        ? rawMode
        : "unknown",
    phase: ready
      ? "ready"
      : migrating &&
          PUBLIC_CONTENT_PHASES.has(rawPhase) &&
          rawPhase !== "ready"
        ? rawPhase
        : "detect",
    ...(migrating && Number.isSafeInteger(index) && index >= 0
      ? { index }
      : {}),
    ...(hasError
      ? {
          error: "内容初始化暂时失败",
          error_code: publicErrorCode,
          ...(publicErrorReason ? { error_reason: publicErrorReason } : {}),
        }
      : {}),
  };
}

function intParam(searchParams, name, fallback, minimum, maximum) {
  const raw = searchParams.get(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function lastQueryValue(searchParams, name) {
  const values = searchParams.getAll(name);
  return values.length ? values[values.length - 1] : null;
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
  const output = { ...(dynamic || {}) };
  for (const [name, seed] of Object.entries(ELEMENTS)) {
    const persisted = normalizeIcon(output[name]?.icon);
    output[name] = {
      ...(output[name] || {}),
      ...seed,
      ...(persisted ? { icon: persisted } : {}),
    };
  }
  return output;
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
  contentStatus = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  random = Math.random,
  promptLimits,
} = {}) {
  const store = new KvStore(kv, { now });
  const game = createGameService({
    store,
    env,
    fetchImpl,
    now,
    random,
    promptLimits,
  });
  const community = new CommunityStore(kv, { now });
  const prompts = new PromptStore(kv, { now, random });

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
    const elements = dynamicAndSeedElements(await store.dynamicElements());
    return Object.fromEntries(
      Object.entries(elements).map(([name, info]) => [
        name,
        attachIcon(name, info),
      ]),
    );
  }

  async function combinedStarters() {
    const elements = await combinedElements();
    return STARTERS.map((starter) => ({
      ...starter,
      ...(normalizeIcon(elements[starter.name]?.icon)
        ? { icon: elements[starter.name].icon }
        : {}),
    }));
  }

  function elementIcon(elements, name, emoji = "❓") {
    const info = elements[name] || {};
    return resolveIconRecipe({
      name,
      emoji: info.emoji || emoji,
      category: info.category,
      chain: info.chain || null,
      comment: info.comment || "",
      persisted: info.icon,
    });
  }

  function withFirstIcons(items, elements) {
    return (items || []).map((item) => ({
      ...item,
      icon: elementIcon(
        elements,
        item?.result || "",
        item?.emoji || "❓",
      ),
    }));
  }

  function withFormulaIcons(formula, elements) {
    if (!formula) return formula;
    return {
      ...formula,
      result_icon: elementIcon(
        elements,
        formula.result || "",
        formula.emoji || "❓",
      ),
      a_icon: elementIcon(elements, formula.a || ""),
      b_icon: elementIcon(elements, formula.b || ""),
    };
  }

  async function getKnownCombination(a, b) {
    const canonicalA = normalizeBountyAlias(a);
    const canonicalB = normalizeBountyAlias(b);
    return (
      COMBINATIONS[normalizePair(canonicalA, canonicalB)] ||
      (await store.getCombination(canonicalA, canonicalB)) ||
      null
    );
  }

  async function recipePayload(target) {
    const elements = await combinedElements();
    const seeded = Object.hasOwn(RECIPES_BY_RESULT, target)
      ? RECIPES_BY_RESULT[target]
      : [];
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
        a_icon: elementIcon(elements, recipe.a),
        b_icon: elementIcon(elements, recipe.b),
        source: recipe.source || null,
        chain: recipe.chain || null,
        comment:
          typeof recipe.comment === "string"
            ? recipe.comment.trim()
            : "",
        hit_count: Number(recipe.hit_count) || 0,
      });
      if (recipes.length >= 100) break;
    }
    return {
      result: target,
      result_emoji: elements[target]?.emoji || "❓",
      result_icon: elementIcon(elements, target),
      count: recipes.length,
      recipes,
    };
  }

  async function adminPayload() {
    const [base, firsts, nickCount, elements] = await Promise.all([
      store.adminStats(),
      store.allFirsts(),
      store.nicknameCount(),
      combinedElements(),
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
      recent_firsts: withFirstIcons(firsts.slice(0, 15), elements),
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

  function requireAdminAccess(request) {
    const expected = cleanText(env.ADMIN_TOKEN);
    if (!expected) {
      throw new HttpError(503, "管理配置已关闭：请配置 ADMIN_TOKEN");
    }
    const authorization = cleanText(request.headers.get("authorization"));
    const bearer = authorization.match(/^Bearer\s+(.+)$/iu)?.[1] || "";
    const explicit = cleanText(request.headers.get("x-admin-token"));
    if (bearer !== expected && explicit !== expected) {
      throw new HttpError(401, "管理面板凭据无效");
    }
  }

  function promptRevision(request) {
    const value = cleanText(request.headers.get("if-match"));
    const match = value.match(/^(?:W\/)?"?(\d+)"?$/u);
    if (!match) throw new HttpError(428, "缺少有效的 If-Match 草稿版本");
    return Number(match[1]);
  }

  async function llmAdminConfiguration(provider = null) {
    const selected = provider || await store.llmProvider(defaultLLMProvider(env));
    return {
      provider: selected,
      providers: ["makers", "deepseek"].map((candidate) => ({
        id: candidate,
        label: candidate === "makers" ? "Makers" : "DeepSeek",
        configured: llmConfiguration(env, candidate).configured,
      })),
    };
  }

  async function requireCommunityRate(playerId, operation, limit) {
    const quota = await store.consumeRateLimit(
      `community:${operation}:${playerId}`,
      { limit, windowSeconds: 60 },
    );
    if (!quota.allowed) throw new HttpError(429, "操作过于频繁，请稍后再试");
  }

  function requireSameOrigin(request) {
    const origin = cleanText(request.headers.get("origin"));
    if (origin && origin !== new URL(request.url).origin) {
      throw new HttpError(403, "拒绝跨站管理员请求");
    }
  }

  async function handleApi(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return optionsResponse();

    if (path === "/api/tiers") {
      requireMethod(request, "GET");
      return jsonResponse({
        tiers: [],
        level_rules: {
          base_star_cost: BASE_STAR_COST,
          star_cost_step: STAR_COST_STEP,
          merge_base: MERGE_BASE,
          icons: LEVEL_ICONS,
        },
      });
    }
    if (path === "/api/starters") {
      requireMethod(request, "GET");
      return jsonResponse({ starters: await combinedStarters() });
    }
    if (path === "/api/elements") {
      requireMethod(request, "GET");
      return jsonResponse({ elements: await combinedElements() });
    }
    if (path === "/api/health") {
      requireMethod(request, "GET");
      let kvStatus = "ok";
      let provider = defaultLLMProvider(env);
      try {
        provider = await store.llmProvider(provider);
      } catch {
        kvStatus = "error: KVError";
      }
      const config = llmConfiguration(
        env,
        provider,
      );
      try {
        await kv.get("snapshot_health");
      } catch {
        kvStatus = "error: KVError";
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
          provider: config.provider,
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
        content: publicContentStatus(contentStatus),
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
      const identity = await playerIdentity(request, env);
      const result = await game.combine({
          ...body,
          player_id: identity.id,
          client_identity: clientIp
            ? `${clientIp}:${sessionId}`
            : sessionId,
        });
      return jsonResponse(result, {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
    }
    if (path === "/api/community/formulas") {
      requireMethod(request, "GET");
      const [items, elements] = await Promise.all([
        community.listPublic(normalizePublicPagination({
          limit: lastQueryValue(url.searchParams, "limit"),
          offset: lastQueryValue(url.searchParams, "offset"),
        })),
        combinedElements(),
      ]);
      return jsonResponse({
        items: items.map((item) => withFormulaIcons(item, elements)),
      });
    }
    const publishMatch = path.match(/^\/api\/community\/formulas\/([^/]+)\/publish$/);
    if (publishMatch) {
      requireMethod(request, "POST");
      const identity = await playerIdentity(request, env);
      await requireCommunityRate(identity.id, "publish", 10);
      const formula = await community.publish(publishMatch[1], identity.id);
      const elements = await combinedElements();
      return jsonResponse({
        formula: withFormulaIcons(community.publicView(formula), elements),
      }, {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
    }
    const voteMatch = path.match(/^\/api\/community\/formulas\/([^/]+)\/vote$/);
    if (voteMatch) {
      requireMethod(request, "PUT");
      const identity = await playerIdentity(request, env);
      await requireCommunityRate(identity.id, "vote", 30);
      const body = await readJson(request);
      const value = Number(body?.value);
      if (![1, 0, -1].includes(value)) throw new HttpError(400, "vote 必须是 -1、0 或 1");
      const formula = await community.vote(voteMatch[1], identity.id, value);
      return jsonResponse(formula, {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
    }
    const detailMatch = path.match(/^\/api\/community\/formulas\/([^/]+)$/);
    if (detailMatch) {
      requireMethod(request, "GET");
      const identity = await playerIdentity(request, env);
      const formula = await community.publicFormula(detailMatch[1], identity.id);
      if (!formula) throw new HttpError(404, "公开公式不存在");
      return jsonResponse(withFormulaIcons(formula, await combinedElements()), {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
    }
    if (path === "/api/community/admin/logout") {
      requireMethod(request, "POST");
      requireSameOrigin(request);
      return jsonResponse({ ok: true }, {
        headers: { "set-cookie": clearAdminSessionCookie() },
      });
    }
    if (path === "/api/community/admin/login") {
      requireMethod(request, "POST");
      requireSameOrigin(request);
      const body = await readJson(request);
      if (!cleanText(env.ADMIN_TOKEN) || cleanText(body?.key) !== cleanText(env.ADMIN_TOKEN)) {
        throw new HttpError(401, "管理员密钥错误或未配置");
      }
      return jsonResponse({ ok: true }, {
        headers: { "set-cookie": await adminSessionCookie(env, now()) },
      });
    }
    if (path === "/api/community/admin/queue") {
      requireMethod(request, "GET");
      requireSameOrigin(request);
      if (!(await hasAdminSession(request, env, now()))) throw new HttpError(401, "管理员会话无效");
      const [items, elements] = await Promise.all([
        community.queue(env),
        combinedElements(),
      ]);
      return jsonResponse({
        items: items.map((item) => withFormulaIcons(item, elements)),
      });
    }
    const moderateMatch = path.match(/^\/api\/community\/admin\/formulas\/([^/]+)\/moderate$/);
    if (moderateMatch) {
      requireMethod(request, "POST");
      requireSameOrigin(request);
      if (!(await hasAdminSession(request, env, now()))) throw new HttpError(401, "管理员会话无效");
      const body = await readJson(request);
      const formula = await community.moderate(
        moderateMatch[1], cleanText(body?.action),
        cleanText(body?.reason_code), cleanText(body?.note),
      );
      return jsonResponse({
        formula: withFormulaIcons(formula, await combinedElements()),
      });
    }
    if (path === "/api/session/score" || path === "/api/session/kpi") {
      requireMethod(request, "POST");
      const body = await readJson(request);
      const sessionId = cleanText(body?.session_id);
      if (!sessionId) throw new HttpError(400, "session_id 不能为空");
      if ([...sessionId].length > MAX_SESSION_ID_LENGTH) {
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
      const recipeText = (value) =>
        typeof value === "string" ? cleanText(value) : "";
      for (const recipe of input) {
        const a = recipeText(recipe?.a);
        const b = recipeText(recipe?.b);
        const result = recipeText(recipe?.result);
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
        candidates.push({
          a: normalizeBountyAlias(a),
          b: normalizeBountyAlias(b),
          result,
        });
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
      const [items, elements] = await Promise.all([
        store.recentFirsts(limit),
        combinedElements(),
      ]);
      return jsonResponse({ items: withFirstIcons(items, elements) });
    }
    if (path === "/api/wall/page") {
      requireMethod(request, "GET");
      const identity = await playerIdentity(request, env);
      const page = await store.firstPage({
          offset: intParam(url.searchParams, "offset", 0, 0, 10_000_000),
          limit: intParam(url.searchParams, "limit", 100, 1, 500),
        });
      const elements = await combinedElements();
      const formulas = await community.publicByResults(
        page.items.map((item) => item.result),
        identity.id,
      );
      const reactions = await community.reactionsByResults(
        page.items.map((item) => item.result),
        identity.id,
      );
      const items = withFirstIcons(page.items, elements).map((item) => (
        {
          ...item,
          reaction: reactions[item.result] || community.emptyReaction(),
          ...(formulas[item.result]
            ? {
                formula: withFormulaIcons(
                  formulas[item.result],
                  elements,
                ),
              }
            : {}),
        }
      ));
      return jsonResponse({ ...page, items }, {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
    }
    const elementVoteMatch = path.match(/^\/api\/wall\/elements\/([^/]+)\/vote$/);
    if (elementVoteMatch) {
      requireMethod(request, "PUT");
      const identity = await playerIdentity(request, env);
      await requireCommunityRate(identity.id, "element-vote", 60);
      const body = await readJson(request);
      const value = Number(body?.value);
      const result = cleanText(decoded(elementVoteMatch[1], "name"));
      return jsonResponse(await community.voteResult(result, identity.id, value), {
        headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
      });
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
    if (path === "/api/admin/kv/destroy") {
      requireMethod(request, "POST");
      requireAdminAccess(request);
      requireSameOrigin(request);
      const body = await readJson(request);
      if (body?.confirmation !== KV_DESTROY_CONFIRMATION) {
        throw new HttpError(400, "毁灭确认文字不匹配");
      }
      const page = await kv.list({ limit: KV_DESTROY_BATCH_SIZE });
      const keys = (page?.keys || [])
        .map((item) => cleanText(item?.key || item?.name))
        .filter(Boolean)
        .slice(0, KV_DESTROY_BATCH_SIZE);
      await Promise.all(keys.map((key) => kv.delete(key)));
      return jsonResponse({
        deleted: keys.length,
        done: keys.length === 0,
      });
    }
    if (path === "/api/admin/llm/config") {
      requireAdminAccess(request);
      if (request.method === "GET") {
        return jsonResponse(await llmAdminConfiguration());
      }
      requireMethod(request, "PUT");
      const body = await readJson(request);
      const provider = cleanText(body?.provider);
      if (!["makers", "deepseek"].includes(provider)) {
        throw new HttpError(400, "provider 必须是 makers 或 deepseek");
      }
      await store.setLLMProvider(provider);
      return jsonResponse(await llmAdminConfiguration(provider));
    }
    if (path === "/api/admin/llm/test") {
      requireMethod(request, "POST");
      requireAdminAccess(request);
      const body = await readJson(request);
      const provider = cleanText(body?.provider);
      if (!["makers", "deepseek"].includes(provider)) {
        throw new HttpError(400, "provider 必须是 makers 或 deepseek");
      }
      return jsonResponse(await testLLMConnection({
        env,
        provider,
        fetchImpl,
      }));
    }
    if (path === "/api/admin/prompt/config") {
      requireAdminAccess(request);
      if (request.method === "GET") {
        const payload = await prompts.configuration({
          limit: intParam(url.searchParams, "version_limit", 50, 1, 100),
          offset: intParam(url.searchParams, "version_offset", 0, 0, 10_000),
        });
        return jsonResponse(payload, {
          headers: { etag: `"${payload.revision}"` },
        });
      }
      requireMethod(request, "PUT");
      const body = await readJson(request);
      const payload = await prompts.saveDraft(
        body?.config,
        promptRevision(request),
      );
      return jsonResponse(payload, {
        headers: { etag: `"${payload.revision}"` },
      });
    }
    if (path === "/api/admin/prompt/aggregate") {
      requireMethod(request, "POST");
      requireAdminAccess(request);
      const body = await readJson(request);
      return jsonResponse(await prompts.aggregate(Number(body?.expected_revision)));
    }
    const promptVersionMatch = path.match(
      /^\/api\/admin\/prompt\/versions\/([^/]+)(?:\/(activate|copy-to-draft))?$/,
    );
    if (promptVersionMatch) {
      requireAdminAccess(request);
      const versionId = cleanText(decoded(promptVersionMatch[1], "version_id"));
      if (!versionId) throw new HttpError(400, "version_id 不能为空");
      const action = promptVersionMatch[2] || "";
      if (action === "activate") {
        requireMethod(request, "POST");
        return jsonResponse(await prompts.activate(versionId));
      }
      if (action === "copy-to-draft") {
        requireMethod(request, "POST");
        const body = await readJson(request);
        const payload = await prompts.copyToDraft(
          versionId,
          Number(body?.expected_revision),
        );
        return jsonResponse(payload, {
          headers: { etag: `"${payload.revision}"` },
        });
      }
      if (request.method === "GET") {
        return jsonResponse(await prompts.getVersion(versionId));
      }
      requireMethod(request, "DELETE");
      await prompts.deleteVersion(versionId);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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
      const target = normalizeBountyAlias(
        decoded(recipeMatch[1], "name"),
      );
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
