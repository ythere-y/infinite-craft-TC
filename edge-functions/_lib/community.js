import { PROMPT_SPEC } from "../_generated/prompt-data.js";
import { cleanText, entityKey, normalizePair, sha256Hex } from "./keys.js";
import { normalizeComment } from "./comments.js";

const INDEX_KEY = "community_public_formulas";
const RETIRED_INDEX_KEY = "community_retired_formulas";
const MAX_PUBLIC_INDEX = 500;
const MAX_PUBLIC_PAGE = 100;
// This is a retirement catalogue capacity, independent from prompt limits.
const MAX_RETIRED_FORMULA_INDEX = 500;
const FORMULA_MARKER_PREFIX = "community_formula_marker_";
const FORMULA_READY_PREFIX = "community_formula_ready_";
const FORMULA_INVENTORY_PREFIX = "community_formula_inventory_";
const FORMULA_MARKER_PAGE_SIZE = 256;
const FORMULA_RECORD_KEY = /^community_formula_[a-f0-9]{32}$/u;
// The public formula catalogue is intentionally bounded for KV read cost.
// Prompt limits select within this catalogue and do not impose another cap.
const PUBLIC_FORMULA_CATALOG_CAPACITY =
  PROMPT_SPEC.capacities.community_formula_catalog;
const FEEDBACK_CATALOG_READ_BATCH_SIZE = 50;
const encoder = new TextEncoder();
const ASCII_QUERY_WHITESPACE = /^[ \t\n\f\r]+|[ \t\n\f\r]+$/g;
const ASCII_DECIMAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

function normalizePublicPageValue(value, fallback, minimum, maximum) {
  let parsed;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const raw = value.replace(ASCII_QUERY_WHITESPACE, "");
    if (!raw || !ASCII_DECIMAL.test(raw)) return fallback;
    parsed = Number(raw);
  } else {
    return fallback;
  }
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function retryableConsistencyError(message) {
  const error = new Error(message);
  error.retryable = true;
  error.status = 503;
  return error;
}

function formulaCreationIntent(formula) {
  return {
    id: formula?.id,
    a: formula?.a,
    b: formula?.b,
    combo_key: formula?.combo_key,
    result: formula?.result,
    emoji: formula?.emoji,
    comment: formula?.comment,
    source: formula?.source,
    version: Number(formula?.version),
    global_discoverer: formula?.global_discoverer || null,
  };
}

function sameFormulaCreationIntent(left, right) {
  return JSON.stringify(formulaCreationIntent(left)) ===
    JSON.stringify(formulaCreationIntent(right));
}

export function normalizePublicPagination({ limit, offset } = {}) {
  return {
    limit: normalizePublicPageValue(limit, 50, 1, MAX_PUBLIC_PAGE),
    offset: normalizePublicPageValue(offset, 0, 0, 10_000_000),
  };
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.get("cookie") || "").split(";").map((part) => {
      const at = part.indexOf("=");
      return at < 0 ? ["", ""] : [part.slice(0, at).trim(), part.slice(at + 1).trim()];
    }).filter(([key]) => key),
  );
}

export async function playerIdentity(request, env = {}) {
  const secret = cleanText(env.SESSION_SECRET || env.ADMIN_TOKEN);
  const token = parseCookies(request).craft_player || "";
  if (secret && token.includes(".")) {
    const [id, signature] = token.split(".");
    if (signature === await hmac(secret, id) && id.startsWith("p_")) {
      return { id, setCookie: null };
    }
  }
  const id = `p_${crypto.randomUUID().replaceAll("-", "")}`;
  if (!secret) return { id, setCookie: null };
  const signed = `${id}.${await hmac(secret, id)}`;
  const secure = cleanText(env.APP_ENV || "makers") !== "dev" ? "; Secure" : "";
  return {
    id,
    setCookie: `craft_player=${signed}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure}`,
  };
}

export async function adminSessionCookie(env = {}, now = Date.now()) {
  const secret = cleanText(env.SESSION_SECRET || env.ADMIN_TOKEN);
  const value = `admin:${Math.floor(now / 1000) + 8 * 3600}`;
  return `craft_admin=${value}.${await hmac(secret, value)}; Max-Age=28800; Path=/; HttpOnly; SameSite=Strict; Secure`;
}

export function clearAdminSessionCookie() {
  return "craft_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict; Secure";
}

export async function hasAdminSession(request, env = {}, now = Date.now()) {
  const secret = cleanText(env.SESSION_SECRET || env.ADMIN_TOKEN);
  const token = parseCookies(request).craft_admin || "";
  const lastDot = token.lastIndexOf(".");
  if (!secret || lastDot < 0) return false;
  const value = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expires = Number(value.split(":")[1] || 0);
  return value.startsWith("admin:") && expires >= now / 1000 && signature === await hmac(secret, value);
}

