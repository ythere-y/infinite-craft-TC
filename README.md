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

### 分享现场

- 主屏：浏览器打开 `http://<服务器>:8000`
- 投屏：另一块屏打开 `http://<服务器>:8000/wall`（首发墙）

---

## 架构

```
┌────────────── 浏览器 ──────────────┐
│  index.html + app.js / effects.js  │
│  HTML5 Drag & Drop + LocalStorage  │
└──────────────┬─────────────────────┘
               │ fetch POST /api/combine
┌──────────────▼─────────────────────┐
│  FastAPI (backend/)                 │
│  1. normalize key                   │
│  2. SQLite cache ──命中──→ 返回     │
│  3. seed_combinations ──命中──→ 返回 │
│  4. miss → 服务端配置的 LLM          │
│  5. 记首发 + KPI + SSE 推首发墙     │
└──────────────┬─────────────────────┘
               │ requests
┌──────────────▼─────────────────────┐
│  LLM API（仅由服务端环境变量配置）    │
└────────────────────────────────────┘
```

---

## 目录结构

```
infinity_craft/
├── run.sh                     本地一键启动
├── Dockerfile / docker-compose.yml
├── requirements.txt
├── backend/
│   ├── main.py                FastAPI 路由
│   ├── db.py                  SQLite（combinations / first_discovery / kpi_events）
│   ├── seed_loader.py         启动加载 seed 文件
│   ├── llm.py                 LLM 调用封装
│   ├── prompt.py              few-shot prompt 模板
│   ├── kpi.py                 评分 + 绩效评级
│   ├── seed_elements.json     140+ 元素（8 starter + 鹅厂/打工人/热梗/黑话/物理/生活/抽象）
│   ├── seed_combinations.json 140+ 合成规则
│   └── README.md              词库扩展指南
├── frontend/
│   ├── index.html / style.css / app.js
│   ├── effects.js             P0 爆炸 / 首发 toast / 老板模式
│   ├── wall/                  首发墙（分页 + 搜索 + 排行榜 + SSE）
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
- 1500-3000 → **3.5**（达标）
- 3000-5000 → **3.75**（优秀）
- \> 5000 → **4**（卓越，瑞雪 +1）

---

## 扩展词库 / 换新热梗

所有梗都在 `backend/seed_*.json`，**无需改代码**：
1. 加元素到 `seed_elements.json → elements`
2. 加合成规则到 `seed_combinations.json → combinations`
3. （可选）把典型组合加进 `backend/prompt.py::FEW_SHOT_EXAMPLES`，让模型学会倾向

详见 `backend/README.md` 的“增量扩词规则”。

---

## 环境变量

| 变量              | 默认               | 说明                                |
| ----------------- | ------------------ | ----------------------------------- |
| `GLM_API_URL`     | 无                 | LLM 服务端地址，只能通过环境变量注入 |
| `GLM_TIMEOUT`     | `10`               | 秒                                  |
| `GLM_MAX_RETRIES` | `2`                | 仅对 5xx / 网络错误重试             |
| `HOST` / `PORT`   | `0.0.0.0` / `8000` | `run.sh` 监听                       |

Docker Compose 用户可复制 `.env.example` 为 `.env` 后填写本地配置；其他运行方式请通过 shell 或部署平台注入。`.env` 和所有私有配置均不会进入 Git。

---

Made with ☕ and 🌚 at 2026-04-22.

「鹅厂的神奇宝贝们走丢了，你能帮忙把它们合成回来吗？」
