import { createHash } from "node:crypto";

const RELATIONSHIP_KINDS = new Set([
  "subsidiary",
  "equity_investment",
  "licensed_partner",
  "historical_association",
]);

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
  return names;
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
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
}

function relationshipRecords(target, targetName) {
  const values = [];
  if (target.relationship != null) values.push(target.relationship);
  if (target.relationships != null) values.push(...requireArray(target.relationships, `${targetName}.relationships`));
  if (target.relationship_kind != null) values.push({ kind: target.relationship_kind });
  return values;
}

function validateRelationships(target, targetName) {
  for (const relationship of relationshipRecords(target, targetName)) {
    const record = typeof relationship === "string"
      ? { kind: relationship }
      : requireRecord(relationship, `${targetName} relationship`);
    const kind = requireName(record.kind, `${targetName} relationship kind`);
    if (!RELATIONSHIP_KINDS.has(kind)) {
      throw new Error(`invalid relationship kind ${kind} for ${targetName}`);
    }
    if (kind !== "historical_association") continue;
    for (const field of ["as_of", "source_url", "source_title", "note"]) {
      const value = record[field] ?? target[field];
      requireName(value, `${targetName} historical association ${field}`);
    }
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
  normalizeGroups(catalog, targetNames);

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
    if (!supportNames.has(result)) {
      throw new Error(`support recipe ${rawPair} must produce a support element`);
    }
    supportResults.add(result);
    addRecipe(recipes, combinations, { ...clone(recipe), a, b, result, source: "support" });
  }
  for (const [targetName, target] of sortedEntries(targets)) {
    requireRecord(target, `target ${targetName}`);
    validateRelationships(target, targetName);
    const recipe = requireRecord(target.canonical_recipe, `${targetName} canonical recipe`);
    const a = requireName(recipe.a, `${targetName} canonical recipe a`);
    const b = requireName(recipe.b, `${targetName} canonical recipe b`);
    addRecipe(recipes, combinations, {
      ...clone(recipe), a, b, result: targetName, source: "target",
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
  for (const name of supportNames) {
    if (!supportResults.has(name)) throw new Error(`unused support element ${name}`);
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
  return {
    content_epoch: 2,
    catalog_digest: digest(normalized),
    catalog: normalized.catalog,
    starters: clone(seedElements.starters),
    elements,
    combinations: compiledCombinations,
    recipes_by_result: recipesByResult,
    depths: Object.fromEntries(Object.entries(depths).sort(([left], [right]) => left.localeCompare(right, "en"))),
    retired_pairs: clone(catalog.retired_pairs ?? []),
    retired_elements: clone(catalog.retired_elements ?? []),
  };
}

function pythonLiteral(value) {
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${pythonLiteral(key)}: ${pythonLiteral(value[key])}`,
    ).join(", ")}}`;
  }
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return JSON.stringify(value);
}

export function serializePythonArtifact(compiled) {
  requireRecord(compiled, "compiled content");
  return [
    "# Generated by scripts/bounty-content-lib.mjs. Do not edit by hand.",
    `BOUNTY_CONTENT = ${pythonLiteral(compiled)}`,
    "",
  ].join("\n");
}

export function serializeEdgeArtifact(compiled) {
  requireRecord(compiled, "compiled content");
  return [
    "// Generated by scripts/bounty-content-lib.mjs. Do not edit by hand.",
    `export const BOUNTY_CONTENT = Object.freeze(${canonicalJson(compiled)});`,
    "",
  ].join("\n");
}
