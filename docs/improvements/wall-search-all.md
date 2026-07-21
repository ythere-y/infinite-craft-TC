# 首发墙 · 全量搜索走后端

> 状态：**保留待实现**
> 来源：v1 首发墙已支持分页加载（100/页 + 无限滚动），但搜索仅在**已加载到前端的数据**内生效。
> 目标：让搜索覆盖数据库里所有首发（未滚动加载的长尾也能被搜到）。

---

## 1. 现状（v1）

- `/api/wall/page?offset=&limit=` 按 `first_index`（ts DESC）分页返回。
- 前端 `wall.js` 维护 `allItems[]`，搜索走 `allItems` 本地 `.includes()` 过滤：文字 / emoji / 用户名三字段。
- **问题**：用户搜一个很久以前被发现、还没滚到的词，会搜不到。

---

## 2. 目标行为

- 空搜索框：保持现在的分页浏览行为不变。
- 输入搜索词：
  - 先本地命中（秒级反馈）
  - 同时发一个后端请求查全量；返回后**合并去重**展示，并标注"部分结果来自数据库"
  - 无结果时明确提示"数据库里也没有匹配，换个词试试？"

---

## 3. 后端方案

### 3.1 接口

```
GET /api/wall/search?q=<str>&limit=100
→ { items: [{result, emoji, discoverer, ts}], total, truncated }
```

- `q` 会在 `result`、`emoji`、`discoverer` 三字段上做 `LIKE '%q%'`（或 FTS）。
- 对 `q` 做长度限制（≤ 32）、去空白，空串直接 400。

### 3.2 数据源选择

**首选：SQLite `first_discoveries` 表**
- 现成数据，是永久真相源（archive.py）。
- 量级（分享现场 ~数千条）下 `LIKE` 完全够用。
- 如果担心性能，可以：
  - 给 `result`、`discoverer` 各加一个 `COLLATE NOCASE` 索引，或
  - 建一张 SQLite **FTS5** 虚表（`first_discoveries_fts`），支持 unicode61 分词；中文也能按子串匹配。

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS first_discoveries_fts
USING fts5(result, emoji, discoverer, content='first_discoveries');
```

**不首选 Redis**：`first_index` 是 ZSET，按 ts 排序；用户名索引要额外维护。除非后续把搜索接入 SSE 推送。

### 3.3 emoji 匹配的坑

- emoji 的 Unicode 变体（肤色 / ZWJ）让 `LIKE '%🎉%'` 未必稳。
- 简单做法：保留原样 LIKE，长尾后续再接入 `docs/improvements/emoji-matching.md` 里的**词语 → emoji 匹配方案**，支持"生日→🎉🎂"这类语义搜索。

---

## 4. 前端改动

- 搜索防抖（300ms）再打后端。
- 响应回来后：
  ```js
  const serverIds = new Set(serverItems.map(x => x.result + "|" + x.ts));
  const localIds  = new Set(allItems.map(x => x.result + "|" + x.ts));
  const merged = [...allItems, ...serverItems.filter(x => !localIds.has(x.result + "|" + x.ts))];
  ```
- 在结果头部标：`共 N 条（本地 X / 来自数据库 Y）`。
- 搜索态下隐藏"加载更多 / 已经加载完了"的提示，避免歧义。

---

## 5. 与 emoji 匹配方案的衔接

- 如果 `docs/improvements/emoji-matching.md` 落地了词语 ↔ emoji 的 embedding 方案，
  搜索行为可以升级成："输入'开心' → 自动匹配 😊😄🥳 → 一起搜"。
- 这会把当前方案的"三字段 LIKE"升级成"语义搜索 + LIKE 兜底"。

---

## 6. 开放问题

- 搜索结果要不要支持分页（大量匹配时）？
- 要不要把搜索命中率、热词统计落到 `kpi_events` 或单独日志，做产品侧观察？
- 是否需要在搜索态下也继续订阅 SSE（新首发如果匹配 q，就高亮插入）？
