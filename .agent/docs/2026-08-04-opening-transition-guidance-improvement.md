# Opening Transition and Canvas Guidance Improvement

**Date:** 2026-08-04

## Goal

Remove the perceived pause between opening absorption and the playable game,
then replace the verbose empty-canvas instruction with a subdued visual
formula:

`[ → 拖拽！ ] + [ ✦ 合成！ ] = [ ∞ 创新！ ]`

The formula should resemble the game's element language without being
mistaken for draggable elements. It acts as a large, quiet desktop background
board rather than foreground UI.

## Transition Design

The current finale serializes two phases: every token animation finishes
before the real interface starts revealing. The combined delay feels like a
stall even when the browser has no long JavaScript task.

Replace that sequence with one overlapping 520 ms timeline:

1. At 0 ms, stop emission, the motion loop, and looping Anime.js effects.
2. From 0–360 ms, absorb formal element tokens into the infinity core.
3. From 0–280 ms, contract and fade the fragment layer as one composited
   group instead of starting a separate animation for every fragment.
4. At 160 ms, begin fading the opening surface and reveal the real topbar,
   sidebar, and canvas guidance underneath it.
5. At 520 ms, remove the opening stage and restore workspace focus.

Only `transform` and `opacity` animate during the finale. The sequence uses
one fixed completion deadline rather than awaiting every individual Web
Animation promise. Reduced-motion and missing-Anime modes use a 180 ms
crossfade with no token absorption.

## Canvas Guidance Design

### Composition

The basic guidance becomes a single semantic formula:

- Drag board: arrow icon plus `拖拽！`
- External operator: `+`
- Combine board: sparkle/collision icon plus `合成！`
- External operator: `=`
- Innovation board: the opening's infinity SVG plus `创新！`

The combine board must not use an equals icon because the formula already
uses a separate equals operator. The innovation board reuses the same
infinity path as the opening so the opening and playable canvas share one
visual motif.

### Background-board treatment

Each board borrows the rounded rectangular silhouette, inset highlight, and
slight rotation of a production element card, but is deliberately distinct:

- approximately 1.5–1.8 times the footprint of a normal canvas element;
- grayscale or near-grayscale surfaces;
- 30–42% overall visual opacity;
- low-contrast borders and soft, broad shadows;
- no production element state badge;
- no hover, pointer, drag, or selection behavior;
- placed behind all real canvas elements;
- large keyword typography with the icon acting as a watermark/accent.

The `+` and `=` operators remain slightly darker than the boards so the
formula reads immediately, while the whole composition remains quieter than
real elements.

### Responsive behavior

Desktop keeps the formula on one centered line. Narrow screens reduce board
width, icon scale, and gaps while preserving the one-line equation. At very
small widths, text stays readable and operators remain visible; boards do not
wrap into a misleading multi-step layout.

The formula disappears with the existing `.hint.hide` behavior once the
player places elements. The advanced help, example recipe, credit, and help
button behavior remain unchanged.

## Accessibility and Performance

- The visible words remain real text, not text inside SVG.
- Decorative icons and operators are hidden from assistive technology where
  the adjacent accessible sentence already expresses the formula.
- A concise accessible label describes: “拖拽元素，加以合成，创造新元素。”
- No continuous animation is added to the empty-canvas guidance.
- The guidance uses no blur or backdrop filter.
- Finale animations remain bounded and composited.

## Verification

- Add a transition regression test that locks the overlapping reveal timing
  and prevents returning to a serialized per-node wait.
- Extend frontend tests to assert the three board roles, separate `+` and `=`
  operators, non-equals combine icon, and infinity innovation mark.
- Browser-check first-time and returning-player completion at desktop and
  mobile widths.
- Confirm the stage is removed by 520 ms in live mode and by 180 ms in static
  mode.
- Confirm the guidance is behind real canvas elements and disappears when
  the existing hint-hide condition is activated.
- Run the repository-required Node tests, Python tests, and production build.
