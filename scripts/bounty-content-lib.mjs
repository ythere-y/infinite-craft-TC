import { createHash } from "node:crypto";

const RELATIONSHIP_KINDS = new Set([
  "subsidiary",
  "equity_investment",
  "licensed_partner",
  "historical_association",
]);
const GAME_PROVENANCE_KINDS = new Set([
  "in_house",
  "licensed",
  "co_developed",
  "published",
]);
const GAME_DEVELOPER_PLACEHOLDERS = new Set([
  "Third-party developer",
  "Korean developer",
  "Tencent and a third-party developer",
]);
const BINDING_STARTERS = [
  "水", "火", "风", "土", "企鹅", "人",
  "时间", "AI", "电脑", "手机", "网络",
];

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

function clone(value) {
  return structuredClone(value);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireName(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function sortedEntries(value) {
  return Object.entries(requireRecord(value, "record"))
    .sort(([left], [right]) => left.localeCompare(right, "en"));
}

function parsePair(rawPair, label) {
  const text = requireName(rawPair, label);
  const parts = text.split(" + ");
  if (parts.length !== 2) {
    throw new Error(`${label} must use exactly two names separated by " + "`);
  }
  return [
    requireName(parts[0], `${label} first input`),
    requireName(parts[1], `${label} second input`),
  ];
}

function addRecipe(recipes, combinations, recipe) {
  const pair = normalizePair(recipe.a, recipe.b);
  if (combinations[pair]) {
    throw new Error(`pair conflict for ${pair}`);
  }
  const normalized = {
    ...recipe,
    a: requireName(recipe.a, "recipe a"),
    b: requireName(recipe.b, "recipe b"),
    result: requireName(recipe.result, "recipe result"),
  };
  combinations[pair] = normalized;
  recipes.push(normalized);
}

function starterNames(seedElements) {
  const starters = requireArray(seedElements.starters, "seedElements.starters");
  const names = starters.map((starter, index) => {
    if (typeof starter === "string") return requireName(starter, `starter ${index}`);
    requireRecord(starter, `starter ${index}`);
    return requireName(starter.name ?? starter.id, `starter ${index} name`);
  });
  if (new Set(names).size !== names.length) throw new Error("duplicate starter name");
  const bindingSet = new Set(BINDING_STARTERS);
  if (
    names.length !== BINDING_STARTERS.length ||
    names.some((name) => !bindingSet.has(name))
  ) {
    throw new Error("seedElements.starters must contain the exact eleven binding starters");
  }
  return names;
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function normalizeDestructiveResetFrom(meta, contentEpoch) {
  const values = requireArray(
    meta?.destructive_reset_from,
    "catalog.meta.destructive_reset_from",
  );
  if (values.length === 0) {
    throw new Error("catalog.meta.destructive_reset_from must not be empty");
  }
  const normalized = values.map((value, index) => {
    if (value === "legacy") return value;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value >= contentEpoch
    ) {
      throw new Error(
        `catalog.meta.destructive_reset_from[${index}] must be "legacy" ` +
        `or a positive safe integer below ${contentEpoch}`,
      );
    }
    return value;
  });
  requireUnique(normalized, "catalog.meta.destructive_reset_from entry");
  return normalized;
}

function normalizeGroups(catalog, targetNames) {
  const groups = requireArray(catalog.groups, "catalog.groups");
  const tabs = requireArray(catalog.tabs, "catalog.tabs");
  const tabKeys = new Set(tabs.map((tab, index) =>
    requireName(requireRecord(tab, `catalog.tabs[${index}]`).key, `catalog.tabs[${index}].key`),
  ));
  if (tabKeys.size !== tabs.length) throw new Error("duplicate tab key");

  const groupKeys = [];
  const categories = [];
  const primaryGroups = new Map();
  for (const [index, group] of groups.entries()) {
    const record = requireRecord(group, `catalog.groups[${index}]`);
    const key = requireName(record.key, `catalog.groups[${index}].key`);
    const category = requireName(record.category, `catalog.groups[${index}].category`);
    const tab = requireName(record.tab, `catalog.groups[${index}].tab`);
    if (!tabKeys.has(tab)) throw new Error(`group ${key} references unknown tab ${tab}`);
    groupKeys.push(key);
    categories.push(category);
    for (const target of requireArray(record.targets, `catalog.groups[${index}].targets`)) {
      const name = requireName(target, `catalog.groups[${index}].target`);
      if (!targetNames.has(name)) throw new Error(`group ${key} references unknown target ${name}`);
      if (primaryGroups.has(name)) throw new Error(`target ${name} has more than one primary group`);
      primaryGroups.set(name, { key, category });
    }
  }
  requireUnique(groupKeys, "group key");
  requireUnique(categories, "group category");
  for (const target of targetNames) {
    const group = primaryGroups.get(target);
    if (!group) throw new Error(`target ${target} must have one primary group`);
    if (catalog.targets[target].category !== group.category) {
      throw new Error(`target ${target} category must match its primary group`);
    }
  }
  return primaryGroups;
}

function validateRelationships(target, targetName) {
  const record = requireRecord(target.relationship, `${targetName} relationship record`);
  const kind = requireName(record.kind, `${targetName} relationship kind`);
  if (!RELATIONSHIP_KINDS.has(kind)) {
    throw new Error(`invalid relationship kind ${kind} for ${targetName}`);
  }
  for (const field of ["as_of", "source_url", "source_title", "note"]) {
    requireName(record[field], `${targetName} relationship ${field}`);
  }
}

function validateGameFacts(target, targetName) {
  const record = requireRecord(
    target.factual_metadata,
    `${targetName} factual metadata`,
  );
  const provenance = requireName(
    record.provenance,
    `${targetName} game provenance`,
  );
  if (!GAME_PROVENANCE_KINDS.has(provenance)) {
    throw new Error(`invalid game provenance ${provenance} for ${targetName}`);
  }
  const developer = requireName(
    record.developer,
    `${targetName} factual metadata developer`,
  );
  if (GAME_DEVELOPER_PLACEHOLDERS.has(developer)) {
    throw new Error(`placeholder developer metadata for ${targetName}`);
  }
  for (const field of ["tencent_role", "source_url", "source_title"]) {
    requireName(record[field], `${targetName} factual metadata ${field}`);
  }
}

function validateAliases(targets, canonicalNames, starterSet) {
  const aliases = new Set();
  for (const [targetName, target] of sortedEntries(targets)) {
    for (const alias of requireArray(target.aliases ?? [], `${targetName}.aliases`)) {
      const name = requireName(alias, `${targetName} alias`);
      if (canonicalNames.has(name) || starterSet.has(name)) {
        throw new Error(`alias ${name} collides with an element`);
      }
      if (aliases.has(name)) throw new Error(`alias ${name} collides with another alias`);
      aliases.add(name);
    }
  }
  return aliases;
}

function calculateDepths(starters, recipes) {
  const depths = Object.fromEntries([...starters].sort().map((name) => [name, 0]));
  for (let round = 0; round < recipes.length; round += 1) {
    let changed = false;
    for (const recipe of recipes) {
      const aDepth = depths[recipe.a];
      const bDepth = depths[recipe.b];
      if (aDepth == null || bDepth == null) continue;
      const candidate = Math.max(aDepth, bDepth) + 1;
      if (depths[recipe.result] == null || candidate < depths[recipe.result]) {
        depths[recipe.result] = candidate;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depths;
}

function normalizedSource({ catalog, seedElements, seedCombinations }) {
  const normalizedCatalog = clone(catalog);
  normalizedCatalog.support_recipes = Object.fromEntries(
    sortedEntries(catalog.support_recipes ?? {}).map(([rawPair, recipe]) => {
      const [a, b] = parsePair(rawPair, "support recipe pair");
      return [normalizePair(a, b), { ...clone(recipe), a, b }];
    }),
  );
  for (const [target, value] of sortedEntries(catalog.targets ?? {})) {
    const recipe = value.canonical_recipe;
    if (recipe) {
      normalizedCatalog.targets[target] = {
        ...clone(value),
        canonical_recipe: {
          ...clone(recipe),
          a: requireName(recipe.a, `${target} canonical recipe a`),
          b: requireName(recipe.b, `${target} canonical recipe b`),
        },
      };
    }
  }
  const normalizedCombinations = Object.fromEntries(
    sortedEntries(seedCombinations.combinations ?? {}).map(([rawPair, recipe]) => {
      const [a, b] = parsePair(rawPair, "seed combination pair");
      return [normalizePair(a, b), { ...clone(recipe), a, b }];
    }),
  );
  return {
    catalog: normalizedCatalog,
    seedElements: clone(seedElements),
    seedCombinations: { ...clone(seedCombinations), combinations: normalizedCombinations },
  };
}

export function normalizePair(a, b) {
  return [String(a).trim(), String(b).trim()].sort().join(" + ");
}

export function compileBountyContent({ catalog, seedElements, seedCombinations }) {
  requireRecord(catalog, "catalog");
  requireRecord(seedElements, "seedElements");
  requireRecord(seedCombinations, "seedCombinations");
  if (catalog.meta?.content_epoch !== 2) {
    throw new Error("catalog content_epoch must be 2");
  }
  const destructiveResetFrom = normalizeDestructiveResetFrom(
    catalog.meta,
    catalog.meta.content_epoch,
  );

  const sourceElements = requireRecord(seedElements.elements, "seedElements.elements");
  const sourceCombinations = requireRecord(
    seedCombinations.combinations,
    "seedCombinations.combinations",
  );
  const targets = requireRecord(catalog.targets, "catalog.targets");
  const supportElements = requireRecord(catalog.support_elements, "catalog.support_elements");
  const supportRecipes = requireRecord(catalog.support_recipes, "catalog.support_recipes");
  const starters = starterNames(seedElements);
  const starterSet = new Set(starters);
  const targetNames = new Set(Object.keys(targets));
  const supportNames = new Set(Object.keys(supportElements));
  const elementNames = new Set(Object.keys(sourceElements));

  for (const name of [...targetNames, ...supportNames]) {
    requireName(name, "catalog element name");
    if (elementNames.has(name)) throw new Error(`canonical element ${name} is duplicated`);
  }
  for (const name of targetNames) {
    if (supportNames.has(name)) throw new Error(`canonical element ${name} is duplicated`);
    if (starterSet.has(name)) throw new Error(`target ${name} cannot be a starter`);
  }
  const primaryGroups = normalizeGroups(catalog, targetNames);

  const canonicalNames = new Set([...elementNames, ...supportNames, ...targetNames]);
  validateAliases(targets, canonicalNames, starterSet);

  const combinations = {};
  const recipes = [];
  const supportResults = new Set();
  for (const [rawPair, info] of sortedEntries(sourceCombinations)) {
    const [a, b] = parsePair(rawPair, "seed combination pair");
    const recipe = requireRecord(info, `seed recipe ${rawPair}`);
    const result = requireName(recipe.result, `seed recipe ${rawPair} result`);
    if (!elementNames.has(result)) {
      throw new Error(`seed recipe ${rawPair} has unknown result ${result}`);
    }
    addRecipe(recipes, combinations, { ...clone(recipe), a, b, result, source: "seed" });
  }
  for (const [rawPair, info] of sortedEntries(supportRecipes)) {
    const [a, b] = parsePair(rawPair, "support recipe pair");
    const recipe = requireRecord(info, `support recipe ${rawPair}`);
    const result = requireName(recipe.result, `support recipe ${rawPair} result`);
    if (!supportNames.has(result) && !elementNames.has(result)) {
      throw new Error(
        `support recipe ${rawPair} must produce a support or seed element`,
      );
    }
    if (supportNames.has(result)) supportResults.add(result);
    addRecipe(recipes, combinations, { ...clone(recipe), a, b, result, source: "support" });
  }
  for (const [targetName, target] of sortedEntries(targets)) {
    requireRecord(target, `target ${targetName}`);
    const primaryGroup = primaryGroups.get(targetName);
    if (
      primaryGroup.key === "association" ||
      primaryGroup.category === "association"
    ) {
      validateRelationships(target, targetName);
    }
    if (
      primaryGroup.key === "tencent_game" ||
      primaryGroup.category === "tencent_game"
    ) {
      validateGameFacts(target, targetName);
    }
    const recipe = requireRecord(target.canonical_recipe, `${targetName} canonical recipe`);
    const a = requireName(recipe.a, `${targetName} canonical recipe a`);
    const b = requireName(recipe.b, `${targetName} canonical recipe b`);
    addRecipe(recipes, combinations, {
      ...clone(recipe),
      a,
      b,
      result: targetName,
      emoji: requireName(target.emoji, `${targetName} emoji`),
      source: "target",
    });
  }
  const orderedRecipes = [...recipes].sort((left, right) =>
    normalizePair(left.a, left.b).localeCompare(normalizePair(right.a, right.b), "en"),
  );
  const depths = calculateDepths(starters, orderedRecipes);
  for (const recipe of orderedRecipes) {
    for (const input of [recipe.a, recipe.b]) {
      if (depths[input] == null) throw new Error(`unreachable recipe input ${input}`);
    }
  }
  for (const target of targetNames) {
    if (depths[target] == null) throw new Error(`target ${target} is unreachable`);
    if (depths[target] === 0) throw new Error(`target ${target} cannot have depth 0`);
  }
  const consumedSupportElements = new Set(
    orderedRecipes
      .filter((recipe) => recipe.source === "support" || recipe.source === "target")
      .flatMap((recipe) => [recipe.a, recipe.b])
      .filter((name) => supportNames.has(name)),
  );
  for (const name of supportNames) {
    if (!supportResults.has(name)) throw new Error(`unused support element ${name}`);
    if (!consumedSupportElements.has(name) && !targetNames.has(name)) {
      throw new Error(`unused support element ${name}`);
    }
  }

  const targetElements = Object.fromEntries(sortedEntries(targets).map(([name, target]) => {
    const { canonical_recipe, ...element } = clone(target);
    return [name, element];
  }));
  const elements = {
    ...clone(sourceElements),
    ...clone(supportElements),
    ...targetElements,
  };
  const compiledCombinations = Object.fromEntries(
    Object.entries(combinations).sort(([left], [right]) => left.localeCompare(right, "en")),
  );
  const recipesByResult = {};
  for (const recipe of Object.values(compiledCombinations)) {
    (recipesByResult[recipe.result] ??= []).push(recipe);
  }
  const normalized = normalizedSource({ catalog, seedElements, seedCombinations });
  const aliases = {};
  const canonicalRecipes = {};
  for (const [name, target] of sortedEntries(targets)) {
    canonicalRecipes[name] = {
      ...clone(target.canonical_recipe),
      result: name,
    };
    for (const alias of target.aliases ?? []) aliases[alias] = name;
  }
  const bounty = {
    tabs: clone(catalog.tabs),
    groups: clone(catalog.groups),
  };
  return {
    content_epoch: 2,
    destructive_reset_from: destructiveResetFrom,
    catalog_digest: digest(normalized),
    catalog: normalized.catalog,
    bounty,
    starters: clone(seedElements.starters),
    elements,
    combinations: compiledCombinations,
    recipes_by_result: recipesByResult,
    aliases: Object.fromEntries(
      Object.entries(aliases).sort(([left], [right]) =>
        left.localeCompare(right, "en")
      ),
    ),
    canonical_recipes: canonicalRecipes,
    depths: Object.fromEntries(Object.entries(depths).sort(([left], [right]) => left.localeCompare(right, "en"))),
    retired_pairs: clone(catalog.retired_pairs ?? []),
    retired_elements: clone(catalog.retired_elements ?? []),
  };
}

export function serializePythonArtifact(compiled) {
  requireRecord(compiled, "compiled content");
  return `${JSON.stringify(compiled, null, 2)}\n`;
}

export function serializeEdgeArtifact(compiled) {
  requireRecord(compiled, "compiled content");
  return [
    "// Generated by scripts/bounty-content-lib.mjs. Do not edit by hand.",
    `export const BOUNTY_CONTENT = Object.freeze(${canonicalJson(compiled)});`,
    "export const CONTENT_EPOCH = BOUNTY_CONTENT.content_epoch;",
    "export const DESTRUCTIVE_RESET_FROM = BOUNTY_CONTENT.destructive_reset_from;",
    "export const CATALOG_DIGEST = BOUNTY_CONTENT.catalog_digest;",
    "export const BOUNTY_TABS = BOUNTY_CONTENT.bounty.tabs;",
    "export const BOUNTY_GROUPS = BOUNTY_CONTENT.bounty.groups;",
    "export const BOUNTY_ELEMENTS = BOUNTY_CONTENT.elements;",
    "export const BOUNTY_COMBINATIONS = BOUNTY_CONTENT.combinations;",
    "export const BOUNTY_RECIPES_BY_RESULT = BOUNTY_CONTENT.recipes_by_result;",
    "export const BOUNTY_ALIASES = BOUNTY_CONTENT.aliases;",
    "export const RETIRED_PAIRS = BOUNTY_CONTENT.retired_pairs;",
    "export const RETIRED_ELEMENTS = BOUNTY_CONTENT.retired_elements;",
    "",
  ].join("\n");
}
