# Repository Flattening Design

> Document date: 2026-08-03

## Goal

Make `/data/workspace/06.infinity_craft` the project and Git repository root,
instead of keeping the repository under the redundant
`06.infinity_craft/` child directory.

The operation must preserve the existing Git history, branches, repository
configuration, and the `origin` remote:

```text
git@github.com:ythere-y/infinite-craft-TC.git
```

## Current State

- The workspace root is not a functional Git repository.
- The real repository, including its `.git` directory, is under
  `06.infinity_craft/`.
- Two linked worktrees exist under the repository's ignored `.worktrees/`
  directory.
- `feature/wall-leaderboard-refresh` has been merged into `main`.
- `feat/wall-reactions-admin` is not merged, but its linked worktree is clean.
- Runtime Superpowers data exists both outside and inside the real repository.
- Historical files under `docs/superpowers/` are currently tracked.
- `openai-agents-starter-node/` is an unrelated outer template directory.
- `.agents/` and `.codex/` at the workspace root are platform-managed
  directories, not project content.

## Chosen Approach

Move the existing repository as a unit to the workspace root. Preserve its
actual `.git` metadata instead of initializing a new repository or rewriting
history.

Before moving the repository:

1. Record and verify the current repository root, remote URL, branch refs,
   status, and linked worktrees.
2. Remove the two clean linked worktree registrations with Git's worktree
   commands. This removes only their checkout directories; it does not delete
   either branch or its commits.
3. Remove tracked `docs/superpowers/` content.
4. Add root-anchored ignore rules for `.superpowers/`, `.worktrees/`, and
   `docs/superpowers/`.

During flattening:

1. Remove the unrelated outer `openai-agents-starter-node/` template.
2. Remove runtime `.superpowers/` directories from both levels rather than
   merging stale session data.
3. Move every remaining inner repository entry, including the real `.git`
   directory, to the workspace root.
4. Retain platform-managed `.agents/` and `.codex/` directories outside Git.

## Safety Rules

- Do not initialize a new repository.
- Do not change, remove, or recreate the `origin` remote.
- Do not delete local branches.
- Do not rewrite commits or refs.
- Do not use a hard reset.
- Do not overwrite project files on path collisions.
- Stop if either linked worktree becomes dirty before removal.
- Stop if the outer `.git` placeholder cannot be safely replaced with the real
  repository metadata.

## Verification

After flattening, verify all of the following from the workspace root:

1. `git rev-parse --show-toplevel` returns
   `/data/workspace/06.infinity_craft`.
2. `git remote get-url origin` still returns
   `git@github.com:ythere-y/infinite-craft-TC.git`.
3. `main`, `feature/wall-leaderboard-refresh`, and
   `feat/wall-reactions-admin` still exist and point to their original commits.
4. `git worktree list` contains only the flattened main worktree.
5. Git does not report the entire project as deleted and re-added.
6. `.superpowers/`, `.worktrees/`, and `docs/superpowers/` are ignored and
   untracked.
7. The redundant `06.infinity_craft/` directory and the unrelated starter
   template no longer exist.

## Expected Git Changes

Moving the repository root does not itself change tracked paths. The intended
tracked changes are limited to:

- deleting the historical `docs/superpowers/` files;
- updating `.gitignore`; and
- adding this design document.

These cleanup changes will be committed locally. No push or remote mutation is
part of this operation.
