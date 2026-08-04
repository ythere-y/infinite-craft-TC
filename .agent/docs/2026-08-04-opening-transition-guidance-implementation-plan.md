# Opening Transition and Canvas Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the opening finale feel continuous and replace the verbose empty-canvas instruction with a quiet, oversized element-style formula board.

**Architecture:** Add a pure finale timing contract to the existing opening controller, then replace its serialized animation wait with a fixed, overlapping composited timeline. Keep guidance in the existing `#hint` container, render its arrow and sparkle through the production action Icon system, and reuse the opening infinity SVG path for the innovation board.

**Tech Stack:** Vanilla JavaScript, Anime.js v4.5.0, Web Animations API, CSS transforms/opacity, SVG, Node.js test runner, existing Python headless-browser fixtures.

## Global Constraints

- Develop directly in the current workspace; do not create a Git worktree.
- Keep the opening's current V3 vortex, identity branches, production element icons, and every-load behavior.
- Live finale duration is exactly 520 ms; real UI reveal begins at 160 ms.
- Static/reduced-motion finale is a 180 ms crossfade.
- Animate only `transform` and `opacity` during the finale.
- Formal tokens retain individual core absorption; fragments animate as one layer.
- The basic guidance reads `[ → 拖拽！ ] + [ ✦ 合成！ ] = [ ∞ 创新！ ]`.
- The combine board uses the production sparkle action, not an equals action.
- The innovation board reuses the opening infinity SVG path.
- Guidance boards are oversized, grayscale, translucent, non-interactive background furniture behind real canvas elements.
- Preserve the advanced guidance, nine-step example, credits, help toggle, and `.hint.hide` behavior.
- Add no npm or CDN dependency and no blur or `backdrop-filter`.
- Before completion run `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build`.
- A deployment maintainer separately runs `npm run makers:build`.

---

## File Structure

- Modify `frontend/opening-animation.js`: pure finale timing contract, bounded token absorption, grouped fragment contraction, fixed completion deadline, and cleanup.
- Modify `frontend/opening-animation.css`: overlapping stage fade and reduced-motion transition.
- Modify `frontend/index.html`: formula-board markup and release cache versions.
- Modify `frontend/style.css`: large translucent background-board styling and responsive one-line layout.
- Modify `tests-makers/opening-animation.test.mjs`: executable timing-contract tests.
- Modify `tests-makers/frontend.test.mjs`: formula semantics, icon selection, asset ordering, and cache-version tests.
- Modify existing Python browser fixtures only if the new production markup exposes a fixture assumption; do not weaken production behavior.

---

### Task 1: Overlapping Finale Timeline

**Files:**
- Modify: `frontend/opening-animation.js`
- Modify: `frontend/opening-animation.css`
- Modify: `tests-makers/opening-animation.test.mjs`

**Interfaces:**
- Produces: `OPENING_ANIMATION.finalePlan(mode) -> {absorbMs, fragmentMs, revealAtMs, totalMs}`.
- Consumes: `mode`, already produced by `animationMode()`, with values `"live"` or `"static"`.
- Produces internally: `runtime.beginFinale() -> void`; this starts animations but never waits for per-node completion.
- Preserves: `OPENING_ANIMATION.start(options) -> Promise<{nickname, changed}>`.

- [ ] **Step 1: Write the failing finale timing tests**

Append to `tests-makers/opening-animation.test.mjs`:

```js
test("live finale overlaps absorption and reveal within 520 ms", async () => {
  const opening = await loadOpeningAnimation();

  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.finalePlan("live"))),
    {
      absorbMs: 360,
      fragmentMs: 280,
      revealAtMs: 160,
      totalMs: 520,
    },
  );
});

test("static finale is a short crossfade", async () => {
  const opening = await loadOpeningAnimation();

  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.finalePlan("static"))),
    {
      absorbMs: 0,
      fragmentMs: 0,
      revealAtMs: 0,
      totalMs: 180,
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
node tests-makers/opening-animation.test.mjs
```

Expected: the two new tests fail because `finalePlan` is absent.

- [ ] **Step 3: Add the pure timing contract**

Add before `createVortexRuntime()`:

