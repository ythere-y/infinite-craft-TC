# Wall Reactions and Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable per-element 👍/👎 reactions and synthesis comments to first-discovery cards, reuse the formula community’s signed anonymous identity, and expose reaction summaries and rankings on `/admin`.

**Architecture:** Keep formula-version voting and element voting as separate aggregates while sharing the existing signed `craft_player` identity. Extend first-discovery records with normalized comments and reaction counts, store one immutable element-vote marker per player and result, and return those fields through existing wall and protected admin APIs. Preserve behavior in both EdgeOne Makers KV and the local FastAPI/Redis/SQLite runtime.

**Tech Stack:** JavaScript ES2023 Edge Functions, EdgeOne Makers KV, native browser JavaScript/CSS, Python 3/FastAPI, Redis, SQLite, Node test runner, pytest.

## Global Constraints

- The anonymous account is the existing signed HttpOnly `craft_player` Cookie used by the formula community.
- Makers uses `playerIdentity()`; FastAPI uses `community_player()`.
- Makers prefers `SESSION_SECRET` and falls back to `ADMIN_TOKEN`; the wall vote endpoint returns HTTP 503 if neither is configured.
- One anonymous player may cast one immutable `up` or `down` reaction per element; switching and cancelling are forbidden.
- Existing formula-version voting remains switchable/cancellable and must not share element vote counts.
- Clearing the player Cookie or changing device creates a new anonymous account.
- Store only a SHA-256 player hash in element-vote keys/rows; never return it to the browser.
- Old first-discovery records return `DEFAULT_COMMENT`, `upvotes=0`, and `downvotes=0`.
- LLM-controlled comments must enter the DOM through `textContent`, never unescaped `innerHTML`.
- Makers KV uniqueness and counters are best effort because the platform is eventually consistent and has no transaction.
- Do not add frontend frameworks, databases, authentication providers, or runtime dependencies.
- Do not alter bounty, leaderboard, recipe modal, formula moderation, or formula feedback thresholds.
- Do not commit `.env`, credentials, `.edgeone/`, KV exports, SQLite data, or preview authorization URLs.

---

## File Structure

- Create `edge-functions/_lib/wall-reactions.js`: normalize first-record reaction fields and calculate admin summaries/rankings.
- Modify `edge-functions/_lib/kv-store.js`: persist first comments, immutable element-vote markers, counts, and all first-record copies.
- Modify `edge-functions/_lib/game-service.js`: pass the normalized synthesis comment into first-record creation.
- Modify `edge-functions/_lib/router.js`: expose the wall vote route, reuse signed player identity, and add admin reaction data.
- Create `backend/wall_reactions.py`: Python equivalent of normalization, player hashing, and admin aggregation.
- Modify `backend/archive.py`: migrate first records, add `first_votes`, and transact immutable local votes.
- Modify `backend/db.py`: mirror first comments/counts to Redis and restore them from SQLite.
- Modify `backend/main.py`: expose the local vote route and add the same admin response.
- Create `frontend/wall/reactions.js`: parse/persist browser display state and merge reaction responses/count refreshes.
- Modify `frontend/wall/wall.js`: render comments and reaction controls and submit votes without a client-supplied identity.
- Modify `frontend/wall/wall.css`: responsive comment and reaction styles.
- Modify `frontend/admin/index.html`: render four metrics and two Top 10 tables safely.
- Modify `scripts/build-makers.mjs`: require the new public wall helper in the build.
- Add focused tests under `tests-makers/` and `tests/`.
- Modify `README.md`: document the two voting scopes, anonymous identity, old-data defaults, and approximate Makers counts.

---

### Task 1: Shared Makers Reaction Normalization and Ranking

**Files:**
- Create: `edge-functions/_lib/wall-reactions.js`
- Create: `tests-makers/wall-reactions.test.mjs`

**Interfaces:**
- Produces: `normalizeFirstReaction(record) -> object`.
- Produces: `buildReactionDashboard(firsts, limit = 10) -> {reaction_summary, top_upvoted, top_controversial}`.
- Consumed by: `KvStore.publicFirst()` and `router.adminPayload()` in later tasks.

- [ ] **Step 1: Write failing domain tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReactionDashboard,
  normalizeFirstReaction,
} from "../edge-functions/_lib/wall-reactions.js";
import { DEFAULT_COMMENT } from "../edge-functions/_lib/comments.js";

test("legacy first rows receive safe reaction defaults", () => {
  assert.deepEqual(normalizeFirstReaction({
    result: "旧元素",
    emoji: "🗿",
    discoverer: "旧鹅",
  }), {
    result: "旧元素",
    emoji: "🗿",
    discoverer: "旧鹅",
    comment: DEFAULT_COMMENT,
    upvotes: 0,
    downvotes: 0,
  });
});

test("reaction dashboard calculates totals and stable top tens", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    result: `元素${index}`,
    emoji: "✨",
    comment: `点评${index}`,
    seq: index + 1,
    upvotes: index,
    downvotes: index % 4,
  }));
  const dashboard = buildReactionDashboard(rows);
  assert.deepEqual(dashboard.reaction_summary, {
    total_votes: 84,
    total_upvotes: 66,
    total_downvotes: 18,
    rated_elements: 11,
  });
  assert.equal(dashboard.top_upvoted.length, 10);
  assert.equal(dashboard.top_upvoted[0].result, "元素11");
  assert.equal(dashboard.top_controversial[0].controversy_score, 3);
  assert.ok(dashboard.top_controversial.every((row) => row.controversy_score > 0));
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests-makers/wall-reactions.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `wall-reactions.js`.

