import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PALETTES = new Set([
  "nature",
  "product",
  "office",
  "studio",
  "people",
  "place",
]);
const QQ_MEMORY_ELEMENTS = [
  "踩空间",
  "超级QQ",
  "窗口抖动",
  "滴滴滴",
  "粉钻",
  "个性签名",
  "黑钻",
  "红钻",
  "黄钻",
  "灰色头像",
  "蓝钻",
  "留言板",
  "绿钻",
  "你是GG还是MM",
  "朋友网",
  "抢车位",
  "手机QQ",
  "太阳号",
  "腾讯微博",
  "腾讯TT",
  "偷菜",
  "隐身上线",
  "在线升级",
  "紫钻",
  "OICQ",
  "Q币",
  "QQ",
  "QQ餐厅",
  "QQ宠物",
  "QQ等级",
  "QQ分组",
  "QQ会员",
  "QQ空间",
  "QQ浏览器",
  "QQ牧场",
  "QQ农场",
  "QQ校友",
  "QQ秀",
  "QQ旋风",
  "QQ音乐",
  "QQ邮箱",
  "QQ游戏",
  "QQ游戏大厅",
  "WebQQ",
];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("the committed icon map covers every preset with valid semantic recipes", async () => {
  const [base, compiled, iconMap, manifest] = await Promise.all([
    readJson("backend/seed_elements.json"),
    readJson("backend/generated/bounty-content.json"),
    readJson("frontend/assets/icons/generated/element-icon-map.json"),
    readJson("frontend/assets/icons/generated/emoji-icon-manifest.json"),
  ]);
  const expectedNames = new Set([
    ...Object.keys(base.elements),
    ...Object.keys(compiled.elements),
  ]);

  assert.deepEqual(new Set(Object.keys(iconMap)), expectedNames);

  for (const [name, entry] of Object.entries(iconMap)) {
    assert.equal(typeof entry.icon?.base, "string", `${name} needs icon.base`);
    assert.ok(entry.icon.base, `${name} needs a non-empty icon.base`);
    assert.ok(manifest[entry.icon.base], `${name} base must resolve in the manifest`);
    assert.ok(PALETTES.has(entry.icon.palette), `${name} has an invalid palette`);
    assert.equal(typeof entry.icon.source, "string", `${name} needs icon.source`);
    assert.equal(typeof entry.rationale, "string", `${name} needs a rationale`);
    assert.ok(entry.rationale.trim(), `${name} needs a non-empty rationale`);
    if (entry.icon.badge !== undefined) {
      assert.ok(
        manifest[entry.icon.badge],
        `${name} badge must resolve in the manifest`,
      );
      assert.notEqual(
        entry.icon.base,
        entry.icon.badge,
        `${name} base and badge must differ`,
      );
    }
  }
});

test("QQ memory icons use explicit unique mappings with deterministic fallbacks", async () => {
  const [iconMap, manifest] = await Promise.all([
    readJson("frontend/assets/icons/generated/element-icon-map.json"),
    readJson("frontend/assets/icons/generated/emoji-icon-manifest.json"),
  ]);
  const forbiddenGenericBases = new Set([
    "🩷",
    "🖤",
    "❤️",
    "💛",
    "💙",
    "💚",
    "💜",
  ]);
  const signatures = new Set();

  for (const name of QQ_MEMORY_ELEMENTS) {
    const row = iconMap[name];
    assert.ok(row, `${name} needs an explicit icon row`);
    assert.notEqual(
      row.icon.source,
      "generated",
      `${name} must not use a generated random badge`,
    );
    assert.ok(
      !forbiddenGenericBases.has(row.icon.base),
      `${name} must not use a colored heart as its primary icon`,
    );
    assert.ok(manifest[row.icon.base], `${name} primary icon must resolve`);
    assert.ok(row.fallback_icon, `${name} needs a deterministic fallback_icon`);
    assert.ok(
      manifest[row.fallback_icon.base],
      `${name} fallback base must resolve`,
    );
    if (row.fallback_icon.badge) {
      assert.ok(
        manifest[row.fallback_icon.badge],
        `${name} fallback badge must resolve`,
      );
    }
    const signature = [
      row.icon.base,
      row.icon.badge ?? "",
      row.icon.palette,
    ].join("\0");
    assert.ok(!signatures.has(signature), `${name} duplicates another QQ icon`);
    signatures.add(signature);
  }

  assert.equal(signatures.size, 44);
});

