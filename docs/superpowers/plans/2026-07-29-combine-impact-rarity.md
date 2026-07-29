# Combine Impact Rarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale the circular combine impact by recipe depth, color it like equipment rarity, and render discoveries brighter than repeated recipes.

**Architecture:** `app.js` will settle the pending combine effect with normalized result metadata instead of only the discovery tier. `effects.js` will resolve one immutable rarity profile and write its color, scale, glow, saturation, and brightness into CSS variables; `style.css` remains responsible for the concentric-ring animation.

**Tech Stack:** Vanilla JavaScript, CSS custom properties/keyframes, FastAPI static frontend, pytest, real headless Chromium.

## Global Constraints

- Depth `1-2` is common gray, `3-4` uncommon green, `5-6` rare blue, `7-9` epic purple, and `10+` legendary gold.
- Relative radii are `1.00`, `1.18`, `1.38`, `1.62`, and `1.90`.
- `global_new` and `global_known` use identical discovery brightness; `seen` uses reduced opacity, glow, and saturation.
- Missing or invalid depth degrades to common.
- Preserve `prefers-reduced-motion`, `aria-hidden`, cleanup timing, and the existing global-first particles and stamps.
- Add no dependency, canvas, image, or network request.
- Preserve every unrelated working-tree change and stage only files changed for this feature.

---

### Task 1: Pass Depth And Discovery State To The Impact

**Files:**
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `frontend/app.js:610-630`

**Interfaces:**
- Consumes: `resp.depth: number`, `isNewToPlayer: boolean`, and the handle returned by `EFFECTS.beginCombine(...)`.
- Produces: `combineEffect.finish({ depth: number, discovered: boolean })`.

- [ ] **Step 1: Write the failing source-contract test**

Replace the old `finish(tier)` expectation in the main-game contract:

```js
assert.match(
  app,
  /combineEffect\?\.finish\?\.\(\{\s*depth:\s*resp\.depth,\s*discovered:\s*isNewToPlayer\s*\}\)/s,
);
assert.doesNotMatch(app, /combineEffect\?\.finish\?\.\(tier\)/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node tests-makers/frontend.test.mjs
```

Expected: the main-game contract fails because `app.js` still calls
`combineEffect.finish(tier)`.

- [ ] **Step 3: Pass the result metadata**

After `isNewToPlayer` and `tier` are computed, settle the effect with:

```js
combineEffect?.finish?.({
  depth: resp.depth,
  discovered: isNewToPlayer,
});
```

Do not use `resp.is_first` for brightness: both a personal discovery and a
global-first discovery must be bright.

- [ ] **Step 4: Run the source-contract test and verify GREEN**

Run:

```bash
node tests-makers/frontend.test.mjs
```

Expected: all tests in the file pass.

---

### Task 2: Resolve Rarity Profiles And Render Distinct Waves

**Files:**
- Modify: `tests/test_combine_feedback.py`
- Modify: `frontend/effects.js:16-119`
- Modify: `frontend/style.css:518-555`

**Interfaces:**
- Consumes: `finish(meta)` where `meta.depth` is numeric input and `meta.discovered` is a boolean.
- Produces: one `.combine-impact` node with:
  - `data-rarity="common|uncommon|rare|epic|legendary"`
  - `data-discovery="new|repeat"`
  - `--impact-color`
  - `--impact-scale`
  - `--impact-start-opacity`
  - `--impact-brightness`
  - `--impact-saturation`
  - `--impact-glow`

- [ ] **Step 1: Add a real-browser rarity regression**

Add `test_combine_impact_uses_depth_rarity_and_discovery_brightness`. Its
browser fixture creates a fresh source, target, and handle per case:

