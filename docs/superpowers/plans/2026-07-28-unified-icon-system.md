# Unified Sticker Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将游戏全部元素与操作图标统一为本地可用的贴纸系统，为 591 个预设元素建立实体感知的双图映射，并让动态元素在 FastAPI 与 Makers 两套运行时中持久化稳定的 `icon` 配方。

**Architecture:** `backend/icon_knowledge.json` 与 `backend/icon_rules.json` 是人工知识和确定性规则的源数据；离线生成器产出前端映射、Noto PNG、Phosphor SVG 子集和 Makers 模块。浏览器中的 `window.ICON_SYSTEM` 统一渲染元素与操作图标。FastAPI 和 Edge Function 各自实现同一份经过共享夹具验证的确定性解析规则，并通过可选 `icon` 字段保持 API 向后兼容。

**Tech Stack:** Vanilla JavaScript、Node.js 20 测试/生成脚本、Python 3.11/FastAPI、SQLite、Redis、EdgeOne Makers KV、Noto Emoji PNG（Apache-2.0）、Phosphor Duotone SVG（MIT）。

## Global Constraints

- 以 `docs/superpowers/specs/2026-07-28-unified-icon-system-design.md` 为产品与视觉依据。
- 保留所有现有 `emoji` 字段；`icon` 只能作为可选增量字段。
- 不在浏览器或生产构建时访问第三方 CDN。
- `words/emoji-data/` 只供人工触发的离线生成命令读取，普通 `npm run build` 不得依赖该目录。
- 只提交 `frontend/assets/icons/generated/` 中的固定产物，不提交被忽略的 `words/`。
- 保留 `.emoji` DOM 外层及其命中区域；老板模式切换不得改变画布元素的几何尺寸。
- 映射优先级固定为：语义正确 → 实体消歧 → 降低重复。不得为了审计数字制造无意义徽章。
- 当前工作树包含其他开发者未提交的改动。每个提交必须使用显式路径 `git add <paths...>`；对当前已修改的重叠文件只能使用 `git add -p <path>` 并复核 `git diff --cached`，不得覆盖或顺带提交无关修改。
- 不提交 `.superpowers/`、`tests/test_bounty.py` 或任何不属于本计划的现有改动。

## Existing Structure and Change Map

| 当前职责 | 当前文件 | 本计划中的变化 |
| --- | --- | --- |
| 预设元素/配方 | `backend/seed_elements.json`, `backend/seed_combinations.json` | 保持语义数据不变；生成器读取 |
| Python 元素归档 | `backend/archive.py`, `backend/seed_loader.py` | `elements.icon_json` 迁移与加载 |
| Python API | `backend/main.py` | 返回可选 `icon`、配方输入图标 |
| Makers 预设数据 | `scripts/generate-makers-data.mjs`, `edge-functions/_generated/seed-data.js` | 把生成后的预设 `icon` 合并进 `ELEMENTS` |
| Makers 动态元素 | `edge-functions/_lib/game-service.js`, `edge-functions/_lib/kv-store.js` | 生成并保存稳定 `icon` |
| 主游戏渲染 | `frontend/combine-feedback.js`, `frontend/app.js`, `frontend/style.css` | 委托统一图标组件并改成紧凑三列 |
| 首发墙 | `frontend/wall/wall.js`, `frontend/wall/wall.css` | 使用同一元素/操作图标组件 |
| 社区与后台 | `frontend/community*.{html,js}`, `frontend/admin/index.html` | 清除裸操作 Emoji，使用统一组件 |
| 静态构建 | `scripts/build-makers.mjs` | 验证固定资产后再复制 |

生成后新增的稳定文件结构：

```text
backend/
  icon_knowledge.json
  icon_rules.json
  icon_recipes.py
edge-functions/
  _generated/icon-data.js
  _lib/icon-recipes.js
frontend/
  icon-system.css
  icon-system.js
  assets/icons/
    actions/*.svg
    generated/
      emoji/*.png
      emoji-icon-manifest.json
      element-icon-map.json
      icon-build-metadata.json
scripts/
  icon-data-lib.mjs
  generate-icon-assets.mjs
  generate-icon-data.mjs
  audit-icon-map.mjs
tests/fixtures/icon-resolution-cases.json
tests-makers/icon-assets.test.mjs
tests-makers/icon-data.test.mjs
tests-makers/icon-recipes.test.mjs
tests/test_icon_recipes.py
```

---

## Task 1: Build the Vendored Asset Pipeline

**Interfaces**

- **Consumes:** `words/emoji-data/emoji.json`, `words/emoji-data/img-google-64/*.png`, `node_modules/@phosphor-icons/core/assets/duotone/*.svg`.
- **Produces:** committed Noto PNGs, Phosphor SVG subset, Emoji manifest, build metadata, and `verifyIconAssets()`.

**Files**

