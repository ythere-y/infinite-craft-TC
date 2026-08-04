# Homepage Guidance Design

## Context

A recent mobile-layout merge restored the nine-step “滨海大厦” example and
desktop double-click instructions to the guidance that is visible by default in
the homepage workspace. The homepage should remain immediately understandable,
while the existing question-mark button should expose the complete operating
guide on demand.

## Desired Behavior

- The default workspace guidance contains only the simplest drag-and-combine
  instruction.
- Desktop guidance refers to elements on the right; mobile guidance refers to
  elements below.
- Clicking the question-mark guidance button expands the advanced guidance.
- Clicking the button again collapses the advanced guidance.
- The advanced guidance contains:
  - desktop double-click shortcuts;
  - recipe-book drag and double-click behavior where applicable;
  - the keyboard sequence;
  - the nine-step “滨海大厦” example.
- Advanced guidance is hidden on initial page load.
- The button exposes its expanded state through `aria-expanded`.

## Implementation Shape

Keep the current workspace guidance instead of introducing a new modal or side
panel. Split its markup into an always-visible basic section and a hidden
advanced section. The existing question-mark button toggles only the advanced
section and updates its accessible state.

The case-specific styles remain because the example is retained inside advanced
guidance. Responsive rules continue to select the correct desktop or mobile
instructions.

## Testing

Update the frontend contract tests before implementation so they require:

- a simple default guidance section;
- an advanced section that is initially hidden;
- the “滨海大厦” example inside the advanced section;
- double-click text only inside the advanced section;
- a guidance button with a collapsed initial state;
- JavaScript that toggles the advanced section and synchronizes
  `aria-expanded`.

Retain the existing browser-level check that mouse double-click duplication
still works; only its visibility in the default guidance changes.

After implementation, run the repository-required verification commands:
`npm test`, `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`,
and `npm run build`.

## Scope

This change does not alter drag, drop, double-click, recipe-book, combination,
or casino-mode behavior. It changes only the presentation and toggling of
homepage guidance plus the tests that guard that presentation.
