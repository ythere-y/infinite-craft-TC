import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_URL_PREFIX = "/assets/icons/";

const ACTION_ICONS = [
  "arrow-left",
  "arrow-right",
  "book-open",
  "caret-down",
  "chart-line-up",
  "check",
  "download-simple",
  "equals",
  "magnifying-glass",
  "monitor-play",
  "plus",
  "question",
  "share-network",
  "sparkle",
  "thumbs-down",
  "thumbs-up",
  "trash",
  "trophy",
  "user-circle",
  "warning",
  "x",
];

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function readJson(path, label) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing at ${path}`);
    }
    throw error;
  }
  return parseJson(contents, label);
}

function iconUrlToFile(root, iconUrl) {
  if (typeof iconUrl !== "string" || !iconUrl.startsWith(ICONS_URL_PREFIX)) {
    throw new Error(
      `Icon asset path must remain below frontend/assets/icons/: ${String(iconUrl)}`,
    );
  }

  const frontendRoot = resolve(root, "frontend");
  const file = resolve(frontendRoot, iconUrl.slice(1));
  const allowedRoot = `${resolve(root, "frontend", "assets", "icons")}${sep}`;
  if (!file.startsWith(allowedRoot)) {
    throw new Error(`Icon asset path escapes frontend/assets/icons/: ${iconUrl}`);
  }
  return file;
}

async function assertNonEmptyFile(path, label) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) {
      throw new Error(`${label} is empty or not a file: ${path}`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw error;
  }
}

function collectElementAssetReferences(value, manifest, references, trail = "element map") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectElementAssetReferences(item, manifest, references, `${trail}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    const location = `${trail}.${key}`;
    if (typeof item === "string" && item.startsWith("/assets/icons/")) {
      references.push(item);
    } else if ((key === "base" || key === "badge") && typeof item === "string") {
      const asset = manifest[item];
      if (!asset) {
        throw new Error(`${location} does not resolve through the emoji icon manifest`);
      }
      references.push(asset);
    } else {
      collectElementAssetReferences(item, manifest, references, location);
    }
  }
}

export function emojiCodepointCandidates(emoji) {
  if (typeof emoji !== "string") return [];

  const qualified = [...emoji]
    .map((character) => character.codePointAt(0).toString(16))
    .join("-");
  const fallback = [...emoji]
    .filter((character) => character.codePointAt(0) !== 0xfe0f)
    .map((character) => character.codePointAt(0).toString(16))
    .join("-");

  return [...new Set([qualified, fallback].filter(Boolean))];
}

export function requiredActionIcons() {
  return [...ACTION_ICONS];
}

export async function sha256ForFiles(files) {
  const digest = createHash("sha256");
  const sorted = [...files].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  for (const [relativePath, path] of sorted) {
    digest.update(relativePath);
    digest.update("\0");
    digest.update(await readFile(path));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function validateCommittedIconAssets({ root = ROOT } = {}) {
  const projectRoot = resolve(root);
  const generatedRoot = resolve(
    projectRoot,
    "frontend/assets/icons/generated",
  );
  const manifest = await readJson(
    resolve(generatedRoot, "emoji-icon-manifest.json"),
    "Emoji icon manifest",
  );
  const metadata = await readJson(
    resolve(generatedRoot, "icon-build-metadata.json"),
    "Icon build metadata",
  );

  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    throw new Error("Emoji icon manifest must be an object mapping emoji to paths");
  }
  if (!metadata?.sources?.notoEmoji?.version || !metadata?.sources?.notoEmoji?.license) {
    throw new Error("Icon build metadata must record Noto Emoji version and license");
  }
  if (!metadata?.sources?.phosphor?.version || !metadata?.sources?.phosphor?.license) {
    throw new Error("Icon build metadata must record Phosphor version and license");
  }

  const manifestReferences = Object.values(manifest);
  if (!manifestReferences.length || !manifestReferences.every((value) => typeof value === "string")) {
    throw new Error("Emoji icon manifest must contain non-empty asset paths");
  }

  const elementMapPath = resolve(generatedRoot, "element-icon-map.json");
  let elementEntries = 0;
  const elementReferences = [];
  try {
    await access(elementMapPath);
    const elementMap = await readJson(elementMapPath, "Element icon map");
    if (!elementMap || Array.isArray(elementMap) || typeof elementMap !== "object") {
      throw new Error("Element icon map must be an object");
    }
    elementEntries = Object.keys(elementMap).length;
    collectElementAssetReferences(elementMap, manifest, elementReferences);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const allReferences = [...new Set([...manifestReferences, ...elementReferences])];
  await Promise.all(
    allReferences.map(async (iconUrl) => {
      const path = iconUrlToFile(projectRoot, iconUrl);
      await assertNonEmptyFile(path, `Icon asset for ${iconUrl}`);
    }),
  );

  await Promise.all(
    requiredActionIcons().map((name) =>
      assertNonEmptyFile(
        resolve(projectRoot, "frontend/assets/icons/actions", `${name}.svg`),
        `Required action icon ${name}`,
      ),
    ),
  );

  const emojiFiles = (await readdir(resolve(generatedRoot, "emoji")))
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => [
      `generated/emoji/${name}`,
      resolve(generatedRoot, "emoji", name),
    ]);
  const actionFiles = (await readdir(
    resolve(projectRoot, "frontend/assets/icons/actions"),
  ))
    .filter((name) => name.toLowerCase().endsWith(".svg"))
    .map((name) => [
      `actions/${name}`,
      resolve(projectRoot, "frontend/assets/icons/actions", name),
    ]);
  const actualCounts = {
    actionSvgs: actionFiles.length,
    emojiManifestEntries: Object.keys(manifest).length,
    emojiPngs: emojiFiles.length,
  };
  for (const [name, actual] of Object.entries(actualCounts)) {
    if (metadata?.counts?.[name] !== actual) {
      throw new Error(
        `Icon asset count ${name} (${actual}) does not match metadata (${String(metadata?.counts?.[name])})`,
      );
    }
  }

  const digest = await sha256ForFiles([...emojiFiles, ...actionFiles]);
  if (metadata.sha256 !== digest) {
    throw new Error(
      `Icon asset digest ${digest} does not match metadata (${String(metadata.sha256)})`,
    );
  }

  return {
    actionIcons: actionFiles.length,
    elementEntries,
    emojiEntries: Object.keys(manifest).length,
    emojiFiles: emojiFiles.length,
  };
}
