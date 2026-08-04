# Vortex Opening Animation Design

## Summary

Every visit to the main game route (`/`) opens on a full-screen animated
synthesis scene before revealing the normal workspace. Wall, community, and
administrative routes do not show the opening. The scene uses the existing
bundled Anime.js runtime and the production element Icon system. It presents an
already-active double-braided vortex, continuously demonstrates the game's
synthesis loop, and places the player identity action in a card at the bottom
of the scene.

The identity card has two entry states:

- A first-time player receives the existing random-name selection flow and must
  confirm a name before entering the game.
- A returning player sees the current name and a large, primary
  `继续使用` action. A secondary `更改花名` action opens the existing reroll and
  confirmation flow.

Completing either path triggers a shared finale: every visible element is
absorbed into the center, the stage becomes clean, and the real game UI enters
from the viewport edges.

## Goals

- Give every game opening a distinctive, high-quality branded animation.
- Demonstrate the core “elements combine into new elements” idea before play.
- Preserve the production Icon language instead of introducing another visual
  system.
- Make the returning-player path fast and obvious.
- Reuse the current nickname APIs and local identity storage.
- Keep the animation smooth on desktop and mobile and respect reduced-motion
  preferences.

## Non-goals

- The opening does not perform a real recipe or API combination.
- It does not change the starter set, discovery state, score, or recipe history.
- It does not add new nickname endpoints or change nickname allocation rules.
- It does not replace the existing game workspace or navigation.
- It does not reproduce Anime.js website artwork or assets.

## Experience Flow

### Shared opening stage

The opening overlay is rendered on every page load and covers the game UI until
the identity action completes. The real game initializes behind it so the
finale can reveal a ready workspace without an additional loading step.

The stage begins in an already-active state:

- 18 production element tokens are distributed across different positions of
  four SVG feeder paths arranged as a double-braided vortex.
- 16 lightweight mechanical fragments add depth without competing with the
  formal element tokens.
- Tokens use the production PNG assets, palette backgrounds, white borders,
  shadows, tilt rules, and starter badge.
- Track motion is deliberately slow: a formal token takes approximately
  12–14 seconds to travel from an outer entry to the core.

The elements visible on the first frame represent output produced before the
current viewport moment. They do not animate into existence at the outer
boundary.

### Continuous synthesis loop

While the identity card is waiting for input, the center continuously emits
new tokens:

1. The core selects one of the starter elements for visual output.
2. A short birth flash creates a formal element token at the center.
3. The token follows a parabolic throw to the exact first coordinate of one of
   the feeder paths.
4. The token performs a small landing bounce and releases control from the
   throw animation.
5. The same token follows the feeder path from its outer endpoint toward the
   center without jumping or moving outward first.
6. At the end of the path, the token contracts and is absorbed into the
   synthesis core.

New output is emitted every 720 ms during the normal-motion presentation. Each
output carries two small mechanical fragments. Formal elements never originate
at the edge.

### Infinite-symbol treatment

The center uses one authored SVG infinity path with layered presentations:

- Anime.js `svg.createDrawable()` draws, partially erases, and redraws the main
  path.
- A dashed energy pulse travels around the completed shape.
- A quieter secondary drawable segment creates local moving detail.
- Surrounding calibration rings rotate more slowly than the feeder tokens.

The infinity symbol remains readable throughout. Effects must not cover the
nickname card or reduce production Icon legibility.

### First-time identity card

The first-time branch is selected when `ic_nick` is absent.

The card retains the current behavior:

- Fetch a candidate from `GET /api/nickname/peek`.
- Show the candidate using text content.
- Allow repeated rerolls.
- Confirm through `POST /api/nickname/claim`.
- If the candidate was claimed by another player, display the replacement and
  require confirmation again.
- Persist the accepted name and generated local player ID.

There is no continue-without-a-name action for a first-time player.

### Returning-player identity card

The returning branch is selected when `ic_nick` exists.

The default card shows:

- A welcome-back title.
- The current nickname as the primary identity.
- A large, visually dominant `继续使用` button.
- A smaller secondary `更改花名` button.

`继续使用` keeps the current nickname, performs the existing best-effort
nickname touch, and starts the shared finale immediately.

