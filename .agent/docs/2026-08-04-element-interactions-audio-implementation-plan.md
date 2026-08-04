# Element Interactions and Audio Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add list-only random click summoning, stable canvas duplication, and rounded-bubble audio feedback without changing existing drag and combination semantics.

**Architecture:** Keep DOM gesture coordination in `frontend/app.js`, where a shared tap binding distinguishes stationary clicks from drags and tracks the second mouse click. Add a standalone `frontend/audio-feedback.js` Web Audio module, then verify the wiring through its deterministic Node tests and the existing production-page browser harness.

**Tech Stack:** Browser Pointer Events, Web Audio API, vanilla JavaScript, Node.js test runner, pytest, headless Chromium.

## Global Constraints

- Develop directly in `/data/workspace/06.infinity_craft`; do not create a Git worktree.
- Random click summoning applies only to `#element-list`.
- A canvas single click does not move or create an element; it only plays the element-click sound.
- A canvas double-click creates exactly one copy at `x + 28`, `y + 28`.
- Recipe-book elements remain drag-only.
- Use the selected C palette: an approximately 80 ms rounded click pop and an approximately 240 ms rising-bubble combination cue.
- Use Web Audio synthesis only; add no audio assets, network requests, runtime dependencies, or settings UI.
- Audio failures must be silent and must never interrupt gameplay.
- Do not use EdgeOne authentication, project association, Makers KV, or an Edge Function dev server.
- Do not commit `.env`, credentials, runtime data, or unrelated working-tree files.

---

## File Structure

- Create `frontend/audio-feedback.js`: own AudioContext lifecycle and synthesize the two cues.
- Create `tests-makers/audio-feedback.test.mjs`: test oscillator scheduling and silent degradation with a controlled AudioContext.
- Modify `frontend/index.html`: load the audio module before `app.js` and update the advanced interaction guidance.
- Modify `scripts/build-makers.mjs`: require the new browser asset in built output.
- Modify `frontend/app.js`: classify taps, calculate random workspace points, preserve click coordinates, duplicate with a fixed offset, and invoke audio feedback.
- Modify `tests-makers/frontend.test.mjs`: enforce asset order, build inclusion, and accurate guidance copy.
- Modify `tests/test_casino_mode_ui.py`: exercise the real production page with Pointer Events and audio spies.

---

### Task 1: Rounded-bubble audio module

**Files:**

- Create: `frontend/audio-feedback.js`
- Create: `tests-makers/audio-feedback.test.mjs`
- Modify: `frontend/index.html:303-313`
- Modify: `scripts/build-makers.mjs:15-35`
- Modify: `tests-makers/frontend.test.mjs:9-23`

**Interfaces:**

- Consumes: `window.AudioContext` or `window.webkitAudioContext`.
- Produces: `window.AUDIO_FEEDBACK.unlock(): Promise<boolean>`.
- Produces: `window.AUDIO_FEEDBACK.playElementClick(): boolean`.
- Produces: `window.AUDIO_FEEDBACK.playCombineSuccess(): boolean`.

- [ ] **Step 1: Write failing audio-scheduling tests**

Create `tests-makers/audio-feedback.test.mjs` with a VM loader and controlled
audio primitives. Record parameter events using the following concrete test
double:

```js
class FakeParam {
  constructor() {
    this.events = [];
  }
  setValueAtTime(value, time) {
    this.events.push(["set", value, time]);
  }
  exponentialRampToValueAtTime(value, time) {
    this.events.push(["exponential", value, time]);
  }
}

class FakeAudioContext {
  constructor({ state = "running", resumeRejects = false } = {}) {
    this.currentTime = 10;
    this.state = state;
    this.destination = {};
    this.resumeRejects = resumeRejects;
    this.oscillators = [];
    this.gains = [];
  }
  createOscillator() {
    const oscillator = {
      type: "sine",
      frequency: new FakeParam(),
      connect() {},
      startAt: null,
      stopAt: null,
      start(time) { this.startAt = time; },
      stop(time) { this.stopAt = time; },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = {
      gain: new FakeParam(),
      connect() {},
    };
    this.gains.push(gain);
    return gain;
  }
  async resume() {
    if (this.resumeRejects) throw new Error("blocked");
    this.state = "running";
  }
}
```

Load `frontend/audio-feedback.js` into a `vm` context and assert:

```js
assert.equal(audio.playElementClick(), true);
assert.equal(context.oscillators.length, 1);
assert.equal(context.oscillators[0].type, "sine");
assert.deepEqual(context.oscillators[0].frequency.events, [
  ["set", 540, 10],
  ["exponential", 360, 10.08],
]);
assert.equal(context.oscillators[0].stopAt, 10.085);

assert.equal(audio.playCombineSuccess(), true);
assert.equal(context.oscillators.length, 3);
assert.equal(context.oscillators[1].type, "sine");
assert.equal(context.oscillators[2].type, "triangle");
assert.equal(context.oscillators[1].stopAt, 10.155);
assert.equal(context.oscillators[2].stopAt, 10.24);
```

Add degradation cases that load the module without an AudioContext and with a
suspended context whose `resume()` rejects. Assert that `unlock()` resolves to
`false`, play methods return `false` when no context exists, and no method
throws.

- [ ] **Step 2: Write failing shipping-contract assertions**

Extend the first dependency-order test in `tests-makers/frontend.test.mjs`:

```js
assert.ok(html.indexOf("audio-feedback.js") < html.indexOf("app.js"));
assert.match(html, /audio-feedback\.js\?v=20260804a/);
```

Read `scripts/build-makers.mjs` in the same test and assert:

```js
assert.match(build, /"audio-feedback\.js"/);
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
node --test tests-makers/audio-feedback.test.mjs tests-makers/frontend.test.mjs
```

Expected: FAIL because `frontend/audio-feedback.js` and
`window.AUDIO_FEEDBACK` do not exist and the production HTML/build manifest do
not include the asset.

- [ ] **Step 4: Implement the minimal audio module**

Create `frontend/audio-feedback.js` as a browser-global IIFE. Keep one lazily
created context, catch constructor/resume/scheduling errors, and schedule:

```js
function playElementClick() {
  return schedule((audio, now) => {
    createVoice(audio, {
      type: "sine",
      startFrequency: 540,
      endFrequency: 360,
      startTime: now,
      endTime: now + 0.08,
      stopTime: now + 0.085,
      peakGain: 0.025,
    });
  });
}

function playCombineSuccess() {
  return schedule((audio, now) => {
    createVoice(audio, {
      type: "sine",
      startFrequency: 420,
      endFrequency: 680,
      startTime: now,
      endTime: now + 0.15,
      stopTime: now + 0.155,
      peakGain: 0.03,
    });
    createVoice(audio, {
      type: "triangle",
      startFrequency: 880,
      endFrequency: 880,
      startTime: now + 0.12,
      endTime: now + 0.235,
      stopTime: now + 0.24,
      peakGain: 0.02,
    });
  });
}
```

Start each gain envelope at `0.0001`, ramp to its peak during the first
10 milliseconds, and ramp back to `0.0001` at `endTime`. Connect oscillator to
gain and gain to `audio.destination`.

Expose an immutable method object:

```js
root.AUDIO_FEEDBACK = Object.freeze({
  unlock,
  playElementClick,
  playCombineSuccess,
});
```

Add `<script src="/audio-feedback.js?v=20260804a"></script>` immediately before
`app.js`, and add `"audio-feedback.js"` to `REQUIRED_ENTRIES`.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests-makers/audio-feedback.test.mjs tests-makers/frontend.test.mjs
```

Expected: PASS with no warnings.

- [ ] **Step 6: Commit the audio unit**

```bash
git add frontend/audio-feedback.js frontend/index.html scripts/build-makers.mjs tests-makers/audio-feedback.test.mjs tests-makers/frontend.test.mjs
git commit -m "feat: add rounded bubble audio feedback"
```

---

### Task 2: Action-specific click and duplication gestures

**Files:**

- Modify: `frontend/app.js:444-512`
- Modify: `frontend/app.js:536-672`
- Modify: `frontend/app.js:1220-1237`
- Modify: `frontend/index.html:145-151`
- Modify: `tests/test_casino_mode_ui.py:489-594`
- Modify: `tests/test_casino_mode_ui.py:749-778`
- Modify: `tests-makers/frontend.test.mjs:25-52`
- Modify: `tests-makers/frontend.test.mjs:575-586`

**Interfaces:**

- Consumes: `window.AUDIO_FEEDBACK.unlock()` and
  `window.AUDIO_FEEDBACK.playElementClick()` from Task 1.
- Produces: `bindElementTap(element, { onClick, onDoubleClick })`.
- Produces: `randomWorkspacePoint(rect, random = Math.random): { x, y }`.
- Preserves: `spawnOnCanvas(info, x, y)` as the sole canvas-record constructor.

- [ ] **Step 1: Add failing production-page interaction probes**

In the existing `_production_app_page()` probe, add a helper that dispatches
both pointer events to the element so its pointer-up listener runs before the
event bubbles to `window`:

```js
function tapElement(target, pointerId) {
  var rect = target.getBoundingClientRect();
  var x = rect.left + rect.width / 2;
  var y = rect.top + rect.height / 2;
  pointer("pointerdown", target, x, y, pointerId, 1);
  pointer("pointerup", target, x, y, pointerId, 0);
}
```

Replace the old synthetic sidebar `dblclick` probe with these real Pointer
Events:

```js
var waterChip = document.querySelector(
  '#element-list .element[data-name="水"]'
);
var fireChip = document.querySelector(
  '#element-list .element[data-name="火"]'
);
var originalRandom = Math.random;
Math.random = function () { return 0; };

