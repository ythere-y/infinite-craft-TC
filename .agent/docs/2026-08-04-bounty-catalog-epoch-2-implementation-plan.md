# Bounty Catalog Content Epoch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated bounty lists with one researched Tencent/Internet nostalgia catalog, make every bounty target reachable from eleven explicit starters, and migrate local SQLite/Redis plus Makers KV to content epoch 2 without reviving stale formulas.

**Architecture:** `content/tencent-bounty-catalog.json` is the only source for Tencent bounty targets, aliases, supporting recipes, retired formulas, and relationship evidence. A deterministic Node compiler emits a Python JSON artifact and an Edge JavaScript artifact; Python and Makers merge those artifacts with the unchanged generic seed graph. A content-epoch state machine hard-resets epoch 1 test data once, then uses catalog digests and explicit retirements for non-destructive epoch 2 updates.

**Tech Stack:** Python 3, FastAPI, SQLite, Redis, Node.js ESM, Node test runner, EdgeOne Makers Cloud Functions, Makers KV.

## Global Constraints

- Work directly in `/data/workspace/06.infinity_craft`; do not create a Git worktree.
- The exact starters are `水、火、风、土、企鹅、人、时间、AI、电脑、手机、网络`.
- Preserve every existing `classic` recipe key and result.
- `微信` and `工位` remain elements but are no longer starters.
- Every bounty target has exactly one canonical fixed recipe and is reachable from the eleven explicit starters.
- Do not treat input-only elements as implicit starters.
- Fixed recipes win before governed dynamic formulas and AI; AI may discover an alternate route but cannot replace a canonical recipe.
- The public category is `association`; `invest` exists only as epoch 1 migration input.
- Content epoch is exactly `2`. Epoch changes are destructive; catalog digest changes within epoch 2 are differential.
- Epoch 2 deletes all Infinity Craft test gameplay data, including user progress, discoveries, dynamic formulas, indexes, and cached depths.
- Never edit `dump.rdb` directly. Reset Redis through its protocol.
- Local development must not authenticate to EdgeOne or access Makers KV.
- Makers production keeps the `test → infinite_craft` binding and Makers Models.
- Record the starting `git status --short`; preserve and never stage unrelated pre-existing changes from other developers.
- Do not commit `.env`, credentials, SQLite files, Redis dumps, logs, or other runtime data.
- Relationship records require first-party announcements, regulatory filings, investor-relations material, or a transaction counterparty announcement.
- Required final verification is `npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and `npm run build`; a deployment maintainer additionally runs `npm run makers:build`.

---

## File and Responsibility Map

### New source and generated content

- `content/tencent-bounty-catalog.json`: authoritative groups, targets, aliases, canonical recipes, support elements/recipes, relationship evidence, retired pairs, and retired elements.
- `scripts/bounty-content-lib.mjs`: pure validation, normalization, reachability, canonical serialization, digest, and artifact serialization.
- `scripts/generate-bounty-content.mjs`: CLI wrapper that reads sources and writes both runtime artifacts.
- `backend/generated/bounty-content.json`: checked-in Python runtime artifact.
- `edge-functions/_generated/bounty-content.js`: checked-in Makers runtime artifact, following the repository's existing `_generated` convention.
- `backend/content_catalog.py`: Python loader that merges generic seeds with generated bounty content and resolves aliases.

### Local epoch support

- `backend/content_epoch.py`: local epoch/digest state machine and Redis reset/differential cleanup coordination.
- `tests/test_content_epoch.py`: SQLite/Redis epoch migration tests.

### Makers epoch support

- `edge-functions/_lib/content-initializer.js`: resumable KV migration, seeding, differential synchronization, and readiness status.
- `tests-makers/content-initializer.test.mjs`: interruption, idempotency, concurrency, purge, and same-epoch synchronization tests.

### Existing files with focused changes

- `backend/seed_elements.json`: eleven starters, generic elements, and category metadata.
- `backend/seed_combinations.json`: generic recipes only; preserve `classic`, remove migrated Tencent bounty recipes and bad formulas.
- `backend/seed_loader.py`: load merged content rather than the two base JSON files directly.
- `backend/depth.py`: calculate and replace exact fixed depths from explicit starters only.
- `backend/bounty.py`: retain payload/discovery helpers but consume generated group definitions.
- `backend/archive.py`: add durable content state and transactional gameplay reset/differential retirement functions.
- `backend/db.py`: add Redis gameplay reset and retired-key deletion helpers.
- `backend/main.py`: run epoch preparation before archive warm-up and expose epoch health.
- `backend/icon_rules.json`: map `association` to an existing palette and remove the obsolete `invest` mapping.
- `backend/icon_knowledge.json`: rename curated entities to catalog canonical names and retain reviewed icons.
- `backend/icon_recipes.py`: remove the obsolete hard-coded “591 element” description.
- `scripts/generate-makers-data.mjs`: merge base and bounty content and calculate strict depths.
- `scripts/generate-icon-data.mjs`: generate icons from merged elements/recipes.
- `scripts/audit-icon-map.mjs`: audit against merged elements.
- `scripts/build-makers.mjs`: generate bounty content first and derive expected icon count instead of hard-coding 591.
- `scripts/trace_recipe.py`: consume merged content, remove the deleted `HALL_OF_FAME` reference, and report strict bounty reachability.
- `scripts/validate_seed.py`: validate merged fixed formulas and catalog digest.
- `package.json`: expose `generate:bounty-content` and put it before dependent generators.
- `edge-functions/_lib/bounty.js`: use generated groups and aliases instead of handwritten lists.
- `edge-functions/_lib/game-service.js`: normalize aliases before fixed/dynamic/AI lookup.
- `edge-functions/_lib/kv-store.js`: support seed ownership, exact deletion, and index removal for synchronization.
- `edge-functions/_lib/router.js`: expose epoch health supplied by the request entrypoint.
- `edge-functions/api/[[default]].js`: call initialization before constructing/handling the game router.
- `tests/test_bounty.py`, `tests/test_seed_reconciliation.py`: update legacy expectations.
- `tests-makers/seed-data.test.mjs`, `tests-makers/icon-data.test.mjs`, `tests-makers/build.test.mjs`, `tests-makers/router.test.mjs`: assert merged content and epoch 2 behavior.
- Generated icon/seed artifacts: regenerate from committed sources; never hand-edit.

---

### Task 1: Deterministic Bounty Catalog Compiler

**Files:**
- Create: `scripts/bounty-content-lib.mjs`
- Test: `tests-makers/bounty-content-generation.test.mjs`

**Interfaces:**
- Consumes: plain catalog/base-seed objects passed by tests.
- Produces:
  - `normalizePair(a: string, b: string): string`
  - `compileBountyContent({ catalog, seedElements, seedCombinations }): CompiledBountyContent`
  - `serializePythonArtifact(compiled): string`
  - `serializeEdgeArtifact(compiled): string`

- [ ] **Step 1: Write failing compiler validation tests**

Add tests that use a small valid catalog fixture and verify strict invariants:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compileBountyContent,
  normalizePair,
} from "../scripts/bounty-content-lib.mjs";

const starters = [
  "水", "火", "风", "土", "企鹅", "人",
  "时间", "AI", "电脑", "手机", "网络",
];

function fixture() {
  return {
    catalog: {
      meta: { content_epoch: 2, version: "2.0.0" },
      tabs: [{ key: "tencent", label: "腾讯互联网", emoji: "🐧" }],
      groups: [{
        key: "qq_memory",
        category: "qq_memory",
        label: "QQ时代记忆",
        emoji: "💬",
        tab: "tencent",
        targets: ["QQ"],
      }],
      targets: {
        QQ: {
          emoji: "🐧",
          category: "qq_memory",
          aliases: [],
          canonical_recipe: {
            a: "企鹅",
            b: "聊天",
            chain: "qq_memory",
            comment: "企鹅遇上即时聊天，QQ上线。",
          },
        },
      },
      support_elements: {
        互联网: { emoji: "🌐", category: "internet" },
        聊天: { emoji: "💬", category: "social" },
      },
      support_recipes: {
        "电脑 + 网络": {
          result: "互联网", emoji: "🌐", chain: "internet",
        },
        "人 + 互联网": {
          result: "聊天", emoji: "💬", chain: "social",
        },
      },
      retired_pairs: [],
      retired_elements: [],
    },
    seedElements: {
      starters: starters.map((name) => ({
        id: name, name, emoji: "🧩", category: "classic",
      })),
      elements: Object.fromEntries(
        starters.map((name) => [
          name, { emoji: "🧩", category: "classic" },
        ]),
      ),
    },
    seedCombinations: { combinations: {} },
  };
}

test("catalog compiler normalizes pairs and proves strict reachability", () => {
  const compiled = compileBountyContent(fixture());
  assert.equal(normalizePair("网络", "电脑"), "电脑 + 网络");
  assert.equal(compiled.content_epoch, 2);
  assert.equal(compiled.depths.QQ, 3);
  assert.equal(compiled.combinations["企鹅 + 聊天"].result, "QQ");
  assert.match(compiled.catalog_digest, /^sha256:[a-f0-9]{64}$/u);
});

test("catalog compiler rejects duplicate groups, aliases, and pair results", () => {
  const input = fixture();
  input.catalog.targets.QQ.aliases = ["企鹅"];
  assert.throws(
    () => compileBountyContent(input),
    /alias.*collides.*element/iu,
  );
});

test("catalog compiler rejects input-only shortcuts and unreachable targets", () => {
  const input = fixture();
  delete input.catalog.support_recipes["人 + 互联网"];
  assert.throws(
    () => compileBountyContent(input),
    /unreachable.*聊天|QQ.*unreachable/iu,
  );
});
```

