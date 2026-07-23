# Local Development and Makers Production Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run dev` start a fully local FastAPI/Redis/SQLite/DeepSeek development stack while every `main` deployment uses only the production Makers KV and Makers Models.

**Architecture:** Docker Compose is the single recommended local runtime and receives only local `APP_ENV`, Redis, SQLite, and DeepSeek settings. The Makers Edge Function remains a separate production runtime whose selector accepts only the `test` global KV binding and rejects loopback requests so accidental CLI-local execution cannot touch production. README, the development guide, and `AGENTS.md` expose the same two-path workflow.

**Tech Stack:** Docker Compose, FastAPI/Uvicorn, Redis 7, SQLite, DeepSeek OpenAI-compatible API, EdgeOne Makers Edge Functions and KV, Node.js 20+ built-in test runner, Python 3.11 and pytest.

## Global Constraints

- Local development must not require EdgeOne login, project linking, KV access, or Makers Models.
- Local development uses `APP_ENV=dev`, local Redis, `data/dev.db`, and `LLM_API_KEY` from the ignored `.env`.
- Local DeepSeek defaults are `LLM_BASE_URL=https://api.deepseek.com` and `LLM_MODEL=deepseek-v4-flash`.
- The Makers Edge Function uses only `test → infinite_craft`; `test_dev` is never selected by source code.
- A loopback request to the Makers Edge Function must fail closed and direct the caller to `npm run dev`.
- Keep `edgeone.json` build command as `npm run build`; the existing Makers Git integration owns deployment after `main` changes.
- Do not commit `.env`, model keys, EdgeOne credentials, project linkage, preview tokens, Redis/SQLite data, or KV exports.
- Keep Render paused and archived under `deploy/legacy/`.
- Do not touch or stage the user's untracked `CLAUDE.md`.

---

### Task 1: Make the Makers Runtime Production-Only

**Files:**
- Modify: `tests-makers/runtime-config.test.mjs`
- Modify: `tests-makers/router.test.mjs`
- Modify: `edge-functions/_lib/runtime-config.js`
- Modify: `edge-functions/api/[[default]].js`

**Interfaces:**
- Consumes: `request.url` and the injected global `test` KV binding.
- Produces: `resolveRuntimeKv({ request, productionKv }) → { ok: true, kv, appEnv: "makers" } | { ok: false, message }`.

- [ ] **Step 1: Replace development-selection tests with production-only tests**

Change `tests-makers/runtime-config.test.mjs` to:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeKv } from "../edge-functions/_lib/runtime-config.js";

const productionKv = { name: "production" };

test("a remote request always selects the production KV", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
    productionKv,
    env: { APP_ENV: "dev" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kv, productionKv);
  assert.equal(result.appEnv, "makers");
});

test("a loopback Makers request is rejected before KV access", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const result = resolveRuntimeKv({
      request: new Request(`http://${host}:8088/api/health`),
      productionKv,
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /npm run dev/u);
  }
});

test("missing production KV reports the test binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /\btest\b/u);
  assert.doesNotMatch(result.message, /test_dev/u);
});
```

Replace the entry-point integration test in `tests-makers/router.test.mjs` with a
test that defines only `globalThis.test`, verifies a remote health request returns
`app_env=makers`, and verifies a loopback request returns 500 with
`npm run dev`. Assert the file no longer depends on `globalThis.test_dev`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests-makers/runtime-config.test.mjs tests-makers/router.test.mjs
```

Expected: the test requiring `APP_ENV=dev` to be ignored fails because the current
selector still chooses `developmentKv`; the entry-point assertion fails because the
current entry point still reads `test_dev`.

- [ ] **Step 3: Implement the production-only selector**

Replace `edge-functions/_lib/runtime-config.js` with:

```js
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function resolveRuntimeKv({ request, productionKv } = {}) {
  if (isLocalRequest(request)) {
    return {
      ok: false,
      message:
        "Makers Edge Function 不用于本地开发；请运行 npm run dev",
    };
  }
  if (!productionKv) {
    return {
      ok: false,
      message: "生产 KV 未绑定：请确认 test → infinite_craft",
    };
  }
  return { ok: true, kv: productionKv, appEnv: "makers" };
}
```

Update `edge-functions/api/[[default]].js` so it calls:

```js
const runtime = resolveRuntimeKv({
  request,
  productionKv: typeof test === "undefined" ? undefined : test,
});
```

Remove the `developmentKv` argument and every `test_dev` reference. Continue passing
the existing environment variables to the router, but force
`APP_ENV: runtime.appEnv`.

- [ ] **Step 4: Run focused and full Makers tests**

Run:

```bash
node --test tests-makers/runtime-config.test.mjs tests-makers/router.test.mjs
npm test
```

Expected: all focused tests and the full Makers suite pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add edge-functions/_lib/runtime-config.js \
  'edge-functions/api/[[default]].js' \
  tests-makers/runtime-config.test.mjs \
  tests-makers/router.test.mjs
git commit -m "feat: make Makers runtime production only"
```

---

### Task 2: Make Docker Compose the One-Command Local Runtime

**Files:**
- Create: `tests-makers/local-development.test.mjs`
- Delete: `tests-makers/dev-makers.test.mjs`
- Delete: `scripts/dev-makers.mjs`
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Docker with Compose support and optional ignored `.env` containing `LLM_API_KEY`.
- Produces: `npm run dev` and `npm run dev:down`.

- [ ] **Step 1: Add failing tracked-configuration tests**

Create `tests-makers/local-development.test.mjs`:

```js
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("package scripts expose Docker local development", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    packageJson.scripts.dev,
    "docker compose up --build --remove-orphans",
  );
  assert.equal(packageJson.scripts["dev:down"], "docker compose down");
  assert.equal("makers:dev" in packageJson.scripts, false);
  assert.equal(await exists("scripts/dev-makers.mjs"), false);
});

test("Compose fixes the local runtime and supports source reload", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");
  assert.match(compose, /APP_ENV:\s*"dev"/u);
  assert.match(compose, /REDIS_URL:\s*"redis:\/\/redis:6379\/1"/u);
  assert.match(compose, /LLM_API_KEY:\s*"\$\{LLM_API_KEY:-\}"/u);
  assert.match(compose, /LLM_BASE_URL:.*https:\/\/api\.deepseek\.com/u);
  assert.match(compose, /LLM_MODEL:.*deepseek-v4-flash/u);
  assert.match(compose, /\.\/backend:\/app\/backend:ro/u);
  assert.match(compose, /\.\/frontend:\/app\/frontend:ro/u);
  assert.match(compose, /\.\/data:\/app\/data/u);
  assert.match(compose, /command:[\s\S]*uvicorn[\s\S]*--reload/u);
  assert.doesNotMatch(compose, /MAKERS_MODELS_KEY/u);
});

test("the environment template is local and contains no secret", async () => {
  const envExample = await readFile(".env.example", "utf8");
  assert.match(envExample, /^APP_ENV=dev$/mu);
  assert.match(envExample, /^LLM_API_KEY=$/mu);
  assert.match(envExample, /^LLM_BASE_URL=https:\/\/api\.deepseek\.com$/mu);
  assert.match(envExample, /^LLM_MODEL=deepseek-v4-flash$/mu);
  assert.doesNotMatch(envExample, /^MAKERS_MODELS_KEY=/mu);
  assert.doesNotMatch(envExample, /test_dev/u);
});
```

Delete `tests-makers/dev-makers.test.mjs` because the Makers CLI launcher is no longer
a supported local runtime.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests-makers/local-development.test.mjs
```

Expected: failures for the missing `dev` script, existing `makers:dev`, missing source
mounts and the Makers-specific `.env.example`.

- [ ] **Step 3: Implement package and Compose configuration**

Set these scripts in `package.json`:

```json
"dev": "docker compose up --build --remove-orphans",
"dev:down": "docker compose down",
"build": "node scripts/build-makers.mjs",
"makers:build": "edgeone makers build"
```

Remove `makers:dev`, and delete `scripts/dev-makers.mjs`.

In `docker-compose.yml`, configure Web with:

```yaml
environment:
  APP_ENV: "dev"
  REDIS_URL: "redis://redis:6379/1"
  LLM_API_KEY: "${LLM_API_KEY:-}"
  LLM_BASE_URL: "${LLM_BASE_URL:-https://api.deepseek.com}"
  LLM_MODEL: "${LLM_MODEL:-deepseek-v4-flash}"
  LLM_TIMEOUT: "${LLM_TIMEOUT:-20}"
  LLM_MAX_RETRIES: "${LLM_MAX_RETRIES:-0}"
  LLM_REASONING_EFFORT: "${LLM_REASONING_EFFORT:-}"
  LLM_THINKING_ENABLED: "${LLM_THINKING_ENABLED:-false}"
volumes:
  - ./backend:/app/backend:ro
  - ./frontend:/app/frontend:ro
  - ./data:/app/data
command:
  - uvicorn
  - backend.main:app
  - --host
  - "0.0.0.0"
  - --port
  - "8000"
  - --reload
```

Keep the existing Redis AOF bind mount. Remove `MAKERS_MODELS_KEY` from the Web
container and keep port `8000`.

Rewrite `.env.example` as a local FastAPI template containing the exact safe defaults:

```dotenv
APP_ENV=dev
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT=20
LLM_MAX_RETRIES=0
LLM_REASONING_EFFORT=
LLM_THINKING_ENABLED=false
HOST=0.0.0.0
PORT=8000
REDIS_URL=redis://127.0.0.1:16739/1
```

Add comments explaining that Makers Models values belong in the Makers console and
must not be copied into this file. Update `.gitignore` comments so `.edgeone/` is
described as deployment-maintainer state rather than a requirement for developers.

- [ ] **Step 4: Validate focused tests and resolved Compose**

Run:

```bash
node --test tests-makers/local-development.test.mjs
docker compose config
npm test
```

Expected: the focused and full Makers tests pass; Compose resolves both services with
`APP_ENV=dev`, local Redis DB 1, the DeepSeek base URL/model, source mounts and reload
command.

- [ ] **Step 5: Commit Task 2**

```bash
git add package.json docker-compose.yml .env.example .gitignore \
  tests-makers/local-development.test.mjs
git rm scripts/dev-makers.mjs tests-makers/dev-makers.test.mjs
git commit -m "feat: add one-command local development"
```

---

### Task 3: Make the Split Obvious to People and Agents

**Files:**
- Create: `AGENTS.md`
- Modify: `tests-makers/configuration.test.mjs`
- Modify: `README.md`
- Modify: `docs/makers-development.md`

**Interfaces:**
- Consumes: Task 1 production runtime and Task 2 local commands.
- Produces: one human guide and one concise Agent entry point using identical commands.

- [ ] **Step 1: Replace documentation assertions with split-runtime assertions**

Update `tests-makers/configuration.test.mjs` so the primary documentation test reads
`README.md`, `docs/makers-development.md`, and `AGENTS.md`, then checks every document
contains `npm run dev`, `LLM_API_KEY`, and `main`. Check README and the guide contain
`test → infinite_craft`, `Makers`, `Redis`, `SQLite`, and `自动发布`. Assert none of
the three files instructs developers to run `npm run makers:dev`,
`edgeone makers link`, or `edgeone login`. Keep the existing Render archival test.

- [ ] **Step 2: Run the configuration test and verify RED**

Run:

```bash
node --test tests-makers/configuration.test.mjs
```

Expected: failure because `AGENTS.md` is absent and the existing README/guide still
require EdgeOne login, link and `npm run makers:dev`.

- [ ] **Step 3: Write the developer and Agent documentation**

Create root `AGENTS.md` with these exact operating rules:

```markdown
# Infinity Craft Agent Guide

## Default local workflow

1. Copy `.env.example` to `.env`.
2. Put the privately supplied DeepSeek key in `LLM_API_KEY`.
3. Run `npm run dev`.
4. Verify `http://127.0.0.1:8000/api/health`.
5. Stop with `npm run dev:down`.

Local development uses FastAPI, Redis and SQLite. Do not run `edgeone login`,
`edgeone makers link` or `edgeone makers dev` for local development.

## Production workflow

Makers automatically builds and deploys after a PR is merged to `main`. Production
uses the `test → infinite_craft` KV binding and Makers Models. Never point local code
at Makers KV and never commit `.env`, credentials or runtime data.

## Required verification

Run `npm test`, the documented pytest command, `npm run build`, and
`npm run makers:build` before merging.
```

Rewrite the opening workflow, architecture, directory tree and environment sections in
`README.md` so local development comes first with:

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
cp .env.example .env
# 填写 LLM_API_KEY
npm run dev
```

Explain that local data is FastAPI + Redis + SQLite and production data is the
`test → infinite_craft` Makers KV binding. Describe PR merge to `main` as the
automatic deployment trigger. Keep Makers consistency/limits, the production console
variables, and the paused Render section.

Rewrite `docs/makers-development.md` as the detailed split-runtime guide. Include:
Docker/Compose and Node prerequisites, `.env` DeepSeek setup, local health checks,
start/stop/log commands, local data paths, PR verification, `main` auto-deployment,
production KV/Models settings, and troubleshooting. State that `test_dev` may remain
bound in the console but is unused.

- [ ] **Step 4: Run documentation and full tests**

Run:

```bash
node --test tests-makers/configuration.test.mjs
npm test
```

Expected: documentation checks and the complete Makers suite pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add AGENTS.md README.md docs/makers-development.md \
  tests-makers/configuration.test.mjs
git commit -m "docs: document local and Makers workflows"
```

---

### Task 4: Verify Local Runtime and Makers Build

**Files:**
- Modify only if a failing regression test identifies a defect.

**Interfaces:**
- Consumes: the complete repository state and the member's ignored `.env`.
- Produces: fresh evidence for local startup, all automated tests, and Makers build compatibility.

- [ ] **Step 1: Inspect local secret availability without printing values**

Run a script that reports only whether `.env` exists and whether `LLM_API_KEY` is
non-empty. Never print `.env` contents.

- [ ] **Step 2: Start the local stack**

Run:

```bash
npm run dev
```

Wait for Uvicorn startup, then request:

```bash
curl --noproxy '*' http://127.0.0.1:8000/api/health
curl --noproxy '*' http://127.0.0.1:8000/api/elements
```

Expected health: `redis=ok`, `app_env=dev`, SQLite path ends in `dev.db`; when the
existing `.env` has `LLM_API_KEY`, `llm=configured`.

- [ ] **Step 3: Exercise a local write**

POST one unique unknown combination to `/api/combine`, repeat the same request, and
verify both return a valid response while the second uses the cached local data.
Confirm the local SQLite `data/dev.db` exists. Do not print or persist any secret.

- [ ] **Step 4: Run the complete verification suite**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
PAGES_SOURCE=skills edgeone makers build
git diff --check
```

Expected: JavaScript tests, Python tests, static build, Makers Edge Function build and
whitespace check all pass.

- [ ] **Step 5: Audit and push `main`**

Confirm `git status --short` contains only the user's untracked `CLAUDE.md`, scan tracked
changes for secret-looking values, fetch `origin/main`, and verify the remote has no
new commits before running:

```bash
git push origin main
```

The push triggers the existing Makers Git deployment. Inspect the deployment through
the existing protected URL or Makers console if authentication is available. Verify
production `/api/health` reports `kv=ok`, `app_env=makers`, and `llm=configured`; if the
preview credential has expired, report that the Git push completed and request a fresh
protected URL rather than exposing or inventing a credential.
