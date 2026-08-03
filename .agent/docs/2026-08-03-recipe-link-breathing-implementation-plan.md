# Recipe Link Synchronized Breathing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start one synchronized Anime.js breathing loop across all relationship lines incident to the hovered canvas element after every one-shot draw in that hover group has completed.

**Architecture:** Keep all animation ownership inside the existing `RECIPE_LINKS` controller. A hover-generation token and draw-completion barrier coordinate finite per-edge draws with one controller-owned infinite group-opacity animation; cancellation invalidates stale callbacks and clears Anime.js inline styles.

**Tech Stack:** Vanilla JavaScript, SVG, CSS transitions, vendored Anime.js 4.5.0 IIFE API, pytest browser runtime tests, Node built-in test runner, Docker Compose local preview.

## Global Constraints

- Only links incident to the currently hovered exact canvas element breathe.
- Resting links remain extremely faint and static.
- Incident links complete their existing one-shot path drawings before breathing starts.
- All incident relationship groups participate in one Anime.js call and breathe in exact synchronization.
- Group opacity alternates between `0.72` and `1`.
- Each half-cycle lasts `700ms`, producing an approximately `1400ms` full breathing cycle.
- Breathing uses `ease: "inOutSine"`, `loop: true`, and `alternate: true`.
- Global `hit_count` continues to control each link's width, highlighted opacity, glow, and draw duration.
- Stroke width does not pulse.
- Pointer leave, hover switching, invalidated active sets, `clear()`, and `destroy()` cancel breathing and remove Anime.js-owned inline group opacity.
- Stale draw completion callbacks must never start an old hover group's breathing.
- Geometry-only updates do not restart drawing or breathing.
- Missing Anime.js and `prefers-reduced-motion: reduce` preserve static active emphasis without drawing or breathing.
- Do not add dependencies or change backend/API schemas.
- Advance the eight cache-coupled main-page assets together from `v=20260803c` to `v=20260803d`.
- Preserve the public controller API: `sync({ recipes, elements })`, `scheduleGeometryUpdate(elements)`, `clear()`, and `destroy()`.
- Do not touch or stage unrelated working-tree changes.

---

### Task 1: Start One Synchronized Breath After the Draw Barrier

**Files:**
- Modify: `tests/test_combine_feedback.py:1523-1644`
- Modify: `frontend/recipe-links.js:180-285`

**Interfaces:**
- Consumes: `window.anime.animate(targets, parameters)`, `window.anime.svg.createDrawable(path)`, edge fields `group`, `draw`, `leftId`, and `rightId`.
- Produces: controller-owned `breathingAnimation`, `breathingGroups`, and `animationGeneration`; `cancelBreathing()`, `startBreathing(groups, generation, hoveredId)`, `startDraw(edge, hoveredId, generation, onComplete)`, and `startActiveAnimations()` helpers.

- [ ] **Step 1: Add a failing browser test for the draw-completion barrier and single grouped breath**

Add `test_recipe_links_breathe_together_only_after_all_incident_draws_complete`.
Use a fake Anime.js boundary that separates finite draw calls from the grouped
breathing call:

```javascript
var drawCalls = [];
var breathingCalls = [];
window.anime = {
  svg: {
    createDrawable: function (path) {
      return [{ path: path, draw: "0 0" }];
    }
  },
  animate: function (targets, options) {
    if (options.loop === true) {
      var breathing = {
        targets: Array.from(targets),
        options: options,
        cancelCalls: 0,
        cancel: function () { this.cancelCalls += 1; }
      };
      breathingCalls.push(breathing);
      return breathing;
    }
    var draw = {
      targets: targets,
      options: options,
      cancelCalls: 0,
      cancel: function () { this.cancelCalls += 1; }
    };
    drawCalls.push(draw);
    return draw;
  }
};
```

Create recipes `A + B`, `A + C`, and unrelated `B + C`, hover A, and collect
the three SVG groups. Before invoking any completion callback assert no breath
exists. Invoke the first draw's `options.onComplete()` and assert no breath.
Invoke the second draw's callback and return:

```javascript
return {
  drawCount: drawCalls.length,
  breathingBeforeAnyComplete: beforeAny,
  breathingAfterFirstComplete: afterFirst,
  breathingCount: breathingCalls.length,
  breathingRecipeKeys: breathingCalls[0].targets
    .map(function (group) { return group.dataset.recipeKey; })
    .sort(),
  opacity: breathingCalls[0].options.opacity,
  duration: breathingCalls[0].options.duration,
  ease: breathingCalls[0].options.ease,
  loop: breathingCalls[0].options.loop,
  alternate: breathingCalls[0].options.alternate
};
```

Assert hand-derived behavior:

