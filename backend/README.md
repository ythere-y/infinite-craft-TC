# Infinity Craft · 鹅厂打工人版 — 种子词库说明

本目录是整个项目的**灵魂**。所有梗、所有合成倾向性都在这里被定义，前后端代码只是驱动。

## 文件清单

| 文件                     | 作用                                                   | 谁读它                                    |
| ------------------------ | ------------------------------------------------------ | ----------------------------------------- |
| `seed_elements.json`     | 原版基础元素和规则，保留经典合成链                     | Epoch 2 编译器与本地后端                  |
| `seed_combinations.json` | 原版基础合成规则，`"a + b"` 按字典序规范化             | Epoch 2 编译器与本地后端                  |
| `../content/tencent-bounty-catalog.json` | Epoch 2 的悬赏目标、固定路线、别名、退役内容和资料依据 | 三端内容生成器 |
| `generated/bounty-content.json` | 校验、可达性证明和摘要完成后的本地运行产物        | FastAPI 启动、迁移和固定公式查询          |
| `shared/combine-prompt.json` | 合成 prompt 的 canonical 共享规范、策略与 few-shot 示例 | Python 后端与 Makers 构建生成器            |
| `prompt.py`              | LLM 调用编排、共享 prompt 加载与 JSON 解析             | 后端 miss 后调用 LLM                      |

## 数据流

```
应用启动：校验编译目录 → 执行 Epoch 迁移 → 固定公式写入 Redis + SQLite
    ↓ ready
用户拖 A 到 B
    ↓
前端 POST /api/combine {a, b}
    ↓
后端规范化 key = sorted([a,b]).join(" + ")
    ↓
规范化别名并查 Redis（固定公式已在启动时预热）──命中──→ 直接返回
    ↓ miss
调 DeepSeek（prompt.py 按共享规范装配请求）
    ↓
解析 JSON → 写 Redis + SQLite → 若是首次创造，写 first_discovery → 返回
```

固定目录不封闭 AI 创造：健康启动会把全部固定公式预热到 Redis，运行时 Redis
miss 才进入模型；一旦目录新增了同键公式，下一次启动对账会让 seed 覆盖旧的
动态结果。

## Epoch 2 与初始元素

当前内容纪元是 `content_epoch=2`，初始元素严格固定为 11 个：

```text
水、火、风、土、企鹅、人、时间、AI、电脑、手机、网络
```

悬赏墙包含 254 个固定可达目标，其中“关联组织”40 个。目录编译器会拒绝重复
规范化组合、不可达目标、无用途的中间元素、错误 starter 绑定以及缺少资料依据的
关联组织，不能直接手改 `generated/` 文件绕过这些检查。

修改目录后运行：

```bash
npm run generate:bounty-content
npm run generate:icon-data
npm run generate:makers-data
```

随后提交目录源、生成的本地/Makers 数据和图标映射。

## 类别约束（category / chain）

新增条目时必须设置 `category` 和配方 `chain`，用于：

1. 前端按类筛选（"只看鹅厂梗"）
2. LLM prompt 里按类别举例，保证风格一致
3. 统计分析（哪条链被玩得最多）

## 增量扩词规则

**热梗更新周期**：每周五下午跑一次热梗抓取，补 `meme_2026wNN` 条目。

新增腾讯/互联网悬赏目标时，在 `content/tencent-bounty-catalog.json` 中同时维护：

1. 所属 group 和 target 定义；
2. 从 11 个 starter 出发可达的 canonical recipe；
3. 必要但无需上榜的 support element/recipe；
4. 别名、需要退役的旧组合和旧元素；
5. 关联组织及高风险游戏事实的来源信息。

## 当前编译规模（Epoch 2）

- 初始元素：11
- 编译元素：780
- 固定公式：914
- 悬赏目标：254
- 关联组织：40
