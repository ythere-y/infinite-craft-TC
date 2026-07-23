# Render Free Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FastAPI game deployable as a free Render Docker Web Service with an external Redis URL and DeepSeek secret.

**Architecture:** Keep the existing single-container FastAPI application and connect it to a separately created Render Key Value service. Add only platform configuration and documentation; do not change game behavior or store secrets in Git.

**Tech Stack:** Docker, Render Blueprint, FastAPI, Redis, DeepSeek OpenAI-compatible API

## Global Constraints

- Bind the public server to `0.0.0.0` and `${PORT:-8000}`.
- Keep `LLM_API_KEY` and `REDIS_URL` out of source control.
- Use `deepseek-v4-flash` with thinking disabled.
- Accept ephemeral SQLite storage for the free test deployment.

---

### Task 1: Dynamic container port

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: Render's optional `PORT` environment variable.
- Produces: A container command that listens on the injected port or local port 8000.

- [ ] Replace the exec-form fixed-port CMD with `CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]`.
- [ ] Build the Docker image and confirm the build exits successfully.

### Task 2: Render Blueprint

**Files:**
- Create: `render.yaml`

**Interfaces:**
- Consumes: `REDIS_URL` and `LLM_API_KEY` entered in the Render Dashboard.
- Produces: A free Docker Web Service with `/api/health` monitoring.

- [ ] Declare a `web` service using `runtime: docker`, `plan: free`, and `healthCheckPath: /api/health`.
- [ ] Add production defaults for DeepSeek Flash and mark `REDIS_URL` and `LLM_API_KEY` with `sync: false`.
- [ ] Parse the YAML and assert that no secret value appears in it.

### Task 3: Operator documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: The Render Blueprint and two Dashboard-provided secrets.
- Produces: A reproducible GitHub-to-Render deployment procedure.

- [ ] Document creation of a free Render Key Value instance and retrieval of its internal URL.
- [ ] Document Blueprint/Web Service creation, secret entry, health verification, and the public URL.
- [ ] Document free-tier cold starts and ephemeral SQLite/Redis data.
- [ ] Run the existing test suite and inspect the final Git diff for accidental secrets.
