import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runIconAudit } from "./audit-icon-map.mjs";
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
const LOCAL_PROMPT_MARKERS = [
  "ASSETS",
  "NAV",
  "PANEL",
  "TEMPLATES",
  "SCRIPTS",
];
const LOCAL_PROMPT_ASSETS = [
  "prompt-admin.css",
  "prompt-admin.js",
  "prompt-admin-model.js",
  "prompt-decimal.js",
];
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
  "opening-animation.css",
  "opening-animation.js",
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

function stripMarkedLocalPromptHtml(html) {
  let stripped = html;
  for (const marker of LOCAL_PROMPT_MARKERS) {
    const start = `<!-- LOCAL_PROMPT_ADMIN_${marker}_START -->`;
    const end = `<!-- LOCAL_PROMPT_ADMIN_${marker}_END -->`;
    const startAt = stripped.indexOf(start);
    const endAt = stripped.indexOf(end);
    if (startAt < 0 || endAt < startAt) {
      throw new Error(`Missing or invalid local Prompt build marker: ${marker}`);
    }
    if (
      stripped.indexOf(start, startAt + start.length) >= 0 ||
      stripped.indexOf(end, endAt + end.length) >= 0
    ) {
      throw new Error(`Duplicate local Prompt build marker: ${marker}`);
    }
    stripped = `${stripped.slice(0, startAt)}${stripped.slice(endAt + end.length)}`;
  }
  const monitorTabSemantics =
    /\s+role="tabpanel"\s+aria-labelledby="admin-monitor-tab"/gu;
  if ([...stripped.matchAll(monitorTabSemantics)].length !== 1) {
    throw new Error("Missing or duplicate local monitor tab semantics");
  }
  stripped = stripped.replace(monitorTabSemantics, "");
  return stripped;
}

async function stripLocalPromptAdminFromMakersOutput() {
  const adminDirectory = resolve(OUTPUT, "admin");
  const adminHtmlPath = resolve(adminDirectory, "index.html");
  const adminHtml = await readFile(adminHtmlPath, "utf8");
  await writeFile(adminHtmlPath, stripMarkedLocalPromptHtml(adminHtml), "utf8");
  await Promise.all(
    LOCAL_PROMPT_ASSETS.map((asset) => rm(resolve(adminDirectory, asset), {
      force: true,
    })),
  );
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
  await generateMakersRuntimeContract();
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  await cp(FRONTEND, OUTPUT, { recursive: true });
  await stripLocalPromptAdminFromMakersOutput();
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