- [ ] **Step 3: Implement normalization and ranking**

```js
import { normalizeComment } from "./comments.js";

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function normalizeFirstReaction(record = {}) {
  return {
    ...record,
    comment: normalizeComment(record.comment),
    upvotes: count(record.upvotes),
    downvotes: count(record.downvotes),
  };
}

export function buildReactionDashboard(firsts = [], limit = 10) {
  const rows = firsts.map(normalizeFirstReaction);
  const totalUpvotes = rows.reduce((sum, row) => sum + row.upvotes, 0);
  const totalDownvotes = rows.reduce((sum, row) => sum + row.downvotes, 0);
  const publicRow = (row) => ({
    result: row.result,
    emoji: row.emoji || "✨",
    comment: row.comment,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
  });
  const topUpvoted = rows
    .filter((row) => row.upvotes > 0)
    .sort((left, right) =>
      right.upvotes - left.upvotes ||
      left.downvotes - right.downvotes ||
      Number(right.seq || 0) - Number(left.seq || 0))
    .slice(0, limit)
    .map(publicRow);
  const topControversial = rows
    .map((row) => ({
      ...row,
      controversy_score: Math.min(row.upvotes, row.downvotes),
    }))
    .filter((row) => row.controversy_score > 0)
    .sort((left, right) =>
      right.controversy_score - left.controversy_score ||
      (right.upvotes + right.downvotes) - (left.upvotes + left.downvotes) ||
      Number(right.seq || 0) - Number(left.seq || 0))
    .slice(0, limit)
    .map((row) => ({ ...publicRow(row), controversy_score: row.controversy_score }));
  return {
    reaction_summary: {
      total_votes: totalUpvotes + totalDownvotes,
      total_upvotes: totalUpvotes,
      total_downvotes: totalDownvotes,
      rated_elements: rows.filter((row) => row.upvotes + row.downvotes > 0).length,
    },
    top_upvoted: topUpvoted,
    top_controversial: topControversial,
  };
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests-makers/wall-reactions.test.mjs`

Expected: 2 tests pass.

- [ ] **Step 5: Commit the domain helper**

```bash
git add edge-functions/_lib/wall-reactions.js tests-makers/wall-reactions.test.mjs
git commit -m "feat: add wall reaction domain helpers"
```

---

### Task 2: Makers First-Record Comments and Immutable Vote Storage

**Files:**
- Modify: `edge-functions/_lib/kv-store.js:1-650`
- Modify: `edge-functions/_lib/game-service.js:130-180`
- Modify: `tests-makers/kv-store.test.mjs:80-180`
- Modify: `tests-makers/game-service.test.mjs:125-265`

**Interfaces:**
- Consumes: `normalizeFirstReaction(record)`.
- Changes: `KvStore.recordFirst(result, emoji, discoverer, comment)`.
- Produces: `KvStore.castFirstVote(result, playerId, direction)`.
- Produces result: `{status: "accepted"|"already_voted"|"missing", vote, upvotes, downvotes}`.

- [ ] **Step 1: Add failing storage tests**

Add tests that create a first record with a real comment, cast votes, and read through every public path:

```js
test("first records persist comments and immutable per-player votes", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  await store.recordFirst(
    "需求气球", "🎈", "点评鹅", "一开会，需求就自动膨胀。",
  );

  const accepted = await store.castFirstVote("需求气球", "p_one", "up");
  const repeated = await store.castFirstVote("需求气球", "p_one", "down");
  const second = await store.castFirstVote("需求气球", "p_two", "down");

  assert.deepEqual(accepted, {
    status: "accepted", vote: "up", upvotes: 1, downvotes: 0,
  });
  assert.deepEqual(repeated, {
    status: "already_voted", vote: "up", upvotes: 1, downvotes: 0,
  });
  assert.equal(second.status, "accepted");

  const page = await store.firstPage({ offset: 0, limit: 10 });
  assert.equal(page.items[0].comment, "一开会，需求就自动膨胀。");
  assert.equal(page.items[0].upvotes, 1);
  assert.equal(page.items[0].downvotes, 1);
  assert.deepEqual((await store.allFirsts())[0], page.items[0]);
});

test("wall votes reject unknown results and keep player ids out of keys", async () => {
  const kv = new FakeKV();
  const store = new KvStore(kv);
  assert.equal(
    (await store.castFirstVote("不存在", "p_secret", "up")).status,
    "missing",
  );
  assert.ok([...kv.values.keys()].every((key) => !key.includes("p_secret")));
});
```

