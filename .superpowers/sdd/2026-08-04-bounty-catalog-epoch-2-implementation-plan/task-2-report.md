# Task 2 Report — Epoch 2 Catalog Population and Generation

## Status

Task 2 implementation is complete at the catalog/generator boundary.

- Catalog: 254 canonical targets in the eight approved display groups.
- Associations: 40/40 fixed names have first-party or regulatory evidence.
- Starters: the exact eleven epoch 2 starters, in the required order.
- Classic recipes: all 11 original `chain == "classic"` pair/result mappings are unchanged.
- Reachability: all canonical recipes compile; target depths cover 13 distinct
  depths (minimum 1, maximum 14).
- Required bridges: all 10 compile to their prescribed results.
- Retirements: all eight required invalid pairs are explicit and absent from
  the retained seed recipes.
- Generated digest:
  `sha256:76ea8ff4f2fedf0390476314d84c07272cb575113b0da28e6370365102524944`.

## TDD evidence

The committed roster test was added before the catalog or artifacts existed.

RED command:

```text
node --test tests-makers/bounty-content-generation.test.mjs
```

RED result: exit 1 because
`backend/generated/bounty-content.json` did not exist. The same test also
captures the complete pre-migration classic mapping as a literal fixture.

GREEN command:

```text
npm run generate:bounty-content
node --test tests-makers/bounty-content-generation.test.mjs
```

GREEN result: exit 0. The catalog suite covers compiler invariants, the exact
starter/studio/association rosters, required nostalgia/game entries, aliases,
and byte-for-byte classic pair/result preservation.

## Catalog authoring methodology

1. Transcribed the fixed rosters from the approved design and retained the
   stable group order:
   `culture`, `qq_memory`, `tencent_game`, `product`, `studio`, `campus`,
   `level`, `association`.
2. Treated generic natural/life/social content as seed-owned. Tencent bounty
   targets and their canonical recipes moved to the catalog; obsolete aliases
   and the explicitly invalid formula pairs were removed from the seed source.
   Thirty-six unreachable non-classic recipes that depended on input-only
   shortcuts were pruned; no classic recipe was deleted or changed.
3. Retained `工位` and `微信` as seed elements, but made them reachable through
   support recipes instead of starter status. The compiler therefore permits a
   catalog support recipe to produce either a support element or a retained
   seed element.
4. Normalized every pair before conflict checking. The compiler rejects
   duplicate normalized pairs, duplicate elements, alias collisions,
   unreachable inputs/targets, unused support elements, invalid relationship
   kinds, and incomplete relationship evidence.
5. Rebuilt the target graph from the eleven starters and verified every
   target depth from compiled output rather than from declared metadata.
6. Generated JSON and ESM artifacts from the same normalized source and
   digest. A second generation produced identical SHA-256 checksums for both
   files.
7. Classified each game explicitly as `in_house`, `licensed`, or
   `co_developed` according to Tencent's public-information sheet. Generic
   developer/role text mirrors only those published classifications. DNF,
   穿越火线, 弹弹堂, QQ音速, 战地之王, and 使命召唤Online use directly
   applicable first-party records for their named developer and Tencent
   operation/publishing roles. Thirteen titles omitted from the 2023 sheet use
   title-specific Tencent corporate/game material or official App Store
   listings from Tencent developer accounts instead.
8. Replaced all mechanically generated reachability padding with 116 reviewed,
   commented semantic support routes. There are zero `seed_bootstrap` recipes
   and zero generic “make this reachable” comments in the committed catalog.

Roster counts:

| Group | Count |
|---|---:|
| 鹅厂文化 | 61 |
| QQ 时代记忆 | 44 |
| 腾讯游戏 | 36 |
| 当代产品 | 36 |
| 游戏工作室 | 14 |
| 办公楼与园区 | 12 |
| 职级体系 | 11 |
| 关联组织 | 40 |

## Association evidence methodology

Research was completed before catalog generation. Sources were restricted to:

- Tencent or target-company announcements and investor-relations pages;
- SEC and HKEX filings;
- regulator-hosted transaction announcements;
- official developer/publisher pages for licensed relationships.

