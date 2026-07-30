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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
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
  "dist/score-level.js",
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

async function copyCommittedBuildFixture(
  root,
  { sourceRoot = ".", inputs = COMMITTED_BUILD_INPUTS } = {},
) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", sourceRoot, "ls-files", "-z", "--", ...inputs],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const sourceBase = resolve(sourceRoot);
  const destinationBase = resolve(root);
  const trackedFiles = stdout.split("\0").filter(Boolean);

  for (const relativePath of trackedFiles) {
    if (isAbsolute(relativePath)) {
      throw new Error(`Git returned an absolute tracked path: ${relativePath}`);
    }
    const source = resolve(sourceBase, relativePath);
    const destination = resolve(destinationBase, relativePath);
    if (
      !source.startsWith(`${sourceBase}${sep}`) ||
      !destination.startsWith(`${destinationBase}${sep}`)
    ) {
      throw new Error(`Tracked path escapes the fixture root: ${relativePath}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
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

test("build fixture copies only paths retained in the source Git index", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "icon-build-source-"));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "icon-build-index-only-"));
  try {
    await mkdir(join(sourceRoot, "frontend"), { recursive: true });
    await Promise.all([
      writeFile(join(sourceRoot, "frontend/tracked.txt"), "tracked"),
      writeFile(
        join(sourceRoot, "frontend/required-index-deleted.txt"),
        "residual",
      ),
      writeFile(
        join(sourceRoot, "frontend/required-untracked.txt"),
        "untracked",
      ),
    ]);
    await execFileAsync("git", ["init", "-q", sourceRoot]);
    await execFileAsync(
      "git",
      [
        "-C",
        sourceRoot,
        "add",
        "frontend/tracked.txt",
        "frontend/required-index-deleted.txt",
      ],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "config", "user.name", "Icon Build Test"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "config", "user.email", "icon-build-test@example.invalid"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "commit", "-q", "-m", "fixture baseline"],
    );
    await execFileAsync(
      "git",
      [
        "-C",
        sourceRoot,
        "rm",
        "--cached",
        "frontend/required-index-deleted.txt",
      ],
    );
    const residualPath = "frontend/required-index-deleted.txt";
    const [{ stdout: cachedDiff }, { stdout: residualStatus }] =
      await Promise.all([
        execFileAsync(
          "git",
          ["-C", sourceRoot, "diff", "--cached", "--name-status", "--", residualPath],
        ),
        execFileAsync(
          "git",
          [
            "-C",
            sourceRoot,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            residualPath,
          ],
        ),
      ]);
    assert.equal(cachedDiff.trim(), `D\t${residualPath}`);
    assert.deepEqual(
      residualStatus.trim().split("\n"),
      [`D  ${residualPath}`, `?? ${residualPath}`],
    );

    await copyCommittedBuildFixture(fixtureRoot, {
      sourceRoot,
      inputs: ["frontend"],
    });

    assert.equal(
      await readFile(join(fixtureRoot, "frontend/tracked.txt"), "utf8"),
      "tracked",
    );
    await assert.rejects(
      access(join(fixtureRoot, "frontend/required-index-deleted.txt")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(join(fixtureRoot, "frontend/required-untracked.txt")),
      { code: "ENOENT" },
    );
  } finally {
    await Promise.all([
      rm(sourceRoot, { force: true, recursive: true }),
      rm(fixtureRoot, { force: true, recursive: true }),
    ]);
  }
});

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

test("normal build rejects a non-empty mutation to a referenced icon asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "icon-build-asset-drift-"));
  try {
    await copyCommittedBuildFixture(root);
    const manifest = JSON.parse(
      await readFile(
        join(
          root,
          "frontend/assets/icons/generated/emoji-icon-manifest.json",
        ),
        "utf8",
      ),
    );
    const referencedAsset = [...new Set(Object.values(manifest))][0];
    await appendFile(join(root, "frontend", referencedAsset.slice(1)), "drift");

    const result = await runFixtureBuild(root);

    assert.notEqual(result.code, 0, "a mutated icon asset must fail the build");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /icon asset digest.*does not match metadata/i,
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
    assert.match(builtHtml, /score-level\.js/);
    assert.ok(
      builtHtml.indexOf("score-level.js") < builtHtml.indexOf("effects.js"),
      "the built helper must load before its effects consumer",
    );
    await access(join(root, "dist/score-level.js"));

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
