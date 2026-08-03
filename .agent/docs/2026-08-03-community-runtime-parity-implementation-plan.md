# Community Runtime Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align FastAPI and Makers community listing, detail, logout, feedback selection, and authoritative seed behavior while respecting Makers KV consistency limits.

**Architecture:** Makers keeps canonical formula records plus bounded public and retired indexes. Public reads sort the complete 500-item hot index before pagination. Seed reconciliation is eager at FastAPI startup and lazy on pair access in Makers, with deterministic version IDs and best-effort KV writes.

**Tech Stack:** Python 3.11, FastAPI, SQLite, JavaScript ES2023, EdgeOne Makers KV, Node test runner, pytest.

## Global Constraints

- Do not connect local development to Makers KV.
- Do not claim transaction or atomic-increment semantics for Makers KV.
- Makers runtime code uses only Web APIs and the globally bound KV namespace.
- Public list requests accept `limit` from 1 through 100 and non-negative `offset`.
- The Makers public and retirement hot indexes remain bounded to 500 records.
- Existing records without `ai_positive_enabled` are treated as enabled.
- Takedown formulas are never returned from public list or detail routes.
- Preserve formula history, reproductions, and votes when a seed supersedes an active formula.

---

## File responsibility map

- `backend/community.py`: authoritative SQLite community behavior.
- `backend/community_api.py`: FastAPI community HTTP contract.
- `edge-functions/_lib/community.js`: Makers formula records, indexes, ordering, feedback, and reconciliation.
- `edge-functions/_lib/router.js`: Makers HTTP route parity and cookies.
- `edge-functions/_lib/game-service.js`: seed-first resolution and reconciliation orchestration.
- `edge-functions/_lib/kv-store.js`: authoritative combination-cache overwrite support.
- `tests/test_community.py`: local visibility and feedback semantics.
- `tests/test_seed_reconciliation.py`: local authoritative seed behavior.
- `tests-makers/community.test.mjs`: Makers store ordering, feedback, and version tests.
- `tests-makers/router.test.mjs`: Makers HTTP route and cookie tests.
- `tests-makers/game-service.test.mjs`: seed-first cache integration.

### Task 1: Public listing, detail, and logout parity

**Files:**
- Modify: `backend/community.py`
- Modify: `edge-functions/_lib/community.js`
- Modify: `edge-functions/_lib/router.js`
- Modify: `tests/test_community.py`
- Modify: `tests-makers/community.test.mjs`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Makers: `listPublic({ limit = 50, offset = 0 } = {}) -> Promise<Array>`
- Makers: `publicFormula(id, playerId = null) -> Promise<object|null>`
- Makers: `clearAdminSessionCookie() -> string`
- HTTP: `GET /api/community/formulas/{id}`
- HTTP: `POST /api/community/admin/logout`

- [ ] **Step 1: Write failing Makers list and detail tests**

Create 105 public formula records directly through `ensureFormula` and
`publish`, then assign scores so the highest score is the oldest ID. Assert:

```js
const page = await community.listPublic({ limit: 10, offset: 100 });
assert.equal(page.length, 5);
assert.ok(page.every((item, index, items) =>
  index === 0 || items[index - 1].net_score >= item.net_score
));
const detail = await community.publicFormula(target.id, "voter");
assert.equal(detail.id, target.id);
assert.equal(detail.my_vote, 1);
```

Add hidden and takedown assertions:

```js
assert.equal(await community.publicFormula(hidden.id, "player"), null);
await community.moderate(target.id, "takedown", "unsafe");
assert.equal(await community.publicFormula(target.id, "player"), null);
```

- [ ] **Step 2: Write failing router tests**

Assert:

```js
const page = await json(router, "/api/community/formulas?limit=7&offset=2");
assert.equal(page.response.status, 200);
assert.ok(page.body.items.length <= 7);

const detail = await json(router, `/api/community/formulas/${formulaId}`);
assert.equal(detail.response.status, 200);
assert.equal(detail.body.id, formulaId);

const logout = await json(router, "/api/community/admin/logout", { method: "POST" });
assert.equal(logout.response.status, 200);
assert.equal(logout.body.ok, true);
assert.match(logout.response.headers.get("set-cookie"), /craft_admin=;/);
assert.match(logout.response.headers.get("set-cookie"), /Max-Age=0/);
```

- [ ] **Step 3: Run selected tests and verify RED**

Run:

```bash
node --test tests-makers/community.test.mjs tests-makers/router.test.mjs
```

Expected: FAIL because `listPublic` ignores options and detail/logout routes
are absent.

- [ ] **Step 4: Implement Makers list and detail**

Add constants:

```js
const MAX_PUBLIC_INDEX = 500;
const MAX_PUBLIC_PAGE = 100;
```

`listPublic` loads all `ids.slice(0, MAX_PUBLIC_INDEX)`, filters through
`publicView`, sorts by `net_score` descending then `published_at`
descending, and returns `sorted.slice(offset, offset + limit)`.