- [ ] **Step 2: Run the compiler test and confirm the missing module failure**

Run:

```bash
node --test tests-makers/bounty-content-generation.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/bounty-content-lib.mjs`.

- [ ] **Step 3: Implement pair normalization, validation, strict depth relaxation, and digesting**

Implement a pure compiler using `node:crypto`:

```js
import { createHash } from "node:crypto";

export function normalizePair(a, b) {
  return [String(a).trim(), String(b).trim()].sort().join(" + ");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}
```

The compiler must:

1. Require epoch `2`.
2. Require unique group keys/categories and one primary group per target.
3. Require every non-starter target to have one canonical recipe.
4. Reject aliases colliding with canonical names, starters, or other aliases.
5. Reject unordered pair conflicts across base, support, and target recipes.
6. Build depths from only `seedElements.starters`; never add input-only names.
7. Reject unreachable recipe inputs, targets, unused support elements, and targets at depth 0.
8. Validate relationship kinds against `subsidiary`, `equity_investment`, `licensed_partner`, and `historical_association`.
9. Require `as_of`, `source_url`, `source_title`, and `note` for association targets.
10. Compute the digest over normalized source inputs, then include it in the compiled payload.

- [ ] **Step 4: Run compiler tests**

Run:

```bash
node --test tests-makers/bounty-content-generation.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the compiler**

```bash
git add scripts/bounty-content-lib.mjs tests-makers/bounty-content-generation.test.mjs
git commit -m "feat: add strict bounty catalog compiler"
```

---

### Task 2: Populate and Generate the Epoch 2 Catalog

**Files:**
- Create: `content/tencent-bounty-catalog.json`
- Create: `scripts/generate-bounty-content.mjs`
- Create: `backend/generated/bounty-content.json`
- Create: `edge-functions/_generated/bounty-content.js`
- Modify: `package.json`
- Modify: `backend/seed_elements.json`
- Modify: `backend/seed_combinations.json`
- Test: `tests-makers/bounty-content-generation.test.mjs`

**Interfaces:**
- Consumes: compiler from Task 1 and the two generic seed JSON files.
- Produces:
  - `generateBountyContent({ root?: string }): Promise<{ digest, outputs }>`
  - generated constants `CONTENT_EPOCH`, `CATALOG_DIGEST`, `BOUNTY_TABS`, `BOUNTY_GROUPS`, `BOUNTY_ELEMENTS`, `BOUNTY_COMBINATIONS`, `BOUNTY_RECIPES_BY_RESULT`, `BOUNTY_ALIASES`, `RETIRED_PAIRS`, and `RETIRED_ELEMENTS`.

- [ ] **Step 1: Extend the test with exact epoch 2 content expectations**

Add exact high-risk assertions:

```js
const EXPECTED_STARTERS = [
  "水", "火", "风", "土", "企鹅", "人",
  "时间", "AI", "电脑", "手机", "网络",
];
const EXPECTED_STUDIOS = [
  "天美工作室群", "光子工作室群", "魔方工作室群", "北极光工作室群",
  "NExT Studios", "Team Jade", "MoreFun Studios", "Aurora Studio",
  "LIGHTSPEED LA", "Uncapped Games", "Quantum Studio", "S Studio",
  "R Studio", "TiKi Studio",
];
const EXPECTED_ASSOCIATIONS = [
  "Riot Games", "Supercell", "Epic Games", "Funcom", "Sumo Group",
  "Digital Extremes", "Sharkmob", "Grinding Gear Games",
  "Klei Entertainment", "Miniclip", "腾讯音乐娱乐集团", "阅文集团",
  "微众银行", "Ubisoft", "Techland", "Remedy Entertainment",
  "Paradox Interactive", "PlatinumGames", "KADOKAWA", "Sea",
  "Spotify", "Snap", "Reddit", "快手", "哔哩哔哩", "拼多多", "蔚来",
  "小红书", "知乎", "京东", "美团", "Neople", "Smilegate",
  "第七大道", "Take-Two", "EA", "Activision", "Nexon", "KRAFTON",
  "NCSoft",
];
const REQUIRED_NOSTALGIA = [
  "QQ游戏", "QQ游戏大厅", "QQ宠物", "QQ农场", "QQ牧场", "QQ餐厅",
  "抢车位", "黄钻", "红钻", "绿钻", "蓝钻", "紫钻", "粉钻",
  "黑钻", "你是GG还是MM", "滴滴滴", "窗口抖动", "隐身上线",
  "踩空间", "偷菜",
];
const REQUIRED_GAMES = [
  "QQ堂", "QQ幻想", "QQ三国", "QQ飞车", "QQ炫舞", "QQ音速",
  "洛克王国", "Q宠大乐斗", "弹弹堂", "穿越火线", "DNF", "寻仙",
  "逆战", "剑灵", "上古世纪", "使命召唤Online", "NBA2K Online",
  "FIFA Online", "天涯明月刀", "御龙在天", "轩辕传奇", "斗战神",
  "节奏大师", "天天酷跑", "天天爱消除", "全民飞机大战",
];

