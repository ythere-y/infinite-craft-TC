# 新元素副图标多样性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让今后动态生成的元素优先使用语义副图标，并在没有具体语义时从稳定候选池中选择副图标。

**Architecture:** `backend/icon_rules.json` 继续作为唯一规则源，增加 AI 语义规则和 `category_badge_pools.ai`。Python 与 Makers 解析器在持久化配方、预置配方和关键词规则之后运行相同的 NFC 码点散列算法，生成数据脚本负责验证并同步规则。

**Tech Stack:** Python 3、JavaScript ES modules、Node.js test runner、pytest、JSON 生成数据。

## Global Constraints

- 不迁移、覆盖或重新计算任何已经持久化的图标。
- 持久化图标优先级高于预置、语义规则和副图标池。
- 稳定散列为 NFC 名称逐码点执行 `hash = (hash * 31 + codepoint) % 2147483647`。
- 候选池选择前必须排除与主图标相同的 Emoji。
- FastAPI 与 Makers 对同一输入必须返回完全相同的图标配方。
- 不新增依赖，不修改图标素材。
- 不触碰或暂存工作区中其他开发者的改动。

---

### Task 1: 扩展并验证图标规则数据

**Files:**
- Modify: `tests-makers/icon-data.test.mjs`
- Modify: `scripts/generate-icon-data.mjs`
- Modify: `backend/icon_rules.json`
- Generated: `edge-functions/_generated/icon-data.js`

**Interfaces:**
- Consumes: `buildElementIconMap({ seedElements, seedCombinations, rules, knowledge, emojiManifest })`
- Produces: `ICON_RULES.category_badge_pools.ai: string[]`，以及位于通用池之前的 AI 语义 `keyword_badges`

- [ ] **Step 1: 写规则契约的失败测试**

在 `tests-makers/icon-data.test.mjs` 的规则测试中断言已提交规则包含精确候选池：

```js
assert.deepEqual(rules.category_badge_pools.ai, [
  "🤖", "✨", "💡", "🧠", "🧩", "⚡",
]);
```

再增加表驱动测试，通过 `buildElementIconMap` 分别传入重复池成员和 manifest
中不存在的池成员：

```js
for (const [name, pool, pattern] of [
  ["duplicate", ["🤖", "🤖"], /must not contain duplicates/i],
  ["missing asset", ["🤖", "🫥"], /does not resolve through the Emoji manifest/i],
]) {
  assert.throws(
    () => buildElementIconMap({
      seedElements: { elements: { Sample: { emoji: "💧", category: "ai" } } },
      seedCombinations: { combinations: {} },
      rules: {
        palettes: ["product"],
        category_palettes: { ai: "product" },
        keyword_badges: [],
        category_badges: {},
        category_badge_pools: { ai: pool },
        allowed_sources: ["generated", "fallback"],
      },
      knowledge: {},
      emojiManifest: {
        "💧": "/assets/icons/water.png",
        "🤖": "/assets/icons/robot.png",
      },
    }),
    pattern,
    name,
  );
}
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test tests-makers/icon-data.test.mjs`

Expected: FAIL，因为规则还没有 `category_badge_pools.ai`，生成器也未拒绝无效池。

- [ ] **Step 3: 实现最小规则验证**

在 `validateRules` 中遍历 `rules.category_badge_pools || {}`。每个值必须是非空
数组、成员必须是非空字符串且不得重复，并对每个成员调用
`requireManifestEmoji`。错误信息分别包含 `must be a non-empty array`、
`must contain non-empty strings` 和 `must not contain duplicates`。

- [ ] **Step 4: 配置语义规则与兜底池**

删除 `backend/icon_rules.json` 中统一返回 `🧠` 的 AI 通用关键词规则，在
`keyword_badges` 最前面加入七条 `categories: ["ai"]` 规则：

