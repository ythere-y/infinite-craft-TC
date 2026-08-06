# Icon Diversity and Recipe Reachability Design

## Problem

The epoch 2 catalog is strictly reachable for all 254 bounty targets, but the
icon audit exposes visually dominant primary symbols among catalog-only
elements:

- `🧩`: 80 elements
- `💬`: 42 elements
- `🎮`: 29 elements
- `🤝`: 27 elements
- `🕹️`: 9 elements

These 187 elements have different small badges, yet their large base symbols
make them look substantially alike during play. Separately, 25 legacy base
elements exist in `backend/seed_elements.json` without any preset producer
recipe, so they are not reachable from the 11 starters.

## Scope

This change will:

1. Curate a semantically meaningful primary Emoji for each of the 187
   catalog-only elements in the five high-reuse groups.
2. Preserve a family badge where it adds context, such as `💬` for QQ-era
   products, `🎮` for games, `🤝` for associated organizations, and `🕹️` for
   studios.
3. Add one preset producer recipe for each of the 25 unreachable legacy
   elements.
4. Add regression gates for catalog placeholder use, catalog primary-icon
   concentration, and reachability of every preset element.
5. Regenerate all committed projections used by FastAPI, the frontend, and
   Makers.

No starter, target name, alias, catalog membership, or production storage
binding changes.

## Icon Curation Model

The source of truth remains `content/tencent-bounty-catalog.json`. The 187
affected elements receive individually selected result Emoji there instead of
an algorithmically promoted random badge. The choices follow these rules:

- Prefer the literal object, activity, genre, product trait, or known visual
  association named by the element.
- Avoid using a category-wide placeholder as the primary symbol.
- Keep paired aliases or closely related concepts visually related but not
  identical.
- Use only Emoji present in the generated Emoji asset pool.
- Keep the generated deterministic badge as a secondary family marker when it
  differs from the curated primary symbol.

The icon audit will receive the catalog-only name set and reject:

- any catalog-only element whose primary icon is `🧩`;
- any catalog-only primary base reused by five or more elements unless every
  row carries an explicit exception;
- any missing asset, invalid palette/source, or existing full-signature gate.

The threshold of five permits a small, intentional visual family while
preventing category-scale concentration.

## Recipe Reachability Model

The 25 legacy elements receive these conflict-free preset producers:

| Result | Inputs |
|---|---|
| 生命 | 水 + 时间 |
| 头发 | 人 + 植物 |
| 皱纹 | 人 + 日子 |
| 白发 | 头发 + 时间 |
| 秃头 | 头发 + 焦虑 |
| 精神状态 | 人 + 情绪 |
| 紧绷感 | 焦虑 + 时间 |
| 松弛感 | 自由 + 午休 |
| 松人 | 松弛感 + 人 |
| 班味 | 加班 + 人 |
| 班上不想上 | 班味 + 周一 |
| 颠颠上班 | 班味 + 早高峰 |
| 资深打工人 | 打工 + 时间 |
| 直播间 | 手机 + 麦克风 |
| 直播打赏 | 直播间 + 钱包 |
| 氪金 | 游戏 + 钱包 |
| 表情 | 情绪 + 手机 |
| 孙红雷 | 人 + 表情 |
| 孙红雷关人脸 | 孙红雷 + 表情 |
| 人情 | 人 + 爱 |
| 过期酸奶 | 冰箱 + 时间 |
| 智商税 | 钱包 + 谎言 |
| 工地 | 土 + 钢架 |
| 死者人格 | 人 + 灵魂 |
| 上坟都不敢这么烧 | 火 + 死者人格 |

Every input already exists, and the proposed normalized pairs do not collide
with the merged preset pair map. Once added, strict depth calculation reaches
all 780 preset elements.

## Data Flow

1. Base recipes are updated in `backend/seed_combinations.json`.
2. Catalog Emoji are curated in `content/tencent-bounty-catalog.json`.
3. `npm run generate:bounty-content` rebuilds the compiled catalog.
4. `npm run generate:makers-data` rebuilds Makers seed projections.
5. `npm run generate:icons` rebuilds Emoji assets and manifests.
6. `npm run generate:icon-data` rebuilds browser and Makers icon maps.
7. The trace and audit scripts verify reachability and visual diversity.

## Testing and Acceptance

- A Python regression test fails while any merged preset element is absent
  from strict depths.
- A Node regression test fails while catalog-only entries retain `🧩` or a
  primary base is reused five or more times without explicit exceptions.
- `python3 scripts/trace_recipe.py --no-llm --unreachable` reports zero.
- `python3 scripts/trace_recipe.py --no-llm --bounty-report` still reports all
  254 targets reachable.
- `npm run audit:icons` and `npm run verify:icons` pass.
- Project-required `npm test`,
  `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and
  `npm run build` pass.
- Local Docker deployment responds successfully at `/api/health` and is
  handed off as a LAN-reachable `IP:8000` URL.

