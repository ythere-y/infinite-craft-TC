# Midnight Toast and Hint Cleanup Design

## Goal

Make the global-first discovery toast visually belong to the midnight inner
mode, while simplifying the empty-workspace guidance.

## Approved Behavior

- When `body.ura-on` is active, the complete first-discovery toast uses a
  midnight palette. This includes the container, title, result name, comment,
  action divider, publish button, disabled button, and published state.
- The global-first tier keeps its gold identity inside the dark palette.
- The global-known tier keeps its teal identity inside the dark palette.
- Remove the complete nine-step “案例展示” block from the homepage markup.
- Remove homepage guidance that mentions double-clicking.
- Preserve all sidebar, canvas, and recipe-book double-click interactions.

## Implementation

Use contextual CSS selectors under `body.ura-on` instead of changing toast
rendering or adding JavaScript theme state. Remove the unwanted guidance
markup directly from `frontend/index.html`; do not merely hide it.

## Verification

- A browser test renders a real global-first toast in inner mode and verifies
  that its background, text, comment, divider, and publish button differ from
  the light theme and remain visible.
- A homepage contract test verifies the rendered guidance has no case study
  and no double-click copy while the application still retains the real
  double-click bindings.
- Run the project’s required JavaScript tests, Python tests, and production
  build.
