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
  sha256ForFiles,
  validatePngBuffer,
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

test("named historic icons extend the generated manifest without replacing emoji keys", async () => {
  const { mergeNamedIconManifest } = await import(
    "../scripts/generate-icon-assets.mjs"
  );
  const emojiManifest = {
    "💎": "/assets/icons/generated/emoji/1f48e.png",
  };
  const namedManifest = {
    "qq-era:yellow-diamond": "/assets/icons/qq-era/yellow-diamond.png",
  };

  assert.deepEqual(
    mergeNamedIconManifest(emojiManifest, namedManifest),
    {
      ...emojiManifest,
      ...namedManifest,
    },
  );
  assert.throws(
    () =>
      mergeNamedIconManifest(emojiManifest, {
        "💎": "/assets/icons/qq-era/not-an-emoji.png",
      }),
    /must not replace an existing manifest key/i,
  );
});

test("historic PNG validation decodes image scanlines and rejects truncation", async () => {
  const png = await readFile(
    "frontend/assets/icons/qq-era/yellow-diamond.png",
  );
  const dimensions = validatePngBuffer(png, "yellow diamond");
  assert.ok(dimensions.width > 0);
  assert.ok(dimensions.height > 0);
  assert.throws(
    () => validatePngBuffer(png.subarray(0, png.length - 12), "truncated"),
    /PNG|truncated|incomplete|decode/i,
  );
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

test("committed icon validation rejects every stale metadata count", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-assets-counts-"));
  const generated = join(root, "frontend/assets/icons/generated");
  const emojiRoot = join(generated, "emoji");
  const actionRoot = join(root, "frontend/assets/icons/actions");
  await Promise.all([
    mkdir(emojiRoot, { recursive: true }),
    mkdir(actionRoot, { recursive: true }),
  ]);
  const emojiPath = join(emojiRoot, "1f9e9.png");
  await writeFile(emojiPath, "png");
  const actionFiles = [];
  for (const name of requiredActionIcons()) {
    const path = join(actionRoot, `${name}.svg`);
    await writeFile(path, "<svg/>");
    actionFiles.push([`actions/${name}.svg`, path]);
  }
  await writeFile(
    join(generated, "emoji-icon-manifest.json"),
    JSON.stringify({
      "🧩": "/assets/icons/generated/emoji/1f9e9.png",
    }),
  );
  const metadataPath = join(generated, "icon-build-metadata.json");
  const metadata = {
    sources: {
      notoEmoji: { version: "test", license: "Apache-2.0" },
      phosphor: { version: "test", license: "MIT" },
    },
    counts: {
      actionSvgs: actionFiles.length,
      emojiManifestEntries: 1,
      emojiPngs: 1,
      namedPngs: 0,
    },
    sha256: await sha256ForFiles([
      ["generated/emoji/1f9e9.png", emojiPath],
      ...actionFiles,
    ]),
  };

  try {
    for (const name of [
      "actionSvgs",
      "emojiManifestEntries",
      "emojiPngs",
      "namedPngs",
    ]) {
      await writeFile(
        metadataPath,
        JSON.stringify({
          ...metadata,
          counts: { ...metadata.counts, [name]: metadata.counts[name] + 1 },
        }),
      );
      await assert.rejects(
        validateCommittedIconAssets({ root }),
        new RegExp(`count ${name}.*does not match metadata`, "i"),
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the committed icon manifest references every vendored emoji and historic PNG", async () => {
  const [manifest, namedManifest] = await Promise.all([
    readFile(
      "frontend/assets/icons/generated/emoji-icon-manifest.json",
      "utf8",
    ).then(JSON.parse),
    readFile(
      "frontend/assets/icons/qq-era/manifest.json",
      "utf8",
    ).then(JSON.parse),
  ]);
  const files = (await readdir("frontend/assets/icons/generated/emoji")).filter(
    (name) => name.endsWith(".png"),
  );
  const references = new Set(Object.values(manifest));

  for (const file of files) {
    assert.ok(
      references.has(`/assets/icons/generated/emoji/${file}`),
      `${file} must be referenced`,
    );
  }
  for (const [name, path] of Object.entries(namedManifest)) {
    assert.equal(manifest[name], path, `${name} must retain its named asset`);
  }
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
