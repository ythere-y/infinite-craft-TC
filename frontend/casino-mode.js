/* ============================================================
   casino-mode.js — compact inner-mode table and finite animations
   ============================================================ */
(function (root) {
  "use strict";

  const roundRules = root.CASINO_ROUND;
  const animationEngine = root.anime;
  const reducedMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)");

  let state = roundRules?.createRound?.(100) || {
    baseScore: 100,
    pot: 0,
    chips: 0,
  };
  let awardScore = function () {};
  let busy = false;
  let initialized = false;
  let elements = null;
  const pendingResults = [];

  function formatScore(value) {
    return Number(value).toLocaleString("zh-CN");
  }

  function motionReduced() {
    return reducedMotion?.matches === true;
  }

  function animationAvailable() {
    return !motionReduced()
      && typeof animationEngine?.waapi?.animate === "function";
  }

  function stagger(delay, start = 0) {
    if (typeof animationEngine?.stagger !== "function") return start;
    return animationEngine.stagger(delay, { start });
  }

  async function animate(targets, parameters) {
    const list = Array.isArray(targets) ? targets.filter(Boolean) : targets;
    if (
      !animationAvailable()
      || !list
      || (Array.isArray(list) && list.length === 0)
    ) {
      return;
    }
    try {
      await animationEngine.waapi.animate(list, parameters);
    } catch (error) {
      console.warn("casino animation unavailable", error);
    }
  }

  function makeChip(index) {
    const chip = document.createElement("i");
    chip.className = "casino-chip";
    chip.dataset.index = String(index);
    chip.style.setProperty(
      "--casino-chip-y",
      `${roundRules.chipOffset(index)}px`,
    );
    chip.style.zIndex = String(index + 1);
    chip.setAttribute("aria-hidden", "true");
    return chip;
  }

  function render({ rebuildStack = true } = {}) {
    if (!elements) return;
    elements.pot.textContent = formatScore(state.pot);
    if (state.chips > 0) {
      elements.streak.textContent = `${state.chips} 连续首发`;
      elements.next.textContent = "下一次 ×2";
    } else {
      elements.streak.textContent = "等待全球首发";
      elements.next.textContent = "合成全球首发获得首枚筹码";
    }
    elements.harvest.textContent = state.pot > 0
      ? `收获 ${formatScore(state.pot)} 分`
      : "暂无可收获分数";
    elements.harvest.disabled = busy || state.pot <= 0;
    if (!rebuildStack) return;
    elements.stack.replaceChildren();
    for (let index = 0; index < state.chips; index += 1) {
      elements.stack.append(makeChip(index));
    }
  }

  function showChipTick(done, count) {
    elements.lane.textContent = `筹码计分中 · ${done} / ${count}`;
    if (motionReduced()) return;
    const tick = document.createElement("i");
    tick.className = "casino-chip-tick";
    tick.textContent = `第 ${done} 枚已记分`;
    elements.table.append(tick);
    void animate(tick, {
      translate: ["-50% 7px", "-50% 0", "-50% -16px"],
      scale: [.82, 1, .96],
      opacity: [0, 1, 0],
      duration: 380,
      ease: "cubic-bezier(.2,.72,.2,1)",
    }).finally(() => tick.remove());
  }

  function createAwardContents(amount) {
    const ring = document.createElement("i");
    ring.className = "casino-award-ring";

    const copy = document.createElement("span");
    copy.className = "casino-award-copy";
    const label = document.createElement("small");
    label.textContent = "全部筹码记分完成";
    const score = document.createElement("strong");
    score.textContent = `+${formatScore(amount)}`;
    const settled = document.createElement("span");
    settled.textContent = "已加入总分";
    copy.append(label, score, settled);

    const sparks = Array.from({ length: 14 }, (_, index) => {
      const spark = document.createElement("i");
      const angle = index * Math.PI * 2 / 14;
      const distance = 78 + (index % 4) * 20;
      spark.className = "casino-spark";
      spark.style.setProperty(
        "--casino-spark-color",
        index % 3 === 0 ? "#CAA6FF" : index % 2 ? "#FFD54F" : "#F472B6",
      );
      spark.dataset.x = String(Math.cos(angle) * distance);
      spark.dataset.y = String(Math.sin(angle) * distance);
      return spark;
    });
    elements.burst.replaceChildren(ring, copy, ...sparks);
    return { ring, copy, sparks };
  }

  async function showAward(amount) {
    const { ring, copy, sparks } = createAwardContents(amount);
    elements.burst.classList.add("is-active");
    if (!animationAvailable()) {
      elements.burst.classList.remove("is-active");
      elements.burst.replaceChildren();
      return;
    }
    const animations = [
      animate(ring, {
        scale: [.38, 1.04, 1.28],
        opacity: [0, .9, 0],
        rotate: ["-7deg", "5deg", "11deg"],
        duration: 900,
        ease: "cubic-bezier(.13,.78,.2,1)",
      }),
      animate(copy, {
        translate: ["0 16px", "0 0", "0 0", "0 -12px"],
        scale: [.62, 1.1, 1, .96],
        opacity: [0, 1, 1, 0],
        duration: 1020,
        ease: "cubic-bezier(.16,.85,.24,1)",
      }),
      ...sparks.map((spark, index) => animate(spark, {
        translate: [
          "-50% -50%",
          `calc(-50% + ${spark.dataset.x}px) calc(-50% + ${spark.dataset.y}px)`,
        ],
        scale: [.35, 1],
        opacity: [0, 1, 0],
        duration: 730,
        delay: index * 12,
        ease: "cubic-bezier(.16,.78,.2,1)",
      })),
    ];
    await Promise.all(animations);
    elements.burst.classList.remove("is-active");
    elements.burst.replaceChildren();
  }

  function succeed(sourceEl) {
    if (busy || !initialized) return;
    const previousCount = state.chips;
    state = roundRules.applyRoundEvent(state, "success");
    const chip = makeChip(previousCount);
    elements.stack.append(chip);
    render({ rebuildStack: false });

    void animate(chip, {
      translate: ["-58px -66px", "0 4px", "0 0"],
      scale: [.68, 1.06, 1],
      opacity: [0, 1],
      duration: 500,
      ease: "cubic-bezier(.16,.82,.24,1)",
    });
    void animate(elements.pot, {
      translate: ["0 0", "0 -7px", "0 0"],
      scale: [1, 1.18, 1],
      duration: 410,
      ease: "cubic-bezier(.2,.8,.2,1)",
    });
    if (sourceEl) {
      void animate(sourceEl, {
        scale: [1, 1.05, 1],
        duration: 360,
        ease: "cubic-bezier(.2,.8,.2,1)",
      });
    }
  }

  function drainPendingResults() {
    while (!busy && pendingResults.length > 0) {
      const next = pendingResults.shift();
      if (next.isGlobalFirst === true) {
        succeed(next.sourceEl);
      } else if (state.chips > 0) {
        void fail();
      }
    }
  }

  async function harvest() {
    if (busy || state.pot <= 0 || state.chips <= 0) return;
    busy = true;
    render({ rebuildStack: false });
    const amount = state.pot;
    const streak = state.chips;
    const chips = [...elements.stack.children].reverse();
    const schedule = roundRules.createHarvestSequence(streak);
    const step = schedule.length > 1 ? schedule[1].delay : 0;
    elements.lane.textContent = `筹码计分中 · 0 / ${streak}`;
    elements.lane.classList.add("is-active");

    let progressTimeline = null;
    if (
      animationAvailable()
      && typeof animationEngine?.createTimeline === "function"
    ) {
      progressTimeline = animationEngine.createTimeline();
      schedule.forEach(({ delay }, index) => {
        progressTimeline.call(
          () => showChipTick(index + 1, streak),
          delay + 270,
        );
      });
    }

    try {
      await animate(chips, {
        translate: ["0 0", "16px -38px", "132px -118px"],
        scale: [1, 1.04, .42],
        opacity: [1, 1, 0],
        delay: stagger(step),
        duration: 390,
        ease: "cubic-bezier(.22,.72,.18,1)",
      });
      if (!progressTimeline) {
        schedule.forEach((_, index) => showChipTick(index + 1, streak));
      } else {
        progressTimeline.complete();
      }
      elements.lane.classList.remove("is-active");
      state = roundRules.applyRoundEvent(state, "harvest");
      elements.stack.replaceChildren();
      await showAward(amount);
      await awardScore({
        amount,
        sourceEl: elements.pot,
        streak,
      });
    } finally {
      elements.lane.classList.remove("is-active");
      elements.burst.classList.remove("is-active");
      busy = false;
      render();
      drainPendingResults();
    }
  }

  async function fail() {
    if (busy || state.chips <= 0) return;
    busy = true;
    render({ rebuildStack: false });
    const lost = state.pot;
    const chips = [...elements.stack.children];
    state = roundRules.applyRoundEvent(state, "failure");
    elements.loss.textContent = `风过牌桌 · ${formatScore(lost)} → 0`;

    try {
      await Promise.all([
        animate([...elements.wind.querySelectorAll("i")], {
          translate: ["0 0", "340% 0", "390% 0"],
          scaleX: [.7, 1.2, 1],
          opacity: [0, .95, .8, 0],
          delay: stagger(46),
          duration: 700,
          ease: "cubic-bezier(.22,.7,.18,1)",
        }),
        animate(elements.loss, {
          translate: ["-50% -38%", "-50% -50%", "-50% -58%"],
          scale: [.9, 1, 1],
          opacity: [0, 1, 0],
          duration: 880,
          ease: "cubic-bezier(.2,.7,.2,1)",
        }),
        animate(chips, {
          translate: ["0 0", "220px -26px", "380px 10px"],
          rotate: [0, 180, 295],
          opacity: [1, .9, 0],
          delay: stagger(15, 90),
          duration: 720,
          ease: "cubic-bezier(.35,.55,.3,1)",
        }),
      ]);
    } finally {
      elements.stack.replaceChildren();
      busy = false;
      render();
      drainPendingResults();
    }
  }

  function init(options = {}) {
    if (typeof options.awardScore === "function") {
      awardScore = options.awardScore;
    }
    if (initialized) {
      render();
      return true;
    }
    if (!roundRules) return false;

    elements = {
      hud: document.getElementById("casino-hud"),
      table: document.querySelector("#casino-hud .casino-table"),
      stack: document.getElementById("casino-chip-stack"),
      streak: document.getElementById("casino-streak-count"),
      next: document.getElementById("casino-next-multiplier"),
      pot: document.getElementById("casino-pot-value"),
      harvest: document.getElementById("casino-harvest"),
      lane: document.getElementById("casino-score-lane"),
      wind: document.querySelector("#casino-hud .casino-wind"),
      loss: document.getElementById("casino-loss-copy"),
      burst: document.getElementById("casino-score-burst"),
    };
    if (Object.values(elements).some((element) => !element)) return false;

    elements.harvest.addEventListener("click", () => void harvest());
    initialized = true;
    render();
    return true;
  }

  function onCombineResult({ isGlobalFirst, sourceEl } = {}) {
    if (!initialized) return;
    if (busy) {
      pendingResults.push({ isGlobalFirst, sourceEl });
      return;
    }
    if (isGlobalFirst === true) {
      succeed(sourceEl);
    } else {
      void fail();
    }
  }

  root.CASINO_MODE = Object.freeze({
    init,
    onCombineResult,
    getState() {
      return { ...state };
    },
    isBusy() {
      return busy;
    },
  });
})(window);