```python
assert actual == {
    "drawCount": 2,
    "breathingBeforeAnyComplete": 0,
    "breathingAfterFirstComplete": 0,
    "breathingCount": 1,
    "breathingRecipeKeys": ["A + B", "A + C"],
    "opacity": [0.72, 1],
    "duration": 700,
    "ease": "inOutSine",
    "loop": True,
    "alternate": True,
}
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_recipe_links_breathe_together_only_after_all_incident_draws_complete \
  -q
```

Expected: FAIL because draw animations have no completion callback and no
grouped breathing animation is created.

- [ ] **Step 3: Add controller-level breathing ownership and cleanup**

Inside `create(workspace)`, next to `activeElementId`, add:

```javascript
let breathingAnimation = null;
let breathingGroups = [];
let animationGeneration = 0;
```

Add cleanup before `startDraw()`:

```javascript
function cancelBreathing() {
  breathingAnimation?.cancel?.();
  breathingAnimation = null;
  breathingGroups.forEach((group) => {
    group.style.removeProperty("opacity");
  });
  breathingGroups = [];
}
```

Add the grouped breathing starter:

```javascript
function startBreathing(groups, generation, hoveredId) {
  if (
    destroyed
    || reducedMotion
    || generation !== animationGeneration
    || hoveredId !== activeElementId
    || groups.length === 0
  ) return;
  const anime = global.anime;
  if (typeof anime?.animate !== "function") return;
  cancelBreathing();
  breathingGroups = groups;
  breathingAnimation = anime.animate(groups, {
    opacity: [0.72, 1],
    duration: 700,
    ease: "inOutSine",
    loop: true,
    alternate: true,
  });
}
```

- [ ] **Step 4: Give finite draw animations a completion callback**

Change the helper signature and Anime.js parameters:

```javascript
function startDraw(edge, hoveredId, generation, onComplete) {
  cancelDraw(edge);
  if (reducedMotion) return false;
  const anime = global.anime;
  if (
    typeof anime?.animate !== "function"
    || typeof anime?.svg?.createDrawable !== "function"
  ) return false;
  const drawable = anime.svg.createDrawable(edge.draw);
  const forward = edge.leftId === hoveredId;
  edge.animation = anime.animate(drawable, {
    draw: forward ? ["0 0", "0 1"] : ["1 1", "0 1"],
    duration: Number(
      edge.group.style.getPropertyValue("--recipe-link-duration"),
    ),
    ease: "outQuad",
    onComplete: () => {
      edge.animation = null;
      onComplete(edge, generation);
    },
  });
  return true;
}
```

The `Boolean` return states whether a finite draw was actually started.

- [ ] **Step 5: Replace per-edge immediate starts with an active draw barrier**

Add:

```javascript
function activeEdgesFor(id) {
  return Array.from(edges.values()).filter(
    (edge) => edge.leftId === id || edge.rightId === id,
  );
}

function startActiveAnimations() {
  cancelBreathing();
  animationGeneration += 1;
  const generation = animationGeneration;
  const hoveredId = activeElementId;
  if (hoveredId === null) return;
  const activeEdges = activeEdgesFor(hoveredId);
  let remaining = 0;
  const completed = new Set();
  const onComplete = (edge, completedGeneration) => {
    if (
      completedGeneration !== animationGeneration
      || hoveredId !== activeElementId
      || !edges.has(edge.key)
      || completed.has(edge.key)
    ) return;
    completed.add(edge.key);
    remaining -= 1;
    if (remaining === 0) {
      const current = activeEdgesFor(hoveredId);
      if (
        current.length === activeEdges.length
        && current.every((edge) => completed.has(edge.key))
      ) {
        startBreathing(
          current.map((edge) => edge.group),
          generation,
          hoveredId,
        );
      }
    }
  };
  activeEdges.forEach((edge) => {
    if (startDraw(edge, hoveredId, generation, onComplete)) {
      remaining += 1;
    }
  });
}
```

Change `applyActiveState(playDraw)` so it only owns classes and cancellation:

```javascript
if (!incident) cancelDraw(edge);
```

Change `setActiveElement()`:

```javascript
function setActiveElement(id) {
  const nextId = id ? String(id) : null;
  if (nextId === activeElementId) return;
  animationGeneration += 1;
  cancelBreathing();
  activeElementId = nextId;
  applyActiveState(false);
  if (activeElementId !== null) startActiveAnimations();
}
```

