import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function escapedRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function setEnvValue(source, key, value) {
  const pattern = new RegExp(
    `^[\\t ]*${escapedRegex(key)}[\\t ]*=[^\\r\\n]*(\\r?)$`,
    "gmu",
  );
  if (pattern.test(source)) {
    pattern.lastIndex = 0;
    return source.replace(
      pattern,
      (_line, carriageReturn) => `${key}=${value}${carriageReturn}`,
    );
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const separator = source && !source.endsWith("\n") ? newline : "";
  return `${source}${separator}${key}=${value}${newline}`;
}

async function requireFile(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

export async function prepareMakersDev({ root = ROOT } = {}) {
  const projectFile = resolve(root, ".edgeone", "project.json");
  const envFile = resolve(root, ".env");

  await requireFile(
    projectFile,
    "尚未关联 Makers 项目，请先运行 edgeone makers link",
  );
  await requireFile(
    envFile,
    "尚未同步 Makers 环境变量，请运行 edgeone makers env pull -f .env",
  );

  const source = await readFile(envFile, "utf8");
  const updated = setEnvValue(source, "APP_ENV", "dev");
  if (updated !== source) {
    await writeFile(envFile, updated, "utf8");
  }
  return { envFile };
}

async function run() {
  await prepareMakersDev();
  const executable = process.platform === "win32" ? "edgeone.cmd" : "edgeone";
  const child = spawn(
    executable,
    ["makers", "dev", "--skip-env-sync"],
    {
      cwd: ROOT,
      env: { ...process.env, PAGES_SOURCE: "skills" },
      stdio: "inherit",
    },
  );

  await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`EdgeOne CLI 被信号 ${signal} 终止`));
        return;
      }
      process.exitCode = code ?? 1;
      resolvePromise();
    });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run().catch((error) => {
    process.stderr.write(`Makers 本地开发启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}
