# Compact Element Label Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display every sidebar element name without clipping, keep a visible gap between the successful-combination sticker and result name, and restore persisted AI comments in recipe detail cards.

**Architecture:** Keep the approved three-column sidebar and compact its standard chips. The shared icon system will measure real rendered text fragments and progressively mark chips to span two or three columns when two lines are insufficient. The toast receives a local flex layout on its existing `.first-toast-icon` target, preserving the safe renderer and 40px detail sticker.

**Tech Stack:** Vanilla JavaScript, CSS Grid/Flexbox, FastAPI static frontend, pytest, real headless Chromium.

## Global Constraints

- Preserve every pre-existing uncommitted change in `frontend/app.js`, `frontend/effects.js`, `frontend/index.html`, `frontend/style.css`, `tests-makers/frontend.test.mjs` and `tests/test_combine_feedback.py`.
- Retain the three-column grid and minimum 41px pointer target.
- Sidebar stickers are 22px; sidebar names are 12px and never ellipsized, clamped or hidden.
- Standard chips use at most two lines; overflow first spans two columns, then all three columns if still necessary.
- The toast detail sticker remains 40px and has at least 12px physical separation from its name.
- Do not modify icon mappings, generated assets, persistence schemas or
  database write behavior. Recipe-detail read projections may add the existing
  optional `comment` field.
- Use real rendered geometry in Chromium; do not infer fit from character counts.
- Stage or commit only this plan's isolated changes. Do not stage concurrent user changes.

---

### Task 1: Make Sidebar Labels Adapt to Rendered Width

**Files:**
- Modify: `tests/test_combine_feedback.py`
- Modify: `frontend/icon-system.js`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: `ICON_SYSTEM.renderElement(document, target, payload)` and `.element-list > .element` chips.
- Produces: `ICON_SYSTEM.fitSidebarChip(target) -> number`, returning the final rendered line count and applying at most one of `sidebar-span-2` or `sidebar-span-3`.

- [ ] **Step 1: Add a real Chromium regression**

Extend `_run_browser()` with an optional viewport argument that adds an exact
`--window-size=<width>,<height>` flag. Add
`test_sidebar_repository_names_wrap_and_expand_without_clipping` using
production stylesheet order.

The browser fixture must:

```javascript
var list = document.createElement("div");
list.className = "element-list";
list.style.width = "300px";
document.body.appendChild(list);

function add(name) {
  var chip = document.createElement("div");
  chip.className = "element";
  list.appendChild(chip);
  window.ICON_SYSTEM.renderElement(document, chip, {
    name: name,
    emoji: "🧩",
    icon: { base: "🧩", palette: "product", source: "generated" }
  });
  window.ICON_SYSTEM.fitSidebarChip(chip);
  return chip;
}
```

Use literal fixtures:

```text
水
腾讯音乐娱乐
上坟都不敢这么烧
ima.copilot
这是一个故意长到标准两行绝对放不下的元素名称
这是一个故意长到横跨两列以后两行仍然放不下并且必须占满三列的元素名称
```

For each chip, use a `Range` over `.name` to collect rendered line rectangles.
Assert the complete `textContent`, no name rectangle extends outside its chip,
22px sticker size, minimum 41px chip height and at most two lines. Assert normal
fixtures have no span class, the first synthetic long fixture has
`sidebar-span-2`, and the longest has `sidebar-span-3`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py::test_sidebar_repository_names_wrap_and_expand_without_clipping -q
```

Expected failure: `ICON_SYSTEM.fitSidebarChip is not a function`. Once the
helper exists, the same test continues to protect the 22px size, complete text
and two-line/span geometry contracts.

- [ ] **Step 3: Add rendered-line measurement to the shared icon system**

Add private and public functions:

```javascript
function renderedLineCount(nameNode) {
  if (!nameNode || !nameNode.textContent) return 0;
  var range = nameNode.ownerDocument.createRange();
  range.selectNodeContents(nameNode);
  var tops = [];
  Array.from(range.getClientRects()).forEach(function (rect) {
    if (!rect.width && !rect.height) return;
    var top = Math.round(rect.top * 2) / 2;
    if (!tops.some(function (seen) { return Math.abs(seen - top) < 0.5; })) {
      tops.push(top);
    }
  });
  return tops.length;
}

