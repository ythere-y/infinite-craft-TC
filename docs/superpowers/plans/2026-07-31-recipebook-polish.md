# Recipebook Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recipebook’s red Mac-style close control with a neutral right-side button and make only overflowing formula rows shrink to fit a wider responsive drawer.

**Architecture:** Keep recipe rendering in `frontend/app.js`, adding one DOM-measurement helper that assigns normal, dense, or ultra-dense classes after each row is inserted. Keep all visual sizing in `frontend/style.css`; update only the close-button markup in `frontend/index.html`. Validate the production DOM and computed geometry in headless Chromium.

**Tech Stack:** Vanilla JavaScript, CSS, existing icon system, pytest, headless Chromium.

## Global Constraints

- Desktop recipebook width is 480px; actual width never exceeds `100vw`.
- Close control is a neutral 30×30px rounded button at the header’s top right.
- Existing close behavior, `title`, `aria-label`, keyboard focus, and icon-system rendering remain available.
- Normal formulas keep their current size.
- Only rows whose real `scrollWidth` exceeds `clientWidth` enter dense and then ultra-dense mode.
- Formula names remain complete and on one line; drag, double-tap, filtering, score display, and persistence behavior do not change.
- Light and night modes both remain readable.
- Preserve all unrelated staged and unstaged user changes, especially existing recipe-link work in overlapping frontend and test files.

---

### Task 1: Responsive Recipebook Header and Formula Rows

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Test: `tests/test_recipebook_ui.py`

**Interfaces:**
- `fitRecipeRow(row: HTMLElement): void` clears both density classes, measures the inserted row, then adds `recipe-row-dense` and optionally `recipe-row-ultra-dense`.
- `renderRecipebook(filter)` appends each complete row before calling `fitRecipeRow(row)`.
- `#recipebook-close` keeps its identifier and event binding but uses `recipebook-close-button`.

- [ ] **Step 1: Add a real-browser failing test**

Create a Chromium test that loads the production index, styles, icon system, combine feedback, score-level helper, and app. Seed one short and one deliberately long recipe through the real `state.recipes` structure, open the drawer, and assert literal behavior:

```text
desktop drawer width = 480
close button right edge is within 16px of header right edge
close button computed background is not rgb(255, 95, 87)
short row has neither density class
long row has dense or ultra-dense class
long row scrollWidth <= long row clientWidth
all rows use nowrap
clicking close removes recipebook.show
```

Run the same page at a 360px viewport and assert drawer width is at most 360px.

- [ ] **Step 2: Run the browser test and verify RED**

Run:

```text
python3 -m pytest tests/test_recipebook_ui.py -q
```

Expected: failures show the current 420px drawer, red left-side close control, and absence of density classes.

- [ ] **Step 3: Implement the neutral right-side close control**

In `frontend/index.html`, remove the `mac-traffic-lights` wrapper and keep the existing button directly under `.recipebook-header`:

```html
<button id="recipebook-close"
        class="recipebook-close-button"
        title="关闭"
        aria-label="关闭配方图鉴"
        data-action-icon="close"
        data-icon-action="close"></button>
```

In `frontend/style.css`, make the header `position: relative`, reserve title space on the right, define the 30×30px neutral button, hover/focus-visible states, and matching night-mode colors. Remove the obsolete Mac traffic-light rules.

- [ ] **Step 4: Implement measured density classes**

In `frontend/app.js`, add:

```javascript
function fitRecipeRow(row) {
  row.classList.remove("recipe-row-dense", "recipe-row-ultra-dense");
  if (row.scrollWidth <= row.clientWidth) return;
  row.classList.add("recipe-row-dense");
  if (row.scrollWidth <= row.clientWidth) return;
  row.classList.add("recipe-row-ultra-dense");
}
```

Call it immediately after `list.appendChild(row)`.

In `frontend/style.css`, set the drawer width to `min(480px, 100vw)` and its hidden left offset to `-480px`. Keep rows on one line. Dense and ultra-dense classes progressively reduce `--element-icon-canvas`, row/chip gaps, padding, name font size, operators, and `.recipe-score` dimensions. Do not add ellipsis or hide names.

- [ ] **Step 5: Run targeted tests and verify GREEN**

Run:

```text
python3 -m pytest tests/test_recipebook_ui.py tests/test_combine_feedback.py -q
node --test tests-makers/frontend.test.mjs
```

Expected: all targeted browser and frontend tests pass.

- [ ] **Step 6: Run full verification**

Run:

```text
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
python3 -m pytest tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: zero failures, successful production build, and no whitespace errors.

- [ ] **Step 7: Commit only scoped hunks**

```text
git commit -m "feat: polish responsive recipebook"
```

The commit must include only the recipebook close-button, drawer sizing, density measurement/styles, and the new test. Restore every unrelated pre-existing overlapping hunk to its original staged or unstaged state.
