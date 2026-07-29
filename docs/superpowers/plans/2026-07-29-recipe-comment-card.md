# Recipe Comment Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place each recipe comment directly beneath its formula inside one shared recipe-card background.

**Architecture:** Keep the existing API and comment-selection helper unchanged. Move card chrome from `.recipe-row` to `.recipe-entry`, add a `has-comment` state only when a non-empty comment is rendered, and use that state to tighten the formula-to-comment spacing without changing comment-free rows.

**Tech Stack:** Vanilla ES modules, CSS, Node test runner, pytest with headless Chromium, Docker Compose.

## Global Constraints

- Formula and comment share one background, border, rounded outline, and hover state.
- Comment remains 12px secondary text and wraps inside the card.
- Recipes without a comment render no empty comment node and keep compact single-row spacing.
- Preserve the existing API, comment selection, and text-safe DOM rendering.
- Work directly in the current shared `main` workspace; do not revert or stage unrelated dirty changes.

---

### Task 1: Put the comment inside the visual recipe card

**Files:**
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `tests/test_combine_feedback.py`
- Modify: `frontend/wall/wall.js`
- Modify: `frontend/wall/wall.css`

**Interfaces:**
- Consumes: `recipeCommentFor(recipe, openFormula) -> string | null`
- Produces: `.recipe-entry.has-comment`, whose background contains `.recipe-row` and `.recipe-comment`

- [ ] **Step 1: Write failing structure and browser-layout tests**

Add a Node assertion that `wall.js` applies `has-comment` only in the non-null comment branch. Extend the existing browser harness with `frontend/wall/wall.css`, then construct one commented entry and assert:

```python
assert actual["entryBackground"] == "rgb(250, 250, 250)"
assert actual["rowBackground"] == "rgba(0, 0, 0, 0)"
assert actual["commentInsideCard"] is True
assert actual["verticalGap"] <= 4
```

Also construct a comment-free `.recipe-entry` and assert it has no `.recipe-comment` and retains the normal formula-row padding.

- [ ] **Step 2: Run tests and verify the intended red state**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py::test_recipe_comment_shares_formula_card_background -q
```

Expected: Node fails because `has-comment` is not applied; Chromium fails because the entry background is transparent and the comment sits outside the row background.

- [ ] **Step 3: Implement the minimal DOM state**

In `renderRecipes`, replace the existing comment append with:

```js
entry.append(row);
if (comment !== null) {
  entry.classList.add("has-comment");
  entry.append(node("div", "recipe-comment", comment));
}
```

- [ ] **Step 4: Move the visual card chrome to `.recipe-entry`**

Use these responsibilities in `wall.css`:

```css
.recipe-entry {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  background: #FAFAFA;
  border: 1px solid #ECECEC;
  border-radius: 12px;
}
.recipe-entry:hover { background: #F4F4F4; }
.recipe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
}
.recipe-entry.has-comment .recipe-row { padding-bottom: 6px; }
.recipe-comment {
  min-height: 18px;
  padding: 0 12px 10px;
  color: #999;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
}
```

- [ ] **Step 5: Run focused tests and verify green**

Run the two commands from Step 2. Expected: both pass.

---

### Task 2: Refresh assets, verify, and update the running service

**Files:**
- Modify: `frontend/wall/index.html`
- Verify: all files changed by Task 1

**Interfaces:**
- Consumes: the updated wall module and stylesheet
- Produces: an IP-accessible Docker service serving the new cache version

- [ ] **Step 1: Advance the wall asset cache version**

Change the wall stylesheet and module query versions from `20260728f` to `20260729a`. Keep the shared icon stylesheet and script on the same version so a reload fetches a coherent asset set.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm test
python3 -m pytest tests -q
npm run build
git diff --check
```

Expected: 0 failures, successful build, and no whitespace errors.

- [ ] **Step 3: Rebuild the local Docker service**

Run:

```bash
docker compose up --build -d --remove-orphans
docker compose ps
```

Expected: Redis healthy and web listening on `0.0.0.0:8000`.

- [ ] **Step 4: Verify through the SSH-accessible IP**

Request `http://21.214.53.194:8000/wall` and confirm HTTP 200 plus cache version `20260729a`. In headless Chromium, open the same IP, render or open a recipe with a comment, and confirm the formula row and comment are both contained by the same non-transparent `.recipe-entry` background with no runtime exceptions.

- [ ] **Step 5: Preserve the shared working tree**

Do not stage or commit implementation files because they overlap the existing shared dirty worktree. Report the exact files changed and leave all unrelated modifications untouched.
