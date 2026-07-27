# Unified Combine Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate formula-publication bubble with an action area inside the existing bottom-right combine feedback Toast, using one eight-second lifecycle.

**Architecture:** `frontend/combine-feedback.js` remains the safe DOM rendering boundary and gains a callback-driven publication action renderer. `frontend/app.js` owns the publication HTTP request and passes it into that renderer, while `frontend/effects.js` owns the single Toast timer. Existing formula governance APIs and storage remain unchanged.

**Tech Stack:** Browser-native HTML/CSS/JavaScript, Python pytest browser harness, headless Chrome/Edge or js2py, Node test runner.

## Global Constraints

- Display exactly one combine feedback bubble after a successful combination.
- Keep the existing `#first-toast` bottom-right position and three discovery-tier visual treatments.
- Show the formula-publication action only when `/api/combine` returns `formula_id`.
- Automatically hide the unified bubble after exactly 8000 milliseconds.
- A later combination replaces all earlier feedback and restarts the 8000 millisecond timer.
- Publication success or failure must not extend the timer.
- Keep formula publication HTTP behavior in `frontend/app.js`; do not modify the API, eligibility rules, anonymous identity, voting, moderation, or storage.
- Render model and server-controlled text with `textContent`; do not introduce `innerHTML`.
- On mobile, keep 12px horizontal viewport margins and a publication control at least 44px high.
- Do not stage or commit the unrelated untracked `CLAUDE.md`.

---

### Task 1: Add a Safe, Testable Publication Action Renderer

**Files:**
- Modify: `frontend/combine-feedback.js`
- Modify: `tests/test_combine_feedback.py`

**Interfaces:**
- Consumes: `Document`, the existing `#first-toast` element, and a callback returning `Promise<{ok: boolean, detail?: string}>`.
- Produces: `COMBINE_FEEDBACK.renderPublishAction(doc, target, payload) -> HTMLElement`, where `payload.publish` performs the HTTP operation and the returned element is `.first-toast-actions`.

- [ ] **Step 1: Make the browser test harness await asynchronous DOM tests**

Update `_run_browser()` so the injected test function may return either a plain value or a Promise. Resolve it before writing `#__result`, and preserve synchronous exception reporting:

```python
"<script>",
"var pending;",
"try {",
f"  pending = (function () {{ {test_script} }})();",
"} catch (error) {",
"  pending = Promise.reject(error);",
"}",
"Promise.resolve(pending).then(function (value) {",
"  document.getElementById('__result').textContent = "
"JSON.stringify({ok: true, value: value});",
"}, function (error) {",
"  document.getElementById('__result').textContent = "
"JSON.stringify({ok: false, error: String(error && error.stack || error)});",
"});",
"</script>",
```

Add `--virtual-time-budget=1000` to the headless browser arguments so queued Promise callbacks finish before `--dump-dom` captures the page.

- [ ] **Step 2: Write failing tests for success, failure, and stale-request isolation**

Add tests that call the new renderer directly. The success test verifies containment, button state, success copy, and the community link:

```python
def test_publish_action_renders_inside_toast_and_handles_success(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return (async function () {
          var toast = document.getElementById("fixture");
          toast.id = "first-toast";
          var calls = 0;
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
            publish: async function () {
              calls += 1;
              return { ok: true };
            }
          });
          var button = toast.querySelector(".first-toast-actions button");
          button.click();
          await Promise.resolve();
          await Promise.resolve();
          return {
            calls: calls,
            standalone: document.querySelector(".formula-publish") !== null,
            text: toast.querySelector(".first-toast-actions").textContent,
            href: toast.querySelector(".first-toast-actions a").getAttribute("href")
          };
        })();
        """,
    )
    assert actual == {
        "calls": 1,
        "standalone": False,
        "text": "✅ 已公开，社区现在可以投票查看广场",
        "href": "/community.html",
    }
```

Add a failure test whose callback returns `{ok: false, detail: "<服务端错误>"}`. Assert the button is enabled again, its text equals the exact detail string, and no HTML element is created from that string.

Add a network-error case whose callback rejects. Assert the enabled button reads `公开失败，请重试`.

Add a stale-request test with a manually controlled Promise:

```javascript
var finish;
window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
  publish: function () {
    return new Promise(function (resolve) { finish = resolve; });
  }
});
toast.querySelector("button").click();
window.COMBINE_FEEDBACK.renderToast(document, toast, {
  tier: "seen", emoji: "🆕", name: "下一次结果", comment: "新点评"
});
window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
  publish: async function () { return { ok: true }; }
});
finish({ ok: true });
await Promise.resolve();
```

Assert the current Toast still contains `下一次结果`, still has its new publication button, and does not contain `已公开`.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: the new tests fail because `renderPublishAction` is not defined. Existing tests continue to pass.

- [ ] **Step 4: Implement the minimal publication action renderer**

Add `renderPublishAction()` to `frontend/combine-feedback.js` and export it from `root.COMBINE_FEEDBACK`:

```javascript
function renderPublishAction(doc, target, payload) {
  var actions = appendTextNode(
    doc, target, "div", "first-toast-actions", ""
  );
  var button = appendTextNode(
    doc, actions, "button", "first-toast-publish", "公开到公式广场"
  );
  button.type = "button";
  target.classList.add("has-actions");

  button.addEventListener("click", async function () {
    button.disabled = true;
    var outcome;
    try {
      outcome = await payload.publish();
    } catch (_error) {
      outcome = { ok: false };
    }

    if (!actions.isConnected) return;
    if (outcome && outcome.ok) {
      clearChildren(actions);
      appendTextNode(
        doc, actions, "span", "first-toast-published",
        "✅ 已公开，社区现在可以投票"
      );
      var link = appendTextNode(
        doc, actions, "a", "first-toast-community-link", "查看广场"
      );
      link.href = "/community.html";
      return;
    }

    button.disabled = false;
    button.textContent =
      outcome && outcome.detail
        ? String(outcome.detail)
        : "公开失败，请重试";
  });

  return actions;
}
```

