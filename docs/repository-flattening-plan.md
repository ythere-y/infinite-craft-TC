# Repository Flattening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/data/workspace/06.infinity_craft` the Git repository root while preserving all Git history, branches, configuration, and the existing GitHub remote.

**Architecture:** Treat the inner repository and its `.git` directory as one unit. First detach clean linked worktrees and commit ignore/deletion changes, then replace the empty outer Git placeholder and move the complete inner repository contents up one level without reinitializing Git.

**Tech Stack:** Git, POSIX filesystem operations, shell verification commands

## Global Constraints

- Preserve `origin` exactly as `git@github.com:ythere-y/infinite-craft-TC.git`.
- Preserve every local branch and commit.
- Do not initialize a new repository, rewrite history, hard-reset, or push.
- Do not overwrite a path collision during the move.
- Keep platform-managed outer `.agents/` and `.codex/` outside Git.
- Remove all `.superpowers/` runtime directories and all tracked `docs/superpowers/` content.
- Ensure `.superpowers/`, `.worktrees/`, and `docs/superpowers/` remain ignored.

---

### Task 1: Detach Temporary Linked Worktrees

**Files:**
- Remove checkout: `.worktrees/wall-leaderboard-refresh/`
- Remove checkout: `.worktrees/wall-reactions-admin/`
- Preserve ref: `refs/heads/feature/wall-leaderboard-refresh`
- Preserve ref: `refs/heads/feat/wall-reactions-admin`

**Interfaces:**
- Consumes: the clean linked worktrees registered in the inner repository
- Produces: a repository with only its main worktree registered and both feature branch refs intact

- [ ] **Step 1: Verify the repository and both linked worktrees are clean**

Run:

```bash
git status --short --branch
git -C .worktrees/wall-leaderboard-refresh status --short --branch
git -C .worktrees/wall-reactions-admin status --short --branch
```

Expected: the main worktree reports only its branch/ahead state, and neither
linked worktree reports modified or untracked files.

- [ ] **Step 2: Record branch tips and the remote before mutation**

Run:

```bash
git remote get-url origin
git rev-parse main
git rev-parse feature/wall-leaderboard-refresh
git rev-parse feat/wall-reactions-admin
git worktree list --porcelain
```

Expected remote:

```text
git@github.com:ythere-y/infinite-craft-TC.git
```

Expected feature branch tips:

```text
feature/wall-leaderboard-refresh 7ffffb92f198d41921f4eac6774d5ae848134871
feat/wall-reactions-admin faa7798c8594d96154adcfa46c5f5a192d83207a
```

- [ ] **Step 3: Remove the clean linked worktree checkouts**

Run:

```bash
git worktree remove .worktrees/wall-leaderboard-refresh
git worktree remove .worktrees/wall-reactions-admin
git worktree prune
```

Expected: both commands succeed without `--force`.

- [ ] **Step 4: Verify the branches survived and only one worktree remains**

Run:

```bash
git rev-parse feature/wall-leaderboard-refresh
git rev-parse feat/wall-reactions-admin
git worktree list --porcelain
```

Expected: both hashes match Step 2 and the worktree list contains only
`/data/workspace/06.infinity_craft/06.infinity_craft`.

### Task 2: Remove Tracked Superpowers History and Strengthen Ignores

**Files:**
- Modify: `.gitignore:120-124`
- Delete: `docs/superpowers/`

**Interfaces:**
- Consumes: tracked historical Superpowers documents and existing broad ignore rules
- Produces: root-anchored ignore rules and no Git-tracked Superpowers content

- [ ] **Step 1: Replace the tool-cache ignore block**

Change:

```gitignore
.worktrees/
CLAUDE.md

.superpowers/
```

to:

```gitignore
/.worktrees/
/.superpowers/
/docs/superpowers/
CLAUDE.md
```

- [ ] **Step 2: Remove tracked Superpowers documents**

Run:

```bash
git rm -r docs/superpowers
```

Expected: Git stages deletion of the historical plan and spec files.

- [ ] **Step 3: Verify ignore behavior and the exact staged scope**

Run:

```bash
git check-ignore -v .superpowers .worktrees docs/superpowers
git status --short
git diff --cached --check
```

Expected: all three paths match `.gitignore`; staged changes contain only
`docs/superpowers/` deletions, while `.gitignore` is the only unstaged change.

- [ ] **Step 4: Commit the tracked cleanup**

Run:

```bash
git add .gitignore
git commit -m "chore: remove superpowers artifacts"
```

Expected: one local commit containing the `.gitignore` update and
`docs/superpowers/` deletions.

### Task 3: Flatten the Repository Filesystem