test("locked entities retain their reviewed interpretations", async () => {
  const iconMap = await readJson(
    "frontend/assets/icons/generated/element-icon-map.json",
  );

  assert.deepEqual(iconMap["Riot Games"].icon, {
    base: "👊",
    badge: "🎮",
    palette: "studio",
    source: "curated",
  });
  assert.equal(iconMap["Riot Games"].canonical_name, "Riot Games");
  assert.doesNotMatch(iconMap["Riot Games"].rationale, /闪电|暴乱/u);
  assert.deepEqual(iconMap["Epic Games"].icon, {
    base: "🛡️",
    badge: "🎮",
    palette: "studio",
    source: "curated",
  });
  assert.equal(iconMap.Riot, undefined);
  assert.equal(iconMap.Epic, undefined);
  assert.equal(iconMap.COO.entity_type, "role");
});

test("generic presets do not receive blanket category or self badges", async () => {
  const iconMap = await readJson(
    "frontend/assets/icons/generated/element-icon-map.json",
  );

  assert.deepEqual(iconMap.地铁.icon, {
    base: "🚇",
    palette: "people",
    source: "fallback",
  });
  assert.match(iconMap.地铁.rationale, /人.*轨道/u);
  assert.deepEqual(iconMap.企鹅.icon, {
    base: "🐧",
    palette: "product",
    source: "fallback",
  });
});

test("rules cover every merged category and knowledge rows are well formed", async () => {
  const [base, compiled, rules, knowledge] = await Promise.all([
    readJson("backend/seed_elements.json"),
    readJson("backend/generated/bounty-content.json"),
    readJson("backend/icon_rules.json"),
    readJson("backend/icon_knowledge.json"),
  ]);
  const elements = { ...base.elements, ...compiled.elements };
  const categories = new Set(
    Object.values(elements).map((entry) => entry.category),
  );

  for (const category of categories) {
    assert.ok(
      rules.category_palettes[category],
      `category_palettes must cover seed category ${category}`,
    );
  }
  assert.equal(rules.category_palettes.ai, "product");
  assert.equal(rules.category_palettes.association, "product");
  assert.equal(rules.category_palettes.invest, undefined);
  assert.deepEqual(new Set(rules.palettes), PALETTES);
  assert.deepEqual(
    new Set(rules.allowed_sources),
    new Set(["curated", "entity", "generated", "fallback"]),
  );

  for (const [index, rule] of rules.keyword_badges.entries()) {
    assert.deepEqual(
      Object.keys(rule).sort(),
      (rule.categories
        ? ["badge", "categories", "keywords", "reason"]
        : ["badge", "keywords", "reason"]
      ).sort(),
      `keyword_badges[${index}] has unexpected fields`,
    );
    assert.ok(Array.isArray(rule.keywords) && rule.keywords.length);
    assert.equal(typeof rule.badge, "string");
    assert.equal(typeof rule.reason, "string");
    if (rule.categories) {
      assert.ok(Array.isArray(rule.categories) && rule.categories.length);
    }
  }

  for (const [name, row] of Object.entries(knowledge)) {
    assert.equal(typeof row.entity_type, "string", `${name} needs entity_type`);
    assert.equal(
      typeof row.canonical_name,
      "string",
      `${name} needs canonical_name`,
    );
    assert.ok(Array.isArray(row.aliases) && row.aliases.length, `${name} needs aliases`);
    assert.ok(Array.isArray(row.contexts) && row.contexts.length, `${name} needs contexts`);
    assert.ok(
      Array.isArray(row.forbidden_senses),
      `${name} needs forbidden_senses`,
    );
    assert.equal(typeof row.rationale, "string", `${name} needs rationale`);
    assert.ok(row.rationale.trim(), `${name} needs a non-empty rationale`);
    assert.equal(typeof row.icon?.base, "string", `${name} needs icon.base`);
  }
});

