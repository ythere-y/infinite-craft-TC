# Unified Close Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boxed close asset with a lightweight plain cross and give the recipe book and score history panel one shared close-button appearance.

**Architecture:** Keep the existing close action name and event-handler IDs. Select Phosphor's regular source only for the generated `x.svg`, then move the two main panel controls onto a shared visual CSS class while retaining recipe-specific absolute positioning.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js asset generator, Python/Chromium browser tests

## Global Constraints

- Do not modify unrelated working-tree files.
- Do not commit `.env`, credentials, or runtime data.
- Keep AI-created process documents in `.agent/docs/`.
- Preserve the two controls' IDs, Chinese accessible labels, titles, and click behavior.
- Do not redesign close controls on unrelated pages.

---

### Task 1: Generate and apply the unified close control

**Files:**
- Modify: `tests/test_recipebook_ui.py`
- Modify: `scripts/generate-icon-assets.mjs`
- Modify: `frontend/assets/icons/actions/x.svg` (generated)
- Modify: `frontend/assets/icons/generated/icon-build-metadata.json` (generated)
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: `window.ICON_SYSTEM.renderAction()` and existing IDs `recipebook-close` and `score-panel-close`
- Produces: shared CSS class `panel-close-button`; a regular-weight `frontend/assets/icons/actions/x.svg`

- [x] **Step 1: Write the failing real-browser regression test**

Add the committed close SVG to the browser fixture as a data URI, render it to a
64 px canvas, and sample pixel `(32, 14)`. This point lies inside the old
duotone square but away from the cross strokes:

```python
import base64

CLOSE_SVG = FRONTEND / "assets/icons/actions/x.svg"

close_svg_data = base64.b64encode(CLOSE_SVG.read_bytes()).decode("ascii")
probe = probe.replace("__CLOSE_SVG_DATA__", close_svg_data)
```

```html
<img id="close-asset-probe"
     src="data:image/svg+xml;base64,__CLOSE_SVG_DATA__"
     width="64" height="64" alt="">
```

In the existing JavaScript probe, open the score panel, collect computed styles
and rectangles for both close buttons, click the score close button, and return:

```javascript
var scorePanel = document.getElementById("score-panel");
var scoreClose = document.getElementById("score-panel-close");
document.getElementById("btn-score").click();
var scoreCloseRect = scoreClose.getBoundingClientRect();
var scoreCloseStyle = getComputedStyle(scoreClose);

var assetCanvas = document.createElement("canvas");
assetCanvas.width = 64;
assetCanvas.height = 64;
var assetContext = assetCanvas.getContext("2d");
assetContext.drawImage(document.getElementById("close-asset-probe"), 0, 0, 64, 64);
var closeAssetBackdropAlpha = assetContext.getImageData(32, 14, 1, 1).data[3];
```

Add independently derived assertions:

```python
assert desktop["closeAssetBackdropAlpha"] == 0
assert desktop["scoreCloseWidth"] == desktop["closeWidth"] == 30
assert desktop["scoreCloseHeight"] == desktop["closeHeight"] == 30
assert desktop["scoreCloseBackground"] == desktop["closeBackground"]
assert desktop["scoreCloseBorderRadius"] == desktop["closeBorderRadius"]
assert desktop["scoreCloseAriaLabel"] == "关闭分数记录"
assert desktop["scoreClosed"] is True
assert desktop["nightScoreCloseBackground"] == desktop["nightBackground"]
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
python3 -m pytest tests/test_recipebook_ui.py -q
```

Expected: FAIL because the current close SVG produces non-zero alpha at the
sample point and the score close control is 25 px with a red background instead
of the recipe book's 30 px gray rounded appearance.

- [x] **Step 3: Select the regular Phosphor source for `x.svg`**

In `scripts/generate-icon-assets.mjs`, keep duotone as the default and add a
regular-source override for `x`:

```javascript
const PHOSPHOR_ROOTS = {
  duotone: resolve(ROOT, "node_modules/@phosphor-icons/core/assets/duotone"),
  regular: resolve(ROOT, "node_modules/@phosphor-icons/core/assets/regular"),
};

function actionIconSource(name) {
  if (name === "x") return resolve(PHOSPHOR_ROOTS.regular, "x.svg");
  return resolve(PHOSPHOR_ROOTS.duotone, `${name}-duotone.svg`);
}
```

Use `actionIconSource(name)` in the action-copy loop, validate both source
directories, then regenerate committed assets:

```bash
npm run generate:icons
```

Expected: only the close SVG's visual source and generated metadata change;
other action icons retain their duotone variants.

- [x] **Step 4: Apply one shared panel close-button contract**

Update `frontend/index.html` so the score control is no longer a red traffic
light and both controls use the shared class:

```html
<button id="score-panel-close"
        class="panel-close-button"
        title="关闭"
        aria-label="关闭分数记录"
        data-action-icon="close"
        data-icon-action="close"></button>

<button id="recipebook-close"
        class="panel-close-button recipebook-close-button"
        title="关闭"
        aria-label="关闭配方图鉴"
        data-action-icon="close"
        data-icon-action="close"></button>
```

In `frontend/style.css`, move the recipe button's visual rules to
`.panel-close-button`, keep only `position`, `top`, and `right` on
`.recipebook-close-button`, and make the icon well and image rules shared:

```css
.panel-close-button {
  width: 30px;
  height: 30px;
  display: inline-grid;
  flex: 0 0 30px;
  place-items: center;
  border: 1px solid #E1E5EA;
  border-radius: 8px;
  padding: 0;
  background: #F4F5F7;
  color: #4E5969;
  cursor: pointer;
}
.recipebook-close-button {
  position: absolute;
  top: 12px;
  right: 14px;
}
.panel-close-button > .action-icon {
  width: 100%;
  min-width: 0;
  height: 100%;
  display: grid;
  place-items: center;
}
.panel-close-button > .action-icon > img {
  display: block;
  width: 14px;
  height: 14px;
}
```

Move the existing hover, focus-visible, and midnight-mode declarations onto
`.panel-close-button`. Remove the obsolete `mac-traffic-lights`, `mac-light`,
and red close-button rules. Do not change the existing JavaScript listeners.

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_recipebook_ui.py -q
```

Expected: PASS with transparent canvas pixels away from the cross strokes,
matching computed button styles, and both close handlers working.

- [x] **Step 6: Run required repository verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands exit successfully.

- [x] **Step 7: Review the scoped diff and commit**

Run:

```bash
git diff --check
git diff -- tests/test_recipebook_ui.py scripts/generate-icon-assets.mjs frontend/assets/icons/actions/x.svg frontend/assets/icons/generated/icon-build-metadata.json frontend/index.html frontend/style.css
git status --short
```

Confirm that unrelated working-tree changes remain unstaged, then commit only
the task files and this plan:

```bash
git add .agent/docs/2026-08-03-unified-close-buttons-implementation-plan.md tests/test_recipebook_ui.py scripts/generate-icon-assets.mjs frontend/assets/icons/actions/x.svg frontend/assets/icons/generated/icon-build-metadata.json frontend/index.html frontend/style.css
git commit -m "fix: unify panel close buttons"
```
