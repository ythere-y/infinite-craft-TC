# Issue #16 Mobile Game Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main game usable on phone portrait screens with a two-row header, an uncropped rectangular workspace, and the element collection below it, without changing the desktop layout.

**Architecture:** Keep the existing HTML order and game state. Use a single phone media query to switch the page from the desktop row layout to normal vertical flow, add mobile-only copies of the help lines whose wording differs, and harden the existing double-tap binding so only mouse pointers can copy elements.

**Tech Stack:** Static HTML, CSS media queries, browser Pointer Events, vanilla JavaScript, Node.js test runner, FastAPI/Redis/SQLite local stack.

## Global Constraints

- All new layout and copy behavior applies only at phone widths; desktop structure, dimensions, copy, dragging, and mouse double-click remain unchanged.
- The mobile header has two rows and the complete nickname must remain visible without ellipsis or clipping.
- The mobile workspace is a complete rectangle above the element collection and displays every help, example, credit, and reference line.
- The mobile element collection appears below the workspace in this order: search, discovered count, element list.
- Touch and pen double-tap must never copy an element.
- Do not change backend APIs, storage, Makers bindings, or production deployment configuration.
- Do not commit `.env`, credentials, runtime data, or unrelated working-tree files.

---

### Task 1: Mobile layout and complete help content

**Files:**
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: Existing `.topbar`, `.topbar-actions`, `.nick-chip`, `.layout`, `.workspace`, `.hint`, `.sidebar`, `.sidebar-header`, `.element-list`, and `#search` markup and styles.
- Produces: `.desktop-only-help` and `.mobile-only-help` copy classes plus phone-only CSS that vertically orders the existing components.

- [ ] **Step 1: Write the failing structure and CSS regression test**

Append this test to `tests-makers/frontend.test.mjs`:

```js
test("phone layout stacks complete workspace and element collection without changing desktop", async () => {
  const [html, css] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/style.css", "utf8"),
  ]);

  assert.match(html, /class="hint-line mobile-only-help"[^>]*>👆 把下方的元素/);
  assert.match(html, /class="hint-line desktop-only-help"[^>]*>👆👆 <b>双击<\/b>/);
  assert.match(css, /\.mobile-only-help\s*\{\s*display:\s*none/);
  assert.match(css, /@media\s*\(max-width:\s*780px\)/);
  assert.match(css, /\.layout\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.workspace\s*\{[^}]*flex:\s*none[^}]*min-height:/s);
  assert.match(css, /\.sidebar\s*\{[^}]*width:\s*100%[^}]*border-left:\s*0/s);
  assert.match(css, /\.nick-chip\s*\{[^}]*max-width:\s*none[^}]*white-space:\s*normal/s);
  assert.match(css, /\.desktop-only-help\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.mobile-only-help\s*\{[^}]*display:\s*block/s);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="phone layout stacks" tests-makers/frontend.test.mjs`

Expected: FAIL because the mobile help classes and phone layout rules do not exist.

- [ ] **Step 3: Add explicit desktop and mobile help lines**

In `frontend/index.html`, retain all current hint content, mark the desktop-specific first and double-click lines, and add the mobile wording:

```html
<div class="hint-line desktop-only-help">👆 把右边的元素<b>拖</b>到工作区，再把一个元素<b>拖</b>到另一个元素上合成新玩意儿</div>
<div class="hint-line desktop-only-help">👆👆 <b>双击</b>右侧元素可快速放到画布中央；双击画布里的元素可就地复制一份</div>
<div class="hint-line mobile-only-help">👆 把下方的元素<b>拖</b>到工作区，再把一个元素<b>拖</b>到另一个元素上合成新玩意儿</div>
```

Keep the recipe line, keyboard line, all nine example steps, credit, and reference link unchanged and shared by both layouts.

- [ ] **Step 4: Implement the phone-only vertical layout**

In `frontend/style.css`, add the default visibility rule outside media queries:

```css
.mobile-only-help { display: none; }
```

Add one `@media (max-width: 780px)` block after the base sidebar styles. Use normal page flow, two header rows, an untruncated nickname, a rectangular workspace tall enough for all help text, and a bounded element list:

```css
@media (max-width: 780px) {
  html,
  body {
    height: auto;
    min-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .topbar {
    height: auto;
    min-height: 0;
    padding: calc(8px + env(safe-area-inset-top)) 10px 8px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 8px 10px;
  }

  .title { grid-column: 1; }

  .topbar-actions {
    grid-column: 2;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }

  .nick-chip {
    order: 99;
    flex-basis: 100%;
    max-width: none;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .layout {
    height: auto;
    min-height: 0;
    flex-direction: column;
  }

  .workspace {
    flex: none;
    width: 100%;
    min-height: 760px;
    overflow: hidden;
    border-bottom: 1px solid #ECECEC;
  }

  .hint {
    position: relative;
    top: auto;
    left: auto;
    transform: none;
    max-width: none;
    padding: 24px 16px;
  }

  .desktop-only-help { display: none; }
  .mobile-only-help { display: block; }

  .sidebar {
    flex: none;
    width: 100%;
    min-height: 320px;
    border-left: 0;
    border-bottom: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .element-list {
    max-height: min(55dvh, 520px);
    min-height: 220px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}
```