test("icon content merging rejects base conflicts before generation", async () => {
  const { mergeIconContent } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const baseElements = {
    starters: [],
    elements: {
      Shared: { emoji: "💧", category: "classic" },
    },
  };
  const baseCombinations = {
    combinations: {
      "A + B": {
        result: "Shared",
        emoji: "💧",
        chain: "classic",
      },
    },
  };

  assert.throws(
    () =>
      mergeIconContent({
        baseElements,
        baseCombinations,
        bountyContent: {
          elements: {
            Shared: { emoji: "🔥", category: "classic" },
          },
          combinations: {},
        },
      }),
    /element conflicts with base seed.*Shared/i,
  );
  assert.throws(
    () =>
      mergeIconContent({
        baseElements,
        baseCombinations,
        bountyContent: {
          elements: structuredClone(baseElements.elements),
          combinations: {
            "B + A": {
              result: "Different",
              emoji: "🔥",
              chain: "classic",
            },
          },
        },
      }),
    /combination conflicts with base seed.*A \+ B/i,
  );
});

test("candidate generation honors entity, keyword, category, then fallback order", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const seedElements = {
    elements: {
      Entity: { emoji: "🎮", category: "studio" },
      Keyword: { emoji: "💼", category: "abstract" },
      Category: { emoji: "🏢", category: "building" },
      Fallback: { emoji: "💧", category: "classic" },
    },
  };
  const rules = {
    palettes: ["nature", "product", "office", "studio", "people", "place"],
    category_palettes: {
      studio: "studio",
      worker: "office",
      abstract: "place",
      building: "place",
      classic: "nature",
    },
    keyword_badges: [
      {
        keywords: ["Keyword"],
        badge: "⚙️",
        reason: "运营流程",
        categories: ["worker"],
      },
    ],
    category_badges: { building: "📍" },
    allowed_sources: ["curated", "entity", "generated", "fallback"],
  };
  const knowledge = {
    Entity: {
      entity_type: "company",
      canonical_name: "Entity Inc.",
      aliases: ["实体公司"],
      contexts: ["studio"],
      forbidden_senses: [],
      icon: {
        base: "👊",
        badge: "🎮",
        palette: "studio",
        source: "curated",
      },
      rationale: "显式实体覆盖",
    },
  };
  const emojiManifest = Object.fromEntries(
    ["🎮", "💼", "🏢", "💧", "⚙️", "📍", "👊"].map((emoji) => [
      emoji,
      `/assets/icons/${emoji}.png`,
    ]),
  );

  const iconMap = buildElementIconMap({
    seedElements,
    seedCombinations: {
      combinations: {
        "Parent A + Parent B": {
          result: "Keyword",
          emoji: "💼",
          chain: "worker",
        },
      },
    },
    rules,
    knowledge,
    emojiManifest,
  });

  assert.deepEqual(iconMap.Entity.icon, knowledge.Entity.icon);
  assert.deepEqual(iconMap.Keyword.icon, {
    base: "💼",
    badge: "⚙️",
    palette: "place",
    source: "generated",
  });
  assert.match(iconMap.Keyword.rationale, /运营流程/u);
  assert.match(iconMap.Keyword.rationale, /Parent A.*Parent B/u);
  assert.deepEqual(iconMap.Category.icon, {
    base: "🏢",
    palette: "place",
    source: "fallback",
  });
  assert.deepEqual(iconMap.Fallback.icon, {
    base: "💧",
    palette: "nature",
    source: "fallback",
  });
});

