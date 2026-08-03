# Shared Combination Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-maintained Python and Makers combination prompts with one validated modular JSON specification that renders identical model messages in both runtimes.

**Architecture:** `shared/combine-prompt.json` is the only hand-edited prompt source. Python loads it directly; the Makers build validates it and emits `edge-functions/_generated/prompt-data.js`. Small Python and JavaScript renderers follow one formatting contract, and a cross-runtime test compares their exact output.

**Tech Stack:** Python 3.11, Node.js 20+, JSON, Node test runner, pytest, OpenAI-compatible chat completions, EdgeOne Makers V8 Edge Functions.

## Global Constraints

- Local development continues to use FastAPI, Redis, SQLite, and the locally configured model API.
- Makers continues to use Web APIs only; runtime code must not use Node built-ins, npm packages, or filesystem access.
- `shared/combine-prompt.json` is the only hand-edited source for prompt modules, examples, style weights, limits, and temperature.
- Given the same dynamic inputs and style value, Python and JavaScript messages must be byte-for-byte identical.
- Preserve the existing 15 examples, seven style choices, `temperature=0.85`, and current Chinese prompt content.
- Preserve existing user changes in `edge-functions/_lib/llm.js` and `tests-makers/game-service.test.mjs` by migrating their behavior rather than discarding it.
- AI process documents stay in `.agent/docs/`.

---

## File responsibility map

- `shared/combine-prompt.json`: canonical, declarative prompt specification.
- `scripts/prompt-data-lib.mjs`: schema validation and generated-module serialization usable from tests.
- `scripts/generate-makers-prompt-data.mjs`: CLI/build wrapper that writes the Makers data module.
- `edge-functions/_generated/prompt-data.js`: generated prompt data for the V8 runtime.
- `backend/prompt_spec.py`: cached JSON loading, validation, style selection, and Python message rendering.
- `edge-functions/_lib/prompt.js`: JavaScript style selection and message rendering.
- `backend/prompt.py`: bounty selection, parser, and model orchestration; no prompt constants.
- `backend/llm.py`: provider transport accepting an optional system message.
- `edge-functions/_lib/llm.js`: provider transport consuming rendered messages.
- `tests-makers/prompt-data.test.mjs`: schema, generator, and JavaScript renderer tests.
- `tests/test_prompt_parity.py`: Python renderer and exact cross-runtime parity tests.
- `tests/test_llm.py`: Python transport compatibility and system-message tests.

### Task 1: Canonical prompt schema and Makers generator

**Files:**
- Create: `shared/combine-prompt.json`
- Create: `scripts/prompt-data-lib.mjs`
- Create: `scripts/generate-makers-prompt-data.mjs`
- Create: `edge-functions/_generated/prompt-data.js`
- Create: `tests-makers/prompt-data.test.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `validatePromptSpec(value) -> normalized object`
- Produces: `loadPromptSpec(path) -> Promise<normalized object>`
- Produces: `generateMakersPromptData({ root, outputPath? }) -> Promise<string>`
- Produces: generated export `PROMPT_SPEC`

- [ ] **Step 1: Write failing schema and generation tests**

Add tests that import the missing library and assert the canonical content:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateMakersPromptData,
  loadPromptSpec,
  validatePromptSpec,
} from "../scripts/prompt-data-lib.mjs";

test("canonical prompt has stable modules examples styles and limits", async () => {
  const spec = await loadPromptSpec("shared/combine-prompt.json");
  assert.equal(spec.schema_version, 1);
  assert.equal(spec.temperature, 0.85);
  assert.equal(spec.system_modules.filter((item) => item.enabled).length, 8);
  assert.equal(spec.examples.filter((item) => item.enabled).length, 15);
  assert.deepEqual(
    spec.styles.map(({ id, weight }) => [id, weight]),
    [
      ["invented-word", 0.30],
      ["concrete-scene", 0.25],
      ["cross-domain", 0.15],
      ["mixed-language", 0.10],
      ["action-description", 0.10],
      ["idiom", 0.05],
      ["past-present", 0.05],
    ],
  );
  assert.deepEqual(spec.limits, {
    avoid_words: 30,
    community_examples: 8,
    bounty_candidates: 12,
  });
});

test("prompt validation rejects duplicate ids and invalid weights", () => {
  assert.throws(
    () => validatePromptSpec({
      schema_version: 1,
      temperature: 0.85,
      system_modules: [
        { id: "same", enabled: true, order: 1, content: "甲" },
        { id: "same", enabled: true, order: 2, content: "乙" },
      ],
      examples: [],
      styles: [
        { id: "only", enabled: true, label: "唯一", guidance: "唯一", weight: 0.5 },
      ],
      limits: { avoid_words: 30, community_examples: 8, bounty_candidates: 12 },
    }),
    /duplicate system_modules id|style weights must sum to 1/,
  );
});

test("generator writes a V8-safe JavaScript data module", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-data-"));
  const outputPath = join(root, "prompt-data.js");
  await generateMakersPromptData({ root: ".", outputPath });
  const generated = await readFile(outputPath, "utf8");
  assert.match(generated, /^\\/\\/ Generated by scripts\\/generate-makers-prompt-data\\.mjs/m);
  assert.match(generated, /export const PROMPT_SPEC = /);
  assert.doesNotMatch(generated, /node:fs|process\\.env|require\\(/);
});

test("committed generated prompt data is current", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-current-"));
  const outputPath = join(root, "prompt-data.js");
  await generateMakersPromptData({ root: ".", outputPath });
  assert.equal(
    await readFile(outputPath, "utf8"),
    await readFile("edge-functions/_generated/prompt-data.js", "utf8"),
  );
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test tests-makers/prompt-data.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/prompt-data-lib.mjs`.

