/* ============================================================
   casino-round.js — deterministic rules for the inner-mode pot
   ============================================================ */
(function (root) {
  "use strict";

  function normalizePositiveInteger(value, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function normalizeCount(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function createRound(baseScore = 100) {
    return {
      baseScore: normalizePositiveInteger(baseScore, 100),
      pot: 0,
      chips: 0,
    };
  }

  function normalizeRound(state) {
    return {
      baseScore: normalizePositiveInteger(state?.baseScore, 100),
      pot: normalizeCount(state?.pot),
      chips: normalizeCount(state?.chips),
    };
  }

  function applyRoundEvent(state, event) {
    const current = normalizeRound(state);
    if (event === "success") {
      return {
        ...current,
        pot: current.chips === 0 ? current.baseScore : current.pot * 2,
        chips: current.chips + 1,
      };
    }
    if (event === "harvest" || event === "failure") {
      return createRound(current.baseScore);
    }
    return current;
  }

  function chipOffset(index) {
    return normalizeCount(index) * 7;
  }

  function createHarvestSequence(count) {
    const safeCount = normalizeCount(count);
    const step = safeCount > 1
      ? Math.min(90, 720 / (safeCount - 1))
      : 0;
    return Array.from({ length: safeCount }, (_, order) => ({
      chipIndex: safeCount - order - 1,
      delay: order * step,
    }));
  }

  root.CASINO_ROUND = Object.freeze({
    createRound,
    applyRoundEvent,
    chipOffset,
    createHarvestSequence,
  });
})(typeof window === "object" ? window : globalThis);
