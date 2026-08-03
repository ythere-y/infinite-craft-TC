# Midnight Casino Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the compact Anime.js midnight chip table into the production game, route inner-mode scoring through its fixed-base gambling round, and start local gameplay silently in inner mode.

**Architecture:** Keep deterministic gambling rules in a DOM-free browser global, keep table rendering and animation in a dedicated controller, and expose inner-mode lifecycle through `EFFECTS`. `app.js` remains the owner of the persisted shared total and chooses between the existing normal scoring path and the casino controller.

**Tech Stack:** Browser JavaScript IIFEs, Anime.js 4.5.0 IIFE/WAAPI, CSS, Node test runner, Python/Chromium runtime tests.

## Global Constraints

- Work directly in the current worktree as explicitly requested; do not create a worktree or modify unrelated files.
- Fixed casino base score is exactly 100.
- The first global-first result creates the first chip; empty rounds never render a chip.
- Only the harvest button is interactive inside the production table.
- The compact table is approximately `min(720px, calc(100% - 28px))` by 170px.
- Do not render `ANIME.JS`, `COMPOSITOR MODE`, preview success buttons, or preview failure buttons in the player UI.
- Initial startup applies inner mode silently; preserve the existing entrance animation for later Konami re-entry.
- Normal and inner modes share `ic_kpi`; an unharvested casino round remains memory-only.
- Vendor Anime.js locally, load no CDN resource, add no runtime npm dependency, and preserve its MIT notice.
- Use transform/opacity WAAPI animation, bounded stagger, cubic-bezier easing, and no persistent animation loop.
- Run `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build` before completion.

---

### Task 1: Deterministic Casino Round Rules

**Files:**
- Create: `frontend/casino-round.js`
- Create: `tests-makers/casino-round.test.mjs`

**Interfaces:**
- Consumes: numeric base score and event names `"success"`, `"harvest"`, `"failure"`.
- Produces: `window.CASINO_ROUND` with `createRound(baseScore)`, `applyRoundEvent(state, event)`, `chipOffset(index)`, and `createHarvestSequence(count)`.

- [ ] **Step 1: Write the failing rule tests**

Use `vm.runInNewContext()` to execute the real browser IIFE and assert hand-derived values:

```js
test("a casino round starts empty and doubles from a fixed 100 point base", async () => {
  const round = await loadCasinoRound();
  let state = round.createRound(100);
  assert.deepEqual(state, { baseScore: 100, pot: 0, chips: 0 });
  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(state, { baseScore: 100, pot: 100, chips: 1 });
  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(state, { baseScore: 100, pot: 200, chips: 2 });
  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(state, { baseScore: 100, pot: 400, chips: 3 });
});

test("harvest and failure both return to an empty round", async () => {
  const round = await loadCasinoRound();
  const active = { baseScore: 100, pot: 800, chips: 4 };
  assert.deepEqual(round.applyRoundEvent(active, "harvest"), {
    baseScore: 100, pot: 0, chips: 0,
  });
  assert.deepEqual(round.applyRoundEvent(active, "failure"), {
    baseScore: 100, pot: 0, chips: 0,
  });
});

test("unlimited chip offsets rise while harvest stagger stays bounded", async () => {
  const round = await loadCasinoRound();
  assert.equal(round.chipOffset(0), 0);
  assert.equal(round.chipOffset(25), 175);
  const sequence = round.createHarvestSequence(100);
  assert.equal(sequence.length, 100);
  assert.equal(sequence[0].chipIndex, 99);
  assert.ok(sequence.at(-1).delay <= 720);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test tests-makers/casino-round.test.mjs
```

Expected: FAIL because `frontend/casino-round.js` does not exist.

- [ ] **Step 3: Implement the minimal rule IIFE**

Implement a browser global without DOM access:

```js
(function (root) {
  function normalizeBaseScore(value) {
    const score = Math.trunc(Number(value));
    return Number.isFinite(score) && score > 0 ? score : 100;
  }
  function createRound(baseScore = 100) {
    return { baseScore: normalizeBaseScore(baseScore), pot: 0, chips: 0 };
  }
  function applyRoundEvent(state, event) {
    const current = {
      baseScore: normalizeBaseScore(state?.baseScore),
      pot: Math.max(0, Math.trunc(Number(state?.pot) || 0)),
      chips: Math.max(0, Math.trunc(Number(state?.chips) || 0)),
    };
    if (event === "success") {
      return {
        ...current,
        pot: current.chips === 0 ? current.baseScore : current.pot * 2,
        chips: current.chips + 1,
      };
    }
    if (event === "harvest" || event === "failure") {
      return createRound(current.baseScore);
    }
    return current;
  }
  function chipOffset(index) {
    return Math.max(0, Math.trunc(Number(index) || 0)) * 7;
  }
  function createHarvestSequence(count) {
    const safeCount = Math.max(0, Math.trunc(Number(count) || 0));
    const step = safeCount > 1 ? Math.min(90, 720 / (safeCount - 1)) : 0;
    return Array.from({ length: safeCount }, (_, order) => ({
      chipIndex: safeCount - order - 1,
      delay: order * step,
    }));
  }
  root.CASINO_ROUND = Object.freeze({
    createRound, applyRoundEvent, chipOffset, createHarvestSequence,
  });
})(typeof window === "object" ? window : globalThis);
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
node --test tests-makers/casino-round.test.mjs
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the rule engine**

```bash
git add frontend/casino-round.js tests-makers/casino-round.test.mjs
git commit -m "feat: add midnight casino round rules"
```

---

### Task 2: Compact Production Table and Anime.js Controller

**Files:**
- Create: `frontend/vendor/anime.iife.min.js`
- Create: `frontend/casino-mode.js`
- Create: `tests/test_casino_mode_ui.py`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: `window.anime`, `window.CASINO_ROUND`, `#casino-hud`, and `ura-mode-change`.
- Produces: `window.CASINO_MODE.init({ awardScore })`, `onCombineResult({ isGlobalFirst, sourceEl })`, `getState()`, and `isBusy()`.

- [ ] **Step 1: Write the failing real-browser UI test**

Inline the production table markup, CSS, Anime.js, rule engine, and controller into a temporary page. Add `body.ura-on` directly and inject an `awardScore` callback that adds the awarded amount to `localStorage.ic_kpi`; this isolates the controller from the later application-lifecycle task. Assert real rendered behavior:

```python
assert actual["initial_chips"] == 0
assert actual["game_button_labels"] == ["暂无可收获分数"]
assert actual["after_six"] == {
    "chips": 6,
    "pot": "3,200",
    "streak": "6 连续首发",
    "next": "下一次 ×2",
}
assert actual["table_width"] <= 720
assert actual["table_height"] <= 180
assert actual["technical_labels"] == 0
```

The page probe must call `window.CASINO_MODE.init({ awardScore })`, then call `window.CASINO_MODE.onCombineResult()` six times instead of inspecting source text. It must also click harvest, wait for completion, and assert zero chips plus `localStorage.ic_kpi === "3200"`.

- [ ] **Step 2: Run the browser test and verify RED**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: FAIL because the production table, controller, and vendored Anime.js file do not exist.

- [ ] **Step 3: Vendor Anime.js 4.5.0 official IIFE**

Download the tagged official IIFE to `frontend/vendor/anime.iife.min.js`. Preserve its version/license header and verify that executing it creates `window.anime.waapi.animate`, `window.anime.createTimeline`, and `window.anime.stagger`.

- [ ] **Step 4: Add the compact semantic table markup**

Insert `#casino-hud` as the last child of `#workspace`:

```html
<section id="casino-hud" class="casino-hud" aria-label="里模式待收获奖池">
  <div class="casino-table">
    <div class="casino-stack-column">
      <div class="casino-streak-status">
        <strong id="casino-streak-count">等待全球首发</strong>
        <span id="casino-next-multiplier">合成全球首发获得首枚筹码</span>
      </div>
      <div id="casino-chip-stack" class="casino-chip-stack"></div>
    </div>
    <div class="casino-pot-column">
      <span class="casino-pot-label">本轮待收获</span>
      <strong class="casino-pot-value"><span id="casino-pot-value">0</span><small>分</small></strong>
      <button id="casino-harvest" class="casino-harvest" disabled>暂无可收获分数</button>
    </div>
    <div class="casino-penguin-column">
      <span class="casino-penguin-seal">
        <img src="/assets/icons/generated/emoji/1f427.png" alt="">
      </span>
      <span>MIDNIGHT HOUSE</span>
    </div>
    <div id="casino-score-lane" class="casino-score-lane"></div>
    <div class="casino-wind" aria-hidden="true"><i></i><i></i><i></i></div>
    <div id="casino-loss-copy" class="casino-loss-copy"></div>
    <div id="casino-score-burst" class="casino-score-burst" aria-hidden="true"></div>
  </div>
</section>
```