Before `renderToast()` clears the target, remove stale action state:

```javascript
target.classList.remove("has-actions");
clearChildren(target);
```

Export the function:

```javascript
renderPublishAction: renderPublishAction,
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: all combine feedback tests pass, including hostile error text, asynchronous success/failure, and stale-request isolation.

- [ ] **Step 6: Commit the renderer and its tests**

```bash
git add frontend/combine-feedback.js tests/test_combine_feedback.py
git commit -m "test: cover unified formula publish action"
```

### Task 2: Integrate the Action, Timer, and Responsive Styling

**Files:**
- Modify: `frontend/app.js:575-629`
- Modify: `frontend/effects.js:101-119`
- Modify: `frontend/style.css:668-712`
- Modify: `frontend/style.css:1911-1940`
- Modify: `tests/test_combine_feedback.py`
- Modify: `tests-makers/frontend.test.mjs`

**Interfaces:**
- Consumes: `COMBINE_FEEDBACK.renderPublishAction(doc, target, {publish})` from Task 1 and the existing `POST /api/community/formulas/:formulaId/publish` API.
- Produces: `showPublishAction(formulaId)` in `frontend/app.js`, which adds an action to `#first-toast` and returns no value.

- [ ] **Step 1: Update failing integration assertions**

Change `test_first_toast_uses_exact_design_duration` to expect:

```python
assert actual == {"delays": [8000], "showing": True}
```

Add a source-contract test in `tests-makers/frontend.test.mjs`:

```javascript
test("combine feedback owns the only formula publication bubble", async () => {
  const [app, effects, styles] = await Promise.all([
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/effects.js", "utf8"),
    readFile("frontend/style.css", "utf8"),
  ]);

  assert.match(app, /renderPublishAction\(document,\s*toast,/);
  assert.match(app, /showPublishAction\(resp\.formula_id\)/);
  assert.doesNotMatch(app, /className\s*=\s*["']formula-publish["']/);
  assert.match(effects, /setTimeout\(\s*\(\)\s*=>\s*el\.classList\.remove\("show"\),\s*8000\s*\)/);
  assert.doesNotMatch(styles, /\.formula-publish\b/);
  assert.match(styles, /\.first-toast-actions\b/);
  assert.match(styles, /min-height:\s*44px/);
});
```

- [ ] **Step 2: Run the focused integration tests and verify they fail**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py::test_first_toast_uses_exact_design_duration -q
npm test -- --test-name-pattern="combine feedback owns"
```

Expected: the Python assertion reports `[4200]` instead of `[8000]`; the Node test reports the old `.formula-publish` implementation and missing unified action styles.

- [ ] **Step 3: Connect the existing publication request to the unified Toast**

Change the combine call site:

```javascript
if (resp.formula_id) showPublishAction(resp.formula_id);
```

Replace `showPublishAction()` with:

```javascript
function showPublishAction(formulaId) {
  const toast = document.getElementById("first-toast");
  if (!toast) return;

  window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
    publish: async () => {
      const response = await fetch(
        `/api/community/formulas/${encodeURIComponent(formulaId)}/publish`,
        { method: "POST" }
      );
      if (response.ok) return { ok: true };
      const body = await response.json().catch(() => ({}));
      return {
        ok: false,
        detail: body.detail || "公开失败，请重试",
      };
    },
  });
}
```

Do not create, append, time, or remove a standalone publication container.

- [ ] **Step 4: Unify the Toast lifecycle at eight seconds**

In `EFFECTS.firstToast`, keep the existing `clearTimeout()` behavior and change the timeout to:

```javascript
EFFECTS.firstToast._t = setTimeout(
  () => el.classList.remove("show"),
  8000
);
```

Do not add another timer in `showPublishAction()`. This guarantees one lifecycle per successful combination.

- [ ] **Step 5: Replace standalone publication styles with an in-Toast action area**

Delete the entire `.formula-publish` and its mobile rule. Add:

```css
.first-toast-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(23, 107, 87, 0.18);
}

.first-toast.show.has-actions {
  pointer-events: auto;
}

.first-toast-actions button,
.first-toast-actions a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  padding: 8px 12px;
  color: #FFF;
  background: #176B57;
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}

.first-toast-actions button:disabled {
  cursor: wait;
  opacity: .7;
}

.first-toast-published {
  flex: 1;
  color: #245B4F;
}

@media (max-width: 560px) {
  .first-toast-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
```

Keep the existing mobile `.first-toast` rule with `left: 12px` and `right: 12px`.

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
npm test -- --test-name-pattern="combine feedback owns"
```

Expected: both commands pass. The DOM tests prove safe publication states and the source contract proves there is no second publication bubble.

- [ ] **Step 7: Run the repository-required verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
python3 -m pytest tests/test_combine_feedback.py -q
npm run build
```

Expected: all Node and Python tests pass, and the Makers static build completes successfully.

Inspect the final diff:

```bash
git diff --check
git status --short
git diff -- frontend/app.js frontend/effects.js frontend/combine-feedback.js frontend/style.css tests/test_combine_feedback.py tests-makers/frontend.test.mjs
```

Expected: no whitespace errors; only the planned implementation files are modified. `CLAUDE.md` remains untracked and unstaged.

- [ ] **Step 8: Commit the integrated unified feedback**

```bash
git add frontend/app.js frontend/effects.js frontend/style.css tests/test_combine_feedback.py tests-makers/frontend.test.mjs
git commit -m "feat: unify combine and formula feedback"
```
