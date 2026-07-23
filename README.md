# 🐧 Infinity Craft · 鹅厂打工人版

以 [neal.fun/infinite-craft](https://neal.fun/infinite-craft/) 为蓝本，把合成
词库换成鹅厂打工人文化、社交平台热梗和互联网黑话。

项目包含：

- 大屏投屏首发墙、搜索、分页和排行榜；
- 打工人 KPI、绩效评级与结算卡；
- P0 故障爆炸模式；
- 昵称占用、首发记录、悬赏和分析面板；
- FastAPI 本地后端与 EdgeOne Makers 线上后端。

## 本地开发：一条命令启动

普通成员本地开发不需要 EdgeOne 账号或平台项目权限。需要安装：

- Node.js 20 或更高版本；
- Docker Desktop，或带 Compose 插件的 Docker Engine。

首次启动：

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
cp .env.example .env
# 编辑 .env，把成员私发的 DeepSeek Key 填入 LLM_API_KEY
npm run dev
```

访问：

- 游戏：<http://127.0.0.1:8000/>
- 首发墙：<http://127.0.0.1:8000/wall>
- 健康检查：<http://127.0.0.1:8000/api/health>

停止服务：

```bash
npm run dev:down
```

`npm run dev` 会用 Docker Compose 启动 FastAPI 和 Redis，SQLite 写入被 Git
忽略的 `data/dev.db`。后端和前端源码会挂载进容器，Uvicorn 自动重载。

本地模型使用 DeepSeek OpenAI-compatible API：

```dotenv
LLM_API_KEY=成员私发的密钥
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
```

密钥只能写入 `.env`，不能提交到 Git。没有 Key 时服务仍可启动，预设配方和
缓存可用；生成未知配方时会使用既有 fallback。完整说明见
[开发与 Makers 发布指南](docs/makers-development.md)。

## 两套完全分离的运行环境

| 场景 | API 运行时 | 存储 | 模型 |
| --- | --- | --- | --- |
| 成员本地开发 | FastAPI | 本机 Redis + SQLite | DeepSeek API |
| `main` 线上发布 | Makers Edge Functions | `test → infinite_craft` KV | Makers Models |

本地数据与 Makers 线上数据不自动同步。本地合成、首发、昵称和 KPI 不会写入
线上 KV，线上玩家数据也不会被下载到成员电脑。

## Makers 生产发布

Makers 是当前唯一主动维护的线上平台。项目已经配置 Git 集成，PR 合并到
`main` 后会自动发布，并按 `edgeone.json` 执行：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Makers 控制台应保持：

1. KV 全局变量 `test` 绑定命名空间 `infinite_craft`；
2. 环境变量 `MAKERS_MODELS_KEY` 或 `AI_GATEWAY_API_KEY`；
3. 默认网关模型 `@makers/deepseek-v4-flash`；
4. 随机长字符串 `ADMIN_TOKEN`，用于保护 `/admin` 和分析接口；
5. `POST /api/combine` 的平台精准限频。

`test` 是整个 KV 命名空间的运行时对象，不是单条变量。代码通过
`test.get()`、`test.put()`、`test.delete()` 和 `test.list()` 自动管理业务
键，无需在控制台逐条创建记录。

线上 Edge Function 只读取 `test`。它不根据本地 `APP_ENV` 选择其他 KV；
如果有人误用 Makers Edge Function 的本机模式，请求会被拒绝并提示改用
`npm run dev`。

Makers KV 为最终一致存储：写入节点立即可读，其他边缘节点最长约 60 秒后
看到更新。因此跨地域的成就墙、排行、首发和昵称占用可能短暂滞后。KV 没有
事务或原子 `put-if-absent`，极端跨节点并发时唯一性为尽力保证。

固定元素和全部预设配方随构建发布。首发墙热区保留最近 500 条，深层历史
通过 `feed_*` key 分页；索引、KPI 和统计使用固定数量的小分片，避免热路径
全表扫描。

## 修改与验证

日常开发：

```bash
git pull --ff-only
npm run dev
```

提交或创建 PR 前：

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

安装了 EdgeOne CLI 的发布维护者还应运行：

```bash
npm run makers:build
```

该命令只验证 Makers 构建和 Edge Function 编译；普通本地启动不需要它，也
不需要 EdgeOne 登录。合并到 `main` 后，既有 Git 集成负责自动发布。

## 架构

```text
本地开发
浏览器 → FastAPI → Redis + SQLite
                  ↘ DeepSeek API（LLM_API_KEY）

线上生产
浏览器 → Makers 静态站点 + Edge Functions
                         ├→ test → infinite_craft KV
                         └→ Makers Models
```

## 目录结构

```text
infinite-craft-TC/
├── AGENTS.md                  Agent 快速开发说明
├── Dockerfile
├── docker-compose.yml         默认本地运行环境
├── edgeone.json               Makers 自动构建配置
├── package.json               本地启动、测试与构建命令
├── .env.example               本地 DeepSeek 安全模板
├── backend/                   FastAPI、Redis、SQLite 与 DeepSeek 逻辑
├── frontend/                  游戏、首发墙与管理页面
├── edge-functions/            Makers 线上 API、KV 和 Models 逻辑
├── scripts/                   Makers 数据生成与静态构建
├── tests/                     Python 测试
├── tests-makers/              Node/Makers 测试
├── docs/
│   └── makers-development.md  开发与发布完整指南
└── deploy/legacy/
    └── render.yaml            已暂停的 Render 历史配置
```

## 环境变量

### 本地 `.env`

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `dev` | 本地 SQLite 环境；Compose 会固定为 `dev` |
| `LLM_API_KEY` | 空 | 成员私发的 DeepSeek API Key |
| `LLM_BASE_URL` | `https://api.deepseek.com` | DeepSeek API 根地址 |
| `LLM_MODEL` | `deepseek-v4-flash` | DeepSeek 模型 |
| `LLM_TIMEOUT` | `20` | 单次请求超时秒数 |
| `LLM_MAX_RETRIES` | `0` | Provider 重试次数 |
| `REDIS_URL` | `redis://127.0.0.1:16739/1` | 手动启动 FastAPI 时的本机 Redis |

### Makers 控制台

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAKERS_MODELS_KEY` | 空 | Makers Models API Key |
| `AI_GATEWAY_API_KEY` | 空 | 可兼容的网关密钥 |
| `AI_GATEWAY_BASE_URL` | EdgeOne AI Gateway | Edge Function 模型网关 |
| `AI_GATEWAY_MODEL` | `@makers/deepseek-v4-flash` | Makers 模型标识 |
| `MODEL_CALLS_PER_MINUTE` | `20` | 每访客每分钟未知组合模型调用上限 |
| `ADMIN_TOKEN` | 空 | 管理与分析接口令牌；空值时接口关闭 |
| `DASHBOARD_PUBLIC` | `0` | 只有明确接受风险时才设为 `1` |

`/api/health` 只报告依赖和模型配置状态，不会调用模型或产生 Token 费用。

## 玩法说明

| 操作 | 效果 |
| --- | --- |
| 从侧栏拖到工作区 | 复制一个元素 |
| 将工作区元素拖到另一个元素 | 合成新元素 |
| 双击工作区元素 | 移除元素 |
| 点击“📊 结算本次分享” | 显示绩效评级 |
| 输入 `↑↑↓↓←→←→BA` | 切换老板黑话模式 |

KPI 按配方 chain 计分：

| chain | 分值 |
| --- | --- |
| `easter_egg` | +40 |
| `tencent` | +30 |
| `meme_2026w16` | +25 |
| `meme_classic` / `worker` | +20 |
| `bizspeak` | +15 |
| `abstract` / `life` | +8～10 |
| `classic` / `physical` | +5 |
| 全球首发 | 额外 +50 |

绩效等级：

- `< 500`：3-
- `500～1499`：3.25
- `1500～3499`：3.5
- `3500～7999`：3.75
- `≥ 8000`：瑞雪

## 扩展词库

所有固定词条在 `backend/seed_*.json`：

1. 向 `seed_elements.json` 的 `elements` 添加元素；
2. 向 `seed_combinations.json` 的 `combinations` 添加配方；
3. 必要时向 `backend/prompt.py::FEW_SHOT_EXAMPLES` 添加典型组合。

详见 [backend/README.md](backend/README.md)。

## 合成点评与发现状态

`POST /api/combine` 的响应包含模型点评：

```json
{
  "result": "需求膨胀",
  "emoji": "🎈",
  "comment": "一行需求开完会，变成季度项目。",
  "is_first": false
}
```

FastAPI 将点评随合成结果写入本机 Redis 和 SQLite，Makers 将其写入生产 KV。
相同组合命中缓存时复用原点评，不会再次调用模型。旧缓存或模型返回的点评
缺失、为空、含换行或超过 30 个字符时，API 仍返回有效元素并使用默认点评。

浏览器显示三种 Toast：

- `全球首发`：该结果第一次被任何玩家发现；
- `我的新发现`：全局已有，但当前玩家第一次发现；
- `再次合成`：当前玩家已经发现过该结果。

模型控制的名称、Emoji 和点评只通过 `textContent` 写入页面。SQLite 启动时
自动补齐历史数据库的 `comment` 列，旧 Redis Hash 和 Makers KV 记录保持
兼容。

## Render（暂停）

Render 当前完全不用，Makers 是唯一主动维护的线上部署目标。历史 Blueprint
位于 `deploy/legacy/render.yaml`，不再作为默认部署入口。仓库变更无法暂停
Render 控制台中已有服务，项目所有者仍需在 Render 控制台暂停旧服务或关闭
自动部署。
