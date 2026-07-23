import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

import { buildMakersSite } from "../scripts/build-makers.mjs";

const REQUIRED_FILES = [
  "dist/index.html",
  "dist/app.js",
  "dist/effects.js",
  "dist/style.css",
  "dist/wall/index.html",
  "dist/wall/wall.js",
  "dist/admin/index.html",
];

test("Makers build copies every public entry point", async () => {
  await buildMakersSite();

  for (const file of REQUIRED_FILES) {
    await access(file);
    assert.ok((await stat(file)).size > 0, `${file} should not be empty`);
  }

  const builtHtml = await readFile("dist/index.html", "utf8");
  const sourceHtml = await readFile("frontend/index.html", "utf8");
  assert.equal(builtHtml, sourceHtml);
});
