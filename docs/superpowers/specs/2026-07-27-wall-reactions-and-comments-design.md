# 首发墙评论与赞踩设计

## 目标

在首发墙的每张元素卡片中展示该元素首次合成时生成的自然语言点评，并提供
点赞、点踩两个互斥操作。项目复用公式广场现有的签名匿名玩家 Cookie，不引入
登录系统：同一匿名玩家对同一元素只能提交一次评价，提交后不能修改。

本设计同时覆盖 Makers 生产运行时与 FastAPI 本地开发运行时，保持两个环境的
接口和页面行为一致。

## 范围

本次包含：

- 首发卡片展示合成结果原有的 `comment`；
- 每张卡片展示点赞数和点踩数；
- 匿名浏览器账号对每个元素只能选择一次点赞或点踩；
- 服务端执行重复投票检查，浏览器本地状态只用于交互恢复；
- 新首发完整保存点评，旧首发以统一默认点评兼容；
- `/admin` 展示赞踩汇总及最受欢迎、争议最高元素榜单；
- Makers KV、FastAPI Redis/SQLite、API、前端与自动化测试同步更新。

本次不包含：

- 用户自行撰写、回复或删除自由文本评论；
- 点赞/点踩后改票或撤票；
- 跨浏览器、跨设备同步匿名账号；
- OAuth、手机号、企业账号等真实登录；
- 面向恶意刷票的强身份认证或风控系统。

## 已确认的产品规则

1. 现有签名 HttpOnly `craft_player` Cookie 是匿名账号标识。Makers 使用
   `playerIdentity()`，FastAPI 使用 `community_player()`；首发墙与公式广场
   共享同一匿名身份。
2. 限投维度是“匿名账号 + 元素”，不是“匿名账号全站只能投一次”。
3. 点赞和点踩互斥；第一次成功提交后两个按钮都进入已投状态，不能修改。
4. 服务端是限投真相源。`localStorage` 仅保存当前浏览器已投结果，用于页面
   重开后立即恢复按钮状态。
5. 清除 `craft_player` Cookie 或更换设备会产生新的匿名账号；这是本次简单
   方案明确接受的边界。
6. 投票数字是非负整数。旧元素默认 `upvotes=0`、`downvotes=0`。
7. 点评使用第一次成功创造该元素时的合成点评；后续命中同一组合不会覆盖它。
8. 公式广场现有投票是“公式版本级”，保留赞成、反对、取消和切换；首发墙新增
   投票是“元素级”，保持一次性不可修改。两者共享匿名身份但不混用计数。

## 现状与根因

合成服务已经生成、校验并缓存 `comment`，主页合成反馈也能展示它。但是首次
发现记录目前只保存 `result`、`emoji`、`discoverer`、`ts` 和 `seq`，调用
`recordFirst()` 时没有传入 `comment`。首发墙分页 API 因而无法把合成点评
传给卡片。

最新 `main` 已有公式广场的公式版本级投票、签名匿名 Cookie 和治理后台，但首发
记录与首发墙没有元素级赞踩 API、计数或卡片交互。公式版本与元素不是同一聚合
维度，而且现有公式投票允许取消和切换，不满足本次“每个元素只能评价一次”的
规则。因此本次复用其匿名身份与签名能力，新增独立的元素级投票记录。

## 方案比较

### 方案 A：Makers KV 服务端去重与计数（采用）

浏览器提交 `result` 和 `direction`。服务端从签名 `craft_player` Cookie
恢复匿名玩家，为“元素 + 匿名玩家”建立投票标记，成功占用后更新元素计数，并
把结果同步到首发记录的读取副本。

优点：

- 无需登录，沿用现有产品身份；
- 刷新页面、重复点击和普通重试都由服务端去重；
- 首发分页直接返回计数，不需要每张卡片额外请求；
- 与现有 Makers KV 架构一致。

限制：

- Makers KV 最终一致且没有事务或原子 `put-if-absent`，跨边缘节点完全同时
  提交时只能尽力保证一次；
- 清除本地身份后会被视为新账号。

### 方案 B：只用 `localStorage` 去重（不采用）

实现最少，但调用者可以绕过页面直接重复请求，服务端无法判断重复投票，不符合
“每个账号一次”的基本要求。

### 方案 C：真实登录与事务数据库（不采用）

能够严格跨设备限投，但需要账号生命周期、认证、找回、数据库事务和隐私方案，
明显超过本次社区反馈增强范围。

## 数据模型

### 首发公开记录

Makers 与 FastAPI 的首发记录统一增加：

```json
{
  "result": "需求气球",
  "emoji": "🎈",
  "discoverer": "点评鹅",
  "comment": "一开会，需求就自动膨胀。",
  "upvotes": 12,
  "downvotes": 2,
  "ts": 1785123456,
  "seq": 123
}
```