- Create: `scripts/icon-data-lib.mjs`
- Create: `scripts/generate-icon-assets.mjs`
- Create: `tests-makers/icon-assets.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Generate: `frontend/assets/icons/generated/emoji/`
- Generate: `frontend/assets/icons/generated/emoji-icon-manifest.json`
- Generate: `frontend/assets/icons/generated/icon-build-metadata.json`
- Generate: `frontend/assets/icons/actions/`

- [ ] **Step 1: Install only the development-time Phosphor source package**

Run:

```bash
npm install --save-dev @phosphor-icons/core@2.1.1
```

Expected: `package.json` and `package-lock.json` contain the pinned package; no Phosphor runtime script or stylesheet is added to the frontend.

- [ ] **Step 2: Write failing Unicode and asset-selection tests**

In `tests-makers/icon-assets.test.mjs`, import:

```js
import {
  emojiCodepointCandidates,
  requiredActionIcons,
  validateCommittedIconAssets,
} from "../scripts/icon-data-lib.mjs";
```

Cover these exact normalization cases:

```js
assert.deepEqual(emojiCodepointCandidates("❤️"), [
  "2764-fe0f",
  "2764",
]);
assert.ok(
  emojiCodepointCandidates("👩🏽‍💻").includes(
    "1f469-1f3fd-200d-1f4bb",
  ),
);
assert.ok(emojiCodepointCandidates("1️⃣").includes("31-fe0f-20e3"));
assert.deepEqual(requiredActionIcons().includes("trash"), true);
```

Also assert that validation fails clearly when the manifest is missing.

Run:

```bash
node --test tests-makers/icon-assets.test.mjs
```

Expected: FAIL because `scripts/icon-data-lib.mjs` does not exist.

- [ ] **Step 3: Implement the reusable normalization and validator**

`scripts/icon-data-lib.mjs` 的接口契约：

```text
emojiCodepointCandidates(emoji: string) -> string[]
requiredActionIcons() -> string[]
validateCommittedIconAssets({root?: string}) -> Promise<ValidationSummary>
```

`emojiCodepointCandidates()` must:

1. preserve the fully qualified sequence first;
2. add a variation-selector-free candidate second;
3. preserve ZWJ, skin-tone and keycap code points;
4. return unique lowercase dash-separated code-point strings.

`requiredActionIcons()` must return this fixed, sorted subset:

```js
[
  "arrow-left",
  "arrow-right",
  "book-open",
  "caret-down",
  "chart-line-up",
  "check",
  "download-simple",
  "equals",
  "magnifying-glass",
  "monitor-play",
  "plus",
  "question",
  "share-network",
  "sparkle",
  "thumbs-down",
  "thumbs-up",
  "trash",
  "trophy",
  "user-circle",
  "warning",
  "x",
]
```

`validateCommittedIconAssets()` must verify:

- Emoji manifest and build metadata parse; if the element map already exists,
  validate its asset references as well;
- each manifest path remains below `frontend/assets/icons/`;
- every referenced PNG/SVG exists and is non-empty;
- metadata records Noto and Phosphor versions/licenses;
- all required action icons exist.

- [ ] **Step 4: Implement the offline generator**

`scripts/generate-icon-assets.mjs` must:

1. fail with an actionable message if `words/emoji-data/emoji.json` or `img-google-64` is missing;
2. rebuild through a temporary sibling directory, then atomically replace only the generated asset directories;
3. copy all available Google 64px PNGs using stable lowercase filenames;
4. create `emoji-icon-manifest.json` mapping qualified and fallback Emoji strings to `/assets/icons/generated/emoji/<codepoints>.png`;
5. copy only `requiredActionIcons()` from `@phosphor-icons/core/assets/duotone/<name>-duotone.svg` to `frontend/assets/icons/actions/<name>.svg`;
6. write source versions, licenses, file counts and SHA-256 digest into `icon-build-metadata.json`;
7. finish by calling `validateCommittedIconAssets()`.

Add scripts:

```json
{
  "generate:icons": "node scripts/generate-icon-assets.mjs",
  "verify:icons": "node scripts/verify-icon-assets.mjs"
}
```

Create the thin `scripts/verify-icon-assets.mjs` entry point that calls the shared validator and prints the counts.

- [ ] **Step 5: Generate and verify committed assets**

Run:

```bash
npm run generate:icons
node --test tests-makers/icon-assets.test.mjs
npm run verify:icons
```

Expected:

- tests PASS;
- manifest contains at least 3,700 image entries;
- the current seed’s 312 unique Emoji all resolve;
- exactly 21 action SVGs are reported.

- [ ] **Step 6: Record licenses**

Append dedicated Noto Emoji and Phosphor sections to `THIRD_PARTY_NOTICES.md`, including:

- Noto Emoji copyright and Apache License 2.0 notice;
- Phosphor Icons copyright and MIT text;
- note that only the vendored generated subset is shipped.

- [ ] **Step 7: Commit the asset pipeline**

```bash
git add package.json package-lock.json THIRD_PARTY_NOTICES.md \
  scripts/icon-data-lib.mjs scripts/generate-icon-assets.mjs \
  scripts/verify-icon-assets.mjs tests-makers/icon-assets.test.mjs \
  frontend/assets/icons/actions frontend/assets/icons/generated/emoji \
  frontend/assets/icons/generated/emoji-icon-manifest.json \
  frontend/assets/icons/generated/icon-build-metadata.json
git commit -m "feat: vendor sticker icon assets"
```

---

## Task 2: Generate and Audit the 591 Preset Icon Recipes

**Interfaces**

- **Consumes:** seed elements/combinations, category palette rules, entity overrides, Emoji manifest.
- **Produces:** a complete 591-entry frontend map, Makers icon data, and an audit report that blocks semantic regressions and excessive duplicate signatures.

**Files**

- Create: `backend/icon_rules.json`
- Create: `backend/icon_knowledge.json`
- Create: `scripts/generate-icon-data.mjs`
- Create: `scripts/audit-icon-map.mjs`
- Create: `tests-makers/icon-data.test.mjs`
- Create: `docs/icon-system-audit.md`
- Generate: `frontend/assets/icons/generated/element-icon-map.json`
- Generate: `edge-functions/_generated/icon-data.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing completeness and semantic-regression tests**

