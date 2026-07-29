# Combine Impact Rarity Design

## Goal

Make the circular impact wave communicate combination difficulty without
competing with the existing personal-discovery and global-first effects.

## Rarity Mapping

The API `depth` value is the combination level and maps to five equipment-style
rarities:

| Depth | Rarity | Color | Relative radius |
| --- | --- | --- | --- |
| 1-2 | Common | neutral gray | 1.00 |
| 3-4 | Uncommon | green | 1.18 |
| 5-6 | Rare | blue | 1.38 |
| 7-9 | Epic | purple | 1.62 |
| 10+ | Legendary | gold | 1.90 |

Each rarity uses one semantic color for the ring, outer echo, and glow. Higher
rarities expand farther but keep the same animation duration so feedback stays
responsive.

## Discovery Brightness

`global_new` and `global_known` are both discoveries and therefore use the same
high-brightness ring treatment. `seen` is a repeated recipe and uses reduced
opacity, glow, and saturation. Global-first differentiation remains owned by
the existing celebration particles and discovery stamp.

## Data Flow

`app.js` already receives `resp.depth` and computes the result tier. It will
settle the pending combine effect with both values:

```js
combineEffect.finish({ depth: resp.depth, discovered: tier !== "seen" });
```

`effects.js` will normalize missing or invalid depth to the common tier, resolve
one immutable rarity profile, and set CSS custom properties on the impact node.
CSS remains responsible for drawing and animating the two concentric rings.

## Accessibility And Failure Handling

- `prefers-reduced-motion: reduce` continues to suppress the impact entirely.
- Missing depth degrades to the smallest common wave.
- The effect remains decorative and `aria-hidden`.
- No new dependency, canvas, image, or network request is introduced.

## Verification

- Unit/runtime tests cover all five depth boundaries.
- Tests assert discoveries share the brighter treatment while repeated recipes
  use the dim treatment.
- Browser validation checks ring color, final scale variables, cleanup, and
  desktop/mobile framing without JavaScript exceptions.