test("curated product mappings win before generated catalog badges and retain fallback icons", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const curated = {
    "黄钻": {
      icon: {
        base: "qq-era:yellow-diamond",
        palette: "product",
        source: "curated",
      },
      fallback_icon: {
        base: "💎",
        badge: "⭐",
        palette: "product",
        source: "fallback",
      },
      rationale: "QQ 2008 经典黄钻图标",
      provenance: {
        source_id: "qq-icons-2010-pack",
        kind: "historic_asset",
        source_url: "https://example.test/qq-icons.zip",
      },
    },
  };
  const iconMap = buildElementIconMap({
    seedElements: {
      elements: {
        "黄钻": { emoji: "💛", category: "qq_memory" },
      },
    },
    seedCombinations: { combinations: {} },
    catalogElementNames: new Set(["黄钻"]),
    rules: {
      palettes: ["product"],
      category_palettes: { qq_memory: "product" },
      keyword_badges: [],
      category_badges: {},
      category_badge_pools: { catalog: ["🔥"] },
      allowed_sources: ["curated", "generated", "fallback"],
    },
    knowledge: {},
    curated,
    emojiManifest: {
      "💛": "/icons/yellow-heart.png",
      "💎": "/icons/diamond.png",
      "⭐": "/icons/star.png",
      "🔥": "/icons/fire.png",
      "qq-era:yellow-diamond": "/icons/qq-era/yellow-diamond.png",
    },
  });

  assert.deepEqual(iconMap["黄钻"], curated["黄钻"]);
});

test("curated mappings reject malformed recipes and missing review metadata", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const valid = {
    icon: {
      base: "qq-era:yellow-diamond",
      palette: "product",
      source: "curated",
    },
    fallback_icon: {
      base: "💎",
      badge: "⭐",
      palette: "product",
      source: "fallback",
    },
    rationale: "reviewed",
    provenance: { source_id: "qq-icons-2010-pack" },
  };
  const build = (entry) =>
    buildElementIconMap({
      seedElements: {
        elements: { "黄钻": { emoji: "💛", category: "qq_memory" } },
      },
      seedCombinations: { combinations: {} },
      rules: {
        palettes: ["product"],
        category_palettes: { qq_memory: "product" },
        keyword_badges: [],
        category_badges: {},
        allowed_sources: ["curated", "fallback"],
      },
      knowledge: {},
      curated: { "黄钻": entry },
      emojiManifest: {
        "💛": "/icons/yellow-heart.png",
        "💎": "/icons/diamond.png",
        "⭐": "/icons/star.png",
        "qq-era:yellow-diamond": "/icons/yellow-diamond.png",
      },
    });

  for (const [label, mutate, pattern] of [
    ["palette", (row) => { row.icon.palette = "unknown"; }, /palette/i],
    ["source", (row) => { row.icon.source = "generated"; }, /source/i],
    ["rationale", (row) => { row.rationale = " "; }, /rationale/i],
    ["provenance", (row) => { row.provenance = {}; }, /provenance/i],
  ]) {
    const entry = structuredClone(valid);
    mutate(entry);
    assert.throws(() => build(entry), pattern, label);
  }
});

test("candidate generation rejects redundant self badges", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );

  assert.throws(
    () =>
      buildElementIconMap({
        seedElements: {
          elements: {
            SelfBadge: { emoji: "💼", category: "worker" },
          },
        },
        seedCombinations: { combinations: {} },
        rules: {
          palettes: ["nature", "product", "office", "studio", "people", "place"],
          category_palettes: { worker: "office" },
          keyword_badges: [
            {
              keywords: ["SelfBadge"],
              badge: "💼",
              reason: "重复主图",
              categories: ["worker"],
            },
          ],
          category_badges: {},
          allowed_sources: ["curated", "entity", "generated", "fallback"],
        },
        knowledge: {},
        emojiManifest: { "💼": "/assets/icons/briefcase.png" },
      }),
    /base and badge must differ/i,
  );
});

