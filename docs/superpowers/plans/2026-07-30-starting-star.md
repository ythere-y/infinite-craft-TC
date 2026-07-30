# Starting Star Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every player one score-free starting star while preserving zero initial score, unchanged score history, progressive score thresholds, and the existing display cap.

**Architecture:** Keep `earned_units(score)` and every score threshold unchanged, then derive `display_units = min(65_535, earned_units + 1)` in the browser, Edge, and Python rank helpers. Progress continues to use the earned-score interval; at the display cap it becomes fully complete and stays fixed. Existing animation code compares display units, so 300 points creates the second star and 960 points triggers the first four-star-to-moon fusion.

**Tech Stack:** Vanilla JavaScript, EdgeOne ES modules, Python, Node test runner, pytest, headless Chromium.

## Global Constraints

- Zero score displays exactly one star and creates no score-history event.
- Exact display mappings are `0 → 🌟`, `300 → 🌟🌟`, `620 → 🌟🌟🌟`, `960 → 🌙`, and `1,320 → 🌙🌟`.
- Score thresholds and per-star costs remain unchanged.
- The display cap remains 65,535 equivalent units; score and history continue accumulating after the cap.
- Homepage stays icon-only and the detail panel keeps the exact numeric score.
- Python, Edge, and browser rank results remain equivalent.
- Preserve unrelated staged and unstaged user changes.

---

### Task 1: Add the Score-Free Starting Star

**Files:**
- Modify: `frontend/score-level.js`
- Modify: `frontend/index.html`
- Modify: `edge-functions/_lib/kpi.js`
- Modify: `backend/kpi.py`
- Modify: `tests-makers/domain.test.mjs`
- Modify: `tests-makers/score-level.test.mjs`
- Modify: `tests/test_kpi.py`
- Modify: `tests/test_score_level_frontend.py`

**Interfaces:**
- `levelThreshold(units)` continues to describe earned score units only.
- `rankFor(total)` / `rank_for(total)` returns `level_units` including the free starting star.
- `MAX_LEVEL_SCORE` becomes the score where earned units reach `MAX_LEVEL_UNITS - 1`, because the free star supplies the final display unit.
- `transitionSteps(beforeDisplayUnits, afterDisplayUnits)` remains unchanged and consumes display units.

- [ ] **Step 1: Write failing domain tests**

Add hand-derived rank assertions in browser, Edge, and Python:

```text
rank(0)     = 1 unit, 🌟
rank(299)   = 1 unit, 🌟
rank(300)   = 2 units, 🌟🌟
rank(620)   = 3 units, 🌟🌟🌟
rank(960)   = 4 units, 🌙
rank(1320)  = 5 units, 🌙🌟
rank(57960) = 64 units, 👑
```

Rewrite earned-boundary loops so `threshold(n) - 1` yields display unit `n`
and `threshold(n)` yields display unit `n + 1`, capped at 65,535. Assert
that the rank at `MAX_LEVEL_SCORE` has 65,535 units and `progress == 1`.

- [ ] **Step 2: Run domain tests and verify RED**

Run:

```text
node --test tests-makers/domain.test.mjs tests-makers/score-level.test.mjs
python3 -m pytest tests/test_kpi.py -q
```

Expected: zero-score and shifted boundary assertions fail because current rank helpers return zero earned units without the starting star.

- [ ] **Step 3: Write failing browser behavior tests**

Update the real rendered-app expectations so a fresh zero-score player sees `🌟`
on the homepage and in the panel while the panel total remains `0` and the
history remains empty. Add a score-mutation case from zero to 300 that captures
the effects job and asserts:

```javascript
{
  beforeUnits: 1,
  afterUnits: 2,
  steps: [{ type: "gain", icon: "🌟" }],
  stored: "300"
}
```

Update the existing 1,320-point panel fixture from `🌙` to `🌙🌟`.

- [ ] **Step 4: Run browser tests and verify RED**

Run:

```text
python3 -m pytest tests/test_score_level_frontend.py -q
```

Expected: fresh-player homepage/panel and 300-point transition assertions fail under the old zero-unit behavior.

- [ ] **Step 5: Implement the minimal rank shift**

In each rank helper:

```text
earned_units = levelUnits(min(normalizeScore(total), MAX_LEVEL_SCORE))
display_units = min(MAX_LEVEL_UNITS, earned_units + 1)
```

Use `display_units` for icon breakdown, labels, and returned `level_units`.
Use `earned_units` for normal progress floors and ceilings. When
`display_units == MAX_LEVEL_UNITS`, return progress `1` and do not search
beyond the cap. Define `MAX_LEVEL_SCORE = threshold(MAX_LEVEL_UNITS - 1)`.

Update the initial HTML button content, title, and accessible label to one star
so the page never flashes the old empty-state copy before JavaScript loads.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```text
node --test tests-makers/domain.test.mjs tests-makers/score-level.test.mjs
python3 -m pytest tests/test_kpi.py tests/test_score_level_frontend.py -q
```

Expected: all targeted tests pass.

- [ ] **Step 7: Run full verification**

Run:

```text
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
python3 -m pytest tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: zero failures, a successful production build, and no whitespace errors.

- [ ] **Step 8: Commit only scoped files**

```text
git commit -m "feat: give every player a starting star"
```

Do not include unrelated staged `frontend/recipe-links.*` files or unrelated working-tree changes.