Extend the game-service comment test to assert that `/combine`’s first record returns the same generated comment through `firstPage()`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests-makers/kv-store.test.mjs tests-makers/game-service.test.mjs`

Expected: FAIL because `castFirstVote` does not exist and `recordFirst` drops the comment.

- [ ] **Step 3: Implement first-record normalization and copy synchronization**

Import `normalizeFirstReaction`. Change `recordFirst` to store:

```js
const record = {
  result: name,
  emoji: cleanText(emoji) || "❓",
  discoverer: cleanText(discoverer) || "匿名鹅",
  comment: normalizeComment(comment),
  upvotes: 0,
  downvotes: 0,
  ts: this.timestamp(),
  seq: maxSeq + 1,
  claim_token: this.uniqueSuffix(),
  storage_key: key,
};
```

Make `publicFirst(record)` remove internal fields and call
`normalizeFirstReaction(publicRecord)`.

Add one synchronization boundary:

```js
async syncFirstCopies(canonicalKey, record) {
  const publicRecord = this.publicFirst(record);
  const snapshot = this.normalizeRecentSnapshot(
    await this.getJson(RECENT_KEY, { items: [] }),
  );
  snapshot.items = this.mergeRecent(snapshot.items, [publicRecord]);
  await Promise.all([
    this.putJson(canonicalKey, record),
    this.putIndexRecord("first", canonicalKey, record),
    this.putJson(this.firstFeedKey(record, canonicalKey), publicRecord),
    this.putJson(RECENT_KEY, snapshot),
  ]);
  return publicRecord;
}
```

Use this method after vote count changes. Keep the existing first-creation
canonical/index/feed/recent writes, now carrying the new fields. Do not change
ordering fields during votes.

- [ ] **Step 4: Implement immutable Makers vote markers**

```js
async castFirstVote(result, playerId, direction) {
  const name = cleanText(result);
  const canonicalKey = await entityKey("first", name);
  const record = await this.getJson(canonicalKey);
  if (!record) return { status: "missing" };
  const markerKey =
    `vote_${await sha256Hex(name)}_${await sha256Hex(cleanText(playerId))}`;
  const existing = await this.getJson(markerKey);
  const current = this.publicFirst(record);
  if (existing?.direction) {
    return {
      status: "already_voted",
      vote: existing.direction,
      upvotes: current.upvotes,
      downvotes: current.downvotes,
    };
  }
  const claim = {
    direction,
    ts: this.timestamp(),
    claim_token: this.uniqueSuffix(),
  };
  await this.putJson(markerKey, claim);
  const verified = await this.getJson(markerKey);
  if (verified?.claim_token !== claim.claim_token) {
    return {
      status: "already_voted",
      vote: verified?.direction || direction,
      upvotes: current.upvotes,
      downvotes: current.downvotes,
    };
  }
  record.upvotes = current.upvotes + (direction === "up" ? 1 : 0);
  record.downvotes = current.downvotes + (direction === "down" ? 1 : 0);
  const updated = await this.syncFirstCopies(canonicalKey, record);
  return {
    status: "accepted",
    vote: direction,
    upvotes: updated.upvotes,
    downvotes: updated.downvotes,
  };
}
```

The router validates direction, so keep the store focused on persistence.

- [ ] **Step 5: Pass comments from the game service**

Change the existing call to:

```js
const first = await store.recordFirst(
  hit.result,
  hit.emoji,
  discoverer,
  comment,
);
```

Do not change `CommunityStore.ensureFormula()` or formula vote counts.

- [ ] **Step 6: Run focused Makers tests and verify GREEN**

Run: `node --test tests-makers/kv-store.test.mjs tests-makers/game-service.test.mjs`

Expected: all storage, game service, old-data, and comment tests pass.

- [ ] **Step 7: Commit Makers persistence**

```bash
git add edge-functions/_lib/kv-store.js edge-functions/_lib/game-service.js tests-makers/kv-store.test.mjs tests-makers/game-service.test.mjs
git commit -m "feat: persist Makers wall reactions"
```

---

### Task 3: Makers Vote API, Shared Cookie Identity, and Admin Data

**Files:**
- Modify: `edge-functions/_lib/router.js:75-380`
- Modify: `tests-makers/router.test.mjs:1-280`

**Interfaces:**
- Consumes: `playerIdentity(request, env)`.
- Consumes: `KvStore.castFirstVote(result, playerId, direction)`.
- Consumes: `buildReactionDashboard(firsts)`.
- Produces: `POST /api/wall/vote`.
- Extends: `GET /api/admin/stats`.

- [ ] **Step 1: Write failing route and admin tests**

Set `SESSION_SECRET: "test-session-secret"` in `makeRouter()`. Add:

```js
test("wall votes set one shared anonymous cookie and are immutable", async () => {
  const router = makeRouter();
  await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "水", b: "火", discoverer: "测试鹅", session_id: "session-1",
    },
  });
  const first = await json(router, "/api/wall/vote", {
    method: "POST",
    body: { result: "蒸汽", direction: "up" },
  });
  const cookie = first.response.headers.get("set-cookie");
  assert.equal(first.body.ok, true);
  assert.match(cookie, /^craft_player=/);

  const token = cookie.split(";", 1)[0];
  const duplicate = await json(router, "/api/wall/vote", {
    method: "POST",
    headers: { cookie: token },
    body: { result: "蒸汽", direction: "down" },
  });
  assert.deepEqual(duplicate.body, {
    ok: false,
    reason: "already_voted",
    detail: "你已经评价过这个元素",
    result: "蒸汽",
    vote: "up",
    upvotes: 1,
    downvotes: 0,
  });
});

