# Score Level System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible KPI/performance-tier experience with an unlimited QQ-style score level made of stars, moons, suns, and crowns, including responsive topbar rendering and in-button upgrade animations.

**Architecture:** Keep cumulative score as the sole persisted value and derive level data with the same pure, integer-safe algorithm in Python, Edge JavaScript, and a browser helper. The application renders the compact home level and detailed score panel from that derived model; score flight, new-star, and base-four fusion effects run through a bounded topbar animation queue and never control persistence.

**Tech Stack:** Python 3/FastAPI, vanilla browser JavaScript and CSS, EdgeOne V8 JavaScript, Node test runner, pytest.

## Global Constraints

- Preserve existing scores without migration or reset; continue reading `ic_kpi`.
- Use `cost(n) = 300 + 20 × (n - 1)` and `threshold(n) = 10n² + 290n`.
- Use `4 🌟 = 1 🌙`, `4 🌙 = 1 🌞`, and `4 🌞 = 1 👑`.
- Crowns are unlimited; there is no topped state or additional tier above crowns.
- The home button shows only `等级` and the icon string, never cumulative score.
- The score panel may show total score and per-event gains, but never a next-level threshold or “还差多少分”.
- New-star and fusion effects stay inside the topbar level button and never block canvas interaction.
- Keep game-content uses of “KPI”, including the craftable element, recipes, and nickname word pool.
- Keep legacy storage and API names where compatibility requires them, but do not introduce new user-visible KPI copy.
- Preserve unrelated working-tree changes and stage only files owned by the current task.

---

## File Structure

- `backend/kpi.py`: Retains combination scoring/explosion rules and owns Python score-to-level derivation.
- `edge-functions/_lib/kpi.js`: Mirrors the Python domain contract for EdgeOne.
- `frontend/score-level.js`: New browser-only pure helper for score normalization, thresholds, level decomposition, labels, progress, and fusion steps.
- `backend/main.py` and `edge-functions/_lib/router.js`: Expose level rules and derived rank while keeping legacy score-write routes.
- `frontend/index.html`: Renames score UI, adds level-specific DOM targets, and loads the new helper.
- `frontend/app.js`: Uses `state.score`, renders the home level and score panel, and schedules effects.
- `frontend/effects.js`: Owns score flight and the bounded level-animation queue.
- `frontend/style.css`: Owns responsive level-button clipping, detailed panel layout, and animation visuals.
- `tests/test_kpi.py`, `tests-makers/domain.test.mjs`, `tests-makers/router.test.mjs`: Verify Python/Edge domain and API boundaries.
- `tests-makers/score-level.test.mjs`, `tests-makers/frontend.test.mjs`, `tests/test_combine_feedback.py`: Verify browser derivation, markup contracts, security, animation, and reduced motion.
- `README.md`, `backend/main.py`, `backend/kpi.py`, `reset.sh`, `docs/makers-development.md`: Update current feature terminology without changing craftable content.

---

### Task 1: Replace finite performance tiers with unlimited score-level domains

**Files:**
- Modify: `backend/kpi.py`
- Modify: `edge-functions/_lib/kpi.js`
- Modify: `tests/test_kpi.py`
- Modify: `tests-makers/domain.test.mjs`

**Interfaces:**
- Produces Python `level_threshold(units: int) -> int`.
- Produces Python `rank_for(total: int) -> dict`.
- Produces Edge `levelThreshold(units: number) -> number`.
- Produces Edge `rankFor(total: number) -> LevelRank`.
- `LevelRank` keys are `level_units`, `crowns`, `suns`, `moons`, `stars`, `icons`, `aria_label`, `progress`, `grade`, `emoji`, and `topped`.
- Preserves `score_for`/`scoreFor` and `should_explode`/`shouldExplode` unchanged.

- [ ] **Step 1: Replace the Python rank test with boundary and monotonicity tests**

```python
from backend import kpi


def test_score_level_uses_linear_star_costs_and_base_four_icons():
    assert kpi.level_threshold(0) == 0
    assert kpi.level_threshold(1) == 300
    assert kpi.level_threshold(4) == 1_280
    assert kpi.level_threshold(16) == 7_200
    assert kpi.level_threshold(64) == 59_520
    assert kpi.level_threshold(128) == 200_960

    assert kpi.rank_for(0)["icons"] == ""
    assert kpi.rank_for(300)["icons"] == "🌟"
    assert kpi.rank_for(1_280)["icons"] == "🌙"
    assert kpi.rank_for(7_200)["icons"] == "🌞"
    assert kpi.rank_for(59_520)["icons"] == "👑"
    assert kpi.rank_for(61_100)["icons"] == "👑🌟"
    assert kpi.rank_for(200_960)["icons"] == "👑👑"


def test_score_level_boundaries_are_exact_and_unlimited():
    for units in (1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024):
        floor = kpi.level_threshold(units)
        assert kpi.rank_for(floor - 1)["level_units"] == units - 1
        rank = kpi.rank_for(floor)
        assert rank["level_units"] == units
        assert rank["topped"] is False
        assert rank["progress"] == 0


def test_each_new_star_costs_more_than_the_previous_star():
    costs = [
        kpi.level_threshold(units) - kpi.level_threshold(units - 1)
        for units in range(1, 200)
    ]
    assert all(left < right for left, right in zip(costs, costs[1:]))


def test_invalid_scores_normalize_to_zero():
    assert kpi.rank_for(-1) == kpi.rank_for(0)
```

