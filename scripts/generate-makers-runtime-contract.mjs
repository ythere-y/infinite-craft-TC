import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readStrictJson } from "./shared-json-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = "shared/runtime-contract.json";
const GENERATED_PATH =
  "edge-functions/_generated/runtime-contract-data.js";
const LIMIT_FIELDS = [
  ["max_combine_element_length", "MAX_COMBINE_ELEMENT_LENGTH"],
  ["max_discoverer_length", "MAX_DISCOVERER_LENGTH"],
  ["max_session_id_length", "MAX_SESSION_ID_LENGTH"],
  ["max_verify_recipes", "MAX_VERIFY_RECIPES"],
  ["max_recipe_field_length", "MAX_RECIPE_FIELD_LENGTH"],
];
const CONTRACT_KEYS = [
  ...LIMIT_FIELDS.map(([field]) => field),
  "schema_version",
].sort();

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateRuntimeContract(value) {
  if (!isRecord(value)) {
    throw new TypeError("Runtime contract must be an object");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== CONTRACT_KEYS.length ||
    keys.some((key, index) => key !== CONTRACT_KEYS[index])
  ) {
    throw new TypeError(
      "Runtime contract must contain exactly the supported fields",
    );
  }
  if (value.schema_version !== 1) {
    throw new TypeError("Unsupported runtime contract schema version");
  }
  for (const [field] of LIMIT_FIELDS) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      throw new TypeError(
        `Runtime contract ${field} must be a positive safe integer`,
      );
    }
  }
  return structuredClone(value);
}

export async function generateMakersRuntimeContract({
  root = ROOT,
  outputPath,
} = {}) {
  const projectRoot = resolve(root);
  const sourcePath = resolve(projectRoot, SOURCE_PATH);
  const destination = outputPath
    ? resolve(outputPath)
    : resolve(projectRoot, GENERATED_PATH);
  const parsed = await readStrictJson(sourcePath, "Runtime contract");
  const contract = validateRuntimeContract(parsed);
  const generated = [
    "// Generated from shared/runtime-contract.json by scripts/generate-makers-runtime-contract.mjs. Do not edit.",
    `export const RUNTIME_CONTRACT_SCHEMA_VERSION = ${contract.schema_version};`,
    ...LIMIT_FIELDS.map(
      ([field, name]) => `export const ${name} = ${contract[field]};`,
    ),
    "",
  ].join("\n");

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, generated, "utf8");
  return generated;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generateMakersRuntimeContract();
}
