import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_MAP_PATH = "frontend/assets/icons/generated/element-icon-map.json";
const MAKERS_DATA_PATH = "edge-functions/_generated/icon-data.js";

function isObjectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizePair(pair) {
  const parts = pair.split(" + ").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Malformed combination key: ${pair}`);
  }
  return parts.sort().join(" + ");
}

function combinationCore(recipe) {
  return {
    result: recipe?.result,
    emoji: recipe?.emoji,
    chain: recipe?.chain,
  };
}

export function mergeIconContent({
  baseElements,
  baseCombinations,
  bountyContent,
}) {
  if (!isObjectRecord(baseElements?.elements)) {
    throw new Error("Base elements must expose an elements object");
  }
  if (!isObjectRecord(baseCombinations?.combinations)) {
    throw new Error("Base combinations must expose a combinations object");
  }
  if (!isObjectRecord(bountyContent?.elements)) {
    throw new Error("Compiled bounty content must expose an elements object");
  }
  if (!isObjectRecord(bountyContent?.combinations)) {
    throw new Error("Compiled bounty content must expose a combinations object");
  }

  const elements = structuredClone(baseElements.elements);
  for (const [name, entry] of Object.entries(bountyContent.elements)) {
    if (
      Object.hasOwn(baseElements.elements, name) &&
      JSON.stringify(baseElements.elements[name]) !== JSON.stringify(entry)
    ) {
      throw new Error(`Compiled bounty element conflicts with base seed: ${name}`);
    }
    elements[name] = structuredClone(entry);
  }

  const combinations = {};
  for (const [pair, recipe] of Object.entries(baseCombinations.combinations)) {
    combinations[normalizePair(pair)] = structuredClone(recipe);
  }
  for (const [pair, recipe] of Object.entries(bountyContent.combinations)) {
    const normalized = normalizePair(pair);
    if (
      Object.hasOwn(combinations, normalized) &&
      JSON.stringify(combinationCore(combinations[normalized])) !==
        JSON.stringify(combinationCore(recipe))
    ) {
      throw new Error(
        `Compiled bounty combination conflicts with base seed: ${normalized}`,
      );
    }
    combinations[normalized] = structuredClone(recipe);
  }

  return {
    elements: { ...baseElements, elements },
    combinations: { ...baseCombinations, combinations },
  };
}

async function readJson(path, label) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing at ${path}`);
    }
    throw error;
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function requireManifestEmoji(emojiManifest, emoji, label) {
  if (!emojiManifest[emoji]) {
    throw new Error(`${label} ${emoji} does not resolve through the Emoji manifest`);
  }
}

function requireDistinctBaseAndBadge(icon, label) {
  if (icon.badge !== undefined && icon.base === icon.badge) {
    throw new Error(`${label} base and badge must differ`);
  }
}

function validateExplicitIcon(icon, label, rules, emojiManifest) {
  if (!isObjectRecord(icon)) {
    throw new Error(`${label} must be an icon object`);
  }
  requireManifestEmoji(emojiManifest, icon.base, `${label}.base`);
  if (!rules.palettes.includes(icon.palette)) {
    throw new Error(`${label}.palette must use a configured palette`);
  }
  if (!rules.allowed_sources.includes(icon.source)) {
    throw new Error(`${label}.source must use an allowed source`);
  }
  if (icon.badge !== undefined) {
    requireManifestEmoji(emojiManifest, icon.badge, `${label}.badge`);
  }
  requireDistinctBaseAndBadge(icon, label);
}

function validateCuratedEntry(entry, name, rules, emojiManifest) {
  if (!isObjectRecord(entry)) {
    throw new Error(`${name} curated mapping must be an object`);
  }
  validateExplicitIcon(entry.icon, `${name}.icon`, rules, emojiManifest);
  validateExplicitIcon(
    entry.fallback_icon,
    `${name}.fallback_icon`,
    rules,
    emojiManifest,
  );
  if (typeof entry.rationale !== "string" || !entry.rationale.trim()) {
    throw new Error(`${name}.rationale must be a non-empty string`);
  }
  if (
    !isObjectRecord(entry.provenance) ||
    typeof entry.provenance.source_id !== "string" ||
    !entry.provenance.source_id.trim()
  ) {
    throw new Error(`${name}.provenance must contain a source_id`);
  }
}

function validateRules(rules, categories, emojiManifest) {
  const paletteSet = new Set(rules.palettes);
  for (const category of categories) {
    const palette = rules.category_palettes[category];
    if (!paletteSet.has(palette)) {
      throw new Error(
        `Category ${category} must map to one of the configured palettes`,
      );
    }
  }

  for (const [index, rule] of rules.keyword_badges.entries()) {
    if (!Array.isArray(rule.keywords) || !rule.keywords.length) {
      throw new Error(`keyword_badges[${index}] must contain keywords`);
    }
    requireManifestEmoji(
      emojiManifest,
      rule.badge,
      `keyword_badges[${index}].badge`,
    );
  }
  for (const [category, badge] of Object.entries(rules.category_badges)) {
    requireManifestEmoji(emojiManifest, badge, `category_badges.${category}`);
  }
  for (const [category, pool] of Object.entries(
    rules.category_badge_pools || {},
  )) {
    const label = `category_badge_pools.${category}`;
    if (!Array.isArray(pool) || !pool.length) {
      throw new Error(`${label} must be a non-empty array`);
    }
    if (
      !pool.every(
        (badge) => typeof badge === "string" && badge.trim().length > 0,
      )
    ) {
      throw new Error(`${label} must contain non-empty strings`);
    }
    if (new Set(pool).size !== pool.length) {
      throw new Error(`${label} must not contain duplicates`);
    }
    for (const badge of pool) {
      requireManifestEmoji(emojiManifest, badge, label);
    }
  }
}

