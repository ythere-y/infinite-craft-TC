# Issue #1 LLM Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate, persist, reuse, and safely display one LLM comment for every successful combination while distinguishing global-first, player-first, and repeated discoveries.

**Architecture:** Add a single backend comment policy used by LLM parsing, persistence, and API fallback. Extend Redis and SQLite without breaking old data. Move browser discovery-state classification and text-only Toast rendering into a focused ES5-compatible module that production code and Python-driven JavaScript tests both execute.

**Tech Stack:** Python 3.11+, FastAPI, Redis/Valkey, SQLite, vanilla JavaScript, pytest 8, js2py

## Global Constraints

- Make only one LLM request per cache miss.
- Accept comments from 1 through 30 Unicode characters after whitespace normalization.
- Use `这波组合很有想法，建议先小范围灰度。` for every missing or invalid comment.
- Never reject an otherwise valid element because its comment is invalid.
- Preserve compatibility with Redis Hashes and SQLite rows created before `comment`.
- Render all LLM-controlled values with `textContent`, never `innerHTML`.
- Preserve existing first-discovery records, rewards, SSE events, and wall behavior.
- Keep the Toast single-instance, non-interactive, responsive, and replacement-based.

---

### Task 1: Comment policy and LLM response contract

**Files:**
- Create: `backend/comments.py`
- Modify: `backend/prompt.py`
- Create: `tests/test_comments.py`

**Interfaces:**
- Produces: `DEFAULT_COMMENT: str` and `normalize_comment(value: object) -> str`.
- Produces: `prompt.parse_response(text) -> Optional[dict[str, str]]` with `name`, `emoji`, and `comment`.
- Consumes: Existing `llm.query()` transport unchanged.

- [ ] **Step 1: Write failing policy and parser tests**

```python
import json
import pytest

from backend.comments import DEFAULT_COMMENT, normalize_comment
from backend import prompt


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  开会以后，需求有了自己的需求。  ", "开会以后，需求有了自己的需求。"),
        ("一句   有空格的点评", "一句 有空格的点评"),
        (None, DEFAULT_COMMENT),
        ("", DEFAULT_COMMENT),
        ("第一行\n第二行", DEFAULT_COMMENT),
        ("x" * 31, DEFAULT_COMMENT),
        (
            "<img src=x onerror=alert(1)>",
            "<img src=x onerror=alert(1)>",
        ),
    ],
)
def test_normalize_comment(value, expected):
    assert normalize_comment(value) == expected


def test_parse_response_keeps_valid_comment():
    payload = {"name": "需求膨胀", "emoji": "🎈", "comment": "开会之后，它有了自己的排期。"}
    assert prompt.parse_response(json.dumps(payload, ensure_ascii=False)) == payload


@pytest.mark.parametrize("comment", [None, "", "a\nb", "x" * 31])
def test_invalid_comment_does_not_discard_element(comment):
    payload = {"name": "需求膨胀", "emoji": "🎈"}
    if comment is not None:
        payload["comment"] = comment
    parsed = prompt.parse_response(json.dumps(payload, ensure_ascii=False))
    assert parsed == {
        "name": "需求膨胀",
        "emoji": "🎈",
        "comment": DEFAULT_COMMENT,
    }


def test_prompt_requires_comment_in_same_json_response():
    text = prompt.build_prompt("需求", "会议")
    assert '"comment"' in text
    assert "30" in text
    assert text.rstrip().endswith("输出：")
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_comments.py -q
```

Expected: collection fails because `backend.comments` does not exist.

- [ ] **Step 3: Implement the centralized policy**