规则：

- `comment` 通过现有 `normalizeComment` / `normalize_comment` 归一化；
- 缺失或非法点评使用项目现有 `DEFAULT_COMMENT`；
- 计数字段缺失、非数值或小于零时按 `0` 返回；
- 首发创建后点评不可被后续组合命中覆盖。

### Makers 投票标记

每次投票建立一个不可枚举用户明文的 KV 记录：

```text
vote_<result_sha256>_<player_sha256>
```

值为：

```json
{
  "direction": "up",
  "ts": 1785123456,
  "claim_token": "一次请求的随机占用标识"
}
```

服务端不在元素投票 KV key 或响应中保存原始匿名玩家 ID。重复请求先读取该
记录；已有记录时不再增加计数，并返回 `already_voted` 及原投票方向。

首发记录在 Makers 中存在 canonical、索引、feed 和 recent snapshot 等读取
副本。投票成功后由一个专门的存储方法统一更新 canonical 记录，并同步更新索引
记录、feed 记录和 recent snapshot 中同一 `result` 的计数，防止不同分页路径
显示不同数字。

### FastAPI 本地持久化

Redis 使用每元素首发 Hash 的 `comment`、`upvotes`、`downvotes` 字段，并用
基于结果与匿名玩家哈希的唯一投票 key 执行 `SET NX` 去重。

SQLite 对现有 `first_discoveries` 表新增：

```sql
comment TEXT NOT NULL DEFAULT '',
upvotes INTEGER NOT NULL DEFAULT 0,
downvotes INTEGER NOT NULL DEFAULT 0
```

新增投票表：

```sql
CREATE TABLE IF NOT EXISTS first_votes (
  result TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
  ts REAL NOT NULL,
  PRIMARY KEY (result, voter_hash)
);
```

SQLite 唯一键保证本地归档中的同一匿名账号不能对同一元素重复写入。Redis 与
SQLite 的写入通过现有 `backend.db` 边界封装，启动预热恢复首发点评、计数和
投票标记。

## API 设计

新增：

```http
POST /api/wall/vote
Content-Type: application/json

{
  "result": "需求气球",
  "direction": "up"
}
```

首次成功统一返回 HTTP 200：

```json
{
  "ok": true,
  "result": "需求气球",
  "vote": "up",
  "upvotes": 13,
  "downvotes": 2
}
```

已经投过返回 HTTP 200，使网络重试保持幂等：

```json
{
  "ok": false,
  "reason": "already_voted",
  "detail": "你已经评价过这个元素",
  "result": "需求气球",
  "vote": "up",
  "upvotes": 13,
  "downvotes": 2
}
```

错误规则：

- 缺少 `result`：HTTP 400；
- `direction` 不是 `up` 或 `down`：HTTP 400；
- 元素不存在于首发记录：HTTP 404；
- Makers 没有配置 `SESSION_SECRET` 且也没有可回退的 `ADMIN_TOKEN`：HTTP
  503，避免每次请求产生无法持久化的新身份；
- 存储异常：沿用统一安全 JSON 错误，不向浏览器暴露 KV key 或玩家哈希。

首次访问没有合法 `craft_player` Cookie 时，响应沿用现有社区身份逻辑设置一个
有效期一年的签名 HttpOnly Cookie。Makers 优先使用独立 `SESSION_SECRET`，
没有时回退到已经用于后台保护的 `ADMIN_TOKEN`；生产环境 Cookie 带 `Secure`
和 `SameSite=Lax`。

现有 `/api/wall/page`、`/api/wall/recent` 和轮询返回的首发条目增加
`comment`、`upvotes`、`downvotes`，不改变分页字段和排序规则。

受现有 `ADMIN_TOKEN` 保护的 `/api/admin/stats` 增加：

```json
{
  "reaction_summary": {
    "total_votes": 120,
    "total_upvotes": 96,
    "total_downvotes": 24,
    "rated_elements": 38
  },
  "top_upvoted": [
    {
      "result": "需求气球",
      "emoji": "🎈",
      "comment": "一开会，需求就自动膨胀。",
      "upvotes": 18,
      "downvotes": 2
    }
  ],
  "top_controversial": [
    {
      "result": "会议套娃",
      "emoji": "🪆",
      "comment": "为了对齐上个会，再开一个会。",
      "upvotes": 11,
      "downvotes": 9,
      "controversy_score": 9
    }
  ]
}
```

汇总和榜单直接从 `adminPayload()` 已经加载的完整首发记录计算，不为后台看板
新增公开接口或额外 KV 扫描：