function buildResultContexts(seedCombinations) {
  const combinations = seedCombinations?.combinations;
  if (
    !combinations ||
    Array.isArray(combinations) ||
    typeof combinations !== "object"
  ) {
    throw new Error("Seed combinations must expose a combinations object");
  }

  const resultContexts = new Map();
  for (const [combination, recipe] of Object.entries(combinations)) {
    if (!recipe?.result) continue;
    const contexts = resultContexts.get(recipe.result) ?? [];
    contexts.push({
      chain: recipe.chain,
      combination,
      parents: combination.split(" + "),
    });
    resultContexts.set(recipe.result, contexts);
  }
  return resultContexts;
}

function findKeywordRule(name, category, contexts, rules) {
  return rules.keyword_badges.find(
    (rule) =>
      rule.keywords.includes(name) &&
      (!rule.categories ||
        rule.categories.includes(category) ||
        contexts.some((context) => rule.categories.includes(context.chain))),
  );
}

function contextDescription(contexts) {
  if (!contexts.length) return "";
  const context = contexts[0];
  return `种子配方“${context.parents.join(" + ")}”${
    context.chain ? `（${context.chain} 链）` : ""
  }`;
}

function rationaleForSeed(name, emoji, category, qualifier, contexts) {
  const context = contextDescription(contexts);
  if (qualifier) {
    return `沿用种子语义“${emoji}”，依据${context || `${category}类别`}以“${qualifier}”徽章区分“${name}”`;
  }
  if (context) {
    return `沿用种子语义“${emoji}”；${context}确认“${name}”概念，无需附加徽章`;
  }
  return `沿用种子元素的“${emoji}”语义；${category}类别无需附加徽章`;
}

function stableNameHash(name) {
  let value = 0;
  for (const character of String(name).normalize("NFC")) {
    value = (value * 31 + character.codePointAt(0)) % 2_147_483_647;
  }
  return value;
}

function allocateCatalogBadge({
  name,
  base,
  palette,
  pool,
  usedBadgesBySignature,
}) {
  if (!Array.isArray(pool)) return undefined;
  const candidates = pool.filter((badge) => badge !== base);
  if (!candidates.length) return undefined;

  const signature = `${base}\u0000${palette}`;
  const used = usedBadgesBySignature.get(signature) ?? new Set();
  const start = stableNameHash(name) % candidates.length;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const badge = candidates[(start + offset) % candidates.length];
    if (!used.has(badge)) return badge;
  }
  return candidates[start];
}

function rememberBadge(icon, usedBadgesBySignature) {
  if (icon.badge === undefined) return;
  const signature = `${icon.base}\u0000${icon.palette}`;
  const used = usedBadgesBySignature.get(signature) ?? new Set();
  used.add(icon.badge);
  usedBadgesBySignature.set(signature, used);
}

