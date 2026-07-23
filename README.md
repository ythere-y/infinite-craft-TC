# 🐧 Infinity Craft · 鹅厂打工人版

以 [neal.fun/infinite-craft](https://neal.fun/infinite-craft/) 为蓝本的像素级复刻，**把合成词库换成鹅厂打工人文化 + 最新社交平台热梗 + 互联网黑话**。

专为**腾讯内部分享现场**设计：
- 🎯 大屏投屏首发墙
- 📊 打工人共鸣指数 / 绩效 3.5-4 评级
- 🚨 P0 故障爆炸模式（"删库 + 周五" 红屏震动）
- 👔 Konami Code 切换老板黑话视角

---

## 默认工作流：EdgeOne Makers

仓库的生产发布和团队本地开发均以 EdgeOne Makers 为准。Makers 负责静态
页面、`/api/*` Edge Functions、Makers Models 和 KV，不需要成员安装 Redis
或运行 SQLite。

### 新成员首次启动

成员需要先获得现有 Makers 项目的访问权限，然后执行：

```bash
git clone git@github.com:ythere-y/infinite-craft-TC.git
cd infinite-craft-TC
npm install
npm install -g edgeone
edgeone login --site china
edgeone makers link
npm run makers:dev
```

`edgeone makers link` 中请选择团队现有项目，不要新建同名项目。CLI 会在本机
生成被 Git 忽略的 `.edgeone/project.json` 和 `.env`。仓库提供的
`npm run makers:dev` 会把本机 `.env` 的 `APP_ENV` 固定为 `dev`，再启动
官方 Makers 开发服务器。打开 CLI 输出的 HTTP 地址，默认通常为
`http://127.0.0.1:8088/`。

项目使用两套隔离的 KV：

| 环境 | 运行时变量 | 命名空间 |
| --- | --- | --- |
| 本地开发（`APP_ENV=dev`） | `test_dev` | `infinite_craft_dev` |
| `main` 生产发布 | `test` | `infinite_craft` |

本地配置缺失时会直接报错，不会回退写入生产 KV。不要在共享的 Makers 控制台
环境变量中设置 `APP_ENV=dev`，因为该配置会应用到后续所有部署。完整的成员
安装、日常开发、验证和排障步骤见
[Makers 团队开发指南](docs/makers-development.md)。

### 生产控制台配置

1. KV 绑定保持为 `test → infinite_craft` 和
   `test_dev → infinite_craft_dev`。
2. 项目环境变量配置 `MAKERS_MODELS_KEY` 或
   `AI_GATEWAY_API_KEY`；默认模型为 `@makers/deepseek-v4-flash`。
3. 配置随机长字符串 `ADMIN_TOKEN` 保护 `/admin` 与分析接口。未配置时管理
   接口默认关闭；只有明确接受公开风险时才设置 `DASHBOARD_PUBLIC=1`。
4. 在 Makers 安全防护中给 `POST /api/combine` 配置精准限频。代码内部还会
   对真正命中模型的新组合按访客执行每分钟 20 次的默认限频。
5. 推送 `main`，等待已配置的 Makers Git 自动发布完成。

`test` 和 `test_dev` 都是访问整个命名空间的全局绑定，不是单条数据，也不
需要作为环境变量填写。合成、首发、昵称、KPI、排行榜和统计所需的业务 key
会由代码通过选中的 KV 绑定自动创建，无需在控制台逐条新建。

本地和提交前验证：

```bash
npm test
npm run build
npm run makers:build
```

Makers KV 是最终一致存储：发起写入的节点立即可读，其他边缘节点最多约
60 秒后看到更新。因此跨地域的成就墙、排行、首发和昵称占用可能短暂滞后；
KV 没有事务或原子 `put-if-absent`，极端跨节点并发时唯一性是尽力保证。
首发墙热区保留最近 500 条，深层历史通过 `feed_*` key 分页；索引、KPI 和
统计使用固定数量的小分片，避免热路径全表扫描。

固定元素和全部预设配方随构建发布；生产玩家数据写入 `infinite_craft`，
本地 Makers 调试数据写入 `infinite_craft_dev`。旧 FastAPI 的 Redis 和
SQLite 数据与 Makers KV 相互独立，不会自动同步。

昵称使用随 Edge Function 打包的 THUOCL 过滤词库（7,831 个成语、4,350
个状态词），不会因 Makers 构建环境没有本地 `words/` 目录而退化。

### Legacy FastAPI / Docker 本地备用

旧后端保留用于离线分析、Python 测试或传统服务器应急运行，不是当前默认
开发路径：

```bash
./run.sh
# 或
docker compose up -d
```

访问 `http://localhost:8000`；SQLite 和 Redis 数据保存在被 Git 忽略的
`data/`。该链路不会读取或更新 Makers KV。

---

## 架构

```
┌────────────── 浏览器 ──────────────┐
│  index.html + app.js / effects.js  │
│  HTML5 Drag & Drop + LocalStorage  │
└──────────────┬──────────────────────┘
               │ 相对路径 /api/*
       ┌───────▼────────────────────────────┐
       │ Makers Edge Functions             │
       │ Makers Models                     │
       │ prod: test / local: test_dev (KV) │
       └────────────────────────────────────┘

Legacy 备用：FastAPI → Redis + SQLite + OpenAI-compatible Provider
```

---

## 目录结构

```
infinity_craft/
├── run.sh                     Legacy FastAPI 本地启动
├── Dockerfile / docker-compose.yml（Legacy）
├── requirements.txt
├── edgeone.json               Makers 构建配置
├── package.json               Makers 开发/构建/测试命令（无第三方依赖）
├── edge-functions/
│   ├── api/[[default]].js     /api/* catch-all Edge Function
│   ├── _lib/                  环境隔离、KV、路由、合成和模型逻辑
│   └── _generated/            从现有 seed JSON 生成的只读数据
├── scripts/
│   ├── dev-makers.mjs         安全启动 Makers 本地开发
│   ├── build-makers.mjs       生成 dist/ 静态发布目录
│   ├── generate-makers-data.mjs
│   └── generate-makers-nickname-data.mjs
├── docs/
│   └── makers-development.md  团队本地开发与排障
├── deploy/legacy/
│   └── render.yaml            已暂停的 Render 历史配置
├── backend/
│   ├── main.py                FastAPI 路由
│   ├── db.py                  SQLite（combinations / first_discovery / kpi_events）
│   ├── seed_loader.py         启动加载 seed 文件
│   ├── llm.py                 LLM 调用封装
│   ├── prompt.py              few-shot prompt 模板
│   ├── kpi.py                 评分 + 绩效评级
│   ├── seed_elements.json     元素与 starter 真相源
│   ├── seed_combinations.json 预设合成规则真相源
│   └── README.md              词库扩展指南
├── frontend/
│   ├── index.html / style.css / app.js
│   ├── combine-feedback.js    合成点评与三态反馈的安全 DOM 渲染
│   ├── effects.js             P0 爆炸 / 首发 toast / 老板模式
│   ├── wall/                  首发墙（分页 + 搜索 + 排行榜 + 增量轮询）
│   │   ├── index.html / wall.css / wall.js
└── data/
    └── cache.db               运行时自动生成
```

---

## 玩法说明

| 操作                     | 效果                              |
| ------------------------ | --------------------------------- |
| 侧栏 → 工作区 拖拽       | 复制一份元素到工作区              |
| 工作区内拖一个到另一个上 | 合成 → 新元素（KPI +N，首发 +50） |
| 工作区双击元素           | 移除                              |
| 顶栏"📊 结算本次分享"     | 根据累计 KPI 弹绩效评级卡片       |
| `↑↑↓↓←→←→BA`             | 切换 / 关闭老板黑话模式           |

### KPI 评分规则（按 chain）

| 链                                       | 分值  |
| ---------------------------------------- | ----- |
| `easter_egg`（P0 / 删库跑路 / 全员告警） | +40   |
| `tencent`（鹅厂文化）                    | +30   |
| `meme_2026w16`（当周热梗）               | +25   |
| `meme_classic` / `worker`                | +20   |
| `bizspeak`（黑话）                       | +15   |
| `abstract` / `life`                      | +8~10 |
| `classic` / `physical`                   | +5    |
| 首发额外加分                             | +50   |

### 绩效评级

- < 500 → **3-**（待改进）
- 500-1500 → **3.25**（勉强合格）
- 1500-3500 → **3.5**（达标）
- 3500-8000 → **3.75**（优秀）
- ≥ 8000 → **瑞雪**（进入星/月/日/冠进阶）

---

## 扩展词库 / 换新热梗

所有梗都在 `backend/seed_*.json`，**无需改代码**：
1. 加元素到 `seed_elements.json → elements`
2. 加合成规则到 `seed_combinations.json → combinations`
3. （可选）把典型组合加进 `backend/prompt.py::FEW_SHOT_EXAMPLES`，让模型学会倾向

详见 `backend/README.md` 的“增量扩词规则”。

---

## 环境变量

| 变量                        | 默认                         | 说明                                      |
| --------------------------- | ---------------------------- | ----------------------------------------- |
| `APP_ENV`                   | 线上 `makers`                | 本机启动器设为 `dev` 以选择 `test_dev`    |
| `MAKERS_MODELS_KEY`         | 无                           | Makers Models API Key                     |
| `AI_GATEWAY_API_KEY`        | 无                           | 兼容的 Makers/自定义网关密钥              |
| `AI_GATEWAY_BASE_URL`       | EdgeOne AI Gateway           | Makers Edge Function 的网关地址           |
| `AI_GATEWAY_MODEL`          | `@makers/deepseek-v4-flash`  | Makers Edge Function 的模型标识           |
| `LLM_TIMEOUT`               | `20`                         | 单次请求超时（秒）                        |
| `MODEL_CALLS_PER_MINUTE`    | `20`                         | 每访客每分钟的新组合模型调用上限          |
| `ADMIN_TOKEN`               | 无                           | 管理与分析接口令牌；未设置时默认关闭      |
| `DASHBOARD_PUBLIC`          | `0`                          | 设为 `1` 才允许无令牌访问管理统计         |
| `LLM_API_KEY`               | 无                           | Legacy FastAPI 的通用 Provider 密钥       |
| `LLM_BASE_URL`              | `https://api.deepseek.com`   | Legacy FastAPI Provider 根地址            |
| `LLM_MODEL`                 | `deepseek-v4-flash`          | Legacy FastAPI 模型标识                   |
| `HOST` / `PORT`             | `0.0.0.0` / `8000`           | Legacy `run.sh` 监听                      |

当前项目在 Makers 控制台填写 `MAKERS_MODELS_KEY` 即可；代码也兼容
`AI_GATEWAY_API_KEY`。不要在控制台设置 `APP_ENV=dev`。成员执行
`edgeone makers link` 后，CLI 会把环境变量同步到被 Git 忽略的本机 `.env`，
启动器只在该本机文件中设置开发环境。

Legacy Docker Compose 用户仍可参考 `.env.example` 下半部分填写 Redis 和
FastAPI Provider。`.env` 和所有私有配置均不会进入 Git。

`/api/health` 只报告 KV、LLM 和安全开关状态，不会发起模型请求或消耗
Token；真实模型连通性应在部署后单独做一次小请求验证。

### 合成诊断日志

每次 `/api/combine` 都会生成一个 `request_id`，并在标准输出中记录缓存查询、LLM 调用和请求完成等阶段。排查卡顿时按同一 `request_id` 串联以下事件：

- `cache_hit` / `cache_miss`：是否进入 LLM 路径
- `llm_started` / `llm_succeeded` / `llm_no_result`：模型阶段及耗时
- `request_started` / `request_succeeded` / `request_failed`：Provider 请求耗时、字符数、Token 数和安全的异常类型
- `request_completed`：整个合成请求的总耗时与最终来源

日志不会记录 API key、完整 Prompt、Provider 响应正文或异常正文。Docker 部署可用 `docker compose logs -f web` 跟踪；本地运行时直接查看 Uvicorn 终端输出。

---

Made with ☕ and 🌚 at 2026-04-22.

「鹅厂的神奇宝贝们走丢了，你能帮忙把它们合成回来吗？」

---

## Render（暂停的历史备用）

Render 当前完全暂停使用，Makers 是唯一主动维护的线上部署目标。历史
Blueprint 已从仓库根目录移至 `deploy/legacy/render.yaml`，避免它继续表现为
默认部署入口；恢复前必须重新审查套餐、数据持久性和密钥配置。

仓库变更无法停止 Render 控制台中已经存在的服务。项目所有者还需在 Render
控制台手动暂停旧服务或关闭自动部署，避免 `main` 的提交继续触发 Render。

## 合成点评与发现状态

成功调用 `POST /api/combine` 后，响应除合成结果外还包含一条模型点评：

```json
{
  "result": "需求膨胀",
  "emoji": "🎈",
  "comment": "一行需求开完会，变成季度项目。",
  "is_first": false
}
```

FastAPI 版会将点评随合成结果写入 Redis 和 SQLite，Makers 版则写入已绑定
的 KV。相同组合命中缓存时直接复用原点评，不会再次调用模型。旧缓存或模型
返回缺失、为空、含换行、超过 30 个字符的点评时，接口仍返回有效元素，并
使用默认点评降级。

浏览器根据服务端首发状态和玩家更新前的本地发现记录显示三种 Toast：

- `全球首发`：该结果第一次被任何玩家发现。
- `我的新发现`：全局已有，但当前玩家第一次发现。
- `再次合成`：当前玩家已经发现过该结果。

Toast 使用单实例替换显示；模型控制的名称、Emoji 和点评只通过 `textContent` 写入页面。在窄屏设备上点评会自动换行，并避开安全区域。

启动时 SQLite 会自动检查并添加 `comment` 列；已有数据库无需手动迁移。
旧 Redis Hash 和旧 Makers KV 组合记录也保持兼容，缺失点评时由 API 边界
统一降级。
