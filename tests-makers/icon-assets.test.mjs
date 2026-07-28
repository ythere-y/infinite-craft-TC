import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emojiCodepointCandidates,
  requiredActionIcons,
  validateCommittedIconAssets,
} from "../scripts/icon-data-lib.mjs";
import {
  copyEmojiPngs,
  replaceStagedTargetsTransactionally,
} from "../scripts/generate-icon-assets.mjs";

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

test("emoji copying reads uppercase source names and writes lowercase destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-assets-copy-"));
  const source = join(root, "source");
  const destination = join(root, "destination");
  await mkdir(source);
  await mkdir(destination);
  await writeFile(join(source, "1F600.PNG"), "png data");

  try {
    assert.deepEqual(await copyEmojiPngs(source, destination), ["1f600.png"]);
    assert.equal(await readFile(join(destination, "1f600.png"), "utf8"), "png data");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("asset replacement restores earlier targets when a later swap fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-assets-swap-"));
  const staging = join(root, "staging");
  const targets = join(root, "targets");
  const stagedEmoji = join(staging, "emoji");
  const stagedActions = join(staging, "actions");
  const targetEmoji = join(targets, "emoji");
  const targetActions = join(targets, "actions");
  await Promise.all(
    [stagedEmoji, stagedActions, targetEmoji, targetActions].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  await Promise.all([
    writeFile(join(stagedEmoji, "state"), "new emoji"),
    writeFile(join(stagedActions, "state"), "new actions"),
    writeFile(join(targetEmoji, "state"), "old emoji"),
    writeFile(join(targetActions, "state"), "old actions"),
  ]);

  const moveWithActionFailure = async (from, to) => {
    if (from === stagedActions && to === targetActions) {
      const error = new Error("simulated rename failure");
      error.code = "EIO";
      throw error;
    }
    await rename(from, to);
  };

  try {
    await assert.rejects(
      replaceStagedTargetsTransactionally(
        [
          { name: "emoji", stagedPath: stagedEmoji, targetPath: targetEmoji },
          { name: "actions", stagedPath: stagedActions, targetPath: targetActions },
        ],
        { backupRoot: staging, operations: { rename: moveWithActionFailure, rm } },
      ),
      /simulated rename failure/,
    );
    assert.equal(await readFile(join(targetEmoji, "state"), "utf8"), "old emoji");
    assert.equal(await readFile(join(targetActions, "state"), "utf8"), "old actions");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
