import {
  BOUNTY_COMBINATIONS,
  BOUNTY_CONTENT,
  BOUNTY_ELEMENTS,
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../_generated/bounty-content.js";
import { cleanText, normalizePair } from "./keys.js";
import { KvStore } from "./kv-store.js";

const STATE_KEY = "system_content_state";
const PHASES = [
  "detect",
  "purge_runtime_data",
  "seed_starters",
  "seed_elements",
  "seed_recipes",
  "rebuild_indexes",
  "verify_catalog",
  "ready",
];
const PHASE_RANK = new Map(PHASES.map((phase, index) => [phase, index]));
const SCAN_RANK = new Map([
  ["combinations", 0],
  ["elements", 1],
  ["done", 2],
]);

const OWNERSHIP = Object.freeze({
  source: "seed",
  content_epoch: CONTENT_EPOCH,
  catalog_digest: CATALOG_DIGEST,
});

function positiveInteger(value, fallback, label, maximum = Infinity) {
  const parsed = Number(value ?? fallback);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > maximum
  ) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function listOptions(prefix, limit, cursor) {
  return cursor ? { prefix, limit, cursor } : { prefix, limit };
}

function parseRecipe(pair, info) {
  const parts = pair.split(" + ").map((part) => part.trim());
  return {
    a: cleanText(info?.a) || parts[0] || "",
    b: cleanText(info?.b) || parts[1] || "",
    result: cleanText(info?.result),
    emoji: cleanText(info?.emoji) || "❓",
    comment: cleanText(info?.comment),
    chain: cleanText(info?.chain) || null,
    ...OWNERSHIP,
  };
}

const STARTERS = (BOUNTY_CONTENT.starters || []).map((starter) => ({
  name: cleanText(starter.name),
  info: {
    emoji: cleanText(starter.emoji) || "❓",
    category: cleanText(starter.category) || "starter",
    depth: 0,
    ...OWNERSHIP,
  },
}));

const ELEMENTS = Object.entries(BOUNTY_ELEMENTS).map(([name, info]) => ({
  name,
  info: {
    emoji: cleanText(info?.emoji) || "❓",
    category: cleanText(info?.category) || "seed",
    ...(Number.isFinite(Number(info?.depth))
      ? { depth: Math.max(0, Math.trunc(Number(info.depth))) }
      : {}),
    ...(info?.icon ? { icon: info.icon } : {}),
    ...OWNERSHIP,
  },
}));

const RECIPES = Object.entries(BOUNTY_COMBINATIONS).map(([pair, info]) => ({
  pair,
  record: parseRecipe(pair, info),
}));

const FIXED_PAIRS = new Set(
  RECIPES.map(({ record }) => normalizePair(record.a, record.b)),
);
const FIXED_ELEMENTS = new Set([
  ...STARTERS.map(({ name }) => name),
  ...ELEMENTS.map(({ name }) => name),
  ...RECIPES.map(({ record }) => record.result),
]);

const VERIFY_ITEMS = [
  ...[...new Map(
    [
      ...STARTERS,
      ...ELEMENTS,
      ...RECIPES.map(({ record }) => ({
        name: record.result,
        info: {
          emoji: record.emoji,
          category: record.chain || "seed",
          ...OWNERSHIP,
        },
      })),
    ].map((item) => [item.name, item]),
  ).values()].map((item) => ({ kind: "element", ...item })),
  ...RECIPES.map((item) => ({ kind: "combination", ...item })),
];

function initialState(previous, now) {
  const sameEpoch = Number(previous?.epoch) === CONTENT_EPOCH;
  const resumesEpochReset = (
    previous?.status === "migrating" &&
    previous?.mode === "epoch_reset"
  );
  const mode = resumesEpochReset || !previous || !sameEpoch
    ? "epoch_reset"
    : "differential";
  return {
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    status: "migrating",
    mode,
    phase: mode === "epoch_reset"
      ? "purge_runtime_data"
      : "seed_starters",
    cursor: null,
    index: 0,
    scan: null,
    started_at: resumesEpochReset
      ? Number(previous.started_at) || now()
      : now(),
    completed_at: null,
    error: "",
  };
}

function validMigratingState(state) {
  return (
    state?.status === "migrating" &&
    Number(state.epoch) === CONTENT_EPOCH &&
    state.catalog_digest === CATALOG_DIGEST &&
    ["epoch_reset", "differential"].includes(state.mode) &&
    PHASE_RANK.has(state.phase)
  );
}

function progressTuple(state) {
  return [
    PHASE_RANK.get(state?.phase) ?? -1,
    SCAN_RANK.get(state?.scan) ?? -1,
    Number.isSafeInteger(Number(state?.index))
      ? Number(state.index)
      : 0,
  ];
}

function compareProgress(left, right) {
  const leftProgress = progressTuple(left);
  const rightProgress = progressTuple(right);
  for (let index = 0; index < leftProgress.length; index += 1) {
    if (leftProgress[index] !== rightProgress[index]) {
      return leftProgress[index] - rightProgress[index];
    }
  }
  return 0;
}

function sameTarget(left, right) {
  return (
    Number(left?.epoch) === Number(right?.epoch) &&
    left?.catalog_digest === right?.catalog_digest
  );
}

function aheadState(current, candidate) {
  if (!sameTarget(current, candidate)) return candidate;
  if (current?.status === "ready") return current;
  if (candidate?.status === "ready") return candidate;
  return compareProgress(current, candidate) > 0 ? current : candidate;
}

function stateResult(status) {
  return {
    ready: status?.status === "ready",
    status,
  };
}

function nextPhase(state, phase, extras = {}) {
  return {
    ...state,
    phase,
    cursor: null,
    index: 0,
    scan: null,
    error: "",
    ...extras,
  };
}

export function createContentInitializer({
  kv,
  now = () => Date.now(),
  batchSize = 50,
  workBudget = 4,
} = {}) {
  if (
    !kv ||
    typeof kv.get !== "function" ||
    typeof kv.put !== "function" ||
    typeof kv.delete !== "function" ||
    typeof kv.list !== "function"
  ) {
    throw new TypeError("A bound EdgeOne Makers KV namespace is required");
  }
  const safeBatchSize = positiveInteger(
    batchSize,
    50,
    "batchSize",
    256,
  );
  const safeWorkBudget = positiveInteger(
    workBudget,
    4,
    "workBudget",
  );
  const store = new KvStore(kv, { now });

  async function readStatus() {
    const raw = await kv.get(STATE_KEY);
    if (raw == null || raw === "") return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  async function putState(candidate) {
    const current = await readStatus();
    const selected = aheadState(current, candidate);
    if (selected === current) return current;
    await kv.put(STATE_KEY, JSON.stringify(selected));

    // A second read prevents a slower initializer from silently regressing
    // progress written by another instance between our read and write.
    const observed = await readStatus();
    if (sameTarget(observed, selected) && compareProgress(observed, selected) < 0) {
      await kv.put(STATE_KEY, JSON.stringify(selected));
      return selected;
    }
    return observed || selected;
  }

  async function purgeBatch(state) {
    const page = await kv.list(
      listOptions("", Math.min(256, safeBatchSize + 1)),
    );
    const candidates = (page?.keys || [])
      .map((item) => item?.key || item?.name)
      .filter((key) => key && key !== STATE_KEY);
    const keys = candidates.slice(0, safeBatchSize);
    for (const key of keys) {
      await kv.delete(key);
    }
    const hasMore = !page?.complete || candidates.length > keys.length;
    if (!hasMore) {
      return nextPhase(state, "seed_starters");
    }
    return {
      ...state,
      // Deleting from a listed namespace can invalidate offset-like opaque
      // cursors. Rescan from the beginning and bound work by batch size.
      cursor: null,
      index: Number(state.index || 0) + keys.length,
      error: "",
    };
  }

  async function seedBatch(state, records, phase, followingPhase, writer) {
    const start = Math.max(0, Number(state.index) || 0);
    const batch = records.slice(start, start + safeBatchSize);
    for (const record of batch) {
      await writer(record);
    }
    const index = start + batch.length;
    if (index >= records.length) {
      return nextPhase(state, followingPhase);
    }
    return {
      ...state,
      phase,
      index,
      cursor: null,
      error: "",
    };
  }

  async function scanOwnedRecords(state, kind) {
    const prefix = kind === "combinations" ? "combo_" : "element_";
    const page = await kv.list(
      listOptions(prefix, safeBatchSize, state.cursor),
    );
    const keys = (page?.keys || [])
      .map((item) => item?.key || item?.name)
      .filter(Boolean);
    for (const key of keys) {
      const raw = await kv.get(key);
      if (raw == null || raw === "") continue;
      const record = typeof raw === "string" ? JSON.parse(raw) : raw;
      const owned = (
        cleanText(record?.source) === "seed" &&
        Number(record?.content_epoch) === CONTENT_EPOCH
      );
      if (!owned) continue;
      if (kind === "combinations") {
        const pair = normalizePair(record?.a, record?.b);
        if (!FIXED_PAIRS.has(pair)) {
          await store.deleteCombination(
            record?.a,
            record?.b,
            record?.result,
          );
        }
      } else {
        const name = cleanText(record?.name);
        if (name && !FIXED_ELEMENTS.has(name)) {
          await store.deleteElement(name);
        }
      }
    }

    if (page?.complete || !page?.cursor) {
      if (kind === "combinations") {
        return {
          ...state,
          cursor: null,
          index: 0,
          scan: "elements",
          error: "",
        };
      }
      return nextPhase(state, "verify_catalog");
    }
    return {
      ...state,
      cursor: page.cursor,
      index: Number(state.index || 0) + keys.length,
      scan: kind,
      error: "",
    };
  }

  async function rebuildBatch(state) {
    if (state.mode !== "differential") {
      return nextPhase(state, "verify_catalog");
    }
    const scan = state.scan === "elements" ? "elements" : "combinations";
    return scanOwnedRecords({ ...state, scan }, scan);
  }

  async function verifyBatch(state) {
    const start = Math.max(0, Number(state.index) || 0);
    const batch = VERIFY_ITEMS.slice(start, start + safeBatchSize);
    for (const item of batch) {
      const record = item.kind === "element"
        ? await store.getElement(item.name)
        : await store.getCombination(item.record.a, item.record.b);
      if (
        !record ||
        cleanText(record.source) !== "seed" ||
        Number(record.content_epoch) !== CONTENT_EPOCH ||
        record.catalog_digest !== CATALOG_DIGEST ||
        (
          item.kind === "combination" &&
          cleanText(record.result) !== item.record.result
        )
      ) {
        throw new Error(
          `catalog verification failed for ${item.kind}:${item.name || item.pair}`,
        );
      }
    }
    const index = start + batch.length;
    if (index < VERIFY_ITEMS.length) {
      return {
        ...state,
        index,
        error: "",
      };
    }
    return {
      ...state,
      status: "ready",
      mode: "ready",
      phase: "ready",
      cursor: null,
      index: 0,
      scan: null,
      completed_at: now(),
      error: "",
    };
  }

  async function processBatch(state) {
    if (state.phase === "detect") {
      return nextPhase(
        state,
        state.mode === "epoch_reset"
          ? "purge_runtime_data"
          : "seed_starters",
      );
    }
    if (state.phase === "purge_runtime_data") {
      return purgeBatch(state);
    }
    if (state.phase === "seed_starters") {
      return seedBatch(
        state,
        STARTERS,
        "seed_starters",
        "seed_elements",
        ({ name, info }) => store.rememberElement(name, info),
      );
    }
    if (state.phase === "seed_elements") {
      return seedBatch(
        state,
        ELEMENTS,
        "seed_elements",
        "seed_recipes",
        ({ name, info }) => store.rememberElement(name, info),
      );
    }
    if (state.phase === "seed_recipes") {
      return seedBatch(
        state,
        RECIPES,
        "seed_recipes",
        "rebuild_indexes",
        ({ record }) => store.putCombination(
          record.a,
          record.b,
          record,
          { overwrite: true },
        ),
      );
    }
    if (state.phase === "rebuild_indexes") {
      return rebuildBatch(state);
    }
    if (state.phase === "verify_catalog") {
      return verifyBatch(state);
    }
    if (state.phase === "ready") return state;
    throw new Error(`unknown content initialization phase: ${state.phase}`);
  }

  async function ensureInitialized() {
    let state = await readStatus();
    if (
      state?.status === "ready" &&
      Number(state.epoch) === CONTENT_EPOCH &&
      state.catalog_digest === CATALOG_DIGEST
    ) {
      return stateResult(state);
    }

    if (!validMigratingState(state)) {
      state = await putState(initialState(state, now));
    }

    try {
      for (let work = 0; work < safeWorkBudget; work += 1) {
        const persisted = await readStatus();
        if (persisted?.status === "ready") return stateResult(persisted);
        if (!validMigratingState(persisted)) {
          state = await putState(initialState(persisted, now));
        } else {
          state = persisted;
        }
        const next = await processBatch(state);
        state = await putState(next);
        if (state?.status === "ready") break;
      }
      return stateResult(state);
    } catch (error) {
      const current = await readStatus();
      if (validMigratingState(current)) {
        await putState({
          ...current,
          error: `${error?.name || "Error"}: ${error?.message || String(error)}`,
        });
      }
      throw error;
    }
  }

  return {
    ensureInitialized,
    readStatus,
  };
}
