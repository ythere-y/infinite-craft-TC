import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileBountyContent,
  serializeEdgeArtifact,
  serializePythonArtifact,
} from "./bounty-content-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function generateBountyContent({ root = ROOT } = {}) {
  const compiled = compileBountyContent({
    catalog: await readJson(resolve(root, "content/tencent-bounty-catalog.json")),
    seedElements: await readJson(resolve(root, "backend/seed_elements.json")),
    seedCombinations: await readJson(
      resolve(root, "backend/seed_combinations.json"),
    ),
  });
  const outputs = [
    "backend/generated/bounty-content.json",
    "edge-functions/_generated/bounty-content.js",
  ];
  await Promise.all(outputs.map((path) =>
    mkdir(dirname(resolve(root, path)), { recursive: true })
  ));
  await Promise.all([
    writeFile(
      resolve(root, outputs[0]),
      serializePythonArtifact(compiled),
    ),
    writeFile(
      resolve(root, outputs[1]),
      serializeEdgeArtifact(compiled),
    ),
  ]);
  return { digest: compiled.catalog_digest, outputs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await generateBountyContent();
  console.log(`${result.digest}\n${result.outputs.join("\n")}`);
}
