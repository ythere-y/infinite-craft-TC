# AI Agent Documents

This tracked directory stores documents produced as part of AI-assisted
engineering work. It is project history for agents and reviewers, not end-user
product documentation.

## Location and naming

Store AI-created designs, implementation plans, research notes, improvement
proposals and process documents in `.agent/docs/`.

Every filename must use:

```text
YYYY-MM-DD-<topic>-<type>.md
```

Use the document's actual creation date and a lowercase, hyphen-separated
English topic. Supported type suffixes are:

- `-design.md`
- `-implementation-plan.md`
- `-improvement.md`

Examples:

```text
2026-08-03-root-directory-cleanup-design.md
2026-08-03-root-directory-cleanup-implementation-plan.md
2026-07-21-emoji-matching-improvement.md
```

## Documentation boundary

Keep durable documentation written for users and developers in `docs/`.
Current formal exceptions include:

- `docs/makers-development.md`
- `docs/icon-system-audit.md`
- `docs/imgs/`

Do not create AI process documents in `docs/`, the repository root or
`docs/superpowers/`.

## `.agent` versus `.agents`

- `.agent/` is project-owned, tracked and reviewed.
- `.agents/` is platform-managed cache state and remains ignored.

Never move platform cache files from `.agents/` into this directory.