Load scripts in this order before `app.js`: Anime.js, `casino-round.js`, `effects.js`, `casino-mode.js`.

- [ ] **Step 5: Add compact responsive styles**

Implement:

- `.casino-hud { width:min(720px,calc(100% - 28px)); bottom:14px; }`
- `.casino-table { min-height:164px; grid-template-columns:190px 1fr 126px; }`
- streak status at the upper left, above the chip stack, with an opaque midnight background and higher z-index;
- a 7px chip offset with visible overflow;
- `pointer-events:none` on the HUD and `pointer-events:auto` only on `.casino-harvest`;
- hidden table outside `body.ura-on`;
- responsive columns and smaller seal below 760px;
- reduced-motion cleanup rules;
- no Anime.js-facing text or selectors.

- [ ] **Step 6: Implement the controller**

The controller must:

```js
CASINO_MODE.init({
  awardScore({ amount, sourceEl, streak }) {},
});
CASINO_MODE.onCombineResult({
  isGlobalFirst: true,
  sourceEl: resultElement,
});
```

Use `anime.waapi.animate()` for success, multi-chip harvest, wind, failure, score burst, and total-score source emphasis. Use one multi-target harvest call with `anime.stagger(step)`. Call the injected `awardScore` exactly once after all chip flights finish. Wrap every async sequence in `try/finally` so `busy` and button state recover if animation rejects. If Anime.js or WAAPI is unavailable, update DOM and scoring synchronously.

- [ ] **Step 7: Run the browser test and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: the compact table, six-chip label, harvest reset, and 3,200 shared score assertions pass.

- [ ] **Step 8: Commit the table and controller**

```bash
git add frontend/vendor/anime.iife.min.js frontend/casino-mode.js frontend/index.html frontend/style.css tests/test_casino_mode_ui.py
git commit -m "feat: embed compact Anime.js casino table"
```

---

### Task 3: Default Silent Inner Mode and Re-entry Lifecycle

**Files:**
- Modify: `frontend/effects.js`
- Modify: `frontend/app.js`
- Modify: `tests/test_casino_mode_ui.py`
- Modify: `tests/test_combine_feedback.py`

**Interfaces:**
- Consumes: `EFFECTS.initBossMode({ defaultOn })`.
- Produces: `EFFECTS.isUraMode()` and `window` event `ura-mode-change` with `{ active, initial }`.

- [ ] **Step 1: Extend the browser tests and verify RED**

Add behavior assertions:

```python
assert actual["initial_transition_count"] == 0
assert actual["initial_ura_event"] == {"active": True, "initial": True}
assert actual["after_first_code"]["active"] is False
assert actual["after_second_code"]["active"] is True
assert actual["after_second_code"]["entrance_transition_count"] == 1
assert actual["round_preserved_across_toggle"]["chips"] == 2
```

Update the existing boss geometry test to call `initBossMode({ defaultOn: false })` so it continues testing the explicit entry path.

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py tests/test_combine_feedback.py::test_boss_mode_preserves_canvas_element_geometry_and_restores_icon -q
```

Expected: FAIL because `isUraMode`, event detail, and silent default activation are absent.

- [ ] **Step 2: Refactor the mode lifecycle**

Add an idempotent mode setter:

```js
function announceUraMode(initial) {
  window.dispatchEvent(new CustomEvent("ura-mode-change", {
    detail: { active: uraOn, initial: !!initial },
  }));
}

function applyUraStableState(initial) {
  uraOn = true;
  banner?.classList.add("show");
  document.body.classList.add("ura-on");
  scanAndPaint(document);
  startObserver();
  announceUraMode(initial);
}
```

`initBossMode({ defaultOn = true } = {})` binds the keyboard once and calls `applyUraStableState(true)` without `playUraEnterTransition()` or `uraEnterChime()`. Konami exit removes the stable state and emits `{ active:false, initial:false }`. Later Konami entry keeps the existing entrance transition and emits `{ active:true, initial:false }` when the 600ms stable state is applied.

Expose:

```js
EFFECTS.isUraMode = function () { return uraOn; };
```

- [ ] **Step 3: Initialize mode before asynchronous game setup**

In `app.js`:

```js
async function init() {
  await window.ICON_SYSTEM.ready;
  window.CASINO_MODE?.init?.({ awardScore: awardCasinoScore });
  window.EFFECTS?.initBossMode?.({ defaultOn: true });
  await loadElements();
  // existing initialization continues, without a second initBossMode call
}
```

- [ ] **Step 4: Run the lifecycle tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py tests/test_combine_feedback.py::test_boss_mode_preserves_canvas_element_geometry_and_restores_icon -q
```