- [ ] **Step 2: Replace the Edge rank test with the same contract**

```js
import {
  levelThreshold,
  rankFor,
  scoreFor,
  shouldExplode,
} from "../edge-functions/_lib/kpi.js";

test("score level uses increasing star costs and unlimited base-four icons", () => {
  assert.equal(levelThreshold(0), 0);
  assert.equal(levelThreshold(1), 300);
  assert.equal(levelThreshold(4), 1_280);
  assert.equal(levelThreshold(16), 7_200);
  assert.equal(levelThreshold(64), 59_520);
  assert.equal(levelThreshold(128), 200_960);
  assert.equal(rankFor(300).icons, "🌟");
  assert.equal(rankFor(1_280).icons, "🌙");
  assert.equal(rankFor(7_200).icons, "🌞");
  assert.equal(rankFor(59_520).icons, "👑");
  assert.equal(rankFor(200_960).icons, "👑👑");
});

test("score-level boundaries do not cap at crowns", () => {
  for (const units of [1, 4, 16, 64, 65, 128, 1024]) {
    const floor = levelThreshold(units);
    assert.equal(rankFor(floor - 1).level_units, units - 1);
    assert.equal(rankFor(floor).level_units, units);
    assert.equal(rankFor(floor).progress, 0);
    assert.equal(rankFor(floor).topped, false);
  }
});
```

- [ ] **Step 3: Run the focused tests and confirm the old finite implementation fails**

Run:

```bash
python3 -m pytest tests/test_kpi.py -q
node --test tests-makers/domain.test.mjs
```

Expected: failures because `level_threshold`/`levelThreshold` do not exist and old ranks still contain绩效/瑞雪 tiers.

- [ ] **Step 4: Implement the Python integer-safe level model**

Replace the tier constants and rank helpers in `backend/kpi.py` with:

```python
BASE_STAR_COST = 300
STAR_COST_STEP = 20
MERGE_BASE = 4
LEVEL_WEIGHTS = (("👑", 64), ("🌞", 16), ("🌙", 4), ("🌟", 1))


def level_threshold(units: int) -> int:
    value = max(0, int(units))
    return value * BASE_STAR_COST + STAR_COST_STEP * value * (value - 1) // 2


def _level_units(total: int) -> int:
    score = max(0, int(total))
    low, high = 0, 1
    while level_threshold(high) <= score:
        high *= 2
    while low + 1 < high:
        middle = (low + high) // 2
        if level_threshold(middle) <= score:
            low = middle
        else:
            high = middle
    return low


def _breakdown(units: int) -> tuple[int, int, int, int, str]:
    remaining = units
    counts: list[int] = []
    icons: list[str] = []
    for icon, weight in LEVEL_WEIGHTS:
        count, remaining = divmod(remaining, weight)
        counts.append(count)
        if count:
            icons.append(icon * count)
    return counts[0], counts[1], counts[2], counts[3], "".join(icons)


def rank_for(total: int) -> dict:
    score = max(0, int(total))
    units = _level_units(score)
    crowns, suns, moons, stars, icons = _breakdown(units)
    floor = level_threshold(units)
    ceiling = level_threshold(units + 1)
    progress = (score - floor) / max(1, ceiling - floor)
    labels = [
        f"{crowns}个皇冠" if crowns else "",
        f"{suns}个太阳" if suns else "",
        f"{moons}个月亮" if moons else "",
        f"{stars}颗星星" if stars else "",
    ]
    aria_label = "、".join(label for label in labels if label) or "尚未获得星星"
    return {
        "level_units": units,
        "crowns": crowns,
        "suns": suns,
        "moons": moons,
        "stars": stars,
        "icons": icons,
        "aria_label": aria_label,
        "progress": progress,
        "grade": icons or "尚未获得星星",
        "emoji": icons[:1] or "🌟",
        "topped": False,
    }
```

Keep `CHAIN_SCORE`, `FIRST_DISCOVERY_BONUS`, `score_for`, and `should_explode` intact, changing only their module comments from “KPI” to “分数” where they describe the feature.

- [ ] **Step 5: Mirror the model in Edge JavaScript**

Replace finite tier constants and helpers in `edge-functions/_lib/kpi.js` with:

