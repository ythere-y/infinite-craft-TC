# Local Prompt Configuration and Versioning Design

## Context

Issue #22 makes the local deployment's combination prompt editable without
requiring source changes. The existing prompt is defined by
`shared/combine-prompt.json`, rendered by the Python backend, and transformed
into static Makers data at build time. The local admin page currently provides
runtime monitoring and already supports optional `ADMIN_TOKEN` protection.

This change applies only to the local FastAPI deployment. Makers/EdgeOne keeps
using the repository's static prompt specification at build time.

## Goals

- Manage fixed prompt modules, style guidance and probabilities, positive
  examples, negative examples, and existing prompt parameters from `/admin`.
- Keep drafts separate from versions used by live LLM requests.
- Aggregate a draft into an immutable, previewable version by selecting one
  enabled style according to its configured probability.
- Activate a reviewed version explicitly and allow rollback to any historical
  version.
- Persist drafts, versions, and the active-version pointer in local SQLite.
- Bootstrap the existing canonical prompt as the initial draft and active
  version without changing pre-upgrade LLM behavior.
- Protect every prompt-management read and write with `ADMIN_TOKEN`.
- Preserve extension points for future community-derived positive and negative
  examples without implementing issue #2 in this change.

## Non-goals

- Community voting or formula governance.
- Automatic ingestion of high- or low-scoring community formulas.
- Model fine-tuning.
- Cloud multi-tenant prompt management.
- Runtime prompt management for Makers/EdgeOne.
- Rich-text editing or a visual prompt workflow builder.
- Deleting historical prompt versions.

## Chosen Approach

Store the editable draft as one validated JSON document in SQLite and store each
aggregate as an immutable JSON snapshot. A separate singleton state row points
to the active version.

This is preferred over fully normalized style/example/module tables because the
configuration is loaded and validated as a whole, and because atomic draft
saves avoid partially updated configurations. It is preferred over writing JSON
files because SQLite provides transactions, reliable container-volume
persistence, and a natural immutable version history.

## Data Model

SQLite owns three logical records:

1. A singleton prompt draft containing the validated modular configuration and
   its update timestamp.
2. Immutable prompt versions containing a stable version identifier, creation
   timestamp, selected style identifier and label, the complete configuration
   snapshot, the effective prompt specification, and the rendered preview.
3. A singleton active-version pointer referencing one existing version.

The draft includes:

- schema version and temperature;
- ordered fixed system modules with stable IDs, enabled flags, and content;
- styles with stable IDs, enabled flags, labels, guidance, and percentage
  probabilities;
- enabled/disabled positive plain-text examples;
- enabled/disabled negative plain-text examples;
- existing structured few-shot examples needed for backward compatibility;
- existing capacity and prompt-limit parameters.

Generated versions are never edited in place. Activating or rolling back only
updates the active pointer in a transaction.

## Bootstrap and Compatibility

During local database initialization, absence of prompt-management records
triggers a one-time bootstrap:

1. Load and validate `shared/combine-prompt.json`.
2. Convert its styles from fractional weights to percentages.
3. Preserve all existing modules, structured examples, parameters, and render
   behavior.
4. Create empty manual positive and negative text-example collections.
5. Save the converted configuration as the initial draft.
6. Generate an initial immutable version representing the original canonical
   specification and set it active.

Bootstrap is idempotent. Existing database state is never overwritten on later
starts. Invalid or corrupt stored state fails explicitly rather than silently
falling back to a different prompt.

The live Python LLM path reads the current active snapshot. Static Makers builds
continue reading `shared/combine-prompt.json`, so this local-only feature does
not introduce a cloud database dependency.

## Validation and Aggregation

Draft validation rejects:

- no enabled styles;
- enabled-style probabilities whose sum is not exactly 100%;
- non-numeric, negative, or greater-than-100 probabilities;
- blank or duplicate IDs;
- blank style names or guidance;
- blank enabled fixed modules or text examples;
- invalid temperature, capacities, or limits;
- malformed structured examples.