test("admin stats include reaction summary and two rankings", async () => {
  const router = makeRouter();
  // Create two first records and cast three votes through the public route.
  // Reuse Cookie A for only one vote per element and Cookie B for the second player.
  const admin = await json(router, "/api/admin/stats");
  assert.equal(admin.body.reaction_summary.total_votes, 3);
  assert.equal(admin.body.top_upvoted[0].result, "蒸汽");
  assert.ok(Array.isArray(admin.body.top_controversial));
});
```

Also test missing `result`, invalid `direction`, unknown result, and an env without
`SESSION_SECRET` or `ADMIN_TOKEN` returning 503.

- [ ] **Step 2: Run route tests and verify RED**

Run: `node --test tests-makers/router.test.mjs`

Expected: FAIL with HTTP 404 for `/api/wall/vote` and missing admin fields.

- [ ] **Step 3: Add the protected identity-backed wall route**

```js
if (path === "/api/wall/vote") {
  requireMethod(request, "POST");
  if (!cleanText(env.SESSION_SECRET || env.ADMIN_TOKEN)) {
    throw new HttpError(503, "匿名身份未配置：请设置 SESSION_SECRET 或 ADMIN_TOKEN");
  }
  const body = await readJson(request);
  const result = cleanText(body?.result);
  const direction = cleanText(body?.direction);
  if (!result) throw new HttpError(400, "result 不能为空");
  if (!["up", "down"].includes(direction)) {
    throw new HttpError(400, "direction 必须是 up 或 down");
  }
  const identity = await playerIdentity(request, env);
  await requireCommunityRate(identity.id, "wall_vote", 30);
  const voted = await store.castFirstVote(result, identity.id, direction);
  if (voted.status === "missing") {
    throw new HttpError(404, "首发元素不存在");
  }
  const responseBody = voted.status === "accepted"
    ? { ok: true, result, vote: voted.vote,
        upvotes: voted.upvotes, downvotes: voted.downvotes }
    : { ok: false, reason: "already_voted",
        detail: "你已经评价过这个元素", result, vote: voted.vote,
        upvotes: voted.upvotes, downvotes: voted.downvotes };
  return jsonResponse(responseBody, {
    headers: identity.setCookie ? { "set-cookie": identity.setCookie } : {},
  });
}
```

Keep formula routes unchanged.

- [ ] **Step 4: Add dashboard data to the existing admin payload**

Import `buildReactionDashboard` and merge:

```js
return {
  ...base,
  ...buildReactionDashboard(firsts),
  env: env.APP_ENV || "makers",
  nick_count: nickCount,
  firsts_total: firsts.length,
  top_discoverers: leaderboard.top,
  recent_firsts: firsts.slice(0, 15),
};
```

- [ ] **Step 5: Run route and community regressions**

Run: `node --test tests-makers/router.test.mjs tests-makers/community.test.mjs`

Expected: all wall, admin, signed Cookie, formula community, and moderation tests pass.

- [ ] **Step 6: Commit Makers API work**

```bash
git add edge-functions/_lib/router.js tests-makers/router.test.mjs
git commit -m "feat: expose Makers wall reactions"
```

---

### Task 4: FastAPI Reaction Domain and SQLite Migration

**Files:**
- Create: `backend/wall_reactions.py`
- Modify: `backend/archive.py:35-250`
- Create: `tests/test_wall_reactions.py`

**Interfaces:**
- Produces: `normalize_first_reaction(record) -> dict`.
- Produces: `reaction_dashboard(firsts, limit=10) -> dict`.
- Produces: `player_hash(player_id) -> str` and `result_hash(result) -> str`.
- Produces: `archive.cast_first_vote(result, voter_hash, direction) -> dict`.
- Produces: `archive.all_first_votes() -> list[{result_hash, voter_hash, direction}]`.

- [ ] **Step 1: Write failing migration and domain tests**

Create a legacy `first_discoveries` table in a temporary test database, run
`archive.init_archive()` twice, and assert the new columns/table:

```python
def test_archive_migrates_legacy_firsts_and_creates_vote_table(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    con = sqlite3.connect(tmp_path / "test.db")
    con.execute(
        "CREATE TABLE first_discoveries("
        "result TEXT PRIMARY KEY, emoji TEXT NOT NULL, "
        "discoverer TEXT NOT NULL, ts REAL NOT NULL)"
    )
    con.commit()
    con.close()

    archive.init_archive()
    archive.init_archive()

    con = archive._conn()
    columns = {
        row["name"]
        for row in con.execute("PRAGMA table_info(first_discoveries)")
    }
    assert {"comment", "upvotes", "downvotes"} <= columns
    assert con.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type='table' AND name='first_votes'"
    ).fetchone()
    con.close()
```

Add a vote test asserting the same `voter_hash` cannot switch direction and a
dashboard test matching Task 1’s totals/rankings.

- [ ] **Step 2: Run pytest and verify RED**

Run: `python3 -m pytest tests/test_wall_reactions.py -q`

Expected: FAIL because `backend.wall_reactions`, migration columns, and vote functions do not exist.

- [ ] **Step 3: Implement the Python reaction helper**

Mirror Task 1 exactly:

```python
from hashlib import sha256

from .comments import normalize_comment

def player_hash(player_id: str) -> str:
    return sha256(player_id.strip().encode("utf-8")).hexdigest()

def result_hash(result: str) -> str:
    return sha256(result.strip().encode("utf-8")).hexdigest()

def normalize_first_reaction(record: dict) -> dict:
    out = dict(record)
    out["comment"] = normalize_comment(out.get("comment"))
    out["upvotes"] = max(0, int(out.get("upvotes") or 0))
    out["downvotes"] = max(0, int(out.get("downvotes") or 0))
    return out