Expected: silent default entry, preserved old re-entry animation, event payloads, and stable geometry all pass.

- [ ] **Step 5: Commit the lifecycle**

```bash
git add frontend/effects.js frontend/app.js tests/test_casino_mode_ui.py tests/test_combine_feedback.py
git commit -m "feat: start silently in inner mode"
```

---

### Task 4: Production Scoring Route, Build Contract, and License

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Modify: `frontend/index.html`
- Modify: `tests/test_casino_mode_ui.py`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests-makers/build.test.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: `EFFECTS.isUraMode()` and `CASINO_MODE.onCombineResult()`.
- Produces: `awardCasinoScore({ amount, sourceEl, streak })`, shared score mutation, and one `casino` score-history row per harvest.

- [ ] **Step 1: Add failing scoring and build tests**

The real-browser test must exercise two complete paths:

1. Inner mode: global firsts change only casino pot; harvest changes `ic_kpi` once and adds one score row with tier `casino`.
2. Normal mode after Konami exit: a combine score calls the existing normal path and does not change casino chips.

Extend build expectations so `npm run build` must copy non-empty:

```text
dist/vendor/anime.iife.min.js
dist/casino-round.js
dist/casino-mode.js
```

Add a runtime load-order assertion that the controller is available before `app.js` executes.

Run:

```bash
node --test tests-makers/frontend.test.mjs tests-makers/build.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: FAIL because the app scoring route, required build entries, and license notice are incomplete.

- [ ] **Step 2: Route combine scoring by active mode**

At the existing combine response boundary:

```js
const casinoActive = window.EFFECTS?.isUraMode?.() === true;
const fullScore = resp.full_score || 0;
const gained = isNewToPlayer ? fullScore : Math.max(1, Math.floor(fullScore / 10));
if (casinoActive) {
  window.CASINO_MODE?.onCombineResult?.({
    isGlobalFirst: resp.is_first === true,
    sourceEl: newRec.el,
  });
} else if (fullScore > 0) {
  animateScore(gained, newRec.el);
  recordScoreEvent(resultInfo, gained, resp.depth, tier);
}
```

Pass `gained: casinoActive ? null : gained` to normal combine feedback so inner-mode results do not claim immediate score.

Implement the injected harvest callback:

```js
function awardCasinoScore({ amount, sourceEl, streak }) {
  const gained = window.SCORE_LEVEL.normalizeScore(amount);
  if (gained <= 0) return;
  animateScore(gained, sourceEl);
  recordScoreEvent({
    name: "里模式收获",
    emoji: "🎰",
    category: "ura",
    is_starter: false,
  }, gained, streak, "casino");
}
```

Add `.score-row .gain.tier-casino` and its midnight variant.

- [ ] **Step 3: Complete build and third-party contracts**

Add the three new assets to both `REQUIRED_ENTRIES` and `REQUIRED_FILES`. Add an Anime.js section to `THIRD_PARTY_NOTICES.md` containing the MIT copyright and permission text from the vendored 4.5.0 source. Bump changed production asset query versions in `frontend/index.html` to `20260803a`.

- [ ] **Step 4: Verify targeted GREEN**

Run:

```bash
node --test tests-makers/casino-round.test.mjs tests-makers/frontend.test.mjs tests-makers/build.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: all targeted tests pass.

- [ ] **Step 5: Run full project verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: every command exits 0.

- [ ] **Step 6: Run local production-like smoke verification**

Follow the repository workflow:

```bash
npm run dev
curl -fsS http://127.0.0.1:8000/api/health
```

Open the game by IP and port, verify default inner mode, six successes, harvest, failure, and Konami toggle. Stop services with:

```bash
npm run dev:down
```

- [ ] **Step 7: Commit the production route and build contract**

```bash
git add frontend/app.js frontend/style.css frontend/index.html tests/test_casino_mode_ui.py tests-makers/frontend.test.mjs tests-makers/build.test.mjs scripts/build-makers.mjs THIRD_PARTY_NOTICES.md
git commit -m "feat: route inner-mode scoring through casino table"
```
