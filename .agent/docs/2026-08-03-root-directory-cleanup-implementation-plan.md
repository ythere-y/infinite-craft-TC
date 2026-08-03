# Root Directory Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce GitHub-visible root entries without changing default local development or Makers deployment, and move all AI process documents into a dated `.agent/docs/` convention.

**Architecture:** Keep platform entrypoints at the repository root, move only legacy local scripts into `scripts/local/`, delete the retired Render archive, and separate AI process documents from formal developer documentation. Encode the directory contract in `AGENTS.md`, `.agent/README.md`, and automated configuration tests.

**Tech Stack:** GitHub Flavored Markdown, Bash, Node.js test runner, Git renames, FastAPI and Makers existing verification suites

## Global Constraints

- `npm run dev`, `npm run dev:down`, Docker Compose, `npm run build`, and Makers automatic deployment remain unchanged.
- AI process documents live in `.agent/docs/` and begin with `YYYY-MM-DD-`.
- Formal developer documents remain in `docs/`.
- `.agent/` is tracked; `.agents/` remains ignored and is removed only when empty.
- Do not execute Redis reset, dump, or restore operations.
- Do not modify or stage unrelated working-tree files.

---

### Task 1: Encode the repository organization contract

**Files:**
- Modify: `tests-makers/configuration.test.mjs`
- Modify: `AGENTS.md`
- Modify: `.gitignore`
- Create: `.agent/README.md`

**Interfaces:**
- Consumes: the approved root-cleanup design and the existing configuration test suite
- Produces: executable assertions and written rules for root entrypoints and AI document placement

- [ ] **Step 1: Add failing configuration assertions**

Update the `node:fs/promises` import to include `readdir`. Replace the Render archive
test with assertions that `render.yaml`, `deploy/legacy/render.yaml`, `run.sh`, and
`reset.sh` do not exist, while both `scripts/local/run-conda.sh` and
`scripts/local/reset-redis.sh` do exist.

Add a test that reads `.agent/docs/`, requires every Markdown basename to match:

```js
/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/u
```

and asserts that `docs/plans`, `docs/improvements`, and `docs/superpowers` do not
exist.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
node --test tests-makers/configuration.test.mjs
```

Expected: failure because the scripts, Render file, and AI documents still use their
old paths.

- [ ] **Step 3: Write the AI-facing rules**

Append an `AI-generated documents` section to `AGENTS.md` stating:

```markdown
- Put AI-created designs, implementation plans, research notes, improvement
  proposals, and process documents in `.agent/docs/`.
- Name each document `YYYY-MM-DD-<topic>-<type>.md`.
- Use `-design.md`, `-implementation-plan.md`, or `-improvement.md` as the type.
- Keep user/developer documentation in `docs/`; do not put AI process documents
  there or in `docs/superpowers/`.
- Read `.agent/README.md` before creating or moving an AI process document.
```

Create `.agent/README.md` with the same normative rules, the distinction between
tracked `.agent/` and ignored `.agents/`, examples, and the formal-document
exceptions for `docs/makers-development.md`, `docs/icon-system-audit.md`, and
`docs/imgs/`.

Remove only `/docs/superpowers/` from `.gitignore`; retain `.agents/`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests-makers/configuration.test.mjs
```

Expected: it still fails only on paths that Task 2 and Task 3 have not moved yet.

### Task 2: Move all AI process documents

**Files:**
- Move: `docs/improvements/emoji-matching.md` → `.agent/docs/2026-07-21-emoji-matching-improvement.md`
- Move: `docs/improvements/wall-search-all.md` → `.agent/docs/2026-07-21-wall-search-all-improvement.md`
- Move: `docs/plans/2026-07-23-edgeone-makers-design.md` → `.agent/docs/2026-07-23-edgeone-makers-design.md`
- Move: `docs/plans/2026-07-23-edgeone-makers-implementation.md` → `.agent/docs/2026-07-23-edgeone-makers-implementation-plan.md`
- Move: `docs/repository-flattening-design.md` → `.agent/docs/2026-08-03-repository-flattening-design.md`
- Move: `docs/repository-flattening-plan.md` → `.agent/docs/2026-08-03-repository-flattening-implementation-plan.md`
- Move: `docs/root-directory-cleanup-design.md` → `.agent/docs/2026-08-03-root-directory-cleanup-design.md`
- Move: `docs/superpowers/specs/2026-08-03-resume-readme-design.md` → `.agent/docs/2026-08-03-resume-readme-design.md`
- Move: `docs/superpowers/plans/2026-08-03-resume-readme.md` → `.agent/docs/2026-08-03-resume-readme-implementation-plan.md`