`更改花名` transforms the card into the existing candidate flow. The player can
reroll, cancel back to the welcome state, or confirm the replacement. Confirming
a replacement updates local storage and the topbar identity before starting the
shared finale.

### Finale and game reveal

The finale starts only from first-time confirmation, returning-player continue,
or returning-player replacement confirmation.

The sequence is:

1. Stop scheduling new outputs.
2. Disable all identity-card actions.
3. Accelerate every visible formal token and fragment into the core.
4. Collapse the infinity treatment and fade the SVG feeder paths.
5. Flash the stage to the normal workspace background.
6. Move the real topbar down from above.
7. Move the real sidebar in from the right.
8. Fade and lift the real workspace guidance into place.
9. Remove the opening overlay from the DOM and restore normal pointer input.

The finale targets the real application elements. It does not render a mock
topbar or sidebar that is later swapped for the real UI.

## Architecture

### Opening controller

Add a focused frontend module responsible for the opening lifecycle. It owns:

- stage creation and teardown;
- identity branch selection;
- token and fragment pools;
- SVG path and drawable setup;
- emission scheduling;
- the transition from throw animation to track motion;
- finale orchestration;
- reduced-motion behavior and cleanup.

The controller exposes one asynchronous entry point that resolves after the
opening has finished. The application initialization waits for that resolution
before enabling normal workspace input.

### Identity integration

Nickname storage and API operations remain in the existing application logic.
The opening controller receives callbacks for:

- reading the current nickname;
- requesting a candidate;
- claiming a candidate;
- touching the current nickname;
- persisting and displaying an accepted nickname.

This keeps animation code independent of API and storage details.

### Rendering and assets

Element token markup must be generated through the production Icon system or a
shared production-token renderer. The opening must not hardcode independent
Emoji styling or fetch external assets.

The bundled `frontend/vendor/anime.iife.min.js` remains the only animation
dependency. No CDN is used.

### Performance model

- Cache SVG path lengths and sampled coordinates once.
- Do not call `getTotalLength()`, `getPointAtLength()`, `offsetWidth`, or
  `getBoundingClientRect()` for every token on every frame.
- Update motion through composited transforms and opacity.
- Use bounded pools for tokens and fragments.
- Avoid `backdrop-filter` over the moving stage.
- Pause the stage while the page is hidden.
- Recalculate cached viewport transforms only on resize.
- Keep the normal stage within a frame budget verified on desktop and mobile.

## Reduced Motion and Resilience

When `prefers-reduced-motion: reduce` is active:

- Render a static infinity symbol and a small set of stationary production
  tokens.
- Do not run the continuous emission loop.
- Keep the same first-time and returning identity cards.
- Replace the finale with a short crossfade to the real game UI.

If Anime.js is unavailable, use the reduced-motion presentation instead of
blocking entry.

Nickname API failures retain the current offline fallbacks. An animation error
must never trap the player: the identity actions remain usable, and the
controller provides an immediate teardown fallback.

## Accessibility

- The opening overlay is a named dialog-like region while active.
- Focus begins in the identity card.
- Keyboard focus is trapped inside the card until entry.
- All actions are real buttons with visible focus styles.
- Status animation is decorative and hidden from assistive technology.
- The returning `继续使用` button is first in the focus order.
- The opening overlay is removed after the finale so it cannot intercept later
  focus or pointer events.

## Testing

### Frontend contract tests

- The opening assets and module are included in the production build.
- Every load creates the opening overlay.
- First-time state renders reroll and required confirmation without a continue
  shortcut.
- Returning state renders the stored nickname, a primary continue action, and a
  secondary change action.
- Continue preserves local identity and enters the finale.
- Change supports reroll, cancel, and replacement confirmation.
- The overlay is removed and real game controls are enabled after the finale.
- Reduced-motion mode avoids continuous animation.
- No CDN or non-production element Icon source is introduced.

### Browser behavior checks

- Tokens are visible at different track positions on the first rendered frame.
- Newly emitted tokens land at the exact path endpoint.
- After landing, radial distance decreases immediately.
- Tokens continue along the full path into the center.
- Repeated openings do not leak timers, animation frames, or DOM nodes.
- The returning continue action completes without an unnecessary nickname API
  claim.
- The layout remains usable at desktop and mobile breakpoints.

### Required repository verification

Before merge, run:

```bash
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

A deployment maintainer also runs `npm run makers:build`.
