# Runtime Data and Validation Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give local Docker and Makers the same committed nickname corpus and the same application-level request limits, then run the repository-wide parity verification.

**Architecture:** A committed JSON nickname snapshot is generated manually from ignored THUOCL sources and consumed by Python; the normal Makers build converts the snapshot to a V8-safe module. A second small shared JSON file owns request limits, with Python loading it and Makers importing generated constants.

**Tech Stack:** Python 3.11, Node.js 20+, JSON, Docker Compose, FastAPI, EdgeOne Makers V8, pytest, Node test runner.

## Global Constraints

- Normal builds must not require the ignored `words/` checkout.
- The committed nickname snapshot contains exactly 7,831 chengyu and 4,350 state words from the current filtered corpus.
- Both runtimes retain meme weight `0.4` and the same committed meme pool.
- Combination inputs are at most 80 Unicode code points.
- Discoverer is at most 80 Unicode code points.
- Session ID is at most 128 Unicode code points.
- Recipe verification accepts at most 500 records, with `a`, `b`, and `result` at most 80 Unicode code points.
- Makers retains its one-megabyte transport limit and production-only security controls.
- No credentials, runtime data, or ignored third-party source files are committed.

---

## File responsibility map

- `shared/nickname-data.json`: committed filtered nickname snapshot.
- `scripts/nickname-data-lib.mjs`: snapshot validation and Makers-module generation.
- `scripts/refresh-nickname-corpus.mjs`: manual THUOCL-to-snapshot refresh.
- `scripts/generate-makers-nickname-data.mjs`: normal snapshot-to-JavaScript generation.
- `backend/nickname.py`: Python nickname selection from the shared snapshot.
- `shared/runtime-contract.json`: canonical application request limits.
- `backend/runtime_contract.py`: Python request-limit loader.
- `edge-functions/_generated/runtime-contract-data.js`: generated V8 constants.
- `scripts/generate-makers-runtime-contract.mjs`: validates and generates limits.
- `backend/main.py`: local request checks.
- `edge-functions/_lib/router.js`: imports generated limits instead of local constants.

### Task 1: Shared nickname snapshot

**Files:**
- Create: `shared/nickname-data.json`
- Create: `scripts/nickname-data-lib.mjs`
- Create: `scripts/refresh-nickname-corpus.mjs`
- Modify: `scripts/generate-makers-nickname-data.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `backend/nickname.py`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `package.json`
- Create: `tests/test_nickname_parity.py`
- Modify: `tests-makers/domain.test.mjs`
- Modify: `tests-makers/build.test.mjs`

**Interfaces:**
- Snapshot shape: object with `schema_version: 1`, `chengyu: Array<string>`,
  and `states: Array<string>`
- Node: `validateNicknameData(value) -> normalized object`
- Node: `generateMakersNicknameData({ root, outputPath? }) -> Promise<object>`
- Python: `load_word_pools() -> tuple[list[str], list[str]]`

- [ ] **Step 1: Write failing nickname parity tests**

Python:

```python
from backend import nickname


def test_shared_nickname_snapshot_is_used():
    nickname._CHENGYU = []
    nickname._THUOCL_STATES = []
    nickname._ensure_loaded()
    assert len(nickname._CHENGYU) == 7831
    assert len(nickname._THUOCL_STATES) == 4350
    assert nickname.stats()["meme_weight"] == 0.4
```

JavaScript:

```js
test("Makers nickname corpus matches the shared snapshot", async () => {
  const source = JSON.parse(await readFile("shared/nickname-data.json", "utf8"));
  assert.equal(source.schema_version, 1);
  assert.equal(source.chengyu.length, 7831);
  assert.equal(source.states.length, 4350);
  assert.deepEqual(nicknameStats(), {
    source: "bundled",
    chengyu: 7831,
    thuocl_states: 4350,
    meme_pool: MEME_POOL.length,
    meme_weight: 0.4,
    effective_combo_space: 7831 * (MEME_POOL.length + 4350),
  });
});
```

- [ ] **Step 2: Run nickname tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_nickname_parity.py -q
node --test tests-makers/domain.test.mjs
```

Expected: shared snapshot is missing and Python reports fallback pool sizes.

- [ ] **Step 3: Implement snapshot refresh and generation**

Move THUOCL filtering constants and `loadTopWords` into
`scripts/nickname-data-lib.mjs`.