```javascript
function trigger(depth, discovered) {
  var source = document.createElement("div");
  var target = document.createElement("div");
  workspace.append(source, target);
  var handle = window.EFFECTS.beginCombine(
    workspace, source, target, 120, 80
  );
  handle.finish({ depth: depth, discovered: discovered });
  var impact = workspace.querySelector(".combine-impact:last-of-type");
  return {
    rarity: impact.dataset.rarity,
    discovery: impact.dataset.discovery,
    color: impact.style.getPropertyValue("--impact-color"),
    scale: Number(impact.style.getPropertyValue("--impact-scale")),
    opacity: Number(
      impact.style.getPropertyValue("--impact-start-opacity")
    ),
    brightness: Number(
      impact.style.getPropertyValue("--impact-brightness")
    ),
    saturation: Number(
      impact.style.getPropertyValue("--impact-saturation")
    ),
    glow: impact.style.getPropertyValue("--impact-glow")
  };
}
```

Exercise literal boundary cases:

```javascript
[
  trigger(undefined, false),
  trigger(2, true),
  trigger(3, true),
  trigger(4, true),
  trigger(5, true),
  trigger(6, true),
  trigger(7, true),
  trigger(9, true),
  trigger(10, true),
  trigger(10, false)
]
```

Assert:

```python
assert [row["rarity"] for row in actual] == [
    "common", "common", "uncommon", "uncommon", "rare",
    "rare", "epic", "epic", "legendary", "legendary",
]
assert [row["scale"] for row in actual[1:9:2]] == [5.5, 6.5, 7.6, 8.9]
assert actual[8]["scale"] == 10.5
assert actual[1]["opacity"] == actual[8]["opacity"] == 0.98
assert actual[0]["opacity"] == actual[9]["opacity"] == 0.42
assert actual[1]["brightness"] == actual[8]["brightness"] == 1.18
assert actual[0]["brightness"] == actual[9]["brightness"] == 0.72
assert actual[1]["saturation"] == actual[8]["saturation"] == 1.12
assert actual[0]["saturation"] == actual[9]["saturation"] == 0.62
assert actual[8]["glow"] != actual[9]["glow"]
```

Update the existing lifecycle test to call
`handle.finish({ depth: 5, discovered: true })` and assert `rare` plus `new`
instead of the obsolete `personal` tone.

- [ ] **Step 2: Run the browser tests and verify RED**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_combine_effect_lifecycle_marks_sources_and_emits_impact \
  tests/test_combine_feedback.py::test_combine_impact_uses_depth_rarity_and_discovery_brightness \
  -q
```

Expected: FAIL because the current impact accepts a discovery tier string and
does not expose rarity or CSS variables.

- [ ] **Step 3: Add immutable rarity profiles**

Replace `toneForTier` with:

```js
const IMPACT_RARITIES = Object.freeze([
  Object.freeze({
    maxDepth: 2, name: "common", color: "#9AA6B2", scale: 5.5,
    glowNew: "rgba(154,166,178,.72)", glowRepeat: "rgba(154,166,178,.14)",
  }),
  Object.freeze({
    maxDepth: 4, name: "uncommon", color: "#35C978", scale: 6.5,
    glowNew: "rgba(53,201,120,.72)", glowRepeat: "rgba(53,201,120,.14)",
  }),
  Object.freeze({
    maxDepth: 6, name: "rare", color: "#3B82F6", scale: 7.6,
    glowNew: "rgba(59,130,246,.76)", glowRepeat: "rgba(59,130,246,.15)",
  }),
  Object.freeze({
    maxDepth: 9, name: "epic", color: "#A855F7", scale: 8.9,
    glowNew: "rgba(168,85,247,.8)", glowRepeat: "rgba(168,85,247,.16)",
  }),
  Object.freeze({
    maxDepth: Infinity, name: "legendary", color: "#F2B84B", scale: 10.5,
    glowNew: "rgba(242,184,75,.86)", glowRepeat: "rgba(242,184,75,.17)",
  }),
]);

