# Inner Mode Icon Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal mode and inner mode render the same element names, icon assets, badges, palettes, and state markers while inner mode applies a dark icon theme and keeps its existing casino scoring.

**Architecture:** `ICON_SYSTEM.renderElement` remains the only element DOM renderer. Mode switching only toggles `body.ura-on` and existing mode events/effects; CSS contextual selectors theme the unchanged sticker DOM. Remove the random inner-mode repaint pipeline and its layout workarounds.

**Tech Stack:** Browser JavaScript, CSS, Node.js test runner, pytest, headless Chromium

## Global Constraints

- Normal and inner mode must use the same element name, base icon, badge, palette, tilt, and state marker.
- Normal mode remains a light theme; inner mode remains a dark theme.
- Normal mode keeps rarity scoring; inner mode keeps the midnight casino harvest, streak, and failure rules.
- Do not modify backend icon data, generated icon assets, combination logic, score persistence, or casino round rules.
- Do not add dependencies.
- Do not touch or stage unrelated working-tree files.
- Run `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build` before completion.

## File Structure

- Modify `tests/test_combine_feedback.py`: replace the old “random icon then restore” browser contract with semantic icon parity, dark palette, new-node, and geometry checks.
- Modify `tests-makers/frontend.test.mjs`: enforce the absence of the repaint pipeline and the presence of all six inner-mode palette selectors.
- Modify `frontend/effects.js`: retain mode state, events, transition effects, and keyboard switching; remove random icon mutation.
- Modify `frontend/app.js`: remove the obsolete repaint hook after sidebar rendering.
- Modify `frontend/style.css`: remove dead `.ura-emoji`/`.ura-name` rules and their font/layout workarounds.
- Modify `frontend/icon-system.css`: add the dark sticker palette and dark high-contrast state styling.

---

### Task 1: Lock the shared icon and dark-theme contract

**Files:**

- Modify: `tests/test_combine_feedback.py:990`
- Modify: `tests-makers/frontend.test.mjs:281`

**Interfaces:**

- Consumes: `window.ICON_SYSTEM.renderElement(document, target, payload)`, `window.EFFECTS.initBossMode({ defaultOn: false })`, and the existing Konami mode switch.
- Produces: a browser contract requiring stable `name`, base `src`, badge `src`, palette/state classes, and geometry across theme changes; a static contract forbidding repaint infrastructure.

- [ ] **Step 1: Replace the old boss-mode browser test with a failing parity test**

Replace `test_boss_mode_preserves_canvas_element_geometry_and_restores_icon` with:

```python
def test_inner_mode_preserves_icon_identity_and_uses_dark_palette(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(async function () {
          var workspace = document.getElementById("fixture");
          workspace.id = "workspace";
          workspace.className = "workspace";
          var payload = {
            name: "预设",
            emoji: "🔥",
            category: "product",
            icon: {
              base: "🧩",
              badge: "⭐",
              palette: "product",
              source: "entity"
            },
            isFirst: true,
            size: "canvas"
          };

          function makeCanvasElement(name, left) {
            var target = document.createElement("div");
            target.className = "element on-canvas";
            target.dataset.name = name;
            target.style.left = left + "px";
            target.style.top = (left / 2) + "px";
            window.ICON_SYSTEM.renderElement(
              document,
              target,
              { ...payload, name: name }
            );
            workspace.appendChild(target);
            return target;
          }

          function snapshot(target) {
            var sticker = target.querySelector(".element-icon");
            var base = target.querySelector(".element-icon-base");
            var badge = target.querySelector(".element-icon-badge");
            var rect = target.getBoundingClientRect();
            var baseStyle = base ? getComputedStyle(base) : null;
            return {
              name: target.querySelector(".name").textContent,
              base: base ? base.getAttribute("src") : "",
              badge: badge ? badge.getAttribute("src") : "",
              stickerClass: sticker ? sticker.className : "",
              stateClasses: Array.from(target.classList)
                .filter(function (name) { return name.indexOf("state-") === 0; }),
              geometry: [rect.x, rect.y, rect.width, rect.height],
              background: baseStyle ? baseStyle.backgroundColor : "",
              border: baseStyle ? baseStyle.borderColor : "",
              shadow: baseStyle ? baseStyle.boxShadow : ""
            };
          }

          var target = makeCanvasElement("预设", 0);
          var before = snapshot(target);
          window.EFFECTS.initBossMode({ defaultOn: false });
          var code = [
            "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
            "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"
          ];
          code.forEach(function (key) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
          });
          await new Promise(function (resolve) { setTimeout(resolve, 650); });
          var during = snapshot(target);

          var addedDuringInnerMode = makeCanvasElement("新增元素", 120);
          await Promise.resolve();
          var added = snapshot(addedDuringInnerMode);

          code.forEach(function (key) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
          });
          var after = snapshot(target);
          return { before: before, during: during, added: added, after: after };
        });
        """,
        include_effects=True,
        include_app_styles=True,
    )

    semantic_keys = ("name", "base", "badge", "stickerClass", "stateClasses")
    for key in semantic_keys:
        assert actual["during"][key] == actual["before"][key]
        assert actual["after"][key] == actual["before"][key]
    assert actual["during"]["geometry"] == actual["before"]["geometry"]
    assert actual["after"]["geometry"] == actual["before"]["geometry"]
    assert actual["during"]["background"] == "rgb(24, 44, 70)"
    assert actual["during"]["border"] == "rgb(74, 68, 106)"
    assert actual["during"]["shadow"] != actual["before"]["shadow"]
    assert actual["added"]["name"] == "新增元素"
    assert actual["added"]["base"] == "/assets/base.png"
    assert actual["added"]["badge"] == "/assets/badge.png"
    assert actual["added"]["background"] == "rgb(24, 44, 70)"
```

