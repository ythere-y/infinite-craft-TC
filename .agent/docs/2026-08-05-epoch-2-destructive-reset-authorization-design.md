# Epoch 2 Destructive Reset Authorization Design

## Context

Infinity Craft production currently uses the Makers `test → infinite_craft`
KV binding. All data in that namespace is test data, there are no real users,
and the Epoch 2 rollout may delete it in full.

The existing Epoch 2 initializer already performs a resumable namespace-wide
purge, but it treats every missing, malformed, or different-epoch content state
as authorization to purge. That makes the intended Epoch 2 test reset easy, but
also allows a future epoch bump or damaged state record to trigger another
destructive reset without an explicit product decision.

This design keeps the convenient full reset for Epoch 2 while making every
destructive epoch transition an explicit, version-controlled authorization.

## Goals

- Delete all current test runtime data during the approved Epoch 2 transition.
- Allow automatic Makers deployment without a temporary console environment
  variable or manual migration command.
- Require a target catalog to name every source epoch it may destructively
  replace.
- Treat unversioned legacy data as a distinct, explicitly authorized source.
- Fail before any deletion when a destructive transition is not authorized.
- Prevent a completed Epoch 2 reset from being replayed if the primary content
  state is later lost.
- Preserve the existing resumable purge, catalog seeding, index rebuilding,
  verification, readiness gating, and same-epoch differential migration.

## Non-goals

- Preserving or transforming Epoch 1 player progress.
- Backing up or restoring the current test namespace.
- Archiving old formulas, discoveries, votes, nicknames, KPI, or audit records.
- Adding a general-purpose migration framework for arbitrary application data.
- Changing scoring, vote consistency, browser testing, or unrelated product
  behavior.

## Considered Approaches

### 1. Catalog-declared destructive transitions

The target catalog declares the exact source epochs that may be purged. The
authorization is validated at build time and shipped to both runtimes.

This is the selected approach because it is automatic, reviewable in the same
PR as the content epoch, testable without external infrastructure, and fails
closed for undeclared future transitions.

### 2. Makers environment-variable authorization

An environment variable such as `ALLOW_DESTRUCTIVE_RESET_TO=2` could authorize
the rollout. This is simpler in code, but adds a manual control-plane step to
an otherwise automatic deployment and can be forgotten or left enabled.

### 3. Unconditional reset on every epoch mismatch

This is the current behavior. It is convenient for Epoch 2 but does not require
an explicit decision for later destructive migrations and is therefore
rejected.

## Catalog Contract

The editable content catalog gains a field under `meta`:

```json
{
  "content_epoch": 2,
  "destructive_reset_from": ["legacy", 1]
}
```

The compiler and runtime loaders enforce these rules:

- The field is a non-empty array when destructive transitions are intended.
- Each entry is either the exact string `"legacy"` or a positive safe integer.
- Integer entries must be lower than `content_epoch`.
- Entries must be unique.
- Unknown strings, booleans, numeric strings, fractions, duplicate entries,
  the target epoch, and future epochs are rejected.
- Generated Python JSON and Makers JavaScript artifacts expose the canonical
  ordered authorization list.

`"legacy"` means a namespace or local archive that contains runtime/gameplay
data but has no content state record and no reset receipt proving that the
target epoch was already installed. It is not a wildcard for a present but
malformed state record.

Epoch 2 authorizes only `"legacy"` and epoch `1`. A future Epoch 3 catalog must
make a new explicit decision, for example `[2]`; otherwise it cannot purge
Epoch 2 data.

## Data Policy

The approved Epoch 2 destructive transition removes all existing test runtime
data, including:

- combinations, elements, recipes, depths, indexes, and snapshots;
- first discoveries and feed records;
- nicknames, sessions, KPI, activity, rate-limit, analytics, and statistics;
- community formulas, versions, reproductions, votes, result reactions,
  moderation audit records, and community indexes.

Only migration control metadata is protected during the purge:

- `system_content_state`;
- `system_content_reset_receipt_<target_epoch>` records.

After the purge, the initializer seeds the complete Epoch 2 fixed catalog,
rebuilds indexes, verifies exact catalog ownership and fields, and marks the
content ready. No test runtime data is copied forward.

## Makers Reset Receipt

Makers stores a durable receipt at:

```text
system_content_reset_receipt_2
```

The JSON record contains:

```json
{
  "target_epoch": 2,
  "source_epoch": "legacy",
  "catalog_digest": "sha256:...",
  "status": "in_progress",
  "started_at": 0,
  "completed_at": null
}
```

`source_epoch` may instead be an authorized integer. The receipt lifecycle is:

1. Resolve and validate the source transition without writing or deleting.
2. Write an `in_progress` receipt before the first destructive operation.
3. Run the existing resumable purge and initialization phases.
4. After exact catalog verification succeeds, mark the receipt `completed`.
5. Mark `system_content_state` ready.

