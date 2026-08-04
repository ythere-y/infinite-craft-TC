# LLM Runtime Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Makers production and local FastAPI development from selecting each other's LLM credentials or model settings.

**Architecture:** Keep the existing provider-neutral request functions, but make each runtime's environment parser exclusive. Makers uses `MAKERS_MODELS_KEY` plus `AI_GATEWAY_*`; local FastAPI uses only `LLM_*`.

**Tech Stack:** JavaScript ES modules and Node test runner; Python, pytest, and OpenAI-compatible client.

## Global Constraints

- Makers production calls Makers Models only.
- Local FastAPI calls the privately configured DeepSeek API only.
- Do not change prompts, request payloads, KV behavior, or frontend behavior.
- Preserve the existing safe fallback when a runtime is not configured.
- Do not expose or commit credentials.

---

### Task 1: Enforce the Makers configuration boundary

**Files:**
- Modify: `tests-makers/game-service.test.mjs`
- Modify: `edge-functions/_lib/llm.js`

**Interfaces:**
- Consumes: `llmConfiguration(env = {})`
- Produces: an unchanged configuration object whose values come only from
  Makers-specific variables

- [x] **Step 1: Write the failing test**

Add a test that calls `llmConfiguration` with populated `LLM_API_KEY`,
`LLM_BASE_URL`, `LLM_MODEL`, and `LLM_TIMEOUT`, then asserts
`configured === false`, the default Makers base URL, the default Makers model,
and the default 15-second timeout.

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test --test-name-pattern="ignores local DeepSeek" tests-makers/game-service.test.mjs
```

Expected: FAIL because the current helper accepts `LLM_*`.

- [x] **Step 3: Implement the minimal Makers-only parser**

Remove `AI_GATEWAY_API_KEY` and all `LLM_*` fallbacks. Read
`MAKERS_MODELS_KEY`, `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_MODEL`, and
`AI_GATEWAY_TIMEOUT`, retaining the existing gateway, model, and timeout
defaults.

- [x] **Step 4: Run the focused Makers tests**

Run:

```bash
node --test --test-name-pattern="model request|ignores local DeepSeek|missing model configuration" tests-makers/game-service.test.mjs
```

Expected: PASS.

### Task 2: Enforce the local FastAPI configuration boundary

**Files:**
- Modify: `tests/test_llm.py`
- Modify: `backend/llm.py`

**Interfaces:**
- Consumes: `LLMSettings.from_env()`
- Produces: `LLMSettings` configured only from local `LLM_*` variables

- [x] **Step 1: Write the failing test**

Add a test that clears every `LLM_*` setting, sets only
`MAKERS_MODELS_KEY`, and asserts `LLMSettings.from_env().is_configured` is
false.

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
python3 -m pytest tests/test_llm.py -q -k ignores_makers
```

Expected: FAIL because the current helper accepts `MAKERS_MODELS_KEY`.

- [x] **Step 3: Implement the minimal local-only parser**

Remove the `MAKERS_MODELS_KEY` fallback and keep existing `LLM_*` validation.

- [x] **Step 4: Run focused Python tests**

Run:

```bash
python3 -m pytest tests/test_llm.py -q
```

Expected: PASS.

### Task 3: Verify the repository

**Files:**
- No additional production files

**Interfaces:**
- Consumes: Tasks 1 and 2
- Produces: repository-level verification evidence

- [x] **Step 1: Run required checks**

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands exit 0.

- [x] **Step 2: Inspect scope**

Run:

```bash
git diff --check
git status --short
git diff -- backend/llm.py edge-functions/_lib/llm.js tests/test_llm.py tests-makers/game-service.test.mjs
```

Expected: only the intended runtime-isolation changes and AI process documents
are present.
