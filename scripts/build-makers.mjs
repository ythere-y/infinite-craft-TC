import { access, cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateMakersData } from "./generate-makers-data.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = resolve(ROOT, "frontend");
const OUTPUT = resolve(ROOT, "dist");
const REQUIRED_ENTRIES = [
  "index.html",
  "app.js",
  "effects.js",
  "style.css",
  "wall/index.html",
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

export async function buildMakersSite() {
  await generateMakersData();
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  await cp(FRONTEND, OUTPUT, { recursive: true });
  await assertPublicEntries();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMakersSite();
  process.stdout.write("Built EdgeOne Makers site in dist/\n");
}
