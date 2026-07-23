# Final Review Fix Report

Date: 2026-07-23

Status: DONE

## Scope fixed

- Removed every `innerHTML` use from `frontend/app.js`, including the five
  model/user-controlled rendering paths cited by final review: sidebar chips,
  drag ghosts, canvas elements, stored score rows, and recipe chips.
- Added `COMBINE_FEEDBACK.renderElement()` so those five paths create exact
  DOM nodes and assign model-controlled Emoji/name values only through
  `textContent`.
- Kept Toast rendering replacement-based and text-only, and added executable
  hostile Emoji/name/comment coverage.
- Changed the Toast timeout from `2800` to the exact design value `4200` ms.
- Replaced the Python 3.14 skip with a bounded (20-second) headless
  Chrome/Edge pytest runner. `js2py` remains the classification runner on
  supported Python versions.
- Rejected C1 controls and Unicode line/paragraph separators, covering
  U+0085, U+2028, and U+2029.
- Added regressions proving a hit-only SQLite upsert preserves the original
  comment/result/Emoji and archive warm-up leaves an existing legacy Redis
  Hash byte-for-byte untouched.

## RED evidence

Command:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\test_combine_feedback.py tests\test_comments.py `
  --basetemp=.runtime\pytest-red -q
```

Pre-fix result: `5 failed, 24 passed`.

The intended failures showed:

- `COMBINE_FEEDBACK.renderElement` did not exist while `app.js` still
  contained the cited `innerHTML` sinks;
- `EFFECTS.firstToast` scheduled `2800` instead of `4200`;
- U+0085 and U+2028 were collapsed to spaces instead of degrading to the
  default comment.

The existing Toast renderer already treated its three values as text; the
new regression makes that behavior executable in a real browser and prevents
future regression.

## GREEN evidence

Targeted command:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  tests\test_combine_feedback.py tests\test_comments.py `
  --basetemp=.runtime\pytest-green -q
```

Result: `29 passed, 0 failed, 0 skipped` in `4.31s`.

Full-suite command:

```powershell
.\.venv\Scripts\python.exe -m pytest `
  --basetemp=.runtime\pytest-full -p no:cacheprovider -q
```

Final fresh result: `44 passed, 0 failed, 0 skipped` in `4.88s`.
Two pre-existing FastAPI `on_event` deprecation warnings remain.

Additional verification:

- `.\.venv\Scripts\python.exe -m compileall -q backend` — exit `0`.
- `git diff --check` — exit `0`.
- Pending-diff secret scan — `0` candidate credentials/private keys.
- Tracked/untracked `.env` scan — `0` files.
- `rg -n "innerHTML" frontend\app.js` — no matches.
- `COMBINE_FEEDBACK.renderElement` production call count — exactly `5`.

## Runtime coverage

The frontend tests execute:

- all discovery-state classifications and global-first precedence;
- Toast child replacement;
- exact Toast node tags, classes, and text;
- missing-comment fallback;
- hostile Emoji/name/comment values as literal text with no generated
  `img`, `svg`, `iframe`, or `script` nodes and no event execution;
- safe element nodes used by all five `app.js` paths;
- exact `4200` ms Toast scheduling.

On Python 3.14, these tests used installed Google Chrome in bounded headless
mode. No core runtime test was skipped.

## Concerns

None blocking release. Python 3.14 environments running the DOM tests must
provide Chrome, Chromium, or Edge; supported Python versions retain `js2py`
for classification, while DOM assertions intentionally require a real
browser.
