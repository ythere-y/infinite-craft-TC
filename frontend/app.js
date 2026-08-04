/* ============================================================
   app.js —— 主游戏逻辑（pointer events 版，解决 D&D 卡顿）
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const workspace = $("#workspace");
const list = $("#element-list");
const searchInput = $("#search");
const countEl = $("#count");
const scoreLevelIconsEl = $("#score-level-icons");
const scoreDeltaEl = $("#kpi-delta");

function appendTextElement(parent, tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = String(text ?? "");
  parent.appendChild(node);
  return node;
}

// ---- 会话 & 昵称 ----
const SESSION_ID = (() => {
  let sid = localStorage.getItem("ic_session");
  if (!sid) {
    sid = "s_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ic_session", sid);
  }
  return sid;
})();

// 昵称：本地存 { id, name }。id 是短随机串，仅用于会话/分数标识；展示只显示 name
let NICKNAME = localStorage.getItem("ic_nick") || "";
let NICK_ID = localStorage.getItem("ic_nick_id") || "";

function generatePlayerId() {
  return "ic" + Math.random().toString(36).slice(2, 8);
}

function formatNickForDisplay() {
  if (!NICKNAME) return "🐧ID: 加载中…";
  return `🐧ID: ${NICKNAME}`;
}

function updateNickDisplay() {
  const el = document.getElementById("nick-display");
  if (el) el.textContent = formatNickForDisplay();
}

async function peekNicknameCandidate() {
  try {
    const response = await fetch("/api/nickname/peek").then((value) =>
      value.json()
    );
    return response.nickname;
  } catch (_) {
    return "神秘鹅_" + Math.random().toString(36).slice(2, 5);
  }
}

async function claimNicknameCandidate(candidate) {
  try {
    const response = await fetch("/api/nickname/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: candidate }),
    }).then((value) => value.json());
    return {
      accepted: response.ok !== false,
      nickname: response.nickname || candidate,
    };
  } catch (_) {
    return { accepted: true, nickname: candidate };
  }
}

function persistNickname(nickname) {
  NICKNAME = String(nickname);
  NICK_ID = NICK_ID || generatePlayerId();
  localStorage.setItem("ic_nick", NICKNAME);
  localStorage.setItem("ic_nick_id", NICK_ID);
  updateNickDisplay();
  return { nickname: NICKNAME, playerId: NICK_ID };
}

// 首次或主动改名流程
// - 首次：force=true，不显示"当前花名"和"取消"，必须确认才能关闭
// - 主动：force=false，显示原名和取消按钮
async function openNickModal(force = false) {
  const modal = document.getElementById("nick-modal");
  const curWrap = document.getElementById("nick-modal-current-wrap");
  const curEl = document.getElementById("nick-modal-current");
  const previewEl = document.getElementById("nick-modal-preview");
  const cancelBtn = document.getElementById("nick-modal-cancel");
  const rerollBtn = document.getElementById("nick-modal-reroll");
  const confirmBtn = document.getElementById("nick-modal-confirm");
  if (!modal) return;

  let candidate = null;

  async function peek() {
    previewEl.textContent = "🎲 加载中…";
    candidate = await peekNicknameCandidate();
    previewEl.textContent = candidate;
  }

  if (NICKNAME && !force) {
    curWrap.style.display = "";
    curEl.textContent = NICKNAME;
    cancelBtn.style.display = "";
  } else {
    curWrap.style.display = "none";
    cancelBtn.style.display = "none";
  }

  modal.classList.add("show");
  await peek();

  return new Promise((resolve) => {
    const onReroll = async () => { await peek(); };
    const onCancel = () => {
      cleanup();
      modal.classList.remove("show");
      resolve({ changed: false, nickname: NICKNAME });
    };
    const onConfirm = async () => {
      // 确认占用（若被抢了，后端会返回 fresh）
      const claimed = await claimNicknameCandidate(candidate);
      if (!claimed.accepted) {
        previewEl.textContent = claimed.nickname;
        alert(`⚠️ 上一个名字被抢了，已重抽：${claimed.nickname}`);
        candidate = claimed.nickname;
        return;  // 不关闭，让用户再确认一次
      }

      persistNickname(claimed.nickname);
      cleanup();
      modal.classList.remove("show");
      resolve({ changed: true, nickname: NICKNAME });
    };

    function cleanup() {
      rerollBtn.removeEventListener("click", onReroll);
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
    }

    rerollBtn.addEventListener("click", onReroll);
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

async function ensureNickname() {
  if (NICKNAME) {
    if (!NICK_ID) {
      NICK_ID = generatePlayerId();
      localStorage.setItem("ic_nick_id", NICK_ID);
    }
    // 静默重占一次：用 touch 端点，幂等 SETNX；
    // 防止服务端数据清空后本地 localStorage 还有旧名字，admin 统计漏记
    try {
      await fetch("/api/nickname/touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: NICKNAME }),
      });
    } catch (_) { /* 网络抖动就算了 */ }
    return;
  }
  // 首次进入：强制走模态，必须确认
  await openNickModal(true);
}

async function rerollNickname() {
  await openNickModal(false);
}

function createOpeningIdentityAdapter() {
  return {
    current() {
      return { nickname: NICKNAME, playerId: NICK_ID };
    },
    peek: peekNicknameCandidate,
    claim: claimNicknameCandidate,
    async continueCurrent() {
      if (!NICK_ID) persistNickname(NICKNAME);
      try {
        await fetch("/api/nickname/touch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: NICKNAME }),
        });
      } catch (_) { /* best-effort touch */ }
      return { nickname: NICKNAME, playerId: NICK_ID };
    },
    persist: persistNickname,
  };
}

