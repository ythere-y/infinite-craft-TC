# Makers-First Team Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EdgeOne Makers the default production and local-development path, with production KV on `test`, local KV on `test_dev`, reproducible team onboarding, and Render archived as an inactive fallback.

**Architecture:** A pure runtime selector chooses the injected KV binding from `APP_ENV` and fails closed for unsafe local requests. A Node-based launcher prepares the ignored local `.env` without exposing secrets, then starts the official Makers dev server. Git tracks all stable configuration and documentation while credentials, project linkage, and runtime data remain local.

**Tech Stack:** EdgeOne Makers Edge Functions, Makers KV, Makers Models, EdgeOne CLI 1.6.7+, Node.js 20+, Node built-in test runner, static HTML/CSS/JavaScript.

## Global Constraints

- Production binding is `test → infinite_craft`.
- Development binding is `test_dev → infinite_craft_dev`.
- `APP_ENV=dev` must select only `test_dev`; all other values select only `test`.
- `APP_ENV=dev` is local-only and must not be added to the shared Makers console environment variables because those values apply to every deployment environment.
- Missing development configuration must never fall back to production KV.
- Do not commit `.env`, `.edgeone/`, API keys, API tokens, preview credentials, KV exports, SQLite files, or Redis persistence.
- Do not add `edgeone makers dev` as the `dev` script because the Makers CLI reads that script and would recurse.
- Keep the existing FastAPI, Redis, SQLite, Docker, and Python tests as a legacy local/offline fallback.
- Move the Render Blueprint out of the repository root; do not delete the recoverable legacy configuration.
- Do not touch or stage the user's untracked `CLAUDE.md`.

---

### Task 1: Fail-Closed KV Runtime Selection

**Files:**
- Create: `edge-functions/_lib/runtime-config.js`
- Modify: `edge-functions/api/[[default]].js`
- Create: `tests-makers/runtime-config.test.mjs`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Consumes: `request.url`, `env.APP_ENV`, injected production KV object, and injected development KV object.
- Produces: `resolveRuntimeKv({ request, env, productionKv, developmentKv }) → { ok: true, kv, appEnv } | { ok: false, message }`.

- [ ] **Step 1: Write failing runtime-selection tests**

Create `tests-makers/runtime-config.test.mjs` with cases equivalent to:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeKv } from "../edge-functions/_lib/runtime-config.js";

const productionKv = { name: "production" };
const developmentKv = { name: "development" };

test("APP_ENV=dev selects only the development KV binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://127.0.0.1:8088/api/health"),
    env: { APP_ENV: "dev" },
    productionKv,
    developmentKv,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kv, developmentKv);
  assert.equal(result.appEnv, "dev");
});

test("production defaults to the production KV binding", () => {
  const result = resolveRuntimeKv({
    request: new Request("https://infinity.example/api/health"),
    env: {},
    productionKv,
    developmentKv,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kv, productionKv);
  assert.equal(result.appEnv, "makers");
});

test("missing development KV fails without falling back", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://localhost:8088/api/health"),
    env: { APP_ENV: "dev" },
    productionKv,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /test_dev/);
});