- [ ] **Step 2: Update the static frontend contract**

In `main game uses compact sticker and action-icon contracts`, load
`frontend/icon-system.css` as `iconStyles`:

```javascript
const [html, app, styles, iconStyles, effects] = await Promise.all([
  readFile("frontend/index.html", "utf8"),
  readFile("frontend/app.js", "utf8"),
  readFile("frontend/style.css", "utf8"),
  readFile("frontend/icon-system.css", "utf8"),
  readFile("frontend/effects.js", "utf8"),
]);
```

Replace the old `WeakMap` and restore-render assertions with:

```javascript
assert.doesNotMatch(
  effects,
  /URA_POOL|URA_EMOJI|MutationObserver|paintElement|scanAndPaint|reapplyUra|new WeakMap\(\)/,
);
assert.doesNotMatch(app, /reapplyUra/);
assert.doesNotMatch(styles, /\.ura-(?:emoji|name|visual)/);
for (const palette of [
  "nature", "product", "office", "studio", "people", "place",
]) {
  assert.match(
    iconStyles,
    new RegExp(`body\\.ura-on \\.palette-${palette} \\.element-icon-base`),
  );
}
```

- [ ] **Step 3: Run the focused tests and verify they fail for the intended reasons**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py::test_inner_mode_preserves_icon_identity_and_uses_dark_palette -q
node --test tests-makers/frontend.test.mjs
```

Expected:

- The browser test fails because inner mode removes `.element-icon-base` and replaces it with a random `.ura-visual`.
- The static test fails because `effects.js` still contains the repaint pipeline, `app.js` still calls `reapplyUra`, and the six dark palette selectors do not yet exist.

### Task 2: Remove icon mutation and add the inner-mode sticker theme

**Files:**

- Modify: `frontend/effects.js:462-599,613-620,778-782`
- Modify: `frontend/app.js:327-328`
- Modify: `frontend/style.css:2824-2961`
- Modify: `frontend/icon-system.css:21-74`
- Test: `tests/test_combine_feedback.py`
- Test: `tests-makers/frontend.test.mjs`
- Test: `tests/test_casino_mode_ui.py`

**Interfaces:**

- Consumes: unchanged sticker DOM from `ICON_SYSTEM.renderElement` and `body.ura-on`.
- Produces: `EFFECTS.initBossMode`, `EFFECTS.isUraMode`, and `ura-mode-change` with their existing signatures and behavior; CSS-only icon theming.

- [ ] **Step 1: Reduce inner-mode JavaScript to theme state**

In `frontend/effects.js`, keep `KONAMI`, `uraOn`, `bossModeInitialized`,
`konamiBuffer`, `announceUraMode`, mode entry/exit, transitions, and audio.
Delete `URA_POOL`, `URA_EMOJI`, `observer`, `originalPayloads`,
`paintedElements`, `randFrom`, `paintElement`, `restorePaintedElements`,
`scanAndPaint`, `startObserver`, `stopObserver`, and both `reapplyUra`
definitions.

The stable-state and exit functions must become:

```javascript
function applyUraStableState(initial) {
  uraOn = true;
  const banner = document.getElementById("boss-banner");
  if (banner) {
    banner.textContent = "🤪 里模式·彻底疯狂 · ↑↑↓↓←→←→BA 再按可关闭";
    banner.classList.add("show");
  }
  document.body.classList.add("ura-on");
  announceUraMode(initial);
}

