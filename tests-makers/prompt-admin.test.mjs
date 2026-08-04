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
    "33.33333333333333",
    "33.33333333333333",
    "33.33333333333333",
  ]);
  assert.equal(repeating.total, "99.99999999999999");
  assert.equal(repeating.valid, false);

  const exact = decimal.summarize(["25", "25.0", "5e1"]);
  assert.equal(exact.total, "100");
  assert.equal(exact.valid, true);
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
