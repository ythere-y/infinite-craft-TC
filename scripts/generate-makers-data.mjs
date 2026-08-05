import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compileBountyContent } from "./bounty-content-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ELEMENTS_PATH = resolve(ROOT, "backend/seed_elements.json");
const COMBINATIONS_PATH = resolve(ROOT, "backend/seed_combinations.json");
const CATALOG_PATH = resolve(ROOT, "content/tencent-bounty-catalog.json");
const BOUNTY_CONTENT_PATH = resolve(
  ROOT,
  "backend/generated/bounty-content.json",
);
const ICONS_PATH = resolve(
  ROOT,
  "frontend/assets/icons/generated/element-icon-map.json",
);
const OUTPUT_PATH = resolve(
  ROOT,
  "edge-functions/_generated/seed-data.js",
);

function normalizePair(a, b) {
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

function calculateDepths(starters, recipes) {
  const depths = Object.fromEntries(
    starters.map((item) => item.name).sort().map((name) => [name, 0]),
  );
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
  for (const recipe of recipes) {
    for (const input of [recipe.a, recipe.b]) {
      if (depths[input] == null) {
        throw new Error(`Unreachable fixed recipe input: ${input}`);
      }
    }
  }
  return depths;
}

export async function generateMakersData({
  elementsPath = ELEMENTS_PATH,
  combinationsPath = COMBINATIONS_PATH,
  catalogPath = CATALOG_PATH,
  bountyContentPath = BOUNTY_CONTENT_PATH,
  iconsPath = ICONS_PATH,
  outputPath = OUTPUT_PATH,
} = {}) {
  const [
    elementSource,
    combinationSource,
    catalogSource,
    bountySource,
    iconSource,
  ] =
    await Promise.all([
      readFile(elementsPath, "utf8").then(JSON.parse),
      readFile(combinationsPath, "utf8").then(JSON.parse),
      readFile(catalogPath, "utf8").then(JSON.parse),
      readFile(bountyContentPath, "utf8").then(JSON.parse),
      readFile(iconsPath, "utf8").then(JSON.parse),
    ]);

  if (
    bountySource.content_epoch !== 2 ||
    !/^sha256:[0-9a-f]{64}$/.test(bountySource.catalog_digest ?? "")
  ) {
    throw new Error("Invalid compiled bounty epoch or digest");
  }
  const expectedBounty = compileBountyContent({
    catalog: catalogSource,
    seedElements: elementSource,
    seedCombinations: combinationSource,
  });
  if (canonicalJson(bountySource) !== canonicalJson(expectedBounty)) {
    throw new Error(
      "Compiled bounty artifact does not match its deterministic projection",
    );
  }
  if (
    !bountySource.bounty ||
    !Array.isArray(bountySource.bounty.tabs) ||
    !Array.isArray(bountySource.bounty.groups)
  ) {
    throw new Error("Compiled bounty tabs and groups are required");
  }
  if (
    JSON.stringify(bountySource.starters) !==
    JSON.stringify(elementSource.starters)
  ) {
    throw new Error("Compiled bounty starters conflict with base seeds");
  }
  for (const [name, info] of Object.entries(elementSource.elements ?? {})) {
    if (JSON.stringify(bountySource.elements?.[name]) !== JSON.stringify(info)) {
      throw new Error(`Compiled bounty element conflicts with base seed: ${name}`);
    }
  }
  for (const [rawKey, info] of Object.entries(
    combinationSource.combinations ?? {},
  )) {
    const parts = rawKey.split(" + ").map((part) => part.trim());
    if (parts.length !== 2) continue;
    const compiled = bountySource.combinations?.[
      normalizePair(parts[0], parts[1])
    ];
    if (
      !compiled ||
      ["result", "emoji", "chain"].some(
        (field) => compiled[field] !== info[field],
      )
    ) {
      throw new Error(`Compiled bounty pair conflicts with base seed: ${rawKey}`);
    }
  }

  const combinations = {};
  const recipesByResult = {};
  const recipes = [];
  const elements = Object.fromEntries(
    Object.entries(bountySource.elements ?? {}).map(([name, info]) => {
      if (Object.hasOwn(iconSource, name)) {
        return [name, { ...info, icon: iconSource[name].icon }];
      }
      return [name, info];
    }),
  );

  for (const [rawKey, rawInfo] of Object.entries(
    bountySource.combinations ?? {},
  )) {
    const parts = rawKey.split(" + ").map((part) => part.trim());
    if (
      parts.length !== 2 ||
      parts.some((part) => !part) ||
      !rawInfo ||
      typeof rawInfo !== "object" ||
      Array.isArray(rawInfo) ||
      typeof rawInfo.result !== "string" ||
      !rawInfo.result.trim()
    ) {
      throw new Error(`Malformed compiled bounty recipe: ${rawKey}`);
    }
    const a = rawInfo.a || parts[0];
    const b = rawInfo.b || parts[1];
    if (normalizePair(a, b) !== normalizePair(parts[0], parts[1])) {
      throw new Error(`Compiled recipe inputs conflict with pair: ${rawKey}`);
    }
    const recipe = {
      a,
      b,
      result: rawInfo.result,
      emoji: rawInfo.emoji || "❓",
      chain: rawInfo.chain || null,
      source: rawInfo.source || "seed",
      hit_count: 0,
    };
    combinations[normalizePair(a, b)] = recipe;
    recipes.push(recipe);
    (recipesByResult[recipe.result] ??= []).push(recipe);
  }

  const starters = bountySource.starters ?? [];
  const depths = calculateDepths(starters, recipes);
  const bountyTargets = new Set(
    (bountySource.bounty?.groups ?? []).flatMap((group) => group.targets ?? []),
  );
  for (const target of bountyTargets) {
    if (depths[target] == null || depths[target] === 0) {
      throw new Error(`Unreachable bounty target: ${target}`);
    }
  }
  if (
    Object.keys(depths).length !== Object.keys(bountySource.depths ?? {}).length ||
    Object.entries(depths).some(
      ([name, value]) => bountySource.depths?.[name] !== value,
    )
  ) {
    throw new Error("Generated strict depths differ from compiled bounty depths");
  }

  const payload = {
    STARTERS: starters,
    ELEMENTS: elements,
    COMBINATIONS: combinations,
    RECIPES_BY_RESULT: recipesByResult,
    DEPTHS: depths,
  };

  const banner =
    "// Generated by scripts/generate-makers-data.mjs. Do not edit by hand.\n";
  const body = Object.entries(payload)
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join("\n");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${banner}${body}\n`, "utf8");
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await generateMakersData();
  process.stdout.write(`Generated ${output}\n`);
}
