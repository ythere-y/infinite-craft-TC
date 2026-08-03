import { PROMPT_SPEC } from "../_generated/prompt-data.js";
import { cleanText, entityKey, normalizePair, sha256Hex } from "./keys.js";

const INDEX_KEY = "community_public_formulas";
// The public formula catalogue is intentionally bounded for KV read cost.
// Prompt limits select within this catalogue and do not impose another cap.
const PUBLIC_FORMULA_CATALOG_CAPACITY =
  PROMPT_SPEC.capacities.community_formula_catalog;
const FEEDBACK_CATALOG_READ_BATCH_SIZE = 50;
const encoder = new TextEncoder();

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
  async ensureFormula({ a, b, result, emoji, comment, source, discoverer, playerId }) {
    const pair = normalizePair(a, b);
    const pointerKey = `community_active_${await sha256Hex(pair)}`;
    let pointer = await this.get(pointerKey);
    let formula = pointer ? await this.get(`community_formula_${pointer.id}`) : null;
    if (!formula || formula.status !== "active") {
      const version = Number(pointer?.version || 0) + 1;
      const id = (await sha256Hex(`${pair}:v${version}`)).slice(0, 32);
      formula = {
        id, a, b, combo_key: pair, result, emoji, comment, source,
        version, visibility: "hidden", status: "active",
        global_discoverer: discoverer || null, first_publisher: null,
        up_votes: 0, down_votes: 0, protected: false,
        created_at: this.now() / 1000, updated_at: this.now() / 1000,
      };
      await Promise.all([
        this.put(`community_formula_${id}`, formula),
        this.put(pointerKey, { id, version }),
      ]);
    }
    await this.kv.put(`community_repro_${formula.id}_${await sha256Hex(playerId)}`, "1");
    return formula;
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
    const positives = [];
    const negatives = [];
    for (
      let offset = 0;
      offset < ids.length &&
        (positives.length < positiveLimit || negatives.length < negativeLimit);
      offset += FEEDBACK_CATALOG_READ_BATCH_SIZE
    ) {
      const values = await Promise.all(
        ids
          .slice(offset, offset + FEEDBACK_CATALOG_READ_BATCH_SIZE)
          .map((id) => this.get(`community_formula_${id}`)),
      );
      for (const formula of values) {
        if (
          positives.length < positiveLimit &&
          formula?.visibility === "public" &&
          formula.status === "active" &&
          formula.up_votes - formula.down_votes >= up &&
          formula.up_votes + formula.down_votes >= minimum
        ) {
          const { a, b, result: name, emoji, comment } = formula;
          positives.push({ a, b, name, emoji, comment });
        }
        if (
          negatives.length < negativeLimit &&
          formula?.status === "retired"
        ) {
          negatives.push(formula.result);
        }
      }
    }
    return { positives, negatives };
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
  async listPublic() {
    const ids = await this.get(INDEX_KEY, []);
    const values = await Promise.all(ids.slice(0, 100).map((id) => this.get(`community_formula_${id}`)));
    return values.map((item) => this.publicView(item)).filter(Boolean)
      .sort((a, b) => b.net_score - a.net_score || b.published_at - a.published_at);
  }
  async publicByResults(results = [], playerId = null) {
    const wanted = new Set(results.map((item) => cleanText(item)).filter(Boolean));
    if (!wanted.size) return {};
    const items = (await this.listPublic()).filter(
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
    return (await this.listPublic()).filter((f) =>
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
    }
    return formula;
  }
}