test("candidate generation rejects invalid category badge pools", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const validManifest = {
    "💧": "/assets/icons/water.png",
    "🤖": "/assets/icons/robot.png",
  };

  for (const [name, pool, pattern] of [
    ["missing", undefined, /must be a non-empty array/i],
    ["empty", [], /must be a non-empty array/i],
    ["non-string", ["🤖", null], /must contain non-empty strings/i],
    ["duplicate", ["🤖", "🤖"], /must not contain duplicates/i],
    [
      "missing asset",
      ["🤖", "🫥"],
      /does not resolve through the Emoji manifest/i,
    ],
  ]) {
    assert.throws(
      () =>
        buildElementIconMap({
          seedElements: {
            elements: {
              Sample: { emoji: "💧", category: "ai" },
            },
          },
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
          emojiManifest: validManifest,
        }),
      pattern,
      name,
    );
  }
});

test("catalog fallbacks allocate distinct deterministic semantic badges", async () => {
  const { buildElementIconMap } = await import(
    "../scripts/generate-icon-data.mjs"
  );
  const iconMap = buildElementIconMap({
    seedElements: {
      elements: Object.fromEntries(
        ["Catalog A", "Catalog B", "Catalog C"].map((name) => [
          name,
          { emoji: "🧩", category: "abstract" },
        ]),
      ),
    },
    seedCombinations: { combinations: {} },
    catalogElementNames: new Set(["Catalog A", "Catalog B", "Catalog C"]),
    rules: {
      palettes: ["place"],
      category_palettes: { abstract: "place" },
      keyword_badges: [],
      category_badges: {},
      category_badge_pools: {
        catalog: ["🔥", "💧", "🌱"],
      },
      allowed_sources: ["generated", "fallback"],
    },
    knowledge: {},
    emojiManifest: Object.fromEntries(
      ["🧩", "🔥", "💧", "🌱"].map((emoji) => [emoji, `/icons/${emoji}.png`]),
    ),
  });

  assert.equal(
    new Set(Object.values(iconMap).map((entry) => entry.icon.badge)).size,
    3,
  );
  assert.ok(
    Object.values(iconMap).every((entry) => entry.icon.source === "generated"),
  );
});

test("audit counts every member of a reused signature and requires explicit exceptions above twice", async () => {
  const { auditIconMap } = await import("../scripts/audit-icon-map.mjs");
  const seedElements = {
    elements: Object.fromEntries(
      ["A", "B", "C", "D"].map((name) => [
        name,
        { emoji: name === "D" ? "🔥" : "💧", category: "classic" },
      ]),
    ),
  };
  const shared = {
    icon: { base: "💧", palette: "nature", source: "fallback" },
    rationale: "水语义",
  };
  const iconMap = {
    A: structuredClone(shared),
    B: structuredClone(shared),
    C: structuredClone(shared),
    D: {
      icon: { base: "🔥", palette: "nature", source: "fallback" },
      rationale: "火语义",
    },
  };
  const emojiManifest = {
    "💧": "/assets/icons/water.png",
    "🔥": "/assets/icons/fire.png",
  };

  const failed = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest,
    knowledge: {},
  });

  assert.equal(failed.metrics.duplicateEntries, 3);
  assert.equal(failed.metrics.duplicateRate, 0.75);
  assert.deepEqual(failed.signaturesOverTwice[0].names, ["A", "B", "C"]);
  assert.ok(
    failed.violations.some((message) => /more than twice.*exception/i.test(message)),
  );

  for (const name of ["A", "B", "C"]) {
    iconMap[name].duplicate_exception = "三个名称明确表示同一种水概念";
  }
  const excepted = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest,
    knowledge: {},
  });
  assert.ok(
    !excepted.violations.some((message) => /more than twice.*exception/i.test(message)),
  );
});

