import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

import { buildMakersSite } from "../scripts/build-makers.mjs";

const REQUIRED_FILES = [
  "dist/THIRD_PARTY_NOTICES.md",
  "dist/index.html",
  "dist/app.js",
  "dist/combine-feedback.js",
  "dist/effects.js",
  "dist/icon-system.css",
  "dist/icon-system.js",
  "dist/style.css",
  "dist/assets/icons/generated/emoji-icon-manifest.json",
  "dist/assets/icons/generated/element-icon-map.json",
  "dist/assets/icons/actions/trash.svg",
  "dist/community.html",
  "dist/community-admin.html",
  "dist/wall/index.html",
  "dist/wall/polling.js",
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

  for (const file of [
    "dist/index.html",
    "dist/community.html",
    "dist/community-admin.html",
    "dist/wall/index.html",
    "dist/admin/index.html",
  ]) {
    const html = await readFile(file, "utf8");
    assert.doesNotMatch(
      html,
      /(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|use\.fontawesome\.com)/i,
      `${file} should not load a third-party icon CDN`,
    );
  }
});