// ---- 状态 ----
function normalizeElementInfo(name, info = {}) {
  return {
    name: String(name || info.name || ""),
    emoji: String(info.emoji || "❔"),
    category: info.category || "unknown",
    icon: info.icon,
    is_starter: !!info.is_starter,
  };
}

function elementInfoFor(name, fallback = {}) {
  return normalizeElementInfo(name, {
    ...fallback,
    ...(state.elements[name] || {}),
    icon: fallback.icon || state.elements[name]?.icon,
    emoji: fallback.emoji || state.elements[name]?.emoji,
  });
}

function renderGameElement(target, info, options = {}) {
  const payload = {
    name: info.name,
    emoji: info.emoji,
    category: info.category,
    icon: info.icon,
    isStarter: info.is_starter,
    ...options,
  };
  target.__elementInfo = payload;
  window.COMBINE_FEEDBACK.renderElement(document, target, payload);
}

const state = {
  elements: {},
  firsts: new Set(JSON.parse(localStorage.getItem("ic_firsts") || "[]")),
  discovered: new Set(JSON.parse(localStorage.getItem("ic_discovered") || "[]")),
  // Legacy records with only `emoji` remain valid; renderers normalize them.
  recipes: JSON.parse(localStorage.getItem("ic_recipes") || "[]"),
  scoreEvents: JSON.parse(localStorage.getItem("ic_scores") || "[]"),
  score: window.SCORE_LEVEL.normalizeScore(localStorage.getItem("ic_kpi")),
  onCanvas: [],
  nextId: 1,
};

const NOOP_RECIPE_LINKS = Object.freeze({
  sync() {},
  scheduleGeometryUpdate() {},
  clear() {},
  destroy() {},
});

function createRecipeLinks() {
  try {
    return window.RECIPE_LINKS?.create?.(workspace) || NOOP_RECIPE_LINKS;
  } catch (error) {
    console.warn("recipe links unavailable", error);
    return NOOP_RECIPE_LINKS;
  }
}

const recipeLinks = createRecipeLinks();

function recipeLinkSnapshots() {
  const recipes = state.recipes.map((recipe) => ({
    key: recipe.key,
    a: recipe.a,
    b: recipe.b,
    hit_count: Math.max(1, Number(recipe.hit_count) || 1),
    depth: Number(recipe.depth) || 0,
  }));
  const elements = state.onCanvas.map(({ id, name, x, y }) => ({
    id,
    name,
    x,
    y,
  }));
  return { recipes, elements };
}

function syncRecipeLinks() {
  const { recipes, elements } = recipeLinkSnapshots();
  recipeLinks.sync({ recipes, elements });
}

function moveRecipeLinks() {
  const { elements } = recipeLinkSnapshots();
  recipeLinks.scheduleGeometryUpdate(elements);
}

// 拖拽上下文
const drag = {
  active: null,        // {ghost, info, sourceId|null, offsetX, offsetY}
  hoverTarget: null,   // 当前悬停的 canvas 元素 record
};

function setDragTarget(record, active) {
  if (!record?.el) return;
  record.el.classList.toggle("dropping", !!active);
  window.EFFECTS?.setCombineTarget?.(record.el, active);
}

// ============================================================
// 初始化
// ============================================================
async function init() {
  await window.ICON_SYSTEM.ready;
  window.CASINO_MODE?.init?.({ awardScore: awardCasinoScore });
  window.EFFECTS?.initBossMode?.({ defaultOn: false });
  await loadElements();
  window.ICON_SYSTEM.hydrateActions(document);
  renderHomeLevel();
  await runOpeningIdentity();
  updateNickDisplay();
  bindSearch();
  bindButtons();
  bindGlobalPointerEvents();
  // 初始化右下角图鉴按钮计数
  const c = document.getElementById("recipebook-btn-count");
  if (c) c.textContent = state.recipes.length;
}

async function runOpeningIdentity() {
  if (!document.body.classList.contains("opening-active")) {
    await ensureNickname();
    return;
  }
  try {
    const openingResult = await window.OPENING_ANIMATION.start({
      document,
      anime: window.anime,
      iconSystem: window.ICON_SYSTEM,
      starterElements: Object.values(state.elements).filter(
        (element) => element.is_starter,
      ),
      identity: createOpeningIdentityAdapter(),
      revealTargets: {
        topbar: document.querySelector(".topbar"),
        sidebar: document.querySelector(".sidebar"),
        hint: document.getElementById("hint"),
        workspace,
      },
    });
    NICKNAME = openingResult.nickname;
  } catch (error) {
    console.error("opening animation unavailable", error);
    document.body.classList.remove("opening-active", "opening-finalizing");
    document.getElementById("opening-stage")?.remove();
    await ensureNickname();
  }
}

async function loadElements() {
  try {
    const [starters, all] = await Promise.all([
      fetch("/api/starters").then(r => r.json()),
      fetch("/api/elements").then(r => r.json()),
    ]);
    Object.entries(all.elements).forEach(([name, info]) => {
      state.elements[name] = normalizeElementInfo(name, info);
    });
    starters.starters.forEach(s => {
      state.elements[s.name] = normalizeElementInfo(s.name, {
        ...state.elements[s.name],
        ...s,
        is_starter: true,
      });
      state.discovered.add(s.name);
    });
    persistDiscovered();
    renderSidebar();
  } catch (e) {
    console.error("loadElements failed", e);
    alert("加载初始元素失败，检查后端是否启动");
  }
}

