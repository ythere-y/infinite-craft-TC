# Midnight Toast and Hint Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a complete midnight theme to discovery toasts and remove the case-study and double-click guidance without removing double-click behavior.

**Architecture:** Keep toast rendering unchanged and use `body.ura-on` CSS overrides as the sole theme boundary. Remove unwanted guidance from static homepage markup, with browser and contract tests protecting the visible result and retained interaction behavior.

**Tech Stack:** HTML, CSS, browser JavaScript, Node.js test runner, pytest, headless Chromium.

## Global Constraints

- Do not remove or alter sidebar, canvas, or recipe-book double-click bindings.
- Remove guidance markup rather than hiding it with CSS.
- Do not add a new runtime dependency.
- Do not touch another developer’s unrelated working-tree files.

---

### Task 1: Midnight toast and simplified homepage guidance

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_casino_mode_ui.py`
- Modify: `tests/test_seed_reconciliation.py`

**Interfaces:**
- Consumes: `body.ura-on`, `.first-toast`, `.tier-global_new`, `.tier-global_known`, and the existing `bindDoubleTap(...)` bindings.
- Produces: a dark themed toast in inner mode and concise drag/Konami homepage guidance.

- [ ] **Step 1: Write failing behavior tests**

Add a real Chromium assertion that compares light and inner-mode computed
styles for the toast container, comment, divider, and publish button. Add a
homepage contract assertion that the hint contains neither `案例展示` nor
`双击`, while `frontend/app.js` still exposes all three existing
`bindDoubleTap(...)` call sites.

- [ ] **Step 2: Run tests and confirm the intended failures**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py tests/test_seed_reconciliation.py -q
```

Expected: the toast theme and homepage-copy assertions fail against the
existing light toast and case-study markup.

- [ ] **Step 3: Implement the minimal markup and CSS changes**

Delete the two double-click hint lines and the complete nine-step case-study
block from `frontend/index.html`. Add `body.ura-on` toast rules in
`frontend/style.css` for the container, both discovery tiers, title/result
text, comment, action divider, publish button states, and published label.

- [ ] **Step 4: Update the obsolete case-study seed test**

Replace the parser-based nine-step homepage assertion in
`tests/test_seed_reconciliation.py` with a homepage guidance assertion that
checks the case-study and double-click copy are absent. Seed integrity remains
covered by the existing authoritative seed-library tests in the same module.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_casino_mode_ui.py tests/test_seed_reconciliation.py -q
```

Expected: all targeted tests pass.

- [ ] **Step 6: Run required verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: every command exits with status 0.

- [ ] **Step 7: Commit only scoped files**

```bash
git commit --only -m "fix: align discovery toast with midnight mode" -- \
  .agent/docs/2026-08-03-midnight-toast-hint-cleanup-design.md \
  .agent/docs/2026-08-03-midnight-toast-hint-cleanup-implementation-plan.md \
  frontend/index.html frontend/style.css \
  tests-makers/frontend.test.mjs tests/test_casino_mode_ui.py \
  tests/test_seed_reconciliation.py
```