Receipt writes are idempotent. An existing receipt must match the target epoch,
source epoch, and reset intent. Conflicting or malformed receipts fail closed.

The namespace-wide purge excludes all reset receipt keys. This provides:

- safe resume when the primary state is lost after an `in_progress` receipt;
- proof that an already completed Epoch 2 install must not be treated as
  unversioned legacy data;
- an audit record for later migration decisions.

If a completed current-epoch receipt exists but the primary state is missing,
the initializer performs non-destructive catalog recovery and reconstructs
readiness. It does not purge runtime data again.

## Transition Decision Matrix

| Observed state | Decision |
| --- | --- |
| Empty namespace/archive | Bootstrap without destructive authorization |
| Runtime data, no valid state, no receipt | Source is `legacy`; purge only if explicitly authorized |
| Valid lower epoch | Purge only if that exact integer is authorized |
| Matching epoch and digest, ready | No-op/reconcile as today |
| Matching epoch, different digest | Existing non-destructive differential migration |
| Matching target, `in_progress` receipt | Resume the same destructive reset |
| Matching target, `completed` receipt, missing state | Non-destructive recovery; never replay purge |
| Malformed state without a matching receipt | Fail closed with zero deletions |
| Higher stored epoch | Fail closed; an older build never regresses it |
| Lower epoch not in authorization list | Fail closed with zero deletions |

The decision is resolved before writing `migrating` state or a receipt. An
unauthorized transition cannot partially initialize or delete data.

## Local Runtime

Local development remains isolated from Makers and contains disposable
developer data. It consumes the same generated authorization list:

- an empty SQLite/Redis environment bootstraps;
- existing unversioned gameplay data maps to `"legacy"`;
- a valid lower epoch maps to its integer epoch;
- an authorized source performs the existing SQLite gameplay-table reset and
  Redis logical-database reset;
- malformed, higher, or unauthorized states fail before either store changes;
- same-epoch digest changes remain differential.

The Makers reset receipt is not required locally because local state is
disposable, SQLite `content_state` is outside the reset table list, and local
development never points at production storage.

## Errors and Health

Unauthorized transitions use the stable code:

```text
CONTENT_RESET_NOT_AUTHORIZED
```

Makers behavior:

- `/api/health` remains available;
- health reports the target epoch/digest, a non-ready status, a bounded
  sanitized error, and the stable code;
- gameplay and mutation APIs remain gated with HTTP 503;
- no catalog, runtime, receipt, or index records are deleted.

Malformed or conflicting reset receipts use a separate stable code:

```text
CONTENT_RESET_RECEIPT_INVALID
```

Local startup reports the same authorization failure before deleting SQLite or
Redis data. It does not need to keep the HTTP application available when local
startup cannot establish a safe content state.

## Testing

### Catalog and artifact tests

- Accept `["legacy", 1]` for Epoch 2.
- Reject invalid strings, numeric strings, zero, negative values, fractions,
  duplicate entries, Epoch 2 itself, and future epochs.
- Prove the Python and Makers generated artifacts carry the same canonical
  authorization.

### Makers initializer tests

- Empty KV bootstraps without a destructive receipt.
- Unversioned non-empty KV resets only when `"legacy"` is authorized.
- Epoch 1 resets only when integer `1` is authorized.
- The approved Epoch 2 transition removes representative keys from every
  runtime domain, including community and KPI data.
- An unauthorized lower epoch performs zero deletes and zero catalog writes.
- A malformed state without a matching receipt performs zero deletes.
- An `in_progress` receipt resumes safely after interruption.
- A `completed` receipt plus missing state does not replay the purge.
- A malformed or conflicting receipt fails closed.
- Receipt and primary-state write interruptions converge safely.
- Same-epoch digest changes remain differential and preserve dynamic data.
- A higher persisted epoch is never modified.

### Local migration tests

- Empty local stores bootstrap.
- Legacy and Epoch 1 gameplay data reset under the approved policy.
- Unauthorized and malformed states leave both SQLite and Redis unchanged.
- Same-epoch digest changes remain differential.
- Interrupted authorized resets remain resumable through existing state.

### Required regression suite

Before handoff:

```text
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

A deployment maintainer also runs `npm run makers:build`.

## Documentation

Implementation updates the durable Makers development guide to state:

- Epoch 2 intentionally clears all existing test data;
- destructive transitions are declared in the target catalog;
- future undeclared transitions fail before deletion;
- same-epoch catalog updates remain differential;
- reset receipts prevent replay after content-state loss.

The earlier Epoch 2 implementation plan remains as historical project context;
this design supersedes only its unconditional epoch-mismatch reset policy.
