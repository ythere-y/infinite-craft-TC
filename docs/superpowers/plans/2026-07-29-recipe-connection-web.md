# Recipe Connection Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every player-discovered recipe relationship as a subtle canvas connection whose strength reflects the recipe's most recently observed global combine count and caps at 40.

**Architecture:** FastAPI and Makers return a best-effort `hit_count` on each successful combine, and `app.js` stores that snapshot with the local recipe. A standalone `recipe-links.js` controller receives plain recipe and element snapshots and owns all SVG rendering, geometry, animation, cleanup, and CSS; the game never accesses SVG internals.

**Tech Stack:** Vanilla JavaScript, SVG, CSS custom properties/keyframes, FastAPI/Pydantic, SQLite, EdgeOne Makers KV, Node test runner, pytest, headless Chromium, Docker Compose.

## Global Constraints

- Work directly in the current checkout; do not create a worktree.
- Preserve unrelated dirty working-tree changes and stage only files changed by this feature.
- Draw links only for recipes already present in the player's `ic_recipes`.
- Draw the full Cartesian product for different input names and every unique `i < j` pair for equal input names.
- Do not impose a distance limit or a total-link cap.
- Refresh global popularity only when the player combines that recipe again; do not poll or batch-fetch counts.
- Use continuous strength interpolation with stages `1-2`, `3-7`, `8-19`, `20-39`, and `40+`; cap all visual growth at 40.
- Use result-depth rarity colors: common gray, uncommon green, rare blue, epic purple, and legendary gold.
- Stop flow animation under `prefers-reduced-motion: reduce` while retaining static strength differences.
- `recipe-links.js` must not read game `state`, `localStorage`, API responses, or recipe-book DOM.
- The stable controller API is `create(workspace)`, `sync({ recipes, elements })`, `scheduleGeometryUpdate(elements)`, `clear()`, and `destroy()`.
- Add no frontend runtime dependency and do not import React.

---

### Task 1: Return Approximate Global Hit Counts From FastAPI

**Files:**
- Modify: `tests/test_comments.py`
- Modify: `tests/test_icon_recipes.py`
- Modify: `backend/archive.py:121-157`
- Modify: `backend/db.py:128-135`
- Modify: `backend/main.py:99-118`
- Modify: `backend/main.py:392-585`

**Interfaces:**
- Consumes: normalized recipe key and an existing non-fallback combination archive row.
- Produces: `db.touch_hit(key: str, hit: dict) -> int` and `CombineResp.hit_count: int`.

- [ ] **Step 1: Write failing archive and response tests**

Extend `test_hit_only_sqlite_update_preserves_original_comment` so the hit update returns the persisted count:

```python
hit_count = archive.upsert_combination(
    key="甲 + 乙",
    result="",
    emoji="",
    source="",
    chain=None,
    increment_hit=True,
)
assert hit_count == 2
```

Update `prepare_cached_combine` with a deterministic counter:

```python
monkeypatch.setattr(main.db, "touch_hit", lambda key, hit: 7)
```

Update `prepare_dynamic_combine` in `tests/test_icon_recipes.py` with the
same isolated `touch_hit` stub so icon tests never write the real archive.

Then add:

```python
def test_cached_combine_returns_global_hit_snapshot(monkeypatch):
    main = prepare_cached_combine(monkeypatch, {
        "result": "项目",
        "emoji": "📦",
        "source": "llm",
        "chain": "",
        "comment": "稳定交付。",
    })

    response = asyncio.run(
        main.api_combine(
            main.CombineReq(a="甲", b="乙", discoverer="测试鹅")
        )
    )

    assert response.hit_count == 7
```

Add a fallback case whose `touch_hit` raises if called:

```python
def test_fallback_combine_does_not_record_global_hit(monkeypatch):
    main = prepare_cached_combine(monkeypatch, {
        "result": "未知产物",
        "emoji": "❓",
        "source": "fallback",
        "chain": "",
        "comment": "",
    })

    def forbidden_touch(*args, **kwargs):
        raise AssertionError("fallback must not increment popularity")

    monkeypatch.setattr(main.db, "touch_hit", forbidden_touch)
    response = asyncio.run(
        main.api_combine(
            main.CombineReq(a="未知甲", b="未知乙", discoverer="测试鹅")
        )
    )
    assert response.hit_count == 0
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
python3 -m pytest \
  tests/test_comments.py::test_hit_only_sqlite_update_preserves_original_comment \
  tests/test_comments.py::test_cached_combine_returns_global_hit_snapshot \
  tests/test_comments.py::test_fallback_combine_does_not_record_global_hit \
  -q
```

