import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compileBountyContent,
  normalizePair,
  serializeEdgeArtifact,
  serializePythonArtifact,
} from "../scripts/bounty-content-lib.mjs";

const starters = [
  "水", "火", "风", "土", "企鹅", "人",
  "时间", "AI", "电脑", "手机", "网络",
];

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
const SOURCE_BACKED_GAME_FACTS = {
  "QQ华夏": {
    provenance: "in_house",
    developer: "Tencent",
    tencent_role: "in_house_game",
  },
  "QQ炫舞": {
    provenance: "in_house",
    developer: "Tencent",
    tencent_role: "in_house_game",
  },
  "和平精英": {
    provenance: "in_house",
    developer: "Tencent",
    tencent_role: "in_house_game",
  },
  "金铲铲之战": {
    provenance: "licensed",
    developer: "Third-party developer",
    tencent_role: "licensed_game",
  },
  "DNF": {
    provenance: "licensed",
    developer: "Neople",
    tencent_role: "exclusive_china_operator",
  },
  "穿越火线": {
    provenance: "licensed",
    developer: "Smilegate",
    tencent_role: "long_standing_publisher",
  },
  "弹弹堂": {
    provenance: "licensed",
    developer: "第七大道",
    tencent_role: "licensed_mobile_game_publisher",
  },
};
const TITLE_SPECIFIC_GAME_SOURCES = [
  "QQ堂", "自由幻想", "QQ音速", "Q宠大乐斗", "战地之王",
  "使命召唤Online", "节奏大师", "天天酷跑", "天天爱消除",
  "全民飞机大战", "欢乐斗地主", "欢乐麻将", "火影忍者手游",
];
const SHARED_GAME_INFORMATION_SOURCE =
  "https://static.www.tencent.com/uploads/2023/08/16/" +
  "1e0a88fd7fe3c67f2e407e5885e76324.pdf";
const CROSSFIRE_SOURCE_TITLE =
  "That's No Moon Entertainment Reveals Crossfire -- A Cinematic Thriller " +
  "with Genre-Reinventing Cover and Traversal, Developed by Veteran AAA Talent";
const EXPECTED_CLASSIC_RECIPES = {
  "水 + 火": "蒸汽",
  "土 + 火": "岩浆",
  "土 + 风": "灰尘",
  "火 + 风": "烟",
  "灰尘 + 蒸汽": "云",
  "云 + 水": "雨",
  "土 + 雨": "植物",
  "云 + 植物": "知识",
  "时间 + 知识": "智慧",
  "火 + 金属": "刀",
  "土 + 水": "泥",
};
const REQUIRED_BRIDGES = {
  "人 + 电脑": "工位",
  "电脑 + 网络": "互联网",
  "手机 + 网络": "移动互联网",
  "互联网 + 人": "聊天",
  "互联网 + 企鹅": "腾讯",
  "企鹅 + 聊天": "QQ",
  "移动互联网 + 腾讯": "微信",
  "微信 + 短视频": "视频号",
  "短视频 + 腾讯": "微视",
  "云盘 + 腾讯": "微云",
};
const REQUIRED_RETIRED_PAIRS = [
  "DNF + 工作室",
  "工作室 + 穿越火线",
  "云 + 微信",
  "人情 + 鹅厂",
  "堡垒之夜 + 收购",
  "打工鹅 + 时间",
  "拳头 + 收购",
  "视频号 + 鹅厂",
].map((pair) => normalizePair(...pair.split(" + ")));

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

function asAssociationTarget(input) {
  input.catalog.groups[0] = {
    ...input.catalog.groups[0],
    key: "association",
    category: "association",
    label: "关联企业",
  };
  input.catalog.targets.QQ.category = "association";
  return input;
}

