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
      marker.schema_version !== 1 ||
      marker.pair !== pair ||
      this.validFormulaVersion(marker.version) !== version ||
      marker.id !== id
    ) {
      throw retryableConsistencyError("社区公式版本标记不一致，请重试");
    }
    return marker;
  }
  async rememberFormulaMarker(pair, version) {
    const existing = await this.readFormulaMarker(pair, version);
    if (existing) return existing;
    const marker = {
      schema_version: 1,
      pair,
      version,
      id: await this.formulaId(pair, version),
    };
    await this.put(await this.formulaMarkerKey(pair, version), marker);
    const readback = await this.readFormulaMarker(pair, version);
    if (!readback) {
      throw retryableConsistencyError("社区公式版本标记暂不可读，请重试");
    }
    return readback;
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
  async discoverFormulaVersions(pair) {
    if (!await this.formulaInventoryComplete(pair)) {
      for (const formula of await this.legacyFormulaInventory(pair)) {
        await this.rememberFormulaMarker(pair, formula.version);
      }
      await this.put(await this.formulaInventoryKey(pair), {
        schema_version: 1,
        pair,
        complete: true,
      });
    }
    const formulas = [];
    for (const marker of await this.listFormulaMarkers(pair)) {
      const formula = await this.readVersionedFormula(pair, marker.version);
      if (!formula) {
        throw retryableConsistencyError("社区公式版本记录暂不可读，请重试");
      }
      formulas.push(formula);
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
    let pointer = await this.get(pointerKey);
    let formula = pointer ? await this.get(`community_formula_${pointer.id}`) : null;
    if (!formula || formula.status !== "active") {
      const version = Number(pointer?.version || 0) + 1;
      formula = await this.createFormula({
        a, b, result, emoji, comment, source, discoverer,
      }, version);
      await this.rememberFormulaMarker(pair, version);
      await this.put(`community_formula_${formula.id}`, formula);
      await this.put(pointerKey, { id: formula.id, version });
    }
    await this.rememberReproduction(formula, playerId);
    return formula;
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

    const known = new Map(
      (await this.discoverFormulaVersions(pair)).map((formula) => [formula.id, formula]),
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
      if (await this.readFormulaMarker(pair, version)) {
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

    const retirees = formulas.filter(
      (candidate) => candidate.status === "active" && candidate.id !== formula.id,
    );
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
      await this.ensureRetiredRemembered(retired);
    }
    for (const candidate of formulas) {
      if (candidate.status === "retired") {
        await this.ensureRetiredRemembered(candidate);
      }
    }

    if (needsCreate) {
      if (await this.readFormulaMarker(pair, formula.version)) {
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      const existing = await this.readVersionedFormula(pair, formula.version);
      if (existing) {
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      await this.rememberFormulaMarker(pair, formula.version);
      const afterMarker = await this.readVersionedFormula(pair, formula.version);
      if (afterMarker) {
        throw retryableConsistencyError("社区公式目标版本已变化，请重试");
      }
      await this.put(`community_formula_${formula.id}`, formula);
    }
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
    const retiredAt = Number(formula?.retired_at || formula?.updated_at || this.now() / 1000);
    const entry = {
      id: formula?.id,
      result: formula?.result,
      retired_at: retiredAt,
    };
    if (!entry.id || !entry.result) return;
    const existing = await this.get(RETIRED_INDEX_KEY, []);
    const byId = new Map();
    for (const item of [entry, ...existing]) {
      if (!item?.id || !item?.result || byId.has(item.id)) continue;
      byId.set(item.id, item);
      if (byId.size >= MAX_RETIRED_FORMULA_INDEX) break;
    }
    await this.put(RETIRED_INDEX_KEY, [...byId.values()]);
  }
  async ensureRetiredRemembered(formula) {
    const existing = await this.get(RETIRED_INDEX_KEY, []);
    if (existing.some((item) => item?.id === formula?.id)) return;
    await this.rememberRetired(formula);
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
