# Makers DeepSeek Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the Makers production LLM module either through the existing
Makers Models gateway or directly through the project's official DeepSeek V4
Flash account, while disabling thinking and bounding output on both routes.

**Architecture:** Keep `createGameService` and all callers provider-neutral.
Extend `llmConfiguration(env)` inside the existing LLM module to select one
complete provider configuration, and let `requestModelCombination()` consume
that configuration without provider-specific branches. Expose only safe
provider metadata through health.

**Tech Stack:** EdgeOne Makers V8 Edge Functions, JavaScript ES modules,
OpenAI-compatible Chat Completions, Node.js built-in test runner.

## Global Constraints

- Develop directly in the current workspace; do not create a Git worktree.
- Edge Function runtime code must use Web APIs and `env`; it must not use
  Node.js built-ins, npm packages, or `process.env`.
- The direct route uses exactly `MAKERS_USE_OWN_DEEPSEEK` and
  `MAKERS_DEEPSEEK_API_KEY`.
- Truthy route values are `1`, `true`, `yes`, and `on`, case-insensitively.
- Direct endpoint and model are fixed to `https://api.deepseek.com` and
  `deepseek-v4-flash`.
- Both routes send `"thinking": {"type": "disabled"}` and
  `"max_tokens": 128`.
- A selected direct route without its own key fails closed and never falls
  back to `MAKERS_MODELS_KEY`.
- Local `LLM_*` variables remain ignored by the Makers runtime.
- Never commit credentials or the untracked `.env`.

---

### Task 1: Provider-neutral route configuration

**Files:**
- Modify: `tests-makers/game-service.test.mjs`
- Modify: `edge-functions/_lib/llm.js`

**Interfaces:**
- Consumes: `llmConfiguration(env = {})`.
- Produces: a configuration object with `configured`, `provider`, `apiKey`,
  `baseUrl`, `model`, and `timeoutSeconds`.

- [ ] **Step 1: Write failing configuration tests**

Add literal assertions covering the default path, all accepted truthy values,
and the missing-direct-key failure:

```js
test("Makers configuration selects the official DeepSeek route explicitly", () => {
  for (const flag of ["1", "true", "TRUE", "yes", "on"]) {
    const config = llmConfiguration({
      MAKERS_USE_OWN_DEEPSEEK: flag,
      MAKERS_DEEPSEEK_API_KEY: "direct-secret",
      MAKERS_MODELS_KEY: "makers-secret",
      AI_GATEWAY_BASE_URL: "https://wrong.example/v1",
      AI_GATEWAY_MODEL: "wrong-model",
    });
    assert.equal(config.configured, true);
    assert.equal(config.provider, "deepseek-direct");
    assert.equal(config.apiKey, "direct-secret");
    assert.equal(config.baseUrl, "https://api.deepseek.com");
    assert.equal(config.model, "deepseek-v4-flash");
  }
});

test("selected official DeepSeek route never falls back to the Makers key", () => {
  const config = llmConfiguration({
    MAKERS_USE_OWN_DEEPSEEK: "1",
    MAKERS_DEEPSEEK_API_KEY: "   ",
    MAKERS_MODELS_KEY: "makers-secret",
  });
  assert.equal(config.configured, false);
  assert.equal(config.provider, "deepseek-direct");
  assert.equal(config.apiKey, "");
});
```

Extend the existing default-route test with:

```js
assert.equal(config.provider, "edgeone-makers-models");
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test --test-name-pattern="configuration selects|never falls back|ignores local" tests-makers/game-service.test.mjs
```

Expected: FAIL because the configuration does not return `provider` and still
always selects the Makers route.

- [ ] **Step 3: Implement minimal route selection in the LLM module**

Add fixed direct-provider constants and a small truthy parser, then make
`llmConfiguration` select one complete configuration:

```js
const DIRECT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DIRECT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function enabled(value) {
  return TRUE_VALUES.has(String(value ?? "").trim().toLowerCase());
}

export function llmConfiguration(env = {}) {
  const useOwnDeepSeek = enabled(env.MAKERS_USE_OWN_DEEPSEEK);
  const apiKey = String(
    useOwnDeepSeek
      ? env.MAKERS_DEEPSEEK_API_KEY || ""
      : env.MAKERS_MODELS_KEY || "",
  ).trim();
  const baseUrl = useOwnDeepSeek
    ? DIRECT_DEEPSEEK_BASE_URL
    : env.AI_GATEWAY_BASE_URL || DEFAULT_BASE_URL;
  const model = useOwnDeepSeek
    ? DIRECT_DEEPSEEK_MODEL
    : env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
  const timeoutSeconds = Math.max(
    1,
    Math.min(60, Number(env.AI_GATEWAY_TIMEOUT) || 15),
  );
  return {
    configured: Boolean(apiKey),
    provider: useOwnDeepSeek
      ? "deepseek-direct"
      : "edgeone-makers-models",
    apiKey,
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    model,
    timeoutSeconds,
  };
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run the same focused command. Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add tests-makers/game-service.test.mjs edge-functions/_lib/llm.js
git commit -m "feat: route Makers LLM to direct DeepSeek"
```

---

### Task 2: Uniform non-thinking request contract

**Files:**
- Modify: `tests-makers/game-service.test.mjs`
- Modify: `edge-functions/_lib/llm.js`

