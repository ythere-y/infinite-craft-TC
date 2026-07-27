# Issue 2 社区公式治理设计

## 目标

在当前 FastAPI、原生前端、Redis、SQLite 单体架构内，增加社区公式公开、匿名投票、人工治理与单次 LLM 请求反馈闭环。无需账号系统、微服务或前端框架。

## 核心规则

- 每个成功合成结果创建一个默认隐藏的公式版本。
- 服务端用签名 HttpOnly Cookie 标识匿名玩家，不采集浏览器指纹。
- 只有被服务端记录为实际复现者的玩家可以主动公开公式。
- 全球首发者与第一位公开者分开保存。
- 同一玩家对同一公式只能有一票，可赞成、反对、取消或切换。
- 净支持数为 `up_votes - down_votes`。
- 正向 AI 样例默认要求净支持至少 10 且总票数至少 12。
- 负向治理队列默认要求净支持不高于 -5 且总票数至少 8。
- 低分只进入人工队列，绝不自动退役。
- 管理员可保留、忽略、保护、下架或退役，并必须提供结构化原因。
- 退役保留全部历史、投票和元素；清除旧缓存后，同一输入可生成 v2/v3。
- 高质量样例与退役结果在现有一次 LLM 请求中注入，不增加模型调用次数。

## 安全边界

- 社区公开 API 只查询 `visibility=public`，隐藏公式不返回输入或详情。
- 匿名 Cookie 使用 HMAC 签名、HttpOnly、SameSite=Lax；生产环境启用 Secure。
- 管理员密钥只通过环境变量配置（本地 `COMMUNITY_ADMIN_KEY`，Makers 复用
  `ADMIN_TOKEN`），登录后换成 8 小时签名 HttpOnly Cookie。
- 管理员 Cookie 使用 SameSite=Strict，写操作同时校验 Origin。
- 投票与公开使用 Redis 分钟窗口限流；Redis 故障时业务安全降级。
- 前端只使用 `textContent` 创建用户/模型文本。

## 数据和生命周期

`formula_versions` 保存不可覆盖的版本；`formula_reproductions` 证明公开资格；
`formula_votes` 以 `(formula_id, player_id)` 唯一；`formula_moderation` 保存审计；
`retired_combo_keys` 阻止 Redis/SQLite 在新版本产生前复活旧结果。

状态流程为：

`hidden active` → 玩家公开 → `public active` → 人工 `protect/takedown/retire`。
退役后下一次相同输入绕过旧缓存、调用 LLM，并创建递增版本。
