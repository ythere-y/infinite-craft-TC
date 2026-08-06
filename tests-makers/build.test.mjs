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
import {
  generateMakersRuntimeContract,
  validateRuntimeContract,
} from "../scripts/generate-makers-runtime-contract.mjs";

const execFileAsync = promisify(execFile);
const REQUIRED_FILES = [
  "dist/THIRD_PARTY_NOTICES.md",
  "dist/index.html",
  "dist/app.js",
  "dist/audio-feedback.js",
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
  "content/tencent-bounty-catalog.json",
  "backend/generated/bounty-content.json",
  "backend/icon_knowledge.json",
  "backend/icon_rules.json",
  "backend/seed_combinations.json",
  "backend/seed_elements.json",
  "edge-functions/_generated/bounty-content.js",
  "edge-functions/_generated/icon-data.js",
  "frontend",
  "scripts/audit-icon-map.mjs",
  "scripts/bounty-content-lib.mjs",
  "scripts/build-makers.mjs",
  "scripts/generate-bounty-content.mjs",
  "scripts/generate-icon-data.mjs",
  "scripts/generate-makers-data.mjs",
  "scripts/generate-makers-nickname-data.mjs",
  "scripts/generate-makers-prompt-data.mjs",
  "scripts/generate-makers-runtime-contract.mjs",
  "scripts/icon-data-lib.mjs",
  "scripts/nickname-data-lib.mjs",
  "scripts/prompt-data-lib.mjs",
  "scripts/shared-json-lib.mjs",
  "shared/combine-prompt.json",
  "shared/nickname-data.json",
  "shared/runtime-contract.json",
];