function associationRecord() {
  return {
    kind: "historical_association",
    as_of: "2026-08-04",
    source_url: "https://example.com/qq",
    source_title: "QQ source",
    note: "Fixture association source.",
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

test("catalog compiler permits a non-association QQ target without relationship metadata", () => {
  assert.doesNotThrow(() => compileBountyContent(fixture()));
});

test("catalog compiler requires relationship metadata for association targets", () => {
  const input = asAssociationTarget(fixture());
  assert.throws(
    () => compileBountyContent(input),
    /QQ.*relationship.*record/iu,
  );
});

test("catalog compiler accepts an association target with complete relationship metadata", () => {
  const input = asAssociationTarget(fixture());
  input.catalog.targets.QQ.relationship = associationRecord();
  assert.doesNotThrow(() => compileBountyContent(input));
});

test("catalog compiler requires the exact eleven binding starters", () => {
  const input = fixture();
  input.seedElements.starters = input.seedElements.starters
    .filter((starter) => starter.name !== "电脑")
    .concat({ id: "捷径", name: "捷径", emoji: "🧩", category: "classic" });
  delete input.seedElements.elements.电脑;
  input.seedElements.elements.捷径 = { emoji: "🧩", category: "classic" };
  input.catalog.support_recipes["捷径 + 网络"] =
    input.catalog.support_recipes["电脑 + 网络"];
  delete input.catalog.support_recipes["电脑 + 网络"];

  assert.throws(
    () => compileBountyContent(input),
    /exact.*binding starters|binding starters.*exact/iu,
  );
});

test("catalog compiler requires source-backed relationship records", () => {
  const missingRecord = asAssociationTarget(fixture());
  delete missingRecord.catalog.targets.QQ.relationship;
  assert.throws(
    () => compileBountyContent(missingRecord),
    /QQ.*relationship.*record/iu,
  );

  const inheritedSource = asAssociationTarget(fixture());
  inheritedSource.catalog.targets.QQ.relationship = { kind: "subsidiary" };
  assert.throws(
    () => compileBountyContent(inheritedSource),
    /relationship.*as_of/iu,
  );
});

test("catalog compiler rejects reachable dead-end support elements", () => {
  const input = fixture();
  input.catalog.support_elements.孤岛 = { emoji: "🏝️", category: "internet" };
  input.catalog.support_recipes["水 + 火"] = {
    result: "孤岛", emoji: "🏝️", chain: "internet",
  };

  assert.throws(
    () => compileBountyContent(input),
    /unused support element 孤岛/iu,
  );
});

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
  for (const [name, expected] of Object.entries(SOURCE_BACKED_GAME_FACTS)) {
    const facts = artifact.elements[name]?.factual_metadata;
    assert.ok(facts?.source_url, `${name} source_url`);
    assert.ok(facts?.source_title, `${name} source_title`);
    assert.deepEqual(
      {
        provenance: facts.provenance,
        developer: facts.developer,
        tencent_role: facts.tencent_role,
      },
      expected,
      `${name} factual metadata`,
    );
  }
  for (const name of TITLE_SPECIFIC_GAME_SOURCES) {
    const facts = artifact.elements[name]?.factual_metadata;
    assert.ok(facts?.source_url, `${name} title-specific source_url`);
    assert.notEqual(
      facts.source_url,
      SHARED_GAME_INFORMATION_SOURCE,
      `${name} must not cite a sheet that omits the title`,
    );
  }
  assert.equal(
    artifact.elements["穿越火线"].factual_metadata.source_title,
    CROSSFIRE_SOURCE_TITLE,
  );
  assert.equal(
    artifact.elements.Smilegate.relationship.source_title,
    CROSSFIRE_SOURCE_TITLE,
  );
  assert.equal(artifact.elements.Smilegate.relationship.as_of, "2026-06-08");
  assert.equal(targetsFor("association").length, 40);
  assert.equal(artifact.aliases["Q宠大乱斗"], "Q宠大乐斗");
  assert.equal(artifact.aliases.CF, "穿越火线");
  assert.equal(artifact.aliases["地下城与勇士"], "DNF");
  for (const [pair, result] of Object.entries(REQUIRED_BRIDGES)) {
    assert.equal(artifact.combinations[pair]?.result, result, pair);
  }
  assert.ok(new Set(
    Object.values(artifact.canonical_recipes)
      .map((recipe) => artifact.depths[recipe.result]),
  ).size >= 3);
  for (const pair of REQUIRED_RETIRED_PAIRS) {
    assert.ok(artifact.retired_pairs.includes(pair), `not retired: ${pair}`);
    assert.equal(artifact.combinations[pair], undefined);
  }
  for (const name of EXPECTED_ASSOCIATIONS) {
    const relationship = artifact.elements[name]?.relationship;
    assert.ok(relationship, `${name} relationship`);
    for (const field of ["as_of", "source_url", "source_title", "note"]) {
      assert.ok(relationship[field], `${name} ${field}`);
    }
  }
});

test("epoch 2 preserves every classic seed pair and result", async () => {
  const seed = JSON.parse(await readFile(
    "backend/seed_combinations.json",
    "utf8",
  ));
  const classic = Object.fromEntries(
    Object.entries(seed.combinations)
      .filter(([, recipe]) => recipe.chain === "classic")
      .map(([pair, recipe]) => [pair, recipe.result]),
  );
  assert.deepEqual(classic, EXPECTED_CLASSIC_RECIPES);
});

test("committed epoch 2 artifacts exactly match all three sources", async () => {
  const [
    catalog,
    seedElements,
    seedCombinations,
    backendArtifact,
    edgeArtifact,
  ] = await Promise.all([
    readFile("content/tencent-bounty-catalog.json", "utf8").then(JSON.parse),
    readFile("backend/seed_elements.json", "utf8").then(JSON.parse),
    readFile("backend/seed_combinations.json", "utf8").then(JSON.parse),
    readFile("backend/generated/bounty-content.json", "utf8"),
    readFile("edge-functions/_generated/bounty-content.js", "utf8"),
  ]);
  const compiled = compileBountyContent({
    catalog,
    seedElements,
    seedCombinations,
  });
  assert.equal(backendArtifact, serializePythonArtifact(compiled));
  assert.equal(edgeArtifact, serializeEdgeArtifact(compiled));
  assert.equal(
    Object.values(catalog.support_recipes)
      .filter((recipe) => recipe.chain === "seed_bootstrap").length,
    0,
  );
  assert.equal(
    Object.values(catalog.support_recipes)
      .filter((recipe) =>
        recipe.comment?.startsWith("为标准目录提供可达")
      ).length,
    0,
  );
  for (const [name, recipe] of Object.entries(compiled.canonical_recipes)) {
    const normalized = normalizePair(recipe.a, recipe.b);
    assert.equal(compiled.combinations[normalized].emoji, compiled.elements[name].emoji);
  }
});