// ============================================================
// 侧栏
// ============================================================
function renderSidebar(filter = "") {
  list.replaceChildren();
  const q = filter.trim().toLowerCase();
  const names = [...state.discovered].sort((a, b) => a.localeCompare(b, "zh"));
  for (const name of names) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const info = elementInfoFor(name);
    if (!info) continue;
    const chip = makeElementChip(info, {
      isFirst: state.firsts.has(name),
      source: "sidebar",
    });
    list.appendChild(chip);
    window.ICON_SYSTEM?.fitSidebarChip?.(chip);
  }
  countEl.textContent = state.discovered.size;
  scheduleSidebarFit();
}

function fitAllSidebarChips() {
  list.querySelectorAll(":scope > .element").forEach((chip) => {
    window.ICON_SYSTEM?.fitSidebarChip?.(chip);
  });
}

let sidebarFitFrame = 0;
function scheduleSidebarFit() {
  if (sidebarFitFrame) return;
  sidebarFitFrame = requestAnimationFrame(() => {
    sidebarFitFrame = 0;
    fitAllSidebarChips();
  });
}

if (typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleSidebarFit).observe(list);
}

function makeElementChip(info, { isFirst = false, source = "sidebar" } = {}) {
  const div = document.createElement("div");
  const classes = ["element"];
  if (isFirst) classes.push("first-discovery");
  if (info.is_starter) classes.push("is-starter");
  div.className = classes.join(" ");
  div.dataset.name = info.name;
  div.dataset.source = source;
  if (info.is_starter) div.title = "🌱 基础元素（开局自带）";
  renderGameElement(div, info, { isFirst });
  div.addEventListener("pointerdown", (e) => onPointerDown(e, div, info, source));
  bindElementTap(div, {
    onClick: () => {
      const point = randomWorkspacePoint(workspace.getBoundingClientRect());
      spawnOnCanvas(info, point.x, point.y);
      window.AUDIO_FEEDBACK?.playElementClick?.();
    },
  });
  return div;
}

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

/**
 * 在元素自己的 pointerup 阶段抢先结束轻触产生的临时 drag，
 * 再将同一元素上的快速鼠标轻触分发为单击或双击动作。
 */
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
      lastTap > 0 &&
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
  el.addEventListener("pointercancel", () => {
    lastTap = 0;
  });
  el.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

/** 如果当前正在 drag，取消并清理（用于 double-tap 抢占时）。 */
function cancelActiveDrag() {
  finishActiveDrag();
}

function finishActiveDrag() {
  if (!drag.active) return null;
  const active = drag.active;
  const target = drag.hoverTarget;
  const { ghost } = active;
  ghost?.remove();
  setDragTarget(drag.hoverTarget, false);
  document.querySelectorAll(".element.dragging").forEach(el => el.classList.remove("dragging"));
  drag.active = null;
  drag.hoverTarget = null;
  document.body.classList.remove("drag-active");
  return { active, target };
}

// ============================================================
// Pointer events 拖拽系统
// ============================================================
function onPointerDown(e, el, info, source) {
  if (e.button !== 0) return;        // 只处理左键
  window.AUDIO_FEEDBACK?.unlock?.();
  e.preventDefault();

  const rect = el.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  // 若来自 canvas 上一个已有元素，要记录它的 id
  const sourceId = source === "canvas" ? Number(el.dataset.id) : null;

  // 创建 ghost（跟手的元素副本）
  const ghost = document.createElement("div");
  ghost.className = "element ghost";
  renderGameElement(ghost, info, { size: "canvas", dragging: true });
  ghost.style.position = "fixed";
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "999";
  document.body.appendChild(ghost);

  drag.active = {
    ghost,
    info,
    sourceId,
    offsetX,
    offsetY,
    startX: e.clientX,
    startY: e.clientY,
  };
  document.body.classList.add("drag-active");

  // 如果是 canvas 元素，立刻隐藏原位（视觉上只留 ghost）
  if (sourceId != null) {
    const rec = state.onCanvas.find(r => r.id === sourceId);
    if (rec) rec.el.classList.add("dragging");
  } else {
    el.classList.add("dragging");
  }

  // 捕获指针：避免光标移出元素后丢失事件
  el.setPointerCapture?.(e.pointerId);
}

function bindGlobalPointerEvents() {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", cancelActiveDrag);
}

function onPointerMove(e) {
  if (!drag.active) return;
  const { ghost, offsetX, offsetY, sourceId } = drag.active;
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";

  // 高亮 drop target（只在工作区内）
  const target = findCanvasElementAtClient(e.clientX, e.clientY, sourceId);
  if (target !== drag.hoverTarget) {
    setDragTarget(drag.hoverTarget, false);
    setDragTarget(target, true);
    drag.hoverTarget = target;
  }
}

