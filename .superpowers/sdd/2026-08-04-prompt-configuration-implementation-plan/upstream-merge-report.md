# Upstream merge report

Status: DONE

## Scope

Resolved the in-progress merge of `upstream/main` into
`feat/issue-22-prompt-configuration` without selecting either side wholesale.
The merge retains Epoch 2 content behavior and the local Prompt administration
feature set.

## Conflict resolution

- `backend/archive.py`
  - Retained the Prompt draft, immutable version, active-state tables, version
    index, draft revision migration, SQLite timeout, and busy timeout.
  - Retained the Epoch 2 `content_state` table, gameplay-table migration
    helpers, element `source` column/migration, fixed-content retirement, and
    destructive-reset support.
  - Prompt tables remain outside `_GAMEPLAY_TABLES`, so an authorized Epoch
    reset does not erase local Prompt configuration or history.
- `backend/main.py`
  - Retained `ADMIN_TOKEN` authentication, Prompt store initialization,
    corruption/busy handling, draft/aggregate/activate/history pagination,
    copy-to-draft, delete APIs, and active Prompt use by the LLM path.
  - Retained Epoch 2 catalog alias normalization, health reporting, and the
    full `prepare_local` / reconcile / `complete_local` / `fail_local`
    startup lifecycle.
- `backend/README.md`
  - Retained the Epoch 2 catalog, generation, starter, and data-flow
    documentation.
  - Retained the local-only Prompt management and Makers-boundary
    documentation.

## Automatically merged files reviewed

- `scripts/build-makers.mjs` retains Epoch 2 bounty generation, compiled icon
  coverage checks, and audio assets while also stripping the local Prompt
  administration HTML and assets from Makers output.
- `tests-makers/build.test.mjs` retains Epoch 2 build fixtures/assertions and
  the Prompt/Makers isolation regression test.

## Verification

- Python targeted integration:
  `226 passed`
  (`test_prompt_store.py`, `test_prompt_admin_api.py`,
  `test_prompt_admin_ui.py`, `test_prompt_validation.py`,
  `test_content_epoch.py`, `test_seed_reconciliation.py`).
- Node targeted integration:
  `52 passed`
  (`prompt-admin.test.mjs`, `content-initializer.test.mjs`).
- Makers Prompt isolation build test:
  `1 passed`.
- `npm run build`: passed; generated icon audit reported `780/780`, then built
  `dist/`.
- Python syntax compilation and Node syntax checks: passed.
- `git diff --check` and `git diff --cached --check`: passed before commit.

The first combined Node invocation was stopped by the command runner's
four-minute timeout and was not counted as evidence. The requested suites were
then split and the relevant cases passed as listed above.

## Residual risk

The complete Python and Node suites were not rerun during this merge-resolution
task; verification focused on the Prompt/Epoch boundary, the automatically
merged build logic, and the production build. Existing FastAPI/Starlette
deprecation warnings remain unchanged.
