# Compact Element Label Layout Design

**Date:** 2026-07-28  
**Status:** Approved for implementation

## Goal

Fix three regressions without undoing the approved compact three-column
icon system:

1. every discovered element name in the sidebar repository remains readable;
2. the successful-combination toast keeps a visible gap between its sticker
   and result name;
3. AI-generated recipes show their persisted synthesis comment as secondary
   text in the element recipe modal.

## Root Causes

The 320px sidebar divides its content into three columns of roughly 96px.
Each chip still reserves 27px for the sticker, uses 14px non-wrapping text and
hides overflow. Most names therefore have less than 50px of usable text width
and are clipped.

The toast declares a gap on `.first-toast-result`, but the sticker and name are
both children of the nested `.first-toast-icon` target. That target has no flex
layout or gap, so the declared outer gap does not separate the two visible
items.

AI comments are present in SQLite and Makers KV recipe records, but both recipe
detail projections omit the field. The wall additionally reads comments only
from a matching currently-open community formula, so opening an element card
directly cannot display the archived recipe comment.

## Approved Layout

### Sidebar repository

- Retain the three-column grid.
- Use a sidebar-only 22px sticker.
- Use 12px names with a compact line height and normal wrapping.
- Allow names to occupy up to two lines in a standard one-column chip.
- Reduce chip padding and sticker/name gap only as needed to preserve a usable
  pointer target.
- After a chip is in the document, measure its actual rendered name line
  fragments. If it needs more than two lines, mark the chip as wide and let it
  span two grid columns. If it still exceeds two lines, span all three columns.
- Re-run the fit decision whenever the sidebar is rendered. Filtering, newly
  discovered elements and Ura/Boss visual modes must not leave stale width
  classes.
- Do not use ellipsis, line clamping or hidden overflow to conceal any part of
  a name.
- Keep the existing minimum 41px pointer target; wrapped or wide chips may grow
  taller but must not become harder to drag or double-tap.

The measurement must use rendered geometry rather than a fixed character-count
heuristic, so mixed Chinese, ASCII and punctuation names behave consistently
with the active font.

### Successful-combination toast

- Keep the approved 40px detail sticker.
- Make `.first-toast-icon` an explicit flex container.
- Keep the sticker non-shrinking and provide at least 12px between it and the
  result name.
- Let the name take the remaining width and wrap when needed.
- Preserve the existing safe text-node renderer, discovery-state decoration,
  comment, publish action and mobile positioning.

### Recipe comments

- Include the persisted `comment` in FastAPI and Makers
  `/api/element/{name}/recipes` rows.
- Keep seed recipes with an empty comment empty; do not synthesize fallback
  prose for them.
- In the wall recipe modal, prefer the row's own non-empty comment. Fall back to
  a matching open community formula only for legacy responses that omit it.
- Render a `.recipe-comment` node only when the selected comment is non-empty.
- Continue using `textContent`; comments must never be interpolated as HTML.
- Keep the existing 12px secondary-text styling and do not add an empty row
  beneath preset recipes.

## Implementation Boundaries

Expected production changes are limited to the sidebar render/layout code,
shared icon sizing/layout CSS, the main page asset cache version, recipe-detail
read projections and the wall modal's comment selection. No icon mapping,
asset, persistence schema or database write behavior changes are required.

The running Docker Compose service mounts `frontend/`, so the verified frontend
change should become available through the existing service without deleting
Redis or SQLite data.

## Verification

Add real Chromium regressions before production changes:

1. At the production sidebar width, representative two-, four-, six- and
   eight-character Chinese names plus long ASCII/mixed names have no clipped
   text.
2. Standard names remain one-column chips and use at most two rendered lines.
3. Deliberately long fixtures progressively span two and then three columns,
   displaying their complete names in at most two rendered lines.
4. Sidebar stickers measure 22px and chip pointer targets remain usable.
5. In the successful-combination toast, sticker and name rectangles have at
   least 12px separation and never overlap at desktop or narrow mobile widths.
6. A persisted LLM recipe comment survives SQLite/KV reads and both API
   projections, then appears exactly once below its matching modal row.
7. A seed recipe with no comment renders no `.recipe-comment` node.
8. Existing icon fallback, state, Boss geometry and safe-rendering tests remain
   green.

After the focused RED/GREEN cycle, run the full Node suite, full Python suite
with Chromium, the production build, and an HTTP smoke check against the
reloaded service.
