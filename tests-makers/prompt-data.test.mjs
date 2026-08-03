import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateMakersPromptData,
  loadPromptSpec,
  validatePromptSpec,
} from "../scripts/prompt-data-lib.mjs";
import {
  buildPromptMessages,
  buildPromptMessagesFromSpec,
} from "../edge-functions/_lib/prompt.js";

const INVALID_CASES = JSON.parse(
  await readFile("tests/fixtures/prompt-invalid-specs.json", "utf8"),
);
const RENDERER_VARIANT = JSON.parse(
  await readFile("tests/fixtures/prompt-renderer-variant.json", "utf8"),
);

function atPath(value, path) {
  let current = value;
  for (const part of path.slice(0, -1)) current = current[part];
  return [current, path.at(-1)];
}

function invalidSource(caseItem, canonicalSource) {
  if (caseItem.op === "raw_replace") {
    assert.ok(canonicalSource.includes(caseItem.target));
    return canonicalSource.replace(caseItem.target, caseItem.replacement);
  }

  let value = JSON.parse(canonicalSource);
  if (caseItem.op === "replace_root") {
    value = caseItem.value;
  } else if (caseItem.op === "disable_all") {
    const [parent, key] = atPath(value, caseItem.path);
    for (const item of parent[key]) item.enabled = false;
  } else if (caseItem.op === "copy") {
    const [sourceParent, sourceKey] = atPath(value, caseItem.from);
    const [targetParent, targetKey] = atPath(value, caseItem.path);
    targetParent[targetKey] = structuredClone(sourceParent[sourceKey]);
  } else if (caseItem.op === "delete") {
    const [parent, key] = atPath(value, caseItem.path);
    delete parent[key];
  } else {
    const [parent, key] = atPath(value, caseItem.path);
    parent[key] = caseItem.value;
  }
  return JSON.stringify(value);
}

test("canonical prompt has stable modules examples styles and limits", async () => {
  const spec = await loadPromptSpec("shared/combine-prompt.json");
  assert.equal(spec.schema_version, 1);
  assert.equal(spec.temperature, 0.85);
  assert.equal(spec.system_modules.filter((item) => item.enabled).length, 8);
  assert.equal(spec.examples.filter((item) => item.enabled).length, 15);
  assert.deepEqual(
    spec.styles.map(({ id, weight }) => [id, weight]),
    [
      ["invented-word", 0.30],
      ["concrete-scene", 0.25],
      ["cross-domain", 0.15],
      ["mixed-language", 0.10],
      ["action-description", 0.10],
      ["idiom", 0.05],
      ["past-present", 0.05],
    ],
  );
  assert.deepEqual(spec.limits, {
    avoid_words: 30,
    community_examples: 8,
    bounty_candidates: 12,
  });
  assert.deepEqual(spec.capacities, {
    community_formula_catalog: 500,
    recent_firsts: 10_000,
  });
});

test("Makers loader rejects the shared invalid prompt corpus", async () => {
  const canonicalSource = await readFile("shared/combine-prompt.json", "utf8");
  const root = await mkdtemp(join(tmpdir(), "invalid-prompt-spec-"));
  for (const caseItem of INVALID_CASES) {
    const path = join(root, "combine-prompt.json");
    await writeFile(path, invalidSource(caseItem, canonicalSource), "utf8");
    await assert.rejects(
      loadPromptSpec(path),
      undefined,
      caseItem.name,
    );
  }
});

test("prompt validation rejects duplicate ids", async () => {
  const spec = await loadPromptSpec("shared/combine-prompt.json");
  spec.system_modules[1].id = spec.system_modules[0].id;
  assert.throws(
    () => validatePromptSpec(spec),
    /duplicate system_modules id/,
  );
});

test("prompt validation accepts capacity boundaries", async () => {
  const spec = await loadPromptSpec("shared/combine-prompt.json");
  const formulaCapacity = spec.capacities.community_formula_catalog;
  const recentCapacity = spec.capacities.recent_firsts;
  spec.limits.community_examples = formulaCapacity;
  spec.limits.avoid_words = recentCapacity;

  const validated = validatePromptSpec(spec);

  assert.equal(formulaCapacity, 500);
  assert.equal(recentCapacity, 10_000);
  assert.equal(validated.limits.community_examples, 500);
  assert.equal(validated.limits.avoid_words, 10_000);
});