No media article is the sole evidence for any record. Equity was not inferred
from publishing: Neople, Smilegate, 第七大道, Take-Two, EA, Activision, Nexon,
KRAFTON, and NCSoft use `licensed_partner`; changed or older holdings use
`historical_association`.

Evidence recorded in the catalog:

| Target(s) | Kind | As of | First-party/regulatory material |
|---|---|---|---|
| Riot Games | subsidiary | 2015-12-31 | Tencent 2015 annual report (100% subsidiary) |
| Supercell | equity investment | 2016-06-21 | Tencent majority-stake announcement |
| Epic Games | equity investment | 2012-06-19 | Tencent strategic-investment announcement |
| Funcom | subsidiary | 2020-07-14 | Funcom official company history |
| Sumo Group | subsidiary | 2022-01-17 | FCA National Storage Mechanism transaction record |
| Digital Extremes | subsidiary | 2020-12-22 | Digital Extremes Tencent partnership announcement |
| Sharkmob | subsidiary | 2026-04-16 | Sharkmob official company careers page |
| Grinding Gear Games | equity investment | 2018-05-21 | Path of Exile/GGG studio announcement |
| Klei Entertainment | equity investment | 2021-01-22 | Klei studio announcement |
| Miniclip | subsidiary | 2023-08-07 | Cyprus competition-authority concentration record |
| 腾讯音乐娱乐集团 | subsidiary | 2025-12-31 | TME Form 20-F |
| 阅文集团 | subsidiary | 2025-06-30 | China Literature 2025 interim report |
| 微众银行 | equity investment | 2014-12-31 | Tencent 2014 annual report |
| Ubisoft | equity investment | 2022-09-06 | Ubisoft direct-shareholding and strategic-partnership announcement |
| Techland | subsidiary | 2023-08-31 | Techland tax-strategy disclosure |
| Remedy Entertainment | equity investment | 2024-04-25 | Remedy threshold announcement |
| Paradox Interactive | equity investment | 2016-05-27 | Paradox listing/investor announcement |
| PlatinumGames | equity investment | 2020-01-07 | PlatinumGames partnership announcement |
| KADOKAWA | equity investment | 2021-10-29 | KADOKAWA capital/business alliance announcement |
| Sea | equity investment | 2022-01-04 | Tencent partial-divestment announcement |
| Spotify | historical association | 2017-12-08 | Spotify/Tencent/TME reciprocal investment announcement |
| Snap | historical association | 2017-12-31 | Snap Form 10-K |
| Reddit | equity investment | 2025-09-30 | Tencent Schedule 13G amendment |
| 快手 | equity investment | 2025-07-17 | HKEX disclosure-of-interests record |
| 哔哩哔哩 | equity investment | 2018-10-03 | SEC-filed Bilibili subscription agreement |
| 拼多多 | historical association | 2019-12-31 | Pinduoduo Form 20-F |
| 蔚来 | historical association | 2019-02-04 | NIO convertible-note placement announcement |
| 小红书 | equity investment | 2018-05-31 | Xiaohongshu official company history |
| 知乎 | historical association | 2021-03-05 | Zhihu Form F-1 |
| 京东 | historical association | 2021-12-22 | JD shareholder-change announcement |
| 美团 | historical association | 2022-11-16 | Tencent HKEX distribution-in-specie announcement |
| Neople | licensed partner | 2007-12-13 | Tencent DNF exclusive-license announcement |
| Smilegate | licensed partner | 2026-06-05 | Smilegate Crossfire publishing material |
| 第七大道 | licensed partner | 2016-07-29 | 第七大道《弹弹堂》腾讯代理公告 |
| Take-Two | licensed partner | 2009-06-23 | Take-Two/2K NBA 2K Online announcement |
| EA | licensed partner | 2024-04-30 | Tencent/EA Need for Speed Mobile announcement |
| Activision | licensed partner | 2012-07-03 | Activision Call of Duty Online announcement |
| Nexon | licensed partner | 2026-05-14 | Nexon DNF publishing-extension announcement |
| KRAFTON | licensed partner | 2026-08-04 | Tencent official PUBG Mobile case study |
| NCSoft | licensed partner | 2024-12-18 | NCSoft Lineage 2M partnership announcement |