**Files:**
- Move from: `/data/workspace/06.infinity_craft/06.infinity_craft/*`
- Move to: `/data/workspace/06.infinity_craft/*`
- Remove: `/data/workspace/06.infinity_craft/.superpowers/`
- Remove: `/data/workspace/06.infinity_craft/06.infinity_craft/.superpowers/`
- Remove: `/data/workspace/06.infinity_craft/06.infinity_craft/.worktrees/`
- Remove: `/data/workspace/06.infinity_craft/openai-agents-starter-node/`
- Replace: empty platform-created `/data/workspace/06.infinity_craft/.git/`
  with the real inner repository `.git/`
- Preserve: `/data/workspace/06.infinity_craft/.agents/`
- Preserve: `/data/workspace/06.infinity_craft/.codex/`

**Interfaces:**
- Consumes: a clean inner repository with no linked worktrees
- Produces: the same repository rooted directly at `/data/workspace/06.infinity_craft`

- [ ] **Step 1: Verify outer collision assumptions**

Run:

```bash
find /data/workspace/06.infinity_craft -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
find /data/workspace/06.infinity_craft/.git -mindepth 1 -print
```

Expected outer entries are `.agents`, `.codex`, `.git`, `.superpowers`,
`06.infinity_craft`, and `openai-agents-starter-node`; the outer `.git`
directory has no children.

- [ ] **Step 2: Remove explicit generated and unrelated directories**

Run only against these exact absolute paths:

```bash
rm -rf /data/workspace/06.infinity_craft/.superpowers
rm -rf /data/workspace/06.infinity_craft/06.infinity_craft/.superpowers
rm -rf /data/workspace/06.infinity_craft/06.infinity_craft/.worktrees
rm -rf /data/workspace/06.infinity_craft/openai-agents-starter-node
rmdir /data/workspace/06.infinity_craft/.git
```

Expected: all targets disappear. The last command succeeds only because the
outer `.git` placeholder is empty; stop if it is not empty.

- [ ] **Step 3: Move every inner entry, including dotfiles, to the outer root**

Run from `/data/workspace/06.infinity_craft`:

```bash
find /data/workspace/06.infinity_craft/06.infinity_craft \
  -mindepth 1 -maxdepth 1 \
  -exec mv -t /data/workspace/06.infinity_craft -- {} +
rmdir /data/workspace/06.infinity_craft/06.infinity_craft
```

Expected: the redundant child directory is empty and removed. No path collision
occurs because the only retained outer entries are `.agents/` and `.codex/`,
which do not exist in the inner repository.

### Task 4: Verify Git Integrity at the New Root

**Files:**
- Verify: `/data/workspace/06.infinity_craft/.git/config`
- Verify: `/data/workspace/06.infinity_craft/.git/refs/`
- Verify: `/data/workspace/06.infinity_craft/.gitignore`

**Interfaces:**
- Consumes: the flattened repository
- Produces: evidence that repository identity, remote, refs, ignores, and tracked paths remain correct

- [ ] **Step 1: Verify root identity and remote**

Run from `/data/workspace/06.infinity_craft`:

```bash
git rev-parse --show-toplevel
git remote -v
git remote get-url origin
```

Expected root:

```text
/data/workspace/06.infinity_craft
```

Expected fetch and push URL:

```text
git@github.com:ythere-y/infinite-craft-TC.git
```

- [ ] **Step 2: Verify preserved refs and worktree registration**

Run:

```bash
git rev-parse feature/wall-leaderboard-refresh
git rev-parse feat/wall-reactions-admin
git worktree list --porcelain
```

Expected branch hashes:

```text
7ffffb92f198d41921f4eac6774d5ae848134871
faa7798c8594d96154adcfa46c5f5a192d83207a
```

Expected: exactly one worktree rooted at `/data/workspace/06.infinity_craft`.

- [ ] **Step 3: Verify clean tracked paths and ignored artifact paths**

Run:

```bash
git status --short --branch
git diff --summary
git check-ignore -v .superpowers .worktrees docs/superpowers
git ls-files '.superpowers/**' '.worktrees/**' 'docs/superpowers/**'
```

Expected: no tracked file changes, no mass delete/add report, all artifact paths
are ignored, and `git ls-files` prints nothing.

- [ ] **Step 4: Verify outer cleanup**

Run:

```bash
test ! -e /data/workspace/06.infinity_craft/06.infinity_craft
test ! -e /data/workspace/06.infinity_craft/openai-agents-starter-node
test ! -e /data/workspace/06.infinity_craft/.superpowers
test -d /data/workspace/06.infinity_craft/.agents
test -d /data/workspace/06.infinity_craft/.codex
```

Expected: all commands exit successfully.

- [ ] **Step 5: Record final local commit state**

Run:

```bash
git status --short --branch
git log -3 --oneline --decorate
```

Expected: `main` is ahead of `origin/main` only by the local design, plan, and
cleanup commits. No push is performed.
