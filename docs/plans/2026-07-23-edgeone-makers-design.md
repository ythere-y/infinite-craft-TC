# Infinity Craft → EdgeOne Makers 迁移设计

日期：2026-07-23

## 目标与约束

- 保留现有主游戏、合成、首发、KPI、昵称、排行、成就墙、配方查询、管理统计和分析接口。
- 直接从 `main` 发布，沿用仓库已配置的 Makers 自动发布。
- 浏览器端继续使用相对路径 `/api/...`，无需配置独立后端域名。
- 使用已经绑定到项目、运行时变量名为 `test` 的 KV 命名空间。
- 保留原 FastAPI/Docker 实现，作为本地和传统服务器部署方式；新增 Makers 实现不破坏原路径。

## 总体架构

```text
frontend/ ──build──> dist/（静态站点）
                         │
浏览器 ──────────────────┼── /api/* ──> edge-functions/api/[[default]].js
                         │                         │
                         │                         ├── 全局绑定 test（KV）
                         │                         └── Makers Models / OpenAI-compatible API
                         └── /wall（静态成就墙）
```

仓库新增无依赖 Node 构建脚本，将 `frontend/` 复制到 `dist/`。`edgeone.json` 告诉 Makers 执行构建并发布 `dist/`。Edge Functions 仍放在项目根目录的 `edge-functions/`，由 Makers 单独识别和部署。

## Edge Function 设计

一个 catch-all API 入口接收 `/api/*` 请求，薄路由层把请求交给可测试的纯 JavaScript 模块。实现只依赖 Web 标准 API，避免 Node 内置模块和第三方包，符合 V8 Edge Runtime。

所有 JSON 响应显式使用：

```js
new Response(JSON.stringify(data), {
  status: 200,
  headers: { "content-type": "application/json; charset=utf-8" },
});
```

KV 绑定通过全局变量 `test` 传入应用。`test` 是命名空间绑定名，不是一条数据；业务代码可直接调用 `test.put(key, value)` 创建任意键值对，无需先在控制台逐条建记录。

## KV 数据模型

KV key 仅允许数字、字母和下划线，因此用户输入不直接进入 key。组合键使用稳定 SHA-256 十六进制摘要。

| Key | Value | 用途 |
| --- | --- | --- |
| `combo_<hash>` | 单个组合 JSON | 动态组合缓存 |
| `first_<hash>` | 首发记录 JSON | 元素首次发现者 |
| `element_<hash>` | 单个元素 JSON | 动态元素元数据 |
| `recipe_<result_hash>_<pair_hash>` | 单条配方 JSON | 动态反向配方索引 |
| `nick_<hash>` | 昵称占用记录 JSON | 昵称唯一性检查 |
| `kpi_<session_hash>_<shard>` | KPI 分片计数 JSON | 有界的会话总分 |
| `session_<hash>` | 会话汇总 JSON | KPI 快速读取缓存 |
| `index_first_<shard>` | 首发索引分片 | 排行榜、悬赏和索引修复 |
| `index_element_<shard>` | 元素索引分片 | 动态元素列表和索引修复 |
| `feed_<time>_<hash>` | 单条有序首发 JSON | 500 条以后的深层分页 |
| `snapshot_recent` | 最多 500 条记录 | 首发墙热区缓存 |
| `stats_<shard>` | 近似统计分片 | 管理页和概览 |

基础元素和固定组合不写入 KV，而是在构建时从现有 `backend/seed_*.json` 生成只读 JavaScript 数据模块。这样首次发布即可工作，不消耗大量 KV 写入，也避免冷启动初始化竞争。

动态数据采用“一条业务记录一个 key”。列表索引按哈希首位拆为 16 个分片，
KPI 拆为最多 32 个分片；每个索引分片最多 2,000 条，首发热区固定为 500
条。即使按 Makers 更严格的 1 MB 单 value 限制设计，也留有充足余量。索引
以轮转方式每次只对账一个分片，热路径不会扫描所有 canonical key。管理统计
同样拆为 16 片，并明确作为近似遥测。写入后当前节点可立即读到，其他节点
最长约 60 秒后一致；成就墙和排行榜允许这一传播延迟。

KV 不提供事务、原子自增或 `put-if-absent`。昵称和首发采用“读取 → 写入 → 再读取确认”的尽力唯一策略；极端跨边缘并发下仍可能短暂冲突。这不会阻断合成，最终记录以 KV 中结果为准。

## 功能兼容

- 合成优先级：固定组合 → KV 动态缓存 → Makers Models 生成；固定词库是
  权威数据，不能被同名 KV 记录覆盖。
- LLM 从 `AI_GATEWAY_API_KEY`、`MAKERS_MODELS_KEY`、`LLM_API_KEY` 中依次读取密钥；网关和模型也支持环境变量覆盖。
- 只有固定组合和动态缓存都未命中时才消耗模型额度；代码按
  `client IP + session_id` 使用固定 KV key 做每分钟限频，默认 20 次，
  控制台精准限频作为第二层防护。
- 首发、KPI、昵称、排行榜、管理统计和分析接口保持现有响应结构。
- 完整 THUOCL 过滤昵称池作为生成模块随 Edge Function 发布，不依赖构建
  环境中被忽略的 `words/` 目录。
- Edge Runtime 不适合长连接广播，`/api/wall/stream` 保留兼容响应，但墙页面改为短间隔增量轮询；用户体验仍为近实时更新。
- 种子数据中的全部元素与组合保留。

## 构建、测试与发布

- `npm test`：使用 Node 内置测试运行器验证 key 生成、KV 仓储、主要 API 和响应结构。
- `npm run build`：清理并重建 `dist/`，同时校验必须的静态入口存在。
- Python 既有测试继续运行，确保传统后端没有回归。
- 提交前检查工作树，只精确暂存本次文件，不触碰用户的 `CLAUDE.md`。
- 推送 `main` 后由已配置的 Makers Git 集成自动发布。

## 发布后控制台要求

发布前后只需确认：

1. 项目 KV 绑定仍为“变量名称 `test` → 命名空间 `infinite_craft`”。
2. 项目环境变量至少有一种模型密钥；推荐 `AI_GATEWAY_API_KEY` 或 `MAKERS_MODELS_KEY`。
3. 设置 `ADMIN_TOKEN` 保护管理与分析接口；未设置时默认关闭，只有显式
   `DASHBOARD_PUBLIC=1` 才公开。
4. 推荐为 `POST /api/combine` 配置 Makers 精准限频，防止模型额度滥用。
5. 如未配置模型密钥，固定组合仍能正常玩，未命中的新组合会安全降级。

不需要在 KV 控制台手动创建业务 key；首次玩家操作会由 Edge Function 自动写入。