function exitUra() {
  if (!uraOn) return;
  uraOn = false;
  const banner = document.getElementById("boss-banner");
  if (banner) banner.classList.remove("show");
  document.body.classList.remove("ura-on");
  announceUraMode(false);
  playUraExitTransition();
}
```

Update the section comment to describe theme switching rather than random
visual replacement.

- [ ] **Step 2: Remove obsolete callers and layout workarounds**

Delete the repaint call and its comment from `renderSidebar` in
`frontend/app.js`:

```javascript
// 如果里模式开着，重新应用覆盖
window.EFFECTS?.reapplyUra?.();
```

Delete the complete legacy block from `.ura-emoji, .ura-name { display: none; }`
through the final `body.ura-on ... .ura-name` hiding rule in
`frontend/style.css`. This also removes the inner-mode-only font change and
the box-model overrides that existed solely to compensate for random overlay
text. Keep the following responsive `@media (max-width: 1080px)` block.

- [ ] **Step 3: Add the dark sticker theme**

Insert the following after the six light palette rules in
`frontend/icon-system.css`:

```css
body.ura-on .element-icon-base,
body.ura-on .element-icon-native {
  border-color: #4a446a;
  box-shadow:
    0 2px 7px rgba(0, 0, 0, .52),
    0 0 0 1px rgba(202, 166, 255, .08);
}
body.ura-on .element-icon-badge {
  border-color: #4a446a;
  background: #18172b;
}
body.ura-on .palette-nature .element-icon-base,
body.ura-on .palette-nature .element-icon-native { background: #17352d; }
body.ura-on .palette-product .element-icon-base,
body.ura-on .palette-product .element-icon-native { background: #182c46; }
body.ura-on .palette-office .element-icon-base,
body.ura-on .palette-office .element-icon-native { background: #3b2f22; }
body.ura-on .palette-studio .element-icon-base,
body.ura-on .palette-studio .element-icon-native { background: #3a2238; }
body.ura-on .palette-people .element-icon-base,
body.ura-on .palette-people .element-icon-native { background: #3b3020; }
body.ura-on .palette-place .element-icon-base,
body.ura-on .palette-place .element-icon-native { background: #292444; }
body.ura-on .state-starter .element-icon::after {
  border-color: #18172b;
  background: #6fa75b;
}
body.ura-on .state-global-new .element-icon {
  outline-color: #f2b84b;
}
body.ura-on .state-personal-new .element-icon {
  outline-color: #b892e5;
}
body.ura-on .state-global-new .element-icon::after {
  color: #f2b84b;
}
body.ura-on .state-personal-new .element-icon::after {
  color: #77b7ff;
}
body.ura-on .state-combine-target .element-icon {
  outline-color: #65a5ff;
}
```

These selectors alter only color and shadow properties. Do not add width,
height, font, transform, content, or DOM-dependent overrides.

- [ ] **Step 4: Run focused icon and static tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py::test_inner_mode_preserves_icon_identity_and_uses_dark_palette -q
node --test tests-makers/frontend.test.mjs
```

Expected: both commands pass.

- [ ] **Step 5: Run scoring and mode-switch regressions**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_inner_mode_routes_score_to_harvest_and_normal_mode_keeps_direct_score -q
node --test tests-makers/casino-round.test.mjs
```

Expected: both commands pass, proving the CSS/DOM change did not alter inner
mode casino scoring or normal-mode direct scoring.

- [ ] **Step 6: Commit the focused implementation**

Stage only the six files owned by this plan:

```bash
git add frontend/effects.js frontend/app.js frontend/style.css frontend/icon-system.css tests/test_combine_feedback.py tests-makers/frontend.test.mjs
git commit -m "fix: unify inner mode element icons"
```

### Task 3: Complete project verification

**Files:**

- Verify only; do not modify or stage unrelated files.

**Interfaces:**

- Consumes: the completed shared icon renderer and CSS-only inner-mode theme.
- Produces: final evidence that frontend, backend-independent pytest coverage, and the production build remain healthy.

- [ ] **Step 1: Run the complete JavaScript suite**

Run:

```bash
npm test
```

Expected: exit code 0.

- [ ] **Step 2: Run the required Python suite**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: exit code 0.

- [ ] **Step 3: Run the icon browser suite omitted by the required command**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: exit code 0.

- [ ] **Step 4: Build the production frontend**

Run:

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 5: Check scope and whitespace**

Run:

```bash
git diff --check HEAD^ -- frontend/effects.js frontend/app.js frontend/style.css frontend/icon-system.css tests/test_combine_feedback.py tests-makers/frontend.test.mjs
git status --short
```

Expected: no whitespace errors. The implementation commit contains only the
six planned files; pre-existing unrelated working-tree changes remain
unstaged and unchanged.
