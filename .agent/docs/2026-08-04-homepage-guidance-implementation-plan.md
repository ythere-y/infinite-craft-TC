# Homepage Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the homepage guidance minimal by default while exposing all advanced operations and the “滨海大厦” example through the existing question-mark button.

**Architecture:** Split the existing guidance markup into an always-visible basic section and an initially hidden advanced section. The existing button toggles the advanced section directly and synchronizes `aria-expanded`; no new modal, dependency, or application subsystem is introduced.

**Tech Stack:** Static HTML/CSS, browser JavaScript, Node.js built-in test runner, pytest browser integration tests.

## Global Constraints

- The default guidance shows only the simplest drag-and-combine instruction.
- Desktop refers to elements on the right; mobile refers to elements below.
- Advanced guidance retains double-click help, recipe-book help, the keyboard sequence, credits, and the nine-step “滨海大厦” example.
- The advanced section is hidden on initial load and toggled by the existing question-mark button.
- The button exposes its state with `aria-expanded`.
- Do not alter drag, drop, double-click, recipe-book, combination, or casino-mode behavior.
- Do not add dependencies.

---

### Task 1: Progressive Homepage Guidance

**Files:**
- Modify: `tests/test_casino_mode_ui.py`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_seed_reconciliation.py`
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`

**Interfaces:**
- Consumes: the existing `#btn-help` button and `bindButtons()` initialization.
- Produces: `#advanced-guidance`, whose `hidden` property is toggled by `#btn-help`; `#btn-help[aria-expanded]` always reflects the inverse of that hidden state.

- [ ] **Step 1: Write the failing browser behavior test**

Extend the production-page probe in `tests/test_casino_mode_ui.py` to capture
the default basic text, initial advanced visibility, and button state; click the
button once and capture the expanded state:

```javascript
var hint = document.getElementById("hint");
var advancedGuidance = document.getElementById("advanced-guidance");
var helpButton = document.getElementById("btn-help");
var initialGuidance = {
  visible_text: hint.innerText,
  advanced_hidden: advancedGuidance.hidden,
  expanded: helpButton.getAttribute("aria-expanded")
};
helpButton.click();
var expandedGuidance = {
  visible_text: hint.innerText,
  advanced_hidden: advancedGuidance.hidden,
  expanded: helpButton.getAttribute("aria-expanded")
};
helpButton.click();
var collapsedGuidance = {
  advanced_hidden: advancedGuidance.hidden,
  expanded: helpButton.getAttribute("aria-expanded")
};
```

Replace the current guidance assertions with behavior assertions:

```python
assert "拖" in actual["initial_guidance"]["visible_text"]
assert "合成" in actual["initial_guidance"]["visible_text"]
assert "双击" not in actual["initial_guidance"]["visible_text"]
assert "案例展示" not in actual["initial_guidance"]["visible_text"]
assert actual["initial_guidance"]["advanced_hidden"] is True
assert actual["initial_guidance"]["expanded"] == "false"

assert "双击" in actual["expanded_guidance"]["visible_text"]
assert "案例展示" in actual["expanded_guidance"]["visible_text"]
assert "滨海大厦" in actual["expanded_guidance"]["visible_text"]
assert actual["expanded_guidance"]["advanced_hidden"] is False
assert actual["expanded_guidance"]["expanded"] == "true"

assert actual["collapsed_guidance"] == {
    "advanced_hidden": True,
    "expanded": "false",
}
assert actual["double_click_retained"] is True
```

This test catches a missing default collapse, a button wired to the wrong
element, a stale accessibility state, or accidental removal of the retained
advanced content.

- [ ] **Step 2: Update the static contracts before implementation**

In `tests-makers/frontend.test.mjs`, require:

```javascript
assert.match(html, /id="btn-help"[^>]*aria-expanded="false"[^>]*aria-controls="advanced-guidance"/);
assert.match(hint[1], /class="basic-guidance"/);
assert.match(hint[1], /id="advanced-guidance"[^>]*hidden/);
assert.match(hint[1], /id="advanced-guidance"[\s\S]*双击[\s\S]*案例展示[\s\S]*滨海大厦/);
```

Ensure the extracted `basic-guidance` section does not contain `双击`,
`案例展示`, or `↑↑↓↓←→←→BA`. Update the mobile layout assertion so it
expects the desktop double-click copy inside `#advanced-guidance`, rather than
as a default top-level hint line.

In `tests/test_seed_reconciliation.py`, rename the homepage test to describe
progressive guidance and assert that the example and double-click text occur
after the `id="advanced-guidance"` marker.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py -k guidance -q
python3 -m pytest tests/test_seed_reconciliation.py -k homepage_guidance -q
```

Expected: failures because `#advanced-guidance` and the button accessibility
state do not exist, and because all help text is currently visible.

- [ ] **Step 4: Implement the minimal markup**

In `frontend/index.html`, initialize the button as collapsed:

```html
<button id="btn-help" class="btn-help"
        title="显示/隐藏操作引导"
        aria-label="帮助"
        aria-expanded="false"
        aria-controls="advanced-guidance">
```

Split the hint into:

```html
<div id="hint" class="hint">
  <div class="basic-guidance">
    <div class="hint-line desktop-only-help">👆 把右边的元素<b>拖</b>到工作区，再把一个元素<b>拖</b>到另一个元素上合成新玩意儿</div>
    <div class="hint-line mobile-only-help">👆 把下方的元素<b>拖</b>到工作区，再把一个元素<b>拖</b>到另一个元素上合成新玩意儿</div>
  </div>
  <div id="advanced-guidance" hidden>
    <!-- Existing desktop double-click, recipe-book, keyboard, case-study,
         and credit markup moves here unchanged. -->
  </div>
</div>
```

Do not remove the `case-step` markup or its CSS because the example remains in
the expanded guide.

- [ ] **Step 5: Implement the minimal toggle**

Replace the current whole-hint toggle in `frontend/app.js`:

```javascript
$("#btn-help")?.addEventListener("click", (event) => {
  const guidance = document.getElementById("advanced-guidance");
  if (!guidance) return;
  guidance.hidden = !guidance.hidden;
  event.currentTarget.setAttribute(
    "aria-expanded",
    String(!guidance.hidden),
  );
});
```

This leaves the basic guidance visible while opening and closing only advanced
content.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py -k guidance -q
python3 -m pytest tests/test_seed_reconciliation.py -k homepage_guidance -q
```

Expected: all selected tests pass.

- [ ] **Step 7: Run complete required verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: every command exits successfully with no test failures or build
errors.

- [ ] **Step 8: Review and commit**

Run:

```bash
git diff --check
git status --short
git diff -- frontend/index.html frontend/app.js tests-makers/frontend.test.mjs tests/test_casino_mode_ui.py tests/test_seed_reconciliation.py
```

Confirm only the planned files and the implementation plan are changed, then:

```bash
git add .agent/docs/2026-08-04-homepage-guidance-implementation-plan.md frontend/index.html frontend/app.js tests-makers/frontend.test.mjs tests/test_casino_mode_ui.py tests/test_seed_reconciliation.py
git commit -m "fix: simplify default homepage guidance"
```