Each catalog record stores its exact source URL, source title, relationship
kind, evidence date, and a concise relationship note.

## Generated interfaces

`generateBountyContent({ root? })` returns:

```text
{
  digest,
  outputs: [
    "backend/generated/bounty-content.json",
    "edge-functions/_generated/bounty-content.js"
  ]
}
```

The ESM artifact exports:

```text
CONTENT_EPOCH
CATALOG_DIGEST
BOUNTY_TABS
BOUNTY_GROUPS
BOUNTY_ELEMENTS
BOUNTY_COMBINATIONS
BOUNTY_RECIPES_BY_RESULT
BOUNTY_ALIASES
RETIRED_PAIRS
RETIRED_ELEMENTS
```

It also retains the frozen aggregate `BOUNTY_CONTENT` export.

## Files changed

- `content/tencent-bounty-catalog.json`
- `scripts/generate-bounty-content.mjs`
- `scripts/bounty-content-lib.mjs`
- `backend/seed_elements.json`
- `backend/seed_combinations.json`
- `backend/generated/bounty-content.json`
- `edge-functions/_generated/bounty-content.js`
- `package.json`
- `tests-makers/bounty-content-generation.test.mjs`

The compiler file is included because the required retained-seed bridges and
the required generated constants exposed two Task 1 boundary gaps: support
recipes previously could not produce `工位`/`微信`, and the `.json` serializer
previously emitted Python source.

## Verification evidence

Passing:

```text
npm run generate:bounty-content
node --test tests-makers/bounty-content-generation.test.mjs
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

- Generator: exit 0, one stable digest and two outputs.
- Determinism: both artifact checksums unchanged after regeneration.
- Focused catalog tests: exit 0.
- Python: 269 passed, 3 pre-existing deprecation warnings.
- `git diff --check`: clean.

Downstream integration not yet green at this task boundary:

- `npm test`: 257 passed, 7 failed.
- `npm run build`: fails the committed icon-map audit.

All seven JavaScript failures have the same expected downstream cause:
Task 2 intentionally moved 158 Tencent bounty elements out of the generic seed
file, while the committed icon map and Makers generated seed data still assume
the epoch 1 seed-only shape (591 mapped seed elements and 10 starters).
Subsequent catalog/runtime/icon integration tasks must merge the generated
catalog elements before those checks can pass. The Task 2 compiler, catalog,
roster, alias, classic-preservation, and artifact tests do not fail.

## Self-review and concerns

- Confirmed all 40 source records are non-empty and use an allowed relationship
  kind.
- Confirmed every group target is unique and no canonical target remains in
  the generic seed element source.
- Confirmed all 10 required bridges resolve to the prescribed result in the
  compiled artifact.
- Confirmed all 8 retired normalized pairs are absent from seed recipes.
- Confirmed the 11 classic normalized keys/results remain exactly unchanged.
- Confirmed no `invest` category remains in the seed category vocabulary.
- Confirmed source and generated JSON are newline-terminated and artifacts are
  deterministic.
- Confirmed every compiled target recipe carries the target emoji.
- Confirmed all game metadata classifications agree with their cited source;
  the four review-found conflicts for QQ华夏, QQ炫舞, 和平精英, and 金铲铲之战
  are locked by assertions.
- Replaced the five review-found weak support shortcuts with direct semantic
  routes, including `美国 + 体育 → NBA`, `颜色 + 游戏 → 消除`,
  `游戏 + 自走棋 → 棋盘`, `地图 + 美国 → 洛杉矶`, and a two-step
  `光 + 知识 → 物理 → 量子计算` route.
- Confirmed tests compile all three sources and compare both serializers
  byte-for-byte with both committed artifacts, preventing generation drift.
- Confirmed `CF` is an alias of `穿越火线` and is also explicitly retired as an
  epoch 1 element identity.

Open integration concern: the full JavaScript/build gate cannot be green until
the downstream runtime/icon tasks consume `backend/generated/bounty-content.json`.
No local or Makers runtime data was changed, and no account/deployment action
was performed.
