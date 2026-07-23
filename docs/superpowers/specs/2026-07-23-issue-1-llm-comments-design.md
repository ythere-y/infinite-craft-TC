# Issue #1：LLM 合成点评与三类发现状态设计

## 目标

在不增加第二次模型调用的前提下，让动态合成同时产生元素、Emoji 和一句点评；点评随组合持久化并在缓存命中时复用。前端沿用现有发现状态判定，明确展示“全球首发”“我的新发现”“再次合成”三类反馈。

本设计只覆盖 GitHub Issue #1，不增加账号、跨设备同步、点评互动或首发墙点评。

## 现状与约束

- `POST /api/combine` 已返回 `is_first`，前端已有 `state.discovered`。
- 前端已有 `global_new`、`global_known`、`seen` 三档动画和单实例 Toast。
- Redis 是在线查询层，SQLite 是组合归档和 Redis 预热来源。
- Seed 与历史数据都没有点评字段，升级必须兼容。
- LLM 内容不能以未经转义的 HTML 插入页面。
- 免费 Render 的 Redis 和本地 SQLite 可能重置，因此迁移必须可重复执行。

## 方案选择

采用现有单实例 Toast 承载状态、元素和点评。

不采用合成位置气泡，因为移动端容易遮挡元素并干扰拖拽；不采用固定历史面板，因为超出 Issue 范围。单实例 Toast 在连续合成时更新内容并重置计时器，天然避免提示堆叠。

## 统一点评规则

定义一个后端常量作为所有降级路径的唯一默认值：

```text
这波组合很有想法，建议先小范围灰度。
```

点评规范化规则：

1. 输入必须是字符串。
2. 去除首尾空白，将内部连续空白折叠为一个空格。
3. 不允许换行或控制字符。
4. Unicode 字符数必须在 1 到 30 之间。
5. 任一条件不满足时使用默认点评，元素名称和 Emoji 仍正常返回。

内容安全由模型服务的安全策略与本地结构校验共同承担。本地不尝试维护易过时的敏感词表；无论内容为何，前端只通过 `textContent` 展示。

## LLM 协议

System Prompt 的输出格式升级为：

```json
{
  "name": "需求膨胀",
  "emoji": "🎈",
  "comment": "一行需求开完会，膨胀成了季度项目。"
}
```

Few-shot 示例全部包含点评，明确点评只能一句、最多 30 个字符，并与输入或结果相关。仍只调用一次 `query()`。

解析策略：

- `name` 或 `emoji` 缺失/非法：整个 LLM 结果无效，沿用现有 fallback。
- `comment` 缺失/非法：保留合法的 `name`、`emoji`，仅将点评替换为默认值。
- JSON 提取正则继续以 `name` 和 `emoji` 为最低兼容条件，以支持旧格式模型响应。

## 数据模型与迁移

### Redis

`combo:{key}` Hash 增加：

```text
comment: string
```

`db.put_cache()` 和 `db.put_cache_force()` 增加可选 `comment` 参数，默认空字符串，保持 Seed Loader 和旧调用兼容。读取旧 Hash 时不要求字段存在。

### SQLite

`combinations` 表增加：

```sql
comment TEXT NOT NULL DEFAULT ''
```

`init_archive()` 每次启动检查 `PRAGMA table_info(combinations)`；字段不存在时执行一次 `ALTER TABLE`。该迁移幂等，适用于开发、测试和 Render 重启。

组合写入、读取和 Redis 预热都携带 `comment`。旧行的空字符串在 API 边界统一映射为默认点评，不批量调用 LLM 回填。

### API

`CombineResp` 新增必填字符串字段：

```text
comment
```

数据来源优先级：

1. LLM 新生成并通过校验的点评；
2. Redis/SQLite 已保存点评；
3. 固定默认点评。

fallback 当前不会生成画布元素，保持现有行为；不额外调用 LLM 生成点评。

## 前端状态与展示

在将结果加入 `state.discovered` 前计算 `isNewToPlayer`，按现有优先级映射：