```js
function finalePlan(mode) {
  if (mode === "static") {
    return Object.freeze({
      absorbMs: 0,
      fragmentMs: 0,
      revealAtMs: 0,
      totalMs: 180,
    });
  }
  return Object.freeze({
    absorbMs: 360,
    fragmentMs: 280,
    revealAtMs: 160,
    totalMs: 520,
  });
}
```

Expose `finalePlan` through `window.OPENING_ANIMATION`.

- [ ] **Step 4: Replace per-node waiting with bounded animation startup**

Inside `createVortexRuntime()`:

1. Store `const plan = finalePlan(mode)`.
2. Add `finaleAnimations = new Set()`.
3. Rename `absorbAll()` to `beginFinale()`.
4. Stop emission, RAF, throwing animations, and Anime loops immediately.
5. Animate only visible formal tokens individually:

```js
const visibleTokens = [...tokenNodes].filter((node) => !node.hidden);
visibleTokens.forEach((node, index) => {
  const animation = node.animate(
    [
      { transform: node.style.transform, opacity: node.style.opacity || 1 },
      {
        transform:
          `translate3d(${center.x}px, ${center.y}px, 0) ` +
          "translate(-50%, -50%) rotate(.7rad) scale(.06)",
        opacity: 0,
      },
    ],
    {
      duration: plan.absorbMs,
      delay: Math.min(40, index * 3),
      easing: "cubic-bezier(.5,.02,.28,1)",
      fill: "forwards",
    },
  );
  finaleAnimations.add(animation);
});
```

6. Animate `fragmentLayer` once:

```js
const fragmentAnimation = fragmentLayer.animate(
  [
    { scale: 1, opacity: 1 },
    {
      scale: 0.12,
      opacity: 0,
    },
  ],
  {
    duration: plan.fragmentMs,
    easing: "cubic-bezier(.5,.02,.28,1)",
    fill: "forwards",
  },
);
fragmentLayer.style.transformOrigin = "500px 296px";
finaleAnimations.add(fragmentAnimation);
```

Static mode sets token and fragment opacity to `0` without starting absorption animations. `beginFinale()` returns immediately.

- [ ] **Step 5: Overlap real-UI reveal with the opening fade**

Change `finish(result)` to:

```js
async function finish(result) {
  if (finished) return;
  finished = true;
  actions.removeEventListener("click", onAction);
  documentRef.removeEventListener("keydown", onKeyDown);
  const plan = finalePlan(runtime.mode);
  stage.classList.add("is-finalizing");
  runtime.beginFinale();

  await wait(plan.revealAtMs);
  documentRef.body.classList.add("opening-finalizing");
  documentRef.body.classList.remove("opening-active");
  stage.classList.add("is-revealing");

  await wait(plan.totalMs - plan.revealAtMs);
  runtime.destroy();
  stage.remove();
  documentRef.body.classList.remove("opening-finalizing");
  options.revealTargets?.workspace?.focus?.();
  return result;
}
```

Define `wait(milliseconds)` inside `start()` with `global.setTimeout`.
Return `{ beginFinale, destroy, mode, pause, resume }` from the runtime.
The fallback runtime returns `mode: "static"` and a no-op `beginFinale`.
`destroy()` cancels every `finaleAnimations` member.

- [ ] **Step 6: Add the composited stage reveal CSS**

Add to `frontend/opening-animation.css`:

```css
.opening-stage {
  opacity: 1;
}

.opening-stage.is-revealing {
  opacity: 0;
  transition: opacity .36s cubic-bezier(.2, .75, .25, 1);
}

.opening-stage.is-finalizing .opening-vortex-svg {
  transform:
    translate(-50%, -50%)
    scale(calc(var(--opening-stage-scale, 1) * .96));
  opacity: .7;
  transition:
    transform .36s cubic-bezier(.5, .02, .28, 1),
    opacity .28s ease;
}
```

Add a reduced-motion override with an `.18s` opacity transition and no vortex
transform transition.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
node tests-makers/opening-animation.test.mjs
node --check frontend/opening-animation.js
```

Expected: all opening tests pass and syntax check exits 0.

Commit:

```bash
git add frontend/opening-animation.js frontend/opening-animation.css \
  tests-makers/opening-animation.test.mjs