```python
# backend/comments.py
from __future__ import annotations

import re
from typing import Any

DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。"
MAX_COMMENT_CHARS = 30
_CONTROL_OR_NEWLINE_RE = re.compile(r"[\x00-\x1f\x7f]")
_SPACE_RE = re.compile(r"[^\S\r\n]+")


def normalize_comment(value: Any) -> str:
    if not isinstance(value, str):
        return DEFAULT_COMMENT
    if _CONTROL_OR_NEWLINE_RE.search(value):
        return DEFAULT_COMMENT
    normalized = _SPACE_RE.sub(" ", value.strip())
    if not normalized or len(normalized) > MAX_COMMENT_CHARS:
        return DEFAULT_COMMENT
    return normalized
```

Update `SYSTEM_PROMPT`, every few-shot output, `_sanitize()`, and docstrings so the same JSON object includes `comment`. Keep `_JSON_RE` compatible with old JSON by requiring only `name` and `emoji`. In `_sanitize()` return:

```python
return {
    "name": name,
    "emoji": emoji,
    "comment": normalize_comment(obj.get("comment")),
}
```

- [ ] **Step 4: Run policy/parser tests and the existing suite**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_comments.py tests/test_llm.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add backend/comments.py backend/prompt.py tests/test_comments.py
git commit -m "feat: generate and validate synthesis comments"
```

### Task 2: Redis and SQLite comment persistence

**Files:**
- Modify: `backend/archive.py`
- Modify: `backend/db.py`
- Extend: `tests/test_comments.py`

**Interfaces:**
- Changes: `archive.upsert_combination(..., comment: str = "", increment_hit: bool = False)`.
- Changes: `db.put_cache(..., comment: str = "")` and `db.put_cache_force(..., comment: str = "")`.
- Produces: `archive.all_combinations()` rows containing `comment`.

- [ ] **Step 1: Add failing migration and cache tests**

Use a temporary archive directory by monkeypatching `archive._DATA_DIR`, initialize a legacy schema without `comment`, call `archive.init_archive()` twice, and assert:

```python
columns = {
    row["name"]
    for row in archive._conn().execute("PRAGMA table_info(combinations)")
}
assert "comment" in columns
```

Write a combination with `"一次生成，长期复用。"` and assert `archive.all_combinations()[0]["comment"]` matches. Add a small fake Redis implementing `exists`, `hset`, and `hgetall`; assert `db.put_cache()` stores `comment`, while `db.get_cached()` still returns an old Hash without the field.

- [ ] **Step 2: Run persistence tests and verify failure**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_comments.py -q
```

Expected: failures show missing SQLite column and unsupported `comment` arguments.

- [ ] **Step 3: Implement idempotent SQLite migration**

After the base schema creation in `init_archive()`:

```python
columns = {
    row["name"]
    for row in con.execute("PRAGMA table_info(combinations)").fetchall()
}
if "comment" not in columns:
    con.execute(
        "ALTER TABLE combinations "
        "ADD COLUMN comment TEXT NOT NULL DEFAULT ''"
    )
```

Include `comment` in INSERT values and `SELECT key, result, emoji, source, chain, comment`. Keep hit-only conflict updates from overwriting the original comment.

- [ ] **Step 4: Extend Redis writes and warm-up**

Add `"comment"` to new Hash payloads and SQLite dual writes. During `warm_up_from_archive()`, write `row.get("comment") or ""`. Existing Hashes remain untouched so old-cache compatibility is exercised at the API boundary.

- [ ] **Step 5: Run persistence tests**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_comments.py -q
```

Expected: all comment policy, migration, Redis, and archive tests pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add backend/archive.py backend/db.py tests/test_comments.py
git commit -m "feat: persist synthesis comments"
```

### Task 3: API propagation, cache reuse, and degradation

**Files:**
- Modify: `backend/main.py`
- Extend: `tests/test_comments.py`

**Interfaces:**
- Changes: `CombineResp.comment: str`.
- Consumes: `normalize_comment(hit.get("comment"))`.
- Produces: `_combine_via_llm()` result containing the same persisted comment.

- [ ] **Step 1: Add failing API tests**

Build a minimal fake request path by monkeypatching metrics, cache, first-discovery, KPI, depth, and element archive collaborators. Cover:

```python
def test_cached_comment_is_returned_without_llm(...):
    # db.get_cached returns a complete cached result with comment.
    # _combine_via_llm raises if called.
    response = asyncio.run(main.api_combine(main.CombineReq(a="甲", b="乙")))
    assert response.comment == "第一次生成的点评。"


def test_old_cache_without_comment_uses_default(...):
    # Same cached result, no comment key.
    response = asyncio.run(main.api_combine(main.CombineReq(a="甲", b="乙")))
    assert response.comment == DEFAULT_COMMENT


def test_llm_comment_is_persisted_once(...):
    # Stub prompt.combine_via_llm with a three-field result.
    # Assert db.put_cache receives that comment and returned hit includes it.
```

- [ ] **Step 2: Run API tests and verify failure**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_comments.py -q
```

Expected: response schema has no `comment` and LLM cache write omits it.

- [ ] **Step 3: Implement API boundary normalization**

Add `comment: str` to `CombineResp`. After extracting `hit`:

```python
comment = normalize_comment(hit.get("comment"))
```

Pass it to `CombineResp`. In `_combine_via_llm()`, pass `result["comment"]` into `db.put_cache()` and include it in the returned hit. Keep fallback non-rendering behavior unchanged.

- [ ] **Step 4: Run API and full Python tests**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest -q
```

Expected: all Python tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/main.py tests/test_comments.py
git commit -m "feat: return cached comments from combine API"
```

### Task 4: Browser discovery state and safe Toast rendering

**Files:**
- Create: `frontend/combine-feedback.js`
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/effects.js`
- Modify: `frontend/style.css`
- Modify: `requirements-dev.txt`
- Create: `tests/test_combine_feedback.py`

**Interfaces:**
- Produces: `window.COMBINE_FEEDBACK.classify(isGlobalFirst, knownBefore)`.
- Produces: `window.COMBINE_FEEDBACK.renderToast(document, target, payload)`.
- Consumes: `resp.comment`, `resp.is_first`, and pre-update `isNewToPlayer`.

- [ ] **Step 1: Add js2py and failing browser-logic tests**

Append `js2py>=0.74,<1` to `requirements-dev.txt`, install it in the development venv, then add tests that execute `frontend/combine-feedback.js`:

```python
from pathlib import Path
import js2py

SOURCE = Path("frontend/combine-feedback.js")


def load_api():
    context = js2py.EvalJs({})
    context.execute("var window = {};")
    context.execute(SOURCE.read_text(encoding="utf-8"))
    return context.window.COMBINE_FEEDBACK


def test_three_discovery_states():
    api = load_api()
    assert api.classify(True, False) == "global_new"
    assert api.classify(False, False) == "global_known"
    assert api.classify(False, True) == "seen"


def test_global_first_has_priority_over_known_state():
    api = load_api()
    assert api.classify(True, True) == "global_new"


def test_renderer_does_not_use_inner_html():
    source = SOURCE.read_text(encoding="utf-8")
    assert ".innerHTML" not in source
    assert "textContent" in source
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_combine_feedback.py -q
```

Expected: failure because the frontend module does not exist.

- [ ] **Step 3: Implement the focused feedback module**

Create an ES5-compatible IIFE exposing:

