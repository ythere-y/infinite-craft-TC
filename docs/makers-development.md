# 本地开发与 EdgeOne Makers 发布指南

项目使用两套相互独立的运行环境：

| 场景 | 服务 | 数据 | 模型 |
| --- | --- | --- | --- |
| 成员电脑 | FastAPI | 本机 Redis + SQLite | DeepSeek API |
| `main` 线上版本 | Makers Edge Functions | `test → infinite_craft` KV | Makers Models |

普通本地开发不需要 EdgeOne 账号或项目权限。本机数据不会写入 Makers，线上
数据也不会同步到本机。

## 一、本地开发

### 前置条件

- Node.js 20 或更高版本；
- Docker Desktop，或带 Compose 插件的 Docker Engine；
- 成员私发的 DeepSeek API Key。

确认 Docker 可用：

```bash
docker --version
docker compose version
```

### 首次启动

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
cp .env.example .env
```

只在被 Git 忽略的 `.env` 中填写：

```dotenv
LLM_API_KEY=成员私发的DeepSeek密钥
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

启动：

```bash
npm run dev
```

首次启动会拉取 Redis 和 Python 镜像并安装依赖，后续启动复用 Docker 缓存。
命令保持在前台显示 FastAPI、模型和请求日志；按 `Ctrl+C` 停止前台进程，或
在另一个终端执行：

```bash
npm run dev:down
```

### 本地访问与健康检查

```bash
curl --noproxy '*' http://127.0.0.1:8000/api/health
curl --noproxy '*' http://127.0.0.1:8000/api/elements
```

健康检查应至少包含：

```json
{
  "redis": "ok",
  "llm": "configured",
  "sqlite": "/app/data/dev.db",
  "app_env": "dev",
  "content": {
    "epoch": 2,
    "catalog_digest": "sha256:...",
    "status": "ready"
  }
}
```

健康检查不会调用模型。要验证 DeepSeek，可在网页合成一组预设配方之外的
元素，或向 `/api/combine` 发送一次请求；重复相同组合应命中本地缓存。

### 本地数据

- Redis 监听宿主机 `127.0.0.1:16739`，容器内使用 DB 1；
- Redis AOF 位于 `data/redis/`；
- SQLite 位于 `data/dev.db`；
- 所有这些路径都被 Git 忽略。

Compose 固定向 Web 容器注入 `APP_ENV=dev` 和
`REDIS_URL=redis://redis:6379/1`，本机 `.env` 不能把它们改为生产值或远端
Redis。后端与前端源码以只读方式挂载，Uvicorn 会在代码修改后自动重载。

### Content Epoch 与本地数据迁移

本地启动会先读取 SQLite 的 `content_state`，再加载固定目录：

- 没有状态且 SQLite、Redis 都没有玩法数据时执行 bootstrap；若任一存储已存在
  运行时数据，则把来源识别为 `legacy`；
- 只有当前目录 `meta.destructive_reset_from` 明确列出的来源才允许执行 epoch
  reset。Epoch 2 当前只授权 `["legacy", 1]`；
- 获得授权的 epoch reset 会清空全部本地测试玩法数据，包括社区公式、投票、
  首发、KPI 与昵称记录，同时仅清空 `REDIS_URL` 选中的逻辑库；SQLite 的
  `content_state` 和无关配置表保留；
- 更高 epoch、未授权的较低 epoch 会在写迁移状态或删除数据前使启动失败；
- epoch 相同但目录 digest 变化时执行差异迁移，删除明确退役的 seed
  组合/元素，并用当前固定公式覆盖同键动态结果；
- 迁移中断时保留 `migrating` 状态，下一次启动从安全阶段恢复；
- 完成后写入 `ready`，相同 digest 的再次启动只做幂等对账，不会反复硬重置。

Epoch 2 的 11 个 starter 为：

```text
水、火、风、土、企鹅、人、时间、AI、电脑、手机、网络
```

