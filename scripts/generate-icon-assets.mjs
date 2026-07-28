import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  emojiCodepointCandidates,
  requiredActionIcons,
  validateCommittedIconAssets,
} from "./icon-data-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = resolve(ROOT, "words/emoji-data");
const SOURCE_EMOJI_JSON = resolve(SOURCE_ROOT, "emoji.json");
const SOURCE_PNGS = resolve(SOURCE_ROOT, "img-google-64");
const PHOSPHOR_ROOT = resolve(
  ROOT,
  "node_modules/@phosphor-icons/core/assets/duotone",
);
const ICONS_ROOT = resolve(ROOT, "frontend/assets/icons");
const GENERATED_ROOT = resolve(ICONS_ROOT, "generated");

function emojiFromCodepoints(codepoints) {
  return String.fromCodePoint(
    ...codepoints.split("-").map((codepoint) => Number.parseInt(codepoint, 16)),
  );
}

async function requireFile(path, label) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${label} is not a file: ${path}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing at ${path}. Restore the local source and rerun generate:icons.`);
    }
    throw error;
  }
}

async function requireDirectory(path, label) {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing at ${path}. Restore the local source and rerun generate:icons.`);
    }
    throw error;
  }
}

async function sha256ForFiles(files) {
  const digest = createHash("sha256");
  for (const [relativePath, path] of files.sort(([a], [b]) => a.localeCompare(b))) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await readFile(path));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function replaceFileAtomically(stagedPath, targetPath, backupRoot) {
  const backupPath = resolve(backupRoot, `${Math.random().toString(16).slice(2)}.bak`);
  let movedExisting = false;
  try {
    await rename(targetPath, backupPath);
    movedExisting = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(stagedPath, targetPath);
  } catch (error) {
    if (movedExisting) await rename(backupPath, targetPath);
    throw error;
  }
  if (movedExisting) await rm(backupPath, { force: true, recursive: true });
}

async function main() {
  await requireFile(SOURCE_EMOJI_JSON, "Emoji source JSON");
  await requireDirectory(SOURCE_PNGS, "Google 64px emoji source directory");
  await requireDirectory(PHOSPHOR_ROOT, "Phosphor duotone source directory");

  const stagingRoot = resolve(
    ICONS_ROOT,
    `.icon-assets-${process.pid}-${Date.now()}`,
  );
  const stagedEmojiRoot = resolve(stagingRoot, "emoji");
  const stagedActionsRoot = resolve(stagingRoot, "actions");
  const stagedManifest = resolve(stagingRoot, "emoji-icon-manifest.json");
  const stagedMetadata = resolve(stagingRoot, "icon-build-metadata.json");

  try {
    await mkdir(stagedEmojiRoot, { recursive: true });
    await mkdir(stagedActionsRoot, { recursive: true });

    const pngNames = (await readdir(SOURCE_PNGS))
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .map((name) => name.toLowerCase())
      .sort();
    if (new Set(pngNames).size !== pngNames.length) {
      throw new Error("Google emoji source contains PNG filenames that collide after lowercasing");
    }
    await Promise.all(
      pngNames.map((name) =>
        copyFile(resolve(SOURCE_PNGS, name), resolve(stagedEmojiRoot, name)),
      ),
    );

    const emojiData = JSON.parse(await readFile(SOURCE_EMOJI_JSON, "utf8"));
    const manifest = {};
    for (const filename of pngNames) {
      const codepoints = filename.slice(0, -4);
      const path = `/assets/icons/generated/emoji/${filename}`;
      const emoji = emojiFromCodepoints(codepoints);
      manifest[codepoints] = path;
      manifest[emoji] = path;
      for (const candidate of emojiCodepointCandidates(emoji)) {
        manifest[candidate] = path;
      }
    }
    for (const entry of emojiData) {
      if (!entry.unified || !entry.image) continue;
      const filename = entry.image.toLowerCase();
      if (!pngNames.includes(filename)) continue;
      const path = `/assets/icons/generated/emoji/${filename}`;
      for (const codepoints of [entry.unified, entry.non_qualified].filter(Boolean)) {
        const emoji = emojiFromCodepoints(codepoints);
        manifest[emoji] = path;
        for (const candidate of emojiCodepointCandidates(emoji)) {
          manifest[candidate] = path;
        }
      }
    }

    const actionFiles = [];
    for (const name of requiredActionIcons()) {
      const source = resolve(PHOSPHOR_ROOT, `${name}-duotone.svg`);
      await requireFile(source, `Phosphor action icon ${name}`);
      const target = resolve(stagedActionsRoot, `${name}.svg`);
      await copyFile(source, target);
      actionFiles.push([`actions/${name}.svg`, target]);
    }

    const emojiFiles = pngNames.map((name) => [
      `generated/emoji/${name}`,
      resolve(stagedEmojiRoot, name),
    ]);
    const metadata = {
      generatedAt: new Date().toISOString(),
      sources: {
        notoEmoji: {
          version: "2.048 (Emoji 16.0)",
          license: "Apache-2.0",
        },
        phosphor: {
          version: "2.1.1",
          license: "MIT",
        },
      },
      counts: {
        actionSvgs: actionFiles.length,
        emojiManifestEntries: Object.keys(manifest).length,
        emojiPngs: emojiFiles.length,
      },
      sha256: await sha256ForFiles([...emojiFiles, ...actionFiles]),
    };

    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`);

    await mkdir(GENERATED_ROOT, { recursive: true });
    await replaceFileAtomically(stagedEmojiRoot, resolve(GENERATED_ROOT, "emoji"), stagingRoot);
    await replaceFileAtomically(stagedActionsRoot, resolve(ICONS_ROOT, "actions"), stagingRoot);
    await replaceFileAtomically(stagedManifest, resolve(GENERATED_ROOT, "emoji-icon-manifest.json"), stagingRoot);
    await replaceFileAtomically(stagedMetadata, resolve(GENERATED_ROOT, "icon-build-metadata.json"), stagingRoot);

    const summary = await validateCommittedIconAssets();
    console.log(
      `Generated ${summary.emojiFiles} emoji PNGs, ${summary.emojiEntries} manifest entries, and ${summary.actionIcons} action SVGs.`,
    );
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(`Icon asset generation failed: ${error.message}`);
  process.exitCode = 1;
});