- [ ] **Step 6: Run the new barrier test and existing direction tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "breathe_together or hover_draws or draw_from_reverse" -q
```

Expected: all selected tests PASS. Update existing Anime fakes to accept
`options.onComplete` without automatically invoking it; do not make old tests
complete draws unless they explicitly test the post-draw phase.

- [ ] **Step 7: Commit Task 1**

Inspect status and stage only owned files:

```bash
git status --short
git diff -- frontend/recipe-links.js tests/test_combine_feedback.py
git add frontend/recipe-links.js tests/test_combine_feedback.py
git commit -m "feat: breathe active recipe links after drawing"
```

---

### Task 2: Cancel Stale Breathing Across Hover and Data Lifecycles

**Files:**
- Modify: `tests/test_combine_feedback.py:1646-1795,1962-2072`
- Modify: `frontend/recipe-links.js:262-405`

**Interfaces:**
- Consumes: `cancelBreathing()`, `animationGeneration`, `breathingGroups`, `activeEdgesFor(id)`, and existing controller lifecycle methods.
- Produces: `activeEdgeKey(edge)`, `activeEdgeSignature(id)`, and lifecycle rules that preserve breathing across unchanged synchronization while canceling invalid groups.

- [ ] **Step 1: Add a failing stale-completion and hover-switch browser test**

Add `test_recipe_links_hover_switch_cancels_breathing_and_ignores_stale_draws`.
Create `A + B` and `B + C`. The fake stores draw handles and breathing handles.
Execute:

1. hover A;
2. complete A's only draw to start breathing A+B;
3. hover B, which must cancel A's breathing and start two new draws;
4. invoke A's old completion callback again;
5. complete B's two current draws;
6. pointer-out from B.

Return and assert:

```python
assert actual == {
    "breathingCalls": 2,
    "firstBreathingKeys": ["A + B"],
    "secondBreathingKeys": ["A + B", "B + C"],
    "breathingCancelCounts": [1, 1],
    "inlineOpacityAfterLeave": ["", ""],
    "activeAfterLeave": 0,
}
```

The second breath must not start until both B draws complete. Re-invoking the
old callback must not add a third breathing call.

- [ ] **Step 2: Run the hover-switch test and verify RED**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_recipe_links_hover_switch_cancels_breathing_and_ignores_stale_draws \
  -q
```

Expected: FAIL until hover generations cancel breathing and stale callbacks
cannot cross ownership.

- [ ] **Step 3: Add a failing lifecycle test for sync, geometry, clear, and destroy**

Add `test_recipe_links_breathing_survives_geometry_but_cancels_invalid_lifecycles`.
After starting breathing for A+B:

- call `scheduleGeometryUpdate()` and assert neither draw nor breathing call
  count changes;
- call `sync()` with the exact same active edge set and assert breathing is not
  canceled or restarted;
- call `sync()` without active endpoint A and assert breathing is canceled and
  inline opacity cleared;
- recreate links, hover again, finish drawing, call `clear()`, and verify the
  new breathing handle is canceled;
- recreate links, hover again, finish drawing, call `destroy()`, and verify the
  final breathing handle is canceled.

Use literal expectations:

```python
assert actual["drawCallsAfterGeometry"] == actual["drawCallsBeforeGeometry"]
assert actual["breathingCallsAfterGeometry"] == 1
assert actual["firstCancelAfterSameSync"] == 0
assert actual["firstCancelAfterInvalidSync"] == 1
assert actual["inlineOpacityAfterInvalidSync"] == ""
assert actual["clearBreathingCancelCalls"] == 1
assert actual["destroyBreathingCancelCalls"] == 1
```

- [ ] **Step 4: Run the lifecycle test and verify RED**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_recipe_links_breathing_survives_geometry_but_cancels_invalid_lifecycles \
  -q
```

Expected: FAIL because `sync()`, `clear()`, and `destroy()` do not yet own
breathing cleanup and no active-set signature protects unchanged synchronization.

- [ ] **Step 5: Track the active edge-set signature**

Add:

```javascript
function activeEdgeSignature(id) {
  if (id === null) return "";
  return activeEdgesFor(id)
    .map((edge) => edge.key)
    .sort()
    .join("\u0001");
}
```

At the start of `sync()` capture:

```javascript
const previousActiveId = activeElementId;
const previousActiveSignature = activeEdgeSignature(activeElementId);
```

After edge reconciliation, before `applyActiveState(false)`, compare:

```javascript
const nextActiveSignature = activeEdgeSignature(activeElementId);
if (
  previousActiveId !== activeElementId
  || previousActiveSignature !== nextActiveSignature
) {
  animationGeneration += 1;
  cancelBreathing();
}
```

This preserves the current breathing owner when the authoritative active edge
set is unchanged and cancels it when synchronization invalidates the set.

- [ ] **Step 6: Complete lifecycle cancellation**

At the start of `clear()`:

```javascript
animationGeneration += 1;
cancelBreathing();
```

At the start of `destroy()`, before removing SVG groups:

```javascript
animationGeneration += 1;
cancelBreathing();
```

Pointer leave and direct hover switching already call these ownership steps
through `setActiveElement()`.

- [ ] **Step 7: Run lifecycle, cancellation, and geometry tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_links and (breathing or cancel_draws or sync_clears or update_active_geometry or clear_resets)" \
  -q
```