腾讯/互联网悬赏目录的唯一可编辑来源是
`content/tencent-bounty-catalog.json`；编译器还会合并保留原版链条的
`backend/seed_elements.json` 和 `backend/seed_combinations.json`，修改经典
基础内容时应编辑对应源文件。修改后运行：

```bash
npm run generate:bounty-content
npm run generate:icon-data
npm run generate:makers-data
```

生成器会同时更新 FastAPI、Makers 和图标产物，并校验所有悬赏目标从 starter
严格可达。不要手工编辑 `backend/generated/`、`edge-functions/_generated/`
或生成的图标映射。

<a id="共享业务契约与运行时边界"></a>

### 共享业务契约与运行时边界

本地 FastAPI 与 Makers 共用以下已提交来源：

| 来源 | 责任 | 维护方式 |
| --- | --- | --- |
| `shared/combine-prompt.json` | 组合提示词与风格规则 | 唯一可编辑来源 |
| `shared/nickname-data.json` | 正常运行和构建使用的花名语料 | 提交经过筛选的语料快照 |
| `shared/runtime-contract.json` | 组合元素、发现者、会话 ID、批量配方数与配方字段的五项应用层请求限制 | 唯一可编辑来源 |

Docker 镜像会复制 `shared/`，Compose 也将它只读挂载到 Web 容器；Python 后端
直接加载这些 JSON。`npm run build` 会校验共享来源，并重新生成已提交到
`edge-functions/_generated/` 的 Makers 模块。生成文件只用于适配 V8 运行时，
不得手工编辑；修改共享来源后应运行构建并一并提交生成结果。

花名语料的原始 THUOCL checkout 位于被 Git 忽略的 `words/THUOCL/data`，仅在
维护者明确刷新语料时运行：

```bash
npm run refresh:nickname-corpus
```

该命令会更新 `shared/nickname-data.json`。正常的 FastAPI/Makers 运行、
`npm test` 和 `npm run build` 都只读取已提交快照，不读取或要求存在 `words/`。

共享契约统一的是提示词规则、花名语料和应用层请求限制，不是让两个运行时逐字节
相同。以下差异是有意保留的平台适配：

- 本地使用 Redis + SQLite；Makers 使用最终一致的 KV，写入原子性不同，不提供
  SQL 式事务保证。
- 本地通过 `LLM_API_KEY` 调用 OpenAI-compatible DeepSeek；Makers 使用
  `MAKERS_MODELS_KEY` 和 Makers Models。
- 本地首发墙使用进程内队列支持 SSE 增量推送；Makers 受边缘连接投递约束，
  `/api/wall/stream` 不维持同类队列流，页面通过查询接口获取更新。
- 限频状态按实现分别存放在本地 Redis 与 Makers KV 中。
- 本地管理统计可直接读取 SQL/Redis 视图；Makers 统计使用分片和尽力计数，
  属于近似值。
- Makers 额外保留一兆字节请求体限制和生产环境专用安全控制；这些平台边界不属于
  `shared/runtime-contract.json` 的五项应用限制。

### 日常命令

```bash
npm run dev                  # 启动本地服务并显示日志
docker compose logs -f web   # 只跟踪 FastAPI 日志
docker compose ps            # 查看容器健康状态
npm run dev:down             # 停止服务，保留数据
```

`scripts/local/run-conda.sh` 仍可用于特殊的 Conda 环境，但不是成员和 Agent
的默认入口。

## 二、修改与 PR

开发分支修改完成后运行：

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

安装了 EdgeOne CLI 的发布维护者再执行：

```bash
npm run makers:build
```

该命令只验证 Makers 静态产物和 Edge Function 编译，不读取线上 KV。普通
本地开发不要求安装或登录 EdgeOne CLI。

提交功能分支、创建 PR，并合并到 `main`。Makers 已配置的 Git 集成检测到
`main` 更新后会自动发布，仓库不保存部署 Token，也不重复运行另一套发布
脚本。

## 三、Makers 生产配置

### KV

项目必须绑定：

```text
变量名：test
命名空间：infinite_craft
```

