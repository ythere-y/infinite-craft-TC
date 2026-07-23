# EdgeOne Makers 迁移实施计划

> 本计划在当前 `main` 分支原地执行。完成所有验证后一次性推送，由仓库现有自动发布触发 Makers 部署。

**目标：** 在不移除 FastAPI/Docker 版本的前提下，为 Infinity Craft 增加可直接部署到 EdgeOne Makers 的静态构建、Edge Functions API、KV 持久化和 Makers Models 调用。

**运行时：** 静态 `dist/` + JavaScript Edge Functions（Web API）+ 全局 KV 绑定 `test`。

## 任务 1：建立可重复的 Makers 构建

**文件：**

- 新增 `package.json`
- 新增 `edgeone.json`
- 新增 `scripts/build-makers.mjs`
- 新增 `tests-makers/build.test.mjs`

**步骤：**

1. 先写测试，要求构建产出 `dist/index.html`、`dist/app.js`、`dist/wall/index.html` 和 `dist/admin/index.html`。
2. 运行测试并确认因构建脚本不存在而失败。
3. 实现只依赖 Node 标准库的清理、复制和入口校验。
4. 配置 `edgeone.json` 的 `buildCommand` 和 `outputDirectory`。
5. 再运行构建测试并确认通过。

## 任务 2：生成 Makers 可读的种子数据

**文件：**

- 新增 `scripts/generate-makers-data.mjs`
- 生成 `edge-functions/_generated/seed-data.js`
- 新增 `tests-makers/seed-data.test.mjs`

**步骤：**

1. 测试固定组合可按无序输入命中、starter 数量与 JSON 源一致、元素完整保留。
2. 确认测试因生成模块不存在而失败。
3. 实现生成器：读取两个现有 JSON，规范化组合键，计算静态深度表和反向配方索引。
4. 将生成器挂入 `npm run build`，并提交生成文件，使 Git 自动发布无需额外 Python 环境。
5. 验证生成结果稳定，连续两次生成没有 diff。

## 任务 3：实现 KV 仓储层

**文件：**

- 新增 `edge-functions/_lib/keys.js`
- 新增 `edge-functions/_lib/kv-store.js`
- 新增 `tests-makers/fake-kv.mjs`
- 新增 `tests-makers/kv-store.test.mjs`

**步骤：**

1. 测试中文组合输入生成合法且顺序无关的 key。
2. 测试 `put` 可创建动态组合、昵称、首发、会话和快照记录。
3. 测试缺失 key 返回 `null`，JSON 类型读取和列表游标兼容 Makers KV。
4. 确认红灯后实现 Web Crypto SHA-256 key 和仓储方法。
5. 为快照设置数量上限，避免单 value 无界增长。

## 任务 4：迁移纯业务逻辑

**文件：**

- 新增 `edge-functions/_lib/kpi.js`
- 新增 `edge-functions/_lib/nickname.js`
- 新增 `edge-functions/_lib/bounty.js`
- 新增 `edge-functions/_lib/http.js`
- 新增 `tests-makers/domain.test.mjs`

**步骤：**

1. 用现有 Python 行为作为契约，先覆盖绩效边界、爆炸条件、昵称格式、悬赏结构和 JSON 错误响应。
2. 确认测试失败。
3. 移植 KPI/段位、昵称词池和悬赏配置。
4. 业务函数保持无 Node 依赖、可注入随机数和时间，便于确定性测试。
5. 确认测试通过。

## 任务 5：实现 LLM 与合成服务

**文件：**

- 新增 `edge-functions/_lib/llm.js`
- 新增 `edge-functions/_lib/game-service.js`
- 新增 `tests-makers/game-service.test.mjs`

**步骤：**

1. 测试查找顺序为 KV → seed → LLM → fallback。
2. 测试模型密钥缺失、模型非 2xx、非法 JSON 和超时均安全降级。
3. 测试成功合成会写入动态组合、首发、元素、会话、统计和墙快照。
4. 确认测试失败。
5. 使用原有中文提示词核心规则调用 OpenAI-compatible `/chat/completions`。
6. 从 `AI_GATEWAY_API_KEY` / `MAKERS_MODELS_KEY` / `LLM_API_KEY` 读取密钥，并允许 base URL、模型和超时覆盖。
7. 实现合成和尽力唯一首发流程，返回与 FastAPI `CombineResp` 相同字段。

## 任务 6：实现全部兼容 API

**文件：**

- 新增 `edge-functions/_lib/router.js`
- 新增 `edge-functions/api/[[default]].js`
- 新增 `tests-makers/router.test.mjs`

**步骤：**

1. 为现有前端使用的全部端点写路由契约测试。
2. 确认测试因路由不存在而失败。
3. 实现静态数据、健康检查、昵称、合成、KPI、段位、配方校验、墙分页、排行榜、悬赏、元素配方、统计和分析端点。
4. 对 query/body 做上限与类型校验；所有错误返回 JSON。
5. catch-all 入口把 Makers 的 `request`、`params`、`env` 和全局 `test` 注入路由。
6. 验证未知路径返回 404，OPTIONS 返回兼容 CORS 响应。

## 任务 7：把成就墙实时更新改为边缘友好的轮询

**文件：**

- 修改 `frontend/wall/wall.js`
- 新增 `tests-makers/frontend.test.mjs`

**步骤：**

1. 测试前端不再创建 `EventSource`，且会轮询增量墙数据。
2. 确认测试失败。
3. 用 `/api/wall/page?offset=0` 定时查询最新记录，以 result 去重后插入顶部。
4. 新首发触发排行榜与悬赏刷新；页面隐藏时不轮询，恢复可见时立即刷新。
5. 保留 `/api/wall/stream` 的兼容说明响应，避免旧客户端无限重连。

## 任务 8：补充部署文档和环境变量

**文件：**

- 修改 `.env.example`
- 修改 `README.md`

**步骤：**

1. 记录 Makers 自动发布所用构建配置、KV 绑定名 `test` 和模型环境变量。
2. 明确业务 key 由代码自动创建，不需要在控制台逐条创建。
3. 说明 KV 最终一致性和首发/昵称极端并发限制。
4. 保留原本地与 Docker 使用说明。

## 任务 9：验证、审查、提交和推送

**步骤：**

1. 运行 `npm test`。
2. 运行 `npm run build`，检查 `dist/` 入口和大小。
3. 连续运行两次数据生成，确认工作树稳定。
4. 运行 `python3 -m pytest tests -q`。
5. 搜索 Edge Runtime 禁用项：Node 内置模块、`Response.json`、错误的 `context.env.test` 和非法 KV key。
6. 检查 `git diff --check`、完整 diff 与状态，确认未包含 `.env`、数据库或用户的 `CLAUDE.md`。
7. 提交 Makers 实现。
8. 推送 `main` 到 `origin`，确认远端接受提交；自动发布状态由用户在 Makers 控制台查看。
