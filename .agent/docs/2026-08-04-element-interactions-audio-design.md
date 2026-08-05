# Element Interactions and Audio Feedback Design

## Goal

Improve the basic game interactions so that the discovered-element list can
summon elements quickly, canvas duplication is spatially stable, and successful
element actions have lightweight audio feedback.

## Scope

This change covers:

- single-click summoning from the right-side discovered-element list;
- single-click feedback and double-click duplication for canvas elements;
- short synthesized sounds for element clicks and successful combinations;
- interaction and audio regression tests.

It does not add a sound settings panel, persistent volume preference, audio
files, new recipe-book gestures, or any backend behavior.

## Interaction Rules

### Discovered-element list

Only elements inside `#element-list` gain the quick-summon behavior.

- A primary-button press and release whose movement stays within 8 CSS pixels
  is a click.
- The first click immediately creates one copy at a random point in the visible
  workspace and plays the element-click sound once.
- A second click on the same list element within 350 milliseconds and within
  12 CSS pixels is treated as the continuation of a double-click and is
  suppressed. A double-click therefore summons one element, not two.
- Movement beyond the click threshold remains a drag. It does not summon an
  element or play the element-click sound.
- The random point keeps at least 40 CSS pixels of horizontal inset and 32 CSS
  pixels of vertical inset when the workspace is large enough. An axis that is
  too small for those insets falls back to its center.

### Canvas elements

- A primary-button click does not move, create, or delete anything. It plays the
  element-click sound once.
- A drag continues to move or combine elements as it does today and does not
  play the click sound.
- A second click on the same canvas element within 350 milliseconds and within
  12 CSS pixels duplicates the element exactly once.
- The duplicate uses the source record's unchanged canvas coordinates and is
  created at `x + 28`, `y + 28`. No random jitter is applied.
- The first click in a double-click plays the element-click sound. The second
  click performs duplication without stacking a second sound.
- Click and double-click completion cancel and clean up the temporary drag
  ghost before applying their action. This prevents a click from rewriting the
  source coordinates and removes the current duplication-position race.

### Recipe-book elements

Recipe-book elements retain their current drag behavior. Their current
double-click-to-summon behavior is removed. They do not gain list-style
single-click summoning or canvas-style duplication.

## Gesture Architecture

`frontend/app.js` will keep the existing Pointer Events drag system and replace
the narrowly scoped double-tap helper with a shared element-tap binding.

The binding records pointer-down coordinates, then classifies pointer-up as
either a click or a drag. It keeps per-element time and position state to
distinguish the first click from the second click. Callers provide separate
first-click and double-click actions:

- a discovered-list chip uses random summon for the first click and no action
  for the second;
- a canvas element uses sound-only feedback for the first click and fixed-offset
  duplication for the second;
- a recipe-book chip does not install the tap binding.

The drag state records its starting client coordinates. A pointer-up within the
click threshold exits through the tap path before the normal move/combine/drop
logic, so a canvas click cannot update the element record to the pointer
location.

Random workspace coordinates are calculated in one helper so their range can
be tested with deterministic random inputs. `spawnOnCanvas` remains the single
function that creates canvas DOM and state records.

## Audio Design

A new `frontend/audio-feedback.js` module exposes a small global
`window.AUDIO_FEEDBACK` interface:

- `unlock()` prepares or resumes audio after a user gesture;
- `playElementClick()` plays the selected element sound;
- `playCombineSuccess()` plays the selected combination sound.

The module uses the Web Audio API and creates no network requests or persistent
audio assets. `frontend/index.html` loads it before `frontend/app.js`, and the
Makers build copies it with the other frontend assets.

The selected sound palette is **C: rounded bubble**:

- Element click: a soft sine-wave pop that falls from about 540 Hz to 360 Hz
  over roughly 80 milliseconds, with a fast attack and low-volume decay.
- Combination success: a sine-wave bubble that rises from about 420 Hz to
  680 Hz over roughly 150 milliseconds, followed by a light triangular-wave
  chime near 880 Hz. The complete cue lasts about 240 milliseconds.

Peak gain remains low and the envelopes end near zero to avoid clicks and
fatigue during frequent play.

The audio context is created lazily. Every primary element pointer-down makes a
best-effort `unlock()` call so a later asynchronous combination result can use
the already activated context. Missing Web Audio support, a suspended context,
resume rejection, oscillator failure, or other audio errors turn the operation
into a no-op and never interrupt gameplay.

## Combination Flow

The success cue plays only after all of these conditions hold:

1. the `/api/combine` request returns an OK response;
2. the response is not a fallback result;
3. the source elements have been replaced by the result element.

The success cue plays once per completed combination. Fallback responses,
timeouts, non-OK responses, malformed responses, and thrown errors do not play
it.

## Testing

Browser interaction tests will verify:

- one discovered-list click creates one element inside the defined random
  bounds and plays one element-click cue;
- a discovered-list double-click still creates only one element;
- a canvas click leaves its record and DOM coordinates unchanged and plays one
  element-click cue;
- a canvas drag still moves the element and does not play the click cue;
- a canvas double-click adds exactly one record at `x + 28`, `y + 28`;
- recipe-book clicks and double-clicks do not summon or duplicate elements;
- a successful non-fallback combination plays one success cue;
- fallback and error paths do not play a success cue.

Audio-module tests will use a controlled AudioContext substitute to verify the
rounded-bubble oscillator types, frequency ramps, envelope duration, and
single-call scheduling. A separate test will verify that the public methods do
not throw when Web Audio is unavailable or resume fails.

Before completion, run the project-required verification:

```text
npm test
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```