`publicFormula` loads the record directly, rejects non-public/takedown
records, and loads `community_vote_<id>_<player hash>` when a player ID is
present.

- [ ] **Step 5: Implement Makers routes and cookie clearing**

Parse list parameters with:

```js
const limit = intParam(url.searchParams, "limit", 50, 1, 100);
const offset = intParam(url.searchParams, "offset", 0, 0, 10_000_000);
```

Match detail only after publish/vote patterns so the static suffix routes
retain precedence. Use `playerIdentity`, enrich icons, set its cookie when
needed, and return 404 with `公开公式不存在`.

Export:

```js
export function clearAdminSessionCookie() {
  return "craft_admin=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict; Secure";
}
```

The logout route requires POST and same origin, then returns `{"ok":true}`
with the clearing cookie.

- [ ] **Step 6: Align FastAPI takedown detail behavior**

Change the SQLite detail query to:

```sql
FROM formula_versions
WHERE id=? AND visibility='public' AND status!='takedown'
```

Add a pytest that publishes, takes down, and asserts
`community.public_formula(id) is None`.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
node --test tests-makers/community.test.mjs tests-makers/router.test.mjs
python3 -m pytest tests/test_community.py -q
```

Expected: all selected tests pass.

- [ ] **Step 8: Commit Task 1**

```bash
git add backend/community.py edge-functions/_lib/community.js edge-functions/_lib/router.js tests/test_community.py tests-makers/community.test.mjs tests-makers/router.test.mjs
git commit -m "feat: align community list detail and logout APIs"
```

### Task 2: Feedback qualification and retirement order

**Files:**
- Modify: `edge-functions/_lib/community.js`
- Modify: `tests-makers/community.test.mjs`
- Modify: `backend/community.py`
- Modify: `tests/test_community.py`

**Interfaces:**
- Makers: `feedback(env = {}) -> Promise<{positives, negatives}>`
- Makers: `rememberRetired(formula) -> Promise<void>`
- Canonical formula field: `ai_positive_enabled: boolean`
- KV key: `community_retired_formulas`

- [ ] **Step 1: Write failing Makers feedback tests**

Create qualified formulas in reverse score order, including one with
`ai_positive_enabled=false`, and assert:

```js
const feedback = await community.feedback({
  FORMULA_UP_THRESHOLD: "10",
  FORMULA_UP_MIN_VOTES: "12",
});
assert.deepEqual(
  feedback.positives.map((item) => item.name),
  ["最高净赞", "第二净赞"],
);
assert.ok(!feedback.positives.some((item) => item.name === "禁止进入AI"));
```

Retire two formulas at different fake times and assert newest first:

```js
assert.deepEqual(feedback.negatives.slice(0, 2), ["后退役", "先退役"]);
```

- [ ] **Step 2: Add the matching local regression test**

After creating qualified local formulas, update one row explicitly:

```python
con.execute(
    "UPDATE formula_versions SET ai_positive_enabled=0 WHERE id=?",
    (disabled["id"],),
)
```

Assert positives are net-score ordered and omit the disabled row.

- [ ] **Step 3: Run selected tests and verify RED**

Run:

```bash
node --test tests-makers/community.test.mjs
python3 -m pytest tests/test_community.py -q
```

Expected: Makers fails ordering/disable/retirement assertions; local tests
document the canonical behavior.

- [ ] **Step 4: Implement Makers feedback parity**

New formulas include:

```js
ai_positive_enabled: true,
```

Load the complete public hot index, then filter and sort:

```js
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
    Number(right.updated_at || 0) - Number(left.updated_at || 0)
  );
```

`rememberRetired` prepends `{id,result,retired_at}` to
`community_retired_formulas`, deduplicates by ID, and retains 500 entries.
Call it inside `moderate(id, action, reasonCode, note)` when
`action === "retire"`.

Negatives union the retirement index with retired formulas still present in
the public index, deduplicate by formula ID/result, sort by retirement or
updated time descending, and apply the prompt limit.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --test tests-makers/community.test.mjs
python3 -m pytest tests/test_community.py -q
```