function fitSidebarChip(target) {
  if (!target || !target.classList) return 0;
  target.classList.remove("sidebar-span-2", "sidebar-span-3");
  var nameNode = target.querySelector(".name");
  var lines = renderedLineCount(nameNode);
  if (lines > 2) {
    target.classList.add("sidebar-span-2");
    lines = renderedLineCount(nameNode);
  }
  if (lines > 2) {
    target.classList.remove("sidebar-span-2");
    target.classList.add("sidebar-span-3");
    lines = renderedLineCount(nameNode);
  }
  return lines;
}
```

Expose `fitSidebarChip` on `window.ICON_SYSTEM`. Do not call it for canvas,
recipe, wall or admin elements.

- [ ] **Step 4: Call fitting after every sidebar render**

In `renderSidebar()`, append each chip before fitting it:

```javascript
const chip = makeElementChip(info, {
  isFirst: state.firsts.has(name),
  source: "sidebar",
});
list.appendChild(chip);
window.ICON_SYSTEM?.fitSidebarChip?.(chip);
```

Add `fitAllSidebarChips()` and schedule it once after
`EFFECTS.reapplyUra()` so the active font cannot leave stale span classes.
Attach one `ResizeObserver` to `list` when available; its callback schedules
`fitAllSidebarChips()` with `requestAnimationFrame`, allowing viewport/sidebar
width changes to be remeasured without observing chip height changes.

- [ ] **Step 5: Compact only repository chips**

Add higher-specificity rules without changing global canvas/detail sizes:

```css
.element-list > .element {
  min-height: 41px;
  padding: 4px 5px;
  gap: 4px;
  overflow: visible;
  font-size: 12px;
  line-height: 1.15;
  white-space: normal;
}
.element-list > .element .element-icon-sidebar {
  width: 22px;
  height: 22px;
  flex-basis: 22px;
}
.element-list > .element .name {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.element-list > .element.sidebar-span-2 { grid-column: span 2; }
.element-list > .element.sidebar-span-3 { grid-column: 1 / -1; }
```

Use `!important` only if the existing `.element-icon-sidebar` important size
rules require it; keep the override scoped below `.element-list`.

- [ ] **Step 6: Run sidebar GREEN and related geometry regressions**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_sidebar_repository_names_wrap_and_expand_without_clipping \
  tests/test_combine_feedback.py::test_boss_mode_preserves_canvas_element_geometry_and_restores_icon \
  -q
```

Expected: all selected tests PASS.

---

### Task 2: Separate Toast Sticker and Result Name

**Files:**
- Modify: `tests/test_combine_feedback.py`
- Modify: `frontend/icon-system.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: the existing `COMBINE_FEEDBACK.renderToast()` DOM structure, where `.first-toast-icon` contains `.element-icon-detail` and `.name`.
- Produces: a non-overlapping toast row with a measured sticker/name gap of at least 12px.

- [ ] **Step 1: Add desktop and mobile Chromium regressions**

Add a parameterized test or two literal viewport cases, `1440x800` and
`390x844`. Render a `.first-toast.show` with a fixed available width and a long
result name through the real `COMBINE_FEEDBACK.renderToast()` function.

Collect:

```javascript
var stickerRect = target.querySelector(".element-icon").getBoundingClientRect();
var nameRect = target.querySelector(".name").getBoundingClientRect();
return {
  gap: nameRect.left - stickerRect.right,
  overlaps: nameRect.left < stickerRect.right,
  iconWidth: stickerRect.width,
  fullName: target.querySelector(".name").textContent
};
```

Assert `gap >= 12`, `overlaps === false`, `iconWidth === 40` and the complete
literal long name at both viewports.

- [ ] **Step 2: Run the toast test and verify RED**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py::test_toast_sticker_and_name_keep_safe_spacing -q
```

Expected failure: current `.first-toast-icon` has inline layout and reports a
gap below 12px.

- [ ] **Step 3: Apply the local toast layout**

Add to `frontend/icon-system.css`:

```css
.first-toast-icon {
  display: inline-flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.first-toast-icon > .element-icon { flex: 0 0 40px; }
.first-toast-icon > .name {
  min-width: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
```

Do not change the renderer or duplicate the result name outside the existing
safe `.name` node.

- [ ] **Step 4: Advance the shared frontend cache version**

In `frontend/index.html`, advance all six shared CSS/JS query strings from the
current concurrent value `20260728d` to `20260728e`, preserving every other
uncommitted HTML change.

- [ ] **Step 5: Run toast GREEN and safe-render regressions**

Run:

```bash
python3 -m pytest \
  tests/test_combine_feedback.py::test_toast_sticker_and_name_keep_safe_spacing \
  tests/test_combine_feedback.py::test_render_toast_replaces_children_with_exact_text_nodes \
  tests/test_combine_feedback.py::test_icon_tooltip_refreshes_metadata_when_reusing_a_target \
  -q
```

Expected: all selected tests PASS.

---

### Task 3: Project and Render Persisted AI Recipe Comments

**Files:**
- Modify: `tests/test_comments.py`
- Modify: `tests-makers/router.test.mjs`
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `backend/archive.py`
- Modify: `backend/main.py`
- Modify: `edge-functions/_lib/router.js`
- Create: `frontend/wall/recipe-comments.js`
- Modify: `frontend/wall/wall.js`

**Interfaces:**
- Consumes: persisted combination records with optional `comment`.
- Produces: recipe-detail rows with `comment: string` and
  `recipeCommentFor(recipe, openFormula) -> string | null`.

- [ ] **Step 1: Add failing persistence and API projection tests**

In `tests/test_comments.py`, use a temporary archive and write:

```python
archive.upsert_combination(
    "张志东 + 秃头循环",
    "张志东",
    "💻",
    "llm",
    None,
    comment="大佬面前，秃头循环只能绕道走。",
)
```

Assert `archive.recipes_for("张志东")[0]["comment"]` and
`asyncio.run(main.api_element_recipes("张志东"))["recipes"][0]["comment"]`
equal the literal text.

In `tests-makers/router.test.mjs`, persist a dynamic recipe with a literal
comment, request `/api/element/<result>/recipes`, and assert the matching
recipe row returns it while the seed row comment is `""`.

- [ ] **Step 2: Run backend tests and verify RED**

```bash
python3 -m pytest tests/test_comments.py -q
node --test tests-makers/router.test.mjs
```

Expected: Python fails because the SQLite recipe row has no `comment`; Makers
fails because `recipePayload()` omits it.

- [ ] **Step 3: Project comments without changing writes**

Change the SQLite query to:

```sql
SELECT key, source, chain, comment, hit_count
FROM combinations
WHERE result = ?
```

Return `comment: r["comment"] or ""` from `archive.recipes_for()`, pass that
field through `backend.main.api_element_recipes()`, and add
`comment: recipe.comment || ""` to Makers `recipePayload()`.

- [ ] **Step 4: Add a real pure frontend comment selector**

Create `frontend/wall/recipe-comments.js`:

```javascript
function sameRecipePair(recipe, formula) {
  if (!recipe || !formula) return false;
  return [recipe.a || "", recipe.b || ""].sort().join("\n") ===
    [formula.a || "", formula.b || ""].sort().join("\n");
}

export function recipeCommentFor(recipe, openFormula = null) {
  const archived = typeof recipe?.comment === "string"
    ? recipe.comment.trim()
    : "";
  if (archived) return archived;
  if (!openFormula?.id || !sameRecipePair(recipe, openFormula)) return null;
  const fallback = typeof openFormula.comment === "string"
    ? openFormula.comment.trim()
    : "";
  return fallback || null;
}
```

Import it from `wall.js`, remove the old closure-bound
`sameRecipePair()/recipeCommentFor()`, and call
`recipeCommentFor(r, _recipeOpenFormula)`. Existing `node()` rendering remains
safe text-only.

In `tests-makers/frontend.test.mjs`, import the helper and assert:

- an archived AI comment wins;
- a matching legacy formula supplies the fallback;
- a seed row and an empty comment return `null`;
- reversed operand order still matches.

- [ ] **Step 5: Run recipe comment GREEN**

```bash
python3 -m pytest tests/test_comments.py -q
node --test tests-makers/router.test.mjs tests-makers/frontend.test.mjs
```

Expected: PASS.

---

### Task 4: Verify and Reload the Existing Service

**Files:**
- Verify only: all files changed above plus pre-existing concurrent files.

**Interfaces:**
- Consumes: the completed sidebar, toast and recipe-comment fixes.
- Produces: fresh test/build evidence and an HTTP-accessible service on port 8000.

- [ ] **Step 1: Run focused frontend verification**

```bash
python3 -m pytest tests/test_combine_feedback.py -q
node --test tests-makers/frontend.test.mjs
```

Expected: PASS with no application assertion failures.

- [ ] **Step 2: Run full repository verification**

```bash
npm test
python3 -m pytest tests -q
npm run build
git diff --check
```

Expected: Node and Python suites PASS; build reports 591/591, 9.81%, no locked
semantic regression; diff check exits 0.

- [ ] **Step 3: Verify the mounted service**

Docker Compose mounts `frontend/` read-only and Uvicorn reload is already
running. Verify without deleting or recreating data:

```bash
docker compose ps
docker compose exec -T web python -c \
  'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=5).status)'
curl --noproxy '*' --fail http://21.214.53.194:8000/
```

Expected: containers running, health `200`, public-IP root `200`, and served
HTML references cache version `20260728e`. Also request:

```bash
curl --noproxy '*' --fail \
  'http://21.214.53.194:8000/api/element/%E5%BC%A0%E5%BF%97%E4%B8%9C/recipes'
```

Expected: the `llm` recipe row includes
`"comment":"大佬面前，秃头循环只能绕道走。"`.

- [ ] **Step 4: Preserve concurrent changes in handoff**

Use `git diff --stat`, `git status --short` and a scoped diff review. Do not
stage the six pre-existing dirty paths as a combined commit. Report exactly
which hunks belong to this fix and leave all concurrent source edits intact.