var watersBeforeListClick = new Set(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="水"]'
));
var beforeListClick = document.querySelectorAll(
  "#workspace .element.on-canvas"
).length;
tapElement(waterChip, 51);
var afterListClick = document.querySelectorAll(
  "#workspace .element.on-canvas"
).length;
var summonedWater = Array.from(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="水"]'
)).find(function (element) {
  return !watersBeforeListClick.has(element);
});
var listRandomPosition = {
  left: parseFloat(summonedWater.style.left),
  top: parseFloat(summonedWater.style.top)
};

var beforeListDouble = afterListClick;
var firesBeforeListDouble = new Set(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="火"]'
));
tapElement(fireChip, 52);
tapElement(fireChip, 53);
var afterListDouble = document.querySelectorAll(
  "#workspace .element.on-canvas"
).length;
var summonedFire = Array.from(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="火"]'
)).find(function (element) {
  return !firesBeforeListDouble.has(element);
});
Math.random = originalRandom;

var canvasWater = summonedWater;
var waterBefore = {
  left: canvasWater.style.left,
  top: canvasWater.style.top
};
tapElement(canvasWater, 54);
var waterAfter = {
  left: canvasWater.style.left,
  top: canvasWater.style.top
};

var canvasFire = summonedFire;
var fireBefore = {
  left: parseFloat(canvasFire.style.left),
  top: parseFloat(canvasFire.style.top)
};
var beforeCanvasDouble = document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="火"]'
).length;
var firesBeforeCanvasDouble = new Set(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="火"]'
));
tapElement(canvasFire, 55);
tapElement(canvasFire, 56);
var fires = Array.from(document.querySelectorAll(
  '#workspace .element.on-canvas[data-name="火"]'
));
var copiedFire = fires.find(function (element) {
  return !firesBeforeCanvasDouble.has(element);
});
```

Also drag `canvasWater` by more than 8 pixels and assert its position changes,
then open the recipe book, click and double-click a `.recipe-result`, and assert
the canvas count does not change.

Return this exact shape under `value.interactions`:

```js
interactions: {
  list_single_delta: afterListClick - beforeListClick,
  list_double_delta: afterListDouble - beforeListDouble,
  list_random_position: listRandomPosition,
  canvas_single_unchanged:
    waterBefore.left === waterAfter.left && waterBefore.top === waterAfter.top,
  canvas_double_delta: fires.length - beforeCanvasDouble,
  canvas_copy_offset: {
    x: parseFloat(copiedFire.style.left) - fireBefore.left,
    y: parseFloat(copiedFire.style.top) - fireBefore.top
  },
  canvas_drag_moved: dragBefore !== dragAfter,
  recipe_click_delta: recipeAfter - recipeBefore
}
```

Add `test_element_pointer_interactions_are_action_specific()` asserting:

```python
assert actual["list_single_delta"] == 1
assert actual["list_double_delta"] == 1
assert actual["list_random_position"] == {"left": 10, "top": 16}
assert actual["canvas_single_unchanged"] is True
assert actual["canvas_double_delta"] == 1
assert actual["canvas_copy_offset"] == {"x": 28, "y": 28}
assert actual["canvas_drag_moved"] is True
assert actual["recipe_click_delta"] == 0
```

- [ ] **Step 2: Update failing guidance and provenance contracts**

Change the advanced guidance assertion in `tests-makers/frontend.test.mjs` to
require copy that names all three boundaries:

```js
assert.match(
  hint[1],
  /单击[\s\S]*右侧元素[\s\S]*随机[\s\S]*双击[\s\S]*画布[\s\S]*右下[\s\S]*配方库[\s\S]*拖拽/,
);
```

Replace the old source-shape test named
`element duplication is restricted to mouse pointer provenance` with:

```js
test("element tap routing keeps list, canvas, and recipe actions separate", async () => {
  const source = await readFile("frontend/app.js", "utf8");
  assert.match(source, /function bindElementTap\(/);
  assert.match(source, /function randomWorkspacePoint\(/);
  assert.match(source, /onClick:\s*\(\)\s*=>\s*\{/);
  assert.match(source, /playElementClick/);
  assert.match(source, /rec\.x \+ 28,\s*rec\.y \+ 28/);
  assert.doesNotMatch(source, /bindDoubleTap\(chip/);
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_element_pointer_interactions_are_action_specific -q
node --test tests-makers/frontend.test.mjs
```

Expected: FAIL because list clicks do not summon, stationary canvas pointer-up
currently rewrites coordinates, the old double-tap binding remains on recipe
chips, and the help copy describes the old behavior.

- [ ] **Step 4: Implement tap classification and random summoning**

Replace `bindDoubleTap` with:

```js
function bindElementTap(
  el,
  { onClick = () => {}, onDoubleClick = () => {} } = {},
) {
  let downX = 0;
  let downY = 0;
  let lastTap = 0;
  let lastX = 0;
  let lastY = 0;

  el.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  el.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    const moved =
      Math.abs(event.clientX - downX) > 8 ||
      Math.abs(event.clientY - downY) > 8;
    if (moved) {
      lastTap = 0;
      return;
    }

    cancelActiveDrag();
    const now = performance.now();
    const isSecondMouseClick =
      event.pointerType === "mouse" &&
      now - lastTap < 350 &&
      Math.abs(event.clientX - lastX) < 12 &&
      Math.abs(event.clientY - lastY) < 12;
    if (isSecondMouseClick) {
      lastTap = 0;
      onDoubleClick(event);
      return;
    }

    lastTap = now;
    lastX = event.clientX;
    lastY = event.clientY;
    onClick(event);
  });
  el.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}
```

Add the random helper:

```js
function randomWorkspacePoint(rect, random = Math.random) {
  function coordinate(size, margin) {
    if (size <= margin * 2) return size / 2;
    return margin + random() * (size - margin * 2);
  }
  return {
    x: coordinate(rect.width, 40),
    y: coordinate(rect.height, 32),
  };
}
```

Record `startX` and `startY` in `drag.active`. At the start of
`onPointerUp`, after cleanup, return without move/drop/combine when the
pointer traveled no more than 8 pixels. This is the no-op fallback used by
recipe chips; list and canvas tap listeners will already have canceled their
active drag before the event reaches `window`.

Wire the callers:

```js
bindElementTap(div, {
  onClick: () => {
    const point = randomWorkspacePoint(workspace.getBoundingClientRect());
    spawnOnCanvas(info, point.x, point.y);
    window.AUDIO_FEEDBACK?.playElementClick?.();
  },
});

bindElementTap(el, {
  onClick: () => window.AUDIO_FEEDBACK?.playElementClick?.(),
  onDoubleClick: () => {
    const rec = state.onCanvas.find((record) => record.id === id);
    if (rec) spawnOnCanvas(info, rec.x + 28, rec.y + 28);
  },
});
```

Call `window.AUDIO_FEEDBACK?.unlock?.()` for every accepted primary element
pointer-down before creating the drag ghost. Remove the tap/double-click
binding from `makeInteractiveRecipeChip`.

Update advanced help copy to:

```html
<div class="hint-line desktop-only-help">👆 <b>单击</b>右侧元素可随机放到画布；双击画布元素可向右下复制一份</div>
<div class="hint-line desktop-only-help">📖 配方库里的元素仅支持拖拽</div>
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_element_pointer_interactions_are_action_specific -q
node --test tests-makers/frontend.test.mjs
```

Expected: PASS. Also run the full casino UI file to catch drag, scoring, and
mode regressions:

```bash
python3 -m pytest tests/test_casino_mode_ui.py -q
```

- [ ] **Step 6: Commit the interaction unit**

```bash
git add frontend/app.js frontend/index.html tests/test_casino_mode_ui.py tests-makers/frontend.test.mjs
git commit -m "feat: refine element click and duplication gestures"
```

---

### Task 3: Successful-combination audio routing

**Files:**

- Modify: `frontend/app.js:697-808`
- Modify: `tests/test_casino_mode_ui.py:266-318`
- Modify: `tests/test_casino_mode_ui.py:489-594`
- Modify: `tests/test_casino_mode_ui.py:806-826`

**Interfaces:**

- Consumes: `window.AUDIO_FEEDBACK.playCombineSuccess(): boolean` from Task 1.
- Preserves: fallback and exception branches as sound-free paths.
- Produces: exactly one success-cue call after a non-fallback result element is created.

- [ ] **Step 1: Add failing combination-audio probes**

In the production-page prelude, give `window.__combineQueue` one fallback and
one failed response after the two existing successes:

```js
{
  ok: true,
  payload: {
    result: "fallback",
    emoji: "❔",
    source: "fallback"
  }
},
{
  ok: false,
  status: 500,
  payload: { detail: "测试失败" }
}
```

Wrap each of the two existing success object literals in
`{ ok: true, payload: { ... } }` without changing their result, score, icon,
discovery, or comment fields. Change the `/api/combine` fetch branch to return
each entry's `ok`, `status`, and `payload`.

Before placing the first canvas pair, replace the module object with a spy:

```js
window.__audioFeedback = { unlocks: 0, clicks: 0, combines: 0 };
window.AUDIO_FEEDBACK = {
  unlock: function () {
    window.__audioFeedback.unlocks += 1;
    return Promise.resolve(true);
  },
  playElementClick: function () {
    window.__audioFeedback.clicks += 1;
    return true;
  },
  playCombineSuccess: function () {
    window.__audioFeedback.combines += 1;
    return true;
  }
};
```

Capture `combines` after the two existing successful combinations. Place one
more water/fire pair, combine it once for the fallback response, capture again,
then combine the retained pair once more for the error response and capture a
third time. Return:

```js
audio: {
  after_success: combinesAfterSuccess,
  after_fallback: combinesAfterFallback,
  after_error: window.__audioFeedback.combines,
  element_clicks: window.__audioFeedback.clicks
}
```

Add:

```python
def test_audio_routes_only_completed_actions(tmp_path):
    actual = _run_app_page(tmp_path)["audio"]
    assert actual["after_success"] == 2
    assert actual["after_fallback"] == 2
    assert actual["after_error"] == 2
    assert actual["element_clicks"] == 4
```

The four element clicks are the Task 2 probes: one list single-click, the first
click of the list double-click, one canvas single-click, and the first click of
the canvas double-click.

- [ ] **Step 2: Run the audio-routing test and verify RED**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_audio_routes_only_completed_actions -q
```

Expected: FAIL because successful combinations do not yet call
`playCombineSuccess()`.

- [ ] **Step 3: Add the minimal success call**

In `combine()`, call the audio interface immediately after the result element
has replaced the sources:

```js
removeCanvasEl(srcId);
removeCanvasEl(dstId);
const newRec = spawnOnCanvas(resultInfo, x, y);
window.AUDIO_FEEDBACK?.playCombineSuccess?.();
```

Do not add calls before the fallback return or inside `catch`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
python3 -m pytest tests/test_casino_mode_ui.py::test_audio_routes_only_completed_actions -q
python3 -m pytest tests/test_casino_mode_ui.py -q
```

Expected: PASS with success count `2` at all three checkpoints.

- [ ] **Step 5: Commit the combination-audio unit**

```bash
git add frontend/app.js tests/test_casino_mode_ui.py
git commit -m "feat: play audio after successful combinations"
```

---

### Task 4: Full verification and handoff

**Files:**

- Verify only; modify only files already in scope if a regression is found.

**Interfaces:**

- Consumes: all interaction and audio behavior from Tasks 1-3.
- Produces: a clean required-verification report.

- [ ] **Step 1: Run JavaScript tests**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run the required Python suite**

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: PASS.

- [ ] **Step 3: Build the production bundle**

```bash
npm run build
```

Expected: PASS and `dist/audio-feedback.js` exists and is non-empty.

- [ ] **Step 4: Inspect the final diff and working tree**

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors; only the planned implementation files and any
generated build artifacts already tracked by the repository are present.

- [ ] **Step 5: Record any verification-only correction**

If a required check exposed a defect in an in-scope file, add a regression
assertion first, apply the minimum correction, rerun all three required
commands, then commit only that correction:

```bash
git add frontend/app.js frontend/audio-feedback.js frontend/index.html scripts/build-makers.mjs tests-makers/audio-feedback.test.mjs tests-makers/frontend.test.mjs tests/test_casino_mode_ui.py
git commit -m "fix: close element interaction regression"
```
