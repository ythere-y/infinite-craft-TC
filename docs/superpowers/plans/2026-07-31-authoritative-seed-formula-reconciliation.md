# Authoritative Seed Formula Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every valid seed formula authoritative in local Redis, SQLite, and active community formula versions at startup, and permanently verify that the homepage nine-step example is executable from the seed library.

**Architecture:** Add an explicit replacement mode to the SQLite combination upsert and make `db.put_cache_force` use it. `SeedStore.load` then synchronizes every seed formula through that force path while ordinary LLM writes retain first-write-wins behavior.

**Tech Stack:** Python 3.11, SQLite, redis-py, pytest, static HTML.

## Global Constraints

- Seed formulas replace only records with the same normalized combination key.
- Preserve SQLite `created_at` and `hit_count` when replacing seed fields.
- Preserve all combinations whose keys do not appear in `seed_combinations.json`.
- Preserve `first_discoveries`.
- Do not change EdgeOne Makers resolution order.
- Preserve unrelated dirty working-tree changes.

---

### Task 1: Reconcile seed formulas across Redis and SQLite

**Files:**
- Create: `tests/test_seed_reconciliation.py`
- Modify: `backend/archive.py`
- Modify: `backend/db.py`
- Modify: `backend/seed_loader.py`

**Interfaces:**
- Consumes: `archive.upsert_combination(..., replace_existing: bool = False)`.
- Produces: `db.put_cache_force(...)` that replaces Redis and SQLite formula fields while preserving archive counters; `SeedStore.load()` synchronizes every valid seed formula and passes normalized formulas to community reconciliation.

- [ ] **Step 1: Write the failing integration test**

Create a temporary one-formula seed file, a real isolated SQLite archive, and a complete in-memory Redis double. Preload `水 + 水 = 海洋` in both stores plus a non-seed formula, call `SeedStore.load()`, and assert:

```python
assert redis_formula["result"] == "水塘"
assert sqlite_formula["result"] == "水塘"
assert sqlite_formula["hit_count"] == 3
assert redis_non_seed["result"] == "历史结果"
assert sqlite_non_seed["result"] == "历史结果"
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
python3 -m pytest tests/test_seed_reconciliation.py -q
```

Expected: FAIL because `SeedStore.load()` skips every key already present in Redis.

- [ ] **Step 3: Add explicit SQLite replacement**

Add `replace_existing: bool = False` to `archive.upsert_combination`. In replacement mode update `result`, `emoji`, `source`, `chain`, and `comment` from `excluded`, but do not update `created_at`; preserve the existing hit-count increment expression.

- [ ] **Step 4: Make force writes force both stores**

Pass `replace_existing=True` from `db.put_cache_force` to `archive.upsert_combination`. Leave `db.put_cache` unchanged.

- [ ] **Step 5: Synchronize every valid seed on startup**

Replace the `get_cached`/skip branch in `SeedStore.load` with `db.put_cache_force`, including the seed comment:

```python
db.put_cache_force(
    key=key,
    result=info["result"],
    emoji=info.get("emoji", "❓"),
    source="seed",
    chain=info.get("chain"),
    comment=info.get("comment", ""),
)
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_seed_reconciliation.py -q
```

Expected: PASS.

---

### Task 2: Supersede conflicting active community formulas

**Files:**
- Modify: `tests/test_community.py`
- Modify: `backend/community.py`
- Modify: `backend/seed_loader.py`

**Interfaces:**
- Consumes: `community.reconcile_seed_formulas(formulas)`, where each formula has `combo_key`, `a`, `b`, `result`, `emoji`, `comment`, and `source`.
- Produces: the number of superseded active versions; conflicting v1 rows become hidden/retired and a correct hidden/active v2 is created.

- [ ] **Step 1: Write the failing community version test**

Create and publish an incorrect active v1, attach a reproduction and vote, then reconcile the authoritative seed formula. Assert the old row is hidden/retired, its history remains, and one correct active v2 exists. Call reconciliation again and assert it returns 0 without creating v3.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
python3 -m pytest tests/test_community.py::test_seed_reconciliation_supersedes_conflicting_active_formula -q
```

Expected: FAIL because `reconcile_seed_formulas` does not exist.

- [ ] **Step 3: Implement transactional supersession**

Add `reconcile_seed_formulas(formulas) -> int` in `backend/community.py`. For each conflicting active row, set `status='retired'`, `visibility='hidden'`, insert the next version from seed as hidden/active, and delete any stale `retired_combo_keys` row. Return 0 if the community tables are not initialized.

- [ ] **Step 4: Connect seed loading**

Collect each valid normalized seed formula in `SeedStore.load()` and call `community.reconcile_seed_formulas(formulas)` after Redis/SQLite synchronization.

- [ ] **Step 5: Run the focused community and seed tests**

Run:

```bash
python3 -m pytest tests/test_seed_reconciliation.py tests/test_community.py -q
```

Expected: PASS.

---

### Task 3: Protect the homepage nine-step formula path

**Files:**
- Modify: `tests/test_seed_reconciliation.py`
- Read: `frontend/index.html`
- Read: `backend/seed_combinations.json`

**Interfaces:**
- Consumes: the rendered `.case-step` text and normalized seed combination keys.
- Produces: a regression test proving all nine displayed input/result/emoji tuples exist in the seed library.

- [ ] **Step 1: Add the homepage integrity test**

Parse all `.case-step` divs from `frontend/index.html`, remove markup, and compare the nine literal steps to the corresponding normalized entries in `backend/seed_combinations.json`.

- [ ] **Step 2: Run the integrity test**

Run:

```bash
python3 -m pytest tests/test_seed_reconciliation.py -q
```

Expected: both reconciliation and homepage integrity tests PASS.

- [ ] **Step 3: Run project verification**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm test
npm run build
```

Expected: Python and build checks pass. If the existing committed-only Node build fixture still reports the pre-existing untracked wall module, report it separately.

---

### Task 4: Repair and verify the running data

**Files:**
- Runtime data only: Redis database 1 and `data/dev.db`

**Interfaces:**
- Consumes: startup synchronization from Task 1.
- Produces: zero missing or conflicting Redis entries across all 859 seed formulas and correct homepage formulas at `http://21.214.53.194/`.

- [ ] **Step 1: Rebuild and restart the Web container**

Run:

```bash
docker compose up --build --remove-orphans -d
```

- [ ] **Step 2: Scan every live seed key**

Compare all normalized seed keys to `combo:{key}` in Redis database 1.

Expected: Redis, SQLite, and active community conflicts are all 0; Redis missing is 0.

- [ ] **Step 3: Verify the reported formula through the API**

POST `{"a":"水","b":"水","session_id":"verification","discoverer":"验证鹅"}` to `/api/combine`.

Expected: response contains `"result":"水塘"` and `"source":"seed"`.