export class CommunityStore {
  constructor(kv, { now = () => Date.now() } = {}) {
    this.kv = kv;
    this.now = now;
  }
  async get(key, fallback = null) {
    const value = await this.kv.get(key);
    return value == null || value === "" ? fallback : (typeof value === "string" ? JSON.parse(value) : value);
  }
  async put(key, value) {
    await this.kv.put(key, JSON.stringify(value));
    return value;
  }
  async formulaId(pair, version) {
    return (await sha256Hex(`${pair}:v${version}`)).slice(0, 32);
  }
  async formulaPairHash(pair) {
    return sha256Hex(pair);
  }
  async formulaMarkerPrefix(pair) {
    return `${FORMULA_MARKER_PREFIX}${await this.formulaPairHash(pair)}_`;
  }
  async formulaMarkerKey(pair, version) {
    return `${await this.formulaMarkerPrefix(pair)}${String(version).padStart(16, "0")}`;
  }
  async formulaReadyKey(pair, version) {
    return `${FORMULA_READY_PREFIX}${await this.formulaPairHash(pair)}_${String(version).padStart(16, "0")}`;
  }
  async formulaInventoryKey(pair) {
    return `${FORMULA_INVENTORY_PREFIX}${await this.formulaPairHash(pair)}`;
  }
  async readConsistently(key, fallback = null) {
    // KV may briefly return an older replica. A finite immediate reread avoids
    // destructive work based on a single absent or stale value without sleep.
    const first = await this.get(key, fallback);
    const second = await this.get(key, fallback);
    return second ?? first;
  }
  validFormulaVersion(value) {
    const version = Number(value);
    return Number.isSafeInteger(version) && version > 0 ? version : null;
  }
  async listCompleteKeys(prefix) {
    const keys = new Set();
    const cursors = new Set();
    let cursor;
    while (true) {
      let page;
      try {
        page = await this.kv.list(cursor
          ? { prefix, limit: FORMULA_MARKER_PAGE_SIZE, cursor }
          : { prefix, limit: FORMULA_MARKER_PAGE_SIZE });
      } catch {
        throw retryableConsistencyError("社区公式目录暂不可读，请重试");
      }
      if (!page || !Array.isArray(page.keys)) {
        throw retryableConsistencyError("社区公式目录不完整，请重试");
      }
      if (page.complete !== true && page.keys.length === 0) {
        throw retryableConsistencyError("社区公式目录分页不完整，请重试");
      }
      const knownCount = keys.size;
      for (const item of page.keys) {
        const key = item?.key || item?.name;
        if (!key || !key.startsWith(prefix)) {
          throw retryableConsistencyError("社区公式目录不一致，请重试");
        }
        keys.add(key);
      }
      if (page.complete === true) return [...keys].sort();
      if (keys.size === knownCount) {
        throw retryableConsistencyError("社区公式目录分页不完整，请重试");
      }
      if (!page.cursor || cursors.has(page.cursor)) {
        throw retryableConsistencyError("社区公式目录分页不完整，请重试");
      }
      cursors.add(page.cursor);
      cursor = page.cursor;
    }
  }
  async readFormulaMarker(pair, version) {
    const key = await this.formulaMarkerKey(pair, version);
    const marker = await this.readConsistently(key);
    if (!marker) return null;
    const id = await this.formulaId(pair, version);
    if (
      ![1, 2].includes(marker.schema_version) ||
      marker.pair !== pair ||
      this.validFormulaVersion(marker.version) !== version ||
      marker.id !== id
    ) {
      throw retryableConsistencyError("社区公式版本标记不一致，请重试");
    }
    if (marker.schema_version === 2) {
      if (!marker.intent ||
        !sameFormulaCreationIntent(marker.intent, {
          ...marker.intent,
          id, combo_key: pair, version,
        }) ||
        (marker.materializable === true && (!marker.formula ||
          !sameFormulaCreationIntent(marker.formula, marker.intent)))) {
        throw retryableConsistencyError("社区公式版本标记意图不一致，请重试");
      }
    }
    return marker;
  }
  async readFormulaReady(pair, version) {
    const key = await this.formulaReadyKey(pair, version);
    const ready = await this.readConsistently(key);
    if (!ready) return null;
    const id = await this.formulaId(pair, version);
    if (
      ready.schema_version !== 1 ||
      ready.pair !== pair ||
      ready.version !== version ||
      ready.id !== id
    ) {
      throw retryableConsistencyError("社区公式就绪标记不一致，请重试");
    }
    return ready;
  }
  async rememberFormulaReady(pair, formula) {
    const version = this.validFormulaVersion(formula?.version);
    if (!version || !Number.isSafeInteger(version)) {
      throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
    }
    const existing = await this.readFormulaReady(pair, version);
    if (existing) return existing;
    const id = await this.formulaId(pair, version);
    if (formula.id !== id) {
      throw retryableConsistencyError("社区公式就绪标记身份不一致，请重试");
    }
    await this.put(await this.formulaReadyKey(pair, version), {
      schema_version: 1, pair, version, id,
    });
    const readback = await this.readFormulaReady(pair, version);
    if (!readback) {
      throw retryableConsistencyError("社区公式就绪标记暂不可读，请重试");
    }
    return readback;
  }
  async rememberPendingFormulaMarker(pair, formula) {
    const version = this.validFormulaVersion(formula?.version);
    if (!version || !Number.isSafeInteger(version)) {
      throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
    }
    const existing = await this.readFormulaMarker(pair, version);
    if (existing?.schema_version === 2) {
      if (!sameFormulaCreationIntent(existing.intent, formula)) {
        throw retryableConsistencyError("社区公式版本标记意图已变化，请重试");
      }
      return existing;
    }
    const marker = {
      schema_version: 2,
      pair,
      version,
      id: await this.formulaId(pair, version),
      intent: formulaCreationIntent(formula),
      formula: { ...formula },
      materializable: true,
    };
    await this.put(await this.formulaMarkerKey(pair, version), marker);
    const readback = await this.readFormulaMarker(pair, version);
    if (!readback) {
      throw retryableConsistencyError("社区公式版本标记暂不可读，请重试");
    }
    return readback;
  }
  async rememberCommittedFormulaMarker(pair, formula) {
    const version = this.validFormulaVersion(formula?.version);
    if (!version || !Number.isSafeInteger(version)) {
      throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
    }
    // A committed marker must never be able to reconstruct observed history.
    await this.rememberFormulaReady(pair, formula);
    const existing = await this.readFormulaMarker(pair, version);
    if (existing?.schema_version === 2 && existing.materializable !== true) {
      if (!sameFormulaCreationIntent(existing.intent, formula)) {
        throw retryableConsistencyError("社区公式版本标记意图已变化，请重试");
      }
      return existing;
    }
    if (existing?.schema_version === 2 && !sameFormulaCreationIntent(existing.intent, formula)) {
      throw retryableConsistencyError("社区公式版本标记意图已变化，请重试");
    }
    const marker = {
      schema_version: 2,
      pair,
      version,
      id: await this.formulaId(pair, version),
      intent: formulaCreationIntent(formula),
      materializable: false,
    };
    await this.put(await this.formulaMarkerKey(pair, version), marker);
    const readback = await this.readFormulaMarker(pair, version);
    if (!readback || readback.materializable === true) {
      throw retryableConsistencyError("社区公式已提交标记暂不可读，请重试");
    }
    return readback;
  }
  async materializeFormulaMarker(pair, marker) {
    let formula = await this.readVersionedFormula(pair, marker.version);
    if (marker.schema_version === 1) {
      if (!formula) {
        throw retryableConsistencyError("社区公式版本标记缺少恢复意图，请重试");
      }
      await this.rememberCommittedFormulaMarker(pair, formula);
      return formula;
    }
    if (marker.schema_version !== 2) {
      throw retryableConsistencyError("社区公式版本标记缺少恢复意图，请重试");
    }
    const ready = await this.readFormulaReady(pair, marker.version);
    if (!formula) {
      if (ready || marker.materializable !== true || !marker.formula) {
        throw retryableConsistencyError("已就绪社区公式暂不可读，请重试");
      }
      await this.put(`community_formula_${marker.id}`, marker.formula);
      formula = await this.readVersionedFormula(pair, marker.version);
    }
    const markerIntent = marker.materializable === true ? marker.formula : marker.intent;
    if (!formula || !sameFormulaCreationIntent(markerIntent, formula)) {
      throw retryableConsistencyError("社区公式版本记录与标记意图不一致，请重试");
    }
    if (!ready) await this.rememberFormulaReady(pair, formula);
    await this.rememberCommittedFormulaMarker(pair, formula);
    return formula;
  }
  async listFormulaMarkers(pair) {
    const prefix = await this.formulaMarkerPrefix(pair);
    const keys = await this.listCompleteKeys(prefix);
    const markers = [];
    for (const key of keys) {
      const suffix = key.slice(prefix.length);
      if (!/^\d{16}$/u.test(suffix)) {
        throw retryableConsistencyError("社区公式版本标记不一致，请重试");
      }
      const version = this.validFormulaVersion(Number(suffix));
      if (!version || key !== await this.formulaMarkerKey(pair, version)) {
        throw retryableConsistencyError("社区公式版本标记不一致，请重试");
      }
      const marker = await this.readFormulaMarker(pair, version);
      if (!marker) {
        throw retryableConsistencyError("社区公式版本标记暂不可读，请重试");
      }
      markers.push(marker);
    }
    return markers.sort((left, right) => left.version - right.version);
  }
  async legacyFormulaInventory(pair) {
    const formulas = [];
    for (const key of await this.listCompleteKeys("community_formula_")) {
      if (!FORMULA_RECORD_KEY.test(key)) continue;
      const formula = await this.readConsistently(key);
      if (!formula) {
        throw retryableConsistencyError("社区公式历史暂不可读，请重试");
      }
      if (formula.combo_key !== pair) continue;
      const version = this.validFormulaVersion(formula.version);
      if (!version || formula.id !== await this.formulaId(pair, version)) {
        throw retryableConsistencyError("社区公式历史不一致，请重试");
      }
      formulas.push(formula);
    }
    return formulas;
  }
  async formulaInventoryComplete(pair) {
    const inventory = await this.readConsistently(await this.formulaInventoryKey(pair));
    if (!inventory) return false;
    if (inventory.schema_version !== 1 || inventory.pair !== pair || inventory.complete !== true) {
      throw retryableConsistencyError("社区公式目录不一致，请重试");
    }
    return true;
  }
  async inspectFormulaVersions(pair, { revalidateLegacy = false } = {}) {
    const complete = await this.formulaInventoryComplete(pair);
    const formulas = new Map();
    const legacyFormulas = [];
    if (!complete || revalidateLegacy) {
      for (const formula of await this.legacyFormulaInventory(pair)) {
        legacyFormulas.push(formula);
        formulas.set(formula.id, formula);
      }
    }
    const markers = await this.listFormulaMarkers(pair);
    for (const marker of markers) {
      let formula = await this.readVersionedFormula(pair, marker.version);
      if (!formula) {
        if (marker.schema_version === 2 && marker.materializable === true && marker.formula) {
          formula = marker.formula;
        } else {
          throw retryableConsistencyError("社区公式版本记录暂不可读，请重试");
        }
      }
      if (marker.schema_version === 2 && !sameFormulaCreationIntent(marker.intent, formula)) {
        throw retryableConsistencyError("社区公式版本记录与标记意图不一致，请重试");
      }
      formulas.set(formula.id, formula);
    }
    return {
      complete,
      formulas: [...formulas.values()],
      legacyFormulas,
      markers,
    };
  }
  async discoverFormulaVersions(pair, { revalidateLegacy = false, inspection = null } = {}) {
    const scanned = inspection || await this.inspectFormulaVersions(pair, { revalidateLegacy });
    const { complete } = scanned;
    let markersChanged = false;
    if (!complete || revalidateLegacy) {
      for (const formula of scanned.legacyFormulas) {
        const previous = await this.readFormulaMarker(pair, formula.version);
        await this.rememberCommittedFormulaMarker(pair, formula);
        markersChanged ||= !previous || previous.schema_version !== 2 || previous.materializable === true;
      }
    }
    const formulas = [];
    const markers = markersChanged ? await this.listFormulaMarkers(pair) : scanned.markers;
    for (const marker of markers) {
      const formula = await this.materializeFormulaMarker(pair, marker);
      formulas.push(formula);
    }
    if (!complete) {
      await this.put(await this.formulaInventoryKey(pair), {
        schema_version: 1,
        pair,
        complete: true,
      });
    }
    return formulas;
  }
  async readVersionedFormula(pair, version) {
    const id = await this.formulaId(pair, version);
    const formula = await this.readConsistently(`community_formula_${id}`);
    if (!formula) return null;
    if (
      formula.id !== id ||
      formula.combo_key !== pair ||
      this.validFormulaVersion(formula.version) !== version
    ) {
      throw retryableConsistencyError("社区公式版本记录不一致，请重试");
    }
    return formula;
  }
  async createFormula(
    { a, b, result, emoji, comment, source, discoverer },
    version,
  ) {
    const pair = normalizePair(a, b);
    const id = await this.formulaId(pair, version);
    const now = this.now() / 1000;
    return {
      id, a, b, combo_key: pair, result, emoji, comment, source,
      version, visibility: "hidden", status: "active",
      global_discoverer: discoverer || null, first_publisher: null,
      up_votes: 0, down_votes: 0, protected: false,
      ai_positive_enabled: true,
      created_at: now, updated_at: now,
    };
  }
  formulaMatches(formula, input) {
    return formula?.status === "active" &&
      normalizePair(formula.a, formula.b) === normalizePair(input.a, input.b) &&
      cleanText(formula.result) === cleanText(input.result) &&
      cleanText(formula.emoji) === cleanText(input.emoji) &&
      normalizeComment(formula.comment) === normalizeComment(input.comment) &&
      cleanText(formula.source) === cleanText(input.source);
  }
  async rememberReproduction(formula, playerId) {
    const player = cleanText(playerId);
    if (!player) return;
    const key = `community_repro_${formula.id}_${await sha256Hex(player)}`;
    if (!(await this.kv.get(key))) await this.kv.put(key, "1");
  }
  async ensureFormula({ a, b, result, emoji, comment, source, discoverer, playerId }) {
    const pair = normalizePair(a, b);
    const pointerKey = `community_active_${await sha256Hex(pair)}`;
    const pointer = await this.readConsistently(pointerKey);
    let pointedFormula = null;
    if (pointer) {
      const version = this.validFormulaVersion(pointer.version);
      if (!version || pointer.id !== await this.formulaId(pair, version)) {
        throw retryableConsistencyError("社区公式指针不一致，请重试");
      }
      pointedFormula = await this.readVersionedFormula(pair, version);
      if (!pointedFormula) {
        throw retryableConsistencyError("社区公式指向的记录暂不可读，请重试");
      }
      await this.rememberCommittedFormulaMarker(pair, pointedFormula);
      if (pointedFormula.status === "active") {
        await this.rememberFormulaReady(pair, pointedFormula);
        await this.rememberReproduction(pointedFormula, playerId);
        return pointedFormula;
      }
    }
    const known = new Map(
      (await this.discoverFormulaVersions(pair, { revalidateLegacy: !pointer })).map(
        (formula) => [formula.id, formula],
      ),
    );
    if (pointedFormula) known.set(pointedFormula.id, pointedFormula);
    const formulas = [...known.values()];
    const existingActive = formulas
      .filter((formula) => formula.status === "active")
      .sort((left, right) => right.version - left.version)
      .at(0);
    if (existingActive) {
      if (!this.formulaMatches(existingActive, { a, b, result, emoji, comment, source })) {
        throw retryableConsistencyError("社区公式活动版本意图已变化，请重试");
      }
      if (pointer?.id !== existingActive.id || pointer?.version !== existingActive.version) {
        await this.put(pointerKey, { id: existingActive.id, version: existingActive.version });
      }
      await this.rememberReproduction(existingActive, playerId);
      return existingActive;
    }
    const highestVersion = formulas.reduce(
      (highest, formula) => Math.max(highest, formula.version),
      0,
    );
    const version = highestVersion + 1;
    if (!Number.isSafeInteger(version)) {
      throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
    }
    const formula = await this.createFormula({
      a, b, result, emoji, comment, source, discoverer,
    }, version);
    const marker = await this.readFormulaMarker(pair, version);
    if (marker) {
      if (marker.schema_version !== 2 || marker.materializable !== true ||
        !this.formulaMatches(marker.formula, { a, b, result, emoji, comment, source })) {
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      const materialized = await this.materializeFormulaMarker(pair, marker);
      if (materialized.status !== "active") {
        throw retryableConsistencyError("社区公式目标版本不可用，请重试");
      }
      await this.put(pointerKey, { id: materialized.id, version: materialized.version });
      await this.rememberReproduction(materialized, playerId);
      return materialized;
    }
    if (await this.readVersionedFormula(pair, version)) {
      throw retryableConsistencyError("社区公式目标版本已变化，请重试");
    }
    await this.rememberPendingFormulaMarker(pair, formula);
    const materialized = await this.materializeFormulaMarker(
      pair,
      await this.readFormulaMarker(pair, version),
    );
    await this.put(pointerKey, { id: materialized.id, version: materialized.version });
    await this.rememberReproduction(materialized, playerId);
    return materialized;
  }
  async reconcileAuthoritativeFormula(input) {
    const pair = normalizePair(input.a, input.b);
    const pointerKey = `community_active_${await sha256Hex(pair)}`;
    const pointer = await this.readConsistently(pointerKey);
    let pointedFormula = null;
    if (pointer) {
      const pointerVersion = this.validFormulaVersion(pointer.version);
      if (!pointerVersion || pointer.id !== await this.formulaId(pair, pointerVersion)) {
        throw retryableConsistencyError("社区公式指针不一致，请重试");
      }
      pointedFormula = await this.readVersionedFormula(pair, pointerVersion);
      if (!pointedFormula) {
        throw retryableConsistencyError("社区公式指向的记录暂不可读，请重试");
      }
    }

    // Do not write migration state until we know a new version is safe. In
    // particular, a MAX_SAFE_INTEGER history that cannot match the seed must
    // fail without backfilling markers, ready records, or inventories.
    const inspection = await this.inspectFormulaVersions(pair, { revalidateLegacy: !pointer });
    const inspected = new Map(
      inspection.formulas.map(
        (formula) => [formula.id, formula],
      ),
    );
    if (pointedFormula) inspected.set(pointedFormula.id, pointedFormula);
    const inspectedFormulas = [...inspected.values()];
    const inspectedMatch = inspectedFormulas.some((formula) => this.formulaMatches(formula, input));
    if (!inspectedMatch) {
      const highestInspectedVersion = inspectedFormulas.reduce(
        (highest, candidate) => Math.max(highest, candidate.version),
        0,
      );
      if (!Number.isSafeInteger(highestInspectedVersion + 1)) {
        throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
      }
    }

    if (pointedFormula) await this.rememberCommittedFormulaMarker(pair, pointedFormula);
    const known = new Map(
      (await this.discoverFormulaVersions(pair, {
        revalidateLegacy: !pointer,
        inspection,
      })).map(
        (formula) => [formula.id, formula],
      ),
    );
    if (pointedFormula) known.set(pointedFormula.id, pointedFormula);
    const formulas = [...known.values()];
    const matching = formulas
      .filter((formula) => this.formulaMatches(formula, input))
      .sort((left, right) => left.version - right.version);
    let formula = matching.at(-1) || null;
    let needsCreate = false;

    if (!formula) {
      const highestVersion = formulas.reduce(
        (highest, candidate) => Math.max(highest, candidate.version),
        0,
      );
      const version = highestVersion + 1;
      if (!Number.isSafeInteger(version)) {
        throw retryableConsistencyError("社区公式版本超出安全范围，请重试");
      }
      const marker = await this.readFormulaMarker(pair, version);
      if (marker) {
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      const existing = await this.readVersionedFormula(pair, version);
      if (existing) {
        // Discovery and the target preflight disagree, so another edge may
        // have written concurrently. Never replace an observed mismatch.
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      formula = await this.createFormula({
        ...input,
        a: cleanText(input.a),
        b: cleanText(input.b),
        result: cleanText(input.result),
        emoji: cleanText(input.emoji),
        comment: normalizeComment(input.comment),
        source: cleanText(input.source),
      }, version);
      needsCreate = true;
    }

    if (needsCreate) {
      const marker = await this.readFormulaMarker(pair, formula.version);
      if (marker) {
        if (marker.schema_version !== 2 || marker.materializable !== true ||
          !this.formulaMatches(marker.formula, input)) {
          throw retryableConsistencyError("社区公式目标版本已变化，请重试");
        }
        formula = await this.materializeFormulaMarker(pair, marker);
      } else {
        if (await this.readVersionedFormula(pair, formula.version)) {
          throw retryableConsistencyError("社区公式目标版本已变化，请重试");
        }
        await this.rememberPendingFormulaMarker(pair, formula);
        formula = await this.materializeFormulaMarker(
          pair,
          await this.readFormulaMarker(pair, formula.version),
        );
      }
      needsCreate = false;
    }

    const retirees = formulas.filter(
      (candidate) => candidate.status === "active" && candidate.id !== formula.id,
    );
    const newlyRetired = [];
    for (const candidate of retirees) {
      const retiredAt = this.now() / 1000;
      const retired = {
        ...candidate,
        status: "retired",
        visibility: "hidden",
        retired_at: retiredAt,
        updated_at: retiredAt,
      };
      await this.put(`community_formula_${retired.id}`, retired);
      newlyRetired.push(retired);
    }
    await this.rememberRetiredBatch([
      ...newlyRetired,
      ...formulas.filter((candidate) => candidate.status === "retired"),
    ]);

    if (pointer?.id !== formula.id || pointer?.version !== formula.version) {
      await this.put(pointerKey, { id: formula.id, version: formula.version });
    }
    await this.rememberReproduction(formula, input.playerId);

    const readbackPointer = await this.readConsistently(pointerKey);
    const readbackVersion = this.validFormulaVersion(readbackPointer?.version);
    const readback = readbackPointer && readbackVersion &&
      readbackPointer.id === await this.formulaId(pair, readbackVersion)
      ? await this.readVersionedFormula(pair, readbackVersion)
      : null;
    return this.formulaMatches(readback, input) ? readback : formula;
  }
  async combinationState(a, b) {
    const pointer = await this.get(`community_active_${await sha256Hex(normalizePair(a, b))}`);
    if (!pointer) return null;
    const formula = await this.get(`community_formula_${pointer.id}`);
    return formula ? { status: formula.status, version: formula.version } : null;
  }
  async feedback(
    env = {},
    {
      positiveLimit = PROMPT_SPEC.limits.community_examples,
      negativeLimit = PROMPT_SPEC.limits.avoid_words,
    } = {},
  ) {
    const up = Number(env.FORMULA_UP_THRESHOLD ?? 10);
    const minimum = Number(env.FORMULA_UP_MIN_VOTES ?? 12);
    const ids = (await this.get(INDEX_KEY, []))
      .slice(0, PUBLIC_FORMULA_CATALOG_CAPACITY);
    const values = [];
    for (let offset = 0; offset < ids.length; offset += FEEDBACK_CATALOG_READ_BATCH_SIZE) {
      values.push(...await Promise.all(
        ids
          .slice(offset, offset + FEEDBACK_CATALOG_READ_BATCH_SIZE)
          .map((id) => this.get(`community_formula_${id}`)),
      ));
    }
    const positives = values
      .filter((formula) =>
        formula?.visibility === "public" &&
        formula.status === "active" &&
        formula.ai_positive_enabled !== false &&
        Number(formula.ai_positive_enabled ?? 1) !== 0 &&
        formula.up_votes - formula.down_votes >= up &&
        formula.up_votes + formula.down_votes >= minimum
      )
      .sort((left, right) =>
        (right.up_votes - right.down_votes) - (left.up_votes - left.down_votes) ||
        Number(right.updated_at || 0) - Number(left.updated_at || 0) ||
        (String(left.id) > String(right.id) ? -1 : String(left.id) < String(right.id) ? 1 : 0)
      )
      .slice(0, positiveLimit)
      .map(({ a, b, result: name, emoji, comment }) => ({ a, b, name, emoji, comment }));
    const retirementRecords = await this.get(RETIRED_INDEX_KEY, []);
    const negativeCandidates = [
      ...retirementRecords.map((item, sourceOrdinal) => ({
        id: item?.id,
        result: item?.result,
        retired_at: Number(item?.retired_at || 0),
        sourceOrdinal,
      })),
      ...values
        .filter((formula) => formula?.status === "retired")
        .map((formula, index) => ({
          id: formula.id,
          result: formula.result,
          retired_at: Number(formula.retired_at || formula.updated_at || 0),
          sourceOrdinal: retirementRecords.length + index,
        })),
    ]
      .filter((item) => item.id && item.result)
      .sort((left, right) =>
        right.retired_at - left.retired_at ||
        left.sourceOrdinal - right.sourceOrdinal
      );
    const seenIds = new Set();
    const seenResults = new Set();
    const negatives = [];
    for (const item of negativeCandidates) {
      if (seenIds.has(item.id) || seenResults.has(item.result)) continue;
      seenIds.add(item.id);
      seenResults.add(item.result);
      negatives.push(item.result);
      if (negatives.length >= negativeLimit) break;
    }
    return { positives, negatives };
  }
  async rememberRetired(formula) {
    await this.rememberRetiredBatch([formula]);
  }
  async rememberRetiredBatch(formulas) {
    const existing = await this.get(RETIRED_INDEX_KEY, []);
    const byId = new Map();
    let sourceOrdinal = 0;
    const add = (item, preferIncoming) => {
      const id = item?.id;
      const result = item?.result;
      if (!id || !result) return;
      const rawRetiredAt = item?.retired_at ?? item?.updated_at ?? 0;
      const parsedRetiredAt = Number(rawRetiredAt);
      const retiredAt = Number.isFinite(parsedRetiredAt) ? parsedRetiredAt : 0;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, { id, result, retired_at: retiredAt, sourceOrdinal });
        sourceOrdinal += 1;
        return;
      }
      if (retiredAt > current.retired_at ||
        (preferIncoming && retiredAt === current.retired_at)) {
        byId.set(id, {
          id,
          result,
          retired_at: retiredAt,
          sourceOrdinal: current.sourceOrdinal,
        });
      }
    };
    for (const item of Array.isArray(existing) ? existing : []) add(item, false);
    for (const formula of formulas) add(formula, true);
    const canonical = [...byId.values()]
      .sort((left, right) =>
        right.retired_at - left.retired_at || left.sourceOrdinal - right.sourceOrdinal
      )
      .slice(0, MAX_RETIRED_FORMULA_INDEX)
      .map(({ id, result, retired_at }) => ({ id, result, retired_at }));
    if (JSON.stringify(canonical) !== JSON.stringify(existing)) {
      await this.put(RETIRED_INDEX_KEY, canonical);
    }
    return canonical;
  }
  async publish(id, playerId) {
    const formula = await this.get(`community_formula_${id}`);
    if (!formula || formula.status !== "active") throw Object.assign(new Error("公式不存在或已退役"), { status: 404 });
    if (!(await this.kv.get(`community_repro_${id}_${await sha256Hex(playerId)}`))) {
      throw Object.assign(new Error("只有实际复现过该公式的玩家才能公开"), { status: 403 });
    }
    formula.visibility = "public";
    formula.first_publisher ||= playerId;
    formula.published_at ||= this.now() / 1000;
    formula.updated_at = this.now() / 1000;
    const index = await this.get(INDEX_KEY, []);
    if (!index.includes(id)) index.unshift(id);
    await Promise.all([
      this.put(`community_formula_${id}`, formula),
      this.put(INDEX_KEY, index.slice(0, PUBLIC_FORMULA_CATALOG_CAPACITY)),
    ]);
    return formula;
  }
  publicView(formula, myVote = null) {
    if (!formula || formula.visibility !== "public" || formula.status === "takedown") return null;
    const { combo_key, global_discoverer, ...safe } = formula;
    return { ...safe, net_score: formula.up_votes - formula.down_votes, my_vote: myVote };
  }
  voteView(formula, myVote = null) {
    if (formula.visibility === "public") return this.publicView(formula, myVote);
    return {
      id: formula.id,
      visibility: formula.visibility,
      status: formula.status,
      up_votes: formula.up_votes,
      down_votes: formula.down_votes,
      net_score: formula.up_votes - formula.down_votes,
      my_vote: myVote,
    };
  }
  async listPublic({ limit = 50, offset = 0 } = {}) {
    const { limit: boundedLimit, offset: boundedOffset } = normalizePublicPagination({
      limit,
      offset,
    });
    const ids = (await this.get(INDEX_KEY, [])).slice(0, MAX_PUBLIC_INDEX);
    const values = await Promise.all(ids.map((id) => this.get(`community_formula_${id}`)));
    return values.map((item) => this.publicView(item)).filter(Boolean)
      .sort((a, b) =>
        b.net_score - a.net_score ||
        Number(b.published_at || 0) - Number(a.published_at || 0) ||
        // Formula IDs are SHA-256-derived lowercase ASCII hex. Code-unit order
        // is therefore SQLite BINARY order, including legacy ASCII IDs.
        (String(a.id) > String(b.id) ? -1 : String(a.id) < String(b.id) ? 1 : 0),
      )
      .slice(boundedOffset, boundedOffset + boundedLimit);
  }
  async publicFormula(id, playerId = null) {
    const formula = await this.get(`community_formula_${id}`);
    const view = this.publicView(formula);
    if (!view) return null;
    const myVote = playerId
      ? Number(await this.kv.get(`community_vote_${id}_${await sha256Hex(playerId)}`) || 0) || null
      : null;
    return { ...view, my_vote: myVote };
  }
  async publicByResults(results = [], playerId = null) {
    const wanted = new Set(results.map((item) => cleanText(item)).filter(Boolean));
    if (!wanted.size) return {};
    const items = (await this.listPublic({ limit: MAX_PUBLIC_PAGE })).filter(
      (item) => item.status === "active" && wanted.has(item.result),
    );
    const votes = {};
    if (playerId) {
      await Promise.all(items.map(async (item) => {
        votes[item.id] = Number(await this.kv.get(`community_vote_${item.id}_${await sha256Hex(playerId)}`) || 0) || null;
      }));
    }
    const output = {};
    for (const item of items) {
      if (output[item.result]) continue;
      output[item.result] = { ...item, my_vote: votes[item.id] || null };
    }
    return output;
  }
  emptyReaction(myVote = null) {
    return { up_votes: 0, down_votes: 0, net_score: 0, my_vote: myVote };
  }
  async resultVoteKeys(result, playerId = "") {
    const resultHash = await sha256Hex(cleanText(result));
    const playerHash = playerId ? await sha256Hex(playerId) : "";
    return {
      counts: `community_result_reaction_${resultHash}`,
      vote: playerHash ? `community_result_vote_${resultHash}_${playerHash}` : "",
    };
  }
  async reactionsByResults(results = [], playerId = null) {
    const names = [...new Set(results.map((item) => cleanText(item)).filter(Boolean))];
    const output = Object.fromEntries(names.map((name) => [name, this.emptyReaction()]));
    await Promise.all(names.map(async (name) => {
      const keys = await this.resultVoteKeys(name, playerId || "");
      const counts = await this.get(keys.counts, {});
      const up = Number(counts?.up_votes || 0);
      const down = Number(counts?.down_votes || 0);
      const myVote = keys.vote ? Number(await this.kv.get(keys.vote) || 0) || null : null;
      output[name] = { up_votes: up, down_votes: down, net_score: up - down, my_vote: myVote };
    }));
    return output;
  }
  async voteResult(result, playerId, value) {
    const name = cleanText(result);
    if (!name) throw Object.assign(new Error("result 不能为空"), { status: 400 });
    if (![1, 0, -1].includes(value)) throw Object.assign(new Error("vote 必须是 -1、0 或 1"), { status: 400 });
    const keys = await this.resultVoteKeys(name, playerId);
    const old = Number(await this.kv.get(keys.vote) || 0);
    const next = value === 0 || old === value ? 0 : value;
    const counts = await this.get(keys.counts, {});
    let up = Number(counts?.up_votes || 0);
    let down = Number(counts?.down_votes || 0);
    if (old === 1) up -= 1;
    if (old === -1) down -= 1;
    if (next === 1) up += 1;
    if (next === -1) down += 1;
    up = Math.max(0, up);
    down = Math.max(0, down);
    if (next) await this.kv.put(keys.vote, String(next));
    else await this.kv.delete(keys.vote);
    await this.put(keys.counts, { up_votes: up, down_votes: down, updated_at: this.now() / 1000 });
    return { up_votes: up, down_votes: down, net_score: up - down, my_vote: next || null };
  }
  async vote(id, playerId, value) {
    const formula = await this.get(`community_formula_${id}`);
    if (!formula || formula.status !== "active") {
      throw Object.assign(new Error("只能为有效公式投票"), { status: 400 });
    }
    const key = `community_vote_${id}_${await sha256Hex(playerId)}`;
    const old = Number(await this.kv.get(key) || 0);
    if (old === 1) formula.up_votes -= 1;
    if (old === -1) formula.down_votes -= 1;
    if (value === 0) await this.kv.delete(key);
    else {
      await this.kv.put(key, String(value));
      if (value === 1) formula.up_votes += 1;
      if (value === -1) formula.down_votes += 1;
    }
    formula.updated_at = this.now() / 1000;
    await this.put(`community_formula_${id}`, formula);
    return this.voteView(formula, value || null);
  }
  async queue(env = {}) {
    const down = Number(env.FORMULA_DOWN_THRESHOLD ?? -5);
    const minimum = Number(env.FORMULA_DOWN_MIN_VOTES ?? 8);
    return (await this.listPublic({ limit: MAX_PUBLIC_PAGE })).filter((f) =>
      f.status === "active" && !f.protected &&
      f.net_score <= down && f.up_votes + f.down_votes >= minimum
    );
  }
  async moderate(id, action, reasonCode, note = "") {
    const formula = await this.get(`community_formula_${id}`);
    if (!formula) throw Object.assign(new Error("公式不存在"), { status: 404 });
    if (!["keep", "ignore", "protect", "takedown", "retire"].includes(action) || !cleanText(reasonCode)) {
      throw Object.assign(new Error("治理操作或原因无效"), { status: 400 });
    }
    if (action === "protect") formula.protected = true;
    if (action === "takedown") formula.status = "takedown";
    if (action === "retire") formula.status = "retired";
    formula.updated_at = this.now() / 1000;
    await Promise.all([
      this.put(`community_formula_${id}`, formula),
      this.put(`community_audit_${this.now()}_${id}`, { id, action, reason_code: reasonCode, note: cleanText(note).slice(0, 500), ts: this.now() / 1000 }),
    ]);
    if (action === "retire") {
      await this.kv.delete(await entityKey("combo", formula.combo_key));
      await this.rememberRetired({ ...formula, retired_at: formula.updated_at });
    }
    return formula;
  }
}
