import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_KEYS = ["chengyu", "schema_version", "states"];

export const BLOCKED_SUBSTRINGS = [
  "政府", "政治", "政策", "主席", "总理", "部长", "党", "军", "战争", "革命",
  "中国", "美国", "日本", "韩国", "朝鲜", "俄罗斯", "台湾", "香港", "澳门",
  "西藏", "新疆", "色情", "毒品", "赌博", "自杀", "死亡", "癌", "艾滋",
];

export const BLOCKED_CHENGYU = new Set([
  "阴谋诡计", "丧心病狂", "狼心狗肺", "奸诈狡猾", "禽兽不如",
  "忘恩负义", "偷鸡摸狗", "蛇蝎心肠", "贪得无厌", "贪赃枉法",
  "贫病交加", "家破人亡", "妻离子散", "生死攸关", "山穷水尽",
  "万劫不复", "死不瞑目", "死里逃生", "血流成河", "血雨腥风",
  "暗无天日", "背信弃义", "残兵败将", "残忍不堪", "尸横遍野",
]);

function allowed(word) {
  return (
    /^[\u4e00-\u9fff]+$/u.test(word) &&
    !BLOCKED_SUBSTRINGS.some((blocked) => word.includes(blocked))
  );
}

export async function loadTopWords(
  filename,
  {
    sourceDir,
    top,
    minimum,
    maximum,
  },
) {
  const source = await readFile(resolve(sourceDir, filename), "utf8");
  const output = [];
  for (const line of source.split(/\r?\n/u).slice(0, top)) {
    const word = line
      .trim()
      .split(/\s+/u)[0]
      ?.replace(/^\ufeff/u, "")
      .trim();
    const length = [...(word || "")].length;
    if (
      word &&
      length >= minimum &&
      length <= maximum &&
      allowed(word)
    ) {
      output.push(word);
    }
  }
  return output;
}

function validatePool(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (word) => typeof word !== "string" || word.trim().length === 0,
    )
  ) {
    throw new TypeError(
      `Nickname ${label} must be a non-empty array of non-empty strings`,
    );
  }
  return [...value];
}

export function validateNicknameData(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Nickname data must be a plain object");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== SNAPSHOT_KEYS.length ||
    keys.some((key, index) => key !== SNAPSHOT_KEYS[index])
  ) {
    throw new TypeError(
      "Nickname data must contain exactly schema_version, chengyu, and states",
    );
  }
  if (value.schema_version !== 1) {
    throw new TypeError("Nickname schema_version must be 1");
  }
  return {
    schema_version: 1,
    chengyu: validatePool(value.chengyu, "chengyu"),
    states: validatePool(value.states, "states"),
  };
}

export async function refreshNicknameCorpus({
  root = ROOT,
  sourceDir,
  outputPath,
} = {}) {
  const projectRoot = resolve(root);
  const inputDir = sourceDir
    ? resolve(sourceDir)
    : resolve(projectRoot, "words/THUOCL/data");
  const destination = outputPath
    ? resolve(outputPath)
    : resolve(projectRoot, "shared/nickname-data.json");
  const [rawChengyu, it, food, animal] = await Promise.all([
    loadTopWords("THUOCL_chengyu.txt", {
      sourceDir: inputDir,
      top: 10_000,
      minimum: 4,
      maximum: 4,
    }),
    loadTopWords("THUOCL_IT.txt", {
      sourceDir: inputDir,
      top: 3_000,
      minimum: 2,
      maximum: 4,
    }),
    loadTopWords("THUOCL_food.txt", {
      sourceDir: inputDir,
      top: 1_500,
      minimum: 2,
      maximum: 3,
    }),
    loadTopWords("THUOCL_animal.txt", {
      sourceDir: inputDir,
      top: 1_500,
      minimum: 2,
      maximum: 3,
    }),
  ]);
  const snapshot = validateNicknameData({
    schema_version: 1,
    chengyu: rawChengyu.filter((word) => !BLOCKED_CHENGYU.has(word)),
    states: [...new Set([...it, ...food, ...animal])].sort(),
  });
  if (snapshot.chengyu.length < 7_000 || snapshot.states.length < 4_000) {
    throw new Error(
      `Filtered THUOCL corpus is unexpectedly small: chengyu=${snapshot.chengyu.length}, states=${snapshot.states.length}`,
    );
  }

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify(snapshot)}\n`,
    "utf8",
  );
  return {
    output: destination,
    chengyu: snapshot.chengyu.length,
    states: snapshot.states.length,
  };
}

export async function generateMakersNicknameData({
  root = ROOT,
  outputPath,
} = {}) {
  const projectRoot = resolve(root);
  const sourcePath = resolve(projectRoot, "shared/nickname-data.json");
  const destination = outputPath
    ? resolve(outputPath)
    : resolve(projectRoot, "edge-functions/_generated/nickname-data.js");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Nickname snapshot is invalid: ${error.message}`);
  }
  const snapshot = validateNicknameData(parsed);
  const banner =
    "// Generated from shared/nickname-data.json by scripts/generate-makers-nickname-data.mjs. Do not edit.\n";
  const body = [
    `export const NICKNAME_CHENGYU = ${JSON.stringify(snapshot.chengyu)};`,
    `export const NICKNAME_STATES = ${JSON.stringify(snapshot.states)};`,
  ].join("\n");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${banner}${body}\n`, "utf8");
  return {
    output: destination,
    chengyu: snapshot.chengyu.length,
    states: snapshot.states.length,
  };
}