`tests-makers/icon-data.test.mjs` must read the seed and generated map and assert:

```js
assert.equal(Object.keys(iconMap).length, 591);
assert.deepEqual(iconMap.Riot.icon, {
  base: "👊",
  badge: "🎮",
  palette: "studio",
  source: "curated",
});
assert.equal(iconMap.Riot.canonical_name, "Riot Games");
assert.doesNotMatch(iconMap.Riot.rationale, /闪电|暴乱/u);
assert.deepEqual(iconMap.Epic.icon, {
  base: "🛡️",
  badge: "🎮",
  palette: "studio",
  source: "curated",
});
assert.equal(iconMap.COO.entity_type, "role");
```

Also validate every entry has:

- `icon.base`, `icon.palette`, `icon.source`;
- a non-empty `rationale`;
- optional `badge` resolving through the Emoji manifest;
- a palette in the fixed six-family set.

Run:

```bash
node --test tests-makers/icon-data.test.mjs
```

Expected: FAIL because the source knowledge and generated map do not exist.

- [ ] **Step 2: Define the deterministic rule schema**

`backend/icon_rules.json` must contain:

```json
{
  "palettes": [
    "nature",
    "product",
    "office",
    "studio",
    "people",
    "place"
  ],
  "category_palettes": {},
  "keyword_badges": [],
  "category_badges": {},
  "allowed_sources": [
    "curated",
    "entity",
    "generated",
    "fallback"
  ]
}
```

Populate `category_palettes` for every category found in the seed. Each
`keyword_badges` entry must be an exact JSON object with `keywords`, `badge`,
`reason`, and optional `categories`; ordering is the tie-breaker. Category
badges may qualify a concept but must not override an exact entity mapping.

- [ ] **Step 3: Seed the entity knowledge layer**

`backend/icon_knowledge.json` is keyed by exact element name. Every entity row
uses:

```json
{
  "entity_type": "company",
  "canonical_name": "Riot Games",
  "aliases": ["拳头", "拳头游戏"],
  "contexts": ["studio", "invest"],
  "forbidden_senses": ["riot=暴乱", "riot=闪电"],
  "icon": {
    "base": "👊",
    "badge": "🎮",
    "palette": "studio",
    "source": "curated"
  },
  "rationale": "腾讯投资的游戏工作室；中文通称拳头游戏"
}
```

Start with the locked `Riot`, `Epic`, `COO`, and `任宇昕` rows before running
the generator. Step 6 uses the implemented audit command to enumerate and add
all remaining brands, products, people, roles and English abbreviations.

- [ ] **Step 4: Implement candidate generation**

`scripts/generate-icon-data.mjs` 的接口契约：

```text
buildElementIconMap({
  seedElements,
  seedCombinations,
  rules,
  knowledge,
  emojiManifest
}) -> Record<ElementName, IconCatalogEntry>
generateIconData() -> Promise<GeneratedIconDataSummary>
```

Resolution order for each preset:

1. exact entity/curated override;
2. exact keyword rule constrained by category;
3. seed Emoji as base plus a semantically valid category badge;
4. seed Emoji alone.

The generated record must preserve entity metadata when present and create a
specific rationale for rule-generated rows, for example:

```json
{
  "icon": {
    "base": "💼",
    "badge": "⚙️",
    "palette": "office",
    "source": "generated"
  },
  "rationale": "沿用种子语义“公文包”，以“运营/流程”徽章区分同图标办公概念"
}
```

Write the same data as:

- JSON for the browser;
- named exports `ELEMENT_ICONS`, `ICON_RULES` and `ENTITY_ALIASES` in
  `edge-functions/_generated/icon-data.js`.

- [ ] **Step 5: Implement the audit gate**

`scripts/audit-icon-map.mjs` must report:

- total mapped elements;
- missing/invalid assets;
- base reuse groups and top 20 counts;
- full signature reuse groups and top 20 counts;
- full-signature duplicate rate;
- signatures used more than twice;
- entity rows missing rationale or aliases;
- locked semantic regression results.

It must exit non-zero when:

- mapped total differs from seed total;
- any asset is missing;
- `Riot`, `Epic`, `COO`, or `任宇昕` differs from the locked recipes;
- duplicate signature rate is at least 10%;
- a signature is used more than twice without an explicit
  `duplicate_exception` rationale in every affected row.

Add:

```json
{
  "generate:icon-data": "node scripts/generate-icon-data.mjs",
  "audit:icons": "node scripts/audit-icon-map.mjs"
}
```

- [ ] **Step 6: Generate, review, and refine all collision groups**

Run:

```bash
npm run generate:icon-data
node scripts/audit-icon-map.mjs --list-entities
npm run audit:icons
```

Review in this fixed order:

1. all entity rows;
2. all signatures used more than twice;
3. the original 142 duplicate Emoji groups;
4. starters, bounty entries and high-frequency recipes;
5. low-confidence generated rules.

For each incorrect or weak result, add an exact row to
`backend/icon_knowledge.json`, regenerate, and rerun the audit. Stop only when
the command exits zero. Do not silence a collision solely by cycling arbitrary
badges.

