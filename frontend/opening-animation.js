(function (global) {
  "use strict";

  const CONFIG = Object.freeze({
    prefilledTokens: 18,
    prefilledFragments: 16,
    fragmentsPerEmission: 2,
    emissionIntervalMs: 720,
    tokenTravelMs: 13_200,
    maxTokens: 36,
    maxFragments: 48,
    pathSamples: 360,
  });

  function branchForNickname(nickname) {
    return String(nickname || "").trim() ? "returning" : "first-time";
  }

  function createSpiralPoints(definition, count = CONFIG.pathSamples) {
    const points = [];
    const total = Math.max(2, Math.trunc(count));
    for (let index = 0; index <= total; index += 1) {
      const progress = index / total;
      const angle =
        definition.phase + definition.turns * Math.PI * 2 * progress;
      const envelope =
        16 * progress * progress * (1 - progress) * (1 - progress);
      const radius =
        definition.startRadius +
        (definition.endRadius - definition.startRadius) * progress +
        Math.sin(progress * Math.PI * 7) * definition.wave * envelope;
      points.push({
        x: definition.centerX + Math.cos(angle) * radius,
        y:
          definition.centerY +
          Math.sin(angle) * radius * definition.verticalScale,
        radius,
      });
    }
    return points;
  }

  function samplePath(path, count = CONFIG.pathSamples) {
    const total = Math.max(2, Math.trunc(count));
    const length = path.getTotalLength();
    const raw = [];
    for (let index = 0; index <= total; index += 1) {
      raw.push(path.getPointAtLength((length * index) / total));
    }
    return raw.map((point, index) => {
      const previous = raw[Math.max(0, index - 1)];
      const next = raw[Math.min(raw.length - 1, index + 1)];
      return {
        x: point.x,
        y: point.y,
        angle: Math.atan2(next.y - previous.y, next.x - previous.x),
      };
    });
  }

  function parabolicPoint(origin, destination, progress, lift) {
    const bounded = Math.max(0, Math.min(1, Number(progress) || 0));
    return {
      x: origin.x + (destination.x - origin.x) * bounded,
      y:
        origin.y +
        (destination.y - origin.y) * bounded -
        4 * lift * bounded * (1 - bounded),
    };
  }

  function motionSample(samples, elapsed, duration) {
    if (!samples.length) return null;
    const progress = Math.max(
      0,
      Math.min(1, (Number(elapsed) || 0) / Math.max(1, duration)),
    );
    const index = Math.min(
      samples.length - 1,
      Math.floor(progress * (samples.length - 1)),
    );
    return samples[index];
  }

  function animationMode({ reducedMotion, hasDrawable }) {
    return reducedMotion || !hasDrawable ? "static" : "live";
  }

  function finalePlan(mode) {
    if (mode === "static") {
      return Object.freeze({
        absorbMs: 0,
        fragmentMs: 0,
        revealAtMs: 0,
        totalMs: 180,
      });
    }
    return Object.freeze({
      absorbMs: 360,
      fragmentMs: 280,
      revealAtMs: 160,
      totalMs: 520,
    });
  }

  function identityModel(branch, nickname) {
    const normalizedNickname = String(nickname || "").trim();
    if (branch === "returning") {
      return {
        title: "欢迎回来",
        subtitle: "你的合成档案已经就绪",
        nickname: normalizedNickname,
        actions: [
          { id: "continue", label: "继续使用", primary: true },
          { id: "change", label: "更改花名", primary: false },
        ],
      };
    }
    if (branch === "change") {
      return {
        title: "选择新的花名",
        subtitle: "候选花名由系统随机生成",
        nickname: normalizedNickname,
        actions: [
          { id: "reroll", label: "再来一个", primary: false },
          { id: "cancel", label: "取消", primary: false },
          { id: "confirm", label: "确认更改", primary: true },
        ],
      };
    }
    return {
      title: "请确认你的花名",
      subtitle: "这是你在无限合成世界里的身份",
      nickname: normalizedNickname,
      actions: [
        { id: "reroll", label: "再来一个", primary: false },
        { id: "confirm", label: "确认花名并进入", primary: true },
      ],
    };
  }

  function createButton(documentRef, action) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className =
      "opening-action" +
      (action.primary ? " opening-action-primary" : "");
    button.dataset.openingAction = action.id;
    button.textContent = action.label;
    return button;
  }

  function createVortexRuntime(options, stage) {
    const documentRef = options.document;
    const windowRef = documentRef.defaultView || global;
    const animeObject = options.anime;
    const iconSystem = options.iconSystem;
    const reducedMotion = windowRef.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    const mode = animationMode({
      reducedMotion,
      hasDrawable: Boolean(
        animeObject?.svg?.createDrawable && animeObject?.animate,
      ),
    });
    const staticMode = mode === "static";
    const plan = finalePlan(mode);
    const tokenLayer = documentRef.getElementById("opening-token-layer");
    const fragmentLayer = documentRef.getElementById("opening-fragment-layer");
    const birthLayer = documentRef.getElementById("opening-birth-layer");
    const pathGroup = documentRef.getElementById("opening-feed-paths");
    const starterElements = options.starterElements?.length
      ? options.starterElements
      : [{ name: "灵感", emoji: "✨", category: "unknown", is_starter: true }];
    const center = { x: 500, y: 296 };
    const pathDefinitions = [
      { phase: 0, turns: 2.3, startRadius: 485, endRadius: 36, wave: 22 },
      { phase: Math.PI, turns: 2.3, startRadius: 485, endRadius: 36, wave: -22 },
      { phase: Math.PI / 2, turns: 1.72, startRadius: 370, endRadius: 42, wave: 12 },
      { phase: Math.PI * 1.5, turns: 1.72, startRadius: 370, endRadius: 42, wave: -12 },
    ].map((definition) => ({
      centerX: center.x,
      centerY: center.y,
      verticalScale: 0.76,
      ...definition,
    }));
    const tokenPool = [];
    const fragmentPool = [];
    const tokenNodes = new Set();
    const fragmentNodes = new Set();
    const motions = [];
    const throwingAnimations = new Set();
    const animeAnimations = new Set();
    const finaleAnimations = new Set();
    let frameId = 0;
    let emissionTimer = 0;
    let lastFrameAt = 0;
    let pausedAt = 0;
    let pathCursor = 0;
    let destroyed = false;
    let finalizing = false;

    function now() {
      return windowRef.performance?.now?.() || Date.now();
    }

    function requestFrame(callback) {
      return windowRef.requestAnimationFrame(callback);
    }

    function cancelFrame(id) {
      if (id) windowRef.cancelAnimationFrame(id);
    }

    function updateScale() {
      const scale = Math.min(
        1.22,
        Math.max(
          0.48,
          Math.min(windowRef.innerWidth / 1000, windowRef.innerHeight / 760),
        ),
      );
      stage.style.setProperty("--opening-stage-scale", String(scale));
    }

    function buildPaths() {
      const namespace = "http://www.w3.org/2000/svg";
      return pathDefinitions.map((definition, index) => {
        const points = createSpiralPoints(definition);
        const d = points
          .map((point, pointIndex) =>
            `${pointIndex ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
          )
          .join(" ");
        const energy = documentRef.createElementNS(namespace, "path");
        energy.setAttribute("class", "opening-feed-path-energy");
        energy.setAttribute("d", d);
        energy.style.animationDelay = `${index * -3.1}s`;
        pathGroup.appendChild(energy);
        const path = documentRef.createElementNS(namespace, "path");
        path.setAttribute("class", "opening-feed-path");
        path.setAttribute("d", d);
        path.style.animationDelay = `${index * -2.4}s`;
        pathGroup.appendChild(path);
        const samples = samplePath(path, CONFIG.pathSamples).map(
          (sample, sampleIndex) => ({
            ...sample,
            radius: points[Math.min(points.length - 1, sampleIndex)].radius,
          }),
        );
        return { path, energy, samples };
      });
    }

    function renderToken(node, element) {
      node.className = "opening-token element is-starter";
      node.hidden = false;
      iconSystem.renderElement(documentRef, node, {
        name: element.name,
        emoji: element.emoji,
        category: element.category,
        icon: element.icon,
        isStarter: true,
        size: "detail",
      });
    }

    function acquireToken(element) {
      let node = tokenPool.pop();
      if (!node && tokenNodes.size < CONFIG.maxTokens) {
        node = documentRef.createElement("div");
        tokenNodes.add(node);
        tokenLayer.appendChild(node);
      }
      if (!node) return null;
      renderToken(node, element);
      node.style.opacity = "1";
      return node;
    }

    function releaseToken(node) {
      if (!node || !tokenNodes.has(node)) return;
      node.hidden = true;
      node.style.transform = "";
      tokenPool.push(node);
    }

    function acquireFragment(index = 0) {
      let node = fragmentPool.pop();
      if (!node && fragmentNodes.size < CONFIG.maxFragments) {
        node = documentRef.createElement("i");
        fragmentNodes.add(node);
        fragmentLayer.appendChild(node);
      }
      if (!node) return null;
      node.className = "opening-fragment";
      node.hidden = false;
      node.style.opacity = String(0.32 + (index % 5) * 0.1);
      return node;
    }

    function releaseFragment(node) {
      if (!node || !fragmentNodes.has(node)) return;
      node.hidden = true;
      node.style.transform = "";
      fragmentPool.push(node);
    }

    function addTrack(node, pathRecord, progress, duration, kind) {
      motions.push({
        node,
        kind,
        samples: pathRecord.samples,
        duration,
        trackStartedAt: now() - progress * duration,
        spin: ((motions.length % 7) - 3) * 0.055,
      });
    }

    function renderMotion(motion, frameNow) {
      const elapsed = frameNow - motion.trackStartedAt;
      const sample = motionSample(motion.samples, elapsed, motion.duration);
      if (!sample) return true;
      const progress = Math.max(0, Math.min(1, elapsed / motion.duration));
      const rotation = sample.angle * 0.12 + motion.spin + progress * 0.45;
      const scale =
        motion.kind === "token"
          ? 0.84 + Math.sin(progress * Math.PI) * 0.14
          : 0.72 + Math.sin(progress * Math.PI * 2) * 0.24;
      motion.node.style.transform =
        `translate3d(${sample.x}px, ${sample.y}px, 0) ` +
        `translate(-50%, -50%) rotate(${rotation}rad) scale(${scale})`;
      if (progress > 0.9) {
        motion.node.style.opacity = String((1 - progress) / 0.1);
      }
      return progress >= 1;
    }

    function renderFrame(frameNow) {
      if (destroyed || pausedAt) return;
      if (frameNow - lastFrameAt < 25) {
        frameId = requestFrame(renderFrame);
        return;
      }
      lastFrameAt = frameNow;
      for (let index = motions.length - 1; index >= 0; index -= 1) {
        const motion = motions[index];
        if (!renderMotion(motion, frameNow)) continue;
        motions.splice(index, 1);
        if (motion.kind === "token") releaseToken(motion.node);
        else releaseFragment(motion.node);
      }
      frameId = requestFrame(renderFrame);
    }

    function createBirthRing() {
      const ring = documentRef.createElement("i");
      ring.className = "opening-birth-ring";
      birthLayer.appendChild(ring);
      windowRef.setTimeout(() => ring.remove(), 760);
    }

    function throwToPath(node, pathRecord, kind, duration) {
      const destination = pathRecord.samples[0];
      const lift = kind === "token" ? 118 : 72;
      const keyframes = [0, 0.25, 0.5, 0.75, 1].map((progress) => {
        const point = parabolicPoint(center, destination, progress, lift);
        return {
          transform:
            `translate3d(${point.x}px, ${point.y}px, 0) ` +
            `translate(-50%, -50%) rotate(${progress * 0.72}rad) ` +
            `scale(${0.58 + progress * 0.34})`,
          opacity: progress < 0.08 ? 0 : 1,
        };
      });
      const animation = node.animate?.(keyframes, {
        duration: kind === "token" ? 820 : 680,
        easing: "cubic-bezier(.2,.74,.25,1)",
        fill: "forwards",
      });
      if (!animation) {
        addTrack(node, pathRecord, 0, duration, kind);
        renderMotion(motions[motions.length - 1], now());
        return;
      }
      throwingAnimations.add(animation);
      animation.finished
        .then(() => {
          throwingAnimations.delete(animation);
          if (destroyed || finalizing) return;
          addTrack(node, pathRecord, 0, duration, kind);
          renderMotion(motions[motions.length - 1], now());
          animation.cancel();
        })
        .catch(() => {});
    }

    function emit() {
      if (destroyed || finalizing || pausedAt) return;
      const pathRecord = pathRecords[pathCursor % pathRecords.length];
      pathCursor += 1;
      const element =
        starterElements[Math.floor(Math.random() * starterElements.length)];
      const token = acquireToken(element);
      if (token) {
        token.style.transform =
          `translate3d(${center.x}px, ${center.y}px, 0) ` +
          "translate(-50%, -50%) scale(.45)";
        createBirthRing();
        throwToPath(token, pathRecord, "token", CONFIG.tokenTravelMs);
      }
      for (let index = 0; index < CONFIG.fragmentsPerEmission; index += 1) {
        const fragment = acquireFragment(index);
        if (!fragment) continue;
        fragment.style.transform =
          `translate3d(${center.x}px, ${center.y}px, 0) ` +
          "translate(-50%, -50%) scale(.4)";
        throwToPath(
          fragment,
          pathRecords[(pathCursor + index) % pathRecords.length],
          "fragment",
          CONFIG.tokenTravelMs * (0.68 + index * 0.08),
        );
      }
    }

    function scheduleEmission() {
      windowRef.clearInterval(emissionTimer);
      emissionTimer = windowRef.setInterval(emit, CONFIG.emissionIntervalMs);
    }

    function initAnimeEffects() {
      if (staticMode) return;
      try {
        const mainDrawable = animeObject.svg.createDrawable(
          "#opening-infinity-main",
        );
        const detailDrawable = animeObject.svg.createDrawable(
          "#opening-infinity-detail",
        );
        animeAnimations.add(animeObject.animate(mainDrawable, {
          draw: ["0 0", "0 1", "1 1", "0 0"],
          duration: 5_200,
          ease: "inOutQuad",
          loop: true,
        }));
        animeAnimations.add(animeObject.animate(detailDrawable, {
          draw: ["0 0", ".12 .48", ".58 1", "1 1"],
          duration: 3_100,
          delay: 600,
          ease: "inOutSine",
          loop: true,
        }));
      } catch (error) {
        console.warn("opening infinity animation unavailable", error);
      }
    }

    function pause() {
      if (destroyed || pausedAt) return;
      pausedAt = now();
      cancelFrame(frameId);
      frameId = 0;
      windowRef.clearInterval(emissionTimer);
      emissionTimer = 0;
      animeAnimations.forEach((animation) => animation.pause?.());
      throwingAnimations.forEach((animation) => animation.pause?.());
    }

    function resume() {
      if (destroyed || !pausedAt || finalizing) return;
      const hiddenDuration = now() - pausedAt;
      motions.forEach((motion) => {
        motion.trackStartedAt += hiddenDuration;
      });
      pausedAt = 0;
      animeAnimations.forEach((animation) => animation.resume?.());
      throwingAnimations.forEach((animation) => animation.play?.());
      lastFrameAt = 0;
      frameId = requestFrame(renderFrame);
      scheduleEmission();
    }

    function onVisibilityChange() {
      if (documentRef.hidden) pause();
      else resume();
    }

    function beginFinale() {
      if (finalizing) return;
      finalizing = true;
      windowRef.clearInterval(emissionTimer);
      emissionTimer = 0;
      cancelFrame(frameId);
      frameId = 0;
      throwingAnimations.forEach((animation) => animation.cancel?.());
      throwingAnimations.clear();
      animeAnimations.forEach((animation) => animation.pause?.());
      const visibleTokens = [...tokenNodes].filter((node) => !node.hidden);
      if (staticMode) {
        visibleTokens.forEach((node) => {
          node.style.opacity = "0";
        });
        fragmentLayer.style.opacity = "0";
        return;
      }
      visibleTokens.forEach((node, index) => {
        if (!node.animate) {
          node.style.opacity = "0";
          return;
        }
        const animation = node.animate(
          [
            { transform: node.style.transform, opacity: node.style.opacity || 1 },
            {
              transform:
                `translate3d(${center.x}px, ${center.y}px, 0) ` +
                "translate(-50%, -50%) rotate(.7rad) scale(.06)",
              opacity: 0,
            },
          ],
          {
            duration: plan.absorbMs,
            delay: Math.min(40, index * 3),
            easing: "cubic-bezier(.5,.02,.28,1)",
            fill: "forwards",
          },
        );
        finaleAnimations.add(animation);
      });
      if (fragmentLayer.animate) {
        fragmentLayer.style.transformOrigin = "500px 296px";
        const fragmentAnimation = fragmentLayer.animate(
          [
            { scale: 1, opacity: 1 },
            { scale: 0.12, opacity: 0 },
          ],
          {
            duration: plan.fragmentMs,
            easing: "cubic-bezier(.5,.02,.28,1)",
            fill: "forwards",
          },
        );
        finaleAnimations.add(fragmentAnimation);
      } else {
        fragmentLayer.style.opacity = "0";
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame(frameId);
      windowRef.clearInterval(emissionTimer);
      throwingAnimations.forEach((animation) => animation.cancel?.());
      animeAnimations.forEach((animation) => animation.cancel?.());
      finaleAnimations.forEach((animation) => animation.cancel?.());
      windowRef.removeEventListener("resize", updateScale);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      motions.length = 0;
      tokenNodes.clear();
      fragmentNodes.clear();
    }

    updateScale();
    stage.classList.toggle("is-static", staticMode);
    windowRef.addEventListener("resize", updateScale, { passive: true });
    documentRef.addEventListener("visibilitychange", onVisibilityChange);
    const pathRecords = buildPaths();
    const initialNow = now();
    const tokenCount = staticMode ? 6 : CONFIG.prefilledTokens;
    for (let index = 0; index < tokenCount; index += 1) {
      const token = acquireToken(starterElements[index % starterElements.length]);
      if (!token) continue;
      const progress = 0.055 + (index / tokenCount) * 0.86;
      addTrack(
        token,
        pathRecords[index % pathRecords.length],
        progress,
        CONFIG.tokenTravelMs,
        "token",
      );
      renderMotion(motions[motions.length - 1], initialNow);
    }
    if (!staticMode) {
      for (let index = 0; index < CONFIG.prefilledFragments; index += 1) {
        const fragment = acquireFragment(index);
        if (!fragment) continue;
        const progress =
          0.04 + (index / CONFIG.prefilledFragments) * 0.9;
        addTrack(
          fragment,
          pathRecords[index % pathRecords.length],
          progress,
          CONFIG.tokenTravelMs * 0.72,
          "fragment",
        );
        renderMotion(motions[motions.length - 1], initialNow);
      }
      frameId = requestFrame(renderFrame);
      scheduleEmission();
      initAnimeEffects();
    }
    return { beginFinale, destroy, mode, pause, resume };
  }

  async function start(options = {}) {
    const documentRef = options.document || global.document;
    const identity = options.identity;
    const stage = documentRef?.getElementById("opening-stage");
    if (!documentRef || !stage || !identity) {
      throw new Error("Opening stage requires document and identity adapter");
    }

    const card = documentRef.getElementById("opening-identity-card");
    const title = documentRef.getElementById("opening-card-title");
    const subtitle = documentRef.getElementById("opening-card-subtitle");
    const body = documentRef.getElementById("opening-card-body");
    const actions = documentRef.getElementById("opening-card-actions");
    const status = documentRef.getElementById("opening-card-status");
    const current = identity.current();
    const initialBranch = branchForNickname(current.nickname);
    let branch = initialBranch;
    let candidate = initialBranch === "returning" ? current.nickname : "";
    let busy = false;
    let finished = false;
    let runtime;

    try {
      runtime = createVortexRuntime(
        { ...options, document: documentRef },
        stage,
      );
    } catch (error) {
      console.warn("opening vortex runtime unavailable", error);
      runtime = {
        beginFinale() {},
        destroy() {},
        mode: "static",
      };
    }

    function setBusy(nextBusy, message = "") {
      busy = nextBusy;
      actions.querySelectorAll("button").forEach((button) => {
        button.disabled = nextBusy;
      });
      status.textContent = message;
    }

    function render() {
      const model = identityModel(branch, candidate);
      title.textContent = model.title;
      subtitle.textContent = model.subtitle;
      body.replaceChildren();
      const nickname = documentRef.createElement("div");
      nickname.className = "opening-nickname";
      nickname.textContent = model.nickname || "🎲 正在生成…";
      body.appendChild(nickname);
      actions.replaceChildren(
        ...model.actions.map((action) => createButton(documentRef, action)),
      );
    }

    async function loadCandidate() {
      setBusy(true, "正在生成候选花名…");
      candidate = await identity.peek();
      render();
      setBusy(false);
    }

    async function finish(result) {
      if (finished) return;
      finished = true;
      actions.removeEventListener("click", onAction);
      documentRef.removeEventListener("keydown", onKeyDown);
      const plan = finalePlan(runtime.mode);
      stage.classList.add("is-finalizing");
      runtime.beginFinale();
      await wait(plan.revealAtMs);
      documentRef.body.classList.add("opening-finalizing");
      documentRef.body.classList.remove("opening-active");
      stage.classList.add("is-revealing");
      await wait(plan.totalMs - plan.revealAtMs);
      runtime.destroy();
      stage.remove();
      documentRef.body.classList.remove("opening-finalizing");
      options.revealTargets?.workspace?.focus?.();
      return result;
    }

    function wait(milliseconds) {
      return new Promise((resolve) => global.setTimeout(resolve, milliseconds));
    }

    let resolveStart;
    const completion = new Promise((resolve) => {
      resolveStart = resolve;
    });

    async function onAction(event) {
      const button = event.target.closest("[data-opening-action]");
      if (!button || busy || finished) return;
      const action = button.dataset.openingAction;

      if (action === "change") {
        branch = "change";
        render();
        await loadCandidate();
        return;
      }
      if (action === "cancel") {
        branch = "returning";
        candidate = current.nickname;
        status.textContent = "";
        render();
        return;
      }
      if (action === "reroll") {
        await loadCandidate();
        return;
      }
      if (action === "continue") {
        setBusy(true, "正在载入合成档案…");
        const persisted = await identity.continueCurrent();
        resolveStart(await finish({
          nickname: persisted.nickname,
          changed: false,
        }));
        return;
      }
      if (action === "confirm") {
        setBusy(true, "正在确认花名…");
        const claimed = await identity.claim(candidate);
        if (!claimed.accepted) {
          candidate = claimed.nickname;
          render();
          setBusy(false, "刚才的名字已被使用，已为你生成新候选，请再次确认。");
          return;
        }
        const persisted = identity.persist(claimed.nickname);
        resolveStart(await finish({
          nickname: persisted.nickname,
          changed: true,
        }));
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape" && branch === "change" && !busy) {
        event.preventDefault();
        branch = "returning";
        candidate = current.nickname;
        status.textContent = "";
        render();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        card.querySelectorAll("button:not(:disabled)"),
      );
      if (!focusable.length) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    actions.addEventListener("click", onAction);
    documentRef.addEventListener("keydown", onKeyDown);
    render();
    if (initialBranch === "first-time") await loadCandidate();
    card.focus();
    return completion;
  }

  global.OPENING_ANIMATION = Object.freeze({
    CONFIG,
    animationMode,
    branchForNickname,
    createSpiralPoints,
    finalePlan,
    identityModel,
    motionSample,
    parabolicPoint,
    samplePath,
    start,
  });
})(window);
