import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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

export function validatePngBuffer(buffer, label = "PNG asset") {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error(`${label} must be provided as a buffer`);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < signature.length || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} has an invalid PNG signature`);
  }

  let offset = 8;
  let width;
  let height;
  let channels;
  let sawIend = false;
  const idat = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new Error(`${label} has a truncated PNG chunk`);
    }
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) {
      throw new Error(`${label} has a truncated PNG chunk`);
    }
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) {
        throw new Error(`${label} has an invalid PNG header`);
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (
        !width ||
        !height ||
        bitDepth !== 8 ||
        ![2, 6].includes(colorType) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new Error(`${label} uses an unsupported PNG encoding`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      sawIend = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!width || !height || !idat.length || !sawIend || offset !== buffer.length) {
    throw new Error(`${label} is incomplete or has trailing PNG data`);
  }

  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idat));
  } catch (error) {
    throw new Error(`${label} PNG decode failed: ${error.message}`);
  }
  const expectedBytes = height * (1 + width * channels);
  if (decoded.length !== expectedBytes) {
    throw new Error(
      `${label} decoded to ${decoded.length} bytes; expected ${expectedBytes}`,
    );
  }
  return { width, height };
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

  const namedRoot = resolve(projectRoot, "frontend/assets/icons/qq-era");
  let namedManifest = {};
  const namedManifestPath = resolve(namedRoot, "manifest.json");
  try {
    await access(namedManifestPath);
    namedManifest = await readJson(namedManifestPath, "QQ-era icon manifest");
  } catch (error) {
    if (
      error.code !== "ENOENT" ||
      manifestReferences.some((value) =>
        value.startsWith("/assets/icons/qq-era/"))
    ) {
      throw error;
    }
  }
  const namedEntries = Object.entries(namedManifest);
  for (const [name, iconUrl] of namedEntries) {
    if (manifest[name] !== iconUrl) {
      throw new Error(`${name} does not match the generated icon manifest`);
    }
  }
  let namedFiles = [];
  if (namedEntries.length) {
    const sourcesPath = resolve(namedRoot, "sources.json");
    await readJson(sourcesPath, "QQ-era icon source registry");
    const referencedNames = new Set(
      namedEntries.map(([, iconUrl]) => iconUrl.split("/").at(-1)),
    );
    const pngNames = (await readdir(namedRoot))
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort();
    for (const name of pngNames) {
      if (!referencedNames.has(name)) {
        throw new Error(`QQ-era PNG ${name} is not referenced by its manifest`);
      }
    }
    if (referencedNames.size !== pngNames.length) {
      throw new Error("QQ-era icon manifest references a missing or duplicate PNG");
    }
    namedFiles = pngNames.map((name) => [
      `qq-era/${name}`,
      resolve(namedRoot, name),
    ]);
    for (const [relativePath, path] of namedFiles) {
      validatePngBuffer(
        await readFile(path),
        `Historic icon ${relativePath}`,
      );
    }
    namedFiles.push(
      ["qq-era/manifest.json", namedManifestPath],
      ["qq-era/sources.json", sourcesPath],
    );
    if (!metadata?.sources?.qqEra?.registry) {
      throw new Error("Icon build metadata must record the QQ-era source registry");
    }
  }

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
    namedPngs: namedEntries.length,
  };
  for (const [name, actual] of Object.entries(actualCounts)) {
    if (metadata?.counts?.[name] !== actual) {
      throw new Error(
        `Icon asset count ${name} (${actual}) does not match metadata (${String(metadata?.counts?.[name])})`,
      );
    }
  }

  const digest = await sha256ForFiles([
    ...emojiFiles,
    ...actionFiles,
    ...namedFiles,
  ]);
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
    namedFiles: namedEntries.length,
  };
}