`refreshNicknameCorpus` reads the four current THUOCL files, enforces
minimum corpus sizes, and writes:

```json
{"schema_version":1,"chengyu":[],"states":[]}
```

with the populated arrays and a trailing newline.

`generateMakersNicknameData` reads only the committed snapshot, validates
exactly schema version 1 and non-empty string arrays, and emits the existing
`NICKNAME_CHENGYU` and `NICKNAME_STATES` exports. Run the refresh once using
the present ignored THUOCL checkout, then regenerate the JS module.

- [ ] **Step 4: Make Python load the snapshot**

Set:

```python
_SHARED_DATA = Path(__file__).parent.parent / "shared" / "nickname-data.json"
```

Load UTF-8 JSON, accept only non-empty string lists, and fall back to the
existing eight/four minimal lists on missing, invalid, or empty data. Keep
the meme pool and random selection unchanged.

- [ ] **Step 5: Wire normal builds and containers**

The normal Makers build awaits `generateMakersNicknameData()` from the
committed snapshot. Rename the manual package command to:

```json
"refresh:nickname-corpus": "node scripts/refresh-nickname-corpus.mjs"
```

Keep:

```json
"generate:makers-nickname-data": "node scripts/generate-makers-nickname-data.mjs"
```

Docker copies `shared/`; Compose mounts `./shared:/app/shared:ro`. Add the
shared snapshot and nickname generator files to clean build fixtures.

- [ ] **Step 6: Run nickname tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_nickname_parity.py -q
node --test tests-makers/domain.test.mjs tests-makers/build.test.mjs
npm run build
```

Expected: both runtimes report 7,831/4,350 and clean builds do not read
`words/`.

- [ ] **Step 7: Commit Task 1**

```bash
git add shared/nickname-data.json scripts/nickname-data-lib.mjs scripts/refresh-nickname-corpus.mjs scripts/generate-makers-nickname-data.mjs scripts/build-makers.mjs backend/nickname.py Dockerfile docker-compose.yml package.json tests/test_nickname_parity.py tests-makers/domain.test.mjs tests-makers/build.test.mjs edge-functions/_generated/nickname-data.js
git commit -m "feat: share nickname corpus across runtimes"
```

### Task 2: Shared application request limits

**Files:**
- Create: `shared/runtime-contract.json`
- Create: `backend/runtime_contract.py`
- Create: `scripts/generate-makers-runtime-contract.mjs`
- Create: `edge-functions/_generated/runtime-contract-data.js`
- Modify: `scripts/build-makers.mjs`
- Modify: `edge-functions/_lib/router.js`
- Modify: `backend/main.py`
- Create: `tests/test_runtime_contract.py`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Python exports: `MAX_COMBINE_ELEMENT_LENGTH`, `MAX_DISCOVERER_LENGTH`, `MAX_SESSION_ID_LENGTH`, `MAX_VERIFY_RECIPES`, `MAX_RECIPE_FIELD_LENGTH`
- JavaScript generated module exports the same constant names.
- FastAPI rejects contract violations with `HTTPException(status_code=400)`.

- [ ] **Step 1: Write failing shared-limit tests**

Python:

```python
import asyncio
import pytest
from fastapi import HTTPException

from backend import main
from backend.runtime_contract import (
    MAX_COMBINE_ELEMENT_LENGTH,
    MAX_RECIPE_FIELD_LENGTH,
    MAX_VERIFY_RECIPES,
)


def test_combine_rejects_overlong_element():
    with pytest.raises(HTTPException, match="a/b 过长") as error:
        asyncio.run(main.api_combine(main.CombineReq(
            a="甲" * (MAX_COMBINE_ELEMENT_LENGTH + 1),
            b="乙",
        )))
    assert error.value.status_code == 400


def test_recipe_verify_rejects_oversized_batch():
    with pytest.raises(HTTPException, match="每次最多校验"):
        asyncio.run(main.api_recipes_verify(
            main.VerifyReq(recipes=[{}] * (MAX_VERIFY_RECIPES + 1))
        ))


def test_recipe_verify_marks_overlong_fields_invalid():
    result = asyncio.run(main.api_recipes_verify(main.VerifyReq(recipes=[{
        "a": "甲" * (MAX_RECIPE_FIELD_LENGTH + 1),
        "b": "乙",
        "result": "结果",
    }])))
    assert result["invalid"][0]["reason"] == "字段过长"