Expected: FAIL because archive writes return `None`, `CombineResp` has no
`hit_count`, and the combine route does not call `touch_hit`.

- [ ] **Step 3: Return the count from the archive write**

Change the archive signature to:

```python
def upsert_combination(
    key: str,
    result: str,
    emoji: str,
    source: str,
    chain: Optional[str],
    comment: str = "",
    increment_hit: bool = False,
) -> int:
```

After the existing UPSERT and before closing the connection, read the row in
the same `_lock` scope:

```python
row = con.execute(
    "SELECT hit_count FROM combinations WHERE key = ?",
    (key,),
).fetchone()
con.commit()
return max(1, int(row["hit_count"])) if row else 1
```

Existing callers may ignore the return value. The UPSERT must continue to
preserve the original result, emoji, source, chain, and comment on hit-only
updates.

- [ ] **Step 4: Make the cache helper return the count**

Change:

```python
def touch_hit(key: str, hit: Dict) -> int:
    return archive.upsert_combination(
        key=key,
        result=str(hit.get("result") or ""),
        emoji=str(hit.get("emoji") or "❓"),
        source=str(hit.get("source") or "seed"),
        chain=hit.get("chain") or None,
        comment=str(hit.get("comment") or ""),
        increment_hit=True,
    )
```

Do not write a Redis counter; SQLite remains the FastAPI popularity source.
Passing the resolved hit prevents an empty archive record if legacy cache
data has not been warmed into SQLite.

- [ ] **Step 5: Add the response field and best-effort update**

Add to `CombineResp`:

```python
hit_count: int = 0
```

Before returning a non-fallback result:

```python
hit_count = 0
if source != "fallback":
    try:
        hit_count = max(1, int(db.touch_hit(key, hit)))
    except Exception as exc:
        hit_count = 1
        print(
            f"[combine] event=hit_count_failed request_id={request_id} "
            f"error_type={type(exc).__name__}",
            flush=True,
        )
```

Pass `hit_count=hit_count` into `CombineResp`. A popularity failure must not
change the successful result or its status code.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_comments.py tests/test_icon_recipes.py -q
```

Expected: all comment, archive, and cached-combine tests pass.

- [ ] **Step 7: Commit the FastAPI contract**

```bash
git add -p backend/archive.py backend/db.py backend/main.py \
  tests/test_comments.py tests/test_icon_recipes.py