function impactRarity(depth) {
  const normalized = Number.isFinite(Number(depth))
    ? Math.max(1, Math.trunc(Number(depth)))
    : 1;
  return IMPACT_RARITIES.find((rarity) => normalized <= rarity.maxDepth);
}
```

- [ ] **Step 4: Apply profile and discovery variables**

Change `spawnImpact` to accept `meta = {}`. Resolve the profile and set:

```js
const discovered = meta.discovered === true;
impact.dataset.rarity = rarity.name;
impact.dataset.discovery = discovered ? "new" : "repeat";
impact.style.setProperty("--impact-color", rarity.color);
impact.style.setProperty("--impact-scale", String(rarity.scale));
impact.style.setProperty(
  "--impact-start-opacity", discovered ? "0.98" : "0.42"
);
impact.style.setProperty(
  "--impact-brightness", discovered ? "1.18" : "0.72"
);
impact.style.setProperty(
  "--impact-saturation", discovered ? "1.12" : "0.62"
);
impact.style.setProperty(
  "--impact-glow", discovered ? rarity.glowNew : rarity.glowRepeat
);
```

Change the lifecycle handle to `finish(meta = {})` and pass the object to
`spawnImpact`. Keep cleanup idempotent and leave `cancel()` unchanged.

- [ ] **Step 5: Drive ring rendering from variables**

Update `.combine-impact`:

```css
.combine-impact {
  --impact-color: #9AA6B2;
  --impact-scale: 5.5;
  --impact-start-opacity: .42;
  --impact-brightness: .72;
  --impact-saturation: .62;
  --impact-glow: rgba(154,166,178,.14);
  border-color: var(--impact-color);
  box-shadow: 0 0 14px 3px var(--impact-glow);
  filter:
    brightness(var(--impact-brightness))
    saturate(var(--impact-saturation));
}
```

Delete the old `[data-tone]` color overrides. In `combine-impact-ring`, use:

```css
0% {
  opacity: var(--impact-start-opacity);
  transform: scale(.25);
}
100% {
  opacity: 0;
  transform: scale(var(--impact-scale));
}
```

The pseudo-element retains the same variables and delayed animation, producing
the second ring without a separate rarity mapping.

- [ ] **Step 6: Run focused GREEN**

Run the two pytest node/runtime tests from Step 2 and:

```bash
node tests-makers/frontend.test.mjs
```

Expected: all selected tests pass.

---

### Task 3: Validate, Rebuild, Restart, And Inspect

**Files:**
- Modify: `frontend/index.html` only to bump the existing asset version.

**Interfaces:**
- Consumes: the completed frontend source and Docker Compose stack.
- Produces: a publicly testable game at `http://21.214.53.194:8000/`.

- [ ] **Step 1: Bump the shared asset cache token**

Increment the current identical `?v=` token for `icon-system.css`, `style.css`,
`icon-system.js`, `combine-feedback.js`, `effects.js`, and `app.js` once. Do
not change asset order.

- [ ] **Step 2: Run required verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
python3 -m pytest tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Record any pre-existing unrelated failure separately; do not weaken assertions.

- [ ] **Step 3: Rebuild and restart local production-shaped service**

Run:

```bash
docker compose up -d --build --remove-orphans
```

Wait for `/api/health` before browser validation because seed warmup can delay
the first connection.

- [ ] **Step 4: Validate five real browser cases**

At desktop and `390x844`, trigger impacts with depths `2`, `3`, `5`, `7`, and
`10`. Verify:

- colors are gray, green, blue, purple, and gold in that order;
- scale variables are strictly increasing;
- discovered and repeated depth-10 rings have identical radius and color;
- discovered depth-10 opacity is greater than repeated depth-10 opacity;
- no ring or page element causes horizontal overflow;
- no JavaScript runtime exception occurs.

- [ ] **Step 5: Commit only feature files**

```bash
git add \
  docs/superpowers/plans/2026-07-29-combine-impact-rarity.md \
  frontend/app.js frontend/effects.js frontend/style.css frontend/index.html \
  tests-makers/frontend.test.mjs tests/test_combine_feedback.py
git commit -m "feat: scale combine impacts by recipe rarity"
```