test("committed epoch 2 catalog locks the approved roster", async () => {
  const [seed, artifact] = await Promise.all([
    readFile("backend/seed_elements.json", "utf8").then(JSON.parse),
    readFile("backend/generated/bounty-content.json", "utf8").then(JSON.parse),
  ]);
  const targetsFor = (key) =>
    artifact.bounty.groups.find((group) => group.key === key)?.targets;
  assert.deepEqual(seed.starters.map((item) => item.name), EXPECTED_STARTERS);
  assert.deepEqual(targetsFor("studio"), EXPECTED_STUDIOS);
  assert.deepEqual(targetsFor("association"), EXPECTED_ASSOCIATIONS);
  for (const name of [...REQUIRED_NOSTALGIA, ...REQUIRED_GAMES]) {
    assert.ok(artifact.elements[name], `missing ${name}`);
    assert.ok(artifact.canonical_recipes[name], `missing recipe for ${name}`);
  }
  assert.equal(targetsFor("association").length, 40);
  assert.equal(artifact.aliases["Q宠大乱斗"], "Q宠大乐斗");
  assert.equal(artifact.aliases.CF, "穿越火线");
  assert.equal(artifact.aliases["地下城与勇士"], "DNF");
});
```

- [ ] **Step 2: Run the roster test and confirm missing catalog/artifact failure**

Run:

```bash
node --test tests-makers/bounty-content-generation.test.mjs
```

Expected: FAIL because the catalog and generated artifact do not exist.

- [ ] **Step 3: Change the generic seed starter list without changing classic recipes**

Set `backend/seed_elements.json` starters, in order, to:

```json
[
  {"id":"water","name":"水","emoji":"💧","category":"classic"},
  {"id":"fire","name":"火","emoji":"🔥","category":"classic"},
  {"id":"wind","name":"风","emoji":"🌬️","category":"classic"},
  {"id":"earth","name":"土","emoji":"🌍","category":"classic"},
  {"id":"penguin","name":"企鹅","emoji":"🐧","category":"tencent"},
  {"id":"person","name":"人","emoji":"🧍","category":"social"},
  {"id":"time","name":"时间","emoji":"⏳","category":"physical"},
  {"id":"ai","name":"AI","emoji":"🤖","category":"abstract"},
  {"id":"computer","name":"电脑","emoji":"💻","category":"internet"},
  {"id":"phone","name":"手机","emoji":"📱","category":"internet"},
  {"id":"network","name":"网络","emoji":"🌐","category":"internet"}
]
```

Add `internet`, `qq_memory`, `tencent_game`, and `association` category descriptions. Keep 微信 and 工位 in `elements`, but remove their starter status by virtue of the new list.

Before editing formulas, save a test fixture of every existing `chain == "classic"` pair/result so the compiler test can prove the classic mapping is byte-for-byte equivalent after the migration.

- [ ] **Step 4: Author the complete catalog from the approved design**

Use this top-level shape:

```json
{
  "meta": {"content_epoch": 2, "version": "2.0.0"},
  "tabs": [{"key": "tencent", "label": "腾讯互联网", "emoji": "🐧"}],
  "groups": [],
  "targets": {},
  "support_elements": {},
  "support_recipes": {},
  "retired_pairs": [],
  "retired_elements": []
}
```

Transcribe all approved QQ-memory, game, studio, current-product, culture, building, level, and association names from the design document. Each target record must contain its actual emoji, category, aliases, canonical recipe, and factual metadata.

Use the stable group keys, in display order:

```text
culture, qq_memory, tencent_game, product,
studio, campus, level, association
```

Before committing the 40 association records, verify each relationship against current first-party material on the internet. Prefer Tencent or target-company investor-relations disclosures, official acquisition/investment announcements, regulatory filings, and official game publishing pages. Record the exact `relationship_kind`, `as_of`, `source_url`, `source_title`, and a concise `note` in every association target. Do not infer equity ownership from a publishing partnership, and use `licensed_partner` or `historical_association` when that is all the evidence supports.

Include these required bridges exactly:

```text
人 + 电脑 → 工位
电脑 + 网络 → 互联网
手机 + 网络 → 移动互联网
人 + 互联网 → 聊天
企鹅 + 互联网 → 腾讯
企鹅 + 聊天 → QQ
腾讯 + 移动互联网 → 微信
微信 + 短视频 → 视频号
腾讯 + 短视频 → 微视
腾讯 + 云盘 → 微云
```

Include every known invalid old pair in `retired_pairs`, including:

```text
DNF + 工作室
工作室 + 穿越火线
云 + 微信
人情 + 鹅厂
堡垒之夜 + 收购
打工鹅 + 时间
拳头 + 收购
视频号 + 鹅厂
```

Remove Tencent bounty recipes migrated to the catalog from `backend/seed_combinations.json`. Do not delete or change any classic pair/result.

- [ ] **Step 5: Implement the generator CLI and artifact serializers**

`scripts/generate-bounty-content.mjs` reads the three sources, calls the compiler, creates parent directories, and writes a newline-terminated JSON artifact plus an ESM module:

```js
export async function generateBountyContent({ root = ROOT } = {}) {
  const compiled = compileBountyContent({
    catalog: await readJson(resolve(root, "content/tencent-bounty-catalog.json")),
    seedElements: await readJson(resolve(root, "backend/seed_elements.json")),
    seedCombinations: await readJson(
      resolve(root, "backend/seed_combinations.json"),
    ),
  });
  await writeFile(
    resolve(root, "backend/generated/bounty-content.json"),
    serializePythonArtifact(compiled),
  );
  await writeFile(
    resolve(root, "edge-functions/_generated/bounty-content.js"),
    serializeEdgeArtifact(compiled),
  );
  return {
    digest: compiled.catalog_digest,
    outputs: [
      "backend/generated/bounty-content.json",
      "edge-functions/_generated/bounty-content.js",
    ],
  };
}
```

Add:

```json
"generate:bounty-content": "node scripts/generate-bounty-content.mjs"
```

to `package.json`.

- [ ] **Step 6: Generate both artifacts and rerun catalog tests**

Run:

```bash
npm run generate:bounty-content
node --test tests-makers/bounty-content-generation.test.mjs
```

Expected: generator reports one digest and two outputs; tests PASS.

- [ ] **Step 7: Commit catalog sources and artifacts**

```bash
git add content/tencent-bounty-catalog.json scripts/generate-bounty-content.mjs package.json backend/seed_elements.json backend/seed_combinations.json backend/generated/bounty-content.json edge-functions/_generated/bounty-content.js tests-makers/bounty-content-generation.test.mjs
git commit -m "feat: define epoch 2 Tencent bounty catalog"
```

---

### Task 3: Merge Catalog Content and Enforce Strict Reachability

**Files:**
- Create: `backend/content_catalog.py`
- Create: `tests/test_content_catalog.py`
- Modify: `backend/seed_loader.py`
- Modify: `backend/depth.py`
- Modify: `scripts/generate-makers-data.mjs`
- Modify: `scripts/trace_recipe.py`
- Modify: `scripts/validate_seed.py`
- Modify: `tests-makers/seed-data.test.mjs`
- Modify: `tests/test_seed_reconciliation.py`
- Generated: `edge-functions/_generated/seed-data.js`

**Interfaces:**
- Consumes: base seeds and `backend/generated/bounty-content.json`.
- Produces:
  - `load_compiled_content() -> dict`
  - `merged_elements() -> dict[str, dict]`
  - `merged_combinations() -> dict[str, dict]`
  - `starters() -> list[dict]`
  - `normalize_alias(name: str) -> str`
  - exact `depths` maps in Python and Makers.

- [ ] **Step 1: Write failing Python merge and reachability tests**

```python
from backend import content_catalog

