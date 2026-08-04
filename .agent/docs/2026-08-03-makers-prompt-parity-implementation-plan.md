# Makers Prompt Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production Makers model request use the current FastAPI synthesis philosophy, examples, and weighted per-request style hint.

**Architecture:** Keep the existing Makers request and parsing boundary intact. Port the current FastAPI prompt contract into `edge-functions/_lib/llm.js`, add a small weighted style selector with an injectable random source, and test the actual outbound OpenAI-compatible request body so the production behavior—not private constants—is protected.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, EdgeOne Makers Edge Functions.

## Global Constraints

- Local development must not use EdgeOne account authentication, Makers KV, or an Edge Function dev server.
- Do not modify or stage unrelated working-tree files.
- Do not deploy; production deployment remains the post-merge Makers workflow.
- Preserve `temperature=0.85`, structured JSON output, community examples, recent-result avoidance, and bounty candidates.
- Keep the change focused on production Prompt parity; a cross-runtime single-source Prompt compiler is a separate follow-up.

---

### Task 1: Protect the Makers Prompt Contract

**Files:**
- Modify: `tests-makers/game-service.test.mjs`

**Interfaces:**
- Consumes: `requestModelCombination({ a, b, avoidWords, bountyCandidates, communityExamples, env, fetchImpl, random })`
- Produces: regression coverage over the outbound `messages` payload and weighted style selection

- [x] **Step 1: Write the failing outbound-request test**

Extend the existing model-request test with community and bounty inputs, set
`random: () => 0`, and assert that the request contains:

```js
assert.match(body.messages[0].content, /【多样性硬要求】/);
assert.match(body.messages[0].content, /【✨ 惰性合成/);
assert.match(body.messages[0].content, /【🎯 悬赏榜倾向/);
assert.match(body.messages[1].content, /腾讯会议/);
assert.match(body.messages[1].content, /社区高质量示例/);
assert.match(body.messages[1].content, /本次偏好】偏自造词/);
assert.match(body.messages[1].content, /悬赏候选/);
```

- [x] **Step 2: Add a failing weighted-boundary test**

Capture two outbound request bodies using `random: () => 0.30` and
`random: () => 0.99`, then assert the first selects `偏具体场景` and the second
selects `偏古今对照`. This catches missing or incorrectly ordered weights.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="model request|weighted style" tests-makers/game-service.test.mjs
```

Expected: FAIL because the Makers system Prompt lacks the full rule sections and
`requestModelCombination` does not yet accept or use `random`.

### Task 2: Port the Current Synthesis Prompt to Makers

**Files:**
- Modify: `edge-functions/_lib/llm.js`
- Test: `tests-makers/game-service.test.mjs`

**Interfaces:**
- Consumes: optional `random: () => number`, defaulting to `Math.random`
- Produces: one weighted style label appended to every uncached Makers model request

- [x] **Step 1: Replace the abbreviated system Prompt**

Port the current FastAPI hard constraints, theme directions, diversity
requirements, synthesis philosophy, inert/absorbing combinations, bounty
preference, and content-safety rules into the Makers `SYSTEM_PROMPT`.

- [x] **Step 2: Synchronize the fixed examples**

Replace the seven abbreviated Makers examples with the current FastAPI example
set, including comments and the self-combination, abstract, physical fallback,
and absorbing-combination cases.

- [x] **Step 3: Add deterministic weighted style selection**

Add the current ordered weights:

```js
[
  ["偏自造词", 0.30],
  ["偏具体场景", 0.25],
  ["偏跨界混搭", 0.15],
  ["偏中英混搭", 0.10],
  ["偏动作描述", 0.10],
  ["偏成语化", 0.05],
  ["偏古今对照", 0.05],
]
```

Select one label from the injected random value and append
`【本次偏好】<label>` to the user message before the current input.

- [x] **Step 4: Keep dynamic modules and remove system duplication**

Keep community examples capped at 8, avoid words capped at 30, and bounty
candidates capped at 12. Put the complete contract in the system message and
leave only examples and dynamic request modules in the user message so the full
system Prompt is not sent twice.

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
node --test --test-name-pattern="model request|weighted style" tests-makers/game-service.test.mjs
```

Expected: all selected tests PASS.

### Task 3: Verify the Repository

**Files:**
- Verify only

**Interfaces:**
- Consumes: the completed Prompt parity change
- Produces: fresh test and build evidence

- [x] **Step 1: Run Makers tests**

```bash
npm test
```

- [x] **Step 2: Run the required Python tests**

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

- [x] **Step 3: Run the production build**

```bash
npm run build
```

- [x] **Step 4: Inspect scope**

```bash
git status --short
git diff --check
git diff -- edge-functions/_lib/llm.js tests-makers/game-service.test.mjs
```

Confirm that no unrelated developer files were modified or staged.