git diff --cached --check
git diff --cached --stat
git commit -m "feat: return recipe hit counts from fastapi"
```

---

### Task 2: Return The Same Hit Contract From Makers

**Files:**
- Modify: `tests-makers/router.test.mjs`
- Modify: `edge-functions/_lib/game-service.js:187-280`

**Interfaces:**
- Consumes: `store.putCombination(a, b, hit, { rememberElement: false })` and `store.incrementCombinationHit(a, b)`.
- Produces: Makers `/api/combine` JSON with `hit_count`, matching FastAPI semantics.

- [ ] **Step 1: Write a failing repeated-combine router test**

Import the store wrapper so fallback persistence can be inspected through its
public API:

```js
import { KvStore } from "../edge-functions/_lib/kv-store.js";
```

In the existing shared-KV router test, assert the first seed hit:

```js
assert.equal(combine.body.hit_count, 1);
```

Repeat the same combination through the same router:

```js
const repeated = await json(router, "/api/combine", {
  method: "POST",
  body: {
    a: "火",
    b: "水",
    discoverer: "测试鹅",
    session_id: "session-1",
  },
});
assert.equal(repeated.body.result, "蒸汽");
assert.equal(repeated.body.hit_count, 2);
```

Add a fallback test:

```js
test("fallback combines do not create popularity records", async () => {
  const kv = new FakeKV();
  const router = createRouter({
    kv,
    env: { APP_ENV: "test" },
    now: () => 1_700_000_000_000,
  });
  const fallback = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "不存在甲",
      b: "不存在乙",
      discoverer: "测试鹅",
      session_id: "fallback-session",
    },
  });

  assert.equal(fallback.body.source, "fallback");
  assert.equal(fallback.body.hit_count, 0);
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  assert.equal(
    await store.getCombination("不存在甲", "不存在乙"),
    null,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="combine|fallback" \
  tests-makers/router.test.mjs
```

Expected: FAIL because `game-service.js` does not persist/increment seed hits
and omits `hit_count`.

- [ ] **Step 3: Persist seed recipes and increment successful hits**

In `combine(input)`, initialize:

```js
let hitCount = 0;
```

Inside the existing `source !== "fallback"` branch, after resolving the hit,
record popularity without coupling it to formula publication:

```js
try {
  await store.putCombination(a, b, {
    result: hit.result,
    emoji: hit.emoji,
    comment,
    source,
    chain,
    ...(icon ? { icon } : {}),
  }, {
    rememberElement: false,
  });
  const counted = await store.incrementCombinationHit(a, b);
  hitCount = Math.max(1, Number(counted?.hit_count) || 1);
} catch {
  hitCount = 1;
}
```

`putCombination` is idempotent for dynamic records and creates the KV record
needed for a static seed recipe's first hit. The fallback branch must not call
either method.

- [ ] **Step 4: Return the normalized field**

Add to the returned object:

```js
hit_count: source === "fallback" ? 0 : hitCount,
```

Keep the JSON field name in snake case to match FastAPI.

- [ ] **Step 5: Run the Makers tests and verify GREEN**

Run:

```bash
npm test
```

Expected: all Makers tests pass, including repeat ordering and fallback
non-persistence.

- [ ] **Step 6: Commit the Makers contract**

```bash
git add -p edge-functions/_lib/game-service.js tests-makers/router.test.mjs
git diff --cached --check
git diff --cached --stat
git commit -m "feat: return recipe hit counts from makers"
```

---

### Task 3: Build The Replaceable Recipe-Link Module

**Files:**
- Create: `frontend/recipe-links.js`
- Create: `frontend/recipe-links.css`
- Modify: `tests/test_combine_feedback.py:14-115`
- Modify: `tests/test_combine_feedback.py` after the combine-impact browser tests

**Interfaces:**
- Consumes:

```ts
type RecipeSnapshot = {
  key: string;
  a: string;
  b: string;
  hit_count: number;
  depth: number;
};

type ElementSnapshot = {
  id: string | number;
  name: string;
  x: number;
  y: number;
};
```

- Produces:

```js
window.RECIPE_LINKS.create(workspace)
// => { sync, scheduleGeometryUpdate, clear, destroy }
```

- [ ] **Step 1: Load the standalone assets in the browser harness**

Add:

```python
RECIPE_LINKS_SOURCE = Path("frontend/recipe-links.js")
RECIPE_LINKS_CSS_SOURCE = Path("frontend/recipe-links.css")
```

Add an `include_recipe_links=False` option to `_run_browser`. When enabled,
append the JS source and CSS source without loading `app.js` or any game
state. Update the production stylesheet-order assertion after Task 4 to
expect the new CSS file.

- [ ] **Step 2: Write the failing module-isolation and graph tests**

Create a browser regression that calls only the public module:

```javascript
var workspace = document.getElementById("fixture");
workspace.style.cssText =
  "position:relative;width:800px;height:500px;overflow:hidden";
var controller = window.RECIPE_LINKS.create(workspace);
controller.sync({
  recipes: [
    { key: "A + B", a: "A", b: "B", hit_count: 8, depth: 5 },
    { key: "A + A", a: "A", b: "A", hit_count: 40, depth: 10 }
  ],
  elements: [
    { id: 1, name: "A", x: 100, y: 100 },
    { id: 2, name: "A", x: 180, y: 180 },
    { id: 3, name: "B", x: 500, y: 100 },
    { id: 4, name: "B", x: 560, y: 220 },
    { id: 5, name: "B", x: 620, y: 340 }
  ]
});
return new Promise(function (resolve) {
  requestAnimationFrame(function () {
    var links = workspace.querySelectorAll(".recipe-link");
    resolve({
      groups: links.length,
      basePaths: workspace.querySelectorAll(".recipe-link-base").length,
      flowPaths: workspace.querySelectorAll(".recipe-link-flow").length,
      selfLinks: workspace.querySelectorAll(
        ".recipe-link[data-recipe-key='A + A']"
      ).length,
      svgPointerEvents:
        getComputedStyle(workspace.querySelector(".recipe-links")).pointerEvents
    });
  });
});
```

Assert seven groups: six `A × B` links and one unique `A + A` pair. Assert
seven base paths, seven flow paths, one self-recipe link, and
`pointer-events: none`.

- [ ] **Step 3: Write failing strength, geometry, and cleanup tests**

Exercise counts `1, 3, 8, 20, 40, 400` and assert:

- width, opacity, glow, and speed strengthen monotonically from 1 through 40;
- count 400 exposes the same CSS variables as count 40;
- depth boundaries map to `common`, `uncommon`, `rare`, `epic`, and
  `legendary`;
- invalid counts normalize to 1 and invalid depth uses `common`;
- moving one element and calling `scheduleGeometryUpdate(elements)` changes
  only the related `d` attributes after one animation frame;
- `clear()` removes all `.recipe-link` nodes but retains the SVG;
- `destroy()` removes the SVG and cancels scheduled work.

Also assert the source contains no `localStorage`, `fetch(`, `state.`, or
recipe-book selectors.

Use one instance pair per count and return the module-owned variables:

```javascript
var controller = window.RECIPE_LINKS.create(workspace);
var recipes = [1, 3, 8, 20, 40, 400].map(function (hits, index) {
  return {
    key: "A" + index + " + B" + index,
    a: "A" + index,
    b: "B" + index,
    hit_count: hits,
    depth: [1, 3, 5, 7, 10, 10][index]
  };
});
var elements = [];
recipes.forEach(function (recipe, index) {
  elements.push(
    { id: "a" + index, name: recipe.a, x: 60, y: 50 + index * 55 },
    { id: "b" + index, name: recipe.b, x: 520, y: 70 + index * 55 }
  );
});
controller.sync({ recipes: recipes, elements: elements });
return new Promise(function (resolve) {
  requestAnimationFrame(function () {
    var groups = Array.from(workspace.querySelectorAll(".recipe-link"));
    var before = groups[0].querySelector("path").getAttribute("d");
    elements[0] = { id: "a0", name: "A0", x: 180, y: 160 };
    controller.scheduleGeometryUpdate(elements);
    requestAnimationFrame(function () {
      var rows = groups.map(function (group) {
        return {
          width: Number(group.style.getPropertyValue("--recipe-link-width")),
          opacity: Number(
            group.style.getPropertyValue("--recipe-link-opacity")
          ),
          glow: Number(group.style.getPropertyValue("--recipe-link-glow")),
          duration: Number(
            group.style.getPropertyValue("--recipe-link-duration")
          ),
          rarity: group.dataset.rarity
        };
      });
      var after = groups[0].querySelector("path").getAttribute("d");
      controller.clear();
      var afterClear = workspace.querySelectorAll(".recipe-link").length;
      controller.destroy();
      resolve({
        rows: rows,
        moved: before !== after,
        afterClear: afterClear,
        svgGone: workspace.querySelector(".recipe-links") === null
      });
    });
  });
});
```

Assert in Python:

```python
rows = actual["rows"]
assert [row["rarity"] for row in rows] == [
    "common", "uncommon", "rare", "epic", "legendary", "legendary",
]
assert [row["width"] for row in rows[:5]] == sorted(
    row["width"] for row in rows[:5]
)
assert [row["opacity"] for row in rows[:5]] == sorted(
    row["opacity"] for row in rows[:5]
)
assert [row["glow"] for row in rows[:5]] == sorted(
    row["glow"] for row in rows[:5]
)
assert [row["duration"] for row in rows[:5]] == sorted(
    (row["duration"] for row in rows[:5]), reverse=True
)
assert rows[4] == rows[5]
assert actual["moved"] is True
assert actual["afterClear"] == 0
assert actual["svgGone"] is True
```

- [ ] **Step 4: Run the focused browser tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_link" -q
```

Expected: FAIL because neither standalone asset nor controller exists.

- [ ] **Step 5: Implement immutable visual profiles**

In `recipe-links.js`, define local immutable rarity profiles using the same
depth boundaries as combine impacts:

```js
const RARITIES = Object.freeze([
  Object.freeze({ maxDepth: 2, name: "common", color: "#9AA6B2" }),
  Object.freeze({ maxDepth: 4, name: "uncommon", color: "#35C978" }),
  Object.freeze({ maxDepth: 6, name: "rare", color: "#3B82F6" }),
  Object.freeze({ maxDepth: 9, name: "epic", color: "#A855F7" }),
  Object.freeze({ maxDepth: Infinity, name: "legendary", color: "#F2B84B" }),
]);

const STRENGTH_STOPS = Object.freeze([
  Object.freeze({ hits: 1, width: .7, opacity: .10, glow: 0, duration: 10 }),
  Object.freeze({ hits: 3, width: .95, opacity: .17, glow: 1, duration: 9 }),
  Object.freeze({ hits: 8, width: 1.25, opacity: .26, glow: 3, duration: 7.5 }),
  Object.freeze({ hits: 20, width: 1.75, opacity: .39, glow: 6, duration: 5.5 }),
  Object.freeze({ hits: 40, width: 2.4, opacity: .56, glow: 10, duration: 3.8 }),
]);
```

Normalize hits to `[1, 40]` and linearly interpolate between surrounding
stops. Do not expose these objects to `app.js`.

- [ ] **Step 6: Implement graph expansion and stable curves**

Group element snapshots by name. For each recipe:

- different names: emit every left/right pair;
- equal names: emit only indices `i < j`;
- stable edge key: normalized recipe key plus sorted instance IDs;
- stable curve sign: derive from the edge key rather than current positions.

Generate a quadratic path:

```js
function curvePath(left, right, sign) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(48, Math.max(12, distance * .12)) * sign;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const controlX = (left.x + right.x) / 2 + normalX * bend;
  const controlY = (left.y + right.y) / 2 + normalY * bend;
  return `M ${left.x} ${left.y} Q ${controlX} ${controlY} ${right.x} ${right.y}`;
}
```

Reconcile keyed `<g class="recipe-link">` groups containing
`.recipe-link-base` and `.recipe-link-flow` paths. Set recipe key, hit count,
rarity, and interpolated CSS variables on the group.

- [ ] **Step 7: Implement lifecycle and frame batching**

`create(workspace)` creates one SVG with `workspace.prepend(svg)`, owns its edge map and latest element
snapshot, and returns only:

```js
Object.freeze({
  sync,
  scheduleGeometryUpdate,
  clear,
  destroy,
});
```

Use one pending `requestAnimationFrame` for geometry. Observe workspace size
with `ResizeObserver` when available and fall back to `window.resize`.
`destroy()` must disconnect both mechanisms and cancel the frame.

- [ ] **Step 8: Implement isolated CSS**

In `recipe-links.css`:

```css
.recipe-links {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  overflow: visible;
  pointer-events: none;
}

.recipe-link-base,
.recipe-link-flow {
  fill: none;
  stroke: var(--recipe-link-color);
  vector-effect: non-scaling-stroke;
}
```

Because the SVG is prepended to the workspace, existing canvas elements with
the same stacking level remain above it without any selector reaching into
`style.css`. Base paths use `--recipe-link-opacity` and
`--recipe-link-width`; flow paths use a short dash pattern, softer opacity,
`filter: drop-shadow(...)`, and `--recipe-link-duration`. Add
`body.ura-on .recipe-links { opacity: .82; }` for the existing night mode.

Under reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  .recipe-link-flow {
    animation: none;
    stroke-dashoffset: 0;
  }
}
```

- [ ] **Step 9: Run the focused tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_link" -q
```

Expected: all standalone graph, style, geometry, cleanup, and isolation tests
pass.

- [ ] **Step 10: Commit the standalone module**

```bash
git add \
  frontend/recipe-links.js \
  frontend/recipe-links.css
git add -p tests/test_combine_feedback.py
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add replaceable recipe link renderer"
```

---

### Task 4: Integrate Snapshots Without Coupling The Game

**Files:**
- Modify: `frontend/app.js:180-215`
- Modify: `frontend/app.js:519-565`
- Modify: `frontend/app.js:625-641`
- Modify: `frontend/app.js:844-870`
- Modify: `frontend/index.html:8-10`
- Modify: `frontend/index.html:157-161`
- Modify: `scripts/build-makers.mjs:10-25`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_combine_feedback.py:79-81`
- Modify: `tests/test_combine_feedback.py:1307-1321`

**Interfaces:**
- Consumes: `resp.hit_count`, `resp.depth`, `state.recipes`, and
  `state.onCanvas`.
- Produces: normalized snapshots passed to the Task 3 controller and
  persisted recipe records containing `hit_count` and `depth`.

- [ ] **Step 1: Write failing source-contract tests**

In `tests-makers/frontend.test.mjs`, assert:

```js
assert.match(html, /recipe-links\.css\?v=([^"]+)/);
assert.ok(html.indexOf("recipe-links.js") < html.indexOf("app.js"));
assert.match(app, /hit_count:\s*Math\.max\(1,/);
assert.match(app, /depth:\s*Number\(/);
assert.match(app, /recipeLinks\.sync\(\{\s*recipes,\s*elements\s*\}\)/s);
assert.match(app, /recipeLinks\.scheduleGeometryUpdate\(elements\)/);
```

Read `frontend/recipe-links.js` separately and assert it does not contain
`state.`, `ic_recipes`, `fetch(`, or selectors owned by the recipe book.

Update the Python asset-version test to include `recipe-links.css` and
`recipe-links.js`, require eight versioned URLs, and require one shared
version.

- [ ] **Step 2: Run frontend source tests and verify RED**

Run:

```bash
node tests-makers/frontend.test.mjs
python3 -m pytest \
  tests/test_combine_feedback.py::test_browser_harness_styles_follow_production_index_order \
  tests/test_combine_feedback.py::test_combine_feedback_assets_share_one_cache_version \
  -q
```

Expected: FAIL because production HTML and the game do not load or call the
module.

- [ ] **Step 3: Add a no-op-safe controller adapter**

Immediately after `state`, create a frozen fallback:

```js
const NOOP_RECIPE_LINKS = Object.freeze({
  sync() {},
  scheduleGeometryUpdate() {},
  clear() {},
  destroy() {},
});

const recipeLinks =
  window.RECIPE_LINKS?.create?.(workspace) || NOOP_RECIPE_LINKS;
```

Add snapshot helpers owned by the game:

```js
function recipeLinkSnapshots() {
  const recipes = state.recipes.map((recipe) => ({
    key: recipe.key,
    a: recipe.a,
    b: recipe.b,
    hit_count: Math.max(1, Number(recipe.hit_count) || 1),
    depth: Number(recipe.depth) || 0,
  }));
  const elements = state.onCanvas.map(({ id, name, x, y }) => ({
    id, name, x, y,
  }));
  return { recipes, elements };
}

function syncRecipeLinks() {
  const { recipes, elements } = recipeLinkSnapshots();
  recipeLinks.sync({ recipes, elements });
}

function moveRecipeLinks() {
  const { elements } = recipeLinkSnapshots();
  recipeLinks.scheduleGeometryUpdate(elements);
}
```

These are the only functions allowed to translate game state into the
renderer contract.

- [ ] **Step 4: Connect canvas lifecycle hooks**

- Call `syncRecipeLinks()` after adding an element in `spawnOnCanvas()`.
- Call `moveRecipeLinks()` after coordinates change in `moveCanvasEl()`.
- Call `syncRecipeLinks()` after removal in `removeCanvasEl()`.
- Let the reset loop remove elements normally, then call
  `recipeLinks.clear()` once the canvas is empty.
- Call `recipeLinks.destroy()` during `pagehide`.

Do not pass DOM nodes, API response objects, or the mutable `state` object to
the module.

- [ ] **Step 5: Persist popularity and depth snapshots**

Change the call to:

```js
rememberRecipe(src, dst, resultInfo, {
  hitCount: resp.hit_count,
  depth: resp.depth,
});
```

Change the function signature to:

```js
function rememberRecipe(leftInfo, rightInfo, resultInfo, meta = {}) {
```

Add to the persisted recipe:

```js
hit_count: Math.max(1, Number(meta.hitCount) || 1),
depth: Number.isFinite(Number(meta.depth))
  ? Math.max(0, Math.trunc(Number(meta.depth)))
  : 0,
```

After updating or inserting the recipe and persisting it, call
`syncRecipeLinks()`. Existing recipe rows automatically render with hit count
1 and neutral depth until recombined.

- [ ] **Step 6: Load and package the independent assets**

Add `/recipe-links.css` after `/style.css`, and load `/recipe-links.js`
immediately before `/app.js`. Bump every main-page asset query to one new
shared version.

Add both files to `REQUIRED_ENTRIES` in `scripts/build-makers.mjs`:

```js
"recipe-links.css",
"recipe-links.js",
```

- [ ] **Step 7: Run integration tests and verify GREEN**

Run:

```bash
node tests-makers/frontend.test.mjs
python3 -m pytest \
  tests/test_combine_feedback.py::test_browser_harness_styles_follow_production_index_order \
  tests/test_combine_feedback.py::test_combine_feedback_assets_share_one_cache_version \
  -q
npm run build
```

Expected: frontend contracts pass and the built `dist/` contains both
independent assets.

- [ ] **Step 8: Commit the game integration**

```bash
git add -p \
  frontend/app.js \
  frontend/index.html \
  scripts/build-makers.mjs \
  tests-makers/frontend.test.mjs \
  tests/test_combine_feedback.py
git diff --cached --check
git diff --cached --stat
git commit -m "feat: connect game snapshots to recipe links"
```

---

### Task 5: Verify Behavior And Refresh The Running Game

**Files:**
- Verify only: all feature files from Tasks 1-4
- Runtime: `docker-compose.yml`

**Interfaces:**
- Consumes: the complete FastAPI, Makers, standalone renderer, and game integration.
- Produces: a tested Docker service reachable at `http://21.214.53.194:8000/`.

- [ ] **Step 1: Run focused regression suites**

Run:

```bash
python3 -m pytest tests/test_comments.py -q
python3 -m pytest tests/test_combine_feedback.py -k "recipe_link" -q
node --test --test-name-pattern="combine|fallback" tests-makers/router.test.mjs
node tests-makers/frontend.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
python3 -m pytest -q
npm run build
git diff --check -- \
  backend/archive.py backend/db.py backend/main.py \
  edge-functions/_lib/game-service.js \
  frontend/recipe-links.js frontend/recipe-links.css \
  frontend/app.js frontend/index.html scripts/build-makers.mjs \
  tests/test_comments.py tests/test_icon_recipes.py \
  tests-makers/router.test.mjs tests-makers/frontend.test.mjs \
  tests/test_combine_feedback.py
```

Expected: every suite passes, Makers build succeeds, and the diff has no
whitespace errors.

- [ ] **Step 3: Rebuild and restart the service**

Run:

```bash
docker compose up -d --build --remove-orphans
docker compose ps
docker compose logs --tail=120 web
```

Expected: `redis` is healthy, `web` is running on `0.0.0.0:8000`, and logs
show no startup traceback.

- [ ] **Step 4: Verify public assets and API contract**

Run:

```bash
curl -fsS http://127.0.0.1:8000/ | rg "recipe-links\\.(css|js)"
curl -fsS http://21.214.53.194:8000/ | rg "recipe-links\\.(css|js)"
curl -fsSI http://21.214.53.194:8000/recipe-links.js
curl -fsSI http://21.214.53.194:8000/recipe-links.css
```

Perform one known combination twice through `/api/combine` with a disposable
session and assert the second numeric `hit_count` is greater than the first.

- [ ] **Step 5: Perform browser visual acceptance**

Open `http://21.214.53.194:8000/` at desktop and mobile widths. Use a local
test profile with several already-discovered recipes and duplicate input
elements, then verify:

- every valid duplicate pair is connected;
- an undiscovered pair has no line;
- the web remains behind element cards and never captures pointer input;
- dragging updates paths without lagging a frame or flipping curve direction;
- count 40 is visibly stronger than count 1 without obscuring labels;
- reduced-motion keeps static lines and stops the moving dash;
- the console has no errors.

Capture desktop and mobile screenshots for final inspection.

- [ ] **Step 6: Report exact verification evidence**

Report the test totals, build result, container status, public asset status,
observed hit-count increment, and screenshot findings. Do not claim the
service is updated until the public URL serves the new versioned assets.
