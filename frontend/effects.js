/* ============================================================
   effects.js —— 创新玩法特效
   暴露到 window.EFFECTS：
     - explode(resultName)          P0 故障爆炸
     - firstToast(info, opt)        首发 / 新发现 toast
     - animateScoreGain(job)        分数飞行与等级融合队列
     - initBossMode()              Konami → 老板视角
   ============================================================ */

(function () {
  const EFFECTS = {};

  function prefersReducedMotion() {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  const IMPACT_RARITIES = Object.freeze([
    Object.freeze({
      maxDepth: 2,
      name: "common",
      color: "#9AA6B2",
      scale: 5.5,
      glowNew: "rgba(154,166,178,.72)",
      glowRepeat: "rgba(154,166,178,.14)",
    }),
    Object.freeze({
      maxDepth: 4,
      name: "uncommon",
      color: "#35C978",
      scale: 6.5,
      glowNew: "rgba(53,201,120,.72)",
      glowRepeat: "rgba(53,201,120,.14)",
    }),
    Object.freeze({
      maxDepth: 6,
      name: "rare",
      color: "#3B82F6",
      scale: 7.6,
      glowNew: "rgba(59,130,246,.76)",
      glowRepeat: "rgba(59,130,246,.15)",
    }),
    Object.freeze({
      maxDepth: 9,
      name: "epic",
      color: "#A855F7",
      scale: 8.9,
      glowNew: "rgba(168,85,247,.8)",
      glowRepeat: "rgba(168,85,247,.16)",
    }),
    Object.freeze({
      maxDepth: Infinity,
      name: "legendary",
      color: "#F2B84B",
      scale: 10.5,
      glowNew: "rgba(242,184,75,.86)",
      glowRepeat: "rgba(242,184,75,.17)",
    }),
  ]);

  function impactRarity(depth) {
    const normalized = Number.isFinite(Number(depth))
      ? Math.max(1, Math.trunc(Number(depth)))
      : 1;
    return IMPACT_RARITIES.find((rarity) => normalized <= rarity.maxDepth);
  }

  function centerOf(target) {
    const rect = target.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  // -------------------- P0 爆炸 --------------------
  let audioCtx = null;
  function beep() {
    // 用 WebAudio 合成一个告警音，避免带 mp3
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(880, now + i * 0.3);
        osc.frequency.setValueAtTime(440, now + i * 0.3 + 0.15);
        gain.gain.setValueAtTime(0.15, now + i * 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.3 + 0.28);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.3);
        osc.stop(now + i * 0.3 + 0.28);
      }
    } catch (_) { /* 忽略音频权限/兼容问题 */ }
  }

  EFFECTS.explode = function (resultName) {
    const overlay = document.getElementById("explode-overlay");
    const text = overlay.querySelector(".explode-text");
    text.textContent = "🚨 " + (resultName || "P0 故障") + "！";
    overlay.classList.add("active");
    document.body.classList.add("quaking");
    beep();
    setTimeout(() => {
      overlay.classList.remove("active");
      document.body.classList.remove("quaking");
    }, 1500);
  };

  // -------------------- 拖拽锁定与合成生命周期 --------------------
  EFFECTS.setCombineTarget = function (target, active) {
    if (!target) return;
    target.classList.toggle("combine-target", !!active);
  };

  function spawnImpact(host, x, y, meta = {}, fixed = false) {
    if (prefersReducedMotion()) return null;
    const rarity = impactRarity(meta.depth);
    const discovered = meta.discovered === true;
    const impact = document.createElement("div");
    impact.className = "combine-impact" + (fixed ? " is-fixed" : "");
    impact.dataset.rarity = rarity.name;
    impact.dataset.discovery = discovered ? "new" : "repeat";
    impact.setAttribute("aria-hidden", "true");
    impact.style.left = x + "px";
    impact.style.top = y + "px";
    impact.style.setProperty("--impact-color", rarity.color);
    impact.style.setProperty("--impact-scale", String(rarity.scale));
    impact.style.setProperty(
      "--impact-start-opacity", discovered ? "0.98" : "0.42"
    );
    impact.style.setProperty(
      "--impact-brightness", discovered ? "1.18" : "0.72"
    );
    impact.style.setProperty(
      "--impact-saturation", discovered ? "1.12" : "0.62"
    );
    impact.style.setProperty(
      "--impact-glow", discovered ? rarity.glowNew : rarity.glowRepeat
    );
    host.appendChild(impact);
    setTimeout(() => impact.remove(), 900);
    return impact;
  }

  EFFECTS.beginCombine = function (workspace, source, target, x, y) {
    EFFECTS.setCombineTarget(target, true);
    source?.classList.add("combine-source");
    target?.classList.add("combine-source");

    let core = null;
    if (workspace && !prefersReducedMotion()) {
      core = document.createElement("div");
      core.className = "combine-core";
      core.setAttribute("aria-hidden", "true");
      core.style.left = x + "px";
      core.style.top = y + "px";
      workspace.appendChild(core);
    }

    let settled = false;
    function cleanup() {
      if (settled) return false;
      settled = true;
      EFFECTS.setCombineTarget(target, false);
      source?.classList.remove("combine-source");
      target?.classList.remove("combine-source");
      core?.remove();
      return true;
    }

    return {
      finish(meta = {}) {
        if (!cleanup()) return;
        spawnImpact(workspace || document.body, x, y, meta);
      },
      cancel() {
        cleanup();
      },
    };
  };

  // -------------------- 合成结果三档特效 --------------------
  const PERSONAL_COLORS = ["#32B8C6", "#6EDCE7", "#176B87", "#A7F3D0"];
  const GLOBAL_COLORS = ["#FFD54F", "#FF6B6B", "#34D399", "#4C8DFF", "#F472B6"];

  function spawnCelebration(target, tier, count) {
    if (prefersReducedMotion()) return;
    const { x, y } = centerOf(target);
    const colors = tier === "global_new" ? GLOBAL_COLORS : PERSONAL_COLORS;
    const layer = document.createElement("div");
    layer.className = "celebration-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);

    for (let i = 0; i < count; i++) {
      const particle = document.createElement("i");
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.22;
      const distance = tier === "global_new"
        ? 78 + Math.random() * 74
        : 52 + Math.random() * 40;
      particle.className = "celebration-particle";
      particle.dataset.tier = tier;
      particle.dataset.shape = i % 5 === 0 ? "star" : i % 2 === 0 ? "round" : "sliver";
      particle.style.left = x + "px";
      particle.style.top = y + "px";
      particle.style.setProperty("--particle-color", colors[i % colors.length]);
      particle.style.setProperty("--particle-x", Math.cos(angle) * distance + "px");
      particle.style.setProperty("--particle-y", Math.sin(angle) * distance + "px");
      particle.style.setProperty("--particle-turn", (120 + Math.random() * 300) + "deg");
      particle.style.setProperty("--particle-delay", (Math.random() * 90) + "ms");
      layer.appendChild(particle);
    }
    setTimeout(() => layer.remove(), 1250);
  }

  function spawnDiscoveryStamp(target, tier) {
    if (prefersReducedMotion()) return;
    const rect = target.getBoundingClientRect();
    const stamp = document.createElement("div");
    stamp.className = "discovery-stamp";
    stamp.dataset.tier = tier;
    stamp.textContent = tier === "global_new" ? "全球首发" : "我的新发现";
    stamp.style.left = (rect.left + rect.width / 2) + "px";
    stamp.style.top = Math.max(12, rect.top - 9) + "px";
    document.body.appendChild(stamp);
    setTimeout(() => stamp.remove(), 1500);
  }

  // tier: "seen" | "global_known" | "global_new"
  EFFECTS.onCombineResult = function (el, info, tier, meta = {}) {
    if (!el) return;
    if (tier === "global_new") {
      el.classList.add("reveal-global");
      if (!prefersReducedMotion()) {
        spawnCelebration(el, tier, window.innerWidth <= 560 ? 18 : 28);
        spawnDiscoveryStamp(el, tier);
      }
      setTimeout(() => el.classList.remove("reveal-global"), 1500);
    } else if (tier === "global_known") {
      el.classList.add("reveal-personal");
      if (!prefersReducedMotion()) {
        spawnCelebration(el, tier, window.innerWidth <= 560 ? 7 : 10);
        spawnDiscoveryStamp(el, tier);
      }
      setTimeout(() => el.classList.remove("reveal-personal"), 1100);
    } else {
      el.classList.add("pop-in");
      setTimeout(() => el.classList.remove("pop-in"), 500);
    }
    EFFECTS.firstToast(info, { tier, ...meta });
  };

  // -------------------- 分数飞行与等级融合 --------------------
  const SCORE_FLIGHT_MS = 1100;
  const SCORE_RESIDUE_MS = 1400;
  const SCORE_RECEIVE_MS = 450;
  const SCORE_JOB_CAP_MS = 4500;
  const scoreAnimationQueue = [];
  let scoreAnimationRunning = false;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  function scoreText(delta) {
    return "+" + String(delta) + " 分";
  }

  function showScoreResidue(target, delta) {
    if (!target?.isConnected) return null;
    const residue = document.createElement("span");
    residue.className = "score-gain-residue";
    residue.textContent = scoreText(delta);
    residue.setAttribute("aria-hidden", "true");
    target.appendChild(residue);
    setTimeout(() => residue.remove(), SCORE_RESIDUE_MS);
    return residue;
  }

  async function flyScore(source, target, delta) {
    if (!source || !target) return null;
    if (prefersReducedMotion()) {
      return showScoreResidue(target, delta);
    }
    if (!source.isConnected || !target.isConnected) return null;

    const from = centerOf(source);
    const to = centerOf(target);
    const flight = document.createElement("div");
    flight.className = "score-flight";
    flight.textContent = scoreText(delta);
    flight.setAttribute("aria-hidden", "true");
    flight.style.left = from.x + "px";
    flight.style.top = from.y + "px";
    flight.style.setProperty("--score-x", (to.x - from.x) + "px");
    flight.style.setProperty("--score-y", (to.y - from.y) + "px");
    flight.style.setProperty("--score-mid-x", ((to.x - from.x) * 0.48) + "px");
    flight.style.setProperty("--score-mid-y", ((to.y - from.y) * 0.48 - 44) + "px");
    document.body.appendChild(flight);

    try {
      await wait(SCORE_FLIGHT_MS);
      return showScoreResidue(target, delta);
    } finally {
      flight.remove();
    }
  }

  async function playScoreReceive(target) {
    if (!target?.isConnected) return;
    target.classList.add("score-receive");
    try {
      await wait(SCORE_RECEIVE_MS);
    } finally {
      target.classList.remove("score-receive");
    }
  }

  async function playGainStage(layer, step, duration) {
    const star = document.createElement("span");
    star.className = "level-gain-star";
    star.textContent = String(step.icon ?? "🌟");
    star.setAttribute("aria-hidden", "true");
    layer.appendChild(star);
    try {
      await wait(duration);
    } finally {
      star.remove();
    }
  }

  async function playMergeStage(layer, step, duration) {
    const stageNodes = [];
    for (let i = 0; i < 4; i++) {
      const source = document.createElement("span");
      source.className = "level-fusion-source";
      source.textContent = String(step.from ?? "");
      source.setAttribute("aria-hidden", "true");
      layer.appendChild(source);
      stageNodes.push(source);
    }
    const result = document.createElement("span");
    result.className = "level-fusion-result";
    result.textContent = String(step.to ?? "");
    result.setAttribute("aria-hidden", "true");
    layer.appendChild(result);
    stageNodes.push(result);

    try {
      const fuseDuration = Math.round(duration * 0.54);
      await wait(fuseDuration);
      if (layer.isConnected) result.classList.add("is-visible");
      await wait(duration - fuseDuration);
    } finally {
      stageNodes.forEach((node) => node.remove());
    }
  }

  async function runScoreAnimation(job) {
    const startedAt = performance.now();
    const target = job.target;
    await flyScore(job.source, target, job.delta);

    if (prefersReducedMotion()) {
      await playScoreReceive(target);
      return;
    }

    const steps = Array.isArray(job.steps) ? job.steps : [];
    if (!steps.length) {
      await playScoreReceive(target);
      return;
    }
    if (!target?.isConnected) return;

    const layer = document.createElement("span");
    layer.className = "score-level-effect-layer";
    layer.setAttribute("aria-hidden", "true");
    target.appendChild(layer);

    try {
      for (let index = 0; index < steps.length; index++) {
        if (!layer.isConnected) break;
        const remaining = SCORE_JOB_CAP_MS - (performance.now() - startedAt);
        if (remaining <= 0) break;

        const step = steps[index] || {};
        const shortened = steps.length > 4 && index >= 2;
        const duration = Math.min(
          remaining,
          shortened ? 420 : step.type === "gain" ? 720 : 760
        );
        if (step.type === "gain") {
          await playGainStage(layer, step, duration);
        } else if (step.type === "merge") {
          await playMergeStage(layer, step, duration);
        }
      }
    } finally {
      layer.remove();
      target.classList.remove("score-receive");
    }
  }

  async function drainScoreAnimations() {
    scoreAnimationRunning = true;
    while (scoreAnimationQueue.length) {
      const entry = scoreAnimationQueue.shift();
      try {
        await runScoreAnimation(entry.job);
      } catch (_) {
        // 单个目标消失或动画失败不能阻塞后续分数结算。
      } finally {
        try {
          entry.job.renderFinal?.();
        } catch (_) {
          // 最终渲染回调失败也必须释放队列。
        }
        entry.resolve();
      }
    }
    scoreAnimationRunning = false;
  }

  function enqueueScoreAnimation(job) {
    return new Promise((resolve) => {
      scoreAnimationQueue.push({ job, resolve });
      if (!scoreAnimationRunning) void drainScoreAnimations();
    });
  }

  EFFECTS.flyScore = function (source, target, delta) {
    return flyScore(source, target, delta);
  };

  EFFECTS.animateScoreGain = function (job = {}) {
    return enqueueScoreAnimation(job);
  };

  // 等级跃迁庆祝：已删除（用户反馈特效有 bug，且频繁打断体验）

  // -------------------- 首发 toast --------------------
  EFFECTS.firstToast = function (info, opt = {}) {
    const el = document.getElementById("first-toast");
    if (!el) return;
    const tier = opt.tier || (opt.small ? "global_known" : "global_new");
    const depthStr = opt.depth != null ? ` · 难度 ${opt.depth}` : "";
    const scoreStr = opt.gained != null ? ` · +${opt.gained}分` : "";
    window.COMBINE_FEEDBACK.renderToast(document, el, {
      ...info,
      tier,
      comment: opt.comment,
    });
    const title = el.querySelector(".first-toast-title");
    if (title) title.textContent += depthStr + scoreStr;
    el.className = "first-toast show tier-" + tier;
    clearTimeout(EFFECTS.firstToast._t);
    EFFECTS.firstToast._t = setTimeout(() => el.classList.remove("show"), 8000);
  };

  // -------------------- 里模式（ura mode · sticker 暗色主题切换）--------------------
  const KONAMI = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "b", "a",
  ];
  let uraOn = false;
  let bossModeInitialized = false;
  let konamiBuffer = [];

  function announceUraMode(initial) {
    window.dispatchEvent(new CustomEvent("ura-mode-change", {
      detail: {
        active: uraOn,
        initial: initial === true,
      },
    }));
  }

  function applyUraStableState(initial) {
    uraOn = true;
    const banner = document.getElementById("boss-banner");
    if (banner) {
      banner.textContent = "🤪 里模式·彻底疯狂 · ↑↑↓↓←→←→BA 再按可关闭";
      banner.classList.add("show");
    }
    document.body.classList.add("ura-on");
    announceUraMode(initial);
  }

  function enterUra() {
    if (uraOn) return;
    uraOn = true;
    // 后续手动进入仍保留当前动画，方便以后单独重做这一段。
    playUraEnterTransition();
    setTimeout(() => {
      if (!uraOn) return;
      applyUraStableState(false);
    }, 600);
  }

  function exitUra() {
    if (!uraOn) return;
    uraOn = false;
    const banner = document.getElementById("boss-banner");
    if (banner) banner.classList.remove("show");
    document.body.classList.remove("ura-on");
    announceUraMode(false);
    playUraExitTransition();
  }

  function toggleUra() {
    if (uraOn) exitUra();
    else enterUra();
  }

  EFFECTS.isUraMode = function () {
    return uraOn;
  };

  EFFECTS.initBossMode = function ({ defaultOn = true } = {}) {
    if (!bossModeInitialized) {
      window.addEventListener("keydown", (event) => {
        const tag = (event.target?.tagName || "").toLowerCase();
        if (
          tag === "input"
          || tag === "textarea"
          || event.target?.isContentEditable
        ) {
          konamiBuffer = [];
          return;
        }
        konamiBuffer.push(event.key);
        if (konamiBuffer.length > KONAMI.length) {
          konamiBuffer = konamiBuffer.slice(-KONAMI.length);
        }
        if (
          konamiBuffer.length === KONAMI.length
          && konamiBuffer.every(
            (key, index) => key.toLowerCase() === KONAMI[index].toLowerCase(),
          )
        ) {
          toggleUra();
          konamiBuffer = [];
        }
      });
      bossModeInitialized = true;
    }
    if (defaultOn && !uraOn) {
      applyUraStableState(true);
    }
  };

  // ---------- 里模式进场装饰层（不含背景，背景由 .workspace::before 做） ----------
  function playUraEnterTransition() {
    const overlay = document.createElement("div");
    overlay.className = "ura-transition ura-enter";
    overlay.innerHTML = `
      <div class="ura-fx">
        <div class="ura-flash"></div>
        <div class="ura-lightning">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M52 0 L30 42 L48 42 L20 100 L62 44 L44 44 L70 0 Z"
                  fill="none" stroke="#FFF" stroke-width="1.2"/>
          </svg>
        </div>
        <div class="ura-moon">🌕</div>
        <div class="ura-title">
          <div class="ura-title-kicker">~ 里模式 ~</div>
          <div class="ura-title-main">🤪 彻底疯狂 🤪</div>
          <div class="ura-title-sub">班味已达临界 · 理智正在蒸发</div>
        </div>
        <div class="ura-ring"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("run"));
    uraEnterChime();

    // 装饰层用时 2.7s（月亮先降 → 雷电 → 600ms 后夜幕下来 → 标题/光环 → 淡出）
    setTimeout(() => overlay.remove(), 2700);
  }

  // ---------- 退出里模式装饰层 ----------
  function playUraExitTransition() {
    const overlay = document.createElement("div");
    overlay.className = "ura-transition ura-exit";
    overlay.innerHTML = `
      <div class="ura-fx">
        <div class="ura-rays"></div>
        <div class="ura-sun">☀️</div>
        <div class="ura-title ura-exit-title">
          <div class="ura-title-kicker">~ 恢复表模式 ~</div>
          <div class="ura-title-main">☀️ 理智回归 ☀️</div>
          <div class="ura-title-sub">班味降温，体面继续</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("run"));
    uraExitChime();

    setTimeout(() => overlay.remove(), 1800);
  }

  // ---------- 音效 ----------
  function uraEnterChime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      // 低频嗡鸣 + 上行扫频：黑暗降临的感觉
      const drone = audioCtx.createOscillator();
      const droneGain = audioCtx.createGain();
      drone.type = "sawtooth";
      drone.frequency.setValueAtTime(55, now);
      drone.frequency.exponentialRampToValueAtTime(110, now + 1.2);
      droneGain.gain.setValueAtTime(0.001, now);
      droneGain.gain.exponentialRampToValueAtTime(0.18, now + 0.3);
      droneGain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
      drone.connect(droneGain).connect(audioCtx.destination);
      drone.start(now); drone.stop(now + 2.1);

      // 两声闪电噼啪（白噪声短促）
      [0.4, 1.0].forEach((t) => {
        const dur = 0.12;
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;
        const ng = audioCtx.createGain();
        ng.gain.setValueAtTime(0.25, now + t);
        ng.gain.exponentialRampToValueAtTime(0.001, now + t + dur);
        noise.connect(ng).connect(audioCtx.destination);
        noise.start(now + t);
        noise.stop(now + t + dur + 0.02);
      });
    } catch (_) { /* 忽略 */ }
  }

  function uraExitChime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      // 明亮的上行琶音
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, now + i * 0.1);
        g.gain.setValueAtTime(0.15, now + i * 0.1);
        g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
        osc.connect(g).connect(audioCtx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.32);
      });
    } catch (_) { /* 忽略 */ }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  window.EFFECTS = EFFECTS;
})();