test("audit gates catalog primary icon placeholders and concentration", async () => {
  const { auditIconMap } = await import("../scripts/audit-icon-map.mjs");
  const names = ["Catalog A", "Catalog B", "Catalog C", "Catalog D", "Catalog E"];
  const seedElements = {
    elements: Object.fromEntries(
      [...names, "Catalog Placeholder"].map((name) => [
        name,
        {
          emoji: name === "Catalog Placeholder" ? "🧩" : "💬",
          category: "abstract",
        },
      ]),
    ),
  };
  const iconMap = Object.fromEntries(
    Object.entries(seedElements.elements).map(([name, row]) => [
      name,
      {
        icon: {
          base: row.emoji,
          palette: "place",
          source: "generated",
        },
        rationale: "catalog fixture",
      },
    ]),
  );
  const catalogElementNames = new Set(Object.keys(seedElements.elements));

  const failed = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest: {
      "💬": "/icons/chat.png",
      "🧩": "/icons/puzzle.png",
    },
    knowledge: {},
    catalogElementNames,
  });

  assert.deepEqual(failed.catalogPlaceholderNames, ["Catalog Placeholder"]);
  assert.deepEqual(failed.catalogBaseOveruseGroups[0].names, names);
  assert.ok(
    failed.violations.some((message) => /catalog.*placeholder.*Catalog Placeholder/i.test(message)),
  );
  assert.ok(
    failed.violations.some((message) => /catalog.*base.*five|5.*exception/i.test(message)),
  );

  for (const name of names) {
    iconMap[name].duplicate_exception = "reviewed catalog visual family";
  }
  const excepted = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest: {
      "💬": "/icons/chat.png",
      "🧩": "/icons/puzzle.png",
    },
    knowledge: {},
    catalogElementNames,
  });

  assert.deepEqual(excepted.catalogBaseOveruseGroups, []);
  assert.ok(
    excepted.violations.every((message) => !/catalog.*base.*five|5.*exception/i.test(message)),
  );
  assert.ok(
    excepted.violations.some((message) => /catalog.*placeholder/i.test(message)),
  );
});

test("audit gates unresolved abbreviations embedded in Chinese names", async () => {
  const { auditIconMap } = await import("../scripts/audit-icon-map.mjs");
  const seedElements = {
    elements: {
      P0故障: { emoji: "🚨", category: "worker" },
      GPT周报: { emoji: "📝", category: "tencent" },
    },
  };
  const iconMap = {
    P0故障: {
      icon: { base: "🚨", palette: "office", source: "fallback" },
      rationale: "故障告警",
    },
    GPT周报: {
      icon: { base: "📝", palette: "product", source: "fallback" },
      rationale: "AI 周报",
    },
  };
  const audit = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest: {
      "🚨": "/assets/icons/alarm.png",
      "📝": "/assets/icons/memo.png",
    },
    knowledge: {},
  });

  assert.deepEqual(
    audit.entityCandidates.map((candidate) => candidate.name),
    ["P0故障", "GPT周报"],
  );
  assert.ok(
    audit.violations.some((message) => /2 unresolved entity.*abbreviation/i.test(message)),
  );
});

test("audit accepts catalog-provenance entities without duplicate knowledge rows", async () => {
  const { auditIconMap } = await import("../scripts/audit-icon-map.mjs");
  const seedElements = {
    elements: {
      "Catalog Studio": {
        emoji: "🎮",
        category: "studio",
        factual_metadata: {
          scope: "studio",
          provenance: "catalogued",
        },
      },
    },
  };

  const audit = auditIconMap({
    seedElements,
    iconMap: {
      "Catalog Studio": {
        icon: {
          base: "🎮",
          palette: "studio",
          source: "fallback",
        },
        rationale: "目录已审核工作室实体",
      },
    },
    emojiManifest: { "🎮": "/icons/game.png" },
    knowledge: {},
  });

  assert.deepEqual(audit.unresolvedEntityCandidates, []);
});