| 条件 | tier | 可见文字 | 效果 |
|---|---|---|---|
| `resp.is_first` | `global_new` | `🌍 全球首发` | 烟花、金色发光、金色 Toast |
| 非全球首发且 `isNewToPlayer` | `global_known` | `✨ 我的新发现` | 蓝色发光、蓝色 Toast |
| 玩家已拥有 | `seen` | `↻ 再次合成` | 轻量 pop、普通 Toast |

三种 tier 无条件展示 Toast 和点评，不再以得分大于零作为重复合成提示的前提。

Toast DOM 结构由 JavaScript 使用 `createElement()` 和 `textContent` 创建：

- 标题行：状态、难度和得分；
- 元素行：Emoji 和元素名；
- 点评行：带中文引号的点评。

不再把 LLM 提供的 Emoji、名称或点评拼接到 `innerHTML`。

Toast 保持 `pointer-events: none`，不干扰拖拽；使用单实例定时器，持续 4.2 秒。新提示会替换旧提示并重置定时器。点评行允许换行，Toast 使用视口宽度约束；移动端改为左右各 12 像素并避开底部安全区域。

## 错误处理

- 点评解析失败只降级点评，不降级元素。
- Redis 旧 Hash 无 `comment` 时 API 返回默认点评。
- SQLite 旧表通过幂等迁移增加列。
- Redis 写入不接受 `None`，点评在写入前始终转为字符串。
- 前端缺失 `resp.comment` 时仍使用同一默认点评，兼容部署期间的新旧后端交错。
- 点评只以纯文本渲染，HTML 标签和事件属性不会执行。

## 测试策略

### 后端单元测试

- Prompt 明确要求一次返回三个字段。
- 合法点评被保留。
- 缺失、空白、换行、控制字符和超过 30 字的点评降级。
- 非法点评不影响合法元素与 Emoji。
- Redis 新写入包含点评，旧 Hash 缺失点评可读取。
- SQLite 新数据库包含字段，旧数据库可迁移且重复初始化安全。
- SQLite 组合读写和 Redis 预热保留点评。
- API 缓存命中返回原点评且不调用 LLM。
- API 旧缓存返回默认点评。

### 前端自动化测试

将状态判定抽成纯函数，覆盖三个 tier 的优先级。将 Toast 内容渲染保持为纯文本节点，并通过静态/DOM 测试确认不使用 LLM 内容拼接 `innerHTML`。

### 人工验收

- 桌面端依次验证全球首发、我的新发现和再次合成。
- 使用包含 `<img onerror=...>` 的测试点评确认只显示文本。
- 连续快速合成确认 Toast 不堆叠。
- 窄屏确认 Toast 不溢出、不遮挡主要操作区域。
- Render 部署后验证一次 LLM miss 和一次同组合 cache hit，第二次不出现新的模型请求日志。

## 验收标准映射

- 一次 LLM 调用返回三字段：LLM 协议及 Prompt 测试。
- 点评持久化与缓存复用：Redis/SQLite 数据模型及集成测试。
- 三类发现状态与明显差异：状态表、现有三档动画及纯函数测试。
- 三种状态都展示点评：Toast 无条件展示逻辑。
- 旧缓存兼容：API 默认点评边界。
- 点评异常不影响合成：字段级降级解析。
- HTML 注入防护：全量 `textContent` 渲染。
- 自动化覆盖：后端、前端测试章节。
- 桌面与移动端：响应式 CSS 与人工验收清单。

## 完成定义

只有同时满足以下条件才视为解决 Issue：

1. 全部自动化测试通过；
2. 代码审查确认每条验收标准有实现和测试证据；
3. 功能分支合并到个人 Fork 的 `main`；
4. Render 自动部署成功且 `/api/health` 正常；
5. 线上完成 LLM miss、cache hit、三态提示和移动端检查；
6. 在上游 Issue 留下实现说明和测试证据后关闭 Issue。
