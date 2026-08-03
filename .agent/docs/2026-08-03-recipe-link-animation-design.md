# Recipe Link Animation Design

## Goal

Show the known recipe relationships between elements currently placed on the
crafting canvas. The relationship network should stay visually quiet until the
player explores it by hovering an element.

The first version does not introduce manual links or connect ingredients to a
result node. A line means only that the two endpoint element names form a recipe
already present in the player's recipe book.

## Existing Context

The frontend already has an SVG relationship layer in `frontend/recipe-links.js`
and styles in `frontend/recipe-links.css`. `frontend/app.js` synchronizes this
layer with canvas element positions and the locally stored recipe book. Each
stored recipe includes its global `hit_count`.

Anime.js 4.5.0 is already vendored and loaded before the recipe-link module. The
implementation will use Anime.js SVG drawable utilities, following the official
`svg.createDrawable()` line-drawing pattern:

<https://animejs.com/documentation/svg/createdrawable/>

## Relationship Rules

- Create a link only when both ingredient names of a known recipe are present
  on the canvas.
- A recipe between two different names links every matching on-canvas instance
  pair.
- A same-name recipe links each unique pair of matching instances and never
  links an instance to itself.
- Moving an endpoint updates the curve continuously.
- Removing an endpoint or recipe removes its obsolete links and associated
  animation state.
- Links remain decorative: they do not receive pointer events and do not change
  crafting behavior.

## Visual Encoding

All relationship lines use one neutral accent color. Color does not encode
recipe depth, rarity, or global popularity in this version.

Global `hit_count` is expressed through line width, highlighted opacity, glow,
and drawing speed. The values use bounded tiers so a globally popular recipe
cannot dominate the canvas indefinitely:

| Global combinations | Highlight width | Highlight strength | Draw speed |
| --- | --- | --- | --- |
| 1–2 | thinnest | weakest | slowest |
| 3–7 | thin | soft | slow |
| 8–19 | medium | medium | medium |
| 20–39 | thick | strong | fast |
| 40+ | thickest, capped | strongest, capped | fastest, capped |

Exact CSS values may be tuned during visual verification, but ordering,
thresholds, and caps are part of the behavior contract.

## Interaction States

### Resting

All valid relationship curves are visible at a very low, uniform baseline
opacity. They are static: no path drawing, dash movement, or looping animation
runs while no canvas element is hovered. Popular recipes can remain slightly
thicker, but the resting network must read as background texture rather than
foreground content.

### Hovering an Element

Pointer entry on an on-canvas element activates every relationship incident to
that exact element instance:

- related curves transition to their `hit_count`-derived width, opacity, and
  glow;
- unrelated curves become even fainter;
- each related curve plays a one-shot Anime.js SVG drawing animation;
- the drawing direction begins at the hovered endpoint and travels toward the
  related endpoint.

The persistent base stroke remains available underneath the animated stroke so
the relationship stays readable after the one-shot drawing completes.

### Leaving an Element

Pointer leave immediately ends the active state, then visual properties ease
back over roughly 400–600 milliseconds:

- highlighted opacity and glow fade down;
- emphasized width returns to its resting value;
- the drawable overlay fades away;
- unrelated curves return to the resting baseline.

The curves themselves remain present as faint static relationships. They do not
snap off or run a reverse drawing animation.

### Rapid Hover Changes

Entering a new element cancels animation ownership for the previous element.
The link layer transitions from its current rendered values to the new state
without resetting every path to a visibly empty frame. No orphaned Anime.js
instances or stale inline styles remain after repeated hover changes.

### Dragging

Dragging an element continues to update link geometry. Geometry changes do not
restart the drawing animation. Existing pointer/drag behavior remains the
source of truth if hover events overlap with a drag.

## Architecture

`frontend/recipe-links.js` remains the isolated controller for relationship
calculation, SVG nodes, geometry, hover activation, and animation lifecycle.
The public controller API remains compatible with `app.js`:

- `sync({ recipes, elements })`
- `scheduleGeometryUpdate(elements)`
- `clear()`
- `destroy()`

The controller attaches delegated pointer listeners to the workspace so newly
spawned elements work without per-element wiring. It resolves the nearest
`.element.on-canvas[data-id]` and activates edges whose stored endpoint ID
matches that element.

Each relationship group contains:

- a very faint static base path;
- an emphasis path used for highlighted appearance;
- a drawable path controlled by Anime.js for the one-shot reveal.

The controller obtains Anime.js from the existing `window.anime` bundle. If
Anime.js or its SVG drawable API is unavailable, hover highlighting and CSS
transitions still work; only the line-drawing effect is skipped.

`frontend/recipe-links.css` owns the neutral color and state transitions.
JavaScript owns relationship identity, animation start/cancellation, endpoint
direction, and the numeric strength variables derived from `hit_count`.

## Motion Accessibility

When `prefers-reduced-motion: reduce` matches:

- do not start Anime.js drawing animations;
- do not run any looping line motion;
- show the related/unrelated distinction through restrained static opacity and
  width changes;
- keep fade duration short enough that the interface remains responsive.

## Failure Handling

- Invalid recipe entries, missing endpoint coordinates, and missing DOM
  elements are ignored without breaking the canvas.
- Missing Anime.js support degrades to static hover highlighting.
- Destroying the controller cancels scheduled geometry work, removes event
  listeners, cancels owned animations, and removes the SVG layer.
- Clearing links cancels animation state for removed paths.

## Verification

Automated coverage will verify:

- known recipes create links and unknown pairs do not;
- duplicate and same-name instances generate the correct unique edges;
- all paths are static and very faint at rest;
- hovering an endpoint activates only incident edges;
- activation invokes the Anime.js drawable animation in the correct endpoint
  direction;
- pointer leave returns all links to the resting state through transition
  classes;
- rapid hover changes and link removal cancel stale animation state;
- missing Anime.js and reduced-motion mode preserve usable static behavior;
- movement updates path geometry without replaying the draw animation;
- `clear()` and `destroy()` clean up paths, listeners, frames, and animations.

Before merge, run the repository-required checks:

1. `npm test`
2. `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`
3. `npm run build`

The deployment maintainer separately runs `npm run makers:build`.

## Out of Scope

- Manually creating or deleting links.
- Connecting ingredient nodes to result nodes.
- Using color to encode rarity, depth, or popularity.
- Persisting canvas layout or hover state.
- Displaying a numeric global-count tooltip.
- Changing combination rules or API contracts.
