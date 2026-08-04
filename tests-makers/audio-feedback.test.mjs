import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

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
      startAt: null,
      stopAt: null,
      connect() {},
      start(time) {
        this.startAt = time;
      },
      stop(time) {
        this.stopAt = time;
      },
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

async function loadAudioFeedback(audioContext) {
  const source = await readFile("frontend/audio-feedback.js", "utf8").catch(
    () => "",
  );
  const browser = {};
  if (audioContext) {
    browser.AudioContext = function AudioContext() {
      return audioContext;
    };
  }
  vm.runInNewContext(source, { window: browser, globalThis: browser });
  assert.ok(
    browser.AUDIO_FEEDBACK,
    "audio feedback should load into the browser global",
  );
  return browser.AUDIO_FEEDBACK;
}

test("rounded element click schedules one quiet falling sine pop", async () => {
  const context = new FakeAudioContext();
  const audio = await loadAudioFeedback(context);

  assert.equal(await audio.unlock(), true);
  assert.equal(audio.playElementClick(), true);
  assert.equal(context.oscillators.length, 1);
  assert.equal(context.gains.length, 1);
  assert.equal(context.oscillators[0].type, "sine");
  assert.deepEqual(context.oscillators[0].frequency.events, [
    ["set", 540, 10],
    ["exponential", 360, 10.08],
  ]);
  assert.deepEqual(context.gains[0].gain.events, [
    ["set", 0.0001, 10],
    ["exponential", 0.025, 10.01],
    ["exponential", 0.0001, 10.08],
  ]);
  assert.equal(context.oscillators[0].startAt, 10);
  assert.equal(context.oscillators[0].stopAt, 10.085);
});

test("combination success schedules a rising bubble followed by a light chime", async () => {
  const context = new FakeAudioContext();
  const audio = await loadAudioFeedback(context);

  assert.equal(audio.playCombineSuccess(), true);
  assert.equal(context.oscillators.length, 2);
  assert.equal(context.gains.length, 2);
  assert.equal(context.oscillators[0].type, "sine");
  assert.deepEqual(context.oscillators[0].frequency.events, [
    ["set", 420, 10],
    ["exponential", 680, 10.15],
  ]);
  assert.equal(context.oscillators[0].startAt, 10);
  assert.equal(context.oscillators[0].stopAt, 10.155);
  assert.equal(context.oscillators[1].type, "triangle");
  assert.deepEqual(context.oscillators[1].frequency.events, [
    ["set", 880, 10.12],
    ["exponential", 880, 10.235],
  ]);
  assert.equal(context.oscillators[1].startAt, 10.12);
  assert.equal(context.oscillators[1].stopAt, 10.24);
});

test("audio feedback degrades silently when Web Audio is unavailable", async () => {
  const audio = await loadAudioFeedback(null);

  assert.equal(await audio.unlock(), false);
  assert.equal(audio.playElementClick(), false);
  assert.equal(audio.playCombineSuccess(), false);
});

test("a rejected AudioContext resume never escapes into gameplay", async () => {
  const context = new FakeAudioContext({
    state: "suspended",
    resumeRejects: true,
  });
  const audio = await loadAudioFeedback(context);

  assert.equal(await audio.unlock(), false);
  assert.equal(audio.playElementClick(), false);
  assert.equal(audio.playCombineSuccess(), false);
  assert.equal(context.oscillators.length, 0);
  assert.equal(context.gains.length, 0);
});
