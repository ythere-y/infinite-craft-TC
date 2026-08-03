# Unified Close Buttons Design

## Problem

The shared close action is generated from Phosphor's duotone `x` asset. That
variant includes a translucent square behind the cross, so it resembles a
failed-image placeholder when rendered inside the application's existing
button well.

The recipe book already wraps that icon in the preferred 30 px gray rounded
button. The score history panel instead uses a 25 px red circular "traffic
light", so the two panel close controls do not share one visual language.

## Approved behavior

- Use the selected lightweight plain cross with no inner square backdrop.
- Give the recipe book and score history panel the same 30 px gray rounded
  close-button appearance.
- Preserve each control's current ID, Chinese accessible label, title, and
  click behavior.
- Preserve hover, keyboard focus, and midnight-mode treatments.
- Do not change close controls on unrelated pages in this task.

## Implementation

Generate only the `x` action asset from Phosphor's regular variant while
continuing to generate all other action assets from their current duotone
variants. Regenerating the committed assets keeps the checked-in `x.svg` and
icon metadata consistent with the generator.

Introduce a shared `panel-close-button` class for the visual button contract.
The recipe book retains a recipe-specific positioning class because its button
is absolutely positioned in the drawer header. The score history button sits
directly in its flex header and uses the shared class without the old
traffic-light wrapper or red-circle classes.

The shared class owns dimensions, border, background, icon centering, hover,
focus, and midnight-mode rules. Existing IDs continue to receive the existing
event listeners, so no JavaScript behavior changes are required.

## Verification

Extend the real-browser UI test to render both panel controls, compare their
computed dimensions and visual properties, exercise both click handlers, and
sample the rendered SVG away from the cross strokes to prove the old
translucent square is gone. Run the focused browser test first, then the
repository's required `npm test`, Python test suite (excluding
`test_combine_feedback.py`), and production build.

## Non-goals

- Redesigning other action icons.
- Changing the shared action renderer or its accessible-name behavior.
- Refactoring panel layout or close interactions beyond the two approved
  controls.
