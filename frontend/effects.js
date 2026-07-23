/* ============================================================
   effects.js —— 创新玩法特效
   暴露到 window.EFFECTS：
     - explode(resultName)          P0 故障爆炸
     - firstToast(name, emoji, opt) 首发 / 新发现 toast
     - initBossMode(reRenderFn)     Konami → 老板视角
   ============================================================ */

(function () {
  const EFFECTS = {};

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

  // -------------------- 合成结果三档特效 --------------------
  // tier: "seen" | "global_known" | "global_new"
  EFFECTS.onCombineResult = function (el, name, emoji, tier, meta = {}) {
    if (!el) return;
    switch (tier) {
      case "global_new":
        fireworks(el);
        el.classList.add("glow-gold");
        setTimeout(() => el.classList.remove("glow-gold"), 4000);
        EFFECTS.firstToast(name, emoji, { tier: "global_new", ...meta });
        break;
      case "global_known":
        el.classList.add("glow-blue");
        setTimeout(() => el.classList.remove("glow-blue"), 3000);
        EFFECTS.firstToast(name, emoji, { tier: "global_known", ...meta });
        break;
      default:
        el.classList.add("pop-in");
        setTimeout(() => el.classList.remove("pop-in"), 500);
        EFFECTS.firstToast(name, emoji, { tier: "seen", ...meta });
        break;
    }
  };

  // 烟花：在目标元素位置放粒子
  function fireworks(target) {
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    spawnFireworkBurst(cx, cy, 28, 80, 60);
  }

  function spawnFireworkBurst(cx, cy, count = 28, baseDist = 80, jitter = 60) {
    const colors = ["#FFD54F", "#FF6B6B", "#4ECDC4", "#A78BFA", "#F472B6", "#34D399"];
    const container = document.createElement("div");
    container.className = "firework-container";
    document.body.appendChild(container);
    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      p.className = "firework-particle";
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
      const dist = baseDist + Math.random() * jitter;
      p.style.setProperty("--dx", (Math.cos(angle) * dist) + "px");
      p.style.setProperty("--dy", (Math.sin(angle) * dist) + "px");
      p.style.background = colors[i % colors.length];
      p.style.left = cx + "px";
      p.style.top = cy + "px";
      container.appendChild(p);
    }
    setTimeout(() => container.remove(), 1400);
  }

  // 段位跃迁庆祝：已删除（用户反馈特效有 bug，且频繁打断体验）

  // -------------------- 首发 toast --------------------
  EFFECTS.firstToast = function (name, emoji, opt = {}) {
    const el = document.getElementById("first-toast");
    if (!el) return;
    const tier = opt.tier || (opt.small ? "global_known" : "global_new");
    const depthStr = opt.depth != null ? ` · 难度 ${opt.depth}` : "";
    const scoreStr = opt.gained != null ? ` · +${opt.gained}分` : "";
    window.COMBINE_FEEDBACK.renderToast(document, el, {
      tier,
      name,
      emoji,
      comment: opt.comment,
    });
    const title = el.querySelector(".first-toast-title");
    if (title) title.textContent += depthStr + scoreStr;
    el.className = "first-toast show tier-" + tier;
    clearTimeout(EFFECTS.firstToast._t);
    EFFECTS.firstToast._t = setTimeout(() => el.classList.remove("show"), 4200);
  };

  // -------------------- 里模式（ura mode · 疯狂的可视化覆盖）--------------------
  // 设计：
  //   - 每个 .element / .recipe-chip 内部注入一个 .ura-emoji 和 .ura-name 兄弟 span
  //   - 平时这俩 span display:none（CSS 控制）
  //   - body.ura-on 时 ura-* 出现、原生 emoji/name 隐藏
  //   - hover 元素时翻转（CSS :hover），揭示真身
  //   - MutationObserver 监听整个 document，新节点出现时自动注入
  //   - 每个节点独立随机，同一元素跨次 ura 结果可以不同
  //   - 触发仍是 Konami Code
  const KONAMI = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "b", "a",
  ];
  // 疯狂中文词池
  const URA_POOL = [
    "闭环", "抓手", "颗粒度", "对齐", "赋能", "链路", "心智",
    "穿透", "下沉", "拉通", "协同", "赛道", "生态", "复盘",
    "抽象", "解构", "重构", "沉淀", "分润", "聚合", "放大",
    "方法论", "最小闭环", "颠颠", "发疯", "发癫", "破防",
    "松弛感", "紧绷感", "显眼包", "死者人格", "班味",
    "吗喽", "摆烂", "躺平", "内卷", "emo",
    "画饼", "讲故事", "拉齐预期", "赛马机制",
    "中台化", "用户心智", "高维打低维", "降本增效",
    "正反馈", "飞轮", "护城河", "第二曲线", "OKR拉通",
    "颠覆式创新", "破圈", "种草", "拔草", "长尾",
  ];
  // 疯狂 emoji 池（偏抽象 / 发疯 / 无厘头）
  const URA_EMOJI = [
    "🤪", "💀", "🌀", "🔥", "🤡", "👻", "🧠", "💥",
    "🫠", "🗿", "🥴", "🤯", "😵‍💫", "🫥", "🙃", "🥹",
    "⚡", "🌪️", "🎭", "🪩", "🕳️", "🔮", "🎲", "🎰",
    "💊", "🧨", "🦑", "🐙", "🫨", "🥶", "🥵", "👾",
  ];
  let uraOn = false;
  let observer = null;

  function randFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** 给一个 .element 或 .recipe-chip 注入（或更新）ura-emoji / ura-name 两个兄弟 span。 */
  function paintElement(el) {
    // chip 必须至少有 .emoji 和 .name，否则跳过
    const emojiSpan = el.querySelector(":scope > .emoji");
    const nameSpan = el.querySelector(":scope > .name");
    if (!emojiSpan || !nameSpan) return;

    let uraEmoji = el.querySelector(":scope > .ura-emoji");
    if (!uraEmoji) {
      uraEmoji = document.createElement("span");
      uraEmoji.className = "ura-emoji";
      emojiSpan.after(uraEmoji);
    }
    let uraName = el.querySelector(":scope > .ura-name");
    if (!uraName) {
      uraName = document.createElement("span");
      uraName.className = "ura-name";
      nameSpan.after(uraName);
    }
    uraEmoji.textContent = randFrom(URA_EMOJI);
    uraName.textContent = randFrom(URA_POOL);
  }

  function scanAndPaint(root = document) {
    // .element 覆盖 侧栏/画布/ghost/合成结果；.recipe-chip[data-name] 覆盖图鉴里非 "+" 的 chip
    const nodes = root.querySelectorAll?.(".element, .recipe-chip[data-name]") || [];
    nodes.forEach(paintElement);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (!uraOn) return;
      for (const m of muts) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          // 新节点本身可能是 .element，也可能是容器（比如合成结果套层）
          if (node.matches?.(".element, .recipe-chip[data-name]")) {
            paintElement(node);
          }
          scanAndPaint(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  EFFECTS.initBossMode = function (_reRenderFn) {
    let buf = [];
    window.addEventListener("keydown", (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) {
        buf = [];
        return;
      }
      buf.push(e.key);
      if (buf.length > KONAMI.length) buf = buf.slice(-KONAMI.length);
      if (buf.length === KONAMI.length
        && buf.every((k, i) => k.toLowerCase() === KONAMI[i].toLowerCase())) {
        toggleUra();
        buf = [];
      }
    });
  };

  function toggleUra() {
    uraOn = !uraOn;
    const banner = document.getElementById("boss-banner");
    if (uraOn) {
      // 顺序：先播月亮/闪电等装饰，延迟 600ms 再降夜幕
      // 让月亮先"从天而降"，画布才开始变暗
      playUraEnterTransition();
      setTimeout(() => {
        if (banner) {
          banner.textContent = "🤪 里模式·彻底疯狂 · ↑↑↓↓←→←→BA 再按可关闭";
          banner.classList.add("show");
        }
        document.body.classList.add("ura-on");
        scanAndPaint(document);
        startObserver();
      }, 600);
    } else {
      // 退场：先升幕布（body.ura-on 去掉），再播日出装饰
      if (banner) banner.classList.remove("show");
      document.body.classList.remove("ura-on");
      stopObserver();
      playUraExitTransition();
      // 不删除已注入的 ura-* span，下次开启直接重用 + 重新 randomize
    }
  }

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

  /** 供外部（app.js）在重渲染后调用，强制重新 paint 一轮（也顺便随机出新词）。 */
  EFFECTS.reapplyUra = function () {
    if (!uraOn) return;
    scanAndPaint(document);
  };

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  window.EFFECTS = EFFECTS;
})();
