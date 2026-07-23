import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareMakersDev,
  setEnvValue,
} from "../scripts/dev-makers.mjs";

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "infinity-makers-dev-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("setEnvValue preserves secrets and forces APP_ENV=dev", () => {
  const source = [
    "MAKERS_MODELS_KEY=keep-this-secret",
    "APP_ENV=prod",
    "ADMIN_TOKEN=keep-admin",
    "",
  ].join("\n");

  const updated = setEnvValue(source, "APP_ENV", "dev");

  assert.match(updated, /^APP_ENV=dev$/mu);
  assert.match(updated, /^MAKERS_MODELS_KEY=keep-this-secret$/mu);
  assert.match(updated, /^ADMIN_TOKEN=keep-admin$/mu);
  assert.doesNotMatch(updated, /^APP_ENV=prod$/mu);
  assert.equal(setEnvValue(updated, "APP_ENV", "dev"), updated);
});

test("setEnvValue appends a missing variable without changing existing lines", () => {
  const source = "MAKERS_MODELS_KEY=keep-this-secret\n";

  assert.equal(
    setEnvValue(source, "APP_ENV", "dev"),
    "MAKERS_MODELS_KEY=keep-this-secret\nAPP_ENV=dev\n",
  );
});

test("prepareMakersDev refuses an unlinked clone", async (t) => {
  const root = await temporaryRoot(t);
  await writeFile(join(root, ".env"), "MAKERS_MODELS_KEY=secret\n");

  await assert.rejects(
    prepareMakersDev({ root }),
    /edgeone makers link/u,
  );
});

test("prepareMakersDev requires environment synchronization", async (t) => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, ".edgeone"), { recursive: true });
  await writeFile(join(root, ".edgeone", "project.json"), "{}\n");

  await assert.rejects(
    prepareMakersDev({ root }),
    /edgeone makers env pull -f \.env/u,
  );
});

test("prepareMakersDev changes only APP_ENV in a linked clone", async (t) => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, ".edgeone"), { recursive: true });
  await writeFile(join(root, ".edgeone", "project.json"), "{}\n");
  await writeFile(
    join(root, ".env"),
    [
      "# synchronized project configuration",
      "MAKERS_MODELS_KEY=keep-this-secret",
      "APP_ENV=prod",
      "ADMIN_TOKEN=keep-admin",
      "",
    ].join("\n"),
  );

  const result = await prepareMakersDev({ root });
  const updated = await readFile(join(root, ".env"), "utf8");

  assert.equal(result.envFile, join(root, ".env"));
  assert.equal(
    updated,
    [
      "# synchronized project configuration",
      "MAKERS_MODELS_KEY=keep-this-secret",
      "APP_ENV=dev",
      "ADMIN_TOKEN=keep-admin",
      "",
    ].join("\n"),
  );
});

test("package scripts expose a non-recursive Makers development command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    packageJson.scripts["makers:dev"],
    "node scripts/dev-makers.mjs",
  );
  assert.equal(packageJson.scripts["makers:build"], "edgeone makers build");
  assert.equal("dev" in packageJson.scripts, false);
});