async function onPointerUp(e) {
  if (!drag.active) return;
  const cleaned = finishActiveDrag();
  if (!cleaned) return;
  const { info, sourceId, startX, startY } = cleaned.active;
  const { target } = cleaned;
  const clientX = e.clientX, clientY = e.clientY;
  const moved =
    Math.abs(clientX - startX) > 8 ||
    Math.abs(clientY - startY) > 8;
  if (!moved) return;

  // 判断落点
  const wsRect = workspace.getBoundingClientRect();
  const inWorkspace = clientX >= wsRect.left && clientX <= wsRect.right
    && clientY >= wsRect.top && clientY <= wsRect.bottom;

  if (!inWorkspace) {
    // 拖到侧栏外 — 如果来自 canvas，删除；来自 sidebar，忽略
    if (sourceId != null) removeCanvasEl(sourceId);
    return;
  }

  const localX = clientX - wsRect.left;
  const localY = clientY - wsRect.top;

  if (target && target.id !== sourceId) {
    // 命中另一个元素 → 合成
    const srcId = sourceId != null ? sourceId : spawnOnCanvas(info, localX, localY).id;
    await combine(srcId, target.id, (target.x + localX) / 2, (target.y + localY) / 2);
  } else if (sourceId != null) {
    // canvas 内部移动
    moveCanvasEl(sourceId, localX, localY);
  } else {
    // sidebar → canvas 新生成
    spawnOnCanvas(info, localX, localY);
  }
}

function findCanvasElementAtClient(cx, cy, excludeId) {
  // 从后往前找（上层优先）
  for (let i = state.onCanvas.length - 1; i >= 0; i--) {
    const r = state.onCanvas[i];
    if (r.id === excludeId) continue;
    const rect = r.el.getBoundingClientRect();
    if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
      return r;
    }
  }
  return null;
}

// ============================================================
// canvas 元素管理
// ============================================================
function spawnOnCanvas(info, x, y) {
  info = normalizeElementInfo(info.name, info);
  const id = state.nextId++;
  const el = document.createElement("div");
  el.className = "element on-canvas" + (info.is_starter ? " is-starter" : "");
  el.dataset.id = String(id);
  el.dataset.name = info.name;
  el.dataset.source = "canvas";
  if (info.is_starter) el.title = "🌱 基础元素（开局自带）";
  renderGameElement(el, info, { size: "canvas" });
  el.style.left = (x - 30) + "px";
  el.style.top = (y - 16) + "px";
  workspace.appendChild(el);

  const record = { id, ...info, x, y, el };
  state.onCanvas.push(record);

  el.addEventListener("pointerdown", (e) => onPointerDown(e, el, info, "canvas"));
  bindElementTap(el, {
    onClick: () => window.AUDIO_FEEDBACK?.playElementClick?.(),
    onDoubleClick: () => {
      const rec = state.onCanvas.find(r => r.id === id);
      if (!rec) return;
      spawnOnCanvas(info, rec.x + 28, rec.y + 28);
    },
  });

  syncRecipeLinks();
  return record;
}

function moveCanvasEl(id, x, y) {
  const rec = state.onCanvas.find(r => r.id === id);
  if (!rec) return;
  rec.x = x; rec.y = y;
  rec.el.style.left = (x - 30) + "px";
  rec.el.style.top = (y - 16) + "px";
  moveRecipeLinks();
}

function removeCanvasEl(id) {
  const idx = state.onCanvas.findIndex(r => r.id === id);
  if (idx < 0) return;
  state.onCanvas[idx].el.remove();
  state.onCanvas.splice(idx, 1);
  syncRecipeLinks();
}

