import { access, cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runIconAudit } from "./audit-icon-map.mjs";
import { generateMakersData } from "./generate-makers-data.mjs";
import { generateMakersNicknameData } from "./nickname-data-lib.mjs";
import { validateCommittedIconAssets } from "./icon-data-lib.mjs";
import { generateMakersPromptData } from "./prompt-data-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = resolve(ROOT, "frontend");
const OUTPUT = resolve(ROOT, "dist");
const REQUIRED_ENTRIES = [
  "THIRD_PARTY_NOTICES.md",
  "index.html",
  "app.js",
  "casino-mode.js",
  "casino-round.js",
  "combine-feedback.js",
  "effects.js",
  "icon-system.css",
  "icon-system.js",
  "score-level.js",
  "recipe-links.css",
  "recipe-links.js",
  "style.css",
  "vendor/anime.iife.min.js",
  "assets/icons/generated/emoji-icon-manifest.json",
  "assets/icons/generated/element-icon-map.json",
  "assets/icons/actions/trash.svg",
  "community.html",
  "community-admin.html",
  "wall/index.html",
  "wall/first-honor.js",
  "wall/wall.js",
  "admin/index.html",
];

async function assertPublicEntries() {
  for (const relativePath of REQUIRED_ENTRIES) {
    const file = resolve(OUTPUT, relativePath);
    await access(file);
    if ((await stat(file)).size === 0) {
      throw new Error(`Built file is empty: ${relativePath}`);
    }
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

async function loadMakersIconRecipes(root) {
  const source = await readFile(
    resolve(root, "edge-functions/_generated/icon-data.js"),
    "utf8",
  );
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const generated = await import(url);
  return generated.ELEMENT_ICONS;
}

export async function auditCommittedIconMap({ root = ROOT } = {}) {
  const projectRoot = resolve(root);
  const audit = await runIconAudit({ root: projectRoot });
  if (audit.violations.length) {
    throw new Error(
      `Committed icon map audit failed: ${audit.violations.join("; ")}`,
    );
  }

  const [browserRecipes, makersRecipes] = await Promise.all([
    readJson(
      resolve(
        projectRoot,
        "frontend/assets/icons/generated/element-icon-map.json",
      ),
      "Browser icon map",
    ),
    loadMakersIconRecipes(projectRoot),
  ]);
  const browserNames = Object.keys(browserRecipes);
  const makersNames = Object.keys(makersRecipes ?? {});
  if (browserNames.length !== 591 || makersNames.length !== 591) {
    throw new Error(
      `Icon recipe drift: expected 591 recipes, found browser=${browserNames.length}, Makers=${makersNames.length}`,
    );
  }
  for (const name of new Set([...browserNames, ...makersNames])) {
    if (
      JSON.stringify(browserRecipes[name]) !== JSON.stringify(makersRecipes[name])
    ) {
      throw new Error(`Icon recipe drift for ${name}`);
    }
  }
  return audit;
}

export async function buildMakersSite() {
  await validateCommittedIconAssets({ root: ROOT });
  await auditCommittedIconMap({ root: ROOT });
  await generateMakersData();
  await generateMakersNicknameData();
  await generateMakersPromptData();
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  await cp(FRONTEND, OUTPUT, { recursive: true });
  await cp(
    resolve(ROOT, "THIRD_PARTY_NOTICES.md"),
    resolve(OUTPUT, "THIRD_PARTY_NOTICES.md"),
  );
  await assertPublicEntries();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMakersSite();
  process.stdout.write("Built EdgeOne Makers site in dist/\n");
}
