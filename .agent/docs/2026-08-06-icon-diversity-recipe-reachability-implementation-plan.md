# Icon Diversity and Recipe Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 187 visually homogenized catalog elements individually curated primary icons and make all 780 preset elements reachable from starters.

**Architecture:** Keep catalog and base seed JSON as the only authored truth, then regenerate compiled FastAPI, frontend, and Makers projections. Extend existing audit and reachability tests at their public script/data boundaries.

**Tech Stack:** Node.js test runner and generators, Python/pytest content validation, JSON catalog data, FastAPI, Docker Compose.

## Global Constraints

- Develop directly in `/data/workspace/06.infinity_craft`; do not create a worktree.
- Never point local code at Makers KV or use EdgeOne authentication.
- Do not commit `.env`, credentials, or runtime data.
- Do not touch or stage unrelated working-tree files.
- Full acceptance requires `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build`.

---

### Task 1: Enforce complete preset reachability

**Files:**
- Modify: `tests/test_content_catalog.py`
- Modify: `backend/seed_combinations.json`
- Regenerate: `backend/generated/bounty-content.json`

**Interfaces:**
- Consumes: `content_catalog.load_compiled_content()` fields `elements`, `starters`, and `depths`.
- Produces: strict depths containing every merged preset element.

- [ ] **Step 1: Write the failing reachability test**

```python
def test_every_preset_element_is_strictly_reachable():
    content = content_catalog.load_compiled_content()
    assert set(content["elements"]) == set(content["depths"])
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
python3 -m pytest tests/test_content_catalog.py::test_every_preset_element_is_strictly_reachable -q
```

Expected: failure listing the 25 legacy elements missing from `depths`.

- [ ] **Step 3: Add the 25 reviewed recipes**

Add the exact producer pairs from the design table to
`backend/seed_combinations.json`, each with the result's existing Emoji,
`chain: "base"`, and a concise semantic comment. Do not reuse a normalized pair
already present in the merged map.

- [ ] **Step 4: Regenerate the compiled catalog**

Run:

```bash
npm run generate:bounty-content
```

Expected: exit 0 and an updated `backend/generated/bounty-content.json`.

- [ ] **Step 5: Verify green and trace all elements**

Run:

```bash
python3 -m pytest tests/test_content_catalog.py::test_every_preset_element_is_strictly_reachable -q
python3 scripts/trace_recipe.py --no-llm --unreachable
python3 scripts/trace_recipe.py --no-llm --bounty-report
```

Expected: test passes, unreachable count is zero, and all 254 bounty targets
remain reachable.

### Task 2: Curate high-reuse catalog primary icons

**Files:**
- Modify: `content/tencent-bounty-catalog.json`
- Regenerate: `backend/generated/bounty-content.json`
- Regenerate: `frontend/assets/icons/generated/emoji/*`
- Regenerate: `frontend/assets/icons/generated/emoji-icon-manifest.json`
- Regenerate: `frontend/assets/icons/generated/icon-build-metadata.json`
- Regenerate: `frontend/assets/icons/generated/element-icon-map.json`
- Regenerate: `edge-functions/_generated/icon-data.js`

**Interfaces:**
- Consumes: catalog recipe `result` and `emoji` fields.
- Produces: individually selected primary Emoji for the 187 names in the
  `🧩`, `💬`, `🎮`, `🤝`, and `🕹️` catalog-only groups.

- [ ] **Step 1: Curate every affected recipe**

For each affected result, replace the category/placeholder Emoji with a
name-specific Emoji selected by the design rules. Update every recipe that
produces the same result to the same Emoji. Preserve names, parents, chain,
comments, aliases, factual metadata, and target membership.

- [ ] **Step 2: Regenerate catalog and icon projections**

Run:

```bash
npm run generate:bounty-content
npm run generate:makers-data
npm run generate:icons
npm run generate:icon-data
```

Expected: every command exits 0 and generated files remain deterministic.

### Task 3: Gate catalog icon concentration

**Files:**
- Modify: `scripts/audit-icon-map.mjs`
- Modify: `tests-makers/icon-data.test.mjs`
- Modify: `docs/icon-system-audit.md`

**Interfaces:**
- Consumes: optional `catalogElementNames: Set<string>` in `auditIconMap`.
- Produces: `catalogBaseReuseGroups`, `catalogPlaceholderNames`, metrics, and
  gate violations for catalog-only icon concentration.

- [ ] **Step 1: Write failing audit tests**

Create a fixture with five catalog names sharing one base plus one catalog
name using `🧩`. Assert that `auditIconMap` reports both violations. Then give
the shared rows explicit `duplicate_exception` strings and assert only the
placeholder violation remains.

- [ ] **Step 2: Run the focused Node test and verify red**

Run:

```bash
node --test --test-name-pattern="catalog primary icon" tests-makers/icon-data.test.mjs
```

Expected: failure because the catalog-only audit fields and gates do not exist.

- [ ] **Step 3: Implement the minimal catalog audit**

Add `catalogElementNames = new Set()` to `auditIconMap`, filter base groups to
that set, reject `🧩`, and reject groups of five or more unless every row has a
non-empty exception. Pass the catalog-only set from `runIconAudit`, and include
the metrics in console and Markdown reports.

- [ ] **Step 4: Verify green and regenerate the audit report**

Run:

```bash
node --test --test-name-pattern="catalog primary icon" tests-makers/icon-data.test.mjs
npm run audit:icons -- --write-report docs/icon-system-audit.md
npm run verify:icons
```

Expected: focused test and both icon commands pass; no catalog placeholder or
overconcentration violation remains.

### Task 4: Full verification and local handoff

**Files:**
- Runtime only: `.env` copied from `.env.example` if absent
- Runtime only: Docker volumes and containers created by `npm run dev`

**Interfaces:**
- Consumes: local `LLM_API_KEY` already supplied by the user when needed.
- Produces: healthy LAN-accessible service on port 8000.

- [ ] **Step 1: Run required verification**

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 2: Start the local stack**

If `.env` is absent, copy `.env.example` to `.env` without overwriting an
existing file. Run:

```bash
npm run dev
```

Keep the service running for user testing.

- [ ] **Step 3: Verify health and resolve the LAN address**

```bash
curl http://127.0.0.1:8000/api/health
hostname -I
```

Expected: healthy JSON and at least one non-loopback IPv4 address. Hand off
`http://<ipv4>:8000`.