// ============================================================
// 合成（带超时）
// ============================================================
async function combine(srcId, dstId, x, y) {
  const src = state.onCanvas.find(r => r.id === srcId);
  const dst = state.onCanvas.find(r => r.id === dstId);
  if (!src || !dst) return;

  const combineEffect = window.EFFECTS?.beginCombine?.(
    workspace, src.el, dst.el, x, y
  );

  // loader
  const loader = document.createElement("div");
  loader.className = "combining";
  appendTextElement(loader, "div", "spinner", "");
  loader.append("合成中…");
  loader.style.left = (x - 40) + "px";
  loader.style.top = (y - 14) + "px";
  workspace.appendChild(loader);

  // 高推理模型可能需要数十秒；略高于后端默认 60s 超时。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65000);

  try {
    const response = await fetch("/api/combine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        a: src.name, b: dst.name,
        discoverer: NICKNAME, session_id: SESSION_ID,
      }),
      signal: ctrl.signal,
    });
    const resp = await response.json();
    if (!response.ok) {
      throw new Error(resp.detail || `HTTP ${response.status}`);
    }
    clearTimeout(timer);
    loader.remove();

    if (resp.source === "fallback") {
      combineEffect?.cancel?.();
      shake(src.el); shake(dst.el);
      return;
    }

    const knownBefore = state.discovered.has(resp.result);
    const isNewToPlayer = !knownBefore;
    const tier = window.COMBINE_FEEDBACK.classify(resp.is_first, knownBefore);
    const previousResultInfo = state.elements[resp.result] || {};
    const resultInfo = normalizeElementInfo(resp.result, {
      ...previousResultInfo,
      emoji: resp.emoji || previousResultInfo.emoji,
      category: resp.chain || previousResultInfo.category || "unknown",
      icon: resp.icon ?? previousResultInfo.icon,
      is_starter: false,
    });
    state.elements[resp.result] = resultInfo;
    state.discovered.add(resp.result);
    if (resp.is_first) state.firsts.add(resp.result);

    combineEffect?.finish?.({
      depth: resp.depth,
      discovered: isNewToPlayer,
    });

    // 清掉两个源元素，在中点放结果
    removeCanvasEl(srcId);
    removeCanvasEl(dstId);
    const newRec = spawnOnCanvas(resultInfo, x, y);
    window.AUDIO_FEEDBACK?.playCombineSuccess?.();

    // 记录玩家的配方图鉴（a + b → result）
    rememberRecipe(src, dst, resultInfo, {
      hitCount: resp.hit_count,
      depth: resp.depth,
    });

    persistDiscovered();
    renderSidebar(searchInput.value);

    // 表模式按稀有度直接计分；里模式只更新待收获筹码。
    const fullScore = resp.full_score || 0;
    const gained = isNewToPlayer ? fullScore : Math.max(1, Math.floor(fullScore / 10));
    const casinoActive = window.EFFECTS?.isUraMode?.() === true;
    if (casinoActive) {
      window.CASINO_MODE?.onCombineResult?.({
        isGlobalFirst: resp.is_first === true,
        sourceEl: newRec.el,
      });
    } else if (fullScore > 0) {
      animateScore(gained, newRec.el);
      recordScoreEvent(resultInfo, gained, resp.depth, tier);
    }
    if (resp.explode) window.EFFECTS?.explode?.(resp.result);
    window.EFFECTS?.onCombineResult?.(newRec.el, resultInfo, tier, {
      depth: resp.depth,
      gained: casinoActive ? null : gained,
      fullScore,
      isNewToPlayer,
      comment: resp.comment,
    });
    if (resp.formula_id) showPublishAction(resp.formula_id);
  } catch (err) {
    clearTimeout(timer);
    loader.remove();
    combineEffect?.cancel?.();
    console.error("combine failed", err);
    shake(src.el); shake(dst.el);
    // 给用户一个可见提示（非阻塞）
    const tip = document.createElement("div");
    tip.className = "combining";
    tip.textContent =
      err.name === "AbortError"
        ? "⏱️ 合成超时，再试一次"
        : /频繁/.test(err.message)
          ? `⏳ ${err.message}`
          : "❌ 合成失败";
    tip.style.left = (x - 60) + "px";
    tip.style.top = (y - 14) + "px";
    tip.style.color = "#C62828";
    workspace.appendChild(tip);
    setTimeout(() => tip.remove(), 1500);
  }
}

function showPublishAction(formulaId) {
  const toast = document.getElementById("first-toast");
  if (!toast) return;

  window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
    publish: async () => {
      const response = await fetch(
        `/api/community/formulas/${encodeURIComponent(formulaId)}/publish`,
        { method: "POST" }
      );
      if (response.ok) return { ok: true };
      const body = await response.json().catch(() => ({}));
      return {
        ok: false,
        detail: body.detail || "公开失败，请重试",
      };
    },
  });
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

// ============================================================
// Score level rendering and mutation
// ============================================================
function currentLevel() {
  return window.SCORE_LEVEL.rankFor(state.score);
}

function renderHomeLevel(rank = currentLevel()) {
  scoreLevelIconsEl.textContent = rank.icons || "尚未获得星星";
  const label = `等级，${rank.aria_label}`;
  $("#btn-score").setAttribute("aria-label", label);
  $("#btn-score").title = `${label}；点击打开分数记录`;
}

function animateScore(delta, sourceEl) {
  const start = state.score;
  const safeDelta = window.SCORE_LEVEL.normalizeScore(delta);
  const rawTarget = window.SCORE_LEVEL.normalizeScore(start + safeDelta);
  const before = window.SCORE_LEVEL.rankFor(start);
  const after = window.SCORE_LEVEL.rankFor(rawTarget);
  state.score = rawTarget;
  localStorage.setItem("ic_kpi", String(rawTarget));
  renderHomeLevel(after);

  try {
    window.EFFECTS?.animateScoreGain?.({
      source: sourceEl,
      target: $("#btn-score"),
      delta: safeDelta,
      before,
      after,
      steps: window.SCORE_LEVEL.transitionSteps(
        before.level_units,
        after.level_units
      ),
      renderFinal: () => renderHomeLevel(),
    });
  } catch (error) {
    console.warn("score animation unavailable", error);
    renderHomeLevel();
  }

  scoreDeltaEl.textContent = `+${safeDelta} 分`;
  scoreDeltaEl.classList.add("show");
  clearTimeout(animateScore._timer);
  animateScore._timer = setTimeout(
    () => scoreDeltaEl.classList.remove("show"),
    1_800
  );
}

function awardCasinoScore({ amount, sourceEl, streak } = {}) {
  const gained = window.SCORE_LEVEL.normalizeScore(amount);
  if (gained <= 0) return;
  animateScore(gained, sourceEl);
  recordScoreEvent({
    name: "里模式收获",
    emoji: "🎰",
    category: "ura",
    is_starter: false,
  }, gained, streak, "casino");
}

// ============================================================
// 持久化 & 搜索 & 按钮
// ============================================================
function persistDiscovered() {
  localStorage.setItem("ic_discovered", JSON.stringify([...state.discovered]));
  localStorage.setItem("ic_firsts", JSON.stringify([...state.firsts]));
  localStorage.setItem("ic_recipes", JSON.stringify(state.recipes));
  localStorage.setItem("ic_scores", JSON.stringify(state.scoreEvents));
  // 更新右下角图鉴按钮上的配方数计数
  const c = document.getElementById("recipebook-btn-count");
  if (c) c.textContent = state.recipes.length;
}