export function buildElementIconMap({
  seedElements,
  seedCombinations,
  catalogElementNames = new Set(),
  rules,
  knowledge,
  curated = {},
  emojiManifest,
}) {
  const elements = seedElements?.elements;
  if (!elements || Array.isArray(elements) || typeof elements !== "object") {
    throw new Error("Seed elements must expose an elements object");
  }

  const categories = new Set(
    Object.values(elements).map((entry) => entry.category),
  );
  validateRules(rules, categories, emojiManifest);
  const resultContexts = buildResultContexts(seedCombinations);

  const unknownKnowledge = Object.keys(knowledge).filter(
    (name) => !Object.hasOwn(elements, name),
  );
  if (unknownKnowledge.length) {
    throw new Error(
      `Icon knowledge contains unknown elements: ${unknownKnowledge.join(", ")}`,
    );
  }
  const unknownCurated = Object.keys(curated).filter(
    (name) => !Object.hasOwn(elements, name),
  );
  if (unknownCurated.length) {
    throw new Error(
      `Curated icons contain unknown elements: ${unknownCurated.join(", ")}`,
    );
  }

  const iconMap = {};
  const usedBadgesBySignature = new Map();
  for (const [name, seed] of Object.entries(elements)) {
    requireManifestEmoji(emojiManifest, seed.emoji, `${name}.emoji`);

    const curatedEntry = curated[name];
    if (curatedEntry) {
      validateCuratedEntry(curatedEntry, name, rules, emojiManifest);
      iconMap[name] = structuredClone(curatedEntry);
      rememberBadge(curatedEntry.icon, usedBadgesBySignature);
      continue;
    }

    const entity = knowledge[name];
    if (entity) {
      requireManifestEmoji(emojiManifest, entity.icon.base, `${name}.icon.base`);
      if (entity.icon.badge !== undefined) {
        requireManifestEmoji(
          emojiManifest,
          entity.icon.badge,
          `${name}.icon.badge`,
        );
      }
      requireDistinctBaseAndBadge(entity.icon, `${name}.icon`);
      iconMap[name] = structuredClone(entity);
      rememberBadge(entity.icon, usedBadgesBySignature);
      continue;
    }

    const palette = rules.category_palettes[seed.category];
    const contexts = resultContexts.get(name) ?? [];
    const keywordRule = findKeywordRule(name, seed.category, contexts, rules);
    const badge =
      keywordRule?.badge ??
      (catalogElementNames.has(name)
        ? allocateCatalogBadge({
            name,
            base: seed.emoji,
            palette,
            pool: rules.category_badge_pools?.catalog,
            usedBadgesBySignature,
          })
        : undefined);
    const icon = {
      base: seed.emoji,
      ...(badge ? { badge } : {}),
      palette,
      source: badge ? "generated" : "fallback",
    };
    requireDistinctBaseAndBadge(icon, `${name}.icon`);
    rememberBadge(icon, usedBadgesBySignature);
    iconMap[name] = {
      icon,
      rationale: rationaleForSeed(
        name,
        seed.emoji,
        seed.category,
        keywordRule?.reason ?? (badge ? "合并目录语义" : undefined),
        contexts,
      ),
    };
  }
  return iconMap;
}

function collectEntityAliases(knowledge) {
  const aliases = {};
  for (const [name, row] of Object.entries(knowledge)) {
    aliases[name] = name;
    for (const alias of row.aliases) {
      aliases[alias] = name;
    }
  }
  return aliases;
}

function serializeMakersData(iconMap, rules, knowledge) {
  return [
    "// Generated by scripts/generate-icon-data.mjs. Do not edit manually.",
    "",
    `export const ELEMENT_ICONS = ${JSON.stringify(iconMap, null, 2)};`,
    "",
    `export const ICON_RULES = ${JSON.stringify(rules, null, 2)};`,
    "",
    `export const ENTITY_ALIASES = ${JSON.stringify(
      collectEntityAliases(knowledge),
      null,
      2,
    )};`,
    "",
  ].join("\n");
}

export async function generateIconData({ root = ROOT } = {}) {
  const projectRoot = resolve(root);
  const [
    baseElements,
    baseCombinations,
    bountyContent,
    rules,
    knowledge,
    curated,
    emojiManifest,
  ] = await Promise.all([
    readJson(resolve(projectRoot, "backend/seed_elements.json"), "Seed elements"),
    readJson(
      resolve(projectRoot, "backend/seed_combinations.json"),
      "Seed combinations",
    ),
    readJson(
      resolve(projectRoot, "backend/generated/bounty-content.json"),
      "Compiled bounty content",
    ),
    readJson(resolve(projectRoot, "backend/icon_rules.json"), "Icon rules"),
    readJson(
      resolve(projectRoot, "backend/icon_knowledge.json"),
      "Icon knowledge",
    ),
    readJson(
      resolve(projectRoot, "backend/icon_curated.json"),
      "Curated icons",
    ),
    readJson(
      resolve(
        projectRoot,
        "frontend/assets/icons/generated/emoji-icon-manifest.json",
      ),
      "Emoji manifest",
    ),
  ]);
  const {
    elements: seedElements,
    combinations: seedCombinations,
  } = mergeIconContent({
    baseElements,
    baseCombinations,
    bountyContent,
  });
  const baseNames = new Set(Object.keys(baseElements.elements));
  const catalogElementNames = new Set(
    Object.keys(bountyContent.elements).filter((name) => !baseNames.has(name)),
  );

  const iconMap = buildElementIconMap({
    seedElements,
    seedCombinations,
    catalogElementNames,
    rules,
    knowledge,
    curated,
    emojiManifest,
  });
  const browserPath = resolve(projectRoot, BROWSER_MAP_PATH);
  const makersPath = resolve(projectRoot, MAKERS_DATA_PATH);
  await Promise.all([
    mkdir(dirname(browserPath), { recursive: true }),
    mkdir(dirname(makersPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(browserPath, `${JSON.stringify(iconMap, null, 2)}\n`),
    writeFile(makersPath, serializeMakersData(iconMap, rules, knowledge)),
  ]);

  return {
    aliases: Object.keys(collectEntityAliases(knowledge)).length,
    elements: Object.keys(iconMap).length,
    entities: Object.keys(knowledge).length,
    curated: Object.keys(curated).length,
    outputs: [BROWSER_MAP_PATH, MAKERS_DATA_PATH],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateIconData()
    .then((summary) => {
      console.log(
        `Generated ${summary.elements} icon recipes (${summary.entities} entity and ${summary.curated} curated overrides).`,
      );
    })
    .catch((error) => {
      console.error(`Icon data generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