During implementation, adjust the exact `grid-template-columns` or workspace `min-height` only if the required 320/375/390/430 px viewport checks demonstrate clipping; preserve every behavioral assertion in the test.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `node --test --test-name-pattern="phone layout stacks" tests-makers/frontend.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the layout**

```bash
git add frontend/index.html frontend/style.css tests-makers/frontend.test.mjs
git commit -m "feat: stack mobile game layout vertically"
```

---

### Task 2: Mouse-only element duplication

**Files:**
- Modify: `tests-makers/frontend.test.mjs`
- Modify: `frontend/app.js`

**Interfaces:**
- Consumes: Existing `bindDoubleTap(el, handler)` and `fireOnce(e)` implementation.
- Produces: `isMouseDuplicationEvent(event): boolean`, used by both custom pointer double-tap and native `dblclick` paths.

- [ ] **Step 1: Write the failing source regression test**

Append this test to `tests-makers/frontend.test.mjs`:

```js
test("element duplication accepts mouse input and rejects touch or pen", async () => {
  const source = await readFile("frontend/app.js", "utf8");

  assert.match(source, /function isMouseDuplicationEvent\(event\)/);
  assert.match(source, /event\.pointerType === "mouse"/);
  assert.match(source, /if \(!isMouseDuplicationEvent\(e\)\) return;/);
  assert.match(source, /lastPointerType/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="element duplication accepts mouse" tests-makers/frontend.test.mjs`

Expected: FAIL because `isMouseDuplicationEvent` and pointer provenance tracking do not exist.

- [ ] **Step 3: Restrict both duplication paths to mouse input**

In `frontend/app.js`, add a pure helper immediately before `bindDoubleTap`:

```js
function isMouseDuplicationEvent(event) {
  return event.pointerType === "mouse";
}
```

Inside `bindDoubleTap`, track the last pointer source and reject non-mouse pointer events before updating double-tap state:

```js
let lastPointerType = "";

el.addEventListener("pointerdown", (e) => {
  lastPointerType = e.pointerType;
  downX = e.clientX;
  downY = e.clientY;
});

el.addEventListener("pointerup", (e) => {
  if (!isMouseDuplicationEvent(e)) {
    last = 0;
    return;
  }
  // existing movement, timing, coordinate, and fireOnce logic follows
});
```

Guard the native fallback against synthetic touch/pen double-click:

```js
el.addEventListener("dblclick", (e) => {
  if (lastPointerType !== "mouse") return;
  e.preventDefault();
  e.stopPropagation();
  fireOnce(e);
});
```

- [ ] **Step 4: Run the focused test and full frontend suite**

Run: `node --test --test-name-pattern="element duplication accepts mouse" tests-makers/frontend.test.mjs`

Expected: PASS.

Run: `npm test`

Expected: all Node tests PASS.

- [ ] **Step 5: Commit the interaction change**

```bash
git add frontend/app.js tests-makers/frontend.test.mjs
git commit -m "fix: disable touch element duplication"
```

---

### Task 3: Local deployment and responsive verification

**Files:**
- Modify only if a defect is found: `frontend/index.html`, `frontend/style.css`, `frontend/app.js`, `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: Completed phone layout and mouse-only duplication behavior from Tasks 1 and 2.
- Produces: Verified local build and a clean branch ready for user review; no push, PR, or merge.

- [ ] **Step 1: Run all required automated verification**

Run:

```powershell
npm test
python -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: every command exits with code 0. On systems where `python3` is available, also run the repository-prescribed spelling:

```powershell
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

- [ ] **Step 2: Start the local stack**

Confirm `.env` already exists without printing or modifying its secrets, then run:

```powershell
npm run dev
```

Expected: Docker Compose builds and starts the FastAPI, Redis, and SQLite local services.

- [ ] **Step 3: Verify service health**

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

Expected: a successful health response.

- [ ] **Step 4: Inspect phone and desktop viewports**

Use the browser against `http://127.0.0.1:8000/` and check 320×568, 375×667, 390×844, and 430×932 CSS px:

- header renders in two rows;
- nickname is complete, wraps when needed, and has no ellipsis;
- workspace is a complete rectangle above the element collection;
- mobile help says “下方的元素” and shows every shared help/example/credit/reference line;
- search, discovered count, and element list appear below the workspace;
- no unexpected horizontal scrolling or overlay;
- touch dragging from the list reaches the workspace without copying on repeated taps.

Then check a desktop viewport of at least 1280×720:

- header remains one row;
- sidebar remains fixed on the right;
- desktop help still says “右边” and includes double-click instructions;
- mouse double-click still creates exactly one copy.

- [ ] **Step 5: Stop the local stack**

Run:

```powershell
npm run dev:down
```

Expected: local containers stop cleanly.

- [ ] **Step 6: Re-run affected checks after any visual fix**

If Step 4 required a CSS, HTML, JavaScript, or test correction, run:

```powershell
npm test
python -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 7: Commit only verified corrective changes**

If Step 4 required changes:

```bash
git add frontend/index.html frontend/style.css frontend/app.js tests-makers/frontend.test.mjs
git commit -m "fix: refine mobile game viewport"
```

If no corrective changes were needed, do not create an empty commit.

- [ ] **Step 8: Hand off for user confirmation**

Report the tested viewport results, automated command results, health result, commit list, and exact changed files. Stop before any push, pull request, or merge into `main`; wait for explicit user confirmation.
