# Recipe Link Synchronized Breathing Design

## Goal

Extend the existing known-recipe hover effect so highlighted relationship
lines remain visibly alive after their one-shot Anime.js drawing completes.
Only links incident to the currently hovered canvas element breathe, and they
breathe in exact synchronization.

This is an incremental design for
`2026-08-03-recipe-link-animation-design.md`. All existing relationship,
popularity, hover, fade, cleanup, and accessibility rules remain in force
unless this document explicitly changes them.

## User Experience

### Resting

When no canvas element is hovered, every known-recipe line remains extremely
faint and static. No drawing or breathing animation runs.

### Drawing

When a canvas element is hovered, every incident relationship line performs
the existing one-shot path drawing from the hovered endpoint toward the
related endpoint. Line width, base brightness, and glow continue to reflect
the recipe's bounded global `hit_count` profile.

### Breathing

After every incident line in the current hover group has finished drawing, the
entire group begins one synchronized breathing animation:

- all active relationship groups share one Anime.js animation instance;
- group opacity alternates smoothly between `0.72` and `1`;
- one low-to-high-to-low breathing cycle lasts approximately `1400ms`;
- the animation loops while the same exact canvas element remains hovered;
- the animation uses a soft sine-like in/out easing;
- the lines never disappear at the low point;
- breathing multiplies each link's existing appearance, preserving differences
  caused by global combination count;
- stroke width does not pulse.

Animating each relationship `<g>` opacity, rather than each path's absolute
opacity, keeps the active base, emphasis, draw, and glow layers visually
coherent while preserving their per-link CSS variables.

### Leaving and Switching

Pointer leave immediately cancels the active breathing animation. Existing CSS
transitions then return active lines to the faint resting network over `520ms`.
There is no reverse drawing animation.

Switching directly from one element to another:

1. cancels the previous group's drawing and breathing ownership;
2. restores any inline group opacity left by Anime.js;
3. starts drawing the new element's incident links;
4. begins a new synchronized breathing group only after the new draw group
   completes.

No old completion callback may start breathing after hover ownership has moved
elsewhere.

## Animation Coordination

The relationship controller owns two kinds of animation:

- each edge may own one finite draw animation;
- the controller may own one infinite group breathing animation.

Each hover activation receives a monotonically increasing generation token.
Every draw completion callback captures that token. A callback contributes to
the completion barrier only when:

- the controller is not destroyed;
- the captured generation is still current;
- the captured element ID is still the active element;
- the edge still exists and remains incident to the active element.

The controller counts the draw animations started for the current group. When
all of them have completed successfully, it calls Anime.js once with the
current active relationship group nodes:

```javascript
anime.animate(activeGroups, {
  opacity: [0.72, 1],
  duration: 700,
  ease: "inOutSine",
  loop: true,
  alternate: true,
});
```

Anime.js defines `loop: true` as an infinite loop and `alternate: true` as
reversing direction on successive iterations. `onComplete` remains the
completion signal for each finite draw animation:

- <https://animejs.com/documentation/animation/animation-playback-settings/loop/>
- <https://animejs.com/documentation/animation/animation-playback-settings/alternate/>
- <https://animejs.com/documentation/animation/animation-callbacks/oncomplete/>

The `700ms` animation duration is one half-cycle, producing a full
low-to-high-to-low period of approximately `1400ms`.

## Cancellation and Cleanup

A single `cancelBreathing()` controller helper:

- calls `cancel()` on the current breathing animation when available;
- clears the stored animation handle;
- removes Anime.js-owned inline opacity from every group that participated in
  the canceled breathing animation.

It runs before every new hover activation and from `sync()`, `clear()`, and
`destroy()` whenever active edges or hover ownership become invalid.

`sync()` does not restart drawing or breathing for geometry-only updates. If a
recipe snapshot refresh preserves the active element and all active edges, the
current breathing animation continues. If the active set changes, the
controller cancels breathing and begins a new draw/breath sequence only in
response to a new genuine pointer activation; data synchronization alone does
not manufacture a hover animation.

## Fallback and Accessibility

When Anime.js or `svg.createDrawable()` is unavailable, active links retain the
existing static CSS highlight. No breathing animation runs.

When `prefers-reduced-motion: reduce` matches:

- drawing remains disabled;
- breathing remains disabled;
- active links retain their visible static emphasis;
- the existing `120ms` reduced-motion transition remains unchanged.

## Interfaces and Files

The public `RECIPE_LINKS` controller API remains unchanged:

- `sync({ recipes, elements })`
- `scheduleGeometryUpdate(elements)`
- `clear()`
- `destroy()`

Implementation changes stay inside:

- `frontend/recipe-links.js` for completion barriers, generation ownership,
  grouped Anime.js breathing, and cleanup;
- `tests/test_combine_feedback.py` for browser-observable lifecycle coverage.

No backend, recipe schema, CSS color, asset version, or dependency change is
required. `frontend/recipe-links.css` changes only if a small defensive reset
rule is needed after browser verification.

## Verification

Behavioral browser tests cover:

- breathing does not start before the last draw completes;
- all active relationship groups are passed to one Anime.js call;
- the breathing call uses opacity `[0.72, 1]`, `duration: 700`,
  `loop: true`, and `alternate: true`;
- unrelated groups never participate;
- pointer leave cancels breathing and clears inline group opacity;
- rapid hover switching prevents stale draw completions from starting the old
  pulse;
- geometry updates do not restart draw or breathing;
- removal, `clear()`, and `destroy()` cancel the breathing owner;
- missing Anime.js and reduced-motion mode preserve static active emphasis
  without drawing or breathing.

Repository verification remains:

1. `npm test`
2. `python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q`
3. focused recipe-link browser tests
4. `npm run build`

The deployment maintainer separately runs `npm run makers:build`.

## Out of Scope

- Breathing the faint resting network.
- Moving dots, traveling dashes, gradients, or particle packets.
- Pulsing stroke width.
- Giving each link an independent breathing phase or speed.
- Persisting breathing state.
- Changing production deployment automation.