function recordScoreEvent(info, gained, depth, tier) {
  state.scoreEvents.push({
    result: info.name,
    emoji: info.emoji,
    category: info.category,
    icon: info.icon,
    is_starter: info.is_starter,
    gained,
    depth: depth || 0,
    tier,
    ts: Date.now(),
  });
  // 最多保留 200 条最近记录
  if (state.scoreEvents.length > 200) {
    state.scoreEvents = state.scoreEvents.slice(-200);
  }
  persistDiscovered();
  if (window.__renderScorePanel) window.__renderScorePanel();
}

// ============================================================
// 配方图鉴
// ============================================================
function recipeKey(a, b) {
  return [a, b].sort().join(" + ");
}

function rememberRecipe(leftInfo, rightInfo, resultInfo, meta = {}) {
  const key = recipeKey(leftInfo.name, rightInfo.name);
  const recipe = {
    key,
    a: leftInfo.name,
    b: rightInfo.name,
    result: resultInfo.name,
    emoji: resultInfo.emoji,
    category: resultInfo.category,
    icon: resultInfo.icon,
    is_starter: resultInfo.is_starter,
    hit_count: Math.max(1, Number(meta.hitCount) || 1),
    depth: Number.isFinite(Number(meta.depth))
      ? Math.max(0, Math.trunc(Number(meta.depth)))
      : 0,
    ts: Date.now(),
  };
  // 去重：同一组合只保留最后一次
  const exists = state.recipes.find(r => r.key === key);
  if (exists) {
    Object.assign(exists, recipe);
  } else {
    state.recipes.push(recipe);
  }
  persistDiscovered();
  syncRecipeLinks();
  if (window.__renderRecipebook) window.__renderRecipebook();
}

function bindSearch() {
  searchInput.addEventListener("input", (e) => renderSidebar(e.target.value));
}

function bindButtons() {
  $("#nick-display")?.addEventListener("click", async () => {
    await rerollNickname();
  });

  // 操作引导 ❓ toggle（基础提示常驻，仅展开/收起进阶内容）
  $("#btn-help")?.addEventListener("click", (event) => {
    const guidance = document.getElementById("advanced-guidance");
    if (!guidance) return;
    guidance.hidden = !guidance.hidden;
    event.currentTarget.setAttribute(
      "aria-expanded",
      String(!guidance.hidden),
    );
  });

  // 配方图鉴
  $("#btn-recipebook")?.addEventListener("click", toggleRecipebook);
  $("#recipebook-close")?.addEventListener("click", closeRecipebook);
  $("#recipebook-search")?.addEventListener("input", (e) => renderRecipebook(e.target.value));
  $("#recipebook-export")?.addEventListener("click", exportRecipes);
  $("#recipebook-import-file")?.addEventListener("change", importRecipes);

  // 分数记录面板（加分历史 + 等级进度双栏）
  $("#btn-score")?.addEventListener("click", toggleScorePanel);
  $("#score-panel-close")?.addEventListener("click", () => $("#score-panel").classList.remove("show"));
  // 点击面板外关闭
  document.addEventListener("click", (e) => {
    const panel = $("#score-panel");
    const btn = $("#btn-score");
    if (!panel?.classList.contains("show")) return;
    if (panel.contains(e.target) || btn?.contains(e.target)) return;
    panel.classList.remove("show");
  });
}

// ============================================================
// 分数记录面板（左：加分历史 / 右：等级进度）
// ============================================================
function toggleScorePanel(e) {
  e?.stopPropagation();
  const panel = $("#score-panel");
  if (!panel) return;
  if (panel.classList.contains("show")) {
    panel.classList.remove("show");
  } else {
    renderScorePanel();
    panel.classList.add("show");
  }
}

function renderScorePanel() {
  const list = $("#score-panel-list");
  const empty = $("#score-panel-empty");
  if (!list) return;

  const rank = currentLevel();
  $("#score-panel-total").textContent = state.score;
  $("#score-panel-level").textContent = rank.icons || "尚未获得星星";
  $("#score-panel-full-icons").textContent = rank.icons || "尚未获得星星";
  $("#score-panel-full-icons").setAttribute("aria-label", rank.aria_label);
  const progressFill = $("#score-panel-progress-fill");
  progressFill.style.width = `${Math.max(0, Math.min(100, rank.progress * 100))}%`;

  // 左：加分历史
  if (state.scoreEvents.length === 0) {
    list.replaceChildren();
    empty.classList.remove("hide");
  } else {
    empty.classList.add("hide");
    // 最新在顶，最多展示 50 条
    const rows = state.scoreEvents.slice().reverse().slice(0, 50);
    list.replaceChildren();
    for (const ev of rows) {
      const row = document.createElement("div");
      row.className = "score-row";
      const timeStr = formatTime(ev.ts);
      const info = elementInfoFor(ev.result, ev);
      renderGameElement(row, info, { size: "canvas" });
      row.querySelector(".name").title = ev.result;
      appendTextElement(row, "span", "meta", `d=${ev.depth} · ${timeStr}`);
      appendTextElement(
        row, "span", `gain tier-${ev.tier}`, `+${ev.gained}`
      );
      list.appendChild(row);
    }
  }

}

function formatTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

window.__renderScorePanel = () => {
  if ($("#score-panel")?.classList.contains("show")) renderScorePanel();
};

// ============================================================
// 配方图鉴面板
// ============================================================
function toggleRecipebook() {
  const open = $("#recipebook")?.classList.contains("show");
  if (open) closeRecipebook();
  else openRecipebook();
}