EXPECTED_STARTERS = [
    "水", "火", "风", "土", "企鹅", "人",
    "时间", "AI", "电脑", "手机", "网络",
]


def test_compiled_content_has_exact_starters_and_aliases():
    assert [row["name"] for row in content_catalog.starters()] == EXPECTED_STARTERS
    assert content_catalog.normalize_alias("Q宠大乱斗") == "Q宠大乐斗"
    assert content_catalog.normalize_alias("CF") == "穿越火线"
    assert content_catalog.normalize_alias("微信") == "微信"


def test_every_bounty_target_is_strictly_reachable():
    content = content_catalog.load_compiled_content()
    targets = {
        name
        for group in content["bounty"]["groups"]
        for name in group["targets"]
    }
    assert targets
    assert targets <= content["depths"].keys()
    assert not targets & set(EXPECTED_STARTERS)
    assert len({content["depths"][name] for name in targets}) >= 3


def test_retired_bad_formulas_are_absent():
    combinations = content_catalog.merged_combinations()
    for pair in [
        "DNF + 工作室",
        "工作室 + 穿越火线",
        "云 + 微信",
        "人情 + 鹅厂",
        "堡垒之夜 + 收购",
        "打工鹅 + 时间",
        "拳头 + 收购",
        "视频号 + 鹅厂",
    ]:
        assert pair not in combinations
```

- [ ] **Step 2: Run the Python test and confirm missing module failure**

Run:

```bash
python3 -m pytest tests/test_content_catalog.py -q
```

Expected: FAIL importing `backend.content_catalog`.

- [ ] **Step 3: Implement the Python merged-content loader**

Use cached, defensive JSON loading:

```python
from functools import lru_cache
import json
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=1)
def load_compiled_content() -> dict:
    seed_elements = json.loads(
        (_ROOT / "backend/seed_elements.json").read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        (_ROOT / "backend/seed_combinations.json").read_text(encoding="utf-8")
    )
    bounty = json.loads(
        (_ROOT / "backend/generated/bounty-content.json").read_text(
            encoding="utf-8"
        )
    )
    # Merge only after checking digest/epoch fields and pair conflicts.
```

Return one object with `content_epoch`, `catalog_digest`, `starters`, `elements`, `combinations`, `depths`, `aliases`, `retired_pairs`, `retired_elements`, and `bounty`.

- [ ] **Step 4: Route Python seed loading and depth warm-up through merged content**

Replace direct file reads in `SeedStore.load()` and `depth._load_seed()` with `content_catalog`. Change `warm_up_from_seed()` so it deletes/replaces the `element_depth` Redis hash from the exact compiled depth map:

```python
def warm_up_from_seed() -> Dict[str, int]:
    depth = dict(content_catalog.load_compiled_content()["depths"])
    client = db.get_client()
    pipe = client.pipeline()
    pipe.delete(_DEPTH_KEY)
    if depth:
        pipe.hset(_DEPTH_KEY, mapping={k: str(v) for k, v in depth.items()})
    pipe.execute()
    return depth
```

This removes the input-only implicit starter behavior and stale shorter depths.

- [ ] **Step 5: Merge bounty content in the Makers generator**

Import/load the generated bounty JSON equivalent before calculating `STARTERS`, `ELEMENTS`, `COMBINATIONS`, `RECIPES_BY_RESULT`, and `DEPTHS`. Delete the implicit-starter loop from `calculateDepths`; throw when any fixed recipe input or bounty target remains unreachable.

Update `tests-makers/seed-data.test.mjs` to compare against merged content and assert:

```js
assert.equal(STARTERS.length, 11);
assert.equal(DEPTHS["微信"] > 0, true);
assert.equal(DEPTHS["工位"] > 0, true);
assert.equal(DEPTHS["电脑"], 0);
assert.equal(DEPTHS["手机"], 0);
assert.equal(DEPTHS["网络"], 0);
```

- [ ] **Step 6: Repair diagnostics**

Make `scripts/trace_recipe.py --bounty-report` read target names from generated groups instead of the removed `HALL_OF_FAME`, and make both diagnostics use only explicit starters. Make `scripts/validate_seed.py` compare the merged pair map and print epoch/digest in its summary.

- [ ] **Step 7: Run focused Python and Makers tests**

Run:

```bash
python3 -m pytest tests/test_content_catalog.py tests/test_seed_reconciliation.py -q
npm run generate:makers-data
node --test tests-makers/seed-data.test.mjs
python3 scripts/trace_recipe.py --bounty-report
```

Expected: all tests PASS; the report has zero unreachable bounty targets and at least three non-zero depth bands.

- [ ] **Step 8: Commit merged runtime content**

```bash
git add backend/content_catalog.py backend/seed_loader.py backend/depth.py scripts/generate-makers-data.mjs scripts/trace_recipe.py scripts/validate_seed.py tests/test_content_catalog.py tests/test_seed_reconciliation.py tests-makers/seed-data.test.mjs edge-functions/_generated/seed-data.js
git commit -m "feat: merge bounty content into strict seed graph"
```

---

### Task 4: Replace Duplicated Bounty Lists and Normalize Aliases

**Files:**
- Modify: `backend/bounty.py`
- Modify: `backend/main.py`
- Modify: `edge-functions/_lib/bounty.js`
- Modify: `edge-functions/_lib/game-service.js`
- Modify: `edge-functions/_lib/router.js`
- Modify: `tests/test_bounty.py`
- Modify: `tests-makers/router.test.mjs`
- Test: `tests-makers/bounty-content-generation.test.mjs`

**Interfaces:**
- Consumes: generated group arrays and alias maps.
- Produces: unchanged `/api/wall/bounty` response shape and canonicalized combine/recipe lookups.

- [ ] **Step 1: Write failing runtime parity and alias tests**

Python:

```python
def test_bounty_uses_generated_groups_and_excludes_starters():
    names = bounty.all_whitelisted_names()
    assert "企鹅" not in names
    assert "QQ游戏大厅" in names
    assert "Q宠大乐斗" in names
    assert "Q宠大乱斗" not in names
    assert next(
        group for group in bounty.GROUPS
        if group["category"] == "association"
    )["label"] == "关联组织"