git commit -m "perf: overlap opening finale reveal"
```

---

### Task 2: Element-Style Formula Background Board

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: `ICON_SYSTEM.hydrateActions(document)`, already called by `app.js`.
- Consumes: action key `next -> arrow-right.svg` and action key `sparkle -> sparkle.svg`.
- Produces: `.guidance-formula`, three `.guidance-board` nodes, `.guidance-operator`, and `.guidance-infinity`.
- Preserves: `#advanced-guidance`, `.hint.hide`, and desktop/mobile help variants.

- [ ] **Step 1: Replace the old basic-guidance assertions with failing formula assertions**

In `tests-makers/frontend.test.mjs`, update
`"homepage keeps basic guidance visible and advanced guidance collapsed"`:

```js
assert.match(
  basic[1],
  /class="guidance-formula"[^>]*aria-label="拖拽元素，加以合成，创造新元素。"/,
);
assert.match(
  basic[1],
  /class="guidance-board guidance-drag"[\s\S]*data-icon-action="next"[\s\S]*拖拽！/,
);
assert.match(
  basic[1],
  /class="guidance-operator"[^>]*>\+<\/span>[\s\S]*class="guidance-board guidance-combine"[\s\S]*data-icon-action="sparkle"[\s\S]*合成！/,
);
assert.match(
  basic[1],
  /class="guidance-operator"[^>]*>=<\/span>[\s\S]*class="guidance-board guidance-innovation"[\s\S]*class="guidance-infinity"[\s\S]*创新！/,
);
assert.doesNotMatch(basic[1], /data-icon-action="combine"/);
assert.doesNotMatch(basic[1], /把右边的元素|把下方的元素/);
```

Add a CSS contract assertion in the existing phone-layout test:

```js
assert.match(
  css,
  /\.guidance-formula\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap/s,
);
assert.match(
  css,
  /\.guidance-board\s*\{[^}]*opacity:\s*\.4[^}]*pointer-events:\s*none/s,
);
assert.doesNotMatch(
  css.match(/\.guidance-board\s*\{[^}]*\}/s)?.[0] || "",
  /backdrop-filter|filter:/,
);
```

- [ ] **Step 2: Run the frontend test and verify the red state**

Run:

```bash
node tests-makers/frontend.test.mjs
```

Expected: formula markup and guidance CSS assertions fail.

- [ ] **Step 3: Replace only the basic guidance markup**

Replace `.basic-guidance` contents in `frontend/index.html` with:

```html
<div class="guidance-formula"
     role="img"
     aria-label="拖拽元素，加以合成，创造新元素。">
  <div class="guidance-board guidance-drag">
    <span class="guidance-icon action-slot"
          data-icon-action="next"
          aria-hidden="true"></span>
    <strong>拖拽！</strong>
  </div>
  <span class="guidance-operator" aria-hidden="true">+</span>
  <div class="guidance-board guidance-combine">
    <span class="guidance-icon action-slot"
          data-icon-action="sparkle"
          aria-hidden="true"></span>
    <strong>合成！</strong>
  </div>
  <span class="guidance-operator" aria-hidden="true">=</span>
  <div class="guidance-board guidance-innovation">
    <svg class="guidance-infinity"
         viewBox="-180 -90 360 180"
         aria-hidden="true">
      <path d="M0 0C-55-78-168-78-168 0S-55 78 0 0C55-78 168-78 168 0S55 78 0 0Z"/>
    </svg>
    <strong>创新！</strong>
  </div>
</div>
```

Do not change `#advanced-guidance`.

- [ ] **Step 4: Implement the subdued background-board styling**

Add after the base `.hint` rules in `frontend/style.css`:

```css
.guidance-formula {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: clamp(8px, 1.4vw, 18px);
  width: min(720px, 88vw);
}

.guidance-board {
  position: relative;
  display: grid;
  grid-template-columns: 44px auto;
  align-items: center;
  gap: 10px;
  width: clamp(132px, 13vw, 174px);
  min-height: 84px;
  padding: 14px 18px;
  border: 1px solid rgba(55, 63, 72, .24);
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, .76), rgba(220, 224, 226, .48));
  box-shadow:
    0 18px 38px rgba(45, 52, 58, .09),
    inset 0 1px 0 rgba(255, 255, 255, .72);
  color: #4f565c;
  opacity: .4;
  pointer-events: none;
}

.guidance-board:nth-of-type(1) { transform: rotate(-2deg); }
.guidance-board:nth-of-type(2) { transform: translateY(-5px) rotate(1deg); }
.guidance-board:nth-of-type(3) { transform: rotate(2deg); }

.guidance-board strong {
  font-size: clamp(18px, 2vw, 26px);
  font-weight: 850;
  letter-spacing: .04em;
  white-space: nowrap;
}

.guidance-icon {
  width: 42px;
  height: 42px;
}

.guidance-infinity {
  width: 48px;
  height: 42px;
}

.guidance-infinity path {
  fill: none;
  stroke: currentColor;
  stroke-width: 16;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.guidance-operator {
  color: rgba(65, 72, 78, .48);
  font: 800 clamp(24px, 3vw, 40px)/1 ui-monospace, monospace;
}
```

