import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";


async function loadPromptDecimal() {
  const source = await readFile("frontend/admin/prompt-decimal.js", "utf8");
  const context = {};
  context.globalThis = context;
  runInNewContext(source, context, { filename: "prompt-decimal.js" });
  return context.PromptDecimal;
}


async function loadPromptAdminModel() {
  const source = await readFile("frontend/admin/prompt-admin-model.js", "utf8");
  const context = {};
  context.globalThis = context;
  runInNewContext(source, context, { filename: "prompt-admin-model.js" });
  return context.PromptAdminModel;
}


test("Prompt probability totals use the backend's exact decimal semantics", async () => {
  const decimal = await loadPromptDecimal();

  const repeating = decimal.summarize([
    "33.333333",
    "33.333333",
    "33.333333",
  ]);
  assert.equal(repeating.total, "99.999999");
  assert.equal(repeating.valid, false);

  const exact = decimal.summarize(["25", "25.0", "5e1"]);
  assert.equal(exact.total, "100");
  assert.equal(exact.valid, true);

  const justAbove = decimal.summarize(["100", "1e-6"]);
  assert.equal(justAbove.total, "100.000001");
  assert.equal(justAbove.valid, false);

  const contextBoundary = decimal.summarize([
    "99.99999",
    ...Array(10).fill("1e-6"),
  ]);
  assert.equal(contextBoundary.total, "100");
  assert.equal(contextBoundary.valid, true);
});


test("Prompt probability totals enforce the six-decimal precision limit", async () => {
  const decimal = await loadPromptDecimal();

  const sixPlaces = decimal.summarize(["99.999999", "0.000001"]);
  assert.equal(sixPlaces.total, "100");
  assert.equal(sixPlaces.valid, true);

  for (const values of [["99.9999999", "0.0000001"], ["99.999999", "1e-7"]]) {
    const result = decimal.summarize(values);
    assert.equal(result.total, "无效");
    assert.equal(result.valid, false);
    assert.equal(result.error, "风格概率的小数位数不能超过 6");
  }
});


test("Prompt probability totals reject values outside the decimal grammar", async () => {
  const decimal = await loadPromptDecimal();

  assert.deepEqual(
    {
      total: decimal.summarize(["not-a-number"]).total,
      valid: decimal.summarize(["not-a-number"]).valid,
    },
    { total: "无效", valid: false },
  );
});


test("Prompt probability totals reject each value outside zero to one hundred", async () => {
  const decimal = await loadPromptDecimal();

  for (const values of [["-1", "101"], ["100.000001", "-0.000001"]]) {
    const result = decimal.summarize(values);
    assert.equal(result.total, "无效");
    assert.equal(result.valid, false);
    assert.equal(result.error, "风格概率必须在 0 到 100 之间");
  }
});


test("Prompt probability feedback validates disabled styles without adding them", async () => {
  const decimal = await loadPromptDecimal();

  const invalidDisabled = decimal.summarizeStyles([
    {enabled: true, probability: "100"},
    {enabled: false, probability: "-1"},
  ]);
  assert.equal(invalidDisabled.total, "无效");
  assert.equal(invalidDisabled.valid, false);
  assert.equal(invalidDisabled.error, "风格概率必须在 0 到 100 之间");

  const validDisabled = decimal.summarizeStyles([
    {enabled: true, probability: "100"},
    {enabled: false, probability: "25"},
  ]);
  assert.equal(validDisabled.total, "100");
  assert.equal(validDisabled.valid, true);
});


test("Prompt admin model validates temperature at the provider boundaries", async () => {
  const model = await loadPromptAdminModel();

  assert.equal(model.temperatureError("0"), "");
  assert.equal(model.temperatureError("2"), "");
  for (const value of ["", "-0.01", "2.01", "NaN"]) {
    assert.equal(
      model.temperatureError(value),
      "Temperature 必须是 0 到 2 之间的数字",
    );
  }
});


test("Prompt admin model appends every history page without losing old active", async () => {
  const model = await loadPromptAdminModel();
  const active = {id: "prompt-initial-active"};
  const firstVersions = Array.from(
    {length: 50},
    (_, index) => ({id: `prompt-new-${index}`}),
  );
  const first = model.mergeVersionPage([], {
    versions: firstVersions,
    version_page: {
      limit: 50,
      offset: 0,
      next_offset: 50,
      has_more: true,
    },
  }, true);
  const complete = model.mergeVersionPage(first.versions, {
    versions: [{id: "prompt-old-50"}, active],
    version_page: {
      limit: 50,
      offset: 50,
      next_offset: null,
      has_more: false,
    },
  });

  assert.equal(first.versions.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 50);
  assert.equal(complete.versions.length, 52);
  assert.equal(complete.hasMore, false);
  assert.equal(complete.versions.some((version) => version.id === active.id), true);
});


test("Prompt admin model clears a pending version only when that version is deleted", async () => {
  const model = await loadPromptAdminModel();

  const deletedPending = model.reconcileDeletedVersion(
    "prompt-pending",
    "prompt-pending",
  );
  assert.equal(deletedPending.pendingVersionId, null);
  assert.equal(deletedPending.clearPreview, true);

  const deletedOther = model.reconcileDeletedVersion(
    "prompt-pending",
    "prompt-other",
  );
  assert.equal(deletedOther.pendingVersionId, "prompt-pending");
  assert.equal(deletedOther.clearPreview, false);
});
