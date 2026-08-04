import {
  BOUNTY_COMBINATIONS,
  BOUNTY_CONTENT,
  BOUNTY_ELEMENTS,
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../_generated/bounty-content.js";
import { normalizeComment } from "./comments.js";
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
  ["recipes", 1],
  ["elements", 2],
]);
const RECONCILIATION_SCANS = new Set(SCAN_RANK.keys());
const MAX_STATE_CURSOR_BYTES = 512;
const MAX_STATE_ERROR_CHARS = 500;
let INITIALIZATION_COORDINATOR = Promise.resolve();
const EPOCH_RESET_PHASES = new Set([
  "detect",
  "purge_runtime_data",
  "seed_starters",
  "seed_elements",
  "seed_recipes",
  "rebuild_indexes",
  "verify_catalog",
]);
const DIFFERENTIAL_PHASES = new Set([
  "detect",
  "seed_starters",
  "seed_elements",
  "seed_recipes",
  "rebuild_indexes",
  "verify_catalog",
]);

const OWNERSHIP = Object.freeze({
  source: "seed",
  content_epoch: CONTENT_EPOCH,
  catalog_digest: CATALOG_DIGEST,
});
const CATALOG_VERSION = cleanText(BOUNTY_CONTENT.catalog?.meta?.version);
const CURRENT_TARGET = Object.freeze({
  epoch: CONTENT_EPOCH,
  catalog_digest: CATALOG_DIGEST,
  catalog_version: CATALOG_VERSION,
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
const FIXED_RECIPE_IDENTITIES = new Set(
  RECIPES.map(({ record }) =>
    `${normalizePair(record.a, record.b)}\u0000${record.result}`),
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
    (
      previous?.mode === "epoch_reset" ||
      (!previous?.mode && previous?.phase === "purge_runtime_data")
    )
  );
  const mode = (
    resumesEpochReset ||
    !previous ||
    previous?.malformed === true ||
    !sameEpoch
  )
    ? "epoch_reset"
    : "differential";
  return {
    epoch: CONTENT_EPOCH,
    catalog_digest: CATALOG_DIGEST,
    catalog_version: CATALOG_VERSION,
    status: "migrating",
    mode,
    phase: mode === "epoch_reset"
      ? "purge_runtime_data"
      : "seed_starters",
    cursor: null,
    index: 0,
    scan: null,
    purge_pass: 0,
    purge_deleted: 0,
    scan_pass: 0,
    scan_deleted: 0,
    purge_completed: false,
    started_at: resumesEpochReset
      ? Number(previous.started_at) || now()
      : now(),
    completed_at: null,
    error: "",
  };
}

function validReadyState(state) {
  return (
    state?.status === "ready" &&
    state?.mode === "ready" &&
    state?.phase === "ready" &&
    Number(state.epoch) === CONTENT_EPOCH &&
    state.catalog_digest === CATALOG_DIGEST &&
    state?.cursor == null &&
    state?.scan == null &&
    Number(state?.index || 0) === 0
  );
}

function validMigratingState(state) {
  const common = (
    state?.status === "migrating" &&
    Number(state.epoch) === CONTENT_EPOCH &&
    state.catalog_digest === CATALOG_DIGEST
  );
  if (!common) return false;
  const scanValid = state.phase === "rebuild_indexes"
    ? state.scan == null || RECONCILIATION_SCANS.has(state.scan)
    : state.scan == null;
  if (!scanValid) return false;
  if (state.mode === "differential") {
    return DIFFERENTIAL_PHASES.has(state.phase);
  }
  if (state.mode !== "epoch_reset" || !EPOCH_RESET_PHASES.has(state.phase)) {
    return false;
  }
  return (
    state.phase === "detect" ||
    state.phase === "purge_runtime_data" ||
    state.purge_completed === true
  );
}

function progressTuple(state) {
  const pass = state?.phase === "purge_runtime_data"
    ? Number(state?.purge_pass) || 0
    : state?.phase === "rebuild_indexes"
      ? Number(state?.scan_pass) || 0
      : 0;
  return [
    PHASE_RANK.get(state?.phase) ?? -1,
    SCAN_RANK.get(state?.scan) ?? -1,
    pass,
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

function semanticVersionParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(cleanText(value));
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareSemanticVersions(left, right) {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);
  if (!leftParts || !rightParts) return 0;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function compareTargets(left, right) {
  const leftEpoch = Number(left?.epoch);
  const rightEpoch = Number(right?.epoch);
  if (
    Number.isSafeInteger(leftEpoch) &&
    Number.isSafeInteger(rightEpoch) &&
    leftEpoch !== rightEpoch
  ) {
    return leftEpoch - rightEpoch;
  }
  if (
    leftEpoch === rightEpoch &&
    left?.catalog_digest !== right?.catalog_digest
  ) {
    return compareSemanticVersions(
      left?.catalog_version,
      right?.catalog_version,
    );
  }
  return 0;
}

function hasNewerTarget(state) {
  return compareTargets(state, CURRENT_TARGET) > 0;
}

function aheadState(current, candidate) {
  const targetOrder = compareTargets(current, candidate);
  if (targetOrder > 0) return current;
  if (targetOrder < 0) return candidate;
  if (!sameTarget(current, candidate)) return candidate;
  if (validReadyState(current)) return current;
  if (validReadyState(candidate)) return candidate;
  const currentMigrating = validMigratingState(current);
  const candidateMigrating = validMigratingState(candidate);
  if (!currentMigrating) return candidate;
  if (
    candidateMigrating &&
    current.mode !== candidate.mode
  ) {
    return current.mode === "epoch_reset" ? current : candidate;
  }
  return compareProgress(current, candidate) > 0 ? current : candidate;
}

function stateResult(status) {
  return {
    ready: status?.status === "ready",
    status,
  };
}

function newerTargetResult(status) {
  return {
    ready: false,
    status,
    blocked_by_newer_target: true,
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

function coordinateInitialization(task) {
  // Makers KV exposes no compare-and-swap primitive. This coordinator closes
  // same-isolate races (including separate namespace wrapper objects); durable
  // replay remains responsible for cross-isolate eventual convergence.
  const previous = INITIALIZATION_COORDINATOR;
  const run = previous.catch(() => undefined).then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  INITIALIZATION_COORDINATOR = settled;
  return run.finally(() => {
    if (INITIALIZATION_COORDINATOR === settled) {
      INITIALIZATION_COORDINATOR = Promise.resolve();
    }
  });
}

function parseStoredJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function isCurrentCatalogRecord(raw) {
  const record = parseStoredJson(raw);
  return (
    Number(record?.content_epoch) === CONTENT_EPOCH &&
    record?.catalog_digest === CATALOG_DIGEST
  );
}

function cursorIsPersistable(cursor) {
  return (
    typeof cursor === "string" &&
    cursor.length > 0 &&
    new TextEncoder().encode(cursor).byteLength <= MAX_STATE_CURSOR_BYTES
  );
}

function boundedText(value, maximum) {
  return [...String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()]
    .slice(0, maximum)
    .join("");
}

function errorSummary(error) {
  const name = boundedText(error?.name || "Error", 64)
    .replace(/[^A-Za-z0-9_.-]+/gu, "_") || "Error";
  const message = boundedText(error?.message || String(error), 430);
  return boundedText(`${name}: ${message}`, MAX_STATE_ERROR_CHARS);
}

function canonicalState(state) {
  return {
    epoch: Number(state?.epoch),
    catalog_digest: cleanText(state?.catalog_digest),
    catalog_version: cleanText(state?.catalog_version),
    status: cleanText(state?.status),
    mode: cleanText(state?.mode),
    phase: cleanText(state?.phase),
    cursor: cursorIsPersistable(state?.cursor) ? state.cursor : null,
    index: Math.max(0, Number(state?.index) || 0),
    scan: state?.scan == null ? null : cleanText(state.scan),
    purge_pass: Math.max(0, Number(state?.purge_pass) || 0),
    purge_deleted: Math.max(0, Number(state?.purge_deleted) || 0),
    scan_pass: Math.max(0, Number(state?.scan_pass) || 0),
    scan_deleted: Math.max(0, Number(state?.scan_deleted) || 0),
    purge_completed: state?.purge_completed === true,
    started_at: Number(state?.started_at) || null,
    completed_at: Number(state?.completed_at) || null,
    error: boundedText(state?.error, MAX_STATE_ERROR_CHARS),
  };
}

function hasCurrentCatalogMetadata(record) {
  return (
    Boolean(cleanText(record?.source)) &&
    Number(record?.content_epoch) === CONTENT_EPOCH &&
    record?.catalog_digest === CATALOG_DIGEST
  );
}

function elementFieldsMatch(record, expected) {
  return (
    hasCurrentCatalogMetadata(record) &&
    cleanText(record?.emoji) === expected.emoji &&
    cleanText(record?.category) === expected.category &&
    (
      !Object.hasOwn(expected, "depth") ||
      Number(record?.depth) === Number(expected.depth)
    ) &&
    (
      !Object.hasOwn(expected, "icon") ||
      JSON.stringify(record?.icon) === JSON.stringify(expected.icon)
    )
  );
}

function combinationFieldsMatch(record, expected) {
  return (
    hasCurrentCatalogMetadata(record) &&
    cleanText(record?.source) === "seed" &&
    normalizePair(record?.a, record?.b) ===
      normalizePair(expected.a, expected.b) &&
    cleanText(record?.result) === expected.result &&
    cleanText(record?.emoji) === expected.emoji &&
    normalizeComment(record?.comment) ===
      normalizeComment(expected.comment) &&
    (cleanText(record?.chain) || null) === expected.chain
  );
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
    const parsed = parseStoredJson(raw);
    return parsed || { status: "invalid", malformed: true };
  }

  async function putState(candidate) {
    candidate = canonicalState(candidate);
    const current = await readStatus();
    const selected = aheadState(current, candidate);
    if (selected === current) return current;
    await kv.put(STATE_KEY, JSON.stringify(selected));

    // Repair an interleaving that is observable on readback. Without a KV CAS
    // this is not a strict cross-isolate linearizability guarantee.
    const observed = await readStatus();
    const preferred = aheadState(observed, selected);
    if (
      preferred === selected &&
      JSON.stringify(observed) !== JSON.stringify(selected)
    ) {
      await kv.put(STATE_KEY, JSON.stringify(selected));
      return selected;
    }
    return preferred || observed || selected;
  }

  function restartPurge(state) {
    return {
      ...state,
      cursor: null,
      index: 0,
      purge_pass: Math.max(0, Number(state.purge_pass) || 0) + 1,
      purge_deleted: 0,
      error: "",
    };
  }

  async function purgePage(state) {
    if (state.cursor && !cursorIsPersistable(state.cursor)) {
      return {
        state: restartPurge(state),
        restart: true,
      };
    }
    const page = await kv.list(
      listOptions(
        "",
        safeBatchSize,
        state.cursor,
      ),
    );
    const keys = (page?.keys || [])
      .map((item) => item?.key || item?.name)
      .filter((key) => key && key !== STATE_KEY);
    let deleted = 0;
    for (const key of keys) {
      const raw = await kv.get(key);
      if (isCurrentCatalogRecord(raw)) continue;
      await kv.delete(key);
      deleted += 1;
    }
    const passDeleted = Math.max(0, Number(state.purge_deleted) || 0) +
      deleted;
    if (!page?.complete) {
      if (!cursorIsPersistable(page?.cursor)) {
        return {
          state: restartPurge(state),
          restart: true,
        };
      }
      return {
        state: {
          ...state,
          cursor: page.cursor,
          index: Math.max(0, Number(state.index) || 0) + keys.length,
          purge_deleted: passDeleted,
          error: "",
        },
        restart: false,
      };
    }
    if (passDeleted === 0) {
      return {
        state: nextPhase(state, "seed_starters", {
          purge_completed: true,
          purge_deleted: 0,
        }),
        restart: false,
      };
    }
    return {
      state: restartPurge(state),
      restart: true,
    };
  }

  async function purgeBatch(state) {
    return (await purgePage(state)).state;
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

  function restartScan(state, kind) {
    return {
      ...state,
      cursor: null,
      index: 0,
      scan: kind,
      scan_pass: Math.max(0, Number(state.scan_pass) || 0) + 1,
      scan_deleted: 0,
      error: "",
    };
  }

  async function scanOwnedRecords(state, kind) {
    if (state.cursor && !cursorIsPersistable(state.cursor)) {
      return restartScan(state, kind);
    }
    const prefix = kind === "combinations"
      ? "combo_"
      : kind === "recipes"
        ? "recipe_"
        : "element_";
    const page = await kv.list(
      listOptions(prefix, safeBatchSize, state.cursor),
    );
    const keys = (page?.keys || [])
      .map((item) => item?.key || item?.name)
      .filter(Boolean);
    let deleted = 0;
    for (const key of keys) {
      const raw = await kv.get(key);
      if (raw == null || raw === "") continue;
      const record = parseStoredJson(raw);
      if (!record) {
        if (kind === "elements") {
          await store.deleteIndexRecord("element", key);
        }
        await kv.delete(key);
        deleted += 1;
        continue;
      }
      const structurallyValid = kind === "elements"
        ? Boolean(cleanText(record?.name))
        : Boolean(
          cleanText(record?.a) &&
          cleanText(record?.b) &&
          cleanText(record?.result),
        );
      if (!structurallyValid) {
        if (kind === "elements") {
          await store.deleteIndexRecord("element", key);
        }
        await kv.delete(key);
        deleted += 1;
        continue;
      }
      const owned = cleanText(record?.source) === "seed";
      if (!owned) continue;
      if (kind === "combinations") {
        const pair = normalizePair(record?.a, record?.b);
        if (!FIXED_PAIRS.has(pair)) {
          if (
            cleanText(record?.a) &&
            cleanText(record?.b) &&
            cleanText(record?.result)
          ) {
            await store.deleteCombination(
              record.a,
              record.b,
              record.result,
            );
          }
          await kv.delete(key);
          deleted += 1;
        }
      } else if (kind === "recipes") {
        const identity =
          `${normalizePair(record?.a, record?.b)}\u0000${cleanText(record?.result)}`;
        const expectedKey = await store.recipeKey(
          record?.a,
          record?.b,
          record?.result,
        );
        if (
          !FIXED_RECIPE_IDENTITIES.has(identity) ||
          expectedKey !== key
        ) {
          await kv.delete(key);
          deleted += 1;
        }
      } else {
        const name = cleanText(record?.name);
        if (name && !FIXED_ELEMENTS.has(name)) {
          await store.deleteElement(name);
          await store.deleteIndexRecord("element", key);
          await kv.delete(key);
          deleted += 1;
        } else if (!name) {
          await store.deleteIndexRecord("element", key);
          await kv.delete(key);
          deleted += 1;
        }
      }
    }

    const passDeleted = Math.max(0, Number(state.scan_deleted) || 0) +
      deleted;
    if (!page?.complete && !cursorIsPersistable(page?.cursor)) {
      return restartScan(state, kind);
    }
    if (page?.complete) {
      if (passDeleted > 0) {
        return restartScan(state, kind);
      }
      if (kind === "combinations") {
        return {
          ...state,
          cursor: null,
          index: 0,
          scan: "recipes",
          scan_pass: 0,
          scan_deleted: 0,
          error: "",
        };
      }
      if (kind === "recipes") {
        return {
          ...state,
          cursor: null,
          index: 0,
          scan: "elements",
          scan_pass: 0,
          scan_deleted: 0,
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
      scan_deleted: passDeleted,
      error: "",
    };
  }

  async function rebuildBatch(state) {
    const scan = RECONCILIATION_SCANS.has(state.scan)
      ? state.scan
      : "combinations";
    return scanOwnedRecords({ ...state, scan }, scan);
  }

  async function verifyBatch(state) {
    const start = Math.max(0, Number(state.index) || 0);
    const batch = VERIFY_ITEMS.slice(start, start + safeBatchSize);
    for (const item of batch) {
      const record = item.kind === "element"
        ? await store.getElement(item.name)
        : await store.getCombination(item.record.a, item.record.b);
      const fieldsMatch = item.kind === "element"
        ? elementFieldsMatch(record, item.info)
        : combinationFieldsMatch(record, item.record);
      const subordinate = item.kind === "element"
        ? await store.getElementIndexRecord(item.name)
        : await store.getRecipe(
          item.record.a,
          item.record.b,
          item.record.result,
        );
      const subordinateMatches = item.kind === "element"
        ? (
          elementFieldsMatch(subordinate, item.info) &&
          cleanText(subordinate?.name) === item.name &&
          cleanText(subordinate?.source) === cleanText(record?.source)
        )
        : combinationFieldsMatch(subordinate, item.record);
      if (!record || !fieldsMatch || !subordinateMatches) {
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

  async function ensureInitializedOnce() {
    let state = await readStatus();
    if (hasNewerTarget(state)) {
      return newerTargetResult(state);
    }
    if (validReadyState(state)) {
      return stateResult(state);
    }

    if (!validMigratingState(state)) {
      state = await putState(initialState(state, now));
      if (hasNewerTarget(state)) {
        return newerTargetResult(state);
      }
    }

    try {
      for (let work = 0; work < safeWorkBudget; work += 1) {
        const persisted = await readStatus();
        if (hasNewerTarget(persisted)) {
          return newerTargetResult(persisted);
        }
        if (validReadyState(persisted)) return stateResult(persisted);
        if (!validMigratingState(persisted)) {
          state = await putState(initialState(persisted, now));
        } else {
          state = persisted;
        }
        const next = await processBatch(state);
        state = await putState(next);
        if (hasNewerTarget(state)) {
          return newerTargetResult(state);
        }
        if (validReadyState(state)) break;
      }
      if (hasNewerTarget(state)) {
        return newerTargetResult(state);
      }
      return stateResult(state);
    } catch (error) {
      const current = await readStatus();
      if (validMigratingState(current)) {
        await putState({
          ...current,
          error: errorSummary(error),
        });
      }
      throw error;
    }
  }

  async function ensureInitialized() {
    return coordinateInitialization(ensureInitializedOnce);
  }

  return {
    ensureInitialized,
    readStatus,
  };
}
