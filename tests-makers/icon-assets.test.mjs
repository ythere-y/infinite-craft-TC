import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emojiCodepointCandidates,
  requiredActionIcons,
  validateCommittedIconAssets,
} from "../scripts/icon-data-lib.mjs";

test("emoji codepoint candidates retain qualified, fallback, and joined sequences", () => {
  assert.deepEqual(emojiCodepointCandidates("❤️"), ["2764-fe0f", "2764"]);
  assert.ok(
    emojiCodepointCandidates("👩🏽‍💻").includes("1f469-1f3fd-200d-1f4bb"),
  );
  assert.ok(emojiCodepointCandidates("1️⃣").includes("31-fe0f-20e3"));
});

test("required action icons include the delete action", () => {
  assert.deepEqual(requiredActionIcons().includes("trash"), true);
});

test("committed icon validation reports a missing manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-assets-"));
  try {
    await assert.rejects(
      validateCommittedIconAssets({ root }),
      /emoji icon manifest.*missing/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the committed emoji manifest references every vendored emoji PNG", async () => {
  const manifest = JSON.parse(
    await readFile(
      "frontend/assets/icons/generated/emoji-icon-manifest.json",
      "utf8",
    ),
  );
  const files = (await readdir("frontend/assets/icons/generated/emoji")).filter(
    (name) => name.endsWith(".png"),
  );

  assert.equal(new Set(Object.values(manifest)).size, files.length);
});