Expected: all feedback tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add edge-functions/_lib/community.js tests-makers/community.test.mjs backend/community.py tests/test_community.py
git commit -m "feat: align community feedback selection"
```

### Task 3: Lazy authoritative seed reconciliation

**Files:**
- Modify: `edge-functions/_lib/community.js`
- Modify: `edge-functions/_lib/game-service.js`
- Modify: `edge-functions/_lib/kv-store.js`
- Modify: `tests-makers/community.test.mjs`
- Modify: `tests-makers/game-service.test.mjs`

**Interfaces:**
- Makers: `reconcileAuthoritativeFormula(input) -> Promise<formula>`
- Makers: `putCombination(a, b, record, { rememberElement, overwrite })`
- Seed resolution always precedes dynamic cache resolution.

- [ ] **Step 1: Write failing store reconciliation tests**

Start with a published conflicting v1, then reconcile to seed:

```js
const sameInput = {
  a: "水",
  b: "水",
  result: "水塘",
  emoji: "💧",
  comment: "两滴水先汇成池塘。",
  source: "seed",
  discoverer: null,
  playerId: "seed-player",
};
const active = await community.reconcileAuthoritativeFormula(sameInput);
assert.equal(active.version, 2);
assert.equal(active.result, "水塘");
assert.equal(active.source, "seed");
assert.equal(active.visibility, "hidden");
assert.equal((await community.get(`community_formula_${old.id}`)).status, "retired");
const repeated = await community.reconcileAuthoritativeFormula(sameInput);
assert.equal(repeated.id, active.id);
```

Assert the retired record was added to the negative-feedback index.

- [ ] **Step 2: Write failing game/cache tests**

Preload a stale dynamic `combo_<hash>` for a known seed pair and an active
conflicting formula. Combine the pair and assert:

```js
assert.equal(result.result, COMBINATIONS[normalizePair("水", "水")].result);
assert.equal(result.source, "seed");
assert.equal((await store.getCombination("水", "水")).result, result.result);
assert.equal((await community.combinationState("水", "水")).version, 2);
```

- [ ] **Step 3: Run selected tests and verify RED**

Run:

```bash
node --test tests-makers/community.test.mjs tests-makers/game-service.test.mjs
```

Expected: stale active v2/cache can shadow seed or reconciliation API is
missing.

- [ ] **Step 4: Refactor formula creation and implement reconciliation**

Extract a private `createFormula` method that accepts an explicit version
and keeps the deterministic ID:

```js
const id = (await sha256Hex(`${pair}:v${version}`)).slice(0, 32);
```

`reconcileAuthoritativeFormula`:

1. loads pointer and active formula;
2. returns it when result, emoji, normalized comment, and source already
   equal the authoritative input;
3. retires and hides a differing active formula, updates its timestamp, and
   records retirement;
4. creates or overwrites the deterministic next-version seed record;
5. updates the pointer;
6. records reproduction for the current player;
7. reads the pointer/record back and returns the winner.

- [ ] **Step 5: Add authoritative cache overwrite**

Extend `putCombination` options:

```js
{ rememberElement = true, overwrite = false } = {}
```

Return an existing record only when `existing?.result && !overwrite`.
When overwriting, preserve:

```js
hit_count: finiteInteger(existing?.hit_count),
```

and write the seed fields supplied by the caller.

- [ ] **Step 6: Make the game seed-first**

In `resolveCombination`, look up `COMBINATIONS[normalizePair(a,b)]` before
returning any dynamic cache regardless of formula version. During `combine`,
use `overwrite: source === "seed"` and call
`reconcileAuthoritativeFormula` for seed results; use `ensureFormula` for
dynamic results.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
node --test tests-makers/community.test.mjs tests-makers/game-service.test.mjs tests-makers/kv-store.test.mjs
```

Expected: all selected tests pass and repeated reconciliation remains one
active seed version.

- [ ] **Step 8: Commit Task 3**

```bash
git add edge-functions/_lib/community.js edge-functions/_lib/game-service.js edge-functions/_lib/kv-store.js tests-makers/community.test.mjs tests-makers/game-service.test.mjs
git commit -m "fix: reconcile authoritative seed formulas on Makers"
```

### Task 4: Community contract verification

**Files:**
- Modify: `docs/makers-development.md`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Documents: 500-item hot catalogue and eventual consistency
- Verifies: public API route/status/field parity

- [ ] **Step 1: Add one end-to-end router flow**

The test performs combine, publish, vote, list with pagination, detail,
admin login, and logout through `router.handle`, asserting each response
status and the stable fields `id`, `result`, `version`, `net_score`, and
`my_vote`.

- [ ] **Step 2: Run the router test and verify it passes**

Run:

```bash
node --test tests-makers/router.test.mjs
```

Expected: PASS. If it fails, fix production behavior rather than weakening
the assertions.

- [ ] **Step 3: Document the exact parity boundary**

Document that Makers sorts and paginates its complete 500-formula hot
catalogue, resolves detail directly by ID, reconciles seed formulas lazily,
and remains eventually consistent across edge nodes.

- [ ] **Step 4: Run community suites**

Run:

```bash
node --test tests-makers/community.test.mjs tests-makers/game-service.test.mjs tests-makers/router.test.mjs
python3 -m pytest tests/test_community.py tests/test_seed_reconciliation.py -q
git diff --check
```

Expected: all tests pass and whitespace check is clean.

- [ ] **Step 5: Commit Task 4**

```bash
git add docs/makers-development.md tests-makers/router.test.mjs
git commit -m "test: lock community runtime parity"
```
