import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = resolve(ROOT, "words/THUOCL/data");
const OUTPUT_PATH = resolve(
  ROOT,
  "edge-functions/_generated/nickname-data.js",
);

const BLOCKED_SUBSTRINGS = [
  "政府", "政治", "政策", "主席", "总理", "部长", "党", "军", "战争", "革命",
  "中国", "美国", "日本", "韩国", "朝鲜", "俄罗斯", "台湾", "香港", "澳门",
  "西藏", "新疆", "色情", "毒品", "赌博", "自杀", "死亡", "癌", "艾滋",
];

const BLOCKED_CHENGYU = new Set([
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

async function loadTopWords(filename, { top, minimum, maximum }) {
  const source = await readFile(resolve(SOURCE_DIR, filename), "utf8");
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

export async function generateMakersNicknameData() {
  const [rawChengyu, it, food, animal] = await Promise.all([
    loadTopWords("THUOCL_chengyu.txt", {
      top: 10_000,
      minimum: 4,
      maximum: 4,
    }),
    loadTopWords("THUOCL_IT.txt", {
      top: 3_000,
      minimum: 2,
      maximum: 4,
    }),
    loadTopWords("THUOCL_food.txt", {
      top: 1_500,
      minimum: 2,
      maximum: 3,
    }),
    loadTopWords("THUOCL_animal.txt", {
      top: 1_500,
      minimum: 2,
      maximum: 3,
    }),
  ]);

  const chengyu = rawChengyu.filter((word) => !BLOCKED_CHENGYU.has(word));
  const states = [...new Set([...it, ...food, ...animal])].sort();
  if (chengyu.length < 7_000 || states.length < 4_000) {
    throw new Error(
      `Filtered THUOCL corpus is unexpectedly small: chengyu=${chengyu.length}, states=${states.length}`,
    );
  }

  const banner =
    "// Generated from THUOCL by scripts/generate-makers-nickname-data.mjs. Do not edit.\n";
  const body = [
    `export const NICKNAME_CHENGYU = ${JSON.stringify(chengyu)};`,
    `export const NICKNAME_STATES = ${JSON.stringify(states)};`,
  ].join("\n");
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${banner}${body}\n`, "utf8");
  return {
    output: OUTPUT_PATH,
    chengyu: chengyu.length,
    states: states.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await generateMakersNicknameData();
  process.stdout.write(
    `Generated ${result.output} (${result.chengyu} chengyu, ${result.states} states)\n`,
  );
}