Set `.hint` to a sufficiently large `max-width` for the formula while
preserving `pointer-events: none` and `z-index: 1`.

- [ ] **Step 5: Add a one-line mobile formula**

Inside the existing phone media query, add:

```css
.guidance-formula {
  gap: 4px;
  width: calc(100vw - 18px);
}

.guidance-board {
  grid-template-columns: 24px auto;
  gap: 4px;
  width: min(27vw, 102px);
  min-height: 58px;
  padding: 8px 7px;
  border-radius: 12px;
}

.guidance-board strong {
  font-size: clamp(12px, 3.7vw, 16px);
}

.guidance-icon,
.guidance-infinity {
  width: 24px;
  height: 24px;
}

.guidance-operator {
  font-size: 19px;
}
```

- [ ] **Step 6: Bump changed frontend asset cache versions**

In `frontend/index.html`, use:

```html
<link rel="stylesheet" href="/opening-animation.css?v=20260804b" />
<link rel="stylesheet" href="/style.css?v=20260804b" />
<script src="/opening-animation.js?v=20260804b"></script>
```

Update the frontend integration test to require these exact versions.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
node tests-makers/frontend.test.mjs
npm run build
```

Expected: frontend tests pass and build exits 0.

Commit:

```bash
git add frontend/index.html frontend/style.css tests-makers/frontend.test.mjs
git commit -m "feat: add canvas formula guidance"
```

---

### Task 3: Browser Performance and Repository Verification

**Files:**
- Modify only files already listed if verification reveals a defect.

**Interfaces:**
- Validates the complete improvement; introduces no new API.

- [ ] **Step 1: Rebuild and start the required local service**

Run:

```bash
npm run dev
```

Verify:

```bash
curl --noproxy '*' http://127.0.0.1:8000/api/health
```

Expected: HTTP 200 with Redis `ok`.

- [ ] **Step 2: Measure the live finale**

In a disposable Chromium profile with an existing nickname:

1. Load `/`.
2. Install a `MutationObserver` on `body` and `#opening-stage`.
3. Click `继续使用`.
4. Record the timestamps for `is-finalizing`, `opening-finalizing`,
   `is-revealing`, and stage removal.

Acceptance:

- reveal classes begin between 140 and 210 ms after the click;
- stage removal occurs between 480 and 620 ms after the click;
- no `Runtime.exceptionThrown` or console error;
- no task longer than 50 ms during the finale;
- the real topbar, sidebar, and formula are visible after removal.

- [ ] **Step 3: Verify static finale**

Emulate `prefers-reduced-motion: reduce`, reload, click `继续使用`, and confirm:

- six static formal tokens are present before the click;
- stage removal occurs between 150 and 260 ms;
- no absorption motion runs;
- workspace receives focus.

- [ ] **Step 4: Verify the formula board visually**

At 1440×900 and 390×844 confirm:

- the formula remains one line;
- order is `拖拽 + 合成 = 创新`;
- drag uses the production arrow action;
- combine uses the production sparkle action and no equals icon;
- innovation uses the infinity SVG;
- boards are larger and quieter than real elements;
- operators remain readable;
- placing a real element triggers existing `.hint.hide` behavior;
- real elements paint above the boards.

- [ ] **Step 5: Run the complete repository gate**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: all tests pass, build exits 0, and diff check emits no errors.

- [ ] **Step 6: Inspect scope and record deployment follow-up**

Run:

```bash
git status --short
git diff --stat 44c1c81..HEAD
```

Confirm only the approved opening finale, guidance markup/styles, tests, and
any required fixture compatibility changes are included. Report that a
deployment maintainer still runs `npm run makers:build`.