```javascript
(function (root) {
  "use strict";
  var DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。";

  function classify(isGlobalFirst, knownBefore) {
    if (isGlobalFirst) return "global_new";
    return knownBefore ? "seen" : "global_known";
  }

  function appendTextNode(doc, parent, className, text) {
    var node = doc.createElement("div");
    node.className = className;
    node.textContent = text;
    parent.appendChild(node);
  }

  function renderToast(doc, target, payload) {
    while (target.firstChild) target.removeChild(target.firstChild);
    var labels = {
      global_new: "🌍 全球首发",
      global_known: "✨ 我的新发现",
      seen: "↻ 再次合成"
    };
    appendTextNode(doc, target, "first-toast-title", labels[payload.tier]);
    appendTextNode(doc, target, "first-toast-result",
      String(payload.emoji || "❓") + " " + String(payload.name || ""));
    appendTextNode(doc, target, "first-toast-comment",
      "“" + String(payload.comment || DEFAULT_COMMENT) + "”");
  }

  root.COMBINE_FEEDBACK = {
    DEFAULT_COMMENT: DEFAULT_COMMENT,
    classify: classify,
    renderToast: renderToast
  };
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Wire production code**

Load `/combine-feedback.js` before `/effects.js`. In `app.js`, compute:

```javascript
const knownBefore = state.discovered.has(resp.result);
const isNewToPlayer = !knownBefore;
const tier = window.COMBINE_FEEDBACK.classify(resp.is_first, knownBefore);
```

Pass `comment: resp.comment` in effect metadata. In `effects.js`, always call `firstToast()` for `seen`, and have `firstToast()` delegate all LLM-controlled text to `renderToast()`. Keep depth/score in the payload title or append them as trusted numeric suffixes.

- [ ] **Step 5: Add responsive styles**

Add `.first-toast-title`, `.first-toast-result`, and `.first-toast-comment` styles. Give the Toast:

```css
max-width: min(420px, calc(100vw - 24px));
overflow-wrap: anywhere;
white-space: normal;
```

At `max-width: 780px`, set `left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom));`.

- [ ] **Step 6: Run frontend and full tests**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest tests/test_combine_feedback.py -q
..\..\.venv\Scripts\python.exe -m pytest -q
```

Expected: three-state and safe-rendering tests pass, followed by the full suite.

- [ ] **Step 7: Commit Task 4**

```powershell
git add frontend/combine-feedback.js frontend/index.html frontend/app.js frontend/effects.js frontend/style.css requirements-dev.txt tests/test_combine_feedback.py
git commit -m "feat: show safe three-state synthesis feedback"
```

### Task 5: Acceptance audit and deployment handoff

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-23-issue-1-llm-comments-design.md` only if implementation decisions changed.

**Interfaces:**
- Produces: operator-facing behavior and verification instructions.

- [ ] **Step 1: Document the API field and migration**

Add a concise README section showing `comment` in `/api/combine`, the default degradation behavior, the three visible states, and the fact that SQLite migrates automatically.

- [ ] **Step 2: Run all automated verification**

Run:

```powershell
..\..\.venv\Scripts\python.exe -m pytest -q
..\..\.venv\Scripts\python.exe -m compileall -q backend
git diff --check
```

Expected: zero test failures, no compile errors, no whitespace errors.

- [ ] **Step 3: Audit Issue acceptance criteria**

For every checkbox in Issue #1, record the implementing file and proving test. Confirm there are no unchecked criteria before integration.

- [ ] **Step 4: Inspect security-sensitive diff**

Confirm:

- no `sk-...` value exists in the diff;
- `.env` remains untracked;
- LLM-controlled name, Emoji, and comment are not inserted with `innerHTML`;
- no second model call was introduced.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md docs/superpowers/specs/2026-07-23-issue-1-llm-comments-design.md
git commit -m "docs: document synthesis feedback behavior"
```

- [ ] **Step 6: Integrate and deploy after user-approved branch completion**

Merge the feature branch into `main`, run the full suite on merged `main`, push to `origin/main`, and monitor Render until `Deploy live`.

- [ ] **Step 7: Perform online acceptance**

Verify:

1. a new LLM cache miss returns and shows a comment;
2. repeating the same combination returns the same comment without `llm_started`;
3. a second browser shows “我的新发现” for the globally known result;
4. the original browser shows “再次合成”;
5. a narrow mobile viewport wraps the comment without covering drag targets;
6. `/api/health` reports Redis `ok` and LLM `configured`.

- [ ] **Step 8: Close the upstream Issue with evidence**

Post a concise implementation summary, test count, deployment URL, cache-hit evidence, and screenshots for all three states, then close Issue #1 only after every online check passes.
