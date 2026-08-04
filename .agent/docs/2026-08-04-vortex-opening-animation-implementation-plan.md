# Vortex Opening Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the approved Anime.js vortex opening into every main-game load, with distinct first-time and returning-player identity cards and a finale that reveals the real game UI.

**Architecture:** Add a focused browser-global opening controller with pure, VM-testable geometry and identity-state helpers. The controller owns the overlay, SVG motion, bounded token pools, reduced-motion fallback, and finale; `app.js` remains the owner of nickname API/storage operations and passes an explicit adapter into the controller. Static markup and styles live beside the existing vanilla frontend, and the Makers build copies them as first-class public assets.

**Tech Stack:** Vanilla JavaScript, Anime.js v4.5.0 IIFE, SVG, CSS transforms, Node.js built-in test runner, existing production Icon system.

## Global Constraints

- Develop directly in the current workspace; do not create a Git worktree.
- Show the opening on every load of `/`; do not show it on wall, community, or administrative routes.
- Use only `frontend/vendor/anime.iife.min.js`; add no npm or CDN animation dependency.
- Use production element Icon rendering and local assets; do not introduce independent Emoji styling.
- Render 18 prefilled formal tokens and 16 prefilled fragments.
- Emit one formal token and two fragments every 720 ms while the card waits.
- Formal-token track travel lasts 12–14 seconds and moves inward from its first track frame.
- A first-time player must claim a name; a returning player gets a dominant `继续使用` action and a secondary `更改花名` action.
- The finale reveals the real topbar, sidebar, and workspace guidance; it must not swap mock UI for real UI.
- Respect `prefers-reduced-motion: reduce`, pause while hidden, and provide a no-Anime fallback that never blocks entry.
- Do not commit `.env`, credentials, runtime data, `.superpowers/`, or unrelated working-tree files.
- Before merge run `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build`.
- A deployment maintainer separately runs `npm run makers:build`.

---

## File Structure

- Create `frontend/opening-animation.js`: opening controller, pure geometry/state helpers, Anime.js orchestration, resource cleanup, and `window.OPENING_ANIMATION` public API.
- Create `frontend/opening-animation.css`: full-screen stage, vortex, production-token layout, identity-card branches, finale transitions, responsive rules, and reduced-motion presentation.
- Create `tests-makers/opening-animation.test.mjs`: VM tests for public helpers and static contract tests for lifecycle/performance constraints.
- Modify `frontend/index.html`: add the opening overlay markup, initial `opening-active` body class, stylesheet, and script in dependency order.
- Modify `frontend/app.js`: refactor nickname API/storage operations into an adapter, start the opening on every main-page initialization, and keep the existing modal for later topbar-initiated renaming.
- Modify `tests-makers/frontend.test.mjs`: assert build-time page/script/style ordering and integration with the real UI.
- Modify `scripts/build-makers.mjs`: require the two opening assets in the generated static site.

---

### Task 1: Opening Contracts and Geometry Core

**Files:**
- Create: `frontend/opening-animation.js`
- Create: `tests-makers/opening-animation.test.mjs`

**Interfaces:**
- Produces: `window.OPENING_ANIMATION.branchForNickname(nickname) -> "first-time" | "returning"`.
- Produces: `window.OPENING_ANIMATION.createSpiralPoints(definition, count) -> Array<{x: number, y: number, radius: number}>`.
- Produces: `window.OPENING_ANIMATION.samplePath(path, count) -> Array<{x: number, y: number, angle: number}>`.
- Produces: `window.OPENING_ANIMATION.CONFIG`, a frozen object containing the exact animation limits used by later tasks.
- Consumes: no application state or DOM during module evaluation.

- [ ] **Step 1: Write the failing VM tests for branch selection and exact limits**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadOpeningAnimation() {
  const source = await readFile("frontend/opening-animation.js", "utf8")
    .catch(() => "");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.ok(context.window.OPENING_ANIMATION);
  return context.window.OPENING_ANIMATION;
}