test("prompt validation rejects string style weights", async () => {
  const spec = await loadPromptSpec("shared/combine-prompt.json");
  spec.styles[0].weight = "0.3";
  assert.throws(
    () => validatePromptSpec(spec),
    /styles weight must be a finite number/,
  );
});

test("prompt validation rejects malformed module records", async () => {
  const paddedId = await loadPromptSpec("shared/combine-prompt.json");
  paddedId.system_modules[0].id = " identity ";
  assert.throws(
    () => validatePromptSpec(paddedId),
    /system_modules id must not have surrounding whitespace/,
  );

  const missingOrder = await loadPromptSpec("shared/combine-prompt.json");
  delete missingOrder.system_modules[0].order;
  assert.throws(
    () => validatePromptSpec(missingOrder),
    /system_modules order must be an integer/,
  );

  const missingContent = await loadPromptSpec("shared/combine-prompt.json");
  delete missingContent.system_modules[0].content;
  assert.throws(
    () => validatePromptSpec(missingContent),
    /system_modules content must be a non-empty string/,
  );
});

test("prompt validation rejects malformed example and style records", async () => {
  const numericExampleId = await loadPromptSpec("shared/combine-prompt.json");
  numericExampleId.examples[0].id = 123;
  assert.throws(
    () => validatePromptSpec(numericExampleId),
    /examples id must be a string/,
  );

  const missingInput = await loadPromptSpec("shared/combine-prompt.json");
  delete missingInput.examples[0].input.a;
  assert.throws(
    () => validatePromptSpec(missingInput),
    /examples input\.a must be a non-empty string/,
  );

  const nonBooleanEnabled = await loadPromptSpec("shared/combine-prompt.json");
  nonBooleanEnabled.styles[0].enabled = "true";
  assert.throws(
    () => validatePromptSpec(nonBooleanEnabled),
    /styles enabled must be a boolean/,
  );
});

test("generator writes a V8-safe JavaScript data module", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-data-"));
  const outputPath = join(root, "prompt-data.js");
  await generateMakersPromptData({ root: ".", outputPath });
  const generated = await readFile(outputPath, "utf8");
  assert.match(generated, /^\/\/ Generated by scripts\/generate-makers-prompt-data\.mjs/m);
  assert.match(generated, /export const PROMPT_SPEC = /);
  assert.doesNotMatch(generated, /node:fs|process\.env|require\(/);
});

test("committed generated prompt data is current", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-current-"));
  const outputPath = join(root, "prompt-data.js");
  await generateMakersPromptData({ root: ".", outputPath });
  assert.equal(
    await readFile(outputPath, "utf8"),
    await readFile("edge-functions/_generated/prompt-data.js", "utf8"),
  );
});

test("renderer selects styles using half-open weight boundaries", () => {
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: 0 }).style_id,
    "invented-word",
  );
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: 0.30 }).style_id,
    "concrete-scene",
  );
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: 0.99 }).style_id,
    "past-present",
  );
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: -0.01 }).style_id,
    "invented-word",
  );
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: 1 }).style_id,
    "past-present",
  );
  assert.equal(
    buildPromptMessages({ a: "甲", b: "乙", style_value: 2 }).style_id,
    "past-present",
  );
});

test("renderer uses injected random once when style value is absent", () => {
  let calls = 0;
  const messages = buildPromptMessages({
    a: "甲",
    b: "乙",
    random: () => {
      calls += 1;
      return 0.30;
    },
  });

  assert.equal(calls, 1);
  assert.equal(messages.style_id, "concrete-scene");
});

test("Makers renderer from spec matches independent variant oracle", () => {
  const validated = validatePromptSpec(RENDERER_VARIANT.spec);
  assert.deepEqual(
    buildPromptMessagesFromSpec(validated, RENDERER_VARIANT.input),
    RENDERER_VARIANT.expected,
  );
});