function openRecipebook() {
  renderRecipebook($("#recipebook-search").value);
  $("#recipebook").classList.add("show");
  document.body.classList.add("recipebook-open");
}

function closeRecipebook() {
  $("#recipebook").classList.remove("show");
  document.body.classList.remove("recipebook-open");
}

function fitRecipeRow(row) {
  row.classList.remove(
    "recipe-row-dense", "recipe-row-ultra-dense", "recipe-row-fit"
  );
  [
    "--recipe-row-fit-font-size",
    "--recipe-row-fit-icon-size",
    "--recipe-row-fit-gap",
    "--recipe-row-fit-row-padding-y",
    "--recipe-row-fit-row-padding-x",
    "--recipe-row-fit-chip-padding-y",
    "--recipe-row-fit-chip-padding-x",
    "--recipe-row-fit-chip-radius",
    "--recipe-row-fit-score-padding-x",
    "--recipe-row-fit-operator-size",
  ].forEach((name) => row.style.removeProperty(name));
  if (row.scrollWidth <= row.clientWidth) return;
  row.classList.add("recipe-row-dense");
  if (row.scrollWidth <= row.clientWidth) return;
  row.classList.add("recipe-row-ultra-dense");
  if (row.scrollWidth <= row.clientWidth) return;

  row.classList.add("recipe-row-fit");
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const available = row.clientWidth;
    const required = row.scrollWidth;
    if (!available || required <= available) return;
    scale *= (available / required) * 0.98;
    row.style.setProperty("--recipe-row-fit-font-size", `${8 * scale}px`);
    row.style.setProperty("--recipe-row-fit-icon-size", `${16 * scale}px`);
    row.style.setProperty("--recipe-row-fit-gap", `${2 * scale}px`);
    row.style.setProperty("--recipe-row-fit-row-padding-y", `${4 * scale}px`);
    row.style.setProperty("--recipe-row-fit-row-padding-x", `${2 * scale}px`);
    row.style.setProperty("--recipe-row-fit-chip-padding-y", `${scale}px`);
    row.style.setProperty("--recipe-row-fit-chip-padding-x", `${3 * scale}px`);
    row.style.setProperty("--recipe-row-fit-chip-radius", `${6 * scale}px`);
    row.style.setProperty("--recipe-row-fit-score-padding-x", `${3 * scale}px`);
    row.style.setProperty("--recipe-row-fit-operator-size", `${10 * scale}px`);
  }
}

function renderRecipebook(filter = "") {
  const list = $("#recipebook-list");
  const empty = $("#recipebook-empty");
  const countEl = $("#recipebook-count");
  if (!list) return;

  const q = filter.trim().toLowerCase();
  // 最新合成的在顶
  const rows = state.recipes.slice().sort((a, b) => b.ts - a.ts);

  list.replaceChildren();
  let shown = 0;
  for (const r of rows) {
    const blob = `${r.a} ${r.b} ${r.result}`.toLowerCase();
    if (q && !blob.includes(q)) continue;
    const row = document.createElement("div");
    row.className = "recipe-row" + (q ? " highlight" : "");
    const aInfo = elementInfoFor(r.a);
    const bInfo = elementInfoFor(r.b);
    const resultInfo = elementInfoFor(r.result, r);
    const score = r.full_score || estimateFullScore(r.result);

    // 让 chip 真正能拖和双击（和侧栏元素一样的行为）
    const aChipEl = makeInteractiveRecipeChip(aInfo);
    const bChipEl = makeInteractiveRecipeChip(bInfo);
    const resEl = makeInteractiveRecipeChip(resultInfo, { isResult: true });

    row.appendChild(aChipEl);
    const plus = document.createElement("span");
    plus.className = "recipe-chip recipe-plus";
    plus.textContent = "+";
    row.appendChild(plus);
    row.appendChild(bChipEl);
    const arrow = document.createElement("span");
    arrow.className = "recipe-arrow";
    arrow.textContent = "→";
    row.appendChild(arrow);
    row.appendChild(resEl);

    if (score > 0) {
      const badge = document.createElement("span");
      badge.className = "recipe-score";
      badge.textContent = `+${score}`;
      badge.title = "result 首次合成可得分（已知按 1/10 结算）";
      row.appendChild(badge);
    }

    list.appendChild(row);
    fitRecipeRow(row);
    shown++;
  }

  countEl.textContent = `(${state.recipes.length}${q ? ` / 匹配 ${shown}` : ""})`;
  if (state.recipes.length === 0) {
    empty.classList.remove("hide");
  } else {
    empty.classList.add("hide");
  }
}

// 让 rememberRecipe 能通知面板刷新（若面板已打开）
window.__renderRecipebook = () => {
  const search = $("#recipebook-search");
  if ($("#recipebook")?.classList.contains("show")) {
    renderRecipebook(search ? search.value : "");
  }
};

// 估算 result 的 full_score：找这个 result 最近一次合成事件里的 depth
function estimateFullScore(resultName) {
  const ev = state.scoreEvents.slice().reverse().find(e => e.result === resultName);
  if (!ev) return 0;
  return 10 * ev.depth * ev.depth;
}