**Interfaces:**
- Consumes: the provider configuration returned by `llmConfiguration`.
- Produces: one OpenAI-compatible request shape for either provider.

- [ ] **Step 1: Write failing outbound-request tests**

Extend the existing Makers request test with hand-derived expectations:

```js
assert.deepEqual(body.thinking, { type: "disabled" });
assert.equal(body.max_tokens, 128);
```

Add a direct-route transport test:

```js
test("model request sends the same bounded contract to official DeepSeek", async () => {
  let captured;
  await requestModelCombination({
    a: "AI",
    b: "咖啡",
    env: {
      MAKERS_USE_OWN_DEEPSEEK: "1",
      MAKERS_DEEPSEEK_API_KEY: "direct-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: "{\"name\":\"直连咖啡\",\"emoji\":\"☕\"}",
          },
        }],
      }), { status: 200 });
    },
  });
  assert.equal(captured.url, "https://api.deepseek.com/chat/completions");
  assert.equal(
    captured.init.headers.authorization,
    "Bearer direct-secret",
  );
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 128);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test --test-name-pattern="model request uses|bounded contract" tests-makers/game-service.test.mjs
```

Expected: FAIL because `thinking` and `max_tokens` are absent.

- [ ] **Step 3: Add the uniform request fields**

Inside the existing JSON request body, add:

```js
thinking: { type: "disabled" },
max_tokens: 128,
```

Do not add provider-specific conditionals to
`requestModelCombination()`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run the same focused command. Expected: both provider request tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add tests-makers/game-service.test.mjs edge-functions/_lib/llm.js
git commit -m "feat: disable thinking for Makers combinations"
```

---

### Task 3: Safe health metadata and operator documentation

**Files:**
- Modify: `tests-makers/router.test.mjs`
- Modify: `edge-functions/_lib/router.js`
- Modify: `docs/makers-development.md`

**Interfaces:**
- Consumes: `config.provider` from `llmConfiguration`.
- Produces: safe `/api/health` metadata and durable operator instructions.

- [ ] **Step 1: Write a failing health test**

Add a direct configuration route and assert safe metadata:

```js
test("health reports direct DeepSeek routing without credentials", async () => {
  const router = createRouter({
    kv: new FakeKV(),
    env: {
      MAKERS_USE_OWN_DEEPSEEK: "1",
      MAKERS_DEEPSEEK_API_KEY: "health-secret",
      MAKERS_MODELS_KEY: "makers-secret",
    },
  });
  const health = await json(router, "/api/health");
  assert.equal(health.body.llm, "configured");
  assert.deepEqual(health.body.llm_config, {
    configured: true,
    provider: "deepseek-direct",
    base_url: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  });
  assert.doesNotMatch(JSON.stringify(health.body), /health-secret|makers-secret/u);
});
```

- [ ] **Step 2: Run the health test and verify RED**

Run:

```bash
node --test --test-name-pattern="health reports direct" tests-makers/router.test.mjs
```

Expected: FAIL because health hard-codes
`edgeone-makers-models`.

- [ ] **Step 3: Use selected provider metadata in health**

Replace the hard-coded provider with:

```js
provider: config.provider,
```

- [ ] **Step 4: Run the health test and verify GREEN**

Run the same focused command. Expected: PASS and no credential appears in the
serialized response.

- [ ] **Step 5: Document Makers console variables**

Update the Makers environment example:

```dotenv
MAKERS_MODELS_KEY=控制台中的MakersModels密钥
MAKERS_USE_OWN_DEEPSEEK=1
MAKERS_DEEPSEEK_API_KEY=DeepSeek官方API密钥
AI_GATEWAY_BASE_URL=https://ai-gateway.edgeone.link/v1
AI_GATEWAY_MODEL=@makers/deepseek-v4-flash
```

Explain that `MAKERS_USE_OWN_DEEPSEEK=1` selects the fixed official endpoint
and model, both routes disable thinking, and the direct key must be configured
only in the Makers console.

- [ ] **Step 6: Commit Task 3**

```bash
git add tests-makers/router.test.mjs edge-functions/_lib/router.js docs/makers-development.md
git commit -m "docs: explain Makers DeepSeek routing"
```

---

### Task 4: Full project verification

**Files:**
- Verify only; no intended file changes.

**Interfaces:**
- Consumes: the completed routing, request, health, and documentation changes.
- Produces: fresh evidence for the repository's required checks.

- [ ] **Step 1: Run required JavaScript tests**

```bash
npm test
```

Expected: 0 failures.

- [ ] **Step 2: Run required Python tests**

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: 0 failures.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: exit status 0.

- [ ] **Step 4: Run the Makers build when the CLI is available**

```bash
npm run makers:build
```

Expected: exit status 0. If the EdgeOne CLI is unavailable, report this
maintainer-only verification as not run rather than weakening the required
local checks.

- [ ] **Step 5: Verify scope and secrets**

```bash
git diff --check
git status --short
git diff -- . ':!.agent/docs/2026-08-05-makers-deepseek-routing-design.md' \
  ':!.agent/docs/2026-08-05-makers-deepseek-routing-implementation-plan.md'
```

Expected: only the planned source, test, and documentation files differ; no
credential values appear.