```js
export const BASE_STAR_COST = 300;
export const STAR_COST_STEP = 20;
export const MERGE_BASE = 4;
export const LEVEL_ICONS = Object.freeze(["👑", "🌞", "🌙", "🌟"]);

export function levelThreshold(rawUnits) {
  const units = Math.max(0, Math.trunc(Number(rawUnits) || 0));
  return units * BASE_STAR_COST
    + (STAR_COST_STEP * units * (units - 1)) / 2;
}

function levelUnits(score) {
  let low = 0;
  let high = 1;
  while (levelThreshold(high) <= score) high *= 2;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (levelThreshold(middle) <= score) low = middle;
    else high = middle;
  }
  return low;
}

export function rankFor(rawTotal) {
  const score = Math.max(0, Math.trunc(Number(rawTotal) || 0));
  const units = levelUnits(score);
  let remaining = units;
  const crowns = Math.floor(remaining / 64);
  remaining %= 64;
  const suns = Math.floor(remaining / 16);
  remaining %= 16;
  const moons = Math.floor(remaining / 4);
  const stars = remaining % 4;
  const icons = "👑".repeat(crowns)
    + "🌞".repeat(suns) + "🌙".repeat(moons) + "🌟".repeat(stars);
  const floor = levelThreshold(units);
  const ceiling = levelThreshold(units + 1);
  const labels = [
    crowns ? `${crowns}个皇冠` : "",
    suns ? `${suns}个太阳` : "",
    moons ? `${moons}个月亮` : "",
    stars ? `${stars}颗星星` : "",
  ].filter(Boolean);
  return {
    level_units: units,
    crowns,
    suns,
    moons,
    stars,
    icons,
    aria_label: labels.join("、") || "尚未获得星星",
    progress: (score - floor) / Math.max(1, ceiling - floor),
    grade: icons || "尚未获得星星",
    emoji: icons[0] || "🌟",
    topped: false,
  };
}
```

Clamp Edge input to `Number.MAX_SAFE_INTEGER` before threshold search if a larger numeric input arrives. Keep `scoreFor` and `shouldExplode` behavior unchanged.

- [ ] **Step 6: Run both domain suites**

Run:

```bash
python3 -m pytest tests/test_kpi.py -q
node --test tests-makers/domain.test.mjs
```

Expected: all tests pass, including existing scoring and explosion assertions.

- [ ] **Step 7: Commit only the domain files**

```bash
git add backend/kpi.py edge-functions/_lib/kpi.js tests/test_kpi.py tests-makers/domain.test.mjs
git commit -m "feat: add unlimited score levels"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated pre-existing path without changing its working-tree contents.

---

### Task 2: Expose score-level data through compatible APIs

**Files:**
- Modify: `backend/main.py`
- Modify: `edge-functions/_lib/router.js`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Consumes `rank_for(total)` and `rankFor(total)` from Task 1.
- Produces `GET /api/tiers` response `{tiers: [], level_rules: {...}}`.
- Produces unchanged `GET /api/rank?total=` and `GET /api/session/{sid}/rank` routes with the new rank keys.
- Produces `POST /api/session/score` as the preferred alias of legacy `POST /api/session/kpi`.
- Legacy `/api/session/kpi` continues to accept `{session_id, delta, reason}`.

- [ ] **Step 1: Add failing router assertions for rules, ranks, and the score alias**

Replace old tier expectations in `tests-makers/router.test.mjs` with:

```js
const tiers = await json(router, "/api/tiers");
assert.deepEqual(tiers.body, {
  tiers: [],
  level_rules: {
    base_star_cost: 300,
    star_cost_step: 20,
    merge_base: 4,
    icons: ["👑", "🌞", "🌙", "🌟"],
  },
});

const rank = await json(router, "/api/rank?total=59520");
assert.equal(rank.body.total, 59_520);
assert.equal(rank.body.icons, "👑");
assert.equal(rank.body.topped, false);
assert.ok(!("to_next" in rank.body));
assert.ok(!("next_floor" in rank.body));

const score = await json(router, "/api/session/score", {
  method: "POST",
  body: { session_id: "score-session", delta: 300, reason: "测试" },
});
assert.equal(score.body.total, 300);
```

Extend the existing legacy-route assertion to prove `/api/session/kpi` still returns a total.

- [ ] **Step 2: Run the Edge route tests and confirm they fail**

Run:

```bash
node --test tests-makers/router.test.mjs
```

Expected: failures on old tier payloads, missing `/api/session/score`, and old rank fields.

- [ ] **Step 3: Update FastAPI routes and request naming**

In `backend/main.py`:

```python
class ScoreReq(BaseModel):
    session_id: str
    delta: int
    reason: str


def _level_rules() -> dict:
    return {
        "base_star_cost": kpi.BASE_STAR_COST,
        "star_cost_step": kpi.STAR_COST_STEP,
        "merge_base": kpi.MERGE_BASE,
        "icons": [icon for icon, _weight in kpi.LEVEL_WEIGHTS],
    }


@app.get("/api/tiers")
async def api_tiers():
    return {"tiers": [], "level_rules": _level_rules()}


def _add_score(req: ScoreReq) -> dict:
    db.kpi_add(req.session_id, req.delta, req.reason)
    return {"ok": True, "total": db.kpi_total(req.session_id)}


@app.post("/api/session/score")
async def api_score(req: ScoreReq):
    return _add_score(req)


@app.post("/api/session/kpi")
async def api_kpi_legacy(req: ScoreReq):
    return _add_score(req)
