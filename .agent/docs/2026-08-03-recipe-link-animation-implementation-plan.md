# Recipe Link Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn known recipe relationships into a faint static SVG network that highlights and draws only the hovered element's incident links, with visual strength derived from global combination count.

**Architecture:** Keep relationship ownership inside the existing `RECIPE_LINKS` controller. Expand each SVG edge into static, emphasis, and drawable paths; use delegated workspace pointer events to activate incident edges; use the vendored Anime.js 4.5.0 `svg.createDrawable()` API for one-shot drawing while CSS owns resting/highlight/fade transitions.

**Tech Stack:** Vanilla JavaScript, SVG, CSS custom properties and transitions, Anime.js 4.5.0 IIFE bundle, pytest browser runtime tests, Node built-in test runner.

## Global Constraints

- A line represents only an already-known recipe between two ingredient names currently on the canvas.
- Use one neutral accent color; do not encode rarity or depth through color.
- At rest, all links are extremely faint and static, with no drawing or looping animation.
- Hovering an exact canvas element highlights only its incident links and starts one-shot drawing from that endpoint.
- Global `hit_count` controls bounded width, highlighted opacity, glow, and drawing duration at the thresholds 1–2, 3–7, 8–19, 20–39, and 40+.
- Pointer leave begins a 400–600 ms fade to the resting network; it does not reverse-draw the path.
- Geometry updates during drag do not replay drawing.
- `prefers-reduced-motion: reduce` disables Anime.js drawing and preserves static relationship emphasis.
- Missing Anime.js degrades to CSS highlighting without breaking canvas behavior.
- Do not add dependencies; use `frontend/vendor/anime.iife.min.js`.
- Preserve the public controller API: `sync({ recipes, elements })`, `scheduleGeometryUpdate(elements)`, `clear()`, and `destroy()`.
- Do not touch or stage unrelated working-tree modifications; inspect status
  immediately before each edit and commit.

---

### Task 1: Specify Resting Network and Popularity Profiles

**Files:**
- Modify: `tests/test_combine_feedback.py:1330-1520`
- Modify: `frontend/recipe-links.js:5-198`
- Modify: `frontend/recipe-links.css:1-56`

**Interfaces:**
- Consumes: recipe snapshots shaped as `{ key, a, b, hit_count, depth }`.
- Produces: each `.recipe-link` with `data-hit-count`, CSS variables `--recipe-link-width`, `--recipe-link-opacity`, `--recipe-link-glow`, and `--recipe-link-duration`, plus `.recipe-link-base`, `.recipe-link-emphasis`, and `.recipe-link-draw` paths.

- [ ] **Step 1: Change the browser tests to describe a neutral, static, three-path edge**

Update `test_recipe_links_expand_all_discovered_instance_pairs` so it expects all
seven groups to contain one base, one emphasis, and one draw path:

```python
assert actual == {
    "groups": 7,
    "basePaths": 7,
    "emphasisPaths": 7,
    "drawPaths": 7,
    "selfLinks": 1,
    "svgPointerEvents": "none",
}
```

In the browser script, replace the old `flowPaths` query with:

```javascript
emphasisPaths:
  workspace.querySelectorAll(".recipe-link-emphasis").length,
drawPaths:
  workspace.querySelectorAll(".recipe-link-draw").length,
```

Update `test_recipe_links_scale_to_40_update_geometry_and_clean_up` to remove
rarity expectations and capture the computed base animation:

```javascript
var base = group.querySelector(".recipe-link-base");
return {
  width: Number(group.style.getPropertyValue("--recipe-link-width")),
  opacity: Number(group.style.getPropertyValue("--recipe-link-opacity")),
  glow: Number(group.style.getPropertyValue("--recipe-link-glow")),
  duration: Number(group.style.getPropertyValue("--recipe-link-duration")),
  color: group.style.getPropertyValue("--recipe-link-color"),
  baseAnimation: getComputedStyle(base).animationName
};
```

Assert a single color, monotonic capped profiles, and no resting animation:

```python
assert len({row["color"] for row in rows}) == 1
assert all(row["baseAnimation"] == "none" for row in rows)
assert [row["width"] for row in rows[:5]] == sorted(
    row["width"] for row in rows[:5]
)
assert [row["opacity"] for row in rows[:5]] == sorted(
    row["opacity"] for row in rows[:5]
)
assert rows[4] == rows[5]
assert rows[0] == rows[6]
```

- [ ] **Step 2: Run the focused tests and verify the old two-path, rarity-colored implementation fails**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_recipe_links_expand_all_discovered_instance_pairs \
  tests/test_combine_feedback.py::test_recipe_links_scale_to_40_update_geometry_and_clean_up \
  -q
