/* ============================================================
   audio-feedback.js — lightweight synthesized game feedback
   ============================================================ */
(function (root) {
  "use strict";

  const SILENCE = 0.0001;
  let context = null;

  function audioContext() {
    if (context && context.state !== "closed") return context;
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (typeof AudioContext !== "function") return null;
    try {
      context = new AudioContext();
      return context;
    } catch (_) {
      context = null;
      return null;
    }
  }

  async function unlock() {
    const audio = audioContext();
    if (!audio || audio.state === "closed") return false;
    if (audio.state === "suspended") {
      try {
        await audio.resume();
      } catch (_) {
        return false;
      }
    }
    return audio.state !== "suspended" && audio.state !== "closed";
  }

  function createVoice(audio, options) {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(
      options.startFrequency,
      options.startTime,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      options.endFrequency,
      options.endTime,
    );
    envelope.gain.setValueAtTime(SILENCE, options.startTime);
    envelope.gain.exponentialRampToValueAtTime(
      options.peakGain,
      Math.min(options.startTime + 0.01, options.endTime),
    );
    envelope.gain.exponentialRampToValueAtTime(
      SILENCE,
      options.endTime,
    );
    oscillator.connect(envelope);
    envelope.connect(audio.destination);
    oscillator.start(options.startTime);
    oscillator.stop(options.stopTime);
  }

  function schedule(callback) {
    const audio = audioContext();
    if (!audio || audio.state !== "running") return false;
    try {
      callback(audio, audio.currentTime);
      return true;
    } catch (_) {
      return false;
    }
  }

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

  root.AUDIO_FEEDBACK = Object.freeze({
    unlock,
    playElementClick,
    playCombineSuccess,
  });
})(typeof window === "object" ? window : globalThis);
