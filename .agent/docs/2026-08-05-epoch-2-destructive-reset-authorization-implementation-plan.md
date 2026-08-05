# Epoch 2 Destructive Reset Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkboxes so progress survives handoffs.

**Goal:** Make the Epoch 2 full reset explicit, authorized, fail-closed, and crash-resumable across local SQLite/Redis and Makers KV while preserving same-epoch differential updates.

**Architecture:** The editable bounty catalog declares which prior epochs may be destructively reset. The compiler validates and publishes that policy to both generated artifacts. Local startup resolves a transition before writing migration state or deleting data. Makers startup resolves the same transition and uses a target-specific durable receipt to prove a destructive reset was started and completed.

**Tech Stack:** Node.js ES modules and `node:test`; Python 3, pytest, SQLite, Redis; EdgeOne Makers KV.

**Global Constraints:**

- Scope is Epoch 2 data strategy only. Do not change scoring, vote-consistency, or browser-gate behavior.
- All current runtime data are test data, so the authorized Epoch 2 transition may clear all gameplay/community/KPI/identity runtime records.
- Preserve local SQLite `content_state` and unrelated configuration tables.
- Preserve Makers `system_content_state` and `system_content_reset_receipt_<target_epoch>` control records during purge.
- Never infer destructive permission from “state is odd.” A present malformed state, an unauthorized lower epoch, or a higher epoch must fail before any migration-state write or data deletion.
- Keep generated artifacts derived from `content/tencent-bounty-catalog.json`; do not edit them by hand.
- Use test-first implementation for every behavior change.

## Task 1: Publish the destructive-reset policy in generated content

**Files:**

- Modify: `content/tencent-bounty-catalog.json`
- Modify: `scripts/bounty-content-lib.mjs`
- Modify: `tests-makers/bounty-content-generation.test.mjs`
- Regenerate: `backend/generated/bounty-content.json`
- Regenerate: `edge-functions/_generated/bounty-content.js`
- Modify: `tests/test_content_catalog.py`

### Steps

- [x] Add failing compiler tests showing that Epoch 2 accepts exactly:

  ```js
  meta: {
    content_epoch: 2,
    version: "2.0.0",
    destructive_reset_from: ["legacy", 1],
  }
  ```

  The tests must reject a missing field, duplicate values, `0`, the target epoch, a higher epoch, non-safe integers, booleans, blank strings, and strings other than `"legacy"`.

- [x] Add failing serialization assertions for:

  ```js
  compiled.destructive_reset_from
  // => ["legacy", 1]

  export const DESTRUCTIVE_RESET_FROM =
    BOUNTY_CONTENT.destructive_reset_from;
  ```

- [x] Add a failing Python catalog-validation test that rejects an artifact whose top-level policy does not exactly match `catalog.meta.destructive_reset_from`.

- [x] Run the focused red tests:

  ```bash
  node --test --test-name-pattern="destructive reset" tests-makers/bounty-content-generation.test.mjs
  python3 -m pytest tests/test_content_catalog.py -q
  ```

- [x] Implement a compiler helper that:

  1. requires an array;
  2. accepts the literal `"legacy"` or a positive safe integer strictly below `content_epoch`;
  3. rejects duplicates without coercion; and
  4. returns a cloned canonical array in source order.

- [x] Include the canonical policy at both `catalog.meta.destructive_reset_from` and top-level `destructive_reset_from`, then export it from the Edge artifact.

- [x] Add `"destructive_reset_from": ["legacy", 1]` to the editable Epoch 2 catalog metadata.

- [x] Extend `backend/content_catalog.py::_validate_compiled_content` to validate the exact types, bounds, uniqueness, and equality of the top-level and catalog metadata policies. In Python, explicitly reject `bool`, because it is an `int` subclass.

- [x] Regenerate and run the focused green tests:

  ```bash
  npm run generate:bounty-content
  node --test --test-name-pattern="destructive reset" tests-makers/bounty-content-generation.test.mjs
  python3 -m pytest tests/test_content_catalog.py -q
  ```

- [x] Commit:

  ```bash
  git add content/tencent-bounty-catalog.json scripts/bounty-content-lib.mjs tests-makers/bounty-content-generation.test.mjs backend/generated/bounty-content.json edge-functions/_generated/bounty-content.js backend/content_catalog.py tests/test_content_catalog.py
  git commit -m "feat: publish Epoch 2 reset authorization"
  ```

## Task 2: Fail closed before local destructive migration

**Files:**

- Modify: `backend/content_catalog.py`
- Modify: `backend/content_epoch.py`
- Modify: `tests/test_content_epoch.py`

### Steps

- [x] Add a public catalog accessor:

  ```python
  def destructive_reset_from() -> tuple[str | int, ...]:
      return tuple(load_compiled_content()["destructive_reset_from"])
  ```