// 图鉴里的 chip 只复用拖拽系统，不响应轻触召唤或双击复制。
function makeInteractiveRecipeChip(info, { isResult = false } = {}) {
  const chip = document.createElement("span");
  chip.className = "recipe-chip" + (isResult ? " recipe-result" : "");
  chip.dataset.name = info.name;
  renderGameElement(chip, info, { size: "canvas" });

  // 拖拽：复用主拖拽系统
  chip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    onPointerDown(e, chip, info, "sidebar");
  });
  return chip;
}

// ---- 导出 JSON ----
function exportRecipes() {
  const payload = {
    _format: "infinity-craft-recipes",
    _version: 1,
    nickname: NICKNAME,
    exported_at: new Date().toISOString(),
    recipes: state.recipes,
    elements: Object.fromEntries(
      [...state.discovered]
        .filter(n => state.elements[n])
        .map(n => [n, state.elements[n]])
    ),
    firsts: [...state.firsts],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)],
    { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 15);
  a.href = url;
  a.download = `recipes-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- 导入 JSON（带合法性校验）----
const VERIFY_BATCH_SIZE = 500;

async function importRecipes(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  ev.target.value = "";

  // 1) 格式校验
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    alert("❌ JSON 解析失败：" + e.message);
    return;
  }
  if (!data || typeof data !== "object") {
    alert("❌ 文件格式不对（不是 JSON 对象）");
    return;
  }
  if (!Array.isArray(data.recipes)) {
    alert("❌ 缺少 recipes 数组");
    return;
  }

  // 字段完整性筛查
  const formatValid = [];
  const formatBad = [];
  for (const r of data.recipes) {
    if (r && typeof r === "object" && r.a && r.b && r.result && r.emoji) {
      formatValid.push(r);
    } else {
      formatBad.push(r);
    }
  }

  if (formatValid.length === 0) {
    alert("❌ 没有任何格式合法的配方条目");
    return;
  }

  // 2) 后端内容校验：对比全球配方表
  let verify;
  try {
    verify = { valid: [], invalid: [], unknown: [] };
    for (let index = 0; index < formatValid.length; index += VERIFY_BATCH_SIZE) {
      const recipes = formatValid.slice(index, index + VERIFY_BATCH_SIZE);
      const response = await fetch("/api/recipes/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipes }),
      });
      const batch = await response.json();
      if (!response.ok) {
        throw new Error(batch.detail || `HTTP ${response.status}`);
      }
      verify.valid.push(...(batch.valid || []));
      verify.invalid.push(...(batch.invalid || []));
      verify.unknown.push(...(batch.unknown || []));
    }
  } catch (e) {
    alert("❌ 校验服务不可达：" + e.message);
    return;
  }

  const valid = verify.valid || [];
  const invalid = verify.invalid || [];
  const unknown = verify.unknown || [];

  // 3) 预览 + 确认
  const reportLines = [
    `📋 导入预览：`,
    `  文件 recipes：${data.recipes.length}`,
    `  格式不合法：${formatBad.length}（已剔除）`,
    `  ✅ 合法且与全球配方一致：${valid.length}`,
    `  ⚠️ 被篡改（与全球配方不一致）：${invalid.length}（将被剔除）`,
    `  ❓ 全球库中没有该组合：${unknown.length}（将被剔除）`,
    ``,
    `原作者：${data.nickname || "(未知)"}`,
    ``,
    `点"确定"只合并 ✅ 部分；点"取消"放弃整个导入。`,
  ];
  if (invalid.length > 0) {
    reportLines.splice(6, 0, "",
      `被篡改样例（前 3 条）：`,
      ...invalid.slice(0, 3).map(i =>
        `  ${i.a} + ${i.b} → 期望 ${i.expected}，文件里写的是 ${i.got}`));
  }

  if (!confirm(reportLines.join("\n"))) return;

  // 4) 合并 valid（只接受经过全球校验的）
  const existingByKey = new Map(state.recipes.map(r => [r.key, r]));
  for (const r of valid) {
    const key = recipeKey(r.a, r.b);
    existingByKey.set(key, {
      key, a: r.a, b: r.b, result: r.result,
      emoji: r.emoji, ts: Date.now(),
    });
  }
  state.recipes = [...existingByKey.values()];

  // 5) 从 valid 反推元素
  const touched = new Set();
  for (const r of valid) {
    for (const [n, emoji] of [[r.a, null], [r.b, null], [r.result, r.emoji]]) {
      if (!state.elements[n]) {
        state.elements[n] = {
          emoji: emoji || state.elements[n]?.emoji || "❔",
          category: "imported",
        };
      } else if (emoji && !state.elements[n].emoji) {
        state.elements[n].emoji = emoji;
      }
      state.discovered.add(n);
      touched.add(n);
    }
  }

  persistDiscovered();
  syncRecipeLinks();
  renderSidebar(searchInput.value);
  renderRecipebook($("#recipebook-search").value);

  alert(
    `✅ 导入完成：\n` +
    `  合并 ${valid.length} 条合法配方\n` +
    `  新增/更新 ${touched.size} 个元素\n` +
    (invalid.length > 0 ? `  拒绝 ${invalid.length} 条被篡改的\n` : "") +
    (unknown.length > 0 ? `  拒绝 ${unknown.length} 条全球未知的` : "")
  );
}

async function settle() {
  // 老 settle() 已并入分数记录面板；保留入口兼容旧绑定。
  const panel = $("#score-panel");
  if (panel && !panel.classList.contains("show")) {
    renderScorePanel();
    panel.classList.add("show");
  }
}

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) recipeLinks.destroy();
});

init();
