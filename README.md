# 🐧 Infinity Craft · 鹅厂打工人版

以 [neal.fun/infinite-craft](https://neal.fun/infinite-craft/) 为蓝本的像素级复刻，**把合成词库换成鹅厂打工人文化 + 最新社交平台热梗 + 互联网黑话**。

专为**腾讯内部分享现场**设计：
- 🎯 大屏投屏首发墙
- 📊 打工人共鸣指数 / 绩效 3.5-4 评级
- 🚨 P0 故障爆炸模式（"删库 + 周五" 红屏震动）
- 👔 Konami Code 切换老板黑话视角

---

## 快速开始

### 方式 1：本地一键（开发调试推荐）

```bash
./run.sh
```

首次运行会自动建 `.venv` 装依赖。打开 `http://localhost:8000` 即可玩。

### 方式 2：Docker

```bash
docker compose up -d
```

然后同样访问 `http://localhost:8000`。SQLite 数据通过 `./data` 卷持久化。

### 方式 3：EdgeOne Makers

仓库已经包含 Makers 所需的静态构建、Edge Functions API 和 KV
持久化实现。Git 集成发布时，Makers 会按照 `edgeone.json` 执行
`npm run build`，并发布 `dist/`。

控制台只需确认：

1. 在项目的“存储 → KV”中，将命名空间 `infinite_craft` 绑定为变量名
   `test`。
2. 在项目环境变量中配置 `AI_GATEWAY_API_KEY`（推荐）或
   `MAKERS_MODELS_KEY`；模型默认是 `@makers/deepseek-v4-flash`。
3. 推送 `main`，等待已配置的 Git 自动发布完成。

`test` 是 Edge Function 访问整个命名空间的绑定名，不是单条数据，也
不需要写进 `.env`。合成、首发、昵称、KPI、排行榜和统计所需的业务 key
都会由代码通过 `test.put(...)` 自动创建；无需在控制台逐条新建记录。

本地检查 Makers 产物：

```bash
npm test
npm run build
```

Makers KV 是最终一致存储：发起写入的节点立即可读，其他边缘节点最多约
60 秒后看到更新。因此跨地域的成就墙、排行、首发和昵称占用可能短暂滞后；
KV 没有事务或原子 `put-if-absent`，极端跨节点并发时唯一性是尽力保证。

现有 FastAPI 的本地 SQLite/Redis 运行数据位于被 Git 忽略的 `data/`，
不会随代码发布到 Makers；固定元素和全部预设配方会随构建发布，Makers
上线后的新玩家数据则写入 KV。

### 分享现场

- 主屏：浏览器打开 `http://<服务器>:8000`
- 投屏：另一块屏打开 `http://<服务器>:8000/wall`（首发墙）

---

## 架构

```
┌────────────── 浏览器 ──────────────┐
│  index.html + app.js / effects.js  │
│  HTML5 Drag & Drop + LocalStorage  │
└──────────────┬──────────────────────┘
               │ 相对路径 /api/*
       ┌───────┴────────────────┐
       │                        │
┌──────▼──────────────┐  ┌──────▼─────────────────┐
│ Makers Edge Function│  │ FastAPI（本地/Docker）  │
│ KV(test) + Models   │  │ Redis + SQLite + LLM   │
└─────────────────────┘  └────────────────────────┘
```

---

## 目录结构

```
infinity_craft/
├── run.sh                     本地一键启动
├── Dockerfile / docker-compose.yml
├── requirements.txt
├── edgeone.json               Makers 构建配置
├── package.json               Makers 构建/测试命令（无第三方依赖）
├── edge-functions/
│   ├── api/[[default]].js     /api/* catch-all Edge Function
│   ├── _lib/                  KV、路由、合成、模型和业务逻辑
│   └── _generated/            从现有 seed JSON 生成的只读数据
├── scripts/
│   ├── build-makers.mjs       生成 dist/ 静态发布目录
│   └── generate-makers-data.mjs
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

| 变量                | 默认               | 说明                                      |
| ------------------- | ------------------ | ----------------------------------------- |
| `AI_GATEWAY_API_KEY`| 无                 | Makers Edge Function 推荐的模型密钥       |
| `MAKERS_MODELS_KEY` | 无                 | EdgeOne Makers 兼容密钥                   |
| `LLM_API_KEY`       | 无                 | 通用 Provider 密钥                        |
| `AI_GATEWAY_BASE_URL`| EdgeOne AI Gateway | Makers Edge Function 的网关地址          |
| `AI_GATEWAY_MODEL`  | DeepSeek V4 Flash  | Makers Edge Function 的模型标识           |
| `LLM_BASE_URL`      | 无                 | OpenAI-compatible API 根地址              |
| `LLM_MODEL`         | 无                 | Provider 模型标识                         |
| `LLM_TIMEOUT`       | `15`               | 单次请求超时（秒）                        |
| `LLM_MAX_RETRIES`   | `2`                | SDK 瞬时错误重试次数                      |
| `HOST` / `PORT`     | `0.0.0.0` / `8000` | `run.sh` 监听                             |

EdgeOne Makers 项目推荐在控制台填写 `AI_GATEWAY_API_KEY`；代码也兼容
`MAKERS_MODELS_KEY`。本地 FastAPI 可继续使用 `LLM_API_KEY`，切换其他
OpenAI-compatible Provider 时配置对应的 `LLM_BASE_URL` 和 `LLM_MODEL`
即可，不需要修改源码。

Docker Compose 用户可复制 `.env.example` 为 `.env` 后填写本地配置；其他运行方式可通过 `.env`、shell 或部署平台注入。`.env` 和所有私有配置均不会进入 Git。EdgeOne 部署时应在项目环境变量设置中录入真实密钥。

`/api/health` 只报告 LLM 是否已配置，不会发起模型请求或消耗 Token；真实连通性应在部署后单独做一次小请求验证。

---

Made with ☕ and 🌚 at 2026-04-22.

「鹅厂的神奇宝贝们走丢了，你能帮忙把它们合成回来吗？」