- [ ] **Step 7: Generate the human-readable report**

`scripts/audit-icon-map.mjs --write-report docs/icon-system-audit.md` must
write the metric definitions, current numbers, all accepted exceptions and the
locked entity examples. The report is generated from the same data as the gate.

Run:

```bash
node --test tests-makers/icon-data.test.mjs
npm run audit:icons
```

Expected: PASS, 591 valid mappings, full-signature duplicate rate below 10%.

- [ ] **Step 8: Commit mapping and audit data**

```bash
git add backend/icon_rules.json backend/icon_knowledge.json \
  scripts/generate-icon-data.mjs scripts/audit-icon-map.mjs \
  tests-makers/icon-data.test.mjs docs/icon-system-audit.md \
  frontend/assets/icons/generated/element-icon-map.json \
  edge-functions/_generated/icon-data.js package.json
git commit -m "feat: map preset elements to semantic sticker icons"
```

---

## Task 3: Build the Browser Icon System

**Interfaces**

- **Consumes:** optional API `icon`, preset map, Emoji manifest, vendored SVGs.
- **Produces:** synchronous `renderElement()` / `renderAction()` after `ready`,
  predictable native-Emoji fallbacks, and stable `.emoji` geometry.

**Files**

- Create: `frontend/icon-system.js`
- Create: `frontend/icon-system.css`
- Modify: `frontend/combine-feedback.js`
- Modify: `tests/test_combine_feedback.py`
- Modify: `tests-makers/frontend.test.mjs`

- [ ] **Step 1: Add failing resolution and DOM fallback tests**

Update the headless-browser harness in `tests/test_combine_feedback.py` to load
`frontend/icon-system.js` before `combine-feedback.js` and stub both manifest
fetches. Add tests that verify:

- persisted API `icon` wins over the preset map;
- preset map wins over `emoji`;
- missing base image fires a fallback that restores native Emoji text;
- missing badge hides only the badge;
- rendered outer node retains class `.emoji`;
- element name is a separate text node and hostile names are never parsed as HTML.

Add static checks in `tests-makers/frontend.test.mjs` for loading
`icon-system.css` and `icon-system.js` before consumers.

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
node --test tests-makers/frontend.test.mjs
```

Expected: FAIL because the new files and API do not exist.

- [ ] **Step 2: Implement `window.ICON_SYSTEM`**

Expose exactly:

```js
window.ICON_SYSTEM = {
  ready,
  resolveElementRecipe,
  renderElement,
  renderAction,
  hydrateActions,
};
```

`resolveElementRecipe({name, emoji, category, icon})` uses:

1. valid persisted `icon`;
2. preset entry by `name`;
3. a single-image recipe for `emoji`;
4. `{base: emoji || "❓", palette: "place", source: "fallback"}`.

`renderElement(document, target, payload)` must:

- clear with `replaceChildren`;
- keep or create a `.emoji` sticker outer node;
- create base and optional badge `<img>` with `loading="lazy"` and
  `decoding="async"`;
- set palette/state classes through allowlists only;
- use `textContent` for native fallbacks;
- add at most one state decoration;
- preserve a readable `title`;
- never block drag/click handlers while images load.

`renderAction(document, target, {name, label, tone, size})` must use only the
allowlisted action map and set `aria-label` when visible text is absent.

- [ ] **Step 3: Define the shared visual tokens**

`frontend/icon-system.css` must define:

```css
:root {
  --element-icon-sidebar: 27px;
  --element-icon-canvas: 30px;
  --element-icon-detail: 40px;
  --action-icon-size: 16px;
  --action-icon-well: 25px;
}
```

Add six palette classes, white border, one small shadow, fixed per-element tilt
derived from a stable name hash, and state classes for starter/global-new/
personal-new/dragging/combine-target. The sticker graphic may shrink, but the
interactive `.element` box must not.

- [ ] **Step 4: Delegate combine feedback to the icon system**

Keep `window.COMBINE_FEEDBACK.renderElement` as a compatibility facade, but
replace its direct Emoji span construction with:

```js
window.ICON_SYSTEM.renderElement(doc, target, payload);
```

Update `renderToast` to create a dedicated icon target and call the same
renderer at detail size. Keep existing title/comment/publish text and tests.

- [ ] **Step 5: Verify and commit the component**

Run:

```bash
python3 -m pytest tests/test_combine_feedback.py -q
node --test tests-makers/frontend.test.mjs
```

Expected: PASS.

```bash
git add frontend/icon-system.js frontend/icon-system.css \
  frontend/combine-feedback.js tests/test_combine_feedback.py