- `total_upvotes`、`total_downvotes`：所有规范化首发计数之和；
- `total_votes`：点赞与点踩之和；
- `rated_elements`：点赞或点踩至少为 1 的元素数量；
- `top_upvoted`：只包含至少 1 个点赞的元素，按点赞数降序、点踩数升序、首发
  序号降序取前 10；
- `controversy_score`：`min(upvotes, downvotes)`，用于衡量双方都有参与的争议；
- `top_controversial`：只包含 `controversy_score > 0` 的元素，按争议分、总
  评价数、首发序号依次降序取前 10。

## Makers 投票流程

1. 路由校验请求字段。
2. 存储层读取 canonical 首发记录；不存在则返回 404。
3. 对 `result` 与签名 Cookie 中恢复出的匿名玩家 ID 分别计算 SHA-256，得到
   投票标记 key。
4. 已有标记时，读取当前首发计数并返回 `already_voted`。
5. 没有标记时写入带 `claim_token` 的标记，再读回验证占用。
6. 验证成功后只增加对应方向的计数。
7. 同步 canonical、索引、feed 和 recent snapshot 中的公开首发记录。
8. 返回最终方向和计数。

该流程阻止同一边缘节点上的顺序重复请求。由于 Makers KV 的最终一致模型，
不同边缘节点在极短时间内并发提交仍可能产生计数偏差；页面和文档不宣称金融级
精确计票。

## 卡片与交互设计

首发卡片从上到下显示：

1. 原有编号和时间；
2. Emoji 与元素名；
3. `首发 · 发现者`；
4. 一行到两行自然语言点评，使用引号和弱对比文本；
5. `👍 数量` 与 `👎 数量` 两个按钮。

交互规则：

- 未投票时两个按钮均可用；
- 点击后立即进入提交中状态并暂时禁用两个按钮，防止连点；
- 服务端成功后保存 `ic_wall_votes[result] = direction`，高亮所选按钮并永久
  禁用两个按钮；
- 服务端返回 `already_voted` 时，按服务端返回方向修复本地状态并显示
  “已评价”；
- 网络错误时恢复按钮，不修改数字，卡片内短暂显示“提交失败，请重试”；
- 页面重开时先读取 `ic_wall_votes` 恢复状态；即使只清除这个本地展示状态，
  服务端仍会通过 `craft_player` Cookie 阻止重复提交；
- 使用 `aria-pressed`、`aria-label` 和卡片级 `aria-live` 状态文本支持键盘
  与辅助技术；
- 移动端按钮保持至少 44px 的可点击高度，点评换行但不遮挡卡片内容。

自然语言点评属于 LLM 控制文本，必须通过 `textContent` 写入 DOM，不能拼接进
未转义的 `innerHTML`。元素名、Emoji 与发现者继续沿用现有转义和搜索高亮。

当前 3 秒轮询继续负责新首发。第一页轮询响应中已存在卡片的赞踩计数会合并回
前端状态，使最近首发的数字在不刷新页面时更新；已经滚动到很早的历史卡片允许
在用户投票、重新加载该页或刷新页面时更新。

## `/admin` 社区反馈看板

后台继续复用现有 `/admin` 页面和 `/api/admin/stats` 的
`ADMIN_TOKEN` / `DASHBOARD_PUBLIC` 访问控制，不把投票统计暴露到新的公开管理
接口。

现有核心指标区增加四张卡片：

1. `👍 总点赞`；
2. `👎 总点踩`；
3. `🗳️ 总评价`；
4. `💬 被评价元素`。

现有面板区增加两个 Top 10 表格：

- `💚 最受欢迎元素`：名次、Emoji、元素名、自然语言点评、赞、踩；
- `🔥 争议最高元素`：名次、Emoji、元素名、自然语言点评、赞、踩。

两个榜单都在无投票时显示明确空状态。点评最多显示两行，完整文本放在安全的
`title` 或同等文本提示中；所有点评继续按不可信 LLM 文本处理，不直接插入
未转义 HTML。

后台沿用当前每 3 秒自动刷新。汇总数字和榜单在同一次
`/api/admin/stats` 响应中更新，不增加独立轮询。由于底层 Makers KV 最终一致，
卡片副标题标明统计为近似实时数据。

## 旧数据兼容

- 旧 Makers 首发记录没有 `comment` 时返回 `DEFAULT_COMMENT`；
- 旧记录没有赞踩字段时返回 `0/0`；
- 首次发生投票时写回规范化后的完整公开记录；
- SQLite 启动迁移只新增带默认值的列和表，不删除或重建用户本地数据；
- Redis 旧 Hash 缺少字段时读取层补默认值；
- 不尝试按结果名扫描全部历史组合来猜测旧首发点评，因为一个结果可能由多个
  配方生成，无法可靠恢复“首次合成时”的原点评。

## 文件边界

预计修改：

