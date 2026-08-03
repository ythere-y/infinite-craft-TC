# GitHub 根目录精简设计

## 目标

在完全保持默认本地开发、Docker Compose、EdgeOne Makers 构建与自动部署方式不变的前提下，减少 GitHub 仓库主页上的根级条目，并确保给开发者和 AI Agent 阅读的说明与新路径一致。

## 变更范围

根目录减少三个条目：

```text
run.sh      → scripts/local/run-conda.sh
reset.sh    → scripts/local/reset-redis.sh
deploy/     → 删除
```

`deploy/` 目前只包含已暂停的 Render 历史配置
`deploy/legacy/render.yaml`。删除后不提供替代运行入口；历史内容继续由 Git
保存。

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

## 文档与 AI 指令同步

所有当前有效的说明必须反映新路径：

- `README.md`
- `AGENTS.md`
- `.env.example`
- `docs/makers-development.md`
- `backend/README.md`（仅在存在旧路径引用时修改）
- 仓库内其他非历史说明文件

历史设计和实施计划保留其发生时的路径记录，不为制造“全仓零匹配”而重写历史
文档。`AGENTS.md` 的默认工作流不依赖迁移后的脚本，因此仅在必要时补充辅助
工具位置，不改变 Agent 默认命令。

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
- 检查 `git diff --check` 与最终变更范围。

## 风险控制

- 不执行 Redis 清理、备份或恢复命令，只做 Shell 语法检查。
- 不启动 Conda、Docker 或本地服务来验证辅助脚本。
- 不删除 Docker、Makers、依赖或第三方声明文件。
- 不修改、暂存或提交本任务以外的工作区文件。