```

Makers:

```js
test("aliases resolve before fixed formula lookup", async () => {
  const router = makeRouter();
  const response = await json(router, "/api/combine", {
    method: "POST",
    body: {
      a: "地下城与勇士",
      b: "会员",
      discoverer: "测试鹅",
      session_id: "alias-test",
    },
  });
  assert.equal(response.body.result, "黑钻");
  assert.equal(response.body.a, "DNF");
});
```

- [ ] **Step 2: Run focused tests and confirm old handwritten data/alias failure**

Run:

```bash
python3 -m pytest tests/test_bounty.py -q
node --test tests-makers/router.test.mjs tests-makers/bounty-content-generation.test.mjs
```

Expected: FAIL because handwritten groups still contain `invest`, starters, and duplicate aliases.

- [ ] **Step 3: Convert Python bounty module to a generated-data adapter**

Keep `_first_row_and_seq`, `_fill_discovery`, `build_group`, `build_bounty`, and `all_whitelisted_names`, but define `TABS` and `GROUPS` from `content_catalog.load_compiled_content()["bounty"]`. `build_group` must always set `is_starter: false` because starters are excluded at compile time.

Canonicalize `CombineReq.a`, `CombineReq.b`, and recipe target path parameters with `content_catalog.normalize_alias()` before lookup.

- [ ] **Step 4: Convert Edge bounty module to generated definitions**

Import:

```js
import {
  BOUNTY_ALIASES,
  BOUNTY_GROUPS,
  BOUNTY_TABS,
} from "../_generated/bounty-content.js";
```

Retain payload-building and candidate-scoring functions only. Add:

```js
export function normalizeBountyAlias(value) {
  const clean = String(value ?? "").trim();
  return BOUNTY_ALIASES[clean] || clean;
}
```

Call it on `a` and `b` at the start of `game.combine()` and on recipe target lookup in the router.

- [ ] **Step 5: Run bounty/runtime tests**

Run:

```bash
python3 -m pytest tests/test_bounty.py tests/test_content_catalog.py -q
node --test tests-makers/router.test.mjs tests-makers/game-service.test.mjs tests-makers/bounty-content-generation.test.mjs
```

Expected: PASS with unchanged public bounty payload fields.

- [ ] **Step 6: Commit runtime adapters**

```bash
git add backend/bounty.py backend/main.py edge-functions/_lib/bounty.js edge-functions/_lib/game-service.js edge-functions/_lib/router.js tests/test_bounty.py tests-makers/router.test.mjs tests-makers/bounty-content-generation.test.mjs
git commit -m "refactor: serve bounty lists from generated catalog"
```

---

### Task 5: Make Icons and Builds Follow the Merged Catalog

**Files:**
- Modify: `backend/icon_rules.json`
- Modify: `backend/icon_knowledge.json`
- Modify: `backend/icon_recipes.py`
- Modify: `scripts/generate-icon-data.mjs`
- Modify: `scripts/audit-icon-map.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/icon-data.test.mjs`
- Modify: `tests-makers/build.test.mjs`
- Generated: `frontend/assets/icons/generated/element-icon-map.json`
- Generated: `edge-functions/_generated/icon-data.js`

**Interfaces:**
- Consumes: the same merged element/recipe set as seed generation.
- Produces: one icon recipe for every merged fixed element and no hard-coded element count.

- [ ] **Step 1: Write failing dynamic-count and canonical-entity tests**

Replace the fixed `591` checks with:

```js
const compiled = JSON.parse(
  await readFile("backend/generated/bounty-content.json", "utf8"),
);
const base = JSON.parse(
  await readFile("backend/seed_elements.json", "utf8"),
);
const expectedNames = new Set([
  ...Object.keys(base.elements),
  ...Object.keys(compiled.elements),
]);
assert.deepEqual(new Set(Object.keys(iconMap)), expectedNames);
assert.deepEqual(iconMap["Riot Games"].icon, {
  base: "👊",
  badge: "🎮",
  palette: "studio",
  source: "curated",
});
assert.equal(iconMap.Riot, undefined);
```

Add `content/tencent-bounty-catalog.json`, both bounty generator scripts, and generated bounty artifacts to the isolated build fixture input list.

- [ ] **Step 2: Run icon/build tests and confirm missing merged icons**

Run:

```bash
node --test tests-makers/icon-data.test.mjs tests-makers/build.test.mjs
```

Expected: FAIL because icon generation still reads only base elements and expects 591.

- [ ] **Step 3: Update icon generation and audit inputs**

Load base seeds plus `backend/generated/bounty-content.json`, merge elements and combinations with explicit conflict checks, and pass the merged object to `buildElementIconMap`. Add `association` to `backend/icon_rules.json` using the `studio` or `product` palette selected by the existing palette vocabulary; remove `invest`.

Rename curated rows such as `Riot` and `Epic` to `Riot Games` and `Epic Games`, preserving reviewed base/badge choices and placing old spellings in catalog aliases rather than seed elements.

- [ ] **Step 4: Remove hard-coded count from the build**

In `auditCommittedIconMap()`, derive expected names from base plus generated bounty elements:

```js
const expectedCount = new Set([
  ...Object.keys(baseElements.elements || {}),
  ...Object.keys(bountyElements.elements || {}),
]).size;
if (
  browserNames.length !== expectedCount ||
  makersNames.length !== expectedCount
) {
  throw new Error(
    `Icon recipe drift: expected ${expectedCount} recipes, ` +
    `found browser=${browserNames.length}, Makers=${makersNames.length}`,
  );
}
```

Run `generateBountyContent()` before Makers seed generation in `buildMakersSite()`. Update the obsolete “591-element map” Python docstring.

- [ ] **Step 5: Regenerate icon artifacts and run focused tests**

Run:

```bash
npm run generate:bounty-content
npm run generate:icon-data
npm run generate:makers-data
node --test tests-makers/icon-data.test.mjs tests-makers/seed-data.test.mjs tests-makers/build.test.mjs
python3 -m pytest tests/test_icon_recipes.py -q
```

Expected: PASS; icon names exactly equal merged element names.

- [ ] **Step 6: Commit the build pipeline update**

```bash
git add backend/icon_rules.json backend/icon_knowledge.json backend/icon_recipes.py scripts/generate-icon-data.mjs scripts/audit-icon-map.mjs scripts/build-makers.mjs tests-makers/icon-data.test.mjs tests-makers/build.test.mjs frontend/assets/icons/generated/element-icon-map.json edge-functions/_generated/icon-data.js edge-functions/_generated/seed-data.js
git commit -m "build: generate icons from merged content catalog"
```

---

### Task 6: Implement Local SQLite and Redis Content Epoch 2

**Files:**
- Create: `backend/content_epoch.py`
- Create: `tests/test_content_epoch.py`
- Modify: `backend/archive.py`
- Modify: `backend/db.py`
- Modify: `backend/main.py`
- Modify: `tests/test_seed_reconciliation.py`

**Interfaces:**
- Consumes: `content_epoch`, digest, retired pairs/elements, SQLite connection, Redis client.
- Produces:
  - `archive.content_state() -> dict | None`
  - `archive.has_gameplay_data() -> bool`
  - `archive.begin_content_migration(epoch: int, digest: str, phase: str) -> None`
  - `archive.reset_gameplay_data() -> None`
  - `archive.retire_fixed_content(pair_keys: set[str], element_names: set[str]) -> None`
  - `archive.complete_content_migration(epoch: int, digest: str) -> None`
  - `db.reset_runtime_data() -> None`
  - `db.delete_combo_keys(pair_keys: set[str]) -> None`
  - `content_epoch.prepare_local() -> MigrationDecision`
  - `content_epoch.complete_local() -> None`

- [ ] **Step 1: Write failing local migration tests**

Use `tmp_path`, monkeypatched `archive._DATA_DIR`, and a fake Redis with `flushdb`, `delete`, and pipeline support:

```python
def test_legacy_data_is_hard_reset_once(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.upsert_combination(
        "打工鹅 + 时间", "美团", "🛵", "seed", "invest"
    )
    fake = FakeRedis()
    fake.values["combo:打工鹅 + 时间"] = {"result": "美团"}
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "epoch_reset"
    assert archive.all_combinations() == []
    assert fake.flush_count == 1
    assert archive.content_state()["status"] == "migrating"


def test_matching_epoch_and_digest_is_noop(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.complete_content_migration(
        content_catalog.content_epoch(),
        content_catalog.catalog_digest(),
    )
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)

    decision = content_epoch.prepare_local()

    assert decision.mode == "ready"
    assert fake.flush_count == 0


def test_failed_seed_load_leaves_migration_resumable(tmp_path, monkeypatch):
    use_temp_archive(tmp_path, monkeypatch)
    archive.init_archive()
    community.init()
    archive.upsert_combination(
        "旧左 + 旧右", "旧结果", "🧹", "llm", "ai"
    )
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)

    first = content_epoch.prepare_local()
    assert first.mode == "epoch_reset"
    assert archive.content_state()["status"] == "migrating"

    resumed = content_epoch.prepare_local()
    assert resumed.mode == "resume"
    assert archive.content_state()["status"] == "migrating"

    content_epoch.complete_local()
    state = archive.content_state()
    assert state["status"] == "ready"
    assert state["epoch"] == content_catalog.content_epoch()
    assert state["catalog_digest"] == content_catalog.catalog_digest()