- `edge-functions/_lib/kv-store.js`：首发点评、投票标记、计数与副本同步；
- `edge-functions/_lib/game-service.js`：创建首发时传入点评；
- `edge-functions/_lib/router.js`：新增投票路由、复用 `playerIdentity()` 并校验
  身份配置；
- `backend/archive.py`：SQLite 兼容迁移与投票唯一表；
- `backend/db.py`：Redis/SQLite 首发与投票封装；
- `backend/main.py`：本地投票路由、复用 `community_player()`、首发点评传递与
  响应兼容；
- `frontend/wall/wall.js`：匿名身份、卡片点评、投票状态和请求；
- `frontend/wall/wall.css`：点评与赞踩控件样式；
- `frontend/wall/reactions.js`：可独立测试的方向校验、本地状态与响应合并帮助
  函数；
- `frontend/admin/index.html`：社区反馈汇总卡片、两个 Top 10 榜单与安全点评
  渲染；
- `tests-makers/kv-store.test.mjs`、`tests-makers/router.test.mjs`、
  `tests-makers/frontend.test.mjs`：Makers 和前端契约；
- `tests/test_wall_reactions.py`：FastAPI、Redis/SQLite 迁移与接口行为；
- `README.md`：记录匿名限投、旧数据和 Makers 最终一致限制。

不重构首发墙的悬赏、排行榜或配方弹窗。

## 测试设计

所有生产代码遵循测试先行。

### Makers 存储测试

- 新首发保存规范化点评并从分页接口返回；
- 旧首发缺失点评和计数时返回默认点评与 `0/0`；
- 第一个 `up` 投票使点赞数从 0 变为 1；
- 同一匿名玩家对同一元素第二次提交不增加任何计数；
- 同一匿名玩家不能先点赞再点踩；
- 不同匿名玩家可以分别投票；
- 不同元素互不影响；
- 投票后的 canonical、索引、feed、recent snapshot 返回相同计数。

### Makers 路由测试

- 合法请求返回统一成功契约；
- 重复请求返回幂等 `already_voted` 契约；
- 缺少结果、非法方向、不存在元素和缺少签名密钥返回规定状态码；
- 首次投票设置签名 `craft_player` Cookie，后续请求复用同一身份；
- 篡改签名 Cookie 会获得新的匿名身份，不会冒充原玩家；
- `/api/wall/page` 包含点评和计数字段。
- `/api/admin/stats` 返回正确的四项汇总；
- 最受欢迎榜按点赞、点踩、序号稳定排序并限制 10 条；
- 争议榜使用 `min(upvotes, downvotes)` 排序并限制 10 条；
- 无投票时汇总全为 0，两个榜单为空数组。

### FastAPI 测试

- 旧 SQLite schema 自动增加点评、计数列和 `first_votes` 表；
- `PRIMARY KEY(result, voter_hash)` 阻止重复投票；
- Redis 首发 Hash 与 SQLite 归档保持点评和计数一致；
- 服务重启预热后仍能阻止已归档匿名玩家重复投票；
- FastAPI 投票路由响应与 Makers 契约一致；
- FastAPI `/api/admin/stats` 返回与 Makers 相同的社区反馈汇总和榜单。

### 前端测试

- 首发墙投票请求由服务端复用或创建 `craft_player` Cookie，前端不提交可伪造
  的账号 ID；
- 点评按文本渲染，恶意 HTML 不会生成节点；
- 点击期间禁用两个按钮；
- 成功和 `already_voted` 都保存服务端方向并锁定按钮；
- 网络失败不写本地投票状态并恢复按钮；
- 轮询合并计数时不丢失已有卡片和本地已投状态；
- 窄屏卡片仍能显示完整点评和两个 44px 高按钮。
- `/admin` 渲染四项社区反馈汇总和两个榜单；
- 后台榜单中的恶意点评文本不会生成 HTML 节点；
- 后台无投票时显示空状态，下一次轮询出现投票后正常更新。

### 完整回归

实现完成后运行：

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
npm run makers:build
```

浏览器验证至少覆盖：

1. 新匿名浏览器对一个元素点赞成功；
2. 同元素再次点击赞或踩均不会增加计数；
3. 同一浏览器可以评价另一个元素；
4. 新首发卡片显示实际合成点评；
5. 旧首发显示默认点评；
6. 页面刷新后按钮保持锁定；
7. 手机宽度下点评和按钮无重叠；
8. `/admin` 四项汇总与赞踩榜单和首发墙数字一致；
9. `/admin` 无投票及有投票两种状态都能正常刷新。

## 发布

本次不在仓库中加入部署凭据。实现与验证完成后提交功能分支并合并到 `main`，
由项目现有 Makers Git 集成自动创建新的 Production 部署。