git add -p tests-makers/frontend.test.mjs
git diff --cached
git commit -m "feat: add shared element and action icon renderer"
```

---

## Task 4: Migrate the Main Game to the Compact Three-Column UI

**Interfaces**

- **Consumes:** `ICON_SYSTEM.ready`, `{emoji, category, icon, is_starter}` from
  `/api/elements`, and the existing drag/combine state machine.
- **Produces:** a three-column sidebar, sticker-based canvas/recipes/toasts, and
  Phosphor action controls without changing gameplay semantics.

**Files**

- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Modify: `frontend/effects.js`
- Modify: `tests/test_combine_feedback.py`
- Modify: `tests-makers/frontend.test.mjs`

- [ ] **Step 1: Write failing main-surface contract tests**

Add checks for:

- `index.html` loads `icon-system.css`;
- `icon-system.js` loads before `combine-feedback.js` and `app.js`;
- all topbar/search/modal/recipe actions use `data-action-icon`;
- action buttons have visible text or `aria-label`;
- `app.js` awaits `ICON_SYSTEM.ready` before the first element render;
- `makeElementChip`, drag ghost, canvas spawn, recipe chip, score history and
  toast pass the whole element info including optional `icon`;
- operational buttons no longer begin with naked Emoji text.

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: FAIL on the old markup and function signatures.

- [ ] **Step 2: Make element info the unit passed through game state**

Change rendering/drag functions from positional `(name, emoji, ...)` data to:

```js
{
  name,
  emoji,
  category,
  icon,
  is_starter
}
```

Update these functions together:

- `makeElementChip`
- `spawnAtWorkspaceCenter`
- `onPointerDown`
- `spawnOnCanvas`
- `makeInteractiveRecipeChip`
- `rememberRecipe`
- `recordScoreEvent`

LocalStorage recipes and score events may gain `icon`, but readers must accept
old records that only contain `emoji`.

- [ ] **Step 3: Await manifests before first paint**

At the beginning of `init()`:

```js
await window.ICON_SYSTEM.ready;
await Promise.all([loadElements(), loadTiers()]);
window.ICON_SYSTEM.hydrateActions(document);
```

If `ready` resolves in fallback mode because manifest loading failed, continue
booting the game.

- [ ] **Step 4: Replace operational Emoji markup**

Use `data-action-icon` for:

- recipe book;
- KPI;
- clear canvas;
- first wall;
- help;
- search;
- reroll/confirm;
- export;
- close controls.

Keep decorative penguin/infinity branding as branding, not as an action icon.
Do not remove visible button labels on desktop.

- [ ] **Step 5: Apply the compact layout**

In `frontend/style.css`:

- make `.element-list` a three-column grid;
- use a 27px sticker in the sidebar;
- remove persistent category/source/use annotations from element cards;
- retain icon + name only;
- use 30px graphics on canvas/drag/recipe rows;
- preserve current pointer target dimensions;
- use 16px action SVGs inside 25px wells;
- add narrow-screen label folding while keeping `aria-label`;
- target 24–30 sidebar elements visible at the project’s standard desktop
  viewport.

- [ ] **Step 6: Protect Boss/URA mode**

Update `frontend/effects.js` so the mode still targets `.emoji`, replaces only
its inner visual content, and restores through `ICON_SYSTEM.renderElement`.
Store the original icon payload in a data property or WeakMap; do not infer it
from rendered `<img>` paths.

Extend the headless test to record each canvas element’s
`getBoundingClientRect()` before and after two Boss-mode toggles. Width and
height must be identical.

- [ ] **Step 7: Verify and commit the main game migration**

Run:

```bash
node --test tests-makers/frontend.test.mjs
python3 -m pytest tests/test_combine_feedback.py -q
```

Expected: PASS.

Stage only the intended overlapping files after reviewing their current diff:

```bash
git diff -- frontend/index.html frontend/app.js frontend/style.css frontend/effects.js
git add frontend/app.js frontend/style.css frontend/effects.js \
  tests/test_combine_feedback.py
git add -p frontend/index.html tests-makers/frontend.test.mjs
git diff --cached
git commit -m "feat: apply compact sticker icons to the game"
```

---

## Task 5: Migrate Wall, Community, and Admin Surfaces

**Interfaces**

- **Consumes:** the same static maps plus optional `icon` fields already present
  in API payloads.
- **Produces:** consistent large-format element stickers and Phosphor actions
  across every secondary page.

**Files**

- Modify: `frontend/wall/index.html`
- Modify: `frontend/wall/wall.js`
- Modify: `frontend/wall/wall.css`
- Modify: `frontend/community.html`
- Modify: `frontend/community.js`
- Modify: `frontend/community-admin.html`
- Modify: `frontend/community-admin.js`
- Modify: `frontend/community.css`
- Modify: `frontend/admin/index.html`
- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/build.test.mjs`
- Modify: `tests-makers/frontend.test.mjs`

- [ ] **Step 1: Add failing coverage checks**

Tests must assert that every HTML entry loads `icon-system.css` and
`icon-system.js` before its page script, and that:

- wall cards, bounty chips and recipe pills use `renderElement`;
- community formula titles render result/input elements as stickers;
- vote/publish/back/expand/close/search operations use Phosphor actions;
- admin recent-first rows use the same icon renderer;
- direct `innerHTML` templates never interpolate an API `icon`, name or Emoji
  into executable markup.

Run:

```bash
node --test tests-makers/frontend.test.mjs tests-makers/build.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Refactor wall rendering from HTML strings to safe nodes**

For element-bearing views, replace raw string templates with DOM builders and
call:

```js
window.ICON_SYSTEM.renderElement(document, iconTarget, {
  name: item.result ?? item.name,
  emoji: item.emoji,
  category: item.category,
  icon: item.icon,
  state: item.is_starter ? "starter" : null,
  size: "detail",
});
```

Apply this to:

- first discovery cards;
- discovered/undiscovered bounty chips;
- recipe modal result and both ingredients.

Search highlighting remains text-only; do not rebuild sticker HTML from
highlighted strings.

- [ ] **Step 3: Migrate wall actions and sizes**

Use 36–44px element stickers for first cards and detail views. Use action
icons for search, collapse, vote, close and navigation. Keep visible text where
space allows and accessible names everywhere.

- [ ] **Step 4: Migrate community pages**

Load `/api/elements` alongside formula/queue data and resolve input/result
records by name so dynamic persisted icons can render. Fall back to each
formula’s `emoji` for old records.

Replace thumbs and shield-style operational Emoji with `renderAction`.
Preserve existing vote values, moderation actions and confirmation behavior.

- [ ] **Step 5: Migrate the inline admin page**

Load the icon system before the inline admin script. Replace recent-first
Emoji cells and operational labels with shared render calls. Do not change
admin authentication, token handling, refresh cadence or analytics logic.

- [ ] **Step 6: Make the build require all new public entries**

Extend `REQUIRED_ENTRIES` in `scripts/build-makers.mjs` with:

```js
"icon-system.css",
"icon-system.js",
"assets/icons/generated/emoji-icon-manifest.json",
"assets/icons/generated/element-icon-map.json",
"assets/icons/actions/trash.svg",
"community.html",
"community-admin.html",
```

Update `tests-makers/build.test.mjs` to assert these files are copied and that
no built HTML contains a third-party icon CDN.

- [ ] **Step 7: Verify and commit secondary surfaces**

Run:

```bash
node --test tests-makers/frontend.test.mjs tests-makers/build.test.mjs
npm run build
```

Expected: PASS.

```bash
git diff -- frontend/wall/index.html frontend/wall/wall.js \
  frontend/wall/wall.css frontend/admin/index.html
git add frontend/community.html frontend/community.js \
  frontend/community-admin.html frontend/community-admin.js \
  frontend/community.css frontend/admin/index.html \
  scripts/build-makers.mjs tests-makers/build.test.mjs
git add -p frontend/wall/index.html frontend/wall/wall.js \
  frontend/wall/wall.css tests-makers/frontend.test.mjs
git diff --cached
git commit -m "feat: unify icons across wall and admin surfaces"
```

---

## Task 6: Add Python Icon Resolution, Persistence, and API Fields

**Interfaces**

- **Consumes:** `backend/icon_rules.json`, generated preset map, element name,
  Emoji, category, parents, chain and comment.
- **Produces:** a stable Python `IconRecipe`, SQLite `icon_json`, and optional
  `icon` fields on element/combine/wall/recipe payloads.

**Files**

- Create: `backend/icon_recipes.py`
- Create: `tests/fixtures/icon-resolution-cases.json`
- Create: `tests/test_icon_recipes.py`
- Modify: `backend/archive.py`
- Modify: `backend/seed_loader.py`
- Modify: `backend/main.py`
- Modify: `backend/bounty.py`
- Modify: `tests/test_comments.py` or the closest existing API test module

- [ ] **Step 1: Write failing resolver and archive tests**

`tests/fixtures/icon-resolution-cases.json` must include:

```json
[
  {
    "name": "Riot",
    "emoji": "⚡",
    "category": "studio",
    "parents": [],
    "comment": "",
    "expected": {
      "base": "👊",
      "badge": "🎮",
      "palette": "studio",
      "source": "curated"
    }
  },
  {
    "name": "智能咖啡",
    "emoji": "☕",
    "category": "ai",
    "parents": ["AI", "咖啡"],
    "comment": "咖啡完成智能升级",
    "expected": {
      "base": "☕",
      "badge": "🧠",
      "palette": "product",
      "source": "generated"
    }
  }
]
```

Tests must cover:

- exact preset override;
- persisted recipe precedence;
- deterministic dynamic result;
- malformed recipe fallback;
- old SQLite schema migration;
- JSON round-trip through `archive.upsert_element()` / `all_elements()`;
- old rows without `icon_json` derive a recipe without failing startup.

Run:

```bash
python3 -m pytest tests/test_icon_recipes.py -q
```

Expected: FAIL because `backend.icon_recipes` does not exist.

- [ ] **Step 2: Implement the Python resolver**

`backend/icon_recipes.py` 的接口契约：

```text
normalize_icon(value: object) -> dict | None
preset_icon(name: str) -> dict | None
resolve_icon_recipe(
  *,
  name: str,
  emoji: str,
  category: str | None,
  parents: tuple[str, ...] = (),
  chain: str | None = None,
  comment: str = "",
  persisted: object = None
) -> dict
attach_icon(name: str, info: dict) -> dict
```

Use exact-match knowledge first. Dynamic rules must be deterministic and read
only the shared JSON rule data; no model or embedding call is allowed.

- [ ] **Step 3: Add the SQLite migration**

In `archive.init_archive()`:

```sql
ALTER TABLE elements ADD COLUMN icon_json TEXT;
```

Guard it through `PRAGMA table_info(elements)`.

Update:

```python
upsert_element(
    name: str,
    emoji: str,
    category: Optional[str],
    is_starter: bool = False,
    icon: Optional[dict] = None,
) -> None
```

On conflict, fill `icon_json` only when the stored value is null/empty. Do not
overwrite a persisted dynamic signature. Decode invalid historic JSON as
missing rather than crashing.

- [ ] **Step 4: Enrich seed and historical elements**

In `SeedStore.load()`:

- attach preset icons to starters and all seed entries;
- attach persisted icons to archived dynamic elements;
- deterministically derive and backfill an icon only for old dynamic rows that
  lack one.

The in-memory shape becomes:

```python
{
  "emoji": "👊",
  "category": "studio",
  "icon": {
    "base": "👊",
    "badge": "🎮",
    "palette": "studio",
    "source": "curated"
  }
}
```

- [ ] **Step 5: Extend Python API payloads additively**

Add `icon: Optional[dict] = None` to `CombineResp`.

During combine:

1. resolve the result recipe from persisted hit or seed map;
2. for a new dynamic result, use `(a, b)`, chain and comment;
3. save it with the element;
4. return it on the combine response.

Attach current element icons to:

- `/api/elements`;
- wall recent/page/SSE rows;
- bounty/category items;
- admin recent firsts;
- community formula result/input projections;
- `/api/element/{name}/recipes` as `result_icon`, `a_icon`, `b_icon`.

Old clients must still receive every existing field unchanged.

- [ ] **Step 6: Verify Python behavior**

Run:

```bash
python3 -m pytest tests/test_icon_recipes.py -q
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: PASS.

