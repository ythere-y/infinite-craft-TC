# 本地开发与 Makers 生产运行时分离设计

日期：2026-07-23

## 目标

- 成员从 GitHub 克隆项目后，只需准备本机 `.env` 并执行
  `npm run dev`，即可启动完整的本地开发环境。
- 本地开发使用 FastAPI、Redis、SQLite 和成员自己的 DeepSeek API Key，
  不需要 EdgeOne 账号、CLI 登录、项目权限或远端 KV。
- PR 合并到 `main` 后，继续由既有 Makers Git 集成自动构建并发布。
- Makers 线上运行始终使用 `test → infinite_craft` 和 Makers Models，不受
  本地配置影响。
- 命令、文档和根目录 `AGENTS.md` 让新成员及编码 Agent 能快速判断应该运行
  哪套环境。

## 方案选择

### 采用：Docker Compose 作为本地唯一推荐入口

`npm run dev` 调用 Docker Compose，同时启动：

- FastAPI Web 服务；
- 独立 Redis；
- 按 `APP_ENV=dev` 创建的本地 SQLite 数据库；
- 从成员 `.env` 读取的 DeepSeek API 配置。

Docker Compose 对成员和 Agent 提供相同的 Python、Redis 与启动参数，不依赖
成员预先创建 Conda 环境。首次构建需要下载镜像和 Python 依赖；后续启动使用
Docker 缓存。后端与前端源代码挂载进 Web 容器，Uvicorn 使用 reload 模式，
开发时无需每次重新构建镜像。

### 未采用：继续以 `run.sh` 和 Conda 为主

现有 `run.sh` 可以运行，但依赖 Conda 的安装位置和环境状态。它适合作为历史
兼容入口，不适合作为跨成员、跨 Agent 的默认开发协议。

### 未采用：本地 EdgeOne Makers CLI

`edgeone makers dev` 要使用真实 KV，就需要登录并关联有权限的 Makers 项目；
这与“普通成员本地开发无需平台账号”的目标冲突。本地不再使用
`test_dev → infinite_craft_dev`，该控制台绑定可以保留，但项目代码不会读取。

## 两套运行时

| 场景 | HTTP/API 运行时 | 数据存储 | 模型 |
| --- | --- | --- | --- |
| 成员本地开发 | FastAPI | 本机 Redis + `data/dev.db` SQLite | DeepSeek API |
| `main` 线上发布 | Makers Edge Functions | `test → infinite_craft` KV | Makers Models |

两套数据完全独立，不做自动同步。成员本机产生的配方、昵称、KPI 和首发记录
不会进入线上 KV；线上数据也不会被拉取到本地。

## 本地开发入口

首次启动：

```bash
cp .env.example .env
# 在 .env 中填写 LLM_API_KEY
npm run dev
```

本地默认配置：

```dotenv
APP_ENV=dev
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

截至 2026-07-23，DeepSeek 官方 OpenAI 兼容 Base URL 为
`https://api.deepseek.com`，推荐模型名包括 `deepseek-v4-flash` 和
`deepseek-v4-pro`：
<https://api-docs.deepseek.com/quick_start/pricing>。

`LLM_API_KEY` 只保存在被 Git 忽略的 `.env` 中。未设置 Key 时应用仍能启动，
预设配方和已有缓存正常工作；需要生成新配方时会走现有 fallback。成员已获得
Key 后，本地 `/api/health` 应显示 `llm=configured`。

项目提供：

- `npm run dev`：以前台日志模式启动或更新本地服务；
- `npm run dev:down`：停止本地服务但保留 Redis/SQLite 数据；
- `npm test`：运行 Makers JavaScript 测试；
- Python 测试命令和 Makers 构建命令保留在文档中。

本地服务固定使用 `APP_ENV=dev` 和容器内 Redis 地址，不能由 `.env` 改成
`prod` 或远端 Redis。这样即使成员复制了其他环境变量，也不会误连线上数据。

## Makers 生产入口

`edgeone.json` 继续指定：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Makers Edge Function 只接受全局 KV 绑定 `test`。它不再根据 `APP_ENV` 选择
`test_dev`，也不再要求本地 `.env`。若 `test` 未绑定，API 返回明确的 500
配置错误。

为了防止有人误用 `edgeone makers dev` 并从本机写入生产 KV，Edge Function
入口遇到 `localhost`、`127.0.0.1` 或 IPv6 loopback 请求时直接拒绝，并提示
改用 `npm run dev`。线上请求统一报告 `app_env=makers`。

Makers Models 的 `MAKERS_MODELS_KEY`、模型和限流继续由 Makers 项目环境变量
注入；这些值不进入本地 `.env.example` 的必需配置。

## PR 与自动发布

仓库内代码不重复实现部署脚本，也不提交 Makers API Token。发布流程是：

1. 开发者在分支完成修改并运行本地测试和构建；
2. 创建 PR；
3. PR 合并到 `main`；
4. Makers 现有 Git 集成检测到 `main` 更新，自动执行 `npm run build` 并发布。

合并前验证至少包含：

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
PAGES_SOURCE=skills edgeone makers build
```

`edgeone makers build` 只做本地编译验证，不需要连接项目 KV。真正的线上 KV 和
环境变量在自动发布后的运行时注入。

## Agent 可发现性

根目录新增简短的 `AGENTS.md`，只记录高频事实：

- 默认本地命令是 `npm run dev`；
- `.env` 只需填写成员私发的 `LLM_API_KEY`；
- 本地栈与 Makers 数据完全隔离；
- 不要为本地开发执行 EdgeOne 登录或 link；
- `main` 由 Makers 自动发布；
- 修改后的最低验证命令。

README 提供面向人的完整说明，`AGENTS.md` 提供面向 Agent 的快速索引，二者
引用相同命令，避免形成两套流程。

## 配置与安全

提交到 Git：

- Docker Compose 本地服务定义；
- `package.json` 的本地启动/停止命令；
- 无密钥的 `.env.example`；
- `edgeone.json`、Edge Function、测试和开发文档；
- `AGENTS.md`。

不提交：

- `.env` 和 DeepSeek API Key；
- EdgeOne 登录状态、项目关联信息、API Token；
- Redis AOF、SQLite、KV 导出和其他玩家数据；
- Makers 预览地址的临时访问参数。

现有 `test_dev → infinite_craft_dev` 可以留在控制台备用，但不出现在代码的
运行路径中。Render 保持暂停和 legacy 状态。

## 测试与验收

- Runtime 单元测试证明远端请求只选择 `test`，即使 `APP_ENV=dev` 也不会读取
  `test_dev`。
- Runtime 单元测试证明本地 Edge Function 请求被拒绝，缺失 `test` 时失败
  关闭。
- 配置测试证明 `npm run dev` 使用 Docker Compose，`makers:dev` 已移除，
  Docker Compose 固定 `APP_ENV=dev` 和本机数据栈。
- 文档测试证明 README 和 `AGENTS.md` 同时说明本地命令、DeepSeek Key 和
  Makers 自动发布边界。
- 实际启动 `npm run dev` 后，`/api/health` 返回 Redis 正常、SQLite 为
  `dev.db`、`app_env=dev`，并在已有 `.env` Key 时返回 `llm=configured`。
- `npm test`、Python 测试、`npm run build` 与 `edgeone makers build` 全部
  通过。
- 推送 `main` 后 Makers 自动部署成功，线上 `/api/health` 返回
  `kv=ok`、`app_env=makers` 且 `llm=configured`。
