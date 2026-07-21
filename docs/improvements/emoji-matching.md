# 词语 → Emoji 匹配改进方案

> 状态：**保留待实现**
> 目标：在 CPU 服务器上，为词语/短语匹配合适的 emoji，兼顾常见词的准确率与长尾/抽象词的覆盖率。

---

## 1. 总体架构：三层漏斗

```
query → [L1 精确字典] → [L2 Embedding 向量检索] → [L3 LLM 兜底（可选）]
```

- 大部分常见词（"苹果"→🍎、"火"→🔥）在 **L1** 就能命中，省掉 embedding 开销。
- 长尾词、抽象词、短语（"焦虑"、"下班很累"）走 **L2**。
- 复杂语义（整句转 emoji 序列、强上下文依赖）才用 **L3**。

大多数场景 L1 + L2 已经足够。

---

## 2. L1：基于 CLDR / emoji 关键词的字典匹配

### 数据源（关键）

- [Unicode CLDR annotations](https://github.com/unicode-org/cldr/tree/main/common/annotations) — 官方维护，多语言，每个 emoji 有多条关键词；中文在 `zh.xml`。
- Python `emoji` 库的 `EMOJI_DATA`。
- [emojibase](https://github.com/milesj/emojibase) — 结构化更好，有 tags / shortcodes。
- 项目已有 `words/emoji-data/` 可复用。

### 实现要点

- 构建 `关键词 → emoji` 的倒排表。
- 配合 `rapidfuzz` 做模糊匹配，处理简单的同义/变形。
- 一次性构建，O(1) 查询，零模型开销。

---

## 3. L2：本地 Embedding 模型

### 3.1 模型选型（中文 + CPU 友好）

| 模型 | 维度 | 大小 | 备注 |
|---|---|---|---|
| **`BAAI/bge-small-zh-v1.5`** | 512 | ~100MB | **首选**，中文语义强，CPU 快 |
| `BAAI/bge-m3` | 1024 | ~2GB | 效果顶级但偏重，CPU 可用但慢 |
| `shibing624/text2vec-base-chinese` | 768 | ~400MB | 老牌稳定 |
| `paraphrase-multilingual-MiniLM-L12-v2` | 384 | ~120MB | 多语言，最快 |

**决定：首选 `bge-small-zh-v1.5`**，性价比最高。

### 3.2 CPU 性能优化

1. **转 ONNX + int8 量化** — 通常 2–4× 加速，精度几乎无损
   ```bash
   optimum-cli export onnx --model BAAI/bge-small-zh-v1.5 --optimize O3 bge_onnx/
   ```
2. **用 `onnxruntime` 或 `fastembed`** 推理，避免 `transformers` 的 Python 开销。
   - `fastembed` 开箱即用、内置 ONNX，非常适合这个场景。
3. **Batch encode** — 查询批处理。
4. **限制 `max_length`** 到 32 或 64（emoji 描述都很短）。

### 3.3 索引

Emoji 总量才 ~3800 个，**完全不需要 FAISS**：

- 把所有 emoji 描述预编码成矩阵 `(N, D)`，启动时加载进内存。
- 查询时一次矩阵乘法 + argmax，毫秒级。
- 内存占用 ~8MB。

```python
# 伪代码
scores = query_vec @ emoji_matrix.T       # (D,) @ (D, N) -> (N,)
top_k_idx = np.argpartition(-scores, k)[:k]
```

### 3.4 Emoji 描述怎么构造（对效果影响最大）

**不要只用一个官方名字**。为每个 emoji 拼接多个视角的描述：

```
🍎 → ["苹果", "水果", "红色", "红苹果", "fruit apple", "吃的", "食物"]
😭 → ["大哭", "哭泣", "伤心", "难过", "流泪", "痛苦", "委屈"]
```

然后**每条描述单独编码**，查询时对该 emoji 的所有描述向量取 `max similarity`，而不是把描述拼起来编码一次 —— 实测效果差很多。

### 3.5 阈值与兜底

- 设相似度阈值（bge 上通常 **0.5–0.6**），低于阈值返回"无合适 emoji"，避免硬凑。
- Top-k 返回而不是 top-1，给上层留选择空间。

---

## 4. L3：小 LLM 兜底（按需）

针对"把整句话转成 emoji 序列"等复杂任务，embedding 不够：

- Qwen2.5-1.5B / 3B 的量化版（llama.cpp / ollama）。
- 或专门微调过的小模型。

单词 → 单 emoji 的场景，L1 + L2 够用，**先不实现 L3**。

---

## 5. 踩坑提醒

1. **emoji 的 Unicode 变体** — 肤色、ZWJ 序列（👨‍👩‍👧）要统一归一化，否则索引会膨胀且匹配不上。
2. **双向问题** — "开心 → 😊" 容易，"😊 → 开心"要反过来建索引。
3. **文化差异** — 🙏 在西方是 please/thanks，在中文圈常用作"祈祷/感谢"，CLDR 里两种关键词都有，建词典时别只用一种语言源。
4. **冷启动评测** — 先手工标 100 个高频词 → emoji 作为评测集，比只看相似度分数可靠得多。

---

## 6. 建议实施路径

1. **Phase 1：L1 字典方案**
   - 基于 `emoji` 库 + CLDR zh 关键词搞一版纯字典方案。
   - 预期能覆盖 60–70% 的常见词。
2. **Phase 2：L2 embedding 补齐长尾**
   - `fastembed` + `bge-small-zh-v1.5` (ONNX int8)。
   - 构造多视角描述，预编码矩阵落盘。
3. **Phase 3：评测集 + 对比**
   - 建 ~200 条高质量评测集。
   - 对比 L1-only vs L1+L2，决定要不要上 L3。

---

## 7. 与当前项目的结合点

- `words/emoji-data/` 已有 emoji 素材，可复用其关键词。
- `words/THUOCL/` 的词库可作为评测集来源之一。
- 若落地到后端，接口层面建议：
  - `POST /emoji/match { word, top_k }` → `[{emoji, score, source: "dict"|"embed"}, ...]`
  - 字典命中时标 `source: "dict"`，走 embedding 的标 `source: "embed"`，便于观测与灰度。

---

## 8. 开放问题

- 是否需要支持多 emoji 组合（例如"生日聚会" → 🎂🎉）？这会改变 L2 的打分策略（top-k 合并而非 top-1）。
- 是否需要按场景/业务领域定制词表（如游戏相关词优先匹配特定 emoji）？
- 是否需要在线学习/反馈机制（用户点选 emoji 的数据回流）？