```

Keep `api_rank` and `api_rank_for_total`, but update their comments to “分数等级” and let Task 1's `rank_for` determine the response. Do not re-add threshold fields.

- [ ] **Step 4: Mirror the route payloads and alias in EdgeOne**

In `edge-functions/_lib/router.js`, import Task 1 constants and return:

```js
if (path === "/api/tiers") {
  return jsonResponse({
    tiers: [],
    level_rules: {
      base_star_cost: BASE_STAR_COST,
      star_cost_step: STAR_COST_STEP,
      merge_base: MERGE_BASE,
      icons: LEVEL_ICONS,
    },
  });
}
```

Route both `/api/session/score` and `/api/session/kpi` through the existing `store.addKpi` persistence call. Preserve storage key names because they are compatibility internals.

- [ ] **Step 5: Run focused API tests**

Run:

```bash
node --test tests-makers/router.test.mjs
```

Expected: all pass; both preferred and legacy score routes work.

- [ ] **Step 6: Commit only API and route tests**

```bash
git add backend/main.py edge-functions/_lib/router.js tests-makers/router.test.mjs
git commit -m "feat: expose score level APIs"
```

Check staged paths first because these files already contain unrelated working-tree edits; stage only the task hunks with an explicit patch if whole-file staging would capture unrelated work.

---

### Task 3: Add a browser score-level helper and responsive home markup

**Files:**
- Create: `frontend/score-level.js`
- Create: `tests-makers/score-level.test.mjs`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/build.test.mjs`

**Interfaces:**
- Produces `window.SCORE_LEVEL.levelThreshold(units)`.
- Produces `window.SCORE_LEVEL.rankFor(score)`.
- Produces `window.SCORE_LEVEL.transitionSteps(beforeUnits, afterUnits)`.
- Produces DOM targets `#score-level-icons`, `#score-panel-total`, `#score-panel-level`, `#score-panel-progress-fill`, and `#score-panel-rules`.
- The helper has no DOM dependencies and is loaded before `effects.js` and `app.js`.

- [ ] **Step 1: Create failing browser-helper tests**

Create `tests-makers/score-level.test.mjs` using `node:vm` so the classic browser script remains production-compatible:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadScoreLevel() {
  const source = await readFile("frontend/score-level.js", "utf8");
  const window = {};
  vm.runInNewContext(source, { window, Number, Math, Object });
  return window.SCORE_LEVEL;
}

test("browser score levels match domain boundaries", async () => {
  const levels = await loadScoreLevel();
  assert.equal(levels.rankFor(300).icons, "🌟");
  assert.equal(levels.rankFor(1_280).icons, "🌙");
  assert.equal(levels.rankFor(7_200).icons, "🌞");
  assert.equal(levels.rankFor(59_520).icons, "👑");
  assert.equal(levels.rankFor(200_960).icons, "👑👑");
});

