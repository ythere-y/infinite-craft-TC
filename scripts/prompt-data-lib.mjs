import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readStrictJson } from "./shared-json-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL_PATH = "shared/combine-prompt.json";
const GENERATED_PATH = "edge-functions/_generated/prompt-data.js";
const PROMPT_WHITESPACE = new Set([
  "\u0009", "\u000a", "\u000b", "\u000c", "\u000d", "\u0020",
  "\u0085", "\u00a0", "\u1680",
  "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005",
  "\u2006", "\u2007", "\u2008", "\u2009", "\u200a",
  "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
]);

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function stripPromptWhitespace(value) {
  const characters = [...value];
  let start = 0;
  let end = characters.length;
  while (start < end && PROMPT_WHITESPACE.has(characters[start])) start += 1;
  while (end > start && PROMPT_WHITESPACE.has(characters[end - 1])) end -= 1;
  return characters.slice(start, end).join("");
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || !stripPromptWhitespace(value)) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function validateId(value, field) {
  if (typeof value !== "string") {
    throw new Error(`${field} id must be a string`);
  }
  const stripped = stripPromptWhitespace(value);
  if (!stripped) {
    throw new Error(`${field} id must not be blank`);
  }
  if (value !== stripped) {
    throw new Error(`${field} id must not have surrounding whitespace`);
  }
  return value;
}

function validateSystemModule(item) {
  requireRecord(item, "system_modules record");
  const id = validateId(item.id, "system_modules");
  requireBoolean(item.enabled, "system_modules enabled");
  if (!Number.isSafeInteger(item.order)) {
    throw new Error("system_modules order must be an integer");
  }
  requireNonEmptyString(item.content, "system_modules content");
  return id;
}

function validateExample(item) {
  requireRecord(item, "examples record");
  const id = validateId(item.id, "examples");
  requireBoolean(item.enabled, "examples enabled");
  requireRecord(item.input, "examples input");
  requireNonEmptyString(item.input.a, "examples input.a");
  requireNonEmptyString(item.input.b, "examples input.b");
  requireRecord(item.output, "examples output");
  requireNonEmptyString(item.output.name, "examples output.name");
  requireNonEmptyString(item.output.emoji, "examples output.emoji");
  requireNonEmptyString(item.output.comment, "examples output.comment");
  return id;
}

function validateStyle(item) {
  requireRecord(item, "styles record");
  const id = validateId(item.id, "styles");
  requireBoolean(item.enabled, "styles enabled");
  requireNonEmptyString(item.label, "styles label");
  requireNonEmptyString(item.guidance, "styles guidance");
  if (typeof item.weight !== "number" || !Number.isFinite(item.weight)) {
    throw new Error("styles weight must be a finite number");
  }
  return id;
}

export function validatePromptSpec(value) {
  if (value?.schema_version !== 1) {
    throw new Error("unsupported prompt schema version");
  }
  if (!Number.isFinite(value.temperature)) {
    throw new Error("temperature must be finite");
  }
  if (value.temperature < 0 || value.temperature > 2) {
    throw new Error("temperature must be between 0 and 2");
  }
  const validators = {
    system_modules: validateSystemModule,
    examples: validateExample,
    styles: validateStyle,
  };
  for (const field of ["system_modules", "examples", "styles"]) {
    if (!Array.isArray(value[field])) {
      throw new Error(`${field} must be an array`);
    }
    const ids = value[field].map(validators[field]);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`duplicate ${field} id`);
    }
  }
  const enabledModules = value.system_modules.filter((item) => item.enabled !== false);
  if (!enabledModules.length) {
    throw new Error("at least one system module must be enabled");
  }
  const enabledStyles = value.styles.filter((item) => item.enabled !== false);
  if (enabledStyles.some((item) => !(Number(item.weight) > 0))) {
    throw new Error("enabled style weights must be positive");
  }
  const total = enabledStyles.reduce((sum, item) => sum + Number(item.weight), 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error("style weights must sum to 1");
  }
  requireRecord(value.capacities, "capacities");
  for (const name of ["community_formula_catalog", "recent_firsts"]) {
    if (
      !Number.isSafeInteger(value.capacities[name]) ||
      value.capacities[name] <= 0
    ) {
      throw new Error(`${name} capacity must be a positive integer`);
    }
  }
  for (const name of ["avoid_words", "community_examples", "bounty_candidates"]) {
    if (!Number.isSafeInteger(value.limits?.[name]) || value.limits[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (
    value.limits.community_examples >
    value.capacities.community_formula_catalog
  ) {
    throw new Error(
      "community_examples must not exceed community formula catalog capacity",
    );
  }
  if (value.limits.avoid_words > value.capacities.recent_firsts) {
    throw new Error("avoid_words must not exceed recent firsts capacity");
  }
  return structuredClone(value);
}

export async function loadPromptSpec(path) {
  return validatePromptSpec(await readStrictJson(path, "Prompt spec"));
}

export async function generateMakersPromptData({
  root = ROOT,
  outputPath,
} = {}) {
  const projectRoot = resolve(root);
  const spec = await loadPromptSpec(resolve(projectRoot, CANONICAL_PATH));
  const destination = outputPath ?? resolve(projectRoot, GENERATED_PATH);
  const generated = [
    "// Generated by scripts/generate-makers-prompt-data.mjs. Do not edit manually.",
    `export const PROMPT_SPEC = Object.freeze(${JSON.stringify(spec)});`,
    "",
  ].join("\n");

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, generated, "utf8");
  return generated;
}