- [x] Add failing local tests for the decision matrix:

  - missing state plus SQLite or Redis runtime data resolves to authorized `"legacy"` and performs `epoch_reset`;
  - missing state plus empty SQLite and Redis resolves to `bootstrap` without requiring a prior-epoch authorization; bootstrap may still clear its own partial seed data when resuming;
  - ready Epoch 1 resolves to authorized destructive reset;
  - ready Epoch 3 raises `ContentResetNotAuthorized` and leaves SQLite, Redis, and stored state byte-for-byte unchanged;
  - a lower epoch removed from the catalog authorization raises the same error before writes;
  - same Epoch 2 and same digest reconciles without deletion;
  - same Epoch 2 and a different digest remains differential;
  - an already-started authorized Epoch 2 destructive migration resumes idempotently.

- [x] Run the focused red tests:

  ```bash
  python3 -m pytest tests/test_content_epoch.py -q
  ```

- [x] Add:

  ```python
  class ContentResetNotAuthorized(RuntimeError):
      code = "CONTENT_RESET_NOT_AUTHORIZED"
  ```

- [x] Extend `_catalog_state()` with the normalized policy and implement pure transition resolution:

  ```python
  def _authorized(catalog, source):
      return source in catalog["destructive_reset_from"]
  ```

  The resolver must distinguish:

  - `source="legacy"` when state is absent but either SQLite or Redis contains runtime data;
  - `bootstrap` only when state is absent and both stores are empty;
  - lower, same, and higher numeric epochs;
  - resumable destructive state that already targets the current epoch.

- [x] Detect Redis runtime data with `db.get_client().dbsize()` before deciding that an absent-state store is empty. Propagate connection errors; do not treat an unreadable store as empty.

- [x] Move all authorization checks before `archive.begin_content_migration`, `archive.reset_gameplay_data`, and `db.reset_runtime_data`.

- [x] Keep `complete_local`, safe failure reporting, same-epoch reconciliation, and differential retirement behavior unchanged.

- [x] Run the focused green test:

  ```bash
  python3 -m pytest tests/test_content_epoch.py -q
  ```

- [x] Commit:

  ```bash
  git add backend/content_catalog.py backend/content_epoch.py tests/test_content_epoch.py
  git commit -m "feat: guard local Epoch 2 reset"
  ```

## Task 3: Add Makers authorization and durable reset receipts

**Files:**

- Modify: `edge-functions/_lib/content-initializer.js`
- Modify: `tests-makers/content-initializer.test.mjs`
- Use generated export: `edge-functions/_generated/bounty-content.js`

### Steps

- [x] Add failing Makers tests for these transitions:

  - an entirely empty namespace bootstraps without creating a reset receipt;
  - a state-less namespace with runtime records is treated as `"legacy"` and may reset only because `"legacy"` is authorized;
  - ready Epoch 1 may reset and writes `in_progress` before the first runtime delete;
  - ready Epoch 3, unauthorized lower epoch, and present malformed state all return `CONTENT_RESET_NOT_AUTHORIZED` before any put/delete;
  - malformed, wrong-target, wrong-digest, or contradictory receipts return `CONTENT_RESET_RECEIPT_INVALID`;
  - purge preserves the state key and every reset receipt key;
  - interrupted purge resumes from an `in_progress` receipt;
  - exact verification marks the receipt `completed` before the state becomes ready;
  - completed receipt plus missing state recovers non-destructively and never replays purge;
  - current ready state remains a no-op and same-epoch changed digest remains differential.

- [x] Instrument `FakeKV` in tests where necessary to record ordered `put` and `delete` operations. Assert receipt persistence precedes deletion and completion precedes the ready-state write.

- [x] Run the focused red tests:

  ```bash
  node --test --test-name-pattern="authorization|receipt|legacy|higher epoch|malformed persisted state" tests-makers/content-initializer.test.mjs
  ```

- [x] Import `DESTRUCTIVE_RESET_FROM` and add:

  ```js
  const RESET_RECEIPT_PREFIX = "system_content_reset_receipt_";
  const RESET_RECEIPT_KEY = `${RESET_RECEIPT_PREFIX}${CONTENT_EPOCH}`;

  class ContentInitializationPolicyError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  ```

- [x] Add strict JSON parsers for state and receipt. A missing state is distinct from malformed present JSON. Validate a receipt against the current target epoch and digest, source epoch, status, and timestamps.

- [x] Before writing a migration state, inspect the namespace with bounded KV listing and resolve:

  - empty except control records → `bootstrap`;
  - absent state plus runtime data and no receipt → authorized `"legacy"` reset;
  - lower ready state → reset only when the exact numeric source is authorized;
  - higher state → `CONTENT_RESET_NOT_AUTHORIZED`;
  - malformed present state without a matching valid receipt → `CONTENT_RESET_NOT_AUTHORIZED`;
  - valid `in_progress` receipt → resume `epoch_reset`;
  - valid `completed` receipt plus missing state → non-destructive recovery;
  - same target and digest → ready/resume;
  - same epoch and changed digest → differential.