Edge Function 将 `test` 当作整个数据库使用，并在运行时自动创建组合、元素、
首发、昵称、分数、排行榜和索引所需的 key。现有分数记录仍使用字面量
`kpi_*` KV key，以兼容已持久化的数据。

每个已构建版本都携带 `content_epoch`、catalog version、digest 和
`destructive_reset_from`。这个目录字段是破坏性清空的唯一授权来源；Epoch 2
当前只授权从 `legacy` 或 Epoch 1 迁移。新增未来 epoch 时，维护者必须在可编辑
目录中有意声明允许清空的确切来源，生成器会拒绝重复、当前/更高 epoch、错误类型
或缺失的授权清单。

Edge Function 初始化通过 `system_content_state` 执行分批、可恢复的 bootstrap、
epoch reset 或差异迁移。授权的 Epoch 2 reset 会清空 KV 中除控制记录外的全部
测试运行时数据，包括组合/元素、社区、投票、首发、KPI、昵称及其索引。控制记录
`system_content_state` 和所有 `system_content_reset_receipt_*` 不参与清空。

目标 Epoch 2 使用 `system_content_reset_receipt_2` 记录来源 epoch、目录 digest、
`in_progress`/`completed` 状态及起止时间。初始化器先持久化 `in_progress` 回执，
再进入删除阶段；目录精确校验完成后先把回执标记为 `completed`，最后发布 ready
状态。中断后可继续未完成的清空；若回执已完成但状态丢失，只执行非破坏性对账，
不会再次清空运行时数据。

非健康检查 API 在内容未 ready 时返回 503，`/api/health` 仍可用于观察公开的
epoch、digest、status、mode 和 phase。未授权转换公开为
`CONTENT_RESET_NOT_AUTHORIZED`，坏回执或冲突回执公开为
`CONTENT_RESET_RECEIPT_INVALID`；两者都不会暴露原始状态、回执内容或底层异常。
其他初始化错误仍统一为 `CONTENT_INITIALIZATION_FAILED`。初始化完成后，固定
元素、组合、配方索引和深度映射都会与该版本目录对账。

Makers KV 没有 compare-and-swap。实现保证同一 isolate 内串行初始化，并通过
可重放步骤在“同时只推进一个 catalog 版本”的发布约束下最终收敛；不宣称不同
isolate 之间具有 SQL 事务或严格线性一致性。

控制台中已有的 `test_dev → infinite_craft_dev` 可以保留备用，但当前源代码
不会读取它。本地开发也不会连接它。

### 社区公式的一致性边界

Makers 的公开列表先读取完整但最多 500 条的热目录，过滤不可见和已下架记录，
按净赞数、发布时间和公式 ID 排序，再应用 `limit` 与 `offset`。这个 500 条窗口
是线上目录的容量边界，不代表会扫描无限历史；已经移出热目录的公开公式仍可通过
公式 ID 直接查询详情。

权威 seed 配方在玩家访问对应元素组合时才进行惰性对账。版本号按组合历史单调递增，
公式 ID 由组合与版本号确定；若节点读到的指针、记录或版本意图不完整、不一致，
接口返回可重试错误，不会把 KV 描述成 SQLite 事务。

新版本先写入带恢复内容的 pending marker；公式记录可由这个 marker 补齐。记录确认
后再写 ready 标记，并把 marker 转为不再携带恢复内容的 committed 状态。若 ready
已经可见但公式记录暂时不可读，系统会要求重试，而不会从 committed marker 重建
历史。该协议用于恢复中断写入，但 Makers KV 在不同边缘节点之间仍是最终一致的，
不提供 SQL 式原子提交或全局事务保证。

### Makers Models 与安全

Makers 控制台环境变量：

```dotenv
MAKERS_MODELS_KEY=控制台中的MakersModels密钥
MAKERS_USE_OWN_DEEPSEEK=1
MAKERS_DEEPSEEK_API_KEY=DeepSeek官方API密钥
AI_GATEWAY_BASE_URL=https://ai-gateway.edgeone.link/v1
AI_GATEWAY_MODEL=@makers/deepseek-v4-flash
MODEL_CALLS_PER_MINUTE=20
ADMIN_TOKEN=随机长字符串
DASHBOARD_PUBLIC=0
```

