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
  "app_env": "dev"
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

### 组合提示词

组合提示词只编辑 `shared/combine-prompt.json`。本地 Web 容器以只读方式挂载
该目录，Python 后端直接加载这份 canonical JSON。执行 `npm run build` 会从它
重新生成 Makers 的 `edge-functions/_generated/prompt-data.js`；提示词测试会拒绝
canonical JSON 与已提交 Makers artifact 之间的漂移，构建测试也会在只含已提交
文件的夹具中重新生成并加载该 artifact。

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

控制台中已有的 `test_dev → infinite_craft_dev` 可以保留备用，但当前源代码
不会读取它。本地开发也不会连接它。

### 社区公式的一致性边界

Makers 的公开列表先读取完整但最多 500 条的热目录，过滤不可见和已下架记录，
按净赞数、发布时间和公式 ID 排序，再应用 `limit` 与 `offset`。这个 500 条窗口
是线上目录的容量边界，不代表会扫描无限历史；已经移出热目录的公开公式仍可通过
公式 ID 直接查询详情。

权威 seed 配方在玩家访问对应元素组合时才进行惰性对账。公式 ID 和版本由组合及
版本号确定；若节点读到的指针、记录或版本意图不完整、不一致，接口返回可重试错误，
不会把 KV 描述成 SQLite 事务。

新版本先写入带恢复内容的 pending marker；公式记录可由这个 marker 补齐。记录确认
后再写 ready 标记，并把 marker 转为不再携带恢复内容的 committed 状态。若 ready
已经可见但公式记录暂时不可读，系统会要求重试，而不会从 committed marker 重建
历史。该协议用于恢复中断写入，但 Makers KV 在不同边缘节点之间仍是最终一致的，
不提供 SQL 式原子提交或全局事务保证。

### Makers Models 与安全

Makers 控制台环境变量：

```dotenv
MAKERS_MODELS_KEY=控制台中的MakersModels密钥
AI_GATEWAY_BASE_URL=https://ai-gateway.edgeone.link/v1
AI_GATEWAY_MODEL=@makers/deepseek-v4-flash
MODEL_CALLS_PER_MINUTE=20
ADMIN_TOKEN=随机长字符串
DASHBOARD_PUBLIC=0
```

`MAKERS_MODELS_KEY` 与本地 `LLM_API_KEY` 是两套独立凭据。前者只在 Makers
运行时注入，后者只存在于成员电脑的 `.env`。

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
  "llm": "configured"
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
