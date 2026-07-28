import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUIRED_FILES = [
  "dist/THIRD_PARTY_NOTICES.md",
  "dist/index.html",
  "dist/app.js",
  "dist/combine-feedback.js",
  "dist/effects.js",
  "dist/icon-system.css",
  "dist/icon-system.js",
  "dist/style.css",
  "dist/assets/icons/generated/emoji-icon-manifest.json",
  "dist/assets/icons/generated/element-icon-map.json",
  "dist/assets/icons/actions/trash.svg",
  "dist/community.html",
  "dist/community-admin.html",
  "dist/wall/index.html",
  "dist/wall/polling.js",
  "dist/wall/wall.js",
  "dist/admin/index.html",
];

const COMMITTED_BUILD_INPUTS = [
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "backend/icon_knowledge.json",
  "backend/seed_combinations.json",
  "backend/seed_elements.json",
  "edge-functions/_generated/icon-data.js",
  "frontend",
  "scripts/audit-icon-map.mjs",
  "scripts/build-makers.mjs",
  "scripts/generate-makers-data.mjs",
  "scripts/icon-data-lib.mjs",
];

async function copyCommittedBuildFixture(root) {
  for (const source of COMMITTED_BUILD_INPUTS) {
    const destination = join(root, source);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }
}

async function runFixtureBuild(root) {
  try {
    const result = await execFileAsync(
      process.execPath,
      ["scripts/build-makers.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function collectTextFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(path));
    } else if (/\.(?:css|html|js)$/i.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("normal build rejects drift between browser and Makers icon recipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-build-drift-"));
  try {
    await copyCommittedBuildFixture(root);
    await appendFile(
      join(root, "edge-functions/_generated/icon-data.js"),
      '\nELEMENT_ICONS.Riot.icon.base = "⚡";\n',
    );

    const result = await runFixtureBuild(root);

    assert.notEqual(result.code, 0, "a drifted Makers artifact must fail the build");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /icon recipe drift.*Riot/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("normal build needs no words checkout and ships only local icon assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-build-committed-"));
  try {
    await copyCommittedBuildFixture(root);
    await assert.rejects(access(join(root, "words")), { code: "ENOENT" });

    const result = await runFixtureBuild(root);
    assert.equal(
      result.code,
      0,
      `committed-only build failed:\n${result.stdout}\n${result.stderr}`,
    );

    for (const file of REQUIRED_FILES) {
      const path = join(root, file);
      await access(path);
      assert.ok((await stat(path)).size > 0, `${file} should not be empty`);
    }

    const builtHtml = await readFile(join(root, "dist/index.html"), "utf8");
    const sourceHtml = await readFile(join(root, "frontend/index.html"), "utf8");
    assert.equal(builtHtml, sourceHtml);

    const manifest = JSON.parse(
      await readFile(
        join(
          root,
          "frontend/assets/icons/generated/emoji-icon-manifest.json",
        ),
        "utf8",
      ),
    );
    assert.equal(Object.keys(manifest).length, 9111);
    await Promise.all(
      [...new Set(Object.values(manifest))].map((url) =>
        access(join(root, "dist", url.slice(1))),
      ),
    );

    for (const file of await collectTextFiles(join(root, "dist"))) {
      const contents = await readFile(file, "utf8");
      assert.doesNotMatch(
        contents,
        /(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|use\.fontawesome\.com|phosphoricons\.com)/i,
        `${file} should not load a third-party icon CDN`,
      );
      assert.doesNotMatch(
        contents,
        /data:image\/svg\+xml[^\n]*<text|data:image\/svg\+xml[^\n]*%3Ctext/i,
        `${file} should not embed an Emoji text favicon`,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