```

- [ ] **Step 2: Run local epoch tests and confirm missing API failures**

Run:

```bash
python3 -m pytest tests/test_content_epoch.py -q
```

Expected: FAIL importing `backend.content_epoch` or missing archive functions.

- [ ] **Step 3: Add durable SQLite content state and transactional reset**

Create:

```sql
CREATE TABLE IF NOT EXISTS content_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    epoch INTEGER NOT NULL,
    catalog_digest TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL,
    completed_at REAL
);
```

`reset_gameplay_data()` must use `BEGIN IMMEDIATE` and delete from all existing Infinity Craft gameplay/community tables:

```text
formula_votes, result_votes, formula_reproductions, formula_moderation,
formula_versions, retired_combo_keys, combinations, elements,
first_discoveries, kpi_events, nicknames
```

It must not drop tables or delete `content_state`.

- [ ] **Step 4: Implement Redis reset and local decision state machine**

`db.reset_runtime_data()` calls `flushdb()` on the configured Infinity Craft Redis logical database. `prepare_local()` behavior:

```text
ready + matching epoch/digest -> ready
same epoch + different digest -> differential
missing state + empty gameplay tables -> bootstrap
missing state + data -> epoch_reset
older/newer epoch -> epoch_reset
migrating state -> resume current reset/bootstrap
```

For epoch reset/bootstrap, mark migrating before deletion, reset SQLite if legacy data exists, then reset Redis. For differential mode, delete only generated retired pairs/elements in SQLite and Redis. Never mark ready until seed loading and depth rebuild succeed.

- [ ] **Step 5: Change FastAPI startup order and health response**

Use:

```python
db.init_db()
community.init()
decision = content_epoch.prepare_local()
if decision.mode == "ready":
    warm = db.warm_up_from_archive()
else:
    warm = {"combos": 0, "firsts": 0, "nicks": 0}
n_el, n_warmed = store.load()
depth_table = depth_mod.warm_up_from_seed()
content_epoch.complete_local()
```

Add to `/api/health`:

```python
"content": content_epoch.health_status()
```

Expected ready payload contains epoch `2`, the digest, and `status: "ready"`.

- [ ] **Step 6: Run local migration tests**

Run:

```bash
python3 -m pytest tests/test_content_epoch.py tests/test_seed_reconciliation.py tests/test_bounty.py -q
```

Expected: PASS, including a regression proving archive warm-up cannot revive a retired seed pair.

- [ ] **Step 7: Commit local epoch support**

```bash
git add backend/content_epoch.py backend/archive.py backend/db.py backend/main.py tests/test_content_epoch.py tests/test_seed_reconciliation.py
git commit -m "feat: migrate local content stores to epoch 2"
```

---

### Task 7: Implement Resumable Makers KV Initialization

**Files:**
- Create: `edge-functions/_lib/content-initializer.js`
- Create: `tests-makers/content-initializer.test.mjs`
- Modify: `edge-functions/_lib/kv-store.js`
- Modify: `tests-makers/fake-kv.mjs`
- Modify: `tests-makers/kv-store.test.mjs`

**Interfaces:**
- Consumes: generated epoch/digest/elements/combinations, Makers KV, `KvStore`.
- Produces:
  - `createContentInitializer({ kv, now?, batchSize?, workBudget? })`
  - `initializer.ensureInitialized(): Promise<ContentInitializationResult>`
  - `initializer.readStatus(): Promise<ContentState>`
  - `KvStore.deleteCombination(a, b, result): Promise<void>`
  - `KvStore.deleteElement(name): Promise<void>`

- [ ] **Step 1: Write failing hard-reset, resume, and no-op tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_DIGEST,
  CONTENT_EPOCH,
} from "../edge-functions/_generated/bounty-content.js";
import { createContentInitializer } from "../edge-functions/_lib/content-initializer.js";
import { entityKey, normalizePair } from "../edge-functions/_lib/keys.js";
import { KvStore } from "../edge-functions/_lib/kv-store.js";
import { FakeKV } from "./fake-kv.mjs";

function readyKv(overrides = {}) {
  return new FakeKV({
    system_content_state: JSON.stringify({
      epoch: CONTENT_EPOCH,
      catalog_digest: CATALOG_DIGEST,
      status: "ready",
      mode: "ready",
      phase: "ready",
      cursor: null,
      index: 0,
      started_at: 1_700_000_000_000,
      completed_at: 1_700_000_000_000,
      error: "",
      ...overrides,
    }),
  });
}

test("epoch 1 KV is purged and seeded in resumable batches", async () => {
  const kv = new FakeKV({
    combo_legacy: JSON.stringify({
      a: "打工鹅", b: "时间", result: "美团", source: "seed",
    }),
    first_legacy: JSON.stringify({ result: "美团" }),
  });
  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
    now: () => 1_700_000_000_000,
  });

  const first = await initializer.ensureInitialized();
  assert.equal(first.ready, false);
  assert.equal(first.status.epoch, 2);
  assert.equal(first.status.status, "migrating");

  let result = first;
  for (let attempt = 0; attempt < 10_000 && !result.ready; attempt += 1) {
    result = await initializer.ensureInitialized();
  }
  assert.equal(result.ready, true);
  assert.equal(kv.values.has("combo_legacy"), false);
  assert.equal(kv.values.has("first_legacy"), false);
});

test("ready matching epoch and digest performs no writes", async () => {
  const kv = readyKv();
  const before = new Map(kv.values);
  const result = await createContentInitializer({ kv }).ensureInitialized();
  assert.equal(result.ready, true);
  assert.deepEqual(kv.values, before);
});

test("same epoch digest change preserves dynamic records", async () => {
  const kv = readyKv({ catalog_digest: "sha256:obsolete" });
  const store = new KvStore(kv, { now: () => 1_700_000_000_000 });
  await store.putCombination("动态甲", "动态乙", {
    result: "动态结果",
    emoji: "✨",
    comment: "由测试 AI 生成。",
    source: "llm",
  });
  await store.putCombination("旧种子甲", "旧种子乙", {
    result: "旧种子结果",
    emoji: "🧹",
    comment: "已从当前目录删除。",
    source: "seed",
    content_epoch: CONTENT_EPOCH,
    catalog_digest: "sha256:obsolete",
  });

  const initializer = createContentInitializer({
    kv,
    batchSize: 2,
    workBudget: 1,
  });
  let result = await initializer.ensureInitialized();
  for (let attempt = 0; attempt < 10_000 && !result.ready; attempt += 1) {
    result = await initializer.ensureInitialized();
  }

  assert.equal(result.ready, true);
  assert.ok(await store.getCombination("动态甲", "动态乙"));
  assert.equal(await store.getCombination("旧种子甲", "旧种子乙"), null);
});
```

