import { cleanText, entityKey, normalizePair } from "./keys.js";

const RECENT_KEY = "snapshot_recent";
const ELEMENTS_KEY = "snapshot_elements";
const MAX_FIRSTS = 10_000;
const MAX_RECIPES_PER_RESULT = 100;
const MAX_KPI_LOG = 100;

function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizedLimit(value, fallback, maximum) {
  return Math.max(1, Math.min(maximum, finiteInteger(value, fallback)));
}

export class KvStore {
  constructor(kv, { now = () => Date.now() } = {}) {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
      throw new TypeError("A bound EdgeOne Makers KV namespace is required");
    }
    this.kv = kv;
    this.now = now;
  }

  timestamp() {
    return this.now() / 1_000;
  }

  async getJson(key, fallback = null) {
    const value = await this.kv.get(key, { type: "json" });
    return value == null ? fallback : value;
  }

  async putJson(key, value) {
    await this.kv.put(key, JSON.stringify(value));
    return value;
  }

  async getCombination(a, b) {
    return this.getJson(await entityKey("combo", normalizePair(a, b)));
  }

  async putCombination(a, b, rawRecord) {
    const [left, right] = [cleanText(a), cleanText(b)].sort();
    const key = await entityKey("combo", normalizePair(left, right));
    const existing = await this.getJson(key);
    if (existing?.result) return existing;

    const record = {
      a: left,
      b: right,
      result: cleanText(rawRecord.result),
      emoji: cleanText(rawRecord.emoji) || "❓",
      source: cleanText(rawRecord.source) || "llm",
      chain: cleanText(rawRecord.chain) || null,
      hit_count: 0,
      ts: this.timestamp(),
    };
    await this.putJson(key, record);
    await Promise.all([
      this.rememberElement(record.result, {
        emoji: record.emoji,
        category: record.chain || "ai",
      }),
      this.rememberRecipe(record),
    ]);
    return record;
  }

  async incrementCombinationHit(a, b) {
    const key = await entityKey("combo", normalizePair(a, b));
    const record = await this.getJson(key);
    if (!record) return null;
    record.hit_count = finiteInteger(record.hit_count) + 1;
    await this.putJson(key, record);
    return record;
  }

  async rememberElement(name, info) {
    const elements = await this.getJson(ELEMENTS_KEY, {});
    elements[cleanText(name)] = {
      emoji: cleanText(info?.emoji) || "❓",
      category: cleanText(info?.category) || "ai",
    };
    await this.putJson(ELEMENTS_KEY, elements);
  }

  async dynamicElements() {
    return this.getJson(ELEMENTS_KEY, {});
  }

  async rememberRecipe(record) {
    const key = await entityKey("recipes", cleanText(record.result));
    const recipes = await this.getJson(key, []);
    const pair = normalizePair(record.a, record.b);
    const next = recipes.filter(
      (item) => normalizePair(item.a, item.b) !== pair,
    );
    next.unshift({
      a: record.a,
      b: record.b,
      result: record.result,
      emoji: record.emoji,
      source: record.source,
      chain: record.chain,
      hit_count: finiteInteger(record.hit_count),
    });
    await this.putJson(key, next.slice(0, MAX_RECIPES_PER_RESULT));
  }

  async dynamicRecipes(result) {
    return this.getJson(await entityKey("recipes", cleanText(result)), []);
  }

  async getFirst(result) {
    return this.getJson(await entityKey("first", cleanText(result)));
  }

  async recordFirst(result, emoji, discoverer) {
    const name = cleanText(result);
    const key = await entityKey("first", name);
    const existing = await this.getJson(key);
    if (existing) return { created: false, record: existing };

    const snapshot = await this.getJson(RECENT_KEY, { items: [] });
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    const maxSeq = items.reduce(
      (maximum, item) => Math.max(maximum, finiteInteger(item?.seq)),
      0,
    );
    const record = {
      result: name,
      emoji: cleanText(emoji) || "❓",
      discoverer: cleanText(discoverer) || "匿名鹅",
      ts: this.timestamp(),
      seq: maxSeq + 1,
    };

    await this.putJson(key, record);
    const verified = await this.getJson(key);
    const created =
      verified?.discoverer === record.discoverer &&
      Number(verified?.ts) === record.ts;
    if (!created) return { created: false, record: verified };

    const nextItems = [
      record,
      ...items.filter((item) => item?.result !== name),
    ]
      .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
      .slice(0, MAX_FIRSTS);
    await this.putJson(RECENT_KEY, { items: nextItems });
    return { created: true, record };
  }

  async firstPage({ offset = 0, limit = 100 } = {}) {
    const safeOffset = Math.max(0, finiteInteger(offset));
    const safeLimit = normalizedLimit(limit, 100, 500);
    const snapshot = await this.getJson(RECENT_KEY, { items: [] });
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    return {
      items: items.slice(safeOffset, safeOffset + safeLimit),
      offset: safeOffset,
      limit: safeLimit,
      total: items.length,
      has_more: safeOffset + safeLimit < items.length,
    };
  }

  async recentFirsts(limit = 50) {
    return (await this.firstPage({ offset: 0, limit })).items;
  }

  async leaderboard({ limit = 20, me = null } = {}) {
    const safeLimit = normalizedLimit(limit, 20, 100);
    const { items } = await this.firstPage({
      offset: 0,
      limit: MAX_FIRSTS,
    });
    const counts = new Map();
    for (const item of items) {
      const name = cleanText(item?.discoverer);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const ranking = [...counts.entries()].sort(
      (left, right) => {
        const byCount = right[1] - left[1];
        if (byCount) return byCount;
        if (left[0] === right[0]) return 0;
        return left[0] < right[0] ? -1 : 1;
      },
    );
    const top = ranking.slice(0, safeLimit).map(([discoverer, firsts], index) => ({
      rank: index + 1,
      discoverer,
      firsts,
    }));
    const myIndex = me
      ? ranking.findIndex(([discoverer]) => discoverer === me)
      : -1;
    return {
      top,
      total_players: ranking.length,
      me:
        myIndex < 0
          ? null
          : { rank: myIndex + 1, firsts: ranking[myIndex][1] },
    };
  }

  async claimNickname(nickname) {
    const name = cleanText(nickname);
    if (!name) return false;
    const key = await entityKey("nick", name);
    if (await this.getJson(key)) return false;
    const record = { nickname: name, ts: this.timestamp() };
    await this.putJson(key, record);
    const verified = await this.getJson(key);
    return (
      verified?.nickname === name && Number(verified?.ts) === record.ts
    );
  }

  async touchNickname(nickname) {
    const name = cleanText(nickname);
    if (!name) return { ok: false };
    const key = await entityKey("nick", name);
    const existing = await this.getJson(key);
    if (!existing) {
      await this.putJson(key, { nickname: name, ts: this.timestamp() });
    }
    return { ok: true, nickname: name, created: !existing };
  }

  async nicknameCount() {
    return (await this.listAllKeys("nick_")).length;
  }

  async getSession(sessionId) {
    const key = await entityKey("session", cleanText(sessionId) || "default");
    return {
      key,
      value: await this.getJson(key, {
        total: 0,
        events: [],
        last_seen: null,
      }),
    };
  }

  async addKpi(sessionId, delta, reason) {
    const session = await this.getSession(sessionId);
    const amount = finiteInteger(delta);
    session.value.total = finiteInteger(session.value.total) + amount;
    session.value.last_seen = this.timestamp();
    const events = Array.isArray(session.value.events)
      ? session.value.events
      : [];
    events.push({
      delta: amount,
      reason: cleanText(reason),
      ts: session.value.last_seen,
    });
    session.value.events = events.slice(-MAX_KPI_LOG);
    await this.putJson(session.key, session.value);
    return session.value.total;
  }

  async kpiTotal(sessionId) {
    return finiteInteger((await this.getSession(sessionId)).value.total);
  }

  async listAllKeys(prefix) {
    const keys = [];
    let cursor;
    do {
      const result = await this.kv.list({ prefix, limit: 256, cursor });
      for (const item of result?.keys ?? []) {
        if (item?.key) keys.push(item.key);
      }
      if (result?.complete) break;
      if (!result?.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    } while (true);
    return keys;
  }
}
