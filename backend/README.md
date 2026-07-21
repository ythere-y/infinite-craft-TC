# Infinity Craft · 鹅厂打工人版 — 种子词库说明

本目录是整个项目的**灵魂**。所有梗、所有合成倾向性都在这里被定义，前后端代码只是驱动。

## 文件清单

| 文件                     | 作用                                                   | 谁读它                                    |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- |
| `seed_elements.json`     | 元素字典：name → {emoji, category}，含 8 个 starter    | 前端渲染右侧栏；后端校验；LLM prompt 注入 |
| `seed_combinations.json` | 合成规则：`"a + b"` → {result, emoji, chain}，按字典序 | 后端 /api/combine 首先查表，命中即返回    |
| `prompt.py`              | GLM few-shot prompt 模板 + 解析                        | 后端 miss 后调用 LLM                      |

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
调 GLM-5.1-64K (prompt.py 构造 prompt)
    ↓
解析 JSON → 落库缓存 → 若是首次创造，写 first_discovery → 返回
```

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
3. 如果是高频梗，在 `prompt.py` 的 `FEW_SHOT_EXAMPLES` 里加一条
4. 热梗类建议打版本号（如 `meme_2026w16`），便于一周后盘点哪些还火、哪些过气

## 当前词库规模（v1.0, 2026-04-22）

- 元素：**140+**（8 starter + 130+ 可合成产物）
- 合成规则：**140+** 条
- Few-shot 示例：20 条

## 下一步

种子词库已就绪。代码实现进入 plan mode 统一规划。