- [ ] **Step 7: Commit Python support**

Review the pre-existing overlapping diffs before staging:

```bash
git diff -- backend/main.py
git add backend/icon_recipes.py backend/archive.py backend/seed_loader.py \
  tests/fixtures/icon-resolution-cases.json tests/test_icon_recipes.py
git add -p backend/main.py backend/bounty.py
git diff --cached
git commit -m "feat: persist icon recipes in the local backend"
```

---

## Task 7: Add Makers Icon Resolution and KV Persistence

**Interfaces**

- **Consumes:** generated `ICON_RULES` / `ELEMENT_ICONS`, the same shared
  resolution fixture, and flexible Makers JSON records.
- **Produces:** parity with Python, stable dynamic `icon` fields in KV, and
  enriched Makers API responses.

**Files**

- Create: `edge-functions/_lib/icon-recipes.js`
- Create: `tests-makers/icon-recipes.test.mjs`
- Modify: `scripts/generate-makers-data.mjs`
- Modify: `edge-functions/_lib/kv-store.js`
- Modify: `edge-functions/_lib/game-service.js`
- Modify: `edge-functions/_lib/router.js`
- Modify: `edge-functions/_lib/bounty.js`
- Modify: `tests-makers/seed-data.test.mjs`
- Modify: `tests-makers/kv-store.test.mjs`
- Modify: `tests-makers/game-service.test.mjs`
- Modify: `tests-makers/router.test.mjs`

- [ ] **Step 1: Write failing JavaScript parity tests**

Read `tests/fixtures/icon-resolution-cases.json` and assert every row matches
`resolveIconRecipe()` exactly. Add KV tests that:

- preserve an existing icon when `rememberElement` runs again;
- save the first generated dynamic icon;
- expose icon through `dynamicElements()`;
- tolerate legacy records without icon.

Add game/router tests for optional combine, elements, wall, bounty and recipe
icon fields.

Run:

```bash
node --test tests-makers/icon-recipes.test.mjs \
  tests-makers/kv-store.test.mjs \
  tests-makers/game-service.test.mjs \
  tests-makers/router.test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Implement the Makers resolver**

`edge-functions/_lib/icon-recipes.js` 的接口契约：

```text
normalizeIcon(value) -> IconRecipe | null
presetIcon(name) -> IconRecipe | null
resolveIconRecipe({
  name,
  emoji,
  category,
  parents = [],
  chain = null,
  comment = "",
  persisted = null
}) -> IconRecipe
attachIcon(name, info) -> ElementInfo
```

The output for every shared fixture must be byte-for-byte JSON equivalent to
the Python output.

- [ ] **Step 3: Include preset icons in generated Makers elements**

Update `scripts/generate-makers-data.mjs` to read
`frontend/assets/icons/generated/element-icon-map.json` and merge each
entry’s `icon` into `ELEMENTS[name]`. Fail if any seed element lacks an entry.

Regenerate:

```bash
npm run generate:makers-data
```

- [ ] **Step 4: Persist icons in KV without breaking legacy records**

In `KvStore.putCombination()`, include a normalized optional `icon`.
Pass it to `rememberElement()`.

In `rememberElement()`:

- accept `info.icon`;
- keep `existing.icon` if the caller has none;
- never replace a valid existing icon with a newly derived one;
- continue stripping storage metadata from public element values.

- [ ] **Step 5: Resolve dynamic icons once**

In `game-service.js`:

- generate the dynamic recipe before `putCombination()`;
- pass parents, comment and category context;
- for seed/cache hits without icon, call the resolver;
- remember and return the resulting `icon`;
- leave the `FALLBACK` response valid when icon generation fails.

- [ ] **Step 6: Enrich Makers projections**

Add icon fields to the same projections as Python:

- combined elements;
- combine response;
- wall page/recent/admin firsts;
- bounty/category;
- community formulas;
- recipe result and both inputs.

Use a router helper that joins first/formula rows with the current combined
element map. Do not duplicate icon recipes into immutable first-discovery
records.

- [ ] **Step 7: Verify parity and commit**

Run:

```bash
npm run generate:makers-data
node --test tests-makers/icon-recipes.test.mjs \
  tests-makers/seed-data.test.mjs \
  tests-makers/kv-store.test.mjs \
  tests-makers/game-service.test.mjs \
  tests-makers/router.test.mjs