`MAKERS_USE_OWN_DEEPSEEK` 设置为 `1`、`true`、`yes` 或 `on` 时，生产
Edge Function 使用 `MAKERS_DEEPSEEK_API_KEY` 直连
`https://api.deepseek.com` 的 `deepseek-v4-flash`；其他值继续使用
`MAKERS_MODELS_KEY` 与 Makers Models。直连路由开启但对应 Key 缺失时会按
未配置模型降级，不会静默回退并消耗 Makers 免费额度。两条路由均关闭 thinking，
并将单次模型输出限制为 128 Token。

`MAKERS_MODELS_KEY`、`MAKERS_DEEPSEEK_API_KEY` 与本地 `LLM_API_KEY`
是相互独立的凭据。前两者只配置在 Makers 控制台，后者只存在于成员电脑被 Git
忽略的 `.env`；不要把任一真实 Key 写入仓库。

### 自动发布边界

`edgeone.json` 固定执行：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

生产 Edge Function 只接受远端请求并只读取 `test → infinite_craft`。即使
Makers 控制台意外出现 `APP_ENV=dev`，代码也不会切换到开发 KV。Loopback
请求会返回配置错误并提示使用 `npm run dev`，防止误用本机 Edge Function
写入生产数据。

自动发布后，线上 `/api/health` 应包含：

```json
{
  "kv": "ok",
  "app_env": "makers",
  "llm": "configured",
  "content": {
    "epoch": 2,
    "catalog_digest": "sha256:...",
    "status": "ready",
    "mode": "ready",
    "phase": "ready"
  }
}
```

## 四、常见问题

### `npm run dev` 提示找不到 Docker

安装 Docker Desktop 或 Docker Engine Compose 插件，然后重新打开终端并
确认 `docker compose version` 成功。

### 端口 8000 或 16739 被占用

检查是否有本项目的旧容器或 `scripts/local/run-conda.sh` 进程：

```bash
docker compose ps
docker ps
npm run dev:down
```

停止占用端口的旧进程后重新执行 `npm run dev`。不要通过改成远端 Redis 来
绕过端口冲突。

### 健康检查显示 `llm: "not_configured"`

检查 `.env` 是否位于仓库根目录，变量名是否为 `LLM_API_KEY`，然后重建 Web
容器：

```bash
npm run dev:down
npm run dev
```

不要把 Key 发到聊天、Issue、日志或 Git。

### Redis 正常但 SQLite 写入失败

确认仓库的 `data/` 对当前 Docker 用户可写，并检查：

```bash
docker compose logs web
```

不要删除其他成员的数据。确实需要清空本机开发数据时，应先停止服务并由数据
所有者明确确认删除范围。

### Makers 构建通过但线上 API 报缺少 KV

检查生产项目的绑定变量名是否精确为 `test`、命名空间是否为
`infinite_craft`。KV 是 Edge Function 全局变量，不在 `context.env` 中。

### PR 合并后没有自动发布

在 Makers 控制台确认项目仍关联正确的 Git 仓库和 `main` 分支，并查看最新
部署日志。仓库代码不包含平台账号凭据，因此控制台连接失效需要项目维护者
重新授权。

## 五、Git 与数据安全

可以提交：

- `edgeone.json`、`package.json`、Dockerfile 和 Compose 配置；
- `.env.example` 的变量名与安全默认值；
- Edge Function、FastAPI、前端、测试和文档。

不能提交：

- `.env`、DeepSeek Key、Makers Key、管理令牌；
- `.edgeone/` 登录或项目关联状态；
- 带临时授权参数的预览地址；
- Redis AOF、SQLite、KV 导出和玩家数据。

Render 目前暂停，历史配置可通过 Git 记录追溯。Makers 是唯一主动维护、
在 `main` 更新后自动发布的线上平台。
