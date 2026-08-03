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
import { pathToFileURL } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";

import {
  validateNicknameData,
} from "../scripts/nickname-data-lib.mjs";

const execFileAsync = promisify(execFile);
const REQUIRED_FILES = [
  "dist/THIRD_PARTY_NOTICES.md",
  "dist/index.html",
  "dist/app.js",
  "dist/casino-mode.js",
  "dist/casino-round.js",
  "dist/combine-feedback.js",
  "dist/effects.js",
  "dist/icon-system.css",
  "dist/icon-system.js",
  "dist/score-level.js",
  "dist/recipe-links.css",
  "dist/recipe-links.js",
  "dist/style.css",
  "dist/vendor/anime.iife.min.js",
  "dist/assets/icons/generated/emoji-icon-manifest.json",
  "dist/assets/icons/generated/element-icon-map.json",
  "dist/assets/icons/actions/trash.svg",
  "dist/community.html",
  "dist/community-admin.html",
  "dist/wall/index.html",
  "dist/wall/first-honor.js",
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
  "scripts/generate-makers-nickname-data.mjs",
  "scripts/generate-makers-prompt-data.mjs",
  "scripts/icon-data-lib.mjs",
  "scripts/nickname-data-lib.mjs",
  "scripts/prompt-data-lib.mjs",
  "shared/combine-prompt.json",
  "shared/nickname-data.json",
];

