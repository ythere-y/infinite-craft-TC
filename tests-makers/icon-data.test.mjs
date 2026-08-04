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
