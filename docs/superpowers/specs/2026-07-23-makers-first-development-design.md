# Makers 优先部署与团队本地开发设计

日期：2026-07-23

## 目标

- 未来至少一个月以 EdgeOne Makers 作为唯一主动维护的线上部署目标。
- 成员从 GitHub 克隆仓库后，可以使用 Makers CLI 启动完整的静态站点、
  Edge Functions、Makers Models 和 KV 联调环境。
- 本地开发只能写入开发命名空间，不能因缺少配置而回退到生产 KV。
- 将稳定、非敏感且对所有成员一致的配置提交到 Git；密钥、登录信息和
  成员本机状态继续留在 Git 之外。
- Render 暂停使用并从主流程移出，但保留恢复传统 FastAPI 部署所需的历史
  配置。

## 已有平台配置

同一个 Makers 项目已经绑定两个 KV 命名空间：

| 用途 | 运行时变量 | KV 命名空间 |
| --- | --- | --- |
| 生产 | `test` | `infinite_craft` |
| 本地开发 | `test_dev` | `infinite_craft_dev` |

生产环境继续使用现有 Git 集成：推送 `main` 后由 Makers 自动构建和发布。
本地开发通过 Makers CLI 关联这个现有项目，从而获得两个 KV 全局绑定和项目
环境变量。

## 数据层结论

Makers 版的运行数据以 KV 为唯一持久化层。固定元素和预设配方在构建时从
`backend/seed_*.json` 生成只读 JavaScript 模块，不依赖数据库初始化。
动态组合、元素、配方、首发、昵称、KPI、排行榜索引和近似统计均由
`edge-functions/_lib/kv-store.js` 写入 KV。

本地 Makers 开发不是纯内存 KV 模拟器。关联项目后，EdgeOne CLI 会让本地
Edge Function 访问已绑定的远端 KV。因此，本地开发使用
`test_dev → infinite_craft_dev`；生产使用 `test → infinite_craft`。

旧 FastAPI 后端的 Redis 和 `data/*.db` SQLite 文件与 Makers KV 是两套独立
数据，不自动双向同步。它们继续用于旧后端测试、离线分析和必要时的传统
服务器备用运行，但不再作为当前线上数据源，也不作为启动 Makers 本地开发
的前置条件。

## KV 环境选择

Edge Function 根据 `APP_ENV` 显式选择绑定：

- `APP_ENV=dev`：必须使用全局绑定 `test_dev`。
- 其他值或未设置：使用全局绑定 `test`，保持现有生产发布兼容。

`APP_ENV=dev` 只写入成员本机且被 Git 忽略的 `.env`，不能配置到当前 Makers
项目的控制台环境变量。Makers 项目环境变量对所有部署环境统一生效；若在
控制台设置为 `dev`，后续 `main` 生产部署也会误用开发 KV。当前方案覆盖
本机 Makers 开发与 `main` 生产发布；如未来需要云端开发预览长期使用独立
KV，应建立独立的 Makers 开发项目。

选择逻辑必须失败关闭：

- `APP_ENV=dev` 但 `test_dev` 不存在时，返回清晰的 500 配置错误，不能回退
  到 `test`。
- 生产模式下 `test` 不存在时，保留清晰的生产 KV 绑定错误。
- 当请求来自 `localhost`、`127.0.0.1` 或 `[::1]`，但本地环境未设置
  `APP_ENV=dev` 时，拒绝处理 API 请求并提示使用仓库提供的 Makers 开发命令，
  防止成员直接运行 CLI 后误写生产 KV。

不采用仅根据 Host 自动选择数据库的方案，因为该行为过于隐式；Host 只用于
发现危险的本地误配置，不用于决定最终绑定。不采用要求成员手改源代码或绑定
名的方案，因为这无法可靠防止生产数据污染。

## 团队首次启动流程