**Interfaces:**
- Consumes: seven tracked AI documents and two ignored but locally present Superpowers documents
- Produces: one tracked, date-prefixed AI document collection under `.agent/docs/`

- [ ] **Step 1: Move the nine documents**

Use exact source and destination paths from the file list above. Preserve contents
and Git history for tracked files. Do not move `docs/makers-development.md`,
`docs/icon-system-audit.md`, or `docs/imgs/`.

- [ ] **Step 2: Repair links inside moved documents**

In the wall-search improvement, replace:

```markdown
docs/improvements/emoji-matching.md
```

with:

```markdown
.agent/docs/2026-07-21-emoji-matching-improvement.md
```

Update any other Markdown links that target a moved file. Historical shell commands
remain unchanged when they describe the historical operation rather than a current
entrypoint.

- [ ] **Step 3: Verify the AI document inventory**

Run:

```bash
find .agent/docs -maxdepth 1 -type f -name '*.md' -printf '%f\n' | sort
test ! -e docs/plans
test ! -e docs/improvements
test ! -e docs/superpowers
```

Expected: ten dated Markdown files are listed, including this implementation plan,
and all three old process-document directories are absent.

### Task 3: Move legacy scripts and remove retired deployment files

**Files:**
- Move: `run.sh` → `scripts/local/run-conda.sh`
- Move: `reset.sh` → `scripts/local/reset-redis.sh`
- Delete: `deploy/legacy/render.yaml`
- Modify: `scripts/local/run-conda.sh`
- Modify: `scripts/local/reset-redis.sh`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/makers-development.md`

**Interfaces:**
- Consumes: legacy Conda startup and Redis maintenance scripts
- Produces: the same script behavior from non-root paths while preserving every default deployment command

- [ ] **Step 1: Move scripts and resolve the repository root**

At the start of both moved scripts, replace:

```bash
cd "$(dirname "$0")"
```

with:

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"
```

In `reset-redis.sh`, replace the error reference to `./run.sh` with
`scripts/local/run-conda.sh`. Keep executable modes.

- [ ] **Step 2: Delete the retired Render archive**

Delete `deploy/legacy/render.yaml`. Confirm the now-empty `deploy/legacy/` and
`deploy/` directories disappear naturally.

- [ ] **Step 3: Update all current human- and AI-facing instructions**

Change `.env.example` and `docs/makers-development.md` references from `run.sh` to
`scripts/local/run-conda.sh`. Change README's retired Render note to state that
Makers is the only production platform and Render history remains available through
Git, without linking `deploy/legacy/`.

Search active files with:

```bash
rg -n '\./run\.sh|\./reset\.sh|deploy/legacy/render\.yaml' \
  README.md AGENTS.md .env.example backend docs scripts tests-makers
```

Expected: no current instruction points to an obsolete path. Matches inside dated
historical documents are permitted only when describing historical behavior.

- [ ] **Step 4: Remove the empty platform cache safely**

Run:

```bash
rmdir .agents
```

Expected: success only because `.agents/` is still empty. Do not use recursive
deletion.

- [ ] **Step 5: Validate script syntax and configuration contracts**

Run:

```bash
bash -n scripts/local/run-conda.sh scripts/local/reset-redis.sh
node --test tests-makers/configuration.test.mjs
```

Expected: both commands pass.

### Task 4: Verify the complete cleanup

**Files:**
- Verify: all files changed or moved by Tasks 1–3

**Interfaces:**
- Consumes: the reorganized repository
- Produces: evidence that local development, production build, tests, paths, and repository scope remain valid

- [ ] **Step 1: Verify directory policy**

Check that the GitHub-visible root no longer contains `run.sh`, `reset.sh`, or
`deploy/`; that `.agent/` is tracked; that every `.agent/docs/*.md` filename is
date-prefixed; and that `docs/` contains only formal documentation, generated
audits, and images.

- [ ] **Step 2: Validate Markdown links**

Extract repository-relative Markdown and HTML image targets from `README.md`,
`AGENTS.md`, `.agent/**/*.md`, `docs/**/*.md`, and `backend/README.md`. Ignore
HTTP(S), mail, and page anchors. Verify every remaining path exists relative to the
document containing the link or repository root as appropriate.

- [ ] **Step 3: Run required verification**

Run separately:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: every command exits successfully.

- [ ] **Step 4: Review and commit**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Confirm the diff contains only the approved directory cleanup, document moves,
instruction updates, and tests. Commit with a concise repository-organization
message; do not push unless explicitly requested.
