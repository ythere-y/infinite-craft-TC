# Wall Unified Leaderboard Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wall podium and separate remainder list with one ordered 1–20 leaderboard whose rows share one structure while preserving first-honor details and current-user highlighting.

**Architecture:** Keep the existing leaderboard response and `firstHonorFor` conversion unchanged. `renderTop` creates one semantic ordered list and appends every API row in received order through one `buildRankingEntry` function; CSS gives all rows the same grid geometry and adds rank-only colors without visual reordering.

**Tech Stack:** Vanilla HTML/CSS/JavaScript ES modules, pytest, headless Chromium.

## Global Constraints

- Display API rows in received order; do not sort or split them on the client.
- Use one semantic list and one row builder for ranks 1–20.
- Show `🥇`, `🥈`, and `🥉` for ranks 1–3; show numeric ranks from 4 onward.
- Preserve exact `N 个首发` text, first-honor conversion, five-column icons, aggregation above 20 icons, current-user card, empty state, and error state.
- Do not modify the leaderboard API, backend ordering, pagination, score levels, or unrelated wall modules.
- Preserve all pre-existing dirty working-tree changes.

---

### Task 1: Specify the unified list in browser tests

**Files:**
- Modify: `tests/test_wall_ui.py`

**Interfaces:**
- Consumes: the production wall DOM, CSS, and four-row leaderboard fixture.
- Produces: regression coverage for title copy, one ordered list, API order, medals, identical row geometry, distinct podium colors, current-user highlighting, honor rendering, aggregation, and desktop/narrow overflow.

- [ ] **Step 1: Replace podium-specific assertions with unified-row assertions**

Use `.lb-ranking-list > .lb-row` as the row collection. Assert literal rank order `["1", "2", "3", "4"]`, visible rank labels `["🥇", "🥈", "🥉", "4"]`, one `OL`, and title text `🏆 排行榜 · Top 20`.

- [ ] **Step 2: Add layout assertions**

In the desktop probe, compare every row's width and left coordinate, assert strictly increasing `top` coordinates, verify rank 1–3 computed backgrounds are pairwise distinct, and confirm no horizontal overflow. Repeat width/order/overflow checks at 390px.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
```

Expected: leaderboard tests fail because the DOM still contains `.lb-podium` and `.lb-ranking-rest`, the first-place card is visually reordered/raised, and the title still says `打工人排行榜`.

---

### Task 2: Render and style unified leaderboard rows

**Files:**
- Modify: `frontend/wall/wall.js`
- Modify: `frontend/wall/wall.css`
- Modify: `frontend/wall/index.html`
- Test: `tests/test_wall_ui.py`

**Interfaces:**
- Consumes: `{ top: Array<{ rank, discoverer, firsts }> }` in API order and `firstHonorFor(firsts)`.
- Produces: `buildRankingEntry(row) -> HTMLLIElement` and one `<ol class="lb-ranking-list">` containing every rendered row.

- [ ] **Step 1: Implement the minimal unified renderer**

Make `buildRankingEntry(row)` always create `li.lb-row.rank-N[.me]`. Make `renderTop` create one `ol.lb-ranking-list`, append `top` entries with a single loop, and append that list to `#lb-list`.

- [ ] **Step 2: Replace podium CSS with shared row geometry**

Style `.lb-ranking-list` as a vertical list and every `.lb-row` with the same full-width grid, padding, gap, and border box. Add pale gold/silver/bronze backgrounds and matching borders to `.rank-1`, `.rank-2`, and `.rank-3`; retain `.me` as a left accent line without changing row dimensions. Remove podium ordering, translation, sizing, and narrow-screen overrides.

- [ ] **Step 3: Update title and cache versions**

Change the title to `排行榜`, and bump wall CSS/JS plus their module dependency query strings from `20260731a` to `20260731b`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands pass with no leaderboard overflow or ordering regressions.
