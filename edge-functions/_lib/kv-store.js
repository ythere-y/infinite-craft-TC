import {
  cleanText,
  entityKey,
  normalizePair,
  sha256Hex,
} from "./keys.js";
import { normalizeComment } from "./comments.js";

const RECENT_KEY = "snapshot_recent";
const ELEMENTS_KEY = "snapshot_elements";
const STATS_KEY = "snapshot_stats";
const MAX_FIRSTS = 10_000;
const MAX_RECENT_FIRSTS = 500;
const MAX_INDEX_RECORDS_PER_SHARD = 2_000;
const MAX_RECIPES_PER_RESULT = 100;
const MAX_KPI_LOG = 100;
const KPI_SHARD_COUNT = 32;
const RECORD_READ_BATCH = 20;
const INDEX_RECONCILE_SECONDS = 60;
const INDEX_SHARDS = "0123456789abcdef".split("");
const MAX_FEED_TIMESTAMP_MS = 9_999_999_999_999;

function finiteInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizedLimit(value, fallback, maximum) {
  return Math.max(1, Math.min(maximum, finiteInteger(value, fallback)));
}

function emptyStats() {
  return {
    total_calls: 0,
    active_sessions: {},
    minute_counts: {},
    hour_counts: {},
    combinations: {},
    chains: {},
  };
}

function newestFirst(left, right) {
  const byTime = Number(right?.ts || 0) - Number(left?.ts || 0);
  if (byTime) return byTime;
  return cleanText(left?.result || left?.name).localeCompare(
    cleanText(right?.result || right?.name),
  );
}

function listOptions(prefix, limit, cursor) {
  return cursor ? { prefix, limit, cursor } : { prefix, limit };
}

