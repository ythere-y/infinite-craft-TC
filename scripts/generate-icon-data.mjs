import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_MAP_PATH = "frontend/assets/icons/generated/element-icon-map.json";
const MAKERS_DATA_PATH = "edge-functions/_generated/icon-data.js";

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

export function buildElementIconMap({
  seedElements,
  seedCombinations,
  rules,
  knowledge,
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

  const iconMap = {};
  for (const [name, seed] of Object.entries(elements)) {
    requireManifestEmoji(emojiManifest, seed.emoji, `${name}.emoji`);

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
      continue;
    }

    const palette = rules.category_palettes[seed.category];
    const contexts = resultContexts.get(name) ?? [];
    const keywordRule = findKeywordRule(name, seed.category, contexts, rules);
    const badge = keywordRule?.badge;
    const icon = {
      base: seed.emoji,
      ...(badge ? { badge } : {}),
      palette,
      source: badge ? "generated" : "fallback",
    };
    requireDistinctBaseAndBadge(icon, `${name}.icon`);
    iconMap[name] = {
      icon,
      rationale: rationaleForSeed(
        name,
        seed.emoji,
        seed.category,
        keywordRule?.reason,
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
  const [seedElements, seedCombinations, rules, knowledge, emojiManifest] =
    await Promise.all([
      readJson(resolve(projectRoot, "backend/seed_elements.json"), "Seed elements"),
      readJson(
        resolve(projectRoot, "backend/seed_combinations.json"),
        "Seed combinations",
      ),
      readJson(resolve(projectRoot, "backend/icon_rules.json"), "Icon rules"),
      readJson(
        resolve(projectRoot, "backend/icon_knowledge.json"),
        "Icon knowledge",
      ),
      readJson(
        resolve(
          projectRoot,
          "frontend/assets/icons/generated/emoji-icon-manifest.json",
        ),
        "Emoji manifest",
      ),
    ]);

  const iconMap = buildElementIconMap({
    seedElements,
    seedCombinations,
    rules,
    knowledge,
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
    outputs: [BROWSER_MAP_PATH, MAKERS_DATA_PATH],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateIconData()
    .then((summary) => {
      console.log(
        `Generated ${summary.elements} icon recipes (${summary.entities} entity overrides).`,
      );
    })
    .catch((error) => {
      console.error(`Icon data generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