- [x] For an authorized destructive transition, write:

  ```js
  {
    target_epoch: CONTENT_EPOCH,
    source_epoch: "legacy" | 1,
    catalog_digest: CATALOG_DIGEST,
    status: "in_progress",
    started_at: now(),
    completed_at: null,
  }
  ```

  before entering `purge_runtime_data`.

- [x] Change purge filtering to preserve `STATE_KEY` and all keys beginning with `RESET_RECEIPT_PREFIX`. Delete every other runtime key regardless of its payload.

- [x] After full catalog verification, write the same receipt with `status: "completed"` and `completed_at`, then persist the ready state. Re-running completion must retain the original `started_at`.

- [x] Preserve the existing newer-target concurrency guard: if another worker publishes a higher epoch, return its state without overwriting it.

- [x] Run the whole initializer suite green:

  ```bash
  node --test tests-makers/content-initializer.test.mjs
  ```

- [x] Commit:

  ```bash
  git add edge-functions/_lib/content-initializer.js tests-makers/content-initializer.test.mjs
  git commit -m "feat: make Makers Epoch 2 reset resumable"
  ```

## Task 4: Expose stable policy failures without leaking internals

**Files:**

- Modify: `edge-functions/api/[[default]].js`
- Modify: `edge-functions/_lib/router.js`
- Modify: `tests-makers/router.test.mjs`

### Steps

- [ ] Add failing route tests asserting:

  - `/api/health` remains HTTP 200 and reports the allowlisted `CONTENT_RESET_NOT_AUTHORIZED` or `CONTENT_RESET_RECEIPT_INVALID`;
  - gameplay APIs stay HTTP 503 while content is not ready;
  - exception text, cursors, raw receipt JSON, provider names, and stack data never appear publicly;
  - arbitrary internal error codes continue to collapse to `CONTENT_INITIALIZATION_FAILED`.

- [ ] Run the focused red tests:

  ```bash
  node --test --test-name-pattern="reset authorization|reset receipt|initialization batch throws|sanitizes" tests-makers/router.test.mjs
  ```

- [ ] In the API entry point, capture only allowlisted initialization-policy codes from thrown errors and attach the safe code to the in-memory initialization status used for that request.

- [ ] In `publicContentStatus`, allow only:

  ```js
  new Set([
    "CONTENT_RESET_NOT_AUTHORIZED",
    "CONTENT_RESET_RECEIPT_INVALID",
  ])
  ```

  Any other failure remains:

  ```json
  {
    "error": "内容初始化暂时失败",
    "error_code": "CONTENT_INITIALIZATION_FAILED"
  }
  ```

- [ ] Keep health HTTP availability and the existing fail-closed gameplay response behavior.

- [ ] Run the focused and full router tests:

  ```bash
  node --test --test-name-pattern="reset authorization|reset receipt|initialization batch throws|sanitizes" tests-makers/router.test.mjs
  node --test tests-makers/router.test.mjs
  ```

- [ ] Commit:

  ```bash
  git add edge-functions/api/'[[default]].js' edge-functions/_lib/router.js tests-makers/router.test.mjs
  git commit -m "feat: report safe reset policy failures"
  ```

## Task 5: Document operations and verify the complete change

**Files:**

- Modify: `docs/makers-development.md`
- Verify all files changed in Tasks 1–4

### Steps

- [ ] Update the operations documentation with:

  - `destructive_reset_from` is the sole destructive authorization source;
  - Epoch 2 currently authorizes `["legacy", 1]`;
  - full reset clears test runtime data, including community, KPI, first-discovery, and nickname records;
  - Makers receipt key and state transitions;
  - fail-closed meanings of `CONTENT_RESET_NOT_AUTHORIZED` and `CONTENT_RESET_RECEIPT_INVALID`;
  - how a future epoch must intentionally declare its permitted source epochs.

- [ ] Run generated-artifact drift detection:

  ```bash
  npm run generate:bounty-content
  git diff --exit-code -- backend/generated/bounty-content.json edge-functions/_generated/bounty-content.js
  ```

- [ ] Run all project-required verification:

  ```bash
  npm test
  python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
  npm run build
  ```

- [ ] Inspect the final diff for scope, secrets, generated consistency, and unrelated files:

  ```bash
  git status --short
  git diff --check
  git diff --stat HEAD~4
  ```

- [ ] Commit documentation or final integration corrections:

  ```bash
  git add docs/makers-development.md
  git commit -m "docs: explain Epoch reset authorization"
  ```

- [ ] Report the exact verification commands and outcomes. Note that `npm run makers:build` remains the deployment maintainer’s production check and is not run locally.