- [ ] **Step 3: Create the canonical JSON**

Move the current `SYSTEM_PROMPT` text verbatim into these module boundaries:

| ID | Order | Exact source content |
| --- | ---: | --- |
| `identity` | 10 | `backend/prompt.py:24-29` |
| `hard-constraints` | 20 | `backend/prompt.py:31-37` |
| `style-themes` | 30 | `backend/prompt.py:39-47` |
| `diversity` | 40 | `backend/prompt.py:49-57` |
| `philosophy` | 50 | `backend/prompt.py:59-65` |
| `inert-combination` | 60 | `backend/prompt.py:67-83` |
| `bounty` | 70 | `backend/prompt.py:85-94` |
| `safety` | 80 | `backend/prompt.py:96-98` |

Each record is exactly:

```json
{"id":"identity","enabled":true,"order":10,"content":"你是《鹅厂无限合成 ♾️》的合成裁判。"}
```

where `content` contains the complete source slice named in the table, with
embedded newlines represented by JSON escapes. Populate 15 example records
from `backend/prompt.py:108-131` in source order. Assign these IDs in order:

```text
boss-pie, coffee-night-snack, meeting-nesting, desk-folding-chair,
weekly-chatgpt, toilet-phone, fire-hair, monday-metro, friday-off-work,
ppt-overnight, tencent-meeting, knowledge-time, water-earth,
void-overtime, universe-human
```

Populate the styles from `backend/prompt.py:287-294` using these exact
values:

| ID | Label | Guidance | Weight |
| --- | --- | --- | ---: |
| `invented-word` | `偏自造词` | `优先组合常见字，创造一个一看就懂的新词。` | 0.30 |
| `concrete-scene` | `偏具体场景` | `优先落到一个能直接想象的具体画面。` | 0.25 |
| `cross-domain` | `偏跨界混搭` | `优先把两个不同领域的概念自然嫁接。` | 0.15 |
| `mixed-language` | `偏中英混搭` | `允许自然使用英文缩写或中英混搭。` | 0.10 |
| `action-description` | `偏动作描述` | `优先用动作或变化过程命名结果。` | 0.10 |
| `idiom` | `偏成语化` | `仅在确有反差时化用成语，避免常见成语堆砌。` | 0.05 |
| `past-present` | `偏古今对照` | `优先制造古语与现代职场或科技概念的对照。` | 0.05 |

Set `schema_version` to `1`, `temperature` to `0.85`, and limits to
`30`, `8`, and `12` for avoid words, community examples, and bounty
candidates.

- [ ] **Step 4: Implement validation and generation**

Implement `validatePromptSpec` with explicit checks:

```js
export function validatePromptSpec(value) {
  if (value?.schema_version !== 1) throw new Error("unsupported prompt schema version");
  if (!Number.isFinite(value.temperature)) throw new Error("temperature must be finite");
  for (const field of ["system_modules", "examples", "styles"]) {
    if (!Array.isArray(value[field])) throw new Error(`${field} must be an array`);
    const ids = value[field].map((item) => String(item?.id || "").trim());
    if (ids.some((id) => !id)) throw new Error(`${field} id must not be blank`);
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${field} id`);
  }
  const enabledModules = value.system_modules.filter((item) => item.enabled !== false);
  if (!enabledModules.length) throw new Error("at least one system module must be enabled");
  const enabledStyles = value.styles.filter((item) => item.enabled !== false);
  if (enabledStyles.some((item) => !(Number(item.weight) > 0))) {
    throw new Error("enabled style weights must be positive");
  }
  const total = enabledStyles.reduce((sum, item) => sum + Number(item.weight), 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error("style weights must sum to 1");
  for (const name of ["avoid_words", "community_examples", "bounty_candidates"]) {
    if (!Number.isInteger(value.limits?.[name]) || value.limits[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  return structuredClone(value);
}
```

`generateMakersPromptData` reads the canonical file, validates it, and writes:

```js
const body = `export const PROMPT_SPEC = Object.freeze(${JSON.stringify(spec)});`;
```

Use `JSON.stringify(spec)` for serialization; do not interpolate executable
source from any individual field.

- [ ] **Step 5: Wire generation into scripts and build**

Add:

```json
"generate:makers-prompt-data": "node scripts/generate-makers-prompt-data.mjs"
```

Import and await `generateMakersPromptData()` in `buildMakersSite()` before
the output directory is recreated. Generate the committed module once.

- [ ] **Step 6: Run tests and build to verify GREEN**

Run:

```bash
node --test tests-makers/prompt-data.test.mjs
npm run build
```

Expected: all prompt-data tests pass and build reports
`Built EdgeOne Makers site in dist/`.

- [ ] **Step 7: Commit Task 1**

```bash
git add shared/combine-prompt.json scripts/prompt-data-lib.mjs scripts/generate-makers-prompt-data.mjs edge-functions/_generated/prompt-data.js tests-makers/prompt-data.test.mjs scripts/build-makers.mjs package.json
git commit -m "feat: add canonical combination prompt data"
```

### Task 2: Python and JavaScript renderers with exact parity

**Files:**
- Create: `backend/prompt_spec.py`
- Create: `edge-functions/_lib/prompt.js`
- Create: `tests/test_prompt_parity.py`
- Modify: `backend/prompt.py`
- Modify: `tests/test_comments.py`
- Modify: `tests-makers/prompt-data.test.mjs`

**Interfaces:**
- Consumes: canonical `PROMPT_SPEC` and `shared/combine-prompt.json`
- Produces Python: `build_prompt_messages(a, b, avoid_words=None, bounty_candidates=None, community_examples=None, style_value=None) -> dict`
- Produces JavaScript: `buildPromptMessages({ a, b, avoid_words, bounty_candidates, community_examples, style_value, random }) -> object`
- Preserves Python: `build_prompt(a, b, avoid_words=None, bounty_candidates=None, community_examples=None) -> str`

- [ ] **Step 1: Write failing renderer tests**

The Python test fixes one complete dynamic fixture and compares the Node
renderer:

```python
import json
from pathlib import Path
import subprocess

from backend.prompt_spec import build_prompt_messages

ROOT = Path(__file__).resolve().parent.parent


def fixture():
    return {
        "a": "需求",
        "b": "咖啡",
        "avoid_words": ["旧结果"],
        "bounty_candidates": [{"name": "CSIG", "emoji": "☁️", "category": "bg"}],
        "community_examples": [{
            "a": "需求",
            "b": "会议",
            "name": "排期",
            "emoji": "🗓️",
            "comment": "需求一进会议室，就有了截止日期。",
        }],
        "style_value": 0.30,
    }


def test_python_and_makers_render_identical_messages():
    expected = build_prompt_messages(**fixture())
    node_source = """
import { buildPromptMessages } from "./edge-functions/_lib/prompt.js";
const input = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify(buildPromptMessages(input)));
""".strip()
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", node_source, json.dumps(fixture(), ensure_ascii=False)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(completed.stdout) == expected
    assert expected["style_id"] == "concrete-scene"
    assert "【本次偏好】偏具体场景" in expected["user"]
    assert "优先落到一个能直接想象的具体画面。" in expected["user"]
```

Add JavaScript boundary assertions:

```js
assert.equal(buildPromptMessages({ a: "甲", b: "乙", style_value: 0 }).style_id, "invented-word");
assert.equal(buildPromptMessages({ a: "甲", b: "乙", style_value: 0.30 }).style_id, "concrete-scene");
assert.equal(buildPromptMessages({ a: "甲", b: "乙", style_value: 0.99 }).style_id, "past-present");
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_prompt_parity.py -q
node --test tests-makers/prompt-data.test.mjs
```

Expected: FAIL because both renderer modules or functions are missing.

- [ ] **Step 3: Implement `backend/prompt_spec.py`**

Use `Path(__file__).parent.parent / "shared" / "combine-prompt.json"` and an
`lru_cache(maxsize=1)` loader. Implement half-open weighted selection:

```python
def select_style(spec: dict, value: float) -> dict:
    roll = max(0.0, min(0.9999999999999999, float(value)))
    cumulative = 0.0
    enabled = [item for item in spec["styles"] if item.get("enabled", True)]
    for item in enabled:
        cumulative += float(item["weight"])
        if roll < cumulative:
            return item
    return enabled[-1]
```

`build_prompt_messages` returns:

```python
{
    "system": system_text,
    "user": "\n".join(lines),
    "temperature": float(spec["temperature"]),
    "style_id": style["id"],
}
```

Use `json.dumps(value, ensure_ascii=False, separators=(",", ":"))` in both
runtimes so object whitespace cannot drift. Render sections in this exact
order: fixed examples, community examples, avoid words, bounty candidates,
style label plus guidance, final input.

- [ ] **Step 4: Implement `edge-functions/_lib/prompt.js`**

Import only:

```js
import { PROMPT_SPEC } from "../_generated/prompt-data.js";
```

Mirror the Python rendering rules and accept `style_value`; when it is
absent, call an injected `random` function exactly once. Use
`JSON.stringify` for all object examples, matching the compact Python JSON
serialization.

- [ ] **Step 5: Reduce `backend/prompt.py` to orchestration**

Delete `SYSTEM_PROMPT`, `FEW_SHOT_EXAMPLES`, and the local style list.
Import `build_prompt_messages`. Preserve the legacy `build_prompt` API:

```python
def build_prompt(a, b, avoid_words=None, bounty_candidates=None, community_examples=None):
    messages = build_prompt_messages(
        a=a,
        b=b,
        avoid_words=avoid_words or [],
        bounty_candidates=bounty_candidates or [],
        community_examples=community_examples or [],
    )
    return f'{messages["system"]}\n\n{messages["user"]}'
```

This wrapper keeps parser/comment tests and any external callers compatible;
combination generation will use the two-message result in Task 3.

- [ ] **Step 6: Run renderer tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_prompt_parity.py tests/test_comments.py -q
node --test tests-makers/prompt-data.test.mjs
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add backend/prompt_spec.py edge-functions/_lib/prompt.js tests/test_prompt_parity.py backend/prompt.py tests/test_comments.py tests-makers/prompt-data.test.mjs
git commit -m "refactor: render prompts from shared specification"
```

### Task 3: Align model message transport

**Files:**
- Modify: `backend/llm.py`
- Modify: `backend/prompt.py`
- Modify: `edge-functions/_lib/llm.js`
- Modify: `tests/test_llm.py`
- Modify: `tests-makers/game-service.test.mjs`

**Interfaces:**
- Consumes: `build_prompt_messages` and `buildPromptMessages`
- Python payload supports optional `system_prompt: str`
- Both transports send `[{"role":"system"}, {"role":"user"}]`

- [ ] **Step 1: Write failing Python transport tests**

Add:

```python
def test_optional_system_prompt_uses_two_message_shape(monkeypatch):
    configure(monkeypatch, generic_key="generic-test-key")
    factory, captured = fake_factory()
    assert llm.query(
        {"system_prompt": "系统规则", "question": "用户输入"},
        temperature=0.85,
        _client_factory=factory,
    )
    assert captured["create"]["messages"] == [
        {"role": "system", "content": "系统规则"},
        {"role": "user", "content": "用户输入"},
    ]
```

Keep the existing single-question test unchanged to prove backward
compatibility.

- [ ] **Step 2: Strengthen the existing Makers request test**

Assert the captured request contains:

```js
assert.equal(body.temperature, 0.85);
assert.equal(body.messages.length, 2);
assert.match(body.messages[0].content, /【多样性硬要求】/);
assert.match(body.messages[1].content, /【本次偏好】偏自造词/);
assert.match(body.messages[1].content, /优先组合常见字/);
```

- [ ] **Step 3: Run transport tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_llm.py::test_optional_system_prompt_uses_two_message_shape -q
node --test tests-makers/game-service.test.mjs
```

Expected: Python emits one user message, and Makers still owns prompt
constants instead of using the renderer.

- [ ] **Step 4: Implement Python message support**

Build messages without changing validation of `question`:

```python
messages = []
system_prompt = payload.get("system_prompt")
if isinstance(system_prompt, str) and system_prompt.strip():
    messages.append({"role": "system", "content": system_prompt})
messages.append({"role": "user", "content": question})
request = {"model": settings.model, "messages": messages}
```

In `combine_via_llm`, build messages once and call:

```python
raw = query(
    {
        "system_prompt": messages["system"],
        "question": messages["user"],
        "request_id": request_id,
    },
    temperature=messages["temperature"],
)
```

- [ ] **Step 5: Replace Makers prompt constants**

In `edge-functions/_lib/llm.js`, remove `SYSTEM_PROMPT`, `EXAMPLES`,
`STYLE_HINTS`, `selectStyleHint`, and `promptFor`. Import
`buildPromptMessages`, call it with the dynamic inputs and one
`style_value: random()`, then use its `system`, `user`, and `temperature`.

- [ ] **Step 6: Run transport tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_llm.py tests/test_prompt_parity.py tests/test_comments.py -q
node --test tests-makers/game-service.test.mjs tests-makers/prompt-data.test.mjs
```

Expected: all selected tests pass, including legacy Python one-message calls.

- [ ] **Step 7: Commit Task 3**

```bash
git add backend/llm.py backend/prompt.py edge-functions/_lib/llm.js tests/test_llm.py tests-makers/game-service.test.mjs
git commit -m "feat: align model prompt messages across runtimes"
```

### Task 4: Prompt pipeline integration verification

**Files:**
- Modify: `tests-makers/build.test.mjs`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docs/makers-development.md`

**Interfaces:**
- Consumes: committed `shared/combine-prompt.json`
- Guarantees: local container can read `/app/shared/combine-prompt.json`
- Guarantees: clean Makers fixture build regenerates prompt data

- [ ] **Step 1: Write failing build-input tests**

Add `shared/combine-prompt.json`, `scripts/prompt-data-lib.mjs`, and
`scripts/generate-makers-prompt-data.mjs` to `COMMITTED_BUILD_INPUTS`. Assert
the fixture build produces a generated module containing the canonical
schema version.

Add a source assertion that Docker contains:

```dockerfile
COPY shared ./shared
```

and Compose contains:

```yaml
- ./shared:/app/shared:ro
```

- [ ] **Step 2: Run build tests and verify RED**

Run:

```bash
node --test tests-makers/build.test.mjs
```

Expected: FAIL because the clean fixture and Docker inputs do not yet include
the shared prompt.

- [ ] **Step 3: Update Docker, Compose, fixture inputs, and developer docs**

Copy and mount `shared/` exactly as asserted. Document that prompt edits are
made only in `shared/combine-prompt.json`; `npm run build` regenerates the
Makers artifact and tests reject drift.

- [ ] **Step 4: Run the complete prompt and build suites**

Run:

```bash
node --test tests-makers/prompt-data.test.mjs tests-makers/game-service.test.mjs tests-makers/build.test.mjs
python3 -m pytest tests/test_prompt_parity.py tests/test_llm.py tests/test_comments.py -q
npm run build
git diff --check
```

Expected: all tests pass, build completes, and `git diff --check` prints
nothing.

- [ ] **Step 5: Commit Task 4**

```bash
git add tests-makers/build.test.mjs Dockerfile docker-compose.yml docs/makers-development.md
git commit -m "docs: enforce shared prompt build workflow"
```