成员必须先获得该 Makers 项目的访问权限。首次克隆后执行：

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
npm install
npm install -g edgeone
edgeone login --site china
edgeone makers link
npm run makers:dev
```

`edgeone makers link` 使用交互式项目选择，因此仓库不硬编码项目 ID，也不要求
每位成员共享登录凭据。关联后生成的 `.edgeone/project.json` 和同步得到的
`.env` 都属于成员本机状态。

`npm run makers:dev` 使用独立脚本完成以下操作：

1. 检查 EdgeOne CLI、`.edgeone/project.json` 和项目关联状态。
2. 只在本机 `.env` 中新增或更新 `APP_ENV=dev`，保留同步得到的其他变量和
   所有密钥，不把任何值打印到终端。
3. 以 `--skip-env-sync` 启动 `edgeone makers dev`，避免启动时重新同步并覆盖
   本地的开发环境选择。
4. 使用 Makers 的本地 HTTP 服务调试，不能以 `file://` 或普通静态文件服务器
   预览。

项目不添加名为 `dev` 且内容为 `edgeone makers dev` 的 npm script，避免
Makers CLI 读取 `package.json` 的 `dev` 命令后递归启动。团队入口固定命名为
`makers:dev`。

## Git 中保存的配置

以下内容提交到 Git：

- `edgeone.json`：Makers 构建命令和静态输出目录。
- `package.json`：`makers:dev`、构建和测试命令。
- `.env.example`：仅包含安全默认值、变量名和生产/开发说明，不含真实密钥。
- KV 绑定约定：`test`、`test_dev` 及对应命名空间名称。
- Makers 本地启动脚本、前置检查和自动化测试。
- 团队开发、验证、发布与故障排查文档。

以下内容不得提交到 Git：

- `.env`、`.env.local` 及任何真实 API Key、管理令牌或私有地址。
- `.edgeone/project.json`、`.edgeone/auth.json` 和其他成员登录状态。
- Makers API Token、预览地址中的临时 `eo_token` / `eo_time`。
- KV 导出数据、本地 SQLite、Redis AOF/RDB 和玩家数据。

## 文档与 Render 降级

README 的顺序调整为：

1. Makers 线上部署与成员本地开发。
2. Makers KV/Models 配置和验证。
3. 旧 FastAPI/Docker 本地备用方式。
4. Render 暂停说明。

根目录 `render.yaml` 移至 `deploy/legacy/render.yaml`，使 Render Blueprint
不再表现为仓库默认部署入口。旧 Dockerfile、Compose、Python 后端和历史设计
文档保留，以支持离线分析和未来恢复。README 不再展示完整 Render 上线教程，
只说明当前暂停以及恢复配置的位置。

仓库变更无法停止 Render 控制台中已经存在的服务。项目所有者仍需在 Render
控制台手动暂停服务或关闭自动部署，避免 `main` 的后续提交继续触发 Render。

## 测试与验证

- 单元测试覆盖 `APP_ENV=dev → test_dev`、生产默认值 → `test`、缺失绑定失败
  关闭和本地误配置拒绝。
- 启动脚本测试覆盖 `.env` 中 `APP_ENV` 的新增、替换、幂等行为，以及其他
  配置和密钥文本保持不变。
- `npm test` 验证全部 Makers 业务和新增开发配置测试。
- `npm run build` 与 `edgeone makers build` 验证生产构建和 Edge Function
  编译。
- 完成一次真实本地冒烟测试：`/api/health` 返回 `app_env=dev`、KV 正常、
  LLM 已配置；一次开发写入只能出现在 `infinite_craft_dev`。
- 推送 `main` 后验证生产 `/api/health` 不为 `dev`，初始元素和主要只读 API
  正常，确保生产仍使用 `infinite_craft`。

## 验收标准

- 新成员只需获得 Makers 项目权限，不需要安装 Redis、运行 SQLite 或手工复制
  模型密钥，即可按文档启动本地 Makers 环境。
- 本地 API 在任何缺少开发环境标记或 `test_dev` 绑定的情况下都不会访问生产
  KV。
- Git 中包含完整的非敏感开发约定，但不包含任何账号凭据或运行数据。
- Makers 是 README 和配置中的默认部署方式；Render 只作为已暂停的历史备用
  方案存在。
