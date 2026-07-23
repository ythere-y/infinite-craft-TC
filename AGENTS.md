# Infinity Craft Agent Guide

## Default local workflow

1. Copy `.env.example` to `.env`.
2. Put the privately supplied DeepSeek key in `LLM_API_KEY`.
3. Run `npm run dev`.
4. Verify `http://127.0.0.1:8000/api/health`.
5. Stop with `npm run dev:down`.

Local development uses FastAPI, Redis and SQLite. Do not use EdgeOne account
authentication, project association or an Edge Function dev server for local
development.

## Production workflow

Makers automatically builds and deploys after a PR is merged to `main`. Production
uses the `test → infinite_craft` KV binding and Makers Models. Never point local code
at Makers KV and never commit `.env`, credentials or runtime data.

## Required verification

Run `npm test`,
`python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and
`npm run build` before merging. A deployment maintainer with EdgeOne CLI installed
also runs `npm run makers:build`.

Do not touch or stage another developer's unrelated working-tree files.
