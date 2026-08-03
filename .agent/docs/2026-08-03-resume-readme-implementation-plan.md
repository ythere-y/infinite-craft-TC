# Resume-Focused README Implementation Plan

> Document date: 2026-08-03

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repository README into a concise product case study for HR reviewers and AI application development interviewers.

**Architecture:** Keep one Chinese README as the repository homepage. Lead with the product and real screenshots, explain the AI and product loops next, then retain only the quickest setup path while linking detailed operations to existing documentation.

**Tech Stack:** GitHub Flavored Markdown, repository-relative PNG assets, Mermaid-free text architecture diagram

## Global Constraints

- Use only verified repository behavior and checked-in assets.
- Do not invent an online demo URL, usage metrics, CI status, or license.
- Preserve the security rule that credentials belong only in `.env`.
- Do not modify application code or screenshot files.
- Keep advanced Makers operations in `docs/makers-development.md`.

---

### Task 1: Rewrite the repository homepage

**Files:**
- Modify: `README.md`
- Reference: `docs/imgs/游戏主页.png`
- Reference: `docs/imgs/游戏入场选名字.png`
- Reference: `docs/imgs/合成中.png`
- Reference: `docs/imgs/全球首发.png`
- Reference: `docs/imgs/首发墙.png`

**Interfaces:**
- Consumes: existing FastAPI, Makers, DeepSeek, KV, Redis, SQLite, scoring, discovery, community, and icon-system behavior
- Produces: a self-contained GitHub project homepage with working local links and image paths

- [ ] **Step 1: Replace the operations-first opening with the product hero**

Add the title, AI product positioning, compact navigation, product summary, and the full-width game screenshot. Avoid badges that imply unavailable automation or licensing.

- [ ] **Step 2: Present the product loop and visual interaction sequence**

Explain the loop `获得身份 → 组合元素 → AI 生成 → 首发反馈 → 社区排行`, then place the three detail screenshots in one HTML table with meaningful alternative text.

- [ ] **Step 3: Explain AI behavior and engineering decisions**

Document preset/cache-first resolution, structured model output, validation, fallback, persistent reuse, and the separate local and production runtimes. Add a readable text architecture diagram.

- [ ] **Step 4: Add product capabilities and engineering highlights**

Summarize discovery status, scoring, levels, wall, voting/comments, bounties, admin analytics, local icon assets, rate limiting, and test/build coverage without unverified performance claims.

- [ ] **Step 5: Keep a minimal reproducible quick start**

Retain Node.js 20+, Docker Compose, clone/copy/start commands, local URLs, no-key behavior, stop command, required verification commands, and links to the detailed development and backend guides.

### Task 2: Validate the documentation

**Files:**
- Test: `README.md`
- Test: all paths referenced by `README.md`

**Interfaces:**
- Consumes: the rewritten README
- Produces: evidence that the Markdown has no whitespace errors, missing local links, or accidental placeholders

- [ ] **Step 1: Check the patch for whitespace errors**

Run:

```bash
git diff --check -- README.md
```

Expected: no output and exit code `0`.

- [ ] **Step 2: Validate local Markdown targets and images**

Extract local link targets from `README.md`, ignore `http`, `https`, and page anchors, URL-decode paths, and verify each target exists beneath the repository root.

Expected: every local target exists, including all five PNG screenshots.

- [ ] **Step 3: Check for placeholders and unsupported claims**

Search for `TBD`, `TODO`, demo placeholders, license badges, CI badges, and unsupported user/performance metrics.

Expected: no placeholder or unsupported-claim matches.

- [ ] **Step 4: Run documentation-proportionate repository verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit successfully. Python application tests are not required to prove a Markdown-only change, but any failure in the selected checks must be reported rather than hidden.