test("opening branch depends only on the persisted nickname", async () => {
  const opening = await loadOpeningAnimation();
  assert.equal(opening.branchForNickname(""), "first-time");
  assert.equal(opening.branchForNickname("  "), "first-time");
  assert.equal(opening.branchForNickname("全力以赴的代码鹅"), "returning");
});

test("opening animation limits match the approved design", async () => {
  const opening = await loadOpeningAnimation();
  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.CONFIG)),
    {
      prefilledTokens: 18,
      prefilledFragments: 16,
      fragmentsPerEmission: 2,
      emissionIntervalMs: 720,
      tokenTravelMs: 13_200,
      maxTokens: 36,
      maxFragments: 48,
      pathSamples: 360,
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
node --test tests-makers/opening-animation.test.mjs
```

Expected: FAIL because `frontend/opening-animation.js` or
`window.OPENING_ANIMATION` does not exist.

- [ ] **Step 3: Add the browser-global module and pure helpers**

```js
(function (global) {
  "use strict";

  const CONFIG = Object.freeze({
    prefilledTokens: 18,
    prefilledFragments: 16,
    fragmentsPerEmission: 2,
    emissionIntervalMs: 720,
    tokenTravelMs: 13_200,
    maxTokens: 36,
    maxFragments: 48,
    pathSamples: 360,
  });

  function branchForNickname(nickname) {
    return String(nickname || "").trim() ? "returning" : "first-time";
  }

  function createSpiralPoints(definition, count = CONFIG.pathSamples) {
    const points = [];
    const total = Math.max(2, Math.trunc(count));
    for (let index = 0; index <= total; index += 1) {
      const progress = index / total;
      const angle =
        definition.phase + definition.turns * Math.PI * 2 * progress;
      const envelope =
        16 * progress * progress *
        (1 - progress) * (1 - progress);
      const radius =
        definition.startRadius +
        (definition.endRadius - definition.startRadius) * progress +
        Math.sin(progress * Math.PI * 7) *
        definition.wave * envelope;
      points.push({
        x: definition.centerX + Math.cos(angle) * radius,
        y:
          definition.centerY +
          Math.sin(angle) * radius * definition.verticalScale,
        radius,
      });
    }
    return points;
  }

  function samplePath(path, count = CONFIG.pathSamples) {
    const length = path.getTotalLength();
    const raw = [];
    for (let index = 0; index <= count; index += 1) {
      raw.push(path.getPointAtLength(length * index / count));
    }
    return raw.map((point, index) => {
      const next = raw[Math.min(raw.length - 1, index + 1)];
      return {
        x: point.x,
        y: point.y,
        angle: Math.atan2(next.y - point.y, next.x - point.x),
      };
    });
  }

  global.OPENING_ANIMATION = Object.freeze({
    CONFIG,
    branchForNickname,
    createSpiralPoints,
    samplePath,
  });
})(window);
```

- [ ] **Step 4: Add an inward-entry regression test**

```js
test("every approved feeder path moves inward from its first sample", async () => {
  const opening = await loadOpeningAnimation();
  const definitions = [
    { phase: 0, turns: 2.3, startRadius: 485, endRadius: 36, wave: 22 },
    { phase: Math.PI, turns: 2.3, startRadius: 485, endRadius: 36, wave: -22 },
    { phase: Math.PI / 2, turns: 1.72, startRadius: 370, endRadius: 42, wave: 12 },
    { phase: Math.PI * 1.5, turns: 1.72, startRadius: 370, endRadius: 42, wave: -12 },
  ].map((definition) => ({
    centerX: 500,
    centerY: 296,
    verticalScale: 0.76,
    ...definition,
  }));

  for (const definition of definitions) {
    const points = opening.createSpiralPoints(definition, 220);
    const firstThirty = points.slice(0, 31);
    for (let index = 1; index < firstThirty.length; index += 1) {
      assert.ok(
        firstThirty[index].radius <= firstThirty[index - 1].radius,
        `path moved outward at sample ${index}`,
      );
    }
  }
});
```

- [ ] **Step 5: Run the focused tests and commit**

Run:

```bash
node --test tests-makers/opening-animation.test.mjs
```

Expected: 3 tests pass, 0 fail.

Commit:

```bash
git add frontend/opening-animation.js tests-makers/opening-animation.test.mjs
git commit -m "feat: add opening animation contracts"
```

---

### Task 2: Opening Markup, Styles, and Build Assets

**Files:**
- Create: `frontend/opening-animation.css`
- Modify: `frontend/index.html`
- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: `window.ICON_SYSTEM` loaded before the opening controller runs.
- Produces: `#opening-stage`, `#opening-vortex-svg`,
  `#opening-token-layer`, `#opening-fragment-layer`,
  `#opening-identity-card`, and real-UI reveal targets.
- Produces: `.opening-active`, `.opening-finalizing`, and
  `.opening-revealed` body-state contracts.

- [ ] **Step 1: Write failing static integration tests**

Append to `tests-makers/frontend.test.mjs`:

```js
test("main game ships the opening stage in dependency order", async () => {
  const [html, build] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("scripts/build-makers.mjs", "utf8"),
  ]);

  assert.match(html, /<body class="opening-active">/);
  assert.match(html, /id="opening-stage"/);
  assert.match(html, /id="opening-identity-card"/);
  assert.ok(
    html.indexOf("icon-system.css") <
      html.indexOf("opening-animation.css"),
  );
  assert.ok(
    html.indexOf("anime.iife.min.js") <
      html.indexOf("opening-animation.js"),
  );
  assert.ok(
    html.indexOf("opening-animation.js") <
      html.indexOf("app.js"),
  );
  assert.match(build, /"opening-animation\.css"/);
  assert.match(build, /"opening-animation\.js"/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test --test-name-pattern="opening stage" tests-makers/frontend.test.mjs
```

Expected: FAIL because the opening assets and markup are absent.

- [ ] **Step 3: Add static semantic overlay markup**

Insert immediately after `<body class="opening-active">` in
`frontend/index.html`:

```html
<section id="opening-stage"
         class="opening-stage"
         role="dialog"
         aria-modal="true"
         aria-labelledby="opening-card-title">
  <svg id="opening-vortex-svg"
       class="opening-vortex-svg"
       viewBox="0 0 1000 760"
       preserveAspectRatio="none"
       aria-hidden="true">
    <g id="opening-feed-paths"></g>
    <g class="opening-infinity" transform="translate(500 296)">
      <path class="opening-infinity-under"
            d="M0 0C-55-78-168-78-168 0S-55 78 0 0C55-78 168-78 168 0S55 78 0 0Z"/>
      <path id="opening-infinity-main"
            class="opening-infinity-main"
            d="M0 0C-55-78-168-78-168 0S-55 78 0 0C55-78 168-78 168 0S55 78 0 0Z"/>
      <path id="opening-infinity-detail"
            class="opening-infinity-detail"
            d="M0 0C-55-78-168-78-168 0S-55 78 0 0C55-78 168-78 168 0S55 78 0 0Z"/>
    </g>
  </svg>
  <div id="opening-token-layer" aria-hidden="true"></div>
  <div id="opening-fragment-layer" aria-hidden="true"></div>
  <div id="opening-birth-layer" aria-hidden="true"></div>
  <div id="opening-identity-card"
       class="opening-identity-card"
       tabindex="-1">
    <div class="opening-card-kicker">PLAYER IDENTITY INITIALIZATION</div>
    <h1 id="opening-card-title">正在准备鹅厂身份</h1>
    <p id="opening-card-subtitle"></p>
    <div id="opening-card-body"></div>
    <div id="opening-card-actions" class="opening-card-actions"></div>
    <p id="opening-card-status" class="opening-card-status"
       role="status" aria-live="polite"></p>
  </div>
</section>
```

Keep the existing `#nick-modal`; it remains the post-entry topbar rename UI.

- [ ] **Step 4: Add focused opening styles and dependency tags**

Add to `<head>` after `icon-system.css`:

```html
<link rel="stylesheet"
      href="/opening-animation.css?v=20260804a" />
```

Add after the Anime.js vendor script and before `app.js`:

```html
<script src="/opening-animation.js?v=20260804a"></script>
```

Implement `frontend/opening-animation.css` with these required state rules:

```css
.opening-stage {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 39%, rgba(37, 215, 208, .17), transparent 26%),
    #f8f5ee;
  contain: layout paint style;
}

body.opening-active {
  overflow: hidden;
}

body.opening-active > .topbar {
  transform: translateY(-110%);
  opacity: 0;
}

body.opening-active > .layout > .sidebar {
  transform: translateX(110%);
  opacity: 0;
}

body.opening-active #hint {
  transform: translateY(24px) scale(.97);
  opacity: 0;
}

.opening-identity-card {
  position: absolute;
  left: 50%;
  bottom: 28px;
  width: min(440px, calc(100% - 36px));
  transform: translateX(-50%);
  padding: 20px 24px 18px;
  border: 1px solid rgba(21, 33, 58, .13);
  border-radius: 19px;
  background: rgba(255, 255, 255, .98);
  box-shadow: 0 18px 50px rgba(19, 30, 49, .19);
  text-align: center;
}

.opening-action-primary {
  min-width: 210px;
  min-height: 48px;
  border: 0;
  border-radius: 11px;
  background: #172239;
  color: #fff;
  font: 750 15px/1 system-ui, sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  .opening-feed-energy,
  .opening-core-orbit,
  .opening-infinity-detail {
    animation: none !important;
  }
}
```

Include responsive rules that keep the identity card visible above a
`min-height: 560px` viewport and reduce token sizes below `760px`.

- [ ] **Step 5: Add both opening assets to the build contract**

In `scripts/build-makers.mjs`, add:

```js
"opening-animation.css",
"opening-animation.js",
```

to `REQUIRED_ENTRIES`.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
node --test --test-name-pattern="opening stage" tests-makers/frontend.test.mjs
npm run build
```

Expected: focused test passes; build exits 0 and
`dist/opening-animation.js` plus `dist/opening-animation.css` exist.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/opening-animation.css \
  scripts/build-makers.mjs tests-makers/frontend.test.mjs
git commit -m "feat: add opening stage shell"
```

---

### Task 3: Identity Adapter and First-Time/Returning Branches

**Files:**
- Modify: `frontend/opening-animation.js`
- Modify: `frontend/app.js`
- Modify: `tests-makers/opening-animation.test.mjs`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes from `app.js`:

```js
{
  current(): { nickname: string, playerId: string },
  peek(): Promise<string>,
  claim(candidate: string): Promise<
    { accepted: boolean, nickname: string }
  >,
  continueCurrent(): Promise<
    { nickname: string, playerId: string }
  >,
  persist(nickname: string): {
    nickname: string,
    playerId: string
  }
}
```

- Produces: `OPENING_ANIMATION.start(options) -> Promise<{nickname: string, changed: boolean}>`.
- Produces: `OPENING_ANIMATION.identityModel(branch, nickname) -> {title, nickname, actions}`.
- Preserves: `openNickModal(false)` for topbar-initiated renaming after entry.

- [ ] **Step 1: Write failing branch-copy and integration tests**

Add to `tests-makers/opening-animation.test.mjs`:

```js
test("returning identity copy makes continue primary", async () => {
  const opening = await loadOpeningAnimation();
  const model = opening.identityModel("returning", "全力以赴的代码鹅");
  assert.equal(model.title, "欢迎回来");
  assert.equal(model.nickname, "全力以赴的代码鹅");
  assert.deepEqual(
    Array.from(model.actions, (action) => ({
      id: action.id,
      label: action.label,
      primary: action.primary,
    })),
    [
      { id: "continue", label: "继续使用", primary: true },
      { id: "change", label: "更改花名", primary: false },
    ],
  );
});

test("first-time identity copy has no continue shortcut", async () => {
  const opening = await loadOpeningAnimation();
  const model = opening.identityModel("first-time", "");
  assert.equal(model.title, "请确认你的花名");
  assert.equal(model.actions.some((action) => action.id === "continue"), false);
});
```

Add to `tests-makers/frontend.test.mjs`:

```js
test("app delegates startup identity to the opening controller", async () => {
  const app = await readFile("frontend/app.js", "utf8");
  assert.match(app, /function createOpeningIdentityAdapter\(\)/);
  assert.match(
    app,
    /await window\.OPENING_ANIMATION\.start\(\{[\s\S]*identity:/,
  );
  assert.doesNotMatch(
    app,
    /async function init\(\)[\s\S]*await ensureNickname\(\)/,
  );
  assert.match(app, /async function rerollNickname\(\)/);
  assert.match(app, /openNickModal\(false\)/);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
node --test tests-makers/opening-animation.test.mjs
node --test --test-name-pattern="startup identity" tests-makers/frontend.test.mjs
```

Expected: FAIL because `identityModel`, `start`, and the adapter are absent.

- [ ] **Step 3: Extract nickname operations without changing their behavior**

In `frontend/app.js`, add:

```js
async function peekNicknameCandidate() {
  try {
    const response = await fetch("/api/nickname/peek").then((value) =>
      value.json()
    );
    return response.nickname;
  } catch (_) {
    return "神秘鹅_" + Math.random().toString(36).slice(2, 5);
  }
}

async function claimNicknameCandidate(candidate) {
  try {
    const response = await fetch("/api/nickname/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: candidate }),
    }).then((value) => value.json());
    return {
      accepted: response.ok !== false,
      nickname: response.nickname || candidate,
    };
  } catch (_) {
    return { accepted: true, nickname: candidate };
  }
}

function persistNickname(nickname) {
  NICKNAME = String(nickname);
  NICK_ID = NICK_ID || generatePlayerId();
  localStorage.setItem("ic_nick", NICKNAME);
  localStorage.setItem("ic_nick_id", NICK_ID);
  updateNickDisplay();
  return { nickname: NICKNAME, playerId: NICK_ID };
}
```

Refactor `openNickModal()` to call these helpers. Preserve the current
replacement alert and second-confirmation requirement.

- [ ] **Step 4: Add the application identity adapter**

```js
function createOpeningIdentityAdapter() {
  return {
    current() {
      return { nickname: NICKNAME, playerId: NICK_ID };
    },
    peek: peekNicknameCandidate,
    claim: claimNicknameCandidate,
    async continueCurrent() {
      if (!NICK_ID) persistNickname(NICKNAME);
      try {
        await fetch("/api/nickname/touch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: NICKNAME }),
        });
      } catch (_) { /* best-effort touch */ }
      return { nickname: NICKNAME, playerId: NICK_ID };
    },
    persist: persistNickname,
  };
}
```

- [ ] **Step 5: Implement identity-card models and button state changes**

In `frontend/opening-animation.js`, add pure `identityModel()` and DOM renderers
that use `textContent` for all nickname values. Returning state renders:

```js
[
  { id: "continue", label: "继续使用", primary: true },
  { id: "change", label: "更改花名", primary: false },
]
```

Change state renders:

```js
[
  { id: "reroll", label: "再来一个", primary: false },
  { id: "cancel", label: "取消", primary: false },
  { id: "confirm", label: "确认更改", primary: true },
]
```

First-time state omits `cancel` and uses `确认花名并进入` as the primary action.
Disable all card buttons during `peek`, `claim`, and finale work.

- [ ] **Step 6: Start the opening from `init()`**

Replace the startup `ensureNickname()` call with:

```js
const openingResult = await window.OPENING_ANIMATION.start({
  document,
  anime: window.anime,
  iconSystem: window.ICON_SYSTEM,
  starterElements: Object.values(state.elements).filter(
    (element) => element.is_starter,
  ),
  identity: createOpeningIdentityAdapter(),
  revealTargets: {
    topbar: document.querySelector(".topbar"),
    sidebar: document.querySelector(".sidebar"),
    hint: document.getElementById("hint"),
  },
});
NICKNAME = openingResult.nickname;
updateNickDisplay();
```

Run this after `loadElements()` and icon hydration but before binding workspace
pointer events. Wrap it so controller failure removes `opening-active` and the
overlay, then falls back to `ensureNickname()`.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
node --test tests-makers/opening-animation.test.mjs
node --test --test-name-pattern="startup identity" tests-makers/frontend.test.mjs
```

Expected: all focused tests pass.

Commit:

```bash
git add frontend/opening-animation.js frontend/app.js \
  tests-makers/opening-animation.test.mjs tests-makers/frontend.test.mjs
git commit -m "feat: integrate opening identity flow"
```

---

### Task 4: Vortex Runtime, Production Tokens, and Performance Bounds

**Files:**
- Modify: `frontend/opening-animation.js`
- Modify: `frontend/opening-animation.css`
- Modify: `tests-makers/opening-animation.test.mjs`

**Interfaces:**
- Consumes: `starterElements` normalized by `app.js`.
- Consumes: `iconSystem.renderElement(document, target, payload)`.
- Produces: controller-owned `pause()`, `resume()`, and `destroy()` cleanup
  operations used internally by `start()`.
- Maintains: a maximum of 36 token nodes and 48 fragment nodes.

- [ ] **Step 1: Write failing source-contract tests for the production renderer and performance rules**

```js
test("runtime uses production token rendering and cached path samples", async () => {
  const [source, styles] = await Promise.all([
    readFile("frontend/opening-animation.js", "utf8"),
    readFile("frontend/opening-animation.css", "utf8"),
  ]);
  assert.match(source, /iconSystem\.renderElement\(documentRef,\s*target,/);
  assert.match(source, /samplePath\(/);
  assert.doesNotMatch(
    source,
    /function renderFrame[\s\S]*getTotalLength\(/,
  );
  assert.doesNotMatch(
    source,
    /function renderFrame[\s\S]*getPointAtLength\(/,
  );
  assert.doesNotMatch(
    source,
    /function renderFrame[\s\S]*(offsetWidth|getBoundingClientRect)\(/,
  );
  assert.doesNotMatch(styles, /backdrop-filter/);
  assert.doesNotMatch(source, /https?:\/\/.*(?:emoji|icon|anime)/);
});

test("runtime declares visibility and reduced-motion handling", async () => {
  const source = await readFile("frontend/opening-animation.js", "utf8");
  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /documentRef\.hidden/);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
node --test --test-name-pattern="runtime" tests-makers/opening-animation.test.mjs
```

Expected: FAIL because the runtime is not implemented.

- [ ] **Step 3: Build four cached feeder paths and prefill the active stage**

Use the four definitions from Task 1. For each path:

1. Set SVG `d` from `createSpiralPoints()`.
2. Cache `samplePath(path, CONFIG.pathSamples)` once.
3. Clone a lightweight dashed energy path.

Seed 18 tokens at progress values from `0.055` through `0.915`, distributed
round-robin across the four paths. Seed 16 fragments from `0.04` through `0.94`.
Assign backdated start times so the first rendered frame is already active:

```js
const progress = 0.055 + index / CONFIG.prefilledTokens * 0.86;
motion.trackStartedAt =
  performanceNow() - progress * CONFIG.tokenTravelMs;
```

- [ ] **Step 4: Render every formal token through the production Icon system**

Create a target with `.opening-token.element`, then call:

```js
iconSystem.renderElement(documentRef, target, {
  name: element.name,
  emoji: element.emoji,
  category: element.category,
  icon: element.icon,
  isStarter: true,
  size: "detail",
});
```

Add a separate `.opening-token-name` node only if the production renderer does
not already create `.name`. Do not insert API or nickname text through
`innerHTML`.

- [ ] **Step 5: Implement the center-origin lifecycle**

Every 720 ms:

1. Randomly select one starter element.
2. Create it at the center with a birth-ring animation.
3. Select feeder paths round-robin.
4. Read the exact cached first sample as the throw endpoint.
5. Animate a parabolic throw with Web Animations.
6. Call `throwAnimation.cancel()` on completion.
7. Set `trackStartedAt = performanceNow()`.
8. Move the same node through cached samples for 13,200 ms.
9. Contract at the final sample and return the node to the bounded pool.

The first 31 `radius` values for every feeder definition must remain
non-increasing, as enforced by Task 1.

- [ ] **Step 6: Implement a bounded, composited render loop**

Use a 40 fps cap and cached samples:

```js
const FRAME_INTERVAL_MS = 25;
let lastFrameAt = 0;

function renderFrame(now) {
  if (now - lastFrameAt < FRAME_INTERVAL_MS) {
    frameId = requestFrame(renderFrame);
    return;
  }
  lastFrameAt = now;
  for (let index = motions.length - 1; index >= 0; index -= 1) {
    const motion = motions[index];
    const progress = Math.min(
      1,
      (now - motion.trackStartedAt) / motion.duration,
    );
    const sampleIndex = Math.min(
      CONFIG.pathSamples - 1,
      Math.floor(progress * CONFIG.pathSamples),
    );
    const sample = motion.samples[sampleIndex];
    motion.node.style.transform =
      `translate3d(${sample.x}px, ${sample.y}px, 0) ` +
      `translate(-50%, -50%) rotate(${sample.angle}rad)`;
  }
  frameId = requestFrame(renderFrame);
}
```

Cache viewport scale on start and resize; do not read layout in this loop.

- [ ] **Step 7: Add Anime.js infinity effects and lifecycle cleanup**

Use:

```js
const mainDrawable = anime.svg.createDrawable("#opening-infinity-main");
const detailDrawable = anime.svg.createDrawable(
  "#opening-infinity-detail",
);
animations.add(anime.animate(mainDrawable, {
  draw: ["0 0", "0 1", "1 1", "0 0"],
  duration: 5_200,
  ease: "inOutQuad",
  loop: true,
}));
animations.add(anime.animate(detailDrawable, {
  draw: ["0 0", ".12 .48", ".58 1", "1 1"],
  duration: 3_100,
  delay: 600,
  ease: "inOutSine",
  loop: true,
}));
```

On `visibilitychange`, pause Anime instances, the render loop, and emission
timer while `documentRef.hidden`; resume without accumulating elapsed hidden
time. `destroy()` cancels timers, frame IDs, Web Animations, Anime instances,
resize listeners, visibility listeners, and removes all pooled nodes.

- [ ] **Step 8: Implement reduced-motion and missing-Anime modes**

When reduced motion matches or `anime?.svg?.createDrawable` is unavailable:

- create six stationary production tokens;
- show the static infinity underlay;
- skip emissions and the render loop;
- retain the same identity behavior;
- use a 180 ms crossfade finale.

- [ ] **Step 9: Run focused tests and commit**

Run:

```bash
node --test tests-makers/opening-animation.test.mjs
```

Expected: all opening tests pass.

Commit:

```bash
git add frontend/opening-animation.js frontend/opening-animation.css \
  tests-makers/opening-animation.test.mjs
git commit -m "feat: animate the opening vortex"
```

---

### Task 5: Finale into the Real Game UI

**Files:**
- Modify: `frontend/opening-animation.js`
- Modify: `frontend/opening-animation.css`
- Modify: `tests-makers/opening-animation.test.mjs`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: `revealTargets.topbar`, `revealTargets.sidebar`, and
  `revealTargets.hint`.
- Resolves: `start()` only after the overlay has been removed and input has
  been restored.

- [ ] **Step 1: Write failing finale contract tests**

```js
test("finale targets real game UI and removes the overlay", async () => {
  const source = await readFile("frontend/opening-animation.js", "utf8");
  assert.match(source, /revealTargets\.topbar/);
  assert.match(source, /revealTargets\.sidebar/);
  assert.match(source, /revealTargets\.hint/);
  assert.match(source, /stage\.remove\(\)/);
  assert.match(source, /classList\.remove\("opening-active"\)/);
  assert.doesNotMatch(source, /mock-(?:topbar|sidebar)/);
});

test("identity completion is the only normal finale trigger", async () => {
  const source = await readFile("frontend/opening-animation.js", "utf8");
  assert.match(source, /case "continue"/);
  assert.match(source, /case "confirm"/);
  assert.doesNotMatch(source, /setTimeout\([^)]*runFinale/);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
node --test --test-name-pattern="finale" tests-makers/opening-animation.test.mjs
```

Expected: FAIL because finale orchestration is absent.

- [ ] **Step 3: Implement deterministic finale sequencing**

`runFinale(result)` must:

1. set a `finalizing` guard;
2. disable card buttons;
3. clear emission scheduling;
4. animate all active tokens/fragments into the core with a bounded
   0–220 ms stagger;
5. fade feeder paths and collapse infinity animations;
6. add `opening-finalizing` to `body`;
7. remove `opening-active` so CSS transitions reveal the real targets;
8. wait for the longest target transition or 900 ms fallback;
9. call `destroy({ removeStage: true })`;
10. focus `#workspace`;
11. resolve `start()` with `{ nickname, changed }`.

Do not create duplicate topbar/sidebar markup.

- [ ] **Step 4: Add real-target transition styles**

```css
.topbar,
.sidebar,
#hint {
  transition:
    transform .68s cubic-bezier(.2, .8, .25, 1),
    opacity .5s ease;
}

body.opening-finalizing > .topbar,
body.opening-finalizing > .layout > .sidebar,
body.opening-finalizing #hint {
  transform: none;
  opacity: 1;
}

.opening-stage.is-finalizing {
  pointer-events: none;
}
```

The controller removes `opening-finalizing` after the real targets settle.

- [ ] **Step 5: Add focus trapping and escape behavior**

While the overlay is active:

- cycle `Tab` and `Shift+Tab` inside the identity card;
- do not close on `Escape` for first-time players;
- in returning change mode, `Escape` returns to the welcome card;
- after finale, remove the keydown listener and focus the workspace.

- [ ] **Step 6: Run focused and full Node tests**

Run:

```bash
node --test --test-name-pattern="finale" tests-makers/opening-animation.test.mjs
npm test
```

Expected: focused finale tests pass; full Node suite has 0 failures.

- [ ] **Step 7: Commit**

```bash
git add frontend/opening-animation.js frontend/opening-animation.css \
  tests-makers/opening-animation.test.mjs tests-makers/frontend.test.mjs
git commit -m "feat: reveal the game from the opening"
```

---

### Task 6: Browser Verification and Repository Gate

**Files:**
- Modify only if verification exposes a defect in the files already listed.

**Interfaces:**
- Validates the complete behavior defined by the design; produces no new API.

- [ ] **Step 1: Start the project with the required local workflow**

Run:

```bash
npm run dev
```

Wait for FastAPI startup, then verify:

```bash
curl --noproxy '*' http://127.0.0.1:8000/api/health
```

Expected: HTTP 200 and JSON reporting Redis `ok`.

- [ ] **Step 2: Verify first-time behavior in a clean browser context**

Clear only `ic_nick` and `ic_nick_id` in a disposable browser context, reload
`http://127.0.0.1:8000/`, and confirm:

- the first frame contains prefilled tokens at multiple track positions;
- no `继续使用` button appears;
- reroll changes the candidate;
- confirmation claims and persists a name;
- the finale removes the overlay and reveals the real UI.

- [ ] **Step 3: Verify returning behavior**

Reload without clearing storage and confirm:

- the opening appears again;
- current nickname is shown;
- `继续使用` is the dominant action;
- `更改花名` enters candidate mode;
- cancel returns to the welcome card;
- continue performs no claim request and preserves the nickname;
- both continue and replacement confirmation run the same finale.

- [ ] **Step 4: Verify motion, performance, and resilience**

Confirm in browser tooling:

- a newly emitted token lands on the exact feeder start point;
- its first 31 sampled radii do not increase;
- it reaches the core over approximately 13.2 seconds;
- hiding the tab pauses emission and motion;
- repeated reloads leave no duplicate overlay or active timer;
- reduced-motion mode uses the static presentation;
- temporarily making `window.anime` unavailable still leaves identity actions
  usable and entry possible;
- desktop and mobile layouts keep the card fully visible.

- [ ] **Step 5: Run the full required verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
git diff --stat e96e9c1..HEAD
```

Confirm only the approved opening files, tests, build list, and app integration
are changed. Do not stage unrelated files.

- [ ] **Step 7: Record the deployment-maintainer follow-up**

Report that `npm run makers:build` remains required before deployment and was
not substituted with local EdgeOne authentication or association.