```

Expected: FAIL because `.recipe-link-emphasis` and `.recipe-link-draw` do not
exist and groups still receive rarity colors.

- [ ] **Step 3: Replace rarity mapping with bounded strength tiers and three SVG paths**

In `frontend/recipe-links.js`, delete `RARITIES` and `rarityFor()`. Define a
single color and tier endpoints:

```javascript
const LINK_COLOR = "#78A9D6";
const STRENGTH_STOPS = Object.freeze([
  Object.freeze({ hits: 1, width: 0.7, opacity: 0.34, glow: 0, duration: 900 }),
  Object.freeze({ hits: 3, width: 0.95, opacity: 0.43, glow: 1, duration: 820 }),
  Object.freeze({ hits: 8, width: 1.25, opacity: 0.54, glow: 3, duration: 720 }),
  Object.freeze({ hits: 20, width: 1.75, opacity: 0.68, glow: 6, duration: 620 }),
  Object.freeze({ hits: 40, width: 2.4, opacity: 0.82, glow: 10, duration: 500 }),
]);
```

Keep the existing interpolation/cap behavior, but assign only neutral visual
variables in `setVisualProfile()`:

```javascript
edge.group.dataset.recipeKey = recipe.key;
edge.group.dataset.hitCount = String(strength.hits);
edge.group.style.setProperty("--recipe-link-color", LINK_COLOR);
edge.group.style.setProperty("--recipe-link-width", String(strength.width));
edge.group.style.setProperty("--recipe-link-opacity", String(strength.opacity));
edge.group.style.setProperty("--recipe-link-glow", String(strength.glow));
edge.group.style.setProperty("--recipe-link-duration", String(strength.duration));
```

Build the edge paths as:

```javascript
const base = documentRef.createElementNS(SVG_NS, "path");
base.classList.add("recipe-link-base");
const emphasis = documentRef.createElementNS(SVG_NS, "path");
emphasis.classList.add("recipe-link-emphasis");
const draw = documentRef.createElementNS(SVG_NS, "path");
draw.classList.add("recipe-link-draw");
group.append(base, emphasis, draw);
```

Store named fields and include all paths in geometry updates:

```javascript
const edge = {
  key, group, base, emphasis, draw,
  paths: [base, emphasis, draw],
  leftId: left.id,
  rightId: right.id,
  sign: curveSign(key),
  animation: null,
};
```

- [ ] **Step 4: Make the resting network static and extremely faint**

Replace `frontend/recipe-links.css` flow animation rules with:

```css
.recipe-link-base,
.recipe-link-emphasis,
.recipe-link-draw {
  fill: none;
  stroke: var(--recipe-link-color, #78A9D6);
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.recipe-link-base {
  stroke-width: calc((.45 + var(--recipe-link-width, .7) * .28) * 1px);
  opacity: .055;
}

.recipe-link-emphasis,
.recipe-link-draw {
  stroke-width: calc(var(--recipe-link-width, .7) * 1px);
  opacity: 0;
  transition:
    opacity 520ms ease,
    stroke-width 520ms ease,
    filter 520ms ease;
}
```

Remove `@keyframes recipe-link-flow` and every infinite animation declaration.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run the same two-test command from Step 2.

Expected: PASS.

- [ ] **Step 6: Commit only this task if the test file can be staged without unrelated hunks**

Inspect:

```bash
git diff -- frontend/recipe-links.js frontend/recipe-links.css tests/test_combine_feedback.py
```

If unrelated `tests/test_combine_feedback.py` hunks exist, stage only the
recipe-link test hunks. Otherwise commit:

```bash
git add frontend/recipe-links.js frontend/recipe-links.css
git add tests/test_combine_feedback.py
git commit -m "test: define static recipe link network"
```

---

### Task 2: Add Hover Highlighting and Anime.js Drawing

**Files:**
- Modify: `tests/test_combine_feedback.py:1330-1520`
- Modify: `frontend/recipe-links.js:179-345`
- Modify: `frontend/recipe-links.css:1-80`

**Interfaces:**
- Consumes: `window.anime.animate(target, parameters)` and `window.anime.svg.createDrawable(path)`.
- Produces: delegated pointer activation using `.is-active`, `.is-muted`, and `.has-active-link` classes; each active edge owns at most one Anime.js animation.

- [ ] **Step 1: Add a failing hover lifecycle browser test**

Add `test_recipe_links_hover_draws_only_incident_edges_and_fades_on_leave`.
Before creating the controller, install a deterministic Anime.js spy:

```javascript
var drawCalls = [];
window.anime = {
  svg: {
    createDrawable: function (path) {
      return [{ path: path, draw: "0 0" }];
    }
  },
  animate: function (target, options) {
    drawCalls.push({
      path: target[0].path,
      draw: options.draw,
      duration: options.duration
    });
    return { cancel: function () {} };
  }
};
```

Create canvas DOM endpoints whose IDs match snapshots:

```javascript
function addElement(id, name) {
  var element = document.createElement("div");
  element.className = "element on-canvas";
  element.dataset.id = String(id);
  element.dataset.name = name;
  workspace.appendChild(element);
  return element;
}
var a = addElement(1, "A");
addElement(2, "B");
addElement(3, "C");
```

Sync recipes `A + B` and `B + C`, dispatch `pointerover` on A, then
`pointerout` with `relatedTarget` set to the workspace. Assert:

```python
assert actual["activeDuring"] == ["A + B"]
assert actual["mutedDuring"] == ["B + C"]
assert actual["drawCalls"] == 1
assert actual["drawDirection"] == ["0 0", "0 1"]
assert actual["activeAfterLeave"] == 0
assert actual["workspaceActiveAfterLeave"] is False
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_recipe_links_hover_draws_only_incident_edges_and_fades_on_leave \
  -q
```

Expected: FAIL because delegated pointer handlers and drawable calls do not yet
exist.

- [ ] **Step 3: Add delegated endpoint activation**

Inside `create(workspace)`, add:

```javascript
let activeElementId = null;
const reducedMotion = global.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
)?.matches === true;

function canvasElementFromEventTarget(target) {
  const element = target?.closest?.(".element.on-canvas[data-id]");
  return element && workspace.contains(element) ? element : null;
}
```

Add activation state with a separate replay flag so `sync()` can update classes
without restarting a drawing already in progress:

```javascript
function applyActiveState(playDraw) {
  svg.classList.toggle("has-active-link", activeElementId !== null);
  for (const edge of edges.values()) {
    const incident = activeElementId !== null
      && (edge.leftId === activeElementId || edge.rightId === activeElementId);
    edge.group.classList.toggle("is-active", incident);
    edge.group.classList.toggle(
      "is-muted",
      activeElementId !== null && !incident,
    );
    if (incident) {
      if (playDraw) startDraw(edge, activeElementId);
    } else {
      cancelDraw(edge);
    }
  }
}

function setActiveElement(id) {
  const nextId = id ? String(id) : null;
  if (nextId === activeElementId) return;
  activeElementId = nextId;
  applyActiveState(true);
}
```

Use delegated `pointerover`/`pointerout`, filtering child-to-child transitions:

```javascript
function onPointerOver(event) {
  const element = canvasElementFromEventTarget(event.target);
  if (!element) return;
  if (element.contains(event.relatedTarget)) return;
  setActiveElement(element.dataset.id);
}

function onPointerOut(event) {
  const element = canvasElementFromEventTarget(event.target);
  if (!element || element.contains(event.relatedTarget)) return;
  const next = canvasElementFromEventTarget(event.relatedTarget);
  setActiveElement(next?.dataset.id || null);
}
```

Register both listeners when creating the controller and remove both in
`destroy()`.

- [ ] **Step 4: Animate the drawable path from the hovered endpoint**

Implement the animation adapter:

```javascript
function cancelDraw(edge) {
  edge.animation?.cancel?.();
  edge.animation = null;
}

function startDraw(edge, hoveredId) {
  cancelDraw(edge);
  if (reducedMotion) return;
  const anime = global.anime;
  if (
    typeof anime?.animate !== "function"
    || typeof anime?.svg?.createDrawable !== "function"
  ) return;
  const drawable = anime.svg.createDrawable(edge.draw);
  const forward = edge.leftId === hoveredId;
  edge.animation = anime.animate(drawable, {
    draw: forward ? ["0 0", "0 1"] : ["1 1", "0 1"],
    duration: Number(
      edge.group.style.getPropertyValue("--recipe-link-duration"),
    ),
    ease: "outQuad",
  });
}
```

When `sync()` removes an edge, call `cancelDraw(edge)` before removal. When an
existing active edge is preserved, do not restart it solely because geometry
changed. After adding/removing desired edges, call `applyActiveState(false)` so
classes stay correct without replaying existing animations.

- [ ] **Step 5: Add active, muted, and fade-out styles**

Add:

```css
.recipe-links.has-active-link .recipe-link-base {
  opacity: .025;
}

.recipe-link.is-active .recipe-link-base {
  opacity: .12;
}

.recipe-link.is-active .recipe-link-emphasis {
  opacity: var(--recipe-link-opacity, .34);
  filter:
    drop-shadow(
      0 0 calc(var(--recipe-link-glow, 0) * 1px)
      var(--recipe-link-color, #78A9D6)
    );
}

.recipe-link.is-active .recipe-link-draw {
  opacity: min(1, calc(var(--recipe-link-opacity, .34) + .18));
}

.recipe-link.is-muted .recipe-link-base {
  opacity: .012;
}
```

The existing 520 ms transitions provide the requested fade after pointer leave.
Do not add CSS keyframes or infinite animations.

- [ ] **Step 6: Run the hover test and the existing recipe-link tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_links" -q
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit only owned hunks**

Inspect the complete diff and stage only recipe-link changes:

```bash
git add frontend/recipe-links.js frontend/recipe-links.css
git add tests/test_combine_feedback.py
git commit -m "feat: animate known recipe links on hover"
```

Leave any file unstaged if its owned and unrelated hunks cannot be separated
safely.

---

### Task 3: Cover Cancellation, Fallback, Reduced Motion, and Cache Delivery

**Files:**
- Modify: `tests/test_combine_feedback.py:1450-1530`
- Modify: `tests-makers/frontend.test.mjs:225-260`
- Modify: `frontend/recipe-links.js:200-345`
- Modify: `frontend/recipe-links.css:50-90`
- Modify: `frontend/index.html:10,193-198`

**Interfaces:**
- Consumes: edge-owned `animation.cancel()`, controller `clear()`/`destroy()`, browser `matchMedia`.
- Produces: cleanup guarantees and updated cache versions for both relationship assets.

- [ ] **Step 1: Add failing cancellation and fallback assertions**

Extend the hover browser test spy with a cancellation counter:

```javascript
return {
  cancel: function () { cancelCalls += 1; }
};
```

After switching hover from A to B, removing a linked recipe with `sync()`,
calling `clear()`, and finally calling `destroy()`, assert that each displaced
animation is canceled and no link or SVG remains.

Add a second browser case that sets:

```javascript
window.anime = undefined;
window.matchMedia = function () { return { matches: true }; };
```

Then hover an endpoint and assert `.is-active` is applied without an exception
or inline Anime.js draw state.

- [ ] **Step 2: Run recipe-link tests and verify cleanup coverage fails**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_links" -q
```

Expected: the new cancellation count or fallback expectation FAILS until all
cleanup paths cancel owned animations.

- [ ] **Step 3: Complete lifecycle cleanup**

Add a helper:

```javascript
function cancelAllDraws() {
  edges.forEach(cancelDraw);
}
```

Call it before `clear()` removes groups and before `destroy()` clears the map.
Reset `activeElementId`, remove `has-active-link`, and remove both delegated
pointer listeners. Ensure removed edges in `sync()` call `cancelDraw(edge)`.

- [ ] **Step 4: Finalize reduced-motion CSS**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .recipe-link-emphasis,
  .recipe-link-draw {
    transition-duration: 120ms;
  }

  .recipe-link-draw {
    display: none;
  }
}
```

Update the static isolation test to assert `.recipe-link-draw` and the reduced
motion media query, and to assert `@keyframes recipe-link-flow` is absent.

- [ ] **Step 5: Bump local asset cache versions and assert script ordering**

Change the `recipe-links.css` and `recipe-links.js` query strings in
`frontend/index.html` to the matching new version `v=20260803c`.
Extend the existing Node frontend assertion:

```javascript
assert.ok(html.indexOf("anime.iife.min.js") < html.indexOf("recipe-links.js"));
assert.match(html, /recipe-links\.css\?v=20260803c/);
assert.match(html, /recipe-links\.js\?v=20260803c/);
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py \
  -k "recipe_links or browser_harness_styles" -q
node --test --test-concurrency=1 tests-makers/frontend.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit owned production files when safe**

Inspect status and diffs first. Stage only the files and hunks owned by this
feature:

```bash
git add frontend/recipe-links.js frontend/recipe-links.css frontend/index.html
git add tests/test_combine_feedback.py tests-makers/frontend.test.mjs
git commit -m "fix: clean up recipe link animation lifecycle"
```

---

### Task 4: Required Regression Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed relationship controller and repository test suites.
- Produces: evidence that the feature is ready for review without deployment.

- [ ] **Step 1: Inspect the final diff for scope and generated artifacts**

Run:

```bash
git status --short
git diff --check
git diff -- frontend/recipe-links.js frontend/recipe-links.css frontend/index.html
```

Expected: no whitespace errors; only requested relationship behavior appears in
owned production files; `.env`, credentials, and runtime data are absent.

- [ ] **Step 2: Run the required Node test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run the required Python suite excluding the separately managed combine-feedback suite**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: PASS.

- [ ] **Step 4: Run the focused combine-feedback relationship tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -k "recipe_links" -q
```

Expected: PASS. If unrelated pre-existing edits make other tests in this file
fail, report them separately and do not change those unrelated areas.

- [ ] **Step 5: Run the production build**

Run:

```bash
npm run build
```

Expected: PASS and generated output includes the updated relationship JS, CSS,
and vendored Anime.js asset.

- [ ] **Step 6: Report the maintainer-only verification**

Do not authenticate to EdgeOne or run local code against Makers services.
Report that a deployment maintainer still needs to run:

```bash
npm run makers:build
```