async function copyCommittedBuildFixture(
  root,
  {
    sourceRoot = ".",
    inputs = COMMITTED_BUILD_INPUTS,
    sourceRevision = "HEAD",
  } = {},
) {
  const useIndex = sourceRevision === "index";
  const { stdout } = await execFileAsync(
    "git",
    useIndex
      ? ["-C", sourceRoot, "ls-files", "--cached", "-z", "--", ...inputs]
      : ["-C", sourceRoot, "ls-tree", "-r", "-z", "--name-only", sourceRevision, "--", ...inputs],
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
  }

  if (!useIndex) {
    const { stdout: archive } = await execFileAsync(
      "git",
      ["-C", sourceRoot, "archive", "--format=tar", sourceRevision, "--", ...inputs],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    const archivePath = join(destinationBase, ".build-fixture-inputs.tar");
    await writeFile(archivePath, archive);
    try {
      await execFileAsync("tar", ["-xf", archivePath, "-C", destinationBase]);
    } finally {
      await rm(archivePath, { force: true });
    }
    return;
  }

  for (const relativePath of trackedFiles) {
    const destination = resolve(destinationBase, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    const { stdout: contents } = await execFileAsync(
      "git",
      ["-C", sourceRoot, "show", useIndex ? `:${relativePath}` : `${sourceRevision}:${relativePath}`],
      { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
    );
    await writeFile(destination, contents);
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

async function copyWorkingBuildFixture(root) {
  for (const input of COMMITTED_BUILD_INPUTS) {
    await cp(resolve(input), resolve(root, input), { recursive: true });
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
      sourceRevision: "index",
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

test("build fixture reads tracked input bytes from Git HEAD", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "prompt-build-index-content-"));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "prompt-build-index-fixture-"));
  try {
    await mkdir(join(sourceRoot, "shared"), { recursive: true });
    await writeFile(
      join(sourceRoot, "shared/combine-prompt.json"),
      '{"schema_version":1}',
    );
    await execFileAsync("git", ["init", "-q", sourceRoot]);
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "add", "shared/combine-prompt.json"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "config", "user.name", "Prompt Build Test"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "config", "user.email", "prompt-build-test@example.invalid"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "commit", "-q", "-m", "fixture baseline"],
    );
    await writeFile(
      join(sourceRoot, "shared/combine-prompt.json"),
      '{"schema_version":999}',
    );

    await copyCommittedBuildFixture(fixtureRoot, {
      sourceRoot,
      inputs: ["shared/combine-prompt.json"],
    });

    assert.equal(
      await readFile(join(fixtureRoot, "shared/combine-prompt.json"), "utf8"),
      '{"schema_version":1}',
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

test("nickname generator is deterministic and needs no words checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "nickname-generator-"));
  try {
    await Promise.all([
      mkdir(join(root, "scripts"), { recursive: true }),
      mkdir(join(root, "shared"), { recursive: true }),
    ]);
    await cp(
      "scripts/generate-makers-nickname-data.mjs",
      join(root, "scripts/generate-makers-nickname-data.mjs"),
    );
    await cp(
      "scripts/nickname-data-lib.mjs",
      join(root, "scripts/nickname-data-lib.mjs"),
    );
    await writeFile(
      join(root, "shared/nickname-data.json"),
      `${JSON.stringify({
        schema_version: 1,
        chengyu: ["一心一意", "全力以赴"],
        states: ["代码", "咖啡"],
      })}\n`,
      "utf8",
    );
    await assert.rejects(access(join(root, "words")), { code: "ENOENT" });

    await execFileAsync(
      process.execPath,
      ["scripts/generate-makers-nickname-data.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    const first = await readFile(
      join(root, "edge-functions/_generated/nickname-data.js"),
      "utf8",
    );
    await execFileAsync(
      process.execPath,
      ["scripts/generate-makers-nickname-data.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    const second = await readFile(
      join(root, "edge-functions/_generated/nickname-data.js"),
      "utf8",
    );

    assert.equal(second, first);
    assert.match(first, /NICKNAME_CHENGYU = \["一心一意","全力以赴"\]/u);
    assert.match(first, /NICKNAME_STATES = \["代码","咖啡"\]/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("normal build rejects malformed shared nickname data", async () => {
  const root = await mkdtemp(join(tmpdir(), "nickname-build-invalid-"));
  try {
    await copyWorkingBuildFixture(root);
    await writeFile(
      join(root, "shared/nickname-data.json"),
      '{"schema_version":1,"chengyu":[],"states":["代码"]}\n',
      "utf8",
    );

    const result = await runFixtureBuild(root);

    assert.notEqual(result.code, 0, "an empty nickname corpus must fail");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /nickname.*chengyu.*non-empty/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("nickname snapshot validator rejects schema and pool shape drift", () => {
  const valid = {
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"],
  };

  assert.deepEqual(validateNicknameData(valid), valid);
  for (const invalid of [
    { ...valid, schema_version: "1" },
    { ...valid, extra: true },
    { ...valid, chengyu: [] },
    { ...valid, states: [" "] },
    { ...valid, states: [1] },
  ]) {
    assert.throws(() => validateNicknameData(invalid), /nickname/i);
  }
});

test("nickname snapshot validator uses the shared blank-string domain", () => {
  for (const blankWord of ["\ufeff", "\u001c"]) {
    assert.throws(
      () => validateNicknameData({
        schema_version: 1,
        chengyu: ["一心一意"],
        states: [blankWord],
      }),
      /nickname/i,
    );
  }

  assert.deepEqual(
    validateNicknameData({
      schema_version: 1,
      chengyu: ["一心一意"],
      states: ["\ufeff代码\u001c"],
    }),
    {
      schema_version: 1,
      chengyu: ["一心一意"],
      states: ["\ufeff代码\u001c"],
    },
  );
});

test("nickname snapshot validator accepts a cross-realm plain object", () => {
  const crossRealm = runInNewContext(`({
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"]
  })`);

  assert.deepEqual(validateNicknameData(crossRealm), {
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"],
  });

  class NicknameRecord {}
  assert.throws(
    () => validateNicknameData(Object.assign(new NicknameRecord(), {
      schema_version: 1,
      chengyu: ["一心一意"],
      states: ["代码"],
    })),
    /plain object/i,
  );
});

test("normal build rejects each missing casino runtime asset", async () => {
  const assets = [
    "frontend/vendor/anime.iife.min.js",
    "frontend/casino-round.js",
    "frontend/casino-mode.js",
  ];

  for (const asset of assets) {
    const root = await mkdtemp(join(tmpdir(), "casino-build-required-"));
    try {
      await copyWorkingBuildFixture(root);
      await rm(join(root, asset), { force: true });

      const result = await runFixtureBuild(root);

      assert.notEqual(
        result.code,
        0,
        `build must reject a missing ${asset}`,
      );
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        new RegExp(asset.split("/").at(-1).replaceAll(".", "\\.")),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("committed-only Makers fixture regenerates prompt data from the canonical schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "prompt-build-committed-"));
  try {
    await copyCommittedBuildFixture(root);

    const result = await runFixtureBuild(root);
    assert.equal(
      result.code,
      0,
      `committed-only build failed:\n${result.stdout}\n${result.stderr}`,
    );

    const canonical = JSON.parse(
      await readFile(join(root, "shared/combine-prompt.json"), "utf8"),
    );
    const built = await import(
      `${pathToFileURL(join(root, "edge-functions/_generated/prompt-data.js")).href}?build=${Date.now()}`,
    );
    assert.equal(built.PROMPT_SPEC.schema_version, canonical.schema_version);
    assert.deepEqual(built.PROMPT_SPEC, canonical);

    await rm(join(root, "edge-functions/_generated/prompt-data.js"), { force: true });
    await execFileAsync(process.execPath, ["scripts/generate-makers-prompt-data.mjs"], {
      cwd: root,
      encoding: "utf8",
    });

    const regenerated = await import(
      `${pathToFileURL(join(root, "edge-functions/_generated/prompt-data.js")).href}?generator=${Date.now()}`,
    );
    assert.deepEqual(regenerated.PROMPT_SPEC, canonical);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Compose resolves the shared prompt as a read-only web bind mount", async () => {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "config", "--format", "json"],
    { cwd: ".", encoding: "utf8" },
  );
  const config = JSON.parse(stdout);
  const sharedMount = config.services.web.volumes.find(
    (volume) => volume.type === "bind" && volume.target === "/app/shared",
  );

  assert.ok(sharedMount, "Compose must expose the shared prompt directory to web");
  assert.equal(sharedMount.source, resolve("shared"));
  assert.equal(sharedMount.read_only, true);
});