Probability calculations use decimal-safe validation to avoid floating-point
surprises in the displayed 100% total.

Aggregation:

1. Load and revalidate the persisted draft.
2. Select exactly one enabled style using its percentage probability.
3. Build an effective immutable prompt specification containing the enabled
   fixed modules, selected style guidance, enabled positive text examples,
   enabled negative text examples, structured examples, and enabled parameters.
4. Render a complete preview using representative placeholders that clearly
   show all effective static prompt content.
5. Save the draft snapshot, selection metadata, effective specification, and
   preview as one version transaction.
6. Return the version for review without changing the active pointer.

The preview version remains unchanged if the draft is edited afterward.
Publishing draft changes therefore always requires a new aggregation.

## Admin API

All endpoints under `/api/admin/prompt/*` require the same bearer
`ADMIN_TOKEN` used by the existing admin monitor.

- `GET /api/admin/prompt/config` returns the draft, current active-version
  summary, and version summaries.
- `PUT /api/admin/prompt/config` validates and atomically replaces the whole
  draft.
- `POST /api/admin/prompt/aggregate` generates and persists one preview version.
- `GET /api/admin/prompt/versions/{version_id}` returns a version's immutable
  snapshot and preview.
- `POST /api/admin/prompt/versions/{version_id}/activate` atomically activates
  an existing valid version.

Authentication failures return `401`. Validation errors return `422` with
specific Chinese field-level messages. Missing versions return `404`. Corrupt
persisted state is surfaced as an explicit server error and logged without
including secret tokens or full private prompt contents.

## Admin User Interface

`/admin` gains two top-level tabs: “运行监控” and “Prompt 管理”. They share the
same session-scoped bearer token.

The Prompt tab provides:

- active-version metadata and a view action;
- ordered fixed-module editors with enable controls;
- temperature, capacities, and prompt-limit fields;
- style rows supporting add, edit, delete, enable/disable, and percentage
  editing, plus a live enabled-total indicator;
- positive and negative plain-text lists supporting add, edit, delete, and
  enable/disable;
- explicit draft save;
- aggregate action and complete preview;
- explicit activation of the previewed version;
- read-only historical versions with view and reactivate actions.

Errors appear next to the relevant section and in an operation summary. The UI
does not silently normalize invalid probabilities. Potentially destructive
draft actions require direct user intent, while version history remains
recoverable.

## Runtime Data Flow

For a live combination request:

1. The service reads the active prompt version from the local prompt store.
2. Community-derived runtime examples and avoidance values are selected using
   limits from that version.
3. The selected active specification is passed to the existing renderer.
4. The resulting messages are sent through the existing LLM adapter.

Draft edits and newly aggregated but inactive versions never enter this path.

## Testing

Automated coverage will verify:

- one-time bootstrap and unchanged initial prompt rendering;
- bootstrap idempotence and persistence across store reinitialization;
- authentication for every prompt-management endpoint;
- valid draft CRUD and each validation failure category;
- deterministic probability boundary selection through an injected random
  value;
- immutable aggregation snapshots and preview completeness;
- explicit activation, historical rollback, and missing-version errors;
- live combination requests reading the active version rather than the draft;
- the main Admin controls, error presentation, and API calls;
- existing Python/Makers prompt parity for the unchanged canonical static
  specification.

Before the PR is opened, the branch must pass `npm test`,
`python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`, and
`npm run build`. A deployment maintainer may additionally run
`npm run makers:build`.

## Operational Safety

- `.env`, credentials, SQLite runtime files, and generated runtime data are
  never committed.
- Prompt writes use the existing local SQLite archive rather than Makers KV.
- `ADMIN_TOKEN` is never persisted in browser storage beyond the existing
  session storage behavior and is never logged.
- The PR targets `upstream/main`, but merge occurs only after the requester
  completes manual testing and explicitly confirms it.