test("transition steps describe each base-four carry", async () => {
  const levels = await loadScoreLevel();
  assert.deepEqual(
    Array.from(levels.transitionSteps(3, 4), (step) => ({ ...step })),
    [
      { type: "gain", icon: "🌟" },
      { type: "merge", from: "🌟", to: "🌙" },
    ],
  );
  assert.deepEqual(
    Array.from(levels.transitionSteps(63, 64), (step) => ({ ...step })),
    [
      { type: "gain", icon: "🌟" },
      { type: "merge", from: "🌟", to: "🌙" },
      { type: "merge", from: "🌙", to: "🌞" },
      { type: "merge", from: "🌞", to: "👑" },
    ],
  );
});
```

- [ ] **Step 2: Add failing markup and stylesheet assertions**

In `tests-makers/frontend.test.mjs`, assert:

```js
assert.match(html, /<span id="score-level-icons"/);
assert.doesNotMatch(html, /id="kpi-value"/);
assert.match(html, />等级</);
assert.match(html, /分数记录/);
assert.match(html, /等级进度/);
assert.ok(html.indexOf("score-level.js") < html.indexOf("effects.js"));
assert.ok(html.indexOf("score-level.js") < html.indexOf("app.js"));
assert.match(styles, /\.score-level-viewport/);
assert.match(styles, /mask-image:\s*linear-gradient/);
assert.match(styles, /min-width:\s*0/);
assert.match(styles, /#btn-score[^}]*max-width:/s);
```

Add a build test asserting the generated Makers bundle contains and references `score-level.js`.

- [ ] **Step 3: Run helper, frontend, and build tests to confirm failure**

Run:

```bash
node --test tests-makers/score-level.test.mjs tests-makers/frontend.test.mjs tests-makers/build.test.mjs
```

Expected: failure because the helper and new DOM targets do not exist.

- [ ] **Step 4: Implement the pure browser helper**

Create `frontend/score-level.js` as an IIFE:

```js
(function (root) {
  "use strict";
  var BASE_STAR_COST = 300;
  var STAR_COST_STEP = 20;

  function normalizeScore(value) {
    var score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(score)));
  }

  function levelThreshold(value) {
    var units = Math.max(0, Math.trunc(Number(value) || 0));
    return units * BASE_STAR_COST
      + (STAR_COST_STEP * units * (units - 1)) / 2;
  }

  function levelUnits(score) {
    var low = 0;
    var high = 1;
    while (levelThreshold(high) <= score) high *= 2;
    while (low + 1 < high) {
      var middle = Math.floor((low + high) / 2);
      if (levelThreshold(middle) <= score) low = middle;
      else high = middle;
    }
    return low;
  }

  function rankFor(value) {
    var score = normalizeScore(value);
    var units = levelUnits(score);
    var remaining = units;
    var crowns = Math.floor(remaining / 64);
    remaining %= 64;
    var suns = Math.floor(remaining / 16);
    remaining %= 16;
    var moons = Math.floor(remaining / 4);
    var stars = remaining % 4;
    var icons = "👑".repeat(crowns)
      + "🌞".repeat(suns) + "🌙".repeat(moons) + "🌟".repeat(stars);
    var floor = levelThreshold(units);
    var ceiling = levelThreshold(units + 1);
    var labels = [
      crowns ? crowns + "个皇冠" : "",
      suns ? suns + "个太阳" : "",
      moons ? moons + "个月亮" : "",
      stars ? stars + "颗星星" : ""
    ].filter(Boolean);
    return {
      level_units: units,
      crowns: crowns,
      suns: suns,
      moons: moons,
      stars: stars,
      icons: icons,
      aria_label: labels.join("、") || "尚未获得星星",
      progress: (score - floor) / Math.max(1, ceiling - floor)
    };
  }

  function transitionSteps(beforeUnits, afterUnits) {
    var steps = [];
    for (var units = beforeUnits + 1; units <= afterUnits; units += 1) {
      steps.push({ type: "gain", icon: "🌟" });
      if (units % 4 === 0) steps.push({ type: "merge", from: "🌟", to: "🌙" });
      if (units % 16 === 0) steps.push({ type: "merge", from: "🌙", to: "🌞" });
      if (units % 64 === 0) steps.push({ type: "merge", from: "🌞", to: "👑" });
    }
    return steps;
  }

  root.SCORE_LEVEL = Object.freeze({
    BASE_STAR_COST: BASE_STAR_COST,
    STAR_COST_STEP: STAR_COST_STEP,
    levelThreshold: levelThreshold,
    rankFor: rankFor,
    transitionSteps: transitionSteps
  });
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 5: Replace score markup without disturbing unrelated scripts**

In `frontend/index.html`, change only the score feature:

```html
<button id="btn-score" class="btn-ghost score-level-button"
        title="打开分数记录" aria-label="等级，尚未获得星星"
        data-action-icon="score">
  <span class="action-slot" data-icon-action="score" aria-hidden="true"></span>
  <span class="action-label">等级</span>
  <span class="score-level-viewport">
    <span id="score-level-icons" class="score-level-icons"
          aria-hidden="true">尚未获得星星</span>
  </span>
</button>
```

Rename the overlay comment and panel strings to “分数”; replace the right pane with stable targets:

```html
<div class="score-panel-title">
  📈 分数记录 · 累计 <span id="score-panel-total">0</span> 分
  <span id="score-panel-level" class="score-panel-rank"></span>
</div>
```

Keep the history pane between the header and level pane unchanged. Replace the right pane contents with:

```html
<div class="pane-title">🏆 等级进度</div>
<div id="score-panel-level-detail" class="score-panel-level-detail">
  <div id="score-panel-full-icons" class="score-panel-full-icons"></div>
  <div class="tier-progress" aria-label="当前星级进度">
    <div id="score-panel-progress-fill" class="tier-progress-fill"></div>
  </div>
  <div id="score-panel-rules" class="score-panel-rules">
    4🌟 = 1🌙 · 4🌙 = 1🌞 · 4🌞 = 1👑
  </div>
</div>
```

Load `score-level.js` after `icon-system.js` and before `effects.js`/`app.js`. Bump all touched asset query versions together.

- [ ] **Step 6: Implement responsive complete-icon clipping**

In `frontend/style.css`, define:

```css
#btn-score {
  min-width: 0;
  max-width: min(34vw, 360px);
  overflow: hidden;
}
.score-level-viewport {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 88%, transparent 100%);
  mask-image: linear-gradient(90deg, #000 0, #000 88%, transparent 100%);
}
.score-level-icons {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
@media (max-width: 780px) {
  #btn-score { max-width: min(44vw, 210px); }
  #btn-score .action-slot { display: none; }
}
```

Preserve existing topbar breakpoints and add `min-width: 0` to the flex ancestors that must allow the level viewport to shrink.

- [ ] **Step 7: Add the helper to Makers' required output entries**

Add `"score-level.js"` to `REQUIRED_ENTRIES` in `scripts/build-makers.mjs`. The existing recursive `cp(FRONTEND, OUTPUT, { recursive: true })` already copies the file; the required entry makes a missing helper fail the production build.

- [ ] **Step 8: Run the focused browser/build tests**

Run:

```bash
node --test tests-makers/score-level.test.mjs tests-makers/frontend.test.mjs tests-makers/build.test.mjs
```

Expected: helper boundaries, markup order, responsive CSS, and build inclusion all pass.

- [ ] **Step 9: Commit the helper and layout slice**

```bash
git add frontend/score-level.js tests-makers/score-level.test.mjs frontend/index.html frontend/style.css tests-makers/frontend.test.mjs scripts/build-makers.mjs tests-makers/build.test.mjs
git commit -m "feat: render responsive score levels"
```

Use patch staging for files that contain pre-existing unrelated changes.

---

### Task 4: Render score state and the detailed panel from the browser helper

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_combine_feedback.py`

**Interfaces:**
- Consumes `window.SCORE_LEVEL.rankFor(score)` and `transitionSteps`.
- Produces `renderHomeLevel(rank)`, `renderScorePanel()`, and `animateScore(delta, sourceEl)`.
- Calls `window.EFFECTS.animateScoreGain(...)`, implemented in Task 5; uses a no-effect fallback until then.
- Continues persisting the numeric total under `ic_kpi`.

- [ ] **Step 1: Add failing source-contract assertions for score naming and rendering**

In `tests-makers/frontend.test.mjs`, add:

```js
assert.match(app, /score:\s*Number\(localStorage\.getItem\("ic_kpi"\)/);
assert.doesNotMatch(app, /state\.kpi\b/);
assert.match(app, /function renderHomeLevel\(rank\)/);
assert.match(app, /SCORE_LEVEL\.rankFor\(state\.score\)/);
assert.match(app, /scoreLevelIconsEl\.textContent\s*=\s*rank\.icons/);
assert.match(app, /progressFill\.style\.width\s*=/);
assert.doesNotMatch(app, /还差/);
assert.doesNotMatch(app, /next_floor/);
assert.doesNotMatch(app, /all_tiers/);
```

Keep assertions proving score-history rows render the numeric `gained` value.

- [ ] **Step 2: Add a browser-security regression for long level text**

Extend `tests/test_combine_feedback.py` with a DOM harness that sets an intentionally hostile score label and proves rendering uses `textContent`:

```js
window.SCORE_LEVEL.rankFor = function () {
  return {
    level_units: 1,
    icons: '<img id="level-xss" src=x onerror="window.__xss=1">',
    aria_label: "测试等级",
    progress: 0.5
  };
};
// Initialize the app, then assert:
// document.querySelector("#level-xss") === null
// document.querySelector("#score-level-icons").textContent includes "<img"
// window.__xss !== 1
```

- [ ] **Step 3: Run focused tests and confirm old KPI rendering fails**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: failures on `state.kpi`, old tier rendering, and missing home level renderer.

- [ ] **Step 4: Rename the in-memory score state while preserving storage**

At the top of `frontend/app.js`:

```js
const scoreLevelIconsEl = $("#score-level-icons");
const scoreDeltaEl = $("#kpi-delta"); // legacy DOM id retained only if renaming risks CSS breakage
```

In the existing `state` object, replace only its `kpi` property with:

```js
score: Number(localStorage.getItem("ic_kpi") || 0),
```

Replace every score-feature `state.kpi` access with `state.score`. Do not rename `kpi_delta` response fields in this task; those are server compatibility fields used by existing combine responses.

- [ ] **Step 5: Replace tier loading and icon rendering with pure level rendering**

Remove `TIERS`, `loadTiers`, `tierAt`, `starsBreakdown`, `renderTierIcon`, and `/api/tiers` startup fetching. Initialize with `await loadElements()` and:

```js
function currentLevel() {
  return window.SCORE_LEVEL.rankFor(state.score);
}

function renderHomeLevel(rank = currentLevel()) {
  scoreLevelIconsEl.textContent = rank.icons || "尚未获得星星";
  const label = `等级，${rank.aria_label}`;
  $("#btn-score").setAttribute("aria-label", label);
  $("#btn-score").title = `${label}；点击打开分数记录`;
}
```

Call `renderHomeLevel()` during startup and after every score mutation.

- [ ] **Step 6: Replace the tier pane with a number-free level detail**

Refactor `renderScorePanel()` so it:

```js
const rank = currentLevel();
$("#score-panel-total").textContent = state.score;
$("#score-panel-level").textContent = rank.icons || "尚未获得星星";
$("#score-panel-full-icons").textContent = rank.icons || "尚未获得星星";
$("#score-panel-full-icons").setAttribute("aria-label", rank.aria_label);
$("#score-panel-progress-fill").style.width =
  `${Math.max(0, Math.min(100, rank.progress * 100))}%`;
```

Delete the `/api/rank` request and finite tier list rendering. Preserve history rendering, including each row's exact `+${event.gained}` text.

- [ ] **Step 7: Prepare score mutation for Task 5's animation API**

Replace `animateKpi` with:

```js
function animateScore(delta, sourceEl) {
  const start = state.score;
  const target = start + delta;
  const before = window.SCORE_LEVEL.rankFor(start);
  const after = window.SCORE_LEVEL.rankFor(target);
  state.score = target;
  localStorage.setItem("ic_kpi", String(target));
  renderHomeLevel(after);

  window.EFFECTS?.animateScoreGain?.({
    source: sourceEl,
    target: $("#btn-score"),
    delta,
    before,
    after,
    steps: window.SCORE_LEVEL.transitionSteps(
      before.level_units,
      after.level_units
    ),
    renderFinal: () => renderHomeLevel(after)
  });

  scoreDeltaEl.textContent = `+${delta} 分`;
  scoreDeltaEl.classList.add("show");
  clearTimeout(animateScore._timer);
  animateScore._timer = setTimeout(
    () => scoreDeltaEl.classList.remove("show"),
    1_800
  );
}
```

Change the combine call site to `animateScore(gained, newRec.el)`. Rendering the final level before effects guarantees correctness even when Task 5 is unavailable or interrupted.

- [ ] **Step 8: Run frontend and browser regression tests**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: all score rendering and security tests pass; animation-specific assertions may remain pending until Task 5.

- [ ] **Step 9: Commit app rendering**

```bash
git add frontend/app.js frontend/style.css tests-makers/frontend.test.mjs tests/test_combine_feedback.py
git commit -m "feat: show score levels without thresholds"
```

Patch-stage only owned hunks because all four paths already have unrelated modifications.

---

### Task 5: Add legible score flight and in-button level fusion queue

**Files:**
- Modify: `frontend/effects.js`
- Modify: `frontend/style.css`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_combine_feedback.py`

**Interfaces:**
- Consumes the `animateScoreGain` payload produced by Task 4.
- Produces `EFFECTS.animateScoreGain({source, target, delta, before, after, steps, renderFinal})`.
- Keeps `EFFECTS.flyScore(source, target, delta)` as a compatibility wrapper if existing tests or callers still use it.
- Every queue entry settles with final level rendering even if its target disconnects.

- [ ] **Step 1: Add failing animation contract assertions**

In `tests-makers/frontend.test.mjs`, assert:

```js
assert.match(effects, /EFFECTS\.animateScoreGain\s*=\s*function/);
assert.match(effects, /score-animation-queue/);
assert.match(effects, /level-gain-star/);
assert.match(effects, /level-fusion/);
assert.match(effects, /prefersReducedMotion\(\)/);
assert.match(styles, /@keyframes level-star-born/);
assert.match(styles, /@keyframes level-fuse/);
assert.match(styles, /\.score-flight[^}]*animation-duration:\s*1\.1s/s);
```

- [ ] **Step 2: Add behavioral DOM tests for queue order and reduced motion**

Extend `tests/test_combine_feedback.py` to load `effects.js` with a fake target that records appended children and animation classes:

```js
var calls = [];
window.matchMedia = function () { return { matches: false }; };
window.EFFECTS.animateScoreGain({
  source: source,
  target: target,
  delta: 90,
  before: { level_units: 63 },
  after: { level_units: 64 },
  steps: [
    { type: "gain", icon: "🌟" },
    { type: "merge", from: "🌟", to: "🌙" },
    { type: "merge", from: "🌙", to: "🌞" },
    { type: "merge", from: "🌞", to: "👑" }
  ],
  renderFinal: function () { calls.push("final"); }
});
```

Assert the observed order is gain, moon merge, sun merge, crown merge, final. In a second case set `matches: true` and assert no particle/fusion nodes are appended, the persistent text is `+90 分`, and `renderFinal` still runs.

- [ ] **Step 3: Run animation tests and confirm failure**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: failure because `animateScoreGain`, queue classes, and level keyframes are missing.

- [ ] **Step 4: Implement a single global score animation queue**

In `frontend/effects.js`, add:

```js
const scoreAnimationQueue = [];
let scoreAnimationRunning = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueScoreAnimation(job) {
  scoreAnimationQueue.push(job);
  if (!scoreAnimationRunning) drainScoreAnimations();
}

async function drainScoreAnimations() {
  scoreAnimationRunning = true;
  while (scoreAnimationQueue.length) {
    const job = scoreAnimationQueue.shift();
    try {
      await runScoreAnimation(job);
    } finally {
      job.renderFinal?.();
    }
  }
  scoreAnimationRunning = false;
}
```

Do not disable pointer events on the workspace or await this queue from the combine handler.

- [ ] **Step 5: Implement score flight with longer readable residue**

Refactor the existing flight to:

- Use `textContent = "+" + String(delta) + " 分"`.
- Fly for `1.1s`.
- Add `.score-gain-residue` inside or adjacent to the target after arrival.
- Keep residue fully opaque for `900ms`, then fade it over `500ms`.
- Remove all transient nodes in `finally`/timeout cleanup.
- Return a promise that settles after arrival, not after the full residue fade.

Keep `EFFECTS.flyScore` as a wrapper returning that promise.

- [ ] **Step 6: Implement topbar-only gain and fusion stages**

`runScoreAnimation(job)` must:

1. Call score flight.
2. If reduced motion is active, add `score-receive`, wait `450ms`, remove it, and return.
3. If `job.steps` is empty, play the same receive highlight and return.
4. Create one `.score-level-effect-layer` inside `job.target`; this layer uses `position:absolute; inset:0; overflow:hidden`.
5. For each `gain` step, append a text-only `.level-gain-star` containing `🌟`.
6. For each `merge` step, append four `.level-fusion-source` nodes containing `step.from` and one initially hidden `.level-fusion-result` containing `step.to`.
7. Apply `level-star-born` and `level-fuse` classes in order, remove stage nodes after each phase, and shorten later phases when a job has more than four steps.
8. Cap one job's animated phase at roughly `4.5s`; if the cap is reached, skip remaining visual phases and call `renderFinal`.

All coordinates must be relative to the button; no star/moon/sun/crown upgrade node may be appended to `document.body`.

- [ ] **Step 7: Add scoped CSS animations**

In `frontend/style.css`:

```css
#btn-score { position: relative; }
.score-level-effect-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
}
.level-gain-star {
  position: absolute;
  right: 10px;
  top: 50%;
  animation: level-star-born .72s ease-out both;
}
.level-fusion-source {
  position: absolute;
  left: 50%;
  top: 50%;
  animation: level-fuse .62s cubic-bezier(.3,.7,.2,1) both;
}
.level-fusion-result {
  position: absolute;
  left: 50%;
  top: 50%;
  animation: level-fusion-result .58s ease-out both;
}
@keyframes level-star-born {
  from { opacity: 0; transform: translate(14px,-50%) scale(.25) rotate(-45deg); }
  55% { opacity: 1; transform: translate(0,-50%) scale(1.25) rotate(8deg); }
  to { opacity: 1; transform: translate(0,-50%) scale(1) rotate(0); }
}
@keyframes level-fuse {
  from { opacity: 1; transform: translate(var(--fusion-x),var(--fusion-y)) scale(1); }
  to { opacity: 0; transform: translate(-50%,-50%) scale(.2) rotate(160deg); }
}
```

Add the four source offsets with `:nth-child`, result glow, score residue, and a `prefers-reduced-motion` rule that disables all score/level keyframes.

- [ ] **Step 8: Run focused animation tests**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: all pass, including XSS-safe score text, queue order, bounded cleanup, and reduced motion.

- [ ] **Step 9: Commit the effects slice**

```bash
git add frontend/effects.js frontend/style.css tests-makers/frontend.test.mjs tests/test_combine_feedback.py
git commit -m "feat: animate score level fusion"
```

Patch-stage task hunks only.

---

### Task 6: Complete terminology cleanup and full regression

**Files:**
- Modify: `README.md`
- Modify: `reset.sh`
- Modify: `docs/makers-development.md`
- Modify: `backend/main.py`
- Modify: `backend/kpi.py`
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`
- Modify: `edge-functions/_lib/game-service.js`
- Modify: `edge-functions/_lib/kv-store.js`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes all completed feature behavior from Tasks 1–5.
- Produces current documentation and comments that distinguish visible “分数/等级” from legacy `kpi_*` compatibility keys.
- Does not rename persisted KV keys, response compatibility fields, craftable content, recipes, or nickname words.

- [ ] **Step 1: Add a targeted visible-copy regression**

In `tests-makers/frontend.test.mjs`, strip HTML comments and assert:

```js
const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, "");
assert.doesNotMatch(visibleHtml, />[^<]*KPI[^<]*</);
assert.doesNotMatch(visibleHtml, /绩效|瑞雪|段位路径|还差\s*\d+\s*分/);
assert.match(visibleHtml, /分数记录/);
assert.match(visibleHtml, /等级进度/);
assert.match(visibleHtml, /4🌟\s*=\s*1🌙/);
```

Do not scan seed JSON or nickname modules; their KPI content is intentionally retained.

- [ ] **Step 2: Run the copy test and inventory remaining feature terminology**

Run:

```bash
node --test tests-makers/frontend.test.mjs
rg -n "KPI|绩效|瑞雪|段位" README.md reset.sh docs/makers-development.md backend/main.py backend/kpi.py frontend/index.html frontend/app.js frontend/style.css edge-functions/_lib/game-service.js edge-functions/_lib/kv-store.js
```

Expected: the test identifies remaining visible copy; `rg` also finds compatibility identifiers that must be documented rather than renamed.

- [ ] **Step 3: Update current documentation and comments**

Make these exact semantic changes:

- README feature list: “打工人 KPI、绩效评级与结算卡” → “逐步成长的分数与 QQ 星级系统”.
- README local-data sentence: “昵称和 KPI” → “昵称和分数”.
- README scoring section heading: “KPI 按配方 chain 计分” → “分数按配方 chain 累积”.
- Replace the finite performance-grade table with the four merge rules and state that each next star costs progressively more, without listing thresholds.
- `reset.sh` destructive confirmation: “KPI” → “分数记录”.
- `docs/makers-development.md`: user-facing prose says “分数”; retain literal ``kpi_*`` when naming existing KV keys.
- Backend/Edge comments use “legacy kpi key/field” only when explaining compatibility.
- Frontend comments and CSS section headings use “分数” or “等级”.

- [ ] **Step 4: Run JavaScript tests**

Run:

```bash
npm test
```

Expected: exit 0.

- [ ] **Step 5: Run required Python tests**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: exit 0.

- [ ] **Step 6: Run the browser-feedback suite separately**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: exit 0. If the environment lacks the required browser runtime, report the exact missing dependency and retain passing Node DOM-equivalent coverage; do not claim this suite passed.

- [ ] **Step 7: Run the production frontend build**

Run:

```bash
npm run build
```

Expected: exit 0 and generated output includes `score-level.js`.

- [ ] **Step 8: Check diffs and compatibility exclusions**

Run:

```bash
git diff --check
git status --short
rg -n "\"KPI\"|KPI \\+" backend/seed_elements.json backend/seed_combinations.json backend/nickname.py edge-functions/_lib/nickname.js
```

Expected: no whitespace errors; KPI craft content still exists; unrelated working-tree paths remain untouched.

- [ ] **Step 9: Commit the documentation and cleanup slice**

```bash
git add README.md reset.sh docs/makers-development.md backend/main.py backend/kpi.py frontend/app.js frontend/index.html frontend/style.css edge-functions/_lib/game-service.js edge-functions/_lib/kv-store.js tests-makers/frontend.test.mjs
git commit -m "docs: rename KPI experience to score levels"
```

Use patch staging and verify `git diff --cached --name-only` before committing.

- [ ] **Step 10: Record final verification evidence**

Capture the exact pass counts and build exit status in the implementation handoff. Report any pre-existing unrelated modifications separately and do not include them in the feature's commits.