async function copyCommittedBuildFixture(
  root,
  {
    sourceRoot = ".",
    inputs = COMMITTED_BUILD_INPUTS,
    sourceRevision = "index",
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

  if (trackedFiles.length === 0) {
    return;
  }

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
      [
        "-C",
        sourceRoot,
        "archive",
        "--format=tar",
        sourceRevision,
        "--",
        ...trackedFiles,
      ],
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

async function replaceAsciiWithInvalidUtf8(path, marker) {
  const bytes = await readFile(path);
  const offset = bytes.indexOf(Buffer.from(marker, "ascii"));
  assert.notEqual(offset, -1, `missing corruption marker ${marker}`);
  bytes[offset] = 0x80;
  await writeFile(path, bytes);
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

test("build fixture no-ops when no requested files are tracked", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "empty-build-source-"));
  const fixtureRoot = await mkdtemp(join(tmpdir(), "empty-build-fixture-"));
  try {
    await mkdir(join(sourceRoot, "frontend"), { recursive: true });
    await writeFile(join(sourceRoot, "frontend/tracked.txt"), "tracked");
    await execFileAsync("git", ["init", "-q", sourceRoot]);
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "add", "frontend/tracked.txt"],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "config", "user.name", "Empty Build Test"],
    );
    await execFileAsync(
      "git",
      [
        "-C",
        sourceRoot,
        "config",
        "user.email",
        "empty-build-test@example.invalid",
      ],
    );
    await execFileAsync(
      "git",
      ["-C", sourceRoot, "commit", "-q", "-m", "fixture baseline"],
    );

    await copyCommittedBuildFixture(fixtureRoot, {
      sourceRoot,
      inputs: ["missing-path"],
    });

    assert.deepEqual(await readdir(fixtureRoot), []);
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
      sourceRevision: "HEAD",
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
      '\nELEMENT_ICONS["Riot Games"].icon.base = "⚡";\n',
    );

    const result = await runFixtureBuild(root);

    assert.notEqual(result.code, 0, "a drifted Makers artifact must fail the build");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /icon recipe drift.*Riot Games/i,
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
    await copyCommittedBuildFixture(root, { sourceRevision: "index" });
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

    const compiled = JSON.parse(
      await readFile(
        join(root, "backend/generated/bounty-content.json"),
        "utf8",
      ),
    );
    const builtIconMap = JSON.parse(
      await readFile(
        join(root, "dist/assets/icons/generated/element-icon-map.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      new Set(Object.keys(builtIconMap)),
      new Set(Object.keys(compiled.elements)),
    );

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

test("Makers build excludes the local Prompt administration UI and assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "makers-local-prompt-boundary-"));
  try {
    await copyWorkingBuildFixture(root);

    const result = await runFixtureBuild(root);
    assert.equal(
      result.code,
      0,
      `working-tree build failed:\n${result.stdout}\n${result.stderr}`,
    );

    const adminHtml = await readFile(join(root, "dist/admin/index.html"), "utf8");
    assert.doesNotMatch(adminHtml, /data-admin-tab="prompt"/u);
    assert.match(adminHtml, /class="admin-tabs"/u);
    assert.doesNotMatch(adminHtml, /\/api\/admin\/prompt/u);
    assert.doesNotMatch(adminHtml, /\/copy-to-draft/u);
    assert.doesNotMatch(adminHtml, /version_offset/u);
    assert.doesNotMatch(adminHtml, /method:\s*["']DELETE["']/u);
    assert.doesNotMatch(
      adminHtml,
      /prompt-(?:admin|admin-model|decimal)\.(?:js|css)/u,
    );
    assert.doesNotMatch(adminHtml, /id="prompt-(?:load-more|view-active)"/u);
    assert.doesNotMatch(
      adminHtml,
      /id="prompt-(?:module|style|example)-template"/u,
    );
    assert.doesNotMatch(adminHtml, /LOCAL_PROMPT_ADMIN_/u);
    assert.match(adminHtml, /id="admin-monitor-panel"/u);
    assert.match(adminHtml, /\/api\/admin\/stats/u);
    assert.match(adminHtml, /aria-labelledby="admin-monitor-tab"/u);
    assert.match(adminHtml, /data-admin-tab="llm"/u);
    assert.match(adminHtml, /role="tabpanel"/u);
    assert.match(adminHtml, /admin\/llm-admin\.js/u);
    assert.match(adminHtml, /admin\/llm-admin\.css/u);
    await assert.rejects(
      access(join(root, "dist/admin/prompt-admin.js")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(join(root, "dist/admin/prompt-admin.css")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(join(root, "dist/admin/prompt-decimal.js")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      access(join(root, "dist/admin/prompt-admin-model.js")),
      { code: "ENOENT" },
    );

    for (const file of await collectTextFiles(join(root, "dist"))) {
      const contents = await readFile(file, "utf8");
      assert.doesNotMatch(
        contents,
        /\/api\/admin\/prompt/u,
        `${file} must not publish the local Prompt API client`,
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
    await cp(
      "scripts/shared-json-lib.mjs",
      join(root, "scripts/shared-json-lib.mjs"),
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

test("normal build strictly decodes every canonical shared JSON input", async () => {
  const cases = [
    {
      path: "shared/nickname-data.json",
      marker: "visible",
      prepare: async (root) => {
        await writeFile(
          join(root, "shared/nickname-data.json"),
          '{"schema_version":1,"chengyu":["visible"],"states":["state"]}\n',
          "utf8",
        );
      },
    },
    {
      path: "shared/combine-prompt.json",
      marker: "identity",
    },
    {
      path: "shared/runtime-contract.json",
      marker: "max_combine_element_length",
    },
  ];

  for (const fixture of cases) {
    const root = await mkdtemp(join(tmpdir(), "strict-json-build-"));
    try {
      await copyWorkingBuildFixture(root);
      await fixture.prepare?.(root);
      await replaceAsciiWithInvalidUtf8(
        join(root, fixture.path),
        fixture.marker,
      );

      const result = await runFixtureBuild(root);

      assert.notEqual(
        result.code,
        0,
        `${fixture.path} must reject malformed UTF-8`,
      );
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /UTF-8/iu,
        fixture.path,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }
});

test("normal build rejects a UTF-8 BOM like the Python JSON readers", async () => {
  const root = await mkdtemp(join(tmpdir(), "strict-json-bom-build-"));
  try {
    await copyWorkingBuildFixture(root);
    const contractPath = join(root, "shared/runtime-contract.json");
    const source = await readFile(contractPath);
    await writeFile(
      contractPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), source]),
    );

    const result = await runFixtureBuild(root);

    assert.notEqual(result.code, 0, "UTF-8 BOM must not be stripped");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /runtime contract.*JSON/iu,
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
  for (const blankWord of ["\ufeff", "\u001c", "\u0085"]) {
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

test("nickname snapshot validator enforces every explicit blank range boundary", () => {
  const ranges = [
    [0x0009, 0x000d],
    [0x001c, 0x0020],
    [0x0085, 0x0085],
    [0x00a0, 0x00a0],
    [0x1680, 0x1680],
    [0x2000, 0x200a],
    [0x2028, 0x2029],
    [0x202f, 0x202f],
    [0x205f, 0x205f],
    [0x3000, 0x3000],
    [0xfeff, 0xfeff],
  ];
  const blankPoints = new Set(
    ranges.flatMap(([start, end]) =>
      Array.from(
        { length: end - start + 1 },
        (_, index) => start + index,
      ),
    ),
  );
  const boundaryPoints = new Set(
    ranges
      .flatMap(([start, end]) => [start - 1, end + 1])
      .filter(
        (codePoint) => (
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !blankPoints.has(codePoint)
        ),
      ),
  );
  const validateState = (state) => validateNicknameData({
    schema_version: 1,
    chengyu: ["一心一意"],
    states: [state],
  });

  for (const codePoint of blankPoints) {
    assert.throws(
      () => validateState(String.fromCodePoint(codePoint)),
      /nickname/i,
    );
  }
  for (const codePoint of boundaryPoints) {
    assert.doesNotThrow(
      () => validateState(String.fromCodePoint(codePoint)),
    );
  }
  assert.doesNotThrow(() => validateState("\u0085代码\ufeff"));
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

  const fakePrototype = Object.create(null);
  const fakePlainObject = Object.assign(Object.create(fakePrototype), {
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"],
  });
  assert.throws(
    () => validateNicknameData(fakePlainObject),
    /plain object/i,
  );

  const forgedPrototype = Object.create(null);
  forgedPrototype.constructor = function Object() {};
  const forgedPlainObject = Object.assign(
    Object.create(forgedPrototype),
    {
      schema_version: 1,
      chengyu: ["一心一意"],
      states: ["代码"],
    },
  );
  assert.throws(
    () => validateNicknameData(forgedPlainObject),
    /plain object/i,
  );

  const nullPrototype = Object.assign(Object.create(null), {
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"],
  });
  assert.deepEqual(validateNicknameData(nullPrototype), {
    schema_version: 1,
    chengyu: ["一心一意"],
    states: ["代码"],
  });
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

test("Compose resolves the shared prompt as a read-only web bind mount", async (t) => {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "docker",
      ["compose", "config", "--format", "json"],
      { cwd: ".", encoding: "utf8" },
    ));
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Docker is not installed in this environment");
      return;
    }
    throw error;
  }
  const config = JSON.parse(stdout);
  const sharedMount = config.services.web.volumes.find(
    (volume) => volume.type === "bind" && volume.target === "/app/shared",
  );

  assert.ok(sharedMount, "Compose must expose the shared prompt directory to web");
  assert.equal(sharedMount.source, resolve("shared"));
  assert.equal(sharedMount.read_only, true);
});

test("runtime contract generator validates shape and emits named exports", async () => {
  const valid = {
    schema_version: 1,
    max_combine_element_length: 80,
    max_discoverer_length: 80,
    max_session_id_length: 128,
    max_verify_recipes: 500,
    max_recipe_field_length: 80,
  };
  assert.deepEqual(validateRuntimeContract(valid), valid);
  for (const invalid of [
    null,
    [],
    { ...valid, schema_version: 2 },
    { ...valid, max_verify_recipes: 0 },
    { ...valid, max_recipe_field_length: 1.5 },
    { ...valid, max_session_id_length: "128" },
    { ...valid, max_verify_recipes: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, extra: 1 },
  ]) {
    assert.throws(
      () => validateRuntimeContract(invalid),
      /runtime contract/i,
    );
  }

  const root = await mkdtemp(join(tmpdir(), "runtime-contract-generate-"));
  try {
    await mkdir(join(root, "shared"), { recursive: true });
    await writeFile(
      join(root, "shared/runtime-contract.json"),
      `${JSON.stringify(valid)}\n`,
      "utf8",
    );
    await generateMakersRuntimeContract({ root });
    const generated = await import(
      `${pathToFileURL(join(root, "edge-functions/_generated/runtime-contract-data.js")).href}?generated=${Date.now()}`,
    );
    assert.deepEqual(
      {
        schema: generated.RUNTIME_CONTRACT_SCHEMA_VERSION,
        combine: generated.MAX_COMBINE_ELEMENT_LENGTH,
        discoverer: generated.MAX_DISCOVERER_LENGTH,
        session: generated.MAX_SESSION_ID_LENGTH,
        recipes: generated.MAX_VERIFY_RECIPES,
        recipeField: generated.MAX_RECIPE_FIELD_LENGTH,
      },
      {
        schema: 1,
        combine: 80,
        discoverer: 80,
        session: 128,
        recipes: 500,
        recipeField: 80,
      },
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("runtime contract validator matches the shared JSON number domain", async () => {
  const cases = JSON.parse(
    await readFile(
      "tests/fixtures/runtime-contract-number-cases.json",
      "utf8",
    ),
  );

  for (const fixture of cases) {
    if (fixture.valid) {
      assert.deepEqual(
        validateRuntimeContract(JSON.parse(fixture.source)),
        fixture.expected,
        fixture.name,
      );
    } else {
      assert.throws(
        () => validateRuntimeContract(JSON.parse(fixture.source)),
        undefined,
        fixture.name,
      );
    }
  }
});

test("tracked-only build regenerates the Makers runtime contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-contract-build-"));
  try {
    await copyCommittedBuildFixture(root, { sourceRevision: "index" });
    await rm(
      join(root, "edge-functions/_generated/runtime-contract-data.js"),
      { force: true },
    );

    const result = await runFixtureBuild(root);
    assert.equal(
      result.code,
      0,
      `tracked-only build failed:\n${result.stdout}\n${result.stderr}`,
    );
    const generated = await import(
      `${pathToFileURL(join(root, "edge-functions/_generated/runtime-contract-data.js")).href}?build=${Date.now()}`,
    );
    assert.equal(generated.MAX_COMBINE_ELEMENT_LENGTH, 80);
    assert.equal(generated.MAX_DISCOVERER_LENGTH, 80);
    assert.equal(generated.MAX_SESSION_ID_LENGTH, 128);
    assert.equal(generated.MAX_VERIFY_RECIPES, 500);
    assert.equal(generated.MAX_RECIPE_FIELD_LENGTH, 80);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("normal build rejects a malformed shared runtime contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-contract-invalid-"));
  try {
    await copyWorkingBuildFixture(root);
    await writeFile(
      join(root, "shared/runtime-contract.json"),
      '{"schema_version":1,"max_combine_element_length":0}\n',
      "utf8",
    );

    const result = await runFixtureBuild(root);
    assert.notEqual(result.code, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /runtime contract/i,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
