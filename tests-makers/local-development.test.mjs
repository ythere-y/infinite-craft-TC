import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("package scripts expose Docker local development", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(
    packageJson.scripts.dev,
    "docker compose up --build --remove-orphans",
  );
  assert.equal(packageJson.scripts["dev:down"], "docker compose down");
  assert.equal("makers:dev" in packageJson.scripts, false);
  assert.equal(await exists("scripts/dev-makers.mjs"), false);
});

test("Compose fixes the local runtime and supports source reload", async () => {
  const compose = await readFile("docker-compose.yml", "utf8");

  assert.doesNotMatch(compose, /container_name:/u);
  assert.match(compose, /healthcheck:/u);
  assert.match(compose, /condition:\s*service_healthy/u);
  assert.match(compose, /APP_ENV:\s*"dev"/u);
  assert.match(compose, /REDIS_URL:\s*"redis:\/\/redis:6379\/1"/u);
  assert.match(compose, /LLM_API_KEY:\s*"\$\{LLM_API_KEY:-\}"/u);
  assert.match(compose, /LLM_BASE_URL:.*https:\/\/api\.deepseek\.com/u);
  assert.match(compose, /LLM_MODEL:.*deepseek-v4-flash/u);
  assert.match(compose, /\.\/backend:\/app\/backend:ro/u);
  assert.match(compose, /\.\/frontend:\/app\/frontend:ro/u);
  assert.match(compose, /\.\/data:\/app\/data/u);
  assert.match(compose, /command:[\s\S]*uvicorn[\s\S]*--reload/u);
  assert.doesNotMatch(compose, /MAKERS_MODELS_KEY/u);
});

test("the environment template is local and contains no secret", async () => {
  const envExample = await readFile(".env.example", "utf8");

  assert.match(envExample, /^APP_ENV=dev$/mu);
  assert.match(envExample, /^LLM_API_KEY=$/mu);
  assert.match(
    envExample,
    /^LLM_BASE_URL=https:\/\/api\.deepseek\.com$/mu,
  );
  assert.match(envExample, /^LLM_MODEL=deepseek-v4-flash$/mu);
  assert.doesNotMatch(envExample, /^MAKERS_MODELS_KEY=/mu);
  assert.doesNotMatch(envExample, /test_dev/u);
});