Expected: all selected tests PASS with exact per-handle cancellation counts.

- [ ] **Step 8: Commit Task 2**

```bash
git status --short
git diff --check
git add frontend/recipe-links.js tests/test_combine_feedback.py
git commit -m "fix: cancel stale recipe link breathing"
```

---

### Task 3: Preserve Fallbacks and Verify the Running Preview

**Files:**
- Modify: `tests/test_combine_feedback.py:1798-2025`
- Modify: `tests-makers/frontend.test.mjs:225-255`
- Modify: `frontend/index.html:8-10,190-198`
- Verify: `frontend/recipe-links.js`
- Verify: `frontend/recipe-links.css`

**Interfaces:**
- Consumes: completed breathing controller and existing browser harness `reduced_motion=True`.
- Produces: regression evidence that missing Anime.js and reduced motion create no breathing, plus repository and running-preview verification.

- [ ] **Step 1: Extend fallback tests to distinguish draw and breathing calls**

In the missing-Anime test, continue setting `window.anime = undefined` and
assert:

```python
assert actual == {
    "active": 1,
    "drawStyle": None,
    "groupInlineOpacity": "",
    "emphasisOpacity": 0.54,
}
```

In the reduced-motion test, make the fake classify calls:

```javascript
var drawCalls = 0;
var breathingCalls = 0;
window.anime = {
  svg: {
    createDrawable: function () {
      return [{ draw: "0 0" }];
    }
  },
  animate: function (targets, options) {
    if (options.loop === true) breathingCalls += 1;
    else drawCalls += 1;
    return { cancel: function () {} };
  }
};
```

Assert both counts are zero and static emphasis remains visible.

- [ ] **Step 2: Run fallback tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_links and (falls_back or reduced_motion)" -q
```

Expected: PASS. These tests are regression characterization because the
controller's pre-existing reduced-motion and missing-Anime guards already
define the desired fallback.

- [ ] **Step 3: Advance the shared browser cache version**

Before the browser slice, update the eight cache-coupled URLs in
`frontend/index.html` from `v=20260803c` to `v=20260803d`:

```text
/icon-system.css
/style.css
/recipe-links.css
/icon-system.js
/combine-feedback.js
/effects.js
/recipe-links.js
/app.js
```

Update the Node contract:

```javascript
assert.match(html, /recipe-links\.css\?v=20260803d/);
assert.match(html, /recipe-links\.js\?v=20260803d/);
```

Run:

```bash
node --test --test-concurrency=1 tests-makers/frontend.test.mjs
```

Expected: PASS, including Anime-before-recipe-links ordering and exact cache
version assertions.

- [ ] **Step 4: Run the complete recipe-link browser slice**

Run outside the sandbox if Chromium Crashpad socket permissions fail:

```bash
python3 -m pytest tests/test_combine_feedback.py -k recipe_links -q
```

Expected: all recipe-link tests PASS with no warnings or browser errors.

- [ ] **Step 5: Run required repository verification**

Run each command separately and record the exit status:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected for feature-owned code: no recipe-link or build failures. If the
shared checkout still has unrelated community failures, report their exact test
names and do not edit those files.

- [ ] **Step 6: Rebuild and restart the Docker local preview**

The project `.env` already exists. Use the repository's local workflow:

```bash
npm run dev
```

Keep the process running. Do not use EdgeOne login, project association,
Makers KV, or an Edge Function dev server.

- [ ] **Step 7: Verify health and deployed assets**

Run:

```bash
curl --noproxy '*' --fail --silent --show-error \
  http://127.0.0.1:8000/api/health
```

Expected: JSON reports `"redis":"ok"`, `"llm":"configured"`, and
`"app_env":"dev"`.

Verify the externally reachable address serves the exact current assets:

```bash
curl --noproxy '*' --fail --silent --show-error \
  'http://21.214.53.194:8000/recipe-links.js?v=20260803d' | sha256sum
sha256sum frontend/recipe-links.js
curl --noproxy '*' --fail --silent --show-error \
  'http://21.214.53.194:8000/recipe-links.css?v=20260803d' | sha256sum
sha256sum frontend/recipe-links.css
```

Expected: remote and local SHA-256 values match for both assets.

- [ ] **Step 8: Commit fallback and delivery changes**

Commit only the owned fallback and delivery files:

```bash
git add frontend/index.html tests/test_combine_feedback.py tests-makers/frontend.test.mjs
git commit -m "test: cover recipe link breathing delivery"
```

- [ ] **Step 9: Report the maintainer-only production check**

Do not deploy or authenticate to EdgeOne. Report that the deployment maintainer
still runs:

```bash
npm run makers:build
```