export class KvStore {
  constructor(kv, { now = () => Date.now() } = {}) {
    if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
      throw new TypeError("A bound EdgeOne Makers KV namespace is required");
    }
    this.kv = kv;
    this.now = now;
    this.uniqueSequence = 0;
  }

  timestamp() {
    return this.now() / 1_000;
  }

  async getJson(key, fallback = null) {
    const value = await this.kv.get(key);
    if (value == null || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  async putJson(key, value) {
    await this.kv.put(key, JSON.stringify(value));
    return value;
  }

  async readRecords(keys) {
    const records = [];
    for (let index = 0; index < keys.length; index += RECORD_READ_BATCH) {
      const batch = keys.slice(index, index + RECORD_READ_BATCH);
      const values = await Promise.all(
        batch.map(async (key) => ({
          key,
          value: await this.getJson(key),
        })),
      );
      records.push(...values.filter((item) => item.value));
    }
    return records;
  }

  uniqueSuffix() {
    this.uniqueSequence += 1;
    const bytes = new Uint8Array(8);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    const random = [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `${Math.floor(this.now()).toString(36)}_${this.uniqueSequence.toString(36)}_${random}`;
  }

  randomShardIndex(count) {
    const bytes = new Uint8Array(1);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
      return bytes[0] % count;
    }
    return Math.floor(Math.random() * count);
  }

  indexKey(kind, shard) {
    return `index_${kind}_${shard}`;
  }

  indexMetaKey(kind) {
    return `indexmeta_${kind}`;
  }

  shardForCanonicalKey(kind, key) {
    const hash = key.slice(kind.length + 1);
    return /^[a-f0-9]{64}$/u.test(hash) ? hash[0] : "0";
  }

  normalizeIndexSnapshot(value) {
    return {
      items:
        value?.items && typeof value.items === "object"
          ? value.items
          : {},
      reconciled_at: Number(value?.reconciled_at) || 0,
    };
  }

  trimIndexItems(items) {
    const entries = Object.entries(items);
    if (entries.length <= MAX_INDEX_RECORDS_PER_SHARD) return items;
    return Object.fromEntries(
      entries
        .sort((left, right) => newestFirst(left[1], right[1]))
        .slice(0, MAX_INDEX_RECORDS_PER_SHARD),
    );
  }

  async loadIndexShard(kind, shard, { reconcile = false } = {}) {
    const storageKey = this.indexKey(kind, shard);
    const snapshot = this.normalizeIndexSnapshot(
      await this.getJson(storageKey, {}),
    );
    if (!reconcile) return snapshot;

    const canonicalPrefix = `${kind}_${shard}`;
    const canonicalPattern = new RegExp(
      `^${kind}_[a-f0-9]{64}$`,
      "u",
    );
    const canonicalKeys = (await this.listAllKeys(canonicalPrefix)).filter(
      (key) => canonicalPattern.test(key),
    );
    const missingKeys = canonicalKeys.filter(
      (key) => !Object.hasOwn(snapshot.items, key),
    );
    for (const { key, value } of await this.readRecords(missingKeys)) {
      snapshot.items[key] = { ...value, storage_key: key };
    }
    snapshot.items = this.trimIndexItems(snapshot.items);
    snapshot.reconciled_at = this.timestamp();
    await this.putJson(storageKey, snapshot);
    return snapshot;
  }

  async reconcileNextIndexShard(kind) {
    const metaKey = this.indexMetaKey(kind);
    const meta = await this.getJson(metaKey, {
      next_shard: 0,
      next_reconcile_at: 0,
    });
    const now = this.timestamp();
    if (Number(meta?.next_reconcile_at || 0) > now) return null;

    const index = Math.max(
      0,
      finiteInteger(meta?.next_shard) % INDEX_SHARDS.length,
    );
    const shard = INDEX_SHARDS[index];
    const snapshot = await this.loadIndexShard(kind, shard, {
      reconcile: true,
    });
    await this.putJson(metaKey, {
      next_shard: (index + 1) % INDEX_SHARDS.length,
      next_reconcile_at: now + INDEX_RECONCILE_SECONDS,
    });
    return { shard, snapshot };
  }

  async loadIndexRecords(kind, { reconcileOne = true } = {}) {
    const snapshots = await Promise.all(
      INDEX_SHARDS.map((shard) => this.loadIndexShard(kind, shard)),
    );
    if (reconcileOne) {
      const repaired = await this.reconcileNextIndexShard(kind);
      if (repaired) {
        snapshots[INDEX_SHARDS.indexOf(repaired.shard)] = repaired.snapshot;
      }
    }
    return snapshots.flatMap((snapshot) => Object.values(snapshot.items));
  }

  async putIndexRecord(kind, canonicalKey, record) {
    const shard = this.shardForCanonicalKey(kind, canonicalKey);
    const storageKey = this.indexKey(kind, shard);
    const snapshot = this.normalizeIndexSnapshot(
      await this.getJson(storageKey, {}),
    );
    snapshot.items[canonicalKey] = {
      ...record,
      storage_key: canonicalKey,
    };
    snapshot.items = this.trimIndexItems(snapshot.items);
    await this.putJson(storageKey, snapshot);
  }

  firstFeedKey(record, canonicalKey) {
    const timestamp = Math.max(
      0,
      Math.min(
        MAX_FEED_TIMESTAMP_MS,
        Math.floor(Number(record?.ts || 0) * 1_000),
      ),
    );
    const inverted = String(MAX_FEED_TIMESTAMP_MS - timestamp).padStart(
      13,
      "0",
    );
    return `feed_${inverted}_${canonicalKey.slice("first_".length)}`;
  }

  async listKeyWindow(prefix, offset, limit) {
    const keys = [];
    let skipped = 0;
    let cursor;
    let complete = false;
    while (keys.length < limit && !complete) {
      const result = await this.kv.list(listOptions(prefix, 256, cursor));
      const page = (result?.keys ?? [])
        .map((item) => item?.key || item?.name)
        .filter(Boolean);
      const start = Math.max(0, offset - skipped);
      if (start < page.length) {
        keys.push(...page.slice(start, start + limit - keys.length));
      }
      skipped += page.length;
      complete = Boolean(result?.complete);
      if (complete || !result?.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    }
    return { keys, complete };
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
      comment: normalizeComment(rawRecord.comment),
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
    const cleanName = cleanText(name);
    if (!cleanName) return;

    const key = await entityKey("element", cleanName);
    const existing = await this.getJson(key, {});
    const record = {
      ...existing,
      name: cleanName,
      emoji: cleanText(info?.emoji) || "❓",
      category: cleanText(info?.category) || "ai",
      ...(Number.isFinite(Number(info?.depth))
        ? { depth: Math.max(0, finiteInteger(info.depth)) }
        : {}),
      updated_at: this.timestamp(),
      storage_key: key,
    };
    await this.putJson(key, record);
    await this.putIndexRecord("element", key, record);
  }

  async dynamicElements() {
    const legacy = await this.getJson(ELEMENTS_KEY, {});
    const elements =
      legacy && typeof legacy === "object" && !Array.isArray(legacy)
        ? { ...(legacy.items || legacy) }
        : {};
    for (const record of await this.loadIndexRecords("element")) {
      const name = cleanText(record?.name);
      if (name) elements[name] = record;
    }
    return Object.fromEntries(
      Object.entries(elements).map(([name, value]) => {
        const {
          name: _name,
          storage_key: _storageKey,
          updated_at: _updatedAt,
          ...publicValue
        } = value || {};
        return [name, publicValue];
      }),
    );
  }

  async getElement(name) {
    const cleanName = cleanText(name);
    if (!cleanName) return null;
    const value = await this.getJson(await entityKey("element", cleanName));
    if (!value) return null;
    const {
      name: _name,
      storage_key: _storageKey,
      updated_at: _updatedAt,
      ...publicValue
    } = value;
    return publicValue;
  }

  async rememberRecipe(record) {
    const result = cleanText(record.result);
    const pair = normalizePair(record.a, record.b);
    const resultHash = await sha256Hex(result);
    const pairHash = await sha256Hex(pair);
    const key = `recipe_${resultHash}_${pairHash}`;
    await this.putJson(key, {
      a: record.a,
      b: record.b,
      result,
      emoji: record.emoji,
      comment: normalizeComment(record.comment),
      source: record.source,
      chain: record.chain,
      hit_count: finiteInteger(record.hit_count),
      ts: Number(record.ts) || this.timestamp(),
      storage_key: key,
    });
  }

  async dynamicRecipes(result) {
    const cleanResult = cleanText(result);
    const prefix = `recipe_${await sha256Hex(cleanResult)}_`;
    const { keys } = await this.listKeyWindow(
      prefix,
      0,
      MAX_RECIPES_PER_RESULT,
    );
    if (!keys.length) {
      return this.getJson(await entityKey("recipes", cleanResult), []);
    }
    const records = await this.readRecords(keys);
    return records
      .map(({ value }) => value)
      .filter((item) => cleanText(item?.result) === cleanResult)
      .sort((left, right) => {
        const byHits =
          finiteInteger(right?.hit_count) - finiteInteger(left?.hit_count);
        if (byHits) return byHits;
        return Number(right?.ts || 0) - Number(left?.ts || 0);
      })
      .slice(0, MAX_RECIPES_PER_RESULT)
      .map(({ storage_key: _storageKey, ts: _ts, ...item }) => item);
  }

  async getFirst(result) {
    return this.publicFirst(
      await this.getJson(await entityKey("first", cleanText(result))),
    );
  }

  normalizeRecentSnapshot(value) {
    return {
      items: Array.isArray(value?.items) ? value.items : [],
      total: Math.max(
        finiteInteger(value?.total),
        Array.isArray(value?.items) ? value.items.length : 0,
      ),
      initialized: value?.initialized === true,
    };
  }

  mergeRecent(items, additions) {
    const byResult = new Map();
    for (const item of [...(additions || []), ...(items || [])]) {
      const result = cleanText(item?.result);
      if (result && !byResult.has(result)) {
        byResult.set(result, this.publicFirst(item));
      }
    }
    return [...byResult.values()]
      .sort(newestFirst)
      .slice(0, MAX_RECENT_FIRSTS);
  }

  async repairRecentSnapshot(snapshot) {
    const repaired = await this.reconcileNextIndexShard("first");
    if (!repaired) return snapshot;
    const additions = Object.values(repaired.snapshot.items);
    const items = this.mergeRecent(snapshot.items, additions);
    const next = {
      items,
      total: Math.max(snapshot.total, items.length),
      initialized: true,
    };
    await this.putJson(RECENT_KEY, next);
    return next;
  }

  async recordFirst(result, emoji, discoverer) {
    const name = cleanText(result);
    const key = await entityKey("first", name);
    const existing = await this.getJson(key);
    if (existing) {
      return { created: false, record: this.publicFirst(existing) };
    }

    const snapshot = this.normalizeRecentSnapshot(
      await this.getJson(RECENT_KEY, { items: [] }),
    );
    const items = snapshot.items;
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
      claim_token: this.uniqueSuffix(),
      storage_key: key,
    };

    await this.putJson(key, record);
    const verified = await this.getJson(key);
    const created = verified?.claim_token === record.claim_token;
    if (!created) {
      return { created: false, record: this.publicFirst(verified) };
    }

    await Promise.all([
      this.putIndexRecord("first", key, record),
      this.putJson(
        this.firstFeedKey(record, key),
        this.publicFirst(record),
      ),
    ]);
    const nextItems = this.mergeRecent(items, [record]);
    await this.putJson(RECENT_KEY, {
      items: nextItems,
      total: Math.max(snapshot.total + 1, nextItems.length),
      initialized: true,
    });
    return { created: true, record: this.publicFirst(record) };
  }

  async firstPage({ offset = 0, limit = 100 } = {}) {
    const safeOffset = Math.max(0, finiteInteger(offset));
    const safeLimit = normalizedLimit(limit, 100, 500);
    let snapshot = this.normalizeRecentSnapshot(
      await this.getJson(RECENT_KEY, { items: [] }),
    );
    if (!snapshot.initialized) {
      const feedWindow = await this.listKeyWindow(
        "feed_",
        0,
        MAX_RECENT_FIRSTS + 1,
      );
      const feedRecords = await this.readRecords(
        feedWindow.keys.slice(0, MAX_RECENT_FIRSTS),
      );
      const feedItems = feedRecords.map(({ value }) => value);
      if (feedItems.length) {
        snapshot = {
          items: this.mergeRecent([], feedItems),
          total:
            feedItems.length +
            (feedWindow.keys.length > MAX_RECENT_FIRSTS ||
            !feedWindow.complete
              ? 1
              : 0),
          initialized: true,
        };
      } else {
        const indexed = await this.loadIndexRecords("first");
        snapshot = {
          items: this.mergeRecent([], indexed),
          total: indexed.length,
          initialized: true,
        };
      }
      await this.putJson(RECENT_KEY, snapshot);
    } else {
      snapshot = await this.repairRecentSnapshot(snapshot);
    }

    if (!snapshot.items.length && snapshot.total === 0) {
      return {
        items: [],
        offset: safeOffset,
        limit: safeLimit,
        total: 0,
        has_more: false,
      };
    }

    if (safeOffset + safeLimit <= snapshot.items.length) {
      return {
        items: snapshot.items.slice(safeOffset, safeOffset + safeLimit),
        offset: safeOffset,
        limit: safeLimit,
        total: snapshot.total,
        has_more:
          safeOffset + safeLimit < snapshot.items.length ||
          safeOffset + safeLimit < snapshot.total,
      };
    }

    if (safeOffset < snapshot.items.length && snapshot.total <= snapshot.items.length) {
      const items = snapshot.items.slice(safeOffset, safeOffset + safeLimit);
      return {
        items,
        offset: safeOffset,
        limit: safeLimit,
        total: snapshot.total,
        has_more: false,
      };
    }

    const window = await this.listKeyWindow(
      "feed_",
      safeOffset,
      safeLimit + 1,
    );
    const records = await this.readRecords(
      window.keys.slice(0, safeLimit),
    );
    const items = records.map(({ value }) => this.publicFirst(value));
    const hasMore = window.keys.length > safeLimit || !window.complete;
    const total = Math.max(
      snapshot.total,
      safeOffset + items.length + (hasMore ? 1 : 0),
    );
    return {
      items,
      offset: safeOffset,
      limit: safeLimit,
      total,
      has_more: hasMore,
    };
  }

  async recentFirsts(limit = 50) {
    return (await this.firstPage({ offset: 0, limit })).items;
  }

  async allFirsts() {
    const recent = this.normalizeRecentSnapshot(
      await this.getJson(RECENT_KEY, { items: [] }),
    );
    const recordsByResult = new Map();
    for (const item of [
      ...(await this.loadIndexRecords("first")),
      ...recent.items,
    ]) {
      const result = cleanText(item?.result);
      if (result && !recordsByResult.has(result)) {
        recordsByResult.set(result, item);
      }
    }
    const chronological = [...recordsByResult.values()]
      .sort((left, right) => {
        const byTime = Number(left?.ts || 0) - Number(right?.ts || 0);
        if (byTime) return byTime;
        return cleanText(left?.result).localeCompare(cleanText(right?.result));
      })
      .slice(-MAX_FIRSTS)
      .map((item, index) => ({ ...item, seq: index + 1 }));
    const items = chronological.reverse();
    const nextRecent = {
      items: items.slice(0, MAX_RECENT_FIRSTS).map((item) =>
        this.publicFirst(item),
      ),
      total: items.length,
      initialized: true,
    };
    await this.putJson(RECENT_KEY, nextRecent);
    return items.map((item) => this.publicFirst(item));
  }

  publicFirst(record) {
    if (!record) return record;
    const {
      claim_token: _claimToken,
      storage_key: _storageKey,
      ...publicRecord
    } = record;
    return publicRecord;
  }

  async leaderboard({ limit = 20, me = null, items = null } = {}) {
    const safeLimit = normalizedLimit(limit, 20, 100);
    const firsts = Array.isArray(items) ? items : await this.allFirsts();
    const counts = new Map();
    for (const item of firsts) {
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
    const record = {
      nickname: name,
      ts: this.timestamp(),
      claim_token: this.uniqueSuffix(),
    };
    await this.putJson(key, record);
    const verified = await this.getJson(key);
    const created = verified?.claim_token === record.claim_token;
    if (created) await this.incrementNicknameCount(key);
    return created;
  }

  async touchNickname(nickname) {
    const name = cleanText(nickname);
    if (!name) return { ok: false };
    const key = await entityKey("nick", name);
    const existing = await this.getJson(key);
    if (!existing) {
      await this.putJson(key, { nickname: name, ts: this.timestamp() });
      await this.incrementNicknameCount(key);
    }
    return { ok: true, nickname: name, created: !existing };
  }

  async incrementNicknameCount(canonicalKey) {
    const shard = this.shardForCanonicalKey("nick", canonicalKey);
    const key = `nickcount_${shard}`;
    const value = await this.getJson(key, { count: 0 });
    await this.putJson(key, {
      count: finiteInteger(value?.count) + 1,
      updated_at: this.timestamp(),
    });
  }

  async nicknameCount() {
    const meta = await this.getJson("meta_nickcount");
    if (!meta?.initialized) {
      const keys = (await this.listAllKeys("nick_")).filter((key) =>
        /^nick_[a-f0-9]{64}$/u.test(key),
      );
      const counts = Object.fromEntries(
        INDEX_SHARDS.map((shard) => [shard, 0]),
      );
      for (const key of keys) {
        counts[this.shardForCanonicalKey("nick", key)] += 1;
      }
      await Promise.all([
        ...INDEX_SHARDS.map((shard) =>
          this.putJson(`nickcount_${shard}`, {
            count: counts[shard],
            updated_at: this.timestamp(),
          }),
        ),
        this.putJson("meta_nickcount", { initialized: true }),
      ]);
      return keys.length;
    }

    const shards = await Promise.all(
      INDEX_SHARDS.map((shard) =>
        this.getJson(`nickcount_${shard}`, { count: 0 }),
      ),
    );
    return shards.reduce(
      (total, value) => total + finiteInteger(value?.count),
      0,
    );
  }

  async consumeRateLimit(
    identity,
    { limit = 20, windowSeconds = 60 } = {},
  ) {
    const safeLimit = Math.max(1, Math.min(1_000, finiteInteger(limit, 20)));
    const safeWindow = Math.max(
      1,
      Math.min(3_600, finiteInteger(windowSeconds, 60)),
    );
    const key = await entityKey(
      "modelrate",
      cleanText(identity) || "anonymous",
    );
    const now = Math.floor(this.timestamp());
    const bucket = Math.floor(now / safeWindow);
    const current = await this.getJson(key, {});
    const count =
      finiteInteger(current?.bucket, -1) === bucket
        ? finiteInteger(current?.count) + 1
        : 1;
    await this.putJson(key, { bucket, count, updated_at: now });
    return {
      allowed: count <= safeLimit,
      remaining: Math.max(0, safeLimit - count),
      retry_after: safeWindow - (now % safeWindow),
    };
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
    const cleanSessionId = cleanText(sessionId) || "default";
    const sessionHash = await sha256Hex(cleanSessionId);
    const amount = finiteInteger(delta);
    const timestamp = this.timestamp();
    const shard = this.randomShardIndex(KPI_SHARD_COUNT)
      .toString(16)
      .padStart(2, "0");
    const shardKey = `kpi_${sessionHash}_${shard}`;
    const shardValue = await this.getJson(shardKey, { total: 0 });
    await this.putJson(shardKey, {
      total: finiteInteger(shardValue?.total) + amount,
      updated_at: timestamp,
    });

    const session = await this.getSession(sessionId);
    session.value.total = finiteInteger(session.value.total) + amount;
    session.value.last_seen = timestamp;
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
    const cleanSessionId = cleanText(sessionId) || "default";
    const prefix = `kpi_${await sha256Hex(cleanSessionId)}_`;
    const keys = await this.listAllKeys(prefix);
    if (!keys.length) {
      return finiteInteger((await this.getSession(sessionId)).value.total);
    }
    const events = await this.readRecords(keys);
    return events.reduce(
      (total, { value }) =>
        total + finiteInteger(value?.total, finiteInteger(value?.delta)),
      0,
    );
  }

  async recordCombineActivity({
    sessionId,
    a,
    b,
    result,
    emoji,
    source,
    chain,
  }) {
    const now = Math.floor(this.timestamp());
    const minute = String(now - (now % 60));
    const hour = String(now - (now % 3_600));
    const activeKey = await entityKey(
      "active",
      cleanText(sessionId) || "anon",
    );
    const shard = activeKey.slice("active_".length, "active_".length + 1);
    const statsKey = `stats_${shard}`;
    const stats = await this.getJson(statsKey, emptyStats());

    stats.total_calls = finiteInteger(stats.total_calls) + 1;
    stats.active_sessions ||= {};
    stats.active_sessions[activeKey] = now;
    for (const [key, timestamp] of Object.entries(stats.active_sessions)) {
      if (Number(timestamp) < now - 300) delete stats.active_sessions[key];
    }

    stats.minute_counts ||= {};
    stats.minute_counts[minute] = finiteInteger(stats.minute_counts[minute]) + 1;
    for (const key of Object.keys(stats.minute_counts)) {
      if (Number(key) < Number(minute) - 61 * 60) {
        delete stats.minute_counts[key];
      }
    }

    stats.hour_counts ||= {};
    stats.hour_counts[hour] = finiteInteger(stats.hour_counts[hour]) + 1;
    for (const key of Object.keys(stats.hour_counts)) {
      if (Number(key) < Number(hour) - 25 * 3_600) {
        delete stats.hour_counts[key];
      }
    }

    const pair = normalizePair(a, b);
    stats.combinations ||= {};
    const combination = stats.combinations[pair] || {
      key: pair,
      result: cleanText(result),
      emoji: cleanText(emoji) || "❓",
      hit_count: 0,
      source: cleanText(source) || "fallback",
      chain: cleanText(chain) || null,
    };
    combination.result = cleanText(result);
    combination.emoji = cleanText(emoji) || "❓";
    combination.source = cleanText(source) || "fallback";
    combination.chain = cleanText(chain) || null;
    combination.hit_count = finiteInteger(combination.hit_count) + 1;
    stats.combinations[pair] = combination;

    const combinationEntries = Object.entries(stats.combinations);
    if (combinationEntries.length > 500) {
      const keep = new Set(
        combinationEntries
          .sort(
            (left, right) =>
              finiteInteger(right[1]?.hit_count) -
              finiteInteger(left[1]?.hit_count),
          )
          .slice(0, 500)
          .map(([key]) => key),
      );
      for (const key of Object.keys(stats.combinations)) {
        if (!keep.has(key)) delete stats.combinations[key];
      }
    }

    stats.chains ||= {};
    const chainName = cleanText(chain) || "未分类";
    stats.chains[chainName] = finiteInteger(stats.chains[chainName]) + 1;
    await this.putJson(statsKey, stats);
    return stats;
  }

  async statsSnapshot() {
    const [legacy, ...shards] = await Promise.all([
      this.getJson(STATS_KEY),
      ...INDEX_SHARDS.map((shard) => this.getJson(`stats_${shard}`)),
    ]);
    const merged = emptyStats();
    for (const stats of [legacy, ...shards].filter(Boolean)) {
      merged.total_calls += finiteInteger(stats?.total_calls);

      for (const [key, timestamp] of Object.entries(
        stats?.active_sessions || {},
      )) {
        merged.active_sessions[key] = Math.max(
          Number(merged.active_sessions[key] || 0),
          Number(timestamp || 0),
        );
      }
      for (const field of ["minute_counts", "hour_counts", "chains"]) {
        for (const [key, count] of Object.entries(stats?.[field] || {})) {
          merged[field][key] =
            finiteInteger(merged[field][key]) + finiteInteger(count);
        }
      }
      for (const [key, item] of Object.entries(
        stats?.combinations || {},
      )) {
        const existing = merged.combinations[key] || {};
        merged.combinations[key] = {
          ...existing,
          ...item,
          hit_count:
            finiteInteger(existing?.hit_count) +
            finiteInteger(item?.hit_count),
        };
      }
    }

    const combinations = Object.entries(merged.combinations);
    if (combinations.length > 500) {
      merged.combinations = Object.fromEntries(
        combinations
          .sort(
            (left, right) =>
              finiteInteger(right[1]?.hit_count) -
              finiteInteger(left[1]?.hit_count),
          )
          .slice(0, 500),
      );
    }
    return merged;
  }

  async analyticsCombinations(limit = 20, snapshot = null) {
    const stats = snapshot || (await this.statsSnapshot());
    return Object.values(stats.combinations || {})
      .sort(
        (left, right) =>
          finiteInteger(right.hit_count) - finiteInteger(left.hit_count),
      )
      .slice(0, normalizedLimit(limit, 20, 100));
  }

  async analyticsChains(limit = 10, snapshot = null) {
    const stats = snapshot || (await this.statsSnapshot());
    return Object.entries(stats.chains || {})
      .map(([chain, count]) => ({
        chain: chain === "未分类" ? null : chain,
        cnt: finiteInteger(count),
        total_hits: finiteInteger(count),
      }))
      .sort((left, right) => right.total_hits - left.total_hits)
      .slice(0, normalizedLimit(limit, 10, 100));
  }

  async adminStats() {
    const now = Math.floor(this.timestamp());
    const minuteStart = now - (now % 60);
    const hourStart = now - (now % 3_600);
    const stats = await this.statsSnapshot();
    const minuteCounts = stats.minute_counts || {};
    const hourCounts = stats.hour_counts || {};
    const sumMinutes = (count) => {
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        total += finiteInteger(minuteCounts[String(minuteStart - index * 60)]);
      }
      return total;
    };
    const timeseries30m = [];
    for (let index = 29; index >= 0; index -= 1) {
      const ts = minuteStart - index * 60;
      timeseries30m.push({
        ts,
        count: finiteInteger(minuteCounts[String(ts)]),
      });
    }
    const timeseries24h = [];
    for (let index = 23; index >= 0; index -= 1) {
      const ts = hourStart - index * 3_600;
      timeseries24h.push({
        ts,
        count: finiteInteger(hourCounts[String(ts)]),
      });
    }
    return {
      // Makers KV has no atomic increment. These dashboard counters are
      // intentionally best-effort telemetry; gameplay records use canonical
      // per-entity/per-event keys elsewhere in this store.
      approximate: true,
      now,
      active_sessions: Object.values(stats.active_sessions || {}).filter(
        (timestamp) => Number(timestamp) >= now - 300,
      ).length,
      total_calls: finiteInteger(stats.total_calls),
      calls_1m: sumMinutes(1),
      calls_5m: sumMinutes(5),
      calls_60m: sumMinutes(60),
      timeseries_30m: timeseries30m,
      timeseries_24h: timeseries24h,
      top_combinations: await this.analyticsCombinations(10, stats),
      top_chains: await this.analyticsChains(10, stats),
    };
  }

  async listAllKeys(prefix) {
    const keys = [];
    let cursor;
    do {
      const result = await this.kv.list(listOptions(prefix, 256, cursor));
      for (const item of result?.keys ?? []) {
        const key = item?.key || item?.name;
        if (key) keys.push(key);
      }
      if (result?.complete) break;
      if (!result?.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    } while (true);
    return keys;
  }
}