```

Implement `reaction_dashboard()` with the same filters and sort keys as
`buildReactionDashboard()` so both runtimes return identical JSON.

- [ ] **Step 4: Add idempotent SQLite schema migration**

Add default columns to the create statement, inspect
`PRAGMA table_info(first_discoveries)`, add each missing column separately, and
create:

```sql
CREATE TABLE IF NOT EXISTS first_votes (
  result TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
  ts REAL NOT NULL,
  PRIMARY KEY (result, voter_hash)
);
```

- [ ] **Step 5: Add transactional archive voting**

```python
def cast_first_vote(result: str, voter_hash: str, direction: str) -> dict:
    with _lock:
        con = _conn()
        try:
            con.execute("BEGIN IMMEDIATE")
            first = con.execute(
                "SELECT upvotes,downvotes FROM first_discoveries WHERE result=?",
                (result,),
            ).fetchone()
            if not first:
                con.rollback()
                return {"status": "missing"}
            existing = con.execute(
                "SELECT direction FROM first_votes "
                "WHERE result=? AND voter_hash=?",
                (result, voter_hash),
            ).fetchone()
            if existing:
                con.commit()
                return {
                    "status": "already_voted",
                    "vote": existing["direction"],
                    "upvotes": int(first["upvotes"]),
                    "downvotes": int(first["downvotes"]),
                }
            con.execute(
                "INSERT INTO first_votes VALUES (?, ?, ?, ?)",
                (result, voter_hash, direction, time.time()),
            )
            column = "upvotes" if direction == "up" else "downvotes"
            con.execute(
                f"UPDATE first_discoveries SET {column}={column}+1 WHERE result=?",
                (result,),
            )
            updated = con.execute(
                "SELECT upvotes,downvotes FROM first_discoveries WHERE result=?",
                (result,),
            ).fetchone()
            con.commit()
            return {
                "status": "accepted", "vote": direction,
                "upvotes": int(updated["upvotes"]),
                "downvotes": int(updated["downvotes"]),
            }
        finally:
            con.close()
```

The interpolated column is selected only from the validated two-value branch.
Extend `record_first_archive()` and `all_firsts()` to carry comment/counts, and
add `all_first_votes()` for Redis warm-up. Its SELECT joins no user data; it
returns `result_hash(result)`, `voter_hash`, and `direction`.

- [ ] **Step 6: Run the focused Python tests and verify GREEN**

Run: `python3 -m pytest tests/test_wall_reactions.py -q`

Expected: migration, uniqueness, normalization, and dashboard tests pass.

- [ ] **Step 7: Commit the local domain and archive**

```bash
git add backend/wall_reactions.py backend/archive.py tests/test_wall_reactions.py
git commit -m "feat: archive local wall reactions"
```

---

### Task 5: Redis Mirror, FastAPI Vote API, and Admin Parity

**Files:**
- Modify: `backend/db.py:130-330`
- Modify: `backend/main.py:85-285`
- Modify: `backend/main.py:410-505`
- Extend: `tests/test_wall_reactions.py`

**Interfaces:**
- Consumes: `wall_reactions.player_hash()` and `reaction_dashboard()`.
- Changes: `db.record_first(result, emoji, discoverer, comment)`.
- Produces: `db.cast_first_vote(result, player_id, direction)`.
- Produces: `POST /api/wall/vote`.
- Extends: `GET /api/admin/stats`.

- [ ] **Step 1: Add failing Redis and API tests**

Use a focused fake Redis supporting `hsetnx`, `hset`, `hgetall`, `get`, `set`,
`zadd`, and `zrevrange`. Assert:

```python
def test_db_vote_mirrors_archive_counts_and_blocks_switch(monkeypatch):
    fake = FakeReactionRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(
        archive,
        "cast_first_vote",
        lambda result, voter_hash, direction: {
            "status": "accepted",
            "vote": direction,
            "upvotes": 1,
            "downvotes": 0,
        },
    )
    result = db.cast_first_vote("需求气球", "p_one", "up")
    assert result["status"] == "accepted"
    assert fake.hashes["first:需求气球"]["upvotes"] == "1"
    assert all("p_one" not in key for key in fake.values)
```

Add async route tests by monkeypatching `community_player()` to return `"p_one"`
and `db.cast_first_vote()` to return accepted/duplicate/missing responses. Assert
the exact Makers-compatible JSON and status codes.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python3 -m pytest tests/test_wall_reactions.py -q`

Expected: FAIL because the db method, request model, route, and admin fields are missing.

- [ ] **Step 3: Extend Redis first records and warm-up**

Change `record_first()` to accept `comment`, store normalized
`comment/upvotes/downvotes`, and pass the comment to
`record_first_archive()`. Make `get_first()` and `recent_firsts()` pass records
through `normalize_first_reaction()`.

During `warm_up_from_archive()`:

```python
for row in archive.all_firsts():
    c.hset(
        f"first:{row['result']}",
        mapping={
            "emoji": row["emoji"],
            "discoverer": row["discoverer"],
            "comment": row.get("comment") or "",
            "upvotes": str(max(0, int(row.get("upvotes") or 0))),
            "downvotes": str(max(0, int(row.get("downvotes") or 0))),
            "ts": str(row["ts"]),
        },
    )
for vote in archive.all_first_votes():
    c.set(
        f"wallvote:{vote['result_hash']}:{vote['voter_hash']}",
        vote["direction"],
    )
```

