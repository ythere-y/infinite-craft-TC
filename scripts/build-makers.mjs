import { access, cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runIconAudit } from "./audit-icon-map.mjs";
import { generateBountyContent } from "./generate-bounty-content.mjs";
import { generateMakersData } from "./generate-makers-data.mjs";
import { generateMakersNicknameData } from "./nickname-data-lib.mjs";
import { validateCommittedIconAssets } from "./icon-data-lib.mjs";
import { generateMakersPromptData } from "./prompt-data-lib.mjs";
import {
  generateMakersRuntimeContract,
} from "./generate-makers-runtime-contract.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = resolve(ROOT, "frontend");
const OUTPUT = resolve(ROOT, "dist");
const REQUIRED_ENTRIES = [
  "THIRD_PARTY_NOTICES.md",
  "index.html",
  "app.js",
  "audio-feedback.js",
  "casino-mode.js",
  "casino-round.js",
  "combine-feedback.js",
  "effects.js",
  "icon-system.css",
  "icon-system.js",
  "opening-animation.css",
  "opening-animation.js",
  "score-level.js",
  "recipe-links.css",
  "recipe-links.js",
  "startup-api.js",
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
  "admin/admin-tabs.js",
  "admin/llm-admin.css",
  "admin/llm-admin.js",
  "admin/prompt-admin.css",
  "admin/prompt-admin.js",
  "admin/prompt-admin-model.js",
  "admin/prompt-decimal.js",
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

  const [baseElements, bountyElements, browserRecipes, makersRecipes] =
    await Promise.all([
      readJson(
        resolve(projectRoot, "backend/seed_elements.json"),
        "Base elements",
      ),
      readJson(
        resolve(projectRoot, "backend/generated/bounty-content.json"),
        "Compiled bounty elements",
      ),
      readJson(
        resolve(
          projectRoot,
          "frontend/assets/icons/generated/element-icon-map.json",
        ),
        "Browser icon map",
      ),
      loadMakersIconRecipes(projectRoot),
    ]);
  const expectedNames = new Set([
    ...Object.keys(baseElements.elements || {}),
    ...Object.keys(bountyElements.elements || {}),
  ]);
  const expectedCount = expectedNames.size;
  const browserNames = Object.keys(browserRecipes);
  const makersNames = Object.keys(makersRecipes ?? {});
  if (
    browserNames.length !== expectedCount ||
    makersNames.length !== expectedCount
  ) {
    throw new Error(
      `Icon recipe drift: expected ${expectedCount} recipes, ` +
        `found browser=${browserNames.length}, Makers=${makersNames.length}`,
    );
  }
  for (const name of expectedNames) {
    if (
      !Object.hasOwn(browserRecipes, name) ||
      !Object.hasOwn(makersRecipes, name)
    ) {
      throw new Error(`Icon recipe drift for ${name}`);
    }
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
  await generateBountyContent();
  await validateCommittedIconAssets({ root: ROOT });
  await auditCommittedIconMap({ root: ROOT });
  await generateMakersData();
  await generateMakersNicknameData();
  await generateMakersPromptData();
  await generateMakersRuntimeContract();
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