- [ ] **Step 2: Run Makers initializer tests and confirm missing module**

Run:

```bash
node --test tests-makers/content-initializer.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Add exact KV deletion and source ownership**

Extend both `KvStore.putCombination()` and `KvStore.rememberElement()` records with `source`, `content_epoch`, and `catalog_digest` when supplied. Propagate the same ownership fields when a seeded combination remembers its result element. Add index deletion:

```js
async deleteIndexRecord(kind, canonicalKey) {
  const shard = this.shardForCanonicalKey(kind, canonicalKey);
  const storageKey = this.indexKey(kind, shard);
  const snapshot = this.normalizeIndexSnapshot(
    await this.getJson(storageKey, {}),
  );
  delete snapshot.items[canonicalKey];
  await this.putJson(storageKey, snapshot);
}
```

`deleteCombination(a, b, result)` deletes the hashed combo key and exact recipe key, and `deleteElement(name)` deletes the element plus its index entry.

- [ ] **Step 4: Implement the persisted phase machine**

Use `system_content_state` as the only state key. Persist:

```js
{
  epoch: 2,
  catalog_digest: CATALOG_DIGEST,
  status: "migrating",
  mode: "epoch_reset",
  phase: "purge_runtime_data",
  cursor: null,
  index: 0,
  started_at: now(),
  completed_at: null,
  error: "",
}
```

Phases:

```text
detect
purge_runtime_data
seed_starters
seed_elements
seed_recipes
rebuild_indexes
verify_catalog
ready
```

During epoch reset, list/delete every key in the dedicated `infinite_craft` binding except `system_content_state`. During same-epoch differential mode:

1. Upsert every current seed element/recipe with ownership metadata.
2. Scan `combo_` records and remove only `source == "seed"` pairs absent from current fixed combinations.
3. Scan `element_` records and remove only owned seed elements absent from current fixed elements.
4. Preserve LLM/user records.

Each call processes at most `batchSize * workBudget` records, stores cursor/index after every batch, and returns `{ready, status}`.

- [ ] **Step 5: Make concurrent calls share persisted correctness**

Add this test using two initializer instances on the same `FakeKV`:

```js
test("concurrent initializers converge through persisted idempotent state", async () => {
  const kv = new FakeKV({
    system_content_state: JSON.stringify({
      epoch: 1,
      catalog_digest: "sha256:epoch1",
      status: "ready",
      phase: "ready",
    }),
  });
  const left = createContentInitializer({
    kv, batchSize: 3, workBudget: 1,
  });
  const right = createContentInitializer({
    kv, batchSize: 3, workBudget: 1,
  });

  let results = [{ ready: false }, { ready: false }];
  for (
    let attempt = 0;
    attempt < 10_000 && !results.every((item) => item.ready);
    attempt += 1
  ) {
    results = await Promise.all([
      left.ensureInitialized(),
      right.ensureInitialized(),
    ]);
  }

  const status = JSON.parse(await kv.get("system_content_state"));
  const sampleKey = await entityKey("combo", normalizePair("电脑", "网络"));
  const sample = JSON.parse(await kv.get(sampleKey));
  assert.equal(status.status, "ready");
  assert.equal(status.epoch, CONTENT_EPOCH);
  assert.equal(status.catalog_digest, CATALOG_DIGEST);
  assert.equal(sample.result, "互联网");
  assert.equal(
    [...kv.values.keys()].filter((key) => key === sampleKey).length,
    1,
  );
});
```

Both initializers may perform idempotent work, but correctness must come from the persisted state and deterministic keys, not solely from an in-memory lock.

- [ ] **Step 6: Run initializer and KV-store tests**

Run:

```bash
node --test tests-makers/content-initializer.test.mjs tests-makers/kv-store.test.mjs
```

Expected: PASS for reset, interruption, retry, concurrent calls, ready no-op, and differential preservation.

- [ ] **Step 7: Commit Makers initializer data layer**

```bash
git add edge-functions/_lib/content-initializer.js edge-functions/_lib/kv-store.js tests-makers/content-initializer.test.mjs tests-makers/fake-kv.mjs tests-makers/kv-store.test.mjs
git commit -m "feat: add resumable Makers content initialization"
```

---

### Task 8: Gate Makers Requests Until Content Is Ready

**Files:**
- Modify: `edge-functions/api/[[default]].js`
- Modify: `edge-functions/_lib/router.js`
- Modify: `edge-functions/_lib/http.js`
- Modify: `tests-makers/configuration.test.mjs`
- Modify: `tests-makers/router.test.mjs`

**Interfaces:**
- Consumes: `createContentInitializer()` from Task 7.
- Produces:
  - `/api/health` response with content epoch/status/phase/digest.
  - HTTP 503 with stable `CONTENT_INITIALIZING` code for non-health API requests until ready.

- [ ] **Step 1: Write failing request-gating tests**

```js
test("health reports migration while gameplay fails closed", async () => {
  const kv = new FakeKV({
    combo_legacy: JSON.stringify({
      a: "旧", b: "公式", result: "旧结果", source: "seed",
    }),
  });
  const env = makersEnv(kv);

  const health = await onRequest({
    request: request("/api/health"),
    env,
  });
  const healthBody = await health.json();
  assert.equal(health.status, 200);
  assert.equal(healthBody.content.epoch, 2);
  assert.equal(healthBody.content.status, "migrating");

  const combine = await onRequest({
    request: request("/api/combine", {
      method: "POST",
      body: { a: "水", b: "火" },
    }),
    env,
  });
  const combineBody = await combine.json();
  assert.equal(combine.status, 503);
  assert.equal(combineBody.code, "CONTENT_INITIALIZING");
});
```

- [ ] **Step 2: Run entrypoint tests and confirm requests bypass initialization**

Run:

```bash
node --test tests-makers/configuration.test.mjs tests-makers/router.test.mjs
```

Expected: FAIL because the entrypoint immediately constructs the router.

- [ ] **Step 3: Add stable error code support**

Extend `errorResponse` without changing existing calls:

```js
export function errorResponse(
  status,
  message,
  details = undefined,
  code = undefined,
) {
  const payload = { detail: message };
  if (code !== undefined) payload.code = code;
  if (details !== undefined) payload.details = details;
  return jsonResponse(payload, { status });
}
```

- [ ] **Step 4: Run initialization at request entry**

After `resolveRuntimeKv()` succeeds:

```js
const initializer = createContentInitializer({ kv: runtime.kv });
const initialization = await initializer.ensureInitialized();
const path = new URL(request.url).pathname.replace(/\/+$/u, "") || "/";
if (!initialization.ready) {
  if (path === "/api/health") {
    return createRouter({
      kv: runtime.kv,
      env: { ...(env || {}), APP_ENV: runtime.appEnv },
      contentStatus: initialization.status,
    }).handle(request);
  }
  return errorResponse(
    503,
    "内容初始化中，请稍后重试",
    { content: initialization.status },
    "CONTENT_INITIALIZING",
  );
}
```

Pass ready status to the router and include it in health. Do not call the model or mutate gameplay/community data before ready.

- [ ] **Step 5: Run entrypoint, router, and game-service tests**

Run:

```bash
node --test tests-makers/configuration.test.mjs tests-makers/router.test.mjs tests-makers/game-service.test.mjs tests-makers/content-initializer.test.mjs
```

Expected: PASS; existing ready-router contracts remain unchanged except the additive `content` health field.

- [ ] **Step 6: Commit Makers request gating**

```bash
git add 'edge-functions/api/[[default]].js' edge-functions/_lib/router.js edge-functions/_lib/http.js tests-makers/configuration.test.mjs tests-makers/router.test.mjs
git commit -m "feat: gate Makers gameplay on content readiness"
```

---

### Task 9: Regenerate, Migrate Local Test Data, and Verify the Full Feature

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/makers-development.md`
- Generated: `backend/generated/bounty-content.json`
- Generated: `edge-functions/_generated/bounty-content.js`
- Generated: `edge-functions/_generated/seed-data.js`
- Generated: `frontend/assets/icons/generated/element-icon-map.json`
- Generated: `edge-functions/_generated/icon-data.js`
- Runtime only, never commit: `data/dev.db`, `data/prod.db`, `data/redis/dump.rdb`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: clean epoch 2 local runtime and passing repository verification.