- [ ] **Step 4: Add the db vote boundary**

Hash the player ID, call the SQLite transaction as the truth source, then mirror
the returned counts and marker to Redis:

```python
def cast_first_vote(result: str, player_id: str, direction: str) -> dict:
    voter = wall_reactions.player_hash(player_id)
    result_digest = wall_reactions.result_hash(result)
    marker = f"wallvote:{result_digest}:{voter}"
    client = get_client()
    claimed = client.set(marker, direction, nx=True)
    if not claimed:
        current = normalize_first_reaction(client.hgetall(f"first:{result}"))
        return {
            "status": "already_voted",
            "vote": client.get(marker),
            "upvotes": current["upvotes"],
            "downvotes": current["downvotes"],
        }
    try:
        outcome = archive.cast_first_vote(result, voter, direction)
    except Exception:
        client.delete(marker)
        raise
    if outcome["status"] == "missing":
        client.delete(marker)
        return outcome
    client.set(marker, outcome["vote"])
    client.hset(
        f"first:{result}",
        mapping={
            "upvotes": str(outcome["upvotes"]),
            "downvotes": str(outcome["downvotes"]),
        },
    )
    return outcome
```

Redis `SET NX` provides the hot-path gate. SQLite’s primary key remains the
durable uniqueness source after Redis loss or restart; if SQLite reports an
existing vote, its original direction replaces the temporary Redis marker.

- [ ] **Step 5: Add the FastAPI vote request and route**

```python
class WallVoteReq(BaseModel):
    result: str
    direction: str

@app.post("/api/wall/vote")
async def api_wall_vote(
    body: WallVoteReq,
    request: Request,
    response: Response,
):
    result = body.result.strip()
    if not result:
        raise HTTPException(400, "result 不能为空")
    if body.direction not in {"up", "down"}:
        raise HTTPException(400, "direction 必须是 up 或 down")
    player_id = community_player(request, response)
    voted = db.cast_first_vote(result, player_id, body.direction)
    if voted["status"] == "missing":
        raise HTTPException(404, "首发元素不存在")
    if voted["status"] == "already_voted":
        return {
            "ok": False, "reason": "already_voted",
            "detail": "你已经评价过这个元素", "result": result,
            "vote": voted["vote"], "upvotes": voted["upvotes"],
            "downvotes": voted["downvotes"],
        }
    return {
        "ok": True, "result": result, "vote": voted["vote"],
        "upvotes": voted["upvotes"], "downvotes": voted["downvotes"],
    }
```

Change the combine call to `db.record_first(result, emoji, who, comment)` and
include comment/counts in the SSE queue item.

- [ ] **Step 6: Add reaction dashboard fields to local admin stats**

Load all firsts once, use them for `recent_firsts`, and merge:

```python
all_firsts = db.recent_firsts(limit=max(1, firsts_total))
reaction_data = wall_reactions.reaction_dashboard(all_firsts)
return {
    "now": now_ts,
    "env": os.environ.get("APP_ENV", "dev"),
    **reaction_data,
    "recent_firsts": all_firsts[:15],
}
```

Retain every existing admin response field in the actual return object.

- [ ] **Step 7: Run local focused and community regression tests**

Run: `python3 -m pytest tests/test_wall_reactions.py tests/test_community.py -q`

Expected: all local vote, migration, signed identity, formula community, and admin tests pass.

- [ ] **Step 8: Commit local runtime parity**

```bash
git add backend/db.py backend/main.py tests/test_wall_reactions.py
git commit -m "feat: add FastAPI wall reactions"
```

---

### Task 6: Browser Reaction State Helper

**Files:**
- Create: `frontend/wall/reactions.js`
- Create: `tests-makers/wall-reactions-frontend.test.mjs`
- Modify: `scripts/build-makers.mjs:7-22`
- Modify: `tests-makers/build.test.mjs:5-22`

**Interfaces:**
- Produces: `readWallVotes(storage) -> object`.
- Produces: `saveWallVote(storage, result, direction)`.
- Produces: `mergeReactionCounts(existing, incoming) -> array`.
- Produces: `applyVoteResponse(item, response) -> object`.

- [ ] **Step 1: Write failing browser-helper tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVoteResponse,
  mergeReactionCounts,
  readWallVotes,
  saveWallVote,
} from "../frontend/wall/reactions.js";

test("wall vote display state survives malformed storage", () => {
  const storage = {
    value: "{broken",
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
  };
  assert.deepEqual(readWallVotes(storage), {});
  saveWallVote(storage, "需求气球", "up");
  assert.deepEqual(readWallVotes(storage), { "需求气球": "up" });
});