test("an unmarked local request is rejected before production KV access", () => {
  const result = resolveRuntimeKv({
    request: new Request("http://localhost:8088/api/health"),
    env: {},
    productionKv,
    developmentKv,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /APP_ENV=dev/);
});
```

Extend the entry-point assertion in `tests-makers/router.test.mjs` to require both guarded globals, `test` and `test_dev`, and the runtime selector.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node tests-makers/runtime-config.test.mjs
```

Expected: failure because `edge-functions/_lib/runtime-config.js` does not exist.

- [ ] **Step 3: Implement the minimal selector**

Implement `runtime-config.js` with:

```js
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizedAppEnv(env) {
  return String(env?.APP_ENV || "").trim().toLowerCase();
}

function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export function resolveRuntimeKv({
  request,
  env = {},
  productionKv,
  developmentKv,
} = {}) {
  const configuredEnv = normalizedAppEnv(env);
  const development = configuredEnv === "dev";
  if (isLocalRequest(request) && !development) {
    return {
      ok: false,
      message:
        "本地 Makers 开发必须使用 APP_ENV=dev；请运行 npm run makers:dev",
    };
  }
  const kv = development ? developmentKv : productionKv;
  if (!kv) {
    return {
      ok: false,
      message: development
        ? "开发 KV 未绑定：请确认 test_dev → infinite_craft_dev"
        : "生产 KV 未绑定：请确认 test → infinite_craft",
    };
  }
  return {
    ok: true,
    kv,
    appEnv: development ? "dev" : configuredEnv || "makers",
  };
}
```

Update the entry point to pass guarded global bindings:

```js
const runtime = resolveRuntimeKv({
  request,
  env,
  productionKv: typeof test === "undefined" ? undefined : test,
  developmentKv:
    typeof test_dev === "undefined" ? undefined : test_dev,
});
if (!runtime.ok) return errorResponse(500, runtime.message);
return createRouter({
  kv: runtime.kv,
  env: { ...env, APP_ENV: runtime.appEnv },
}).handle(request);
```

- [ ] **Step 4: Run focused and full Makers tests**

Run:

```bash
node tests-makers/runtime-config.test.mjs
npm test
```

Expected: all runtime-selection tests and the full Makers suite pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add edge-functions/_lib/runtime-config.js \
  'edge-functions/api/[[default]].js' \
  tests-makers/runtime-config.test.mjs \
  tests-makers/router.test.mjs
git commit -m "feat: isolate Makers development KV"
```

---

### Task 2: Reproducible Makers Local Launcher

**Files:**
- Create: `scripts/dev-makers.mjs`
- Create: `tests-makers/dev-makers.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: repository root, ignored `.env`, ignored `.edgeone/project.json`, and the installed `edgeone` executable.
- Produces: `setEnvValue(source, key, value) → string`, `prepareMakersDev({ root }) → Promise<{ envFile }>` and the `npm run makers:dev` team entry point.

- [ ] **Step 1: Write failing launcher tests**

Create `tests-makers/dev-makers.test.mjs` using temporary directories. Cover:

```js
test("setEnvValue preserves secrets and forces APP_ENV=dev", () => {
  const source =
    "MAKERS_MODELS_KEY=keep-this-secret\\nAPP_ENV=prod\\nADMIN_TOKEN=keep-admin\\n";
  const updated = setEnvValue(source, "APP_ENV", "dev");
  assert.match(updated, /^APP_ENV=dev$/mu);
  assert.match(updated, /^MAKERS_MODELS_KEY=keep-this-secret$/mu);
  assert.match(updated, /^ADMIN_TOKEN=keep-admin$/mu);
  assert.equal(setEnvValue(updated, "APP_ENV", "dev"), updated);
});

test("prepareMakersDev refuses an unlinked clone", async () => {
  await assert.rejects(
    prepareMakersDev({ root: temporaryRoot }),
    /edgeone makers link/,
  );
});

test("prepareMakersDev updates only APP_ENV in a linked clone", async () => {
  // Create .edgeone/project.json and .env in a temporary root.
  // Assert APP_ENV=dev and all other .env lines remain unchanged.
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node tests-makers/dev-makers.test.mjs
```

Expected: failure because `scripts/dev-makers.mjs` does not exist.

- [ ] **Step 3: Implement the launcher**

Implement `scripts/dev-makers.mjs` with Node built-ins only:

- `setEnvValue` replaces every active exact-key assignment and appends a missing key.
- `prepareMakersDev` requires `.edgeone/project.json` and `.env`, changes only
  `APP_ENV`, and does not log file contents.
- The executable path calls `prepareMakersDev`, then spawns:

```js
spawn(edgeoneExecutable, ["makers", "dev", "--skip-env-sync"], {
  cwd: ROOT,
  env: { ...process.env, PAGES_SOURCE: "skills" },
  stdio: "inherit",
});
```

- Errors explain the exact recovery commands:
  `edgeone makers link` and `edgeone makers env pull -f .env`.
- Windows uses `edgeone.cmd`; other systems use `edgeone`.

Add to `package.json`:

```json
"makers:dev": "node scripts/dev-makers.mjs",
"makers:build": "edgeone makers build"
```

Do not add a `dev` script.

Update `.env.example` so `APP_ENV=dev`, `MAKERS_MODELS_KEY`, the Makers gateway,
model, rate limit, and dashboard settings appear in a Makers-first section.
Move Redis, SQLite/FastAPI provider, host, and port settings under an explicitly
legacy section. Keep every secret value empty.

Clarify in `.gitignore` that `.env` and `.edgeone/` contain per-member Makers
linkage and credentials.

- [ ] **Step 4: Run launcher and full tests**

Run:

```bash
node tests-makers/dev-makers.test.mjs
npm test
```

Expected: launcher tests and the full Makers suite pass; test output contains no
secret fixture values.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/dev-makers.mjs tests-makers/dev-makers.test.mjs \
  package.json .env.example .gitignore
git commit -m "feat: add safe Makers local launcher"
```

---

### Task 3: Makers-First Documentation and Render Archival

**Files:**
- Create: `docs/makers-development.md`
- Modify: `README.md`
- Move: `render.yaml` to `deploy/legacy/render.yaml`
- Create: `tests-makers/configuration.test.mjs`

**Interfaces:**
- Consumes: the runtime selection and launcher from Tasks 1–2.
- Produces: one copy-paste onboarding path and a repository layout where Makers is the visible default deployment target.

- [ ] **Step 1: Write failing configuration-documentation tests**

Create `tests-makers/configuration.test.mjs` that:

- loads `package.json` and asserts `makers:dev` exists while `dev` is absent;
- asserts `render.yaml` does not exist at repository root;
- asserts `deploy/legacy/render.yaml` exists and contains a legacy/pause warning;
- asserts `README.md` and `docs/makers-development.md` contain `test_dev`,
  `infinite_craft_dev`, `edgeone makers link`, and `npm run makers:dev`;
- asserts README labels Render as paused and does not present Render as a quick-start method.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node tests-makers/configuration.test.mjs
```

Expected: failure because the Makers development guide is absent and
`render.yaml` remains at repository root.

- [ ] **Step 3: Rewrite the primary documentation**

Make Makers the first quick-start path in `README.md`:

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
npm install
npm install -g edgeone
edgeone login --site china
edgeone makers link
npm run makers:dev
```

Document these exact facts:

- Members need access to the existing Makers project.
- The interactive link command avoids committing a project ID.
- Local `APP_ENV=dev` uses `test_dev → infinite_craft_dev`.
- Production defaults to `test → infinite_craft`.
- `.env` and `.edgeone/` remain ignored.
- Makers local development uses remote development KV, not SQLite or Redis.
- `npm test`, `npm run build`, and `npm run makers:build` are verification commands.
- Pushing `main` triggers Makers Git deployment.

Move Docker, `./run.sh`, Redis, and SQLite into a concise “legacy local backend”
section. Replace the long Render deployment tutorial with a paused-status note
and a pointer to `deploy/legacy/render.yaml`.

Create `docs/makers-development.md` with prerequisites, first setup, daily
workflow, database isolation, environment sync, local URLs, validation,
troubleshooting, and the rule that developers must not run a generic static
server.

Move `render.yaml` to `deploy/legacy/render.yaml` and add a header saying it is
inactive, is not the default deployment configuration, and must be reviewed
before any future reuse.

- [ ] **Step 4: Run documentation/configuration tests**

Run:

```bash
node tests-makers/configuration.test.mjs
npm test
git diff --check
```

Expected: all tests pass and no whitespace errors appear.

- [ ] **Step 5: Commit Task 3**

```bash
git add README.md docs/makers-development.md \
  deploy/legacy/render.yaml render.yaml \
  tests-makers/configuration.test.mjs
git commit -m "docs: make Makers the default workflow"
```

---

### Task 4: Build, Link, and Exercise Real Makers Resources Locally

**Files:**
- Runtime-only ignored files: `.edgeone/project.json`, `.env`
- No tracked source changes unless verification finds a specific defect.

**Interfaces:**
- Consumes: project membership, the existing Makers project, `test_dev`,
  `infinite_craft_dev`, and synchronized Makers Models environment variables.
- Produces: a running local Makers dev server and evidence that local Edge
  Functions can read/write development KV and invoke Makers Models.

- [ ] **Step 1: Run clean verification**

Run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
PAGES_SOURCE=skills edgeone makers build
```

Expected: all Makers tests, non-browser Python tests, static build, and Edge
Function compilation pass.

- [ ] **Step 2: Check login and link the existing project**

Run:

```bash
edgeone whoami
edgeone makers link
```

Use the interactive project picker to select the existing Git-integrated
Infinity project. Do not create a new project. Confirm that ignored
`.edgeone/project.json` and `.env` now exist without printing either file.

- [ ] **Step 3: Start the official local Makers server**

Run in a persistent terminal:

```bash
npm run makers:dev
```

Expected: EdgeOne CLI starts the local HTTP server. Use
`http://127.0.0.1:8088/` or the port printed by the CLI; never use `file://`.

- [ ] **Step 4: Verify health and read APIs**

Run with proxy bypass where required:

```bash
curl --noproxy '*' http://127.0.0.1:8088/api/health
curl --noproxy '*' http://127.0.0.1:8088/api/elements
curl --noproxy '*' 'http://127.0.0.1:8088/api/wall/page?offset=0&limit=1'
```

Expected:

- health status 200 with `app_env: "dev"`, `kv: "ok"`, and
  `llm: "configured"`;
- elements and wall status 200;
- no production binding fallback error.

- [ ] **Step 5: Exercise development KV and Makers Models**

POST one unique diagnostic combination with a unique development session:

```json
{
  "a": "开发隔离甲",
  "b": "开发隔离乙",
  "discoverer": "本地开发验证鹅",
  "session_id": "makers_local_smoke"
}
```

Expected: status 200, a valid result and emoji, and a response source showing a
seed/cache/model path. Repeating the same request must return the cached result.
The local health endpoint must remain `app_env: "dev"`. This diagnostic data is
allowed only in `infinite_craft_dev`.

- [ ] **Step 6: Review repository state**

Run:

```bash
git status --short --branch
git diff --check
git log --oneline -6
```

Expected: only the user's untracked `CLAUDE.md` remains outside committed
changes; `.env` and `.edgeone/` do not appear.

---

### Task 5: Push Main and Verify Makers Production Safety

**Files:**
- No new files unless a verification defect is found and fixed with its own test.

**Interfaces:**
- Consumes: all committed Tasks 1–4.
- Produces: `origin/main` at the verified commit, an automatic Makers deployment,
  and a still-running local development server for the user.

- [ ] **Step 1: Synchronize with origin**

Run:

```bash
git fetch origin main
git rev-list --left-right --count main...origin/main
```

Expected: no remote-only commits. If remote changed, merge without overwriting
user work and rerun Task 4 Step 1.

- [ ] **Step 2: Push main**

Run:

```bash
git push origin main
```

Expected: all local commits appear on `origin/main` and Makers Git deployment
starts automatically.

- [ ] **Step 3: Verify production does not enter development mode**

After the new Makers deployment becomes available, check production health and
the initial read APIs. Expected:

- production health status 200;
- `app_env` is not `dev`;
- `kv: "ok"` and `llm: "configured"`;
- `/api/elements`, wall pagination, leaderboard, and bounty return 200.

- [ ] **Step 4: Final handoff**

Report:

- commit range and pushed head;
- test/build counts;
- local URL and whether the local server is still running;
- local health, KV write, Makers Models, and cache evidence;
- the remaining manual Render-console action: pause the old service or disable
  its auto-deploy;
- confirmation that `CLAUDE.md` was untouched and no secret/project-local files
  entered Git.