- [ ] **Step 1: Run all deterministic generators**

Run:

```bash
npm run generate:bounty-content
npm run generate:icon-data
npm run generate:makers-data
```

Expected: all generators succeed and report consistent element counts/digest.

- [ ] **Step 2: Check generated-file drift**

Run:

```bash
git diff --check
git status --short
```

Expected: only intentional changes from this task plus the recorded pre-existing unrelated changes are listed; no runtime data or credentials.

- [ ] **Step 3: Run the full Makers test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run the required Python test suite**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: PASS.

- [ ] **Step 5: Build the Makers bundle**

Run:

```bash
npm run build
```

Expected: PASS and `dist/` contains the required frontend artifacts.

- [ ] **Step 6: Exercise the actual local epoch 2 migration**

Follow the project local workflow. If `.env` is absent, copy the example first; never overwrite an existing untracked `.env`:

```bash
cp .env.example .env
npm run dev
```

Use the privately supplied `LLM_API_KEY` only in the untracked `.env`. Wait for startup, then run:

```bash
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS http://127.0.0.1:8000/api/starters
curl -fsS http://127.0.0.1:8000/api/wall/bounty
```

Expected:

- health reports `content.epoch == 2`, `content.status == "ready"`, Redis `ok`;
- starters exactly match the eleven approved names;
- bounty uses `关联组织`, contains the required nostalgia/game targets, and excludes starters;
- startup logs show the epoch 2 reset occurs once.

Restart once without changing content and verify logs/health show a ready no-op rather than another hard reset.

- [ ] **Step 7: Verify representative fixed routes and retired routes**

Use `/api/combine` with a test nickname/session to walk:

```text
电脑 + 网络 → 互联网
手机 + 网络 → 移动互联网
企鹅 + 互联网 → 腾讯
腾讯 + 移动互联网 → 微信
企鹅 + 聊天 → QQ
QQ + 游戏 → QQ游戏
QQ游戏 + 电脑 → QQ游戏大厅
地下城 + 勇士 → DNF
DNF + 会员 → 黑钻
```

Query representative retired pairs and confirm they do not return the old seed result. AI may generate a new dynamic result for an unknown retired pair; it must not resurrect the retired seed formula.

- [ ] **Step 8: Inspect SQLite and Redis without committing runtime data**

Confirm:

```text
content_state epoch=2 status=ready
no source=seed row exists for retired pairs
no element category equals invest
Redis has no old combo hash for retired pairs
element_depth exactly matches the compiled fixed depth map
```

Stop local services:

```bash
npm run dev:down
```

- [ ] **Step 9: Run deployment-maintainer verification when EdgeOne CLI is available**

Run:

```bash
npm run makers:build
```

Expected: PASS. Do not authenticate, link, or deploy from local development if the maintainer environment is not already configured.

- [ ] **Step 10: Update durable developer documentation only where behavior changed**

Update starter counts, catalog generation command, epoch health fields, and local migration behavior in `backend/README.md` and/or `docs/makers-development.md`. Do not add process narration outside `.agent/docs/`.

- [ ] **Step 11: Commit final generated data and documentation**

```bash
git add backend/README.md docs/makers-development.md backend/generated/bounty-content.json edge-functions/_generated/bounty-content.js edge-functions/_generated/seed-data.js frontend/assets/icons/generated/element-icon-map.json edge-functions/_generated/icon-data.js
git commit -m "docs: document epoch 2 content workflow"
```

- [ ] **Step 12: Final clean-state check**

Run:

```bash
git status --short
git log -9 --oneline
```

Expected: no uncommitted file owned by this task remains, the recorded unrelated changes are untouched, and the focused commit sequence matches Tasks 1–9.
