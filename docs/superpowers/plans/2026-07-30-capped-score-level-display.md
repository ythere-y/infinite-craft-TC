# Capped Score Level Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue accumulating real score and history after the level display reaches 65,535 equivalent stars, while stopping further level transitions and upgrade effects.

**Architecture:** Separate raw-score normalization from display-rank clamping in the shared browser, Edge, and Python domain helpers. `animateScore()` persists the raw safe-integer total; its capped before/after ranks naturally produce no transition steps above the display ceiling, so the existing effects queue retains the `+N 分` flight and residue without creating or merging level icons.

**Tech Stack:** Vanilla JavaScript, EdgeOne ES modules, Python, Node test runner, pytest, headless Chromium.

## Global Constraints

- Cumulative score remains the persisted source of truth and continues increasing up to the JavaScript safe-integer limit.
- Level display is capped at 65,535 equivalent stars, including at most 1,023 crown icons.
- At and above the cap, score history and ordinary `+N 分` feedback continue; star generation, fusion, and upgrade effects stop.
- Homepage remains icon-only; exact score remains available only in the detail panel.
- Existing `ic_kpi`, score-history storage, and legacy API identifiers remain compatible.
- Preserve all unrelated staged and unstaged user changes.

---

### Task 1: Separate Raw Score From Capped Display Rank

**Files:**
- Modify: `frontend/score-level.js`
- Modify: `frontend/app.js`
- Modify: `edge-functions/_lib/kpi.js`
- Modify: `backend/kpi.py`
- Test: `tests-makers/score-level.test.mjs`
- Test: `tests-makers/domain.test.mjs`
- Test: `tests/test_kpi.py`
- Test: `tests/test_score_level_frontend.py`

**Interfaces:**
- `normalizeScore(value)` returns a finite integer in `0..Number.MAX_SAFE_INTEGER`.
- `rankFor(total)` clamps only the score used for level derivation to `MAX_LEVEL_SCORE`, returning at most `MAX_LEVEL_UNITS`.
- `animateScore(delta, sourceEl)` persists the normalized raw total and sends an empty `steps` array when both capped ranks are equal.

- [ ] **Step 1: Write failing domain tests**

Add literal assertions proving that a score above `MAX_LEVEL_SCORE` remains numerically above the cap while `rankFor()` stays at exactly 65,535 units:

```javascript
assert.equal(levels.normalizeScore(levels.MAX_LEVEL_SCORE + 500), levels.MAX_LEVEL_SCORE + 500);
assert.equal(levels.rankFor(levels.MAX_LEVEL_SCORE + 500).level_units, 65_535);
assert.deepEqual(levels.transitionSteps(65_535, 65_535), []);
```

Add matching Edge and Python assertions. In Python, expose a raw-score normalizer capped at `9_007_199_254_740_991`; keep display allocation bounded by applying `MAX_LEVEL_SCORE` only inside `rank_for()`.

- [ ] **Step 2: Run domain tests and verify RED**

Run:

```text
node --test tests-makers/score-level.test.mjs tests-makers/domain.test.mjs
python3 -m pytest tests/test_kpi.py -q
```

Expected: assertions above the display cap fail because the current normalizers truncate the stored score to `MAX_SCORE`.

- [ ] **Step 3: Write failing production-browser test**

Preload `ic_kpi` with `MAX_LEVEL_SCORE`, call `animateScore(50, source)`, and assert literal outcomes:

```javascript
{
  stored: String(MAX_LEVEL_SCORE + 50),
  levelUnits: 65535,
  steps: [],
  historyGained: 50
}
```

The captured effects job must still contain `delta: 50`, proving ordinary score feedback remains queued without level steps.

- [ ] **Step 4: Run browser test and verify RED**

Run:

```text
python3 -m pytest tests/test_score_level_frontend.py -q
```

Expected: stored total remains truncated at the display cap.

- [ ] **Step 5: Implement minimal separation**

In all three domain implementations:

1. Rename the existing display ceiling to `MAX_LEVEL_SCORE`.
2. Normalize raw cumulative score to `Number.MAX_SAFE_INTEGER` / `9_007_199_254_740_991`.
3. In `rankFor` / `rank_for`, compute `displayScore = min(rawScore, MAX_LEVEL_SCORE)`.
4. Keep level-unit search and icon allocation bounded at 65,535 units.
5. Return capped rank/progress without exposing a new player-visible “full level” label.

In `animateScore()`, keep using the raw normalizer for `state.score` and persistence. Use the capped ranks for `transitionSteps`; equal max ranks yield no star or merge stages while `animateScoreGain` still handles score flight/residue.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run:

```text
node --test tests-makers/score-level.test.mjs tests-makers/domain.test.mjs
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

Expected: zero failures, successful production build, and no whitespace errors.

- [ ] **Step 8: Commit only scoped files**

```text
git commit -m "fix: keep score growing after level cap"
```

Do not include the user's unrelated staged `frontend/recipe-links.*` files or unrelated working-tree changes.