test("server reaction counts refresh existing cards without losing rows", () => {
  const merged = mergeReactionCounts(
    [{ result: "蒸汽", upvotes: 1, downvotes: 0, discoverer: "鹅" }],
    [{ result: "蒸汽", upvotes: 5, downvotes: 2 }],
  );
  assert.deepEqual(merged[0], {
    result: "蒸汽", upvotes: 5, downvotes: 2, discoverer: "鹅",
  });
  assert.equal(applyVoteResponse(merged[0], {
    vote: "down", upvotes: 5, downvotes: 3,
  }).downvotes, 3);
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run: `node --test tests-makers/wall-reactions-frontend.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure helper**

Use the fixed storage key `ic_wall_votes`; accept only `up`/`down`; clone rows
instead of mutating caller data. `mergeReactionCounts()` updates only
`comment/upvotes/downvotes` for matching results and keeps existing ordering and
metadata.

- [ ] **Step 4: Add the helper to Makers build assertions**

Add `"wall/reactions.js"` to both required file arrays. The recursive frontend
copy already copies the file; no build behavior change is needed.

- [ ] **Step 5: Run helper and build tests**

Run: `node --test tests-makers/wall-reactions-frontend.test.mjs tests-makers/build.test.mjs`

Expected: helper tests pass and `dist/wall/reactions.js` exists and is non-empty.

- [ ] **Step 6: Commit frontend state helper**

```bash
git add frontend/wall/reactions.js tests-makers/wall-reactions-frontend.test.mjs scripts/build-makers.mjs tests-makers/build.test.mjs
git commit -m "feat: add wall reaction browser state"
```

---

### Task 7: First-Wall Comment and Reaction Card UI

**Files:**
- Modify: `frontend/wall/wall.js:1-285`
- Modify: `frontend/wall/wall.css:150-430`
- Modify: `tests-makers/frontend.test.mjs:1-90`
- Extend: `tests-makers/wall-reactions-frontend.test.mjs`

**Interfaces:**
- Consumes: Task 6 helper functions.
- Calls: `POST /api/wall/vote` with `{result, direction}` only.
- Renders: `.first-comment`, `.first-reactions`, `.reaction-button`, and an `aria-live` card status.

- [ ] **Step 1: Add failing frontend contract tests**

Assert source requirements:

```js
test("wall cards render comments safely and never submit a client identity", async () => {
  const source = await readFile("frontend/wall/wall.js", "utf8");
  assert.match(source, /commentNode\\.textContent/);
  assert.match(source, /fetch\\("\\/api\\/wall\\/vote"/);
  assert.match(source, /JSON\\.stringify\\(\\{\\s*result,\\s*direction\\s*\\}\\)/);
  assert.doesNotMatch(source, /session_id[\\s\\S]{0,80}wall\\/vote/);
  assert.match(source, /aria-live/);
});
```

Extend helper tests for accepted and `already_voted` responses producing the
same locked local state.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `node --test tests-makers/frontend.test.mjs tests-makers/wall-reactions-frontend.test.mjs`

Expected: FAIL because wall cards have no comment/reaction controls.

- [ ] **Step 3: Render comment text and reaction controls**

Import Task 6 helpers. After the existing safe card shell is created:

```js
const commentNode = document.createElement("div");
commentNode.className = "first-comment";
commentNode.textContent = `“${String(item.comment || "")}”`;

const reactions = document.createElement("div");
reactions.className = "first-reactions";
const status = document.createElement("span");
status.className = "reaction-status";
status.setAttribute("aria-live", "polite");
```

Create both buttons with `document.createElement("button")`, set `type`,
`aria-label`, `aria-pressed`, and count spans through `textContent`. Never put
the comment or result into unescaped HTML.

- [ ] **Step 4: Add immutable vote submission**

On click, disable both buttons, call:

```js
const response = await fetch("/api/wall/vote", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ result, direction }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
```

For both `ok: true` and `reason: "already_voted"`, update counts, persist
`data.vote`, highlight that button, keep both disabled, and set status to
`"已评价"`. On network/5xx error, restore both buttons and show
`"提交失败，请重试"`.

- [ ] **Step 5: Merge poll count refreshes**

Before stopping at the known-row boundary, call `mergeReactionCounts()` with
the first polling page so already rendered recent cards receive new counts.
Keep `state.seen`, order, pagination offset, and newly discovered-item behavior
unchanged.

- [ ] **Step 6: Add responsive accessible CSS**

```css
.first-comment {
  min-height: 2.8em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.first-reactions { display: flex; gap: 8px; margin-top: 10px; }
.reaction-button { min-height: 44px; flex: 1; }
.reaction-button.selected { border-color: #4ECDC4; background: #E8FBF8; }
.reaction-status { min-height: 1.2em; font-size: 11px; }
```

Add dark/alternate theme rules only if the wall currently has that theme; do
not modify unrelated layout.

- [ ] **Step 7: Run wall and polling tests**

Run: `node --test tests-makers/frontend.test.mjs tests-makers/wall-reactions-frontend.test.mjs`

Expected: safe comment, request contract, local state, and count merge tests pass.

- [ ] **Step 8: Commit the first-wall UI**

```bash
git add frontend/wall/wall.js frontend/wall/wall.css tests-makers/frontend.test.mjs tests-makers/wall-reactions-frontend.test.mjs
git commit -m "feat: add reactions to first wall"
```

---

### Task 8: `/admin` Community Reaction Dashboard

**Files:**
- Modify: `frontend/admin/index.html:1-500`
- Modify: `tests-makers/frontend.test.mjs:50-110`

**Interfaces:**
- Consumes: `reaction_summary`, `top_upvoted`, and `top_controversial` from `/api/admin/stats`.
- Preserves: existing `ADMIN_TOKEN` prompt, 3-second polling, charts, rankings, and recent firsts.

- [ ] **Step 1: Add failing admin source tests**

```js
test("admin renders reaction metrics and safe ranking rows", async () => {
  const admin = await readFile("frontend/admin/index.html", "utf8");
  for (const id of [
    "total-upvotes", "total-downvotes", "total-votes", "rated-elements",
    "top-upvoted", "top-controversial",
  ]) {
    assert.match(admin, new RegExp(`id=["']${id}["']`));
  }
  assert.match(admin, /renderReactionRows/);
  assert.match(admin, /commentCell\\.textContent/);
  assert.match(admin, /近似实时/);
});
```

- [ ] **Step 2: Run the admin frontend test and verify RED**

Run: `node --test tests-makers/frontend.test.mjs`

Expected: FAIL because the six IDs and safe row renderer do not exist.

- [ ] **Step 3: Add four summary cards**

Add cards for total likes, dislikes, votes, and rated elements with the exact
IDs from Step 1. In `render(d)`:

```js
const summary = d.reaction_summary || {};
document.getElementById("total-upvotes").textContent =
  fmtNum(summary.total_upvotes || 0);
document.getElementById("total-downvotes").textContent =
  fmtNum(summary.total_downvotes || 0);
document.getElementById("total-votes").textContent =
  fmtNum(summary.total_votes || 0);
document.getElementById("rated-elements").textContent =
  fmtNum(summary.rated_elements || 0);
```

Label each subtitle as KV “近似实时” data.

- [ ] **Step 4: Add two safe Top 10 tables**

Create tables with IDs `top-upvoted` and `top-controversial`. Render rows with
DOM methods:

```js
function renderReactionRows(tableId, items, emptyText) {
  const body = document.querySelector(`#${tableId} tbody`);
  body.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty";
    cell.textContent = emptyText;
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement("tr");
    const values = [
      String(index + 1),
      item.emoji || "✨",
      item.result || "",
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const commentCell = document.createElement("td");
    commentCell.className = "reaction-comment";
    commentCell.textContent = item.comment || "";
    commentCell.title = item.comment || "";
    row.appendChild(commentCell);
    for (const value of [item.upvotes || 0, item.downvotes || 0]) {
      const cell = document.createElement("td");
      cell.className = "num";
      cell.textContent = fmtNum(value);
      row.appendChild(cell);
    }
    body.appendChild(row);
  });
}
```

Call it on every existing 3-second render. Clamp comment cells to two lines in
the existing inline stylesheet.

- [ ] **Step 5: Run admin frontend tests**

Run: `node --test tests-makers/frontend.test.mjs`

Expected: all protected-admin and reaction-dashboard source tests pass.

- [ ] **Step 6: Commit the admin dashboard**

```bash
git add frontend/admin/index.html tests-makers/frontend.test.mjs
git commit -m "feat: add reaction dashboard to admin"
```

---

### Task 9: Documentation and Full Verification

**Files:**
- Modify: `README.md:70-205`
- Modify only if behavior changed: `docs/superpowers/specs/2026-07-27-wall-reactions-and-comments-design.md`

**Interfaces:**
- Documents: element-vote API, signed anonymous identity, formula/element scope separation, defaults, admin fields, and eventual consistency.

- [ ] **Step 1: Update README contracts**

Add concrete JSON examples for:

```json
{
  "result": "需求气球",
  "emoji": "🎈",
  "comment": "一开会，需求就自动膨胀。",
  "upvotes": 12,
  "downvotes": 2
}
```

Document `POST /api/wall/vote`, immutable element voting, the shared signed
Cookie, the separate switchable formula voting behavior, `SESSION_SECRET`
falling back to `ADMIN_TOKEN`, `/admin` reaction cards/rankings, legacy
defaults, and Makers approximate counters.

- [ ] **Step 2: Run all Makers tests**

Run: `npm test`

Expected: every `tests-makers/*.test.mjs` test passes with no warnings or unhandled rejections.

- [ ] **Step 3: Run all required Python tests**

Run: `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`

Expected: all selected pytest tests pass.

- [ ] **Step 4: Run the static Makers build**

Run: `npm run build`

Expected: `Built EdgeOne Makers site in dist/` and all required entries, including
`dist/wall/reactions.js`, exist.

- [ ] **Step 5: Run the EdgeOne build validation**

Run: `npm run makers:build`

Expected: EdgeOne Makers build exits 0 and reports no Edge Function compilation errors.

- [ ] **Step 6: Inspect final changes**

Run:

```bash
git status --short
git diff --check
git diff --stat origin/main...HEAD
```

Expected: only intended source, test, plan/spec, and README changes; no `.env`,
credentials, runtime data, generated authorization URLs, or unrelated `CLAUDE.md`.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md docs/superpowers/specs/2026-07-27-wall-reactions-and-comments-design.md
git commit -m "docs: explain wall reactions"
```

- [ ] **Step 8: Perform browser acceptance**

Run the repository’s normal local workflow:

```bash
npm run dev
```

Verify:

1. A new browser reacts to one element and receives a signed `craft_player` Cookie.
2. The same browser cannot vote or switch that element again.
3. The same browser can vote on another element.
4. Formula-square voting still switches and cancels independently.
5. New first cards show the original synthesis comment.
6. Legacy cards show the default comment and zero counts.
7. Refresh restores the selected/locked button.
8. Another browser can cast a separate reaction.
9. `/admin` totals and both Top 10 tables match wall counts.
10. Empty and populated admin states refresh safely every three seconds.
11. A narrow mobile viewport keeps comments and both 44px controls readable.

Stop the local stack in a second terminal:

```bash
npm run dev:down
```

Do not push or deploy until the user explicitly requests that external action.