```

Node:

```js
assert.equal(MAX_COMBINE_ELEMENT_LENGTH, 80);
assert.equal(MAX_DISCOVERER_LENGTH, 80);
assert.equal(MAX_SESSION_ID_LENGTH, 128);
assert.equal(MAX_VERIFY_RECIPES, 500);
assert.equal(MAX_RECIPE_FIELD_LENGTH, 80);
```

- [ ] **Step 2: Run limit tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_runtime_contract.py -q
node --test tests-makers/router.test.mjs
```

Expected: Python runtime-contract import is missing and overlong local input
is not rejected.

- [ ] **Step 3: Create and generate the shared contract**

Canonical JSON:

```json
{
  "schema_version": 1,
  "max_combine_element_length": 80,
  "max_discoverer_length": 80,
  "max_session_id_length": 128,
  "max_verify_recipes": 500,
  "max_recipe_field_length": 80
}
```

The Node generator requires schema version 1 and positive integers, then
emits uppercase named exports. `backend/runtime_contract.py` reads the same
file once and exposes matching names.

- [ ] **Step 4: Replace Makers local constants**

Delete `MAX_VERIFY_RECIPES` and `MAX_RECIPE_FIELD_LENGTH` declarations from
`router.js`; import all five generated constants. Replace numeric `80` and
`128` combine checks with named imports.

- [ ] **Step 5: Add FastAPI checks**

At the start of `api_combine`, after trimming:

```python
if len(a) > MAX_COMBINE_ELEMENT_LENGTH or len(b) > MAX_COMBINE_ELEMENT_LENGTH:
    raise HTTPException(400, "a/b 过长")
if len((req.discoverer or "").strip()) > MAX_DISCOVERER_LENGTH:
    raise HTTPException(400, "discoverer 过长")
if len((req.session_id or "").strip()) > MAX_SESSION_ID_LENGTH:
    raise HTTPException(400, "session_id 过长")
```

At the start of recipe verification, reject batches over 500. Treat
non-dictionary items as missing fields. Mark string fields over 80 as
`{"reason":"字段过长"}` before any datastore lookup.

- [ ] **Step 6: Wire generation into build**

Generate the committed Makers contract module during `npm run build` before
Edge Function compilation. Add shared contract and generator to clean build
fixture inputs.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_runtime_contract.py -q
node --test tests-makers/router.test.mjs tests-makers/build.test.mjs
npm run build
```

Expected: both runtimes use the five shared values and all tests pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add shared/runtime-contract.json backend/runtime_contract.py scripts/generate-makers-runtime-contract.mjs edge-functions/_generated/runtime-contract-data.js scripts/build-makers.mjs edge-functions/_lib/router.js backend/main.py tests/test_runtime_contract.py tests-makers/router.test.mjs tests-makers/build.test.mjs
git commit -m "feat: share API validation limits"
```

### Task 3: Repository-wide verification and handoff

**Files:**
- Modify: `docs/makers-development.md`
- Modify: `README.md`

**Interfaces:**
- Documents canonical shared sources and retained runtime differences.
- Produces final verification evidence without touching production KV.

- [ ] **Step 1: Update durable developer documentation**

Document:

- prompt edits belong in `shared/combine-prompt.json`;
- nickname refresh requires the ignored THUOCL checkout, while normal builds
  use `shared/nickname-data.json`;
- request limits belong in `shared/runtime-contract.json`;
- generated Edge modules must not be hand edited;
- KV atomicity, SSE, provider, rate-limit, and approximate-stat differences
  remain intentional.

- [ ] **Step 2: Run required verification**

Run exactly:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
git diff --check
```

Expected: Node reports all tests passing, pytest reports all selected tests
passing, build completes, and whitespace check prints nothing.

- [ ] **Step 3: Run Makers compilation when the CLI is available**

Run:

```bash
npm run makers:build
```

Expected: EdgeOne Makers build succeeds. If the CLI or project association
is unavailable, record that exact limitation without connecting local code
to production KV.

- [ ] **Step 4: Review working-tree scope**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Confirm only runtime-parity files and the pre-existing in-scope Prompt
changes are present. Do not stage unrelated user files.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/makers-development.md README.md
git commit -m "docs: explain shared runtime contracts"
```
