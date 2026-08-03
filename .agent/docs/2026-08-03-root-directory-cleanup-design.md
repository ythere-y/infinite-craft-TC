# GitHub 根目录精简设计

> 文档日期：2026-08-03

## 目标

在完全保持默认本地开发、Docker Compose、EdgeOne Makers 构建与自动部署方式不变的前提下，减少 GitHub 仓库主页上的根级条目，并确保给开发者和 AI Agent 阅读的说明与新路径一致。

同时把 AI 产生的设计、实施计划、调研和待实现方案从正式产品文档中分离，
建立可持续执行的文件位置和命名规则。

## 根目录脚本与历史部署清理

根目录减少三个条目：

```text
run.sh      → scripts/local/run-conda.sh
reset.sh    → scripts/local/reset-redis.sh
deploy/     → 删除
```

`deploy/` 目前只包含已暂停的 Render 历史配置
`deploy/legacy/render.yaml`。删除后不提供替代运行入口；历史内容继续由 Git
保存。

本地平台缓存 `.agents/` 当前为空目录。实施时使用 `rmdir .agents` 删除，只有
在目录仍为空时才成功；保留 `.gitignore` 中的 `.agents/` 规则，以便平台将来
重新创建缓存时不会污染 Git。

## 脚本行为

两个脚本迁移到 `scripts/local/` 后仍以仓库根目录作为工作目录，而不是以脚本
所在目录作为工作目录。

- `run-conda.sh` 继续使用根目录的 `requirements.txt`、`data/` 和
  `backend.main:app`。
- `reset-redis.sh` 继续使用根目录的 `data/backup/`，并在帮助和错误信息中
  引用迁移后的脚本路径。
- 脚本只作为特殊 Conda 环境和 Redis 数据维护工具；默认成员与 Agent 工作流
  仍是 `npm run dev` 和 `npm run dev:down`。

## 保持不变的入口

以下根级文件和目录是工具链、平台或通用工程约定所需，不移动：

- `Dockerfile` 与 `docker-compose.yml`
- `edgeone.json`
- `package.json` 与 `package-lock.json`
- `requirements.txt` 与 `requirements-dev.txt`
- `.env.example`、`.gitignore` 与 `.dockerignore`
- `AGENTS.md`、`README.md` 与 `THIRD_PARTY_NOTICES.md`
- `backend/`、`frontend/`、`edge-functions/`、`scripts/`、`tests/` 和
  `tests-makers/`

默认命令、环境变量、端口、Docker 服务和 Makers 配置均不改变。

## AI 文档目录规范

新增受 Git 跟踪的 `.agent/`（单数），与被忽略的平台缓存 `.agents/`（复数）
严格区分：

```text
.agent/
├── README.md
└── docs/
    └── YYYY-MM-DD-<topic>-<type>.md
```

统一规则：

- AI 创建的设计、实施计划、调研、改进提案和过程说明放入 `.agent/docs/`。
- 文件名必须以实际创建日期 `YYYY-MM-DD-` 开头，后接小写英文主题和文档类型。
- 设计使用 `-design.md`，实施计划使用 `-implementation-plan.md`，改进提案
  使用 `-improvement.md`。
- 面向项目使用者和开发者的正式、持续维护文档仍放在 `docs/`。
- 自动生成且面向维护者的审计报告仍放在 `docs/`。
- AI 不得在 `docs/`、仓库根目录或 `docs/superpowers/` 创建过程文档。

`.gitignore` 删除 `/docs/superpowers/` 规则，避免今后错误路径中的文档被静默
隐藏；`.agent/` 不加入忽略规则。

## 现有 AI 文档迁移

以下文件迁入 `.agent/docs/`：

```text
docs/improvements/emoji-matching.md
  → .agent/docs/2026-07-21-emoji-matching-improvement.md
docs/improvements/wall-search-all.md
  → .agent/docs/2026-07-21-wall-search-all-improvement.md
docs/plans/2026-07-23-edgeone-makers-design.md
  → .agent/docs/2026-07-23-edgeone-makers-design.md
docs/plans/2026-07-23-edgeone-makers-implementation.md
  → .agent/docs/2026-07-23-edgeone-makers-implementation-plan.md
docs/repository-flattening-design.md
  → .agent/docs/2026-08-03-repository-flattening-design.md
docs/repository-flattening-plan.md
  → .agent/docs/2026-08-03-repository-flattening-implementation-plan.md
docs/root-directory-cleanup-design.md
  → .agent/docs/2026-08-03-root-directory-cleanup-design.md
docs/superpowers/specs/2026-08-03-resume-readme-design.md
  → .agent/docs/2026-08-03-resume-readme-design.md
docs/superpowers/plans/2026-08-03-resume-readme.md
  → .agent/docs/2026-08-03-resume-readme-implementation-plan.md
```

前七项已由 Git 跟踪，使用 Git rename 保留历史。最后两项当前被忽略但仍存在，
迁移后作为正常项目文件加入 Git。

迁移完成后：

- `docs/plans/`、`docs/improvements/` 和 `docs/superpowers/` 均不存在；
- `docs/` 只保留 `makers-development.md`、`icon-system-audit.md` 和 `imgs/`；
- 所有有效的仓库内链接更新到 `.agent/docs/` 新路径。

## 文档与 AI 指令同步

所有当前有效的说明必须反映新路径：

- `README.md`
- `AGENTS.md`
- `.agent/README.md`
- `.env.example`
- `docs/makers-development.md`
- `backend/README.md`（仅在存在旧路径引用时修改）
- 仓库内其他非历史说明文件

`AGENTS.md` 增加 AI 文档位置、日期命名和正式文档边界规则，并链接
`.agent/README.md` 的完整约定。历史设计和实施计划的正文保留其发生时的命令
与上下文，但其中会导致当前读者访问失效路径的 Markdown 链接需要修正。

`AGENTS.md` 的默认工作流不依赖迁移后的脚本，因此不改变 Agent 默认命令。

## 测试调整

`tests-makers/configuration.test.mjs` 不再要求保留暂停的 Render Blueprint，
改为验证：

- 根目录不存在 `render.yaml`；
- 仓库不存在 `deploy/legacy/render.yaml`；
- 主文档仍明确 Makers 是唯一主动维护的生产平台。

验证命令：

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

同时执行：

- `bash -n scripts/local/run-conda.sh scripts/local/reset-redis.sh`
- 检查当前有效文档中不存在失效的 `./run.sh` 或 `./reset.sh` 引用；
- 检查根目录不再存在 `run.sh`、`reset.sh` 和 `deploy/`；
- 检查所有 `.agent/docs/*.md` 都符合 `YYYY-MM-DD-*.md`；
- 检查 `docs/` 不包含设计、计划、调研或改进提案；
- 检查仓库内 Markdown 相对链接全部存在；
- 检查 `git diff --check` 与最终变更范围。

## 风险控制

- 不执行 Redis 清理、备份或恢复命令，只做 Shell 语法检查。
- 不启动 Conda、Docker 或本地服务来验证辅助脚本。
- 不删除 Docker、Makers、依赖或第三方声明文件。
- `.agents/` 仅在仍为空时使用 `rmdir` 删除，不递归删除平台缓存。
- 不修改、暂存或提交本任务以外的工作区文件。