```

Expected: PASS.

Review overlapping files before staging:

```bash
git diff -- edge-functions/_lib/router.js edge-functions/_lib/bounty.js
git add edge-functions/_lib/icon-recipes.js \
  edge-functions/_lib/kv-store.js edge-functions/_lib/game-service.js \
  edge-functions/_generated/seed-data.js scripts/generate-makers-data.mjs \
  tests-makers/icon-recipes.test.mjs tests-makers/seed-data.test.mjs \
  tests-makers/kv-store.test.mjs tests-makers/game-service.test.mjs
git add -p edge-functions/_lib/router.js edge-functions/_lib/bounty.js \
  tests-makers/router.test.mjs
git diff --cached
git commit -m "feat: persist icon recipes in Makers KV"
```

---

## Task 8: Integrate Build Gates and Complete System Verification

**Interfaces**

- **Consumes:** all committed generated assets, mapping data, frontend pages and
  both runtime implementations.
- **Produces:** reproducible builds, regression evidence and a final clean
  handoff without staging unrelated work.

**Files**

- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/build.test.mjs`
- Modify: `README.md`
- Modify: `docs/icon-system-audit.md` only through its generator

- [ ] **Step 1: Make the normal build validate, never regenerate, local assets**

At the start of `buildMakersSite()`:

```js
await validateCommittedIconAssets({ root: ROOT });
await auditCommittedIconMap({ root: ROOT });
await generateMakersData();
```

The validator and audit functions must not read `words/`. `npm run build`
should succeed in a checkout that contains only tracked files plus installed
dependencies.

- [ ] **Step 2: Add reproducibility tests**

`tests-makers/build.test.mjs` must copy the repo fixture without `words/`, run
the validators, and prove:

- generated assets remain usable;
- build output contains all required icon files;
- no page contains a runtime third-party icon/Emoji CDN;
- the generated map and Makers data have the same 591 recipes.

- [ ] **Step 3: Document maintainer workflows**

Add a concise README section:

```text
npm run generate:icons      # requires ignored words/emoji-data and dev deps
npm run generate:icon-data  # rebuilds preset mappings
npm run audit:icons         # semantic and duplicate gates
npm run build               # validates committed assets; no words/ dependency
```

Document the fallback chain and the rule that entity edits belong in
`backend/icon_knowledge.json`, not generated JSON.

- [ ] **Step 4: Scan for placeholders and unsafe direct rendering**

Run:

```bash
rg -n "TODO|FIXME|placeholder|coming soon|similar to" \
  scripts backend/icon_recipes.py edge-functions/_lib/icon-recipes.js \
  frontend/icon-system.js docs/icon-system-audit.md
rg -n "innerHTML.*(emoji|icon)|\\$\\{.*emoji|data:image/svg\\+xml.*text" frontend
rg -n "cdn\\.jsdelivr|unpkg|cdnjs|phosphoricons\\.com" frontend
```

Expected:

- first command returns no implementation placeholders;
- second returns no unsafe API-driven icon interpolation or old Emoji favicon;
- third returns no runtime icon CDN.

- [ ] **Step 5: Run mapping and focused icon verification**

```bash
npm run verify:icons
npm run audit:icons
node --test tests-makers/icon-assets.test.mjs \
  tests-makers/icon-data.test.mjs \
  tests-makers/icon-recipes.test.mjs
python3 -m pytest tests/test_icon_recipes.py \
  tests/test_combine_feedback.py -q
```

Expected: all PASS; audit reports 591 mappings and less than 10% duplicate full
signatures.

- [ ] **Step 6: Run required repository verification**

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: all PASS.

If EdgeOne CLI is available to the deployment maintainer, also run:

```bash
npm run makers:build
```

Expected: PASS without downloading icon assets at build time.

- [ ] **Step 7: Perform browser acceptance checks**

At desktop and narrow mobile widths verify:

1. sidebar is three columns and shows approximately 24–30 elements initially;
2. sidebar persists only sticker + name;
3. canvas, ghost and recipe stickers are 30px while hit areas remain usable;
4. wall/detail stickers are 36–44px;
5. Riot displays fist + game badge, Epic shield + game badge, COO role +
   operations;
6. blocked base image falls back to native Emoji; blocked badge hides only the
   badge;
7. keyboard focus and accessible names remain present on icon-only controls;
8. Boss mode on/off leaves canvas item rectangles and positions unchanged;
9. no third-party network request is made.

- [ ] **Step 8: Review the final diff and commit integration-only changes**

```bash
git status --short
git diff --check
git diff -- scripts/build-makers.mjs tests-makers/build.test.mjs README.md
git add scripts/build-makers.mjs tests-makers/build.test.mjs README.md \
  docs/icon-system-audit.md
git commit -m "build: enforce icon asset and mapping gates"
```

Do not stage any pre-existing unrelated modified or untracked path.

- [ ] **Step 9: Final self-review against the design**

Compare the implementation to every acceptance item in
`docs/superpowers/specs/2026-07-28-unified-icon-system-design.md`. Confirm:

- all 591 preset mappings are explicit in the generated map;
- entity semantics and rationales are present;
- Python and JavaScript fixtures agree;
- `emoji` compatibility remains;
- fallback order is implemented;
- secondary text removal and compact sizing match the approved direction;
- licenses and build provenance are committed;
- no task left a placeholder or unverified generated artifact.