```json
[
  {"keywords":["代码","编程","程序","开发","bug","API","脚本","部署","Git"],"badge":"💻","reason":"代码开发语义","categories":["ai"]},
  {"keywords":["文档","周报","报告","写作","总结","PPT","纪要","方案"],"badge":"📝","reason":"文档写作语义","categories":["ai"]},
  {"keywords":["数据","分析","指标","报表","统计","预测"],"badge":"📊","reason":"数据分析语义","categories":["ai"]},
  {"keywords":["聊天","对话","客服","助手","问答"],"badge":"💬","reason":"对话助手语义","categories":["ai"]},
  {"keywords":["图片","绘图","设计","视频","短剧","视觉"],"badge":"🎨","reason":"视觉内容语义","categories":["ai"]},
  {"keywords":["搜索","检索","知识","研究","阅读"],"badge":"🔍","reason":"知识检索语义","categories":["ai"]},
  {"keywords":["自动化","工作流","智能体","Agent"],"badge":"⚙️","reason":"自动化智能体语义","categories":["ai"]}
]
```

在 `category_badges` 前加入：

```json
"category_badge_pools": {
  "ai": ["🤖", "✨", "💡", "🧠", "🧩", "⚡"]
}
```

- [ ] **Step 5: 生成 Makers 规则并验证**

Run: `npm run generate:icon-data`

Run: `node --test tests-makers/icon-data.test.mjs`

Expected: PASS，且 `edge-functions/_generated/icon-data.js` 包含新规则和候选池。

- [ ] **Step 6: 提交规则任务**

```bash
git add backend/icon_rules.json scripts/generate-icon-data.mjs \
  tests-makers/icon-data.test.mjs edge-functions/_generated/icon-data.js
git commit -m "feat: add semantic secondary icon pools"
```

---

### Task 2: 实现 Python 与 Makers 的稳定池解析

**Files:**
- Modify: `tests/fixtures/icon-resolution-cases.json`
- Modify: `tests/test_icon_recipes.py`
- Modify: `tests-makers/icon-recipes.test.mjs`
- Modify: `backend/icon_recipes.py`
- Modify: `edge-functions/_lib/icon-recipes.js`
- Modify: `tests-makers/game-service.test.mjs`

**Interfaces:**
- Consumes: `category_badge_pools` 与现有 `resolve_icon_recipe` / `resolveIconRecipe` 参数
- Produces: `_stable_pool_badge(name, pool, base) -> str | None` 和 JavaScript
  `stablePoolBadge(name, pool, base) -> string | null`

- [ ] **Step 1: 写跨运行时解析的失败用例**

扩展共享 fixture，保留 `Riot`。加入 `代码助手`、`周报代笔`、`数据参谋`、
`客服搭子`、`视觉工坊`、`知识雷达`、`流程代理` 七个语义样本，期望副图标
依次为 `💻`、`📝`、`📊`、`💬`、`🎨`、`🔍`、`⚙️`。每个配方保持输入
主图标、`product` palette 和 `generated` source。

再加入六个 `group: "stable-pool"` 样本，使用不会命中具体语义规则的名称和
非池内主图标：

```text
智能咖啡 → 🧩
云端搭子 → 🧠
灵感鹅 → ⚡
未来饭盒 → 🤖
模型夜宵 → ✨
无限奶茶 → 💡
```

在 Python 与 Makers 测试中增加同一组行为断言：

```python
fallback_cases = [
    case for case in fixture_cases()
    if case.get("group") == "stable-pool"
]
assert len({case["expected"]["badge"] for case in fallback_cases}) >= 4
for case in fallback_cases:
    assert case["expected"]["badge"] != case["emoji"]
```

```js
const fallbackCases = cases.filter((item) => item.group === "stable-pool");
assert.ok(new Set(fallbackCases.map((item) => item.expected.badge)).size >= 4);
for (const item of fallbackCases) {
  assert.notEqual(item.expected.badge, item.emoji);
}
```

增加一个持久化历史配方用例，传入
`{base:"☕", badge:"🧠", palette:"product", source:"generated"}`，断言返回
对象完全不变。

- [ ] **Step 2: 运行共享解析测试并确认失败**

