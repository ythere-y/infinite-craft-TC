# Infinity Craft Agent Guide

## Default local workflow

1. Copy `.env.example` to `.env`.
2. Put the privately supplied DeepSeek key in `LLM_API_KEY`.
3. Run `npm run dev`.
4. Verify `http://127.0.0.1:8000/api/health`.
5. Stop with `npm run dev:down`.

Local development uses FastAPI, Redis and SQLite. Do not use EdgeOne account
authentication, project association or an Edge Function dev server for local
development.

## Issue 标准处理流程

`upstream/main` 是唯一的主项目基准。`origin/main` 只是 fork 的主分支，
不得作为功能开发基准。处理每个 Issue 时必须遵循以下流程：

1. 阅读 Issue，确认问题、需求范围和验收标准；未理解清楚前不得修改代码。
2. 执行 `git fetch upstream`，确认本地已取得最新的 `upstream/main`。
3. 从最新的 `upstream/main` 创建一个只处理该 Issue 的独立功能分支，例如
   `feat/issue-22-prompt-configuration` 或 `fix/issue-35-combine-timeout`。
4. 所有修改、测试和 commit 都只能在该功能分支完成。禁止直接在本地
   `main`、`origin/main`、`upstream/main` 或其他 Issue 的分支上开发和提交。
5. 开始修改前检查当前分支和工作区状态。如果当前工作区含有其他任务或
   其他开发者的改动，必须创建独立 worktree，防止改动互相污染。
6. 完成实现后，运行本 Issue 的专项测试以及下方列出的完整验证命令。
   测试没有全部通过时，必须如实记录失败原因，不得声称功能已经完成。
7. 只 stage 和 commit 当前 Issue 的相关文件，禁止夹带其他任务或其他
   开发者的改动。
8. 将功能分支 push 到 `origin/<功能分支>`。禁止直接 push 到任何
   `main` 分支。
9. 从 `origin` 的功能分支向 `upstream/main` 创建 Pull Request。PR 必须
   说明解决的 Issue、主要改动、验证命令与结果、风险和待办，并使用
   `Closes #<issue-number>` 关联对应 Issue。
10. 创建 PR 只表示请求项目维护者审核并把该版本放入主游戏。只有 PR
    审核通过并合并到 `upstream/main` 后，改动才进入主游戏并正式生效。

完整流程：

```text
阅读 Issue
→ 同步 upstream/main
→ 从 upstream/main 创建独立 Issue 分支
→ 在功能分支中开发
→ 完成专项测试和完整验证
→ commit
→ push 功能分支到 origin
→ 向 upstream/main 创建 PR
→ 审核并合并
→ 改动进入主游戏
```

## Production workflow

Makers automatically builds and deploys after a PR is merged to `main`. Production
uses the `test → infinite_craft` KV binding and Makers Models. Never point local code
at Makers KV and never commit `.env`, credentials or runtime data.

## Required verification

Run `npm test`,
`python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and
`npm run build` before merging. A deployment maintainer with EdgeOne CLI installed
also runs `npm run makers:build`.

Do not touch or stage another developer's unrelated working-tree files.

## AI-generated documents

- Put AI-created designs, implementation plans, research notes, improvement
  proposals and process documents in `.agent/docs/`.
- Name each document `YYYY-MM-DD-<topic>-<type>.md`.
- Use `-design.md`, `-implementation-plan.md` or `-improvement.md` as the
  document type.
- Keep user and developer documentation in `docs/`. Do not put AI process
  documents there or in `docs/superpowers/`.
- Read `.agent/README.md` before creating or moving an AI process document.
