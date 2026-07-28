# Task 3: Browser Icon System

## Delivered

- Added `window.ICON_SYSTEM` with asynchronous manifest loading, deterministic
  persisted → preset → Emoji → native-fallback recipe resolution, safe DOM
  rendering, action allowlisting, and action hydration.
- Added sticker/icon CSS tokens, six palettes, fixed name-derived tilt, state
  decorations, and icon/action sizing.
- Delegated the legacy `window.COMBINE_FEEDBACK.renderElement` facade and toast
  result icon rendering to the shared system while retaining `.emoji` and
  `.name` compatibility.
- Loaded the icon stylesheet and script before their consumers, and added
  focused resolution, failure-degradation, safety, and load-order coverage.

## Verification

- RED: `python3 -m pytest tests/test_combine_feedback.py -q` failed before
  implementation because `frontend/icon-system.js` and the icon page assets
  did not exist.
- `node --check frontend/icon-system.js`
- `node --check frontend/combine-feedback.js`
- `python3 -m pytest tests/test_combine_feedback.py -q` — 13 passed, with one
  pre-existing js2py deprecation warning. The harness recognizes
  `/usr/bin/ungoogled-chromium`; it must run outside this sandbox because its
  Crashpad handler requires a socket option blocked by sandbox policy.
- `node --test tests-makers/frontend.test.mjs` — 1 passed.

## Concern

The browser suite must run with permission outside this sandbox when it uses
the installed ungoogled Chromium binary; normal frontend CI satisfies that.
