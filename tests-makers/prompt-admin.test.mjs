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
