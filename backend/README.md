# Infinity Craft · 鹅厂打工人版 — 种子词库说明

本目录是整个项目的**灵魂**。所有梗、所有合成倾向性都在这里被定义，前后端代码只是驱动。

## 文件清单

| 文件                     | 作用                                                   | 谁读它                                    |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- |
| `seed_elements.json`     | 元素字典：name → {emoji, category}，含 8 个 starter    | 前端渲染右侧栏；后端校验；LLM prompt 注入 |
| `seed_combinations.json` | 合成规则：`"a + b"` → {result, emoji, chain}，按字典序 | 后端 /api/combine 首先查表，命中即返回    |
| `shared/combine-prompt.json` | 合成 prompt 的 canonical 共享规范、策略与 few-shot 示例 | Python 后端与 Makers 构建生成器            |
| `prompt.py`              | LLM 调用编排、共享 prompt 加载与 JSON 解析             | 后端 miss 后调用 LLM                      |
| `prompt_store.py`        | 本地 Prompt 草稿、不可变聚合版本和生效指针             | FastAPI 管理 API 与本地 LLM 链路          |

## 数据流

```
用户拖 A 到 B
    ↓
前端 POST /api/combine {a, b}
    ↓
后端规范化 key = sorted([a,b]).join(" + ")
    ↓
查 SQLite 缓存 ──命中──→ 直接返回
    ↓ miss
查 seed_combinations.json ──命中──→ 写缓存，返回
    ↓ miss
调 GLM-5.1-64K（prompt.py 按共享规范装配请求）
    ↓
解析 JSON → 落库缓存 → 若是首次创造，写 first_discovery → 返回
```

## 本地 Prompt 管理

本地 FastAPI 启动时会用 `shared/combine-prompt.json` 幂等初始化 SQLite Prompt Store。
在 `.env` 设置非空 `ADMIN_TOKEN` 后，可访问 `/admin` 的“Prompt 管理”页：

1. 编辑并保存草稿；
2. 聚合草稿并检查完整预览；
3. 将确认过的聚合版本设为生效；
4. 需要回滚时，从历史记录重新启用旧版本。

保存草稿不会改变在线 LLM 使用的 Prompt；只有显式激活聚合版本才会更新生效指针。
聚合版本是不可变快照，后续草稿修改不会改写历史版本。

这套管理链路仅用于本地 FastAPI 和 SQLite。Makers 构建使用已提交的
`shared/combine-prompt.json`，不读取本地 SQLite Prompt 配置。

## 类别约束（category / chain）

元素有 9 类（见 `seed_elements._meta.categories`）；合成规则有 7 条主链（见 `seed_combinations._meta.chains`）。
新增条目时**必须打 category/chain 标签**，用于：
1. 前端按类筛选（"只看鹅厂梗"）
2. LLM prompt 里按类别举例，保证风格一致
3. 统计分析（哪条链被玩得最多）

## 增量扩词规则

**热梗更新周期**：每周五下午跑一次热梗抓取，补 `meme_2026wNN` 条目。

**新增元素的清单**：
1. 在 `seed_elements.elements` 加一行
2. 在 `seed_combinations.combinations` 至少加 1 条"怎么合成出来"和 1 条"它和别的合成什么"
3. 如果是高频梗，在 `shared/combine-prompt.json` 的 `examples` 里加一条
4. 热梗类建议打版本号（如 `meme_2026w16`），便于一周后盘点哪些还火、哪些过气

## 当前词库规模（v1.0, 2026-04-22）

- 元素：**140+**（8 starter + 130+ 可合成产物）
- 合成规则：**140+** 条
- Few-shot 示例：由共享 prompt 规范统一维护

## 下一步

种子词库已就绪。代码实现进入 plan mode 统一规划。