Run: `python3 -m pytest tests/test_icon_recipes.py -q`

Run: `node --test tests-makers/icon-recipes.test.mjs`

Expected: FAIL，因为未命中关键词时解析器尚未使用 `category_badge_pools.ai`。

- [ ] **Step 3: 实现 Python 稳定选择**

在 `backend/icon_recipes.py` 中：

```python
import unicodedata

_STABLE_HASH_MODULUS = 2_147_483_647

def _stable_pool_badge(*, name: str, pool: object, base: str) -> str | None:
    if not isinstance(pool, list):
        return None
    candidates = [
        badge for badge in pool
        if isinstance(badge, str) and badge and badge != base
    ]
    if not candidates:
        return None
    value = 0
    for character in unicodedata.normalize("NFC", name):
        value = (value * 31 + ord(character)) % _STABLE_HASH_MODULUS
    return candidates[value % len(candidates)]
```

在 `_dynamic_badge` 未命中后，先读取
`category_badge_pools[category]`，再读取 `category_badge_pools[chain]`，调用
该函数。持久化和预置的提前返回保持不变。

- [ ] **Step 4: 实现 Makers 稳定选择**

在 `edge-functions/_lib/icon-recipes.js` 中实现相同算法：

```js
const STABLE_HASH_MODULUS = 2_147_483_647;

function stablePoolBadge({ name, pool, base }) {
  if (!Array.isArray(pool)) return null;
  const candidates = pool.filter(
    (badge) => typeof badge === "string" && badge && badge !== base,
  );
  if (!candidates.length) return null;
  let value = 0;
  for (const character of String(name || "").normalize("NFC")) {
    value =
      (value * 31 + character.codePointAt(0)) % STABLE_HASH_MODULUS;
  }
  return candidates[value % candidates.length];
}
```

关键词未命中后按 category、chain 顺序选择池。不要改变
`normalizeIcon`、`presetIcon` 或 persisted 的优先级。

- [ ] **Step 5: 对齐既有集成测试期望**

运行 `node --test tests-makers/game-service.test.mjs`，只更新那些创建新元素或
修复缺失图标时仍硬编码 `🧠` 的断言，使其匹配共享稳定算法。缓存中显式保存
`🧠` 的测试继续期望 `🧠`，用于证明不迁移历史配方。

- [ ] **Step 6: 运行双运行时与服务测试**

Run: `python3 -m pytest tests/test_icon_recipes.py -q`

Run: `node --test tests-makers/icon-recipes.test.mjs tests-makers/game-service.test.mjs`

Expected: 全部 PASS；共享 fixture 在两端返回相同配方。

- [ ] **Step 7: 提交解析任务**

```bash
git add tests/fixtures/icon-resolution-cases.json tests/test_icon_recipes.py \
  tests-makers/icon-recipes.test.mjs tests-makers/game-service.test.mjs \
  backend/icon_recipes.py edge-functions/_lib/icon-recipes.js
git commit -m "feat: diversify generated secondary icons"
```

---

### Task 3: 回归验证与交付检查

**Files:**
- Verify only; do not edit unrelated files.

**Interfaces:**
- Consumes: Tasks 1–2 committed icon rule and resolver behavior
- Produces: verified repository state

- [ ] **Step 1: 检查生成数据与工作区范围**

Run: `git status --short`

Run: `git diff --check HEAD~2..HEAD`

Expected: 只出现本计划列出的文件以及用户原有的无关工作区改动，不存在空白错误。

- [ ] **Step 2: 运行 JavaScript 全套测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 3: 运行 Python 必需测试**

Run: `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`

Expected: PASS。

- [ ] **Step 4: 运行生产构建**

Run: `npm run build`

Expected: PASS，生成的 Makers 包含更新后的图标规则和解析器。

- [ ] **Step 5: 汇总实现结果**

报告语义规则、稳定候选池、历史图标不迁移、测试与构建结果，并明确列出未触碰的
用户工作区改动。
