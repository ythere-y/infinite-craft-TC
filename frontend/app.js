/* ============================================================
   app.js —— 主游戏逻辑（pointer events 版，解决 D&D 卡顿）
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const workspace = $("#workspace");
const list = $("#element-list");
const searchInput = $("#search");
const countEl = $("#count");
const kpiValueEl = $("#kpi-value");
const kpiDeltaEl = $("#kpi-delta");

// ---- 会话 & 昵称 ----
const SESSION_ID = (() => {
  let sid = localStorage.getItem("ic_session");
  if (!sid) {
    sid = "s_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ic_session", sid);
  }
  return sid;
})();

// 昵称：本地存 { id, name }。id 是短随机串，仅用于会话/KPI 标识；展示只显示 name
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
    try {
      const r = await fetch("/api/nickname/peek").then(x => x.json());
      candidate = r.nickname;
      previewEl.textContent = candidate;
    } catch (_) {
      candidate = "神秘鹅_" + Math.random().toString(36).slice(2, 5);
      previewEl.textContent = candidate;
    }
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
      let finalName = candidate;
      let finalId = NICK_ID || generatePlayerId();
      try {
        const r = await fetch("/api/nickname/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: candidate }),
        }).then(x => x.json());
        finalName = r.nickname;
        if (!r.ok) {
          previewEl.textContent = finalName;
          alert(`⚠️ 上一个名字被抢了，已重抽：${finalName}`);
          candidate = finalName;
          return;  // 不关闭，让用户再确认一次
        }
      } catch (_) { /* 离线兜底：本地用 */ }

      NICKNAME = finalName;
      NICK_ID = finalId;
      localStorage.setItem("ic_nick", NICKNAME);
      localStorage.setItem("ic_nick_id", NICK_ID);
      updateNickDisplay();
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

// ---- 状态 ----
const state = {
  elements: {},
  firsts: new Set(JSON.parse(localStorage.getItem("ic_firsts") || "[]")),
  discovered: new Set(JSON.parse(localStorage.getItem("ic_discovered") || "[]")),
  recipes: JSON.parse(localStorage.getItem("ic_recipes") || "[]"),  // [{key,a,b,result,emoji,ts}]
  scoreEvents: JSON.parse(localStorage.getItem("ic_scores") || "[]"),  // [{result,emoji,gained,depth,tier,ts}]
  kpi: Number(localStorage.getItem("ic_kpi") || 0),
  onCanvas: [],
  nextId: 1,
};

// 拖拽上下文
const drag = {
  active: null,        // {ghost, name, emoji, sourceId|null, offsetX, offsetY}
  hoverTarget: null,   // 当前悬停的 canvas 元素 record
};

// ============================================================
// 初始化
// ============================================================
async function init() {
  kpiValueEl.textContent = state.kpi;
  await ensureNickname();
  updateNickDisplay();
  await Promise.all([loadElements(), loadTiers()]);
  bindSearch();
  bindButtons();
  bindGlobalPointerEvents();
  // 初始化右下角图鉴按钮计数
  const c = document.getElementById("recipebook-btn-count");
  if (c) c.textContent = state.recipes.length;
  window.EFFECTS?.initBossMode?.(renderSidebar);
}

async function loadElements() {
  try {
    const [starters, all] = await Promise.all([
      fetch("/api/starters").then(r => r.json()),
      fetch("/api/elements").then(r => r.json()),
    ]);
    starters.starters.forEach(s => {
      state.elements[s.name] = { emoji: s.emoji, category: s.category, is_starter: true };
      state.discovered.add(s.name);
    });
    Object.entries(all.elements).forEach(([name, info]) => {
      if (!state.elements[name]) state.elements[name] = info;
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
  list.innerHTML = "";
  const q = filter.trim().toLowerCase();
  const names = [...state.discovered].sort((a, b) => a.localeCompare(b, "zh"));
  for (const name of names) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const info = state.elements[name];
    if (!info) continue;
    list.appendChild(makeElementChip(name, info.emoji, {
      isFirst: state.firsts.has(name),
      isStarter: !!info.is_starter,
      source: "sidebar",
    }));
  }
  countEl.textContent = state.discovered.size;
  // 如果里模式开着，重新应用覆盖
  window.EFFECTS?.reapplyUra?.();
}

function makeElementChip(name, emoji, { isFirst = false, isStarter = false, source = "sidebar" } = {}) {
  const div = document.createElement("div");
  const classes = ["element"];
  if (isFirst) classes.push("first-discovery");
  if (isStarter) classes.push("is-starter");
  div.className = classes.join(" ");
  div.dataset.name = name;
  div.dataset.source = source;
  if (isStarter) div.title = "🌱 基础元素（开局自带）";
  const seedBadge = isStarter ? `<span class="starter-badge" aria-hidden="true">🌱</span>` : "";
  div.innerHTML = `${seedBadge}<span class="emoji">${emoji}</span><span class="name">${escapeHTML(name)}</span>`;
  div.addEventListener("pointerdown", (e) => onPointerDown(e, div, { name, emoji, source }));
  // 侧栏双击 → 画布中心生成该元素（允许原地叠放）
  bindDoubleTap(div, () => spawnAtWorkspaceCenter(name, emoji));
  return div;
}

// 在画布中心附近随机抖动位置生成一个元素（避免完全重叠）
function spawnAtWorkspaceCenter(name, emoji) {
  const rect = workspace.getBoundingClientRect();
  const jitter = () => (Math.random() - 0.5) * 40;
  const cx = rect.width / 2 + jitter();
  const cy = rect.height / 2 + jitter();
  spawnOnCanvas(name, emoji, cx, cy);
}

/**
 * 自己实现的 double-tap 识别，和原生 dblclick 互补。
 * 原生 dblclick 在 pointerdown+preventDefault+setPointerCapture 场景下有时会不触发：
 *   · 两次 click 命中了不同子 span (.emoji vs .name)
 *   · 指针在两次 click 间移动 > 2px
 *   · 第一次 click 的 pointerCapture 干扰了后续事件
 * 这个 helper 通过监听 pointerup 的时间 + 坐标阈值来兜底，
 * 同时保留原生 dblclick 以兼容老浏览器。
 *
 * 触发条件：两次 pointerup 间隔 < 350ms 且位移 < 12px → 视为 double-tap
 * 副作用：触发后会取消当前正在进行的 drag（如果第二次 pointerdown 起飞了 ghost）。
 */
function bindDoubleTap(el, handler) {
  let last = 0;
  let lastX = 0, lastY = 0;
  let downX = 0, downY = 0;
  let lastFired = 0;  // 上次真正触发 handler 的时刻；去重用

  // handler 在 500ms 窗口内只允许触发一次，
  // 这样即使原生 dblclick 和自实现 double-tap 都命中，
  // 也只会调一次 handler（创建一个元素，而不是两个）
  function fireOnce(e) {
    const now = performance.now();
    if (now - lastFired < 500) return;
    lastFired = now;
    cancelActiveDrag();
    handler(e);
  }

  el.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  el.addEventListener("pointerup", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // 如果这次 pointerdown → pointerup 移动过大，视为拖拽，不参与 double-tap
    const moved = Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8;
    if (moved) {
      last = 0;  // 拖拽结束不算一次"tap"
      return;
    }
    const now = performance.now();
    const dx = Math.abs(e.clientX - lastX);
    const dy = Math.abs(e.clientY - lastY);
    if (now - last < 350 && dx < 12 && dy < 12) {
      last = 0;
      fireOnce(e);
    } else {
      last = now;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  // 原生 dblclick 兜底（走 fireOnce 去重）
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fireOnce(e);
  });
}

/** 如果当前正在 drag，取消并清理（用于 double-tap 抢占时）。 */
function cancelActiveDrag() {
  if (!drag.active) return;
  const { ghost } = drag.active;
  ghost?.remove();
  drag.hoverTarget?.el.classList.remove("dropping");
  document.querySelectorAll(".element.dragging").forEach(el => el.classList.remove("dragging"));
  drag.active = null;
  drag.hoverTarget = null;
}

// ============================================================
// Pointer events 拖拽系统
// ============================================================
function onPointerDown(e, el, { name, emoji, source }) {
  if (e.button !== 0) return;        // 只处理左键
  e.preventDefault();

  const rect = el.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  // 若来自 canvas 上一个已有元素，要记录它的 id
  const sourceId = source === "canvas" ? Number(el.dataset.id) : null;

  // 创建 ghost（跟手的元素副本）
  const ghost = document.createElement("div");
  ghost.className = "element ghost";
  ghost.innerHTML = `<span class="emoji">${emoji}</span><span class="name">${escapeHTML(name)}</span>`;
  ghost.style.position = "fixed";
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "999";
  document.body.appendChild(ghost);

  drag.active = { ghost, name, emoji, source, sourceId, offsetX, offsetY };

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
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(e) {
  if (!drag.active) return;
  const { ghost, offsetX, offsetY, sourceId } = drag.active;
  ghost.style.left = (e.clientX - offsetX) + "px";
  ghost.style.top = (e.clientY - offsetY) + "px";

  // 高亮 drop target（只在工作区内）
  const target = findCanvasElementAtClient(e.clientX, e.clientY, sourceId);
  if (target !== drag.hoverTarget) {
    drag.hoverTarget?.el.classList.remove("dropping");
    target?.el.classList.add("dropping");
    drag.hoverTarget = target;
  }
}

async function onPointerUp(e) {
  if (!drag.active) return;
  const { ghost, name, emoji, source, sourceId } = drag.active;
  const clientX = e.clientX, clientY = e.clientY;

  // 收尾
  ghost.remove();
  drag.hoverTarget?.el.classList.remove("dropping");
  document.querySelectorAll(".element.dragging").forEach(el => el.classList.remove("dragging"));

  const wasActive = drag.active;
  drag.active = null;
  const target = drag.hoverTarget;
  drag.hoverTarget = null;

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
    const srcId = sourceId != null ? sourceId : spawnOnCanvas(name, emoji, localX, localY).id;
    await combine(srcId, target.id, (target.x + localX) / 2, (target.y + localY) / 2);
  } else if (sourceId != null) {
    // canvas 内部移动
    moveCanvasEl(sourceId, localX, localY);
  } else {
    // sidebar → canvas 新生成
    spawnOnCanvas(name, emoji, localX, localY);
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
function spawnOnCanvas(name, emoji, x, y) {
  const id = state.nextId++;
  const el = document.createElement("div");
  const info = state.elements[name];
  const isStarter = !!(info && info.is_starter);
  el.className = "element on-canvas" + (isStarter ? " is-starter" : "");
  el.dataset.id = String(id);
  el.dataset.name = name;
  el.dataset.source = "canvas";
  if (isStarter) el.title = "🌱 基础元素（开局自带）";
  const seedBadge = isStarter ? `<span class="starter-badge" aria-hidden="true">🌱</span>` : "";
  el.innerHTML = `${seedBadge}<span class="emoji">${emoji}</span><span class="name">${escapeHTML(name)}</span>`;
  el.style.left = (x - 30) + "px";
  el.style.top = (y - 16) + "px";
  workspace.appendChild(el);

  const record = { id, name, emoji, x, y, el };
  state.onCanvas.push(record);

  el.addEventListener("pointerdown", (e) => onPointerDown(e, el, { name, emoji, source: "canvas" }));
  // 画布双击 → 在右下偏移位置复制一份（代替原先的删除）
  bindDoubleTap(el, () => {
    const rec = state.onCanvas.find(r => r.id === id);
    if (!rec) return;
    spawnOnCanvas(name, emoji, rec.x + 28, rec.y + 28);
  });

  return record;
}

function moveCanvasEl(id, x, y) {
  const rec = state.onCanvas.find(r => r.id === id);
  if (!rec) return;
  rec.x = x; rec.y = y;
  rec.el.style.left = (x - 30) + "px";
  rec.el.style.top = (y - 16) + "px";
}

function removeCanvasEl(id) {
  const idx = state.onCanvas.findIndex(r => r.id === id);
  if (idx < 0) return;
  state.onCanvas[idx].el.remove();
  state.onCanvas.splice(idx, 1);
}

// ============================================================
// 合成（带超时）
// ============================================================
async function combine(srcId, dstId, x, y) {
  const src = state.onCanvas.find(r => r.id === srcId);
  const dst = state.onCanvas.find(r => r.id === dstId);
  if (!src || !dst) return;

  // loader
  const loader = document.createElement("div");
  loader.className = "combining";
  loader.innerHTML = `<div class="spinner"></div>合成中…`;
  loader.style.left = (x - 40) + "px";
  loader.style.top = (y - 14) + "px";
  workspace.appendChild(loader);

  // 高推理模型可能需要数十秒；略高于后端默认 60s 超时。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 65000);

  try {
    const resp = await fetch("/api/combine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        a: src.name, b: dst.name,
        discoverer: NICKNAME, session_id: SESSION_ID,
      }),
      signal: ctrl.signal,
    }).then(r => r.json());
    clearTimeout(timer);
    loader.remove();

    if (resp.source === "fallback") {
      shake(src.el); shake(dst.el);
      return;
    }

    // 清掉两个源元素，在中点放结果
    removeCanvasEl(srcId);
    removeCanvasEl(dstId);
    const newRec = spawnOnCanvas(resp.result, resp.emoji, x, y);

    const isNewToPlayer = !state.discovered.has(resp.result);
    state.elements[resp.result] = { emoji: resp.emoji, category: resp.chain || "unknown" };
    state.discovered.add(resp.result);
    if (resp.is_first) state.firsts.add(resp.result);

    // 记录玩家的配方图鉴（a + b → result）
    rememberRecipe(src.name, dst.name, resp.result, resp.emoji);

    persistDiscovered();
    renderSidebar(searchInput.value);

    // 判定三档特效 tier
    //   tier 3 global_new    全球首发 -> 烟花 + 持续发光
    //   tier 2 global_known  玩家本地新发现 -> 持续发光
    //   tier 1 seen          玩家已知 -> 基础轻动效
    let tier = "seen";
    if (resp.is_first) tier = "global_new";
    else if (isNewToPlayer) tier = "global_known";

    // 加分系统（depth-based）：未知全分 / 已知 1/10
    const fullScore = resp.full_score || 0;
    const gained = isNewToPlayer ? fullScore : Math.max(1, Math.floor(fullScore / 10));
    if (fullScore > 0) {
      animateKpi(gained);
      recordScoreEvent(resp.result, resp.emoji, gained, resp.depth, tier);
    }
    if (resp.explode) window.EFFECTS?.explode?.(resp.result);
    window.EFFECTS?.onCombineResult?.(newRec.el, resp.result, resp.emoji, tier, {
      depth: resp.depth, gained, fullScore, isNewToPlayer,
    });
  } catch (err) {
    clearTimeout(timer);
    loader.remove();
    console.error("combine failed", err);
    shake(src.el); shake(dst.el);
    // 给用户一个可见提示（非阻塞）
    const tip = document.createElement("div");
    tip.className = "combining";
    tip.textContent = err.name === "AbortError" ? "⏱️ 合成超时，再试一次" : "❌ 合成失败";
    tip.style.left = (x - 60) + "px";
    tip.style.top = (y - 14) + "px";
    tip.style.color = "#C62828";
    workspace.appendChild(tip);
    setTimeout(() => tip.remove(), 1500);
  }
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

// ============================================================
// KPI 累计动画
// ============================================================

// 段位表（启动时从 /api/tiers 拉，和后端 kpi.TIERS 对齐）
// 瑞雪以上是"里程碑档位"；真实的阶梯是瑞雪内按 🌟 累加（后端动态拼）
let TIERS = [
  { floor: 0, grade: "3-", label: "待改进", emoji: "🔴" },
  { floor: 500, grade: "3.25", label: "勉强合格", emoji: "🟡" },
  { floor: 1500, grade: "3.5", label: "达标", emoji: "🟢" },
  { floor: 3500, grade: "3.75", label: "优秀", emoji: "🔵" },
  { floor: 8000, grade: "瑞雪", label: "瑞雪兆丰年", emoji: "❄️" },
  { floor: 11200, grade: "瑞雪🌛", label: "月华如水", emoji: "🌛" },
  { floor: 20800, grade: "瑞雪🌞", label: "日耀乾坤", emoji: "🌞" },
  { floor: 59200, grade: "瑞雪👑", label: "加冕鹅王", emoji: "👑" },
  { floor: 212800, grade: "暴雪领主", label: "极地主宰鹅", emoji: "🌨️" },
];

async function loadTiers() {
  try {
    const r = await fetch("/api/tiers").then(x => x.json());
    if (Array.isArray(r.tiers) && r.tiers.length > 0) TIERS = r.tiers;
  } catch (_) { /* 用内置兜底 */ }
}

function tierAt(score) {
  let cur = TIERS[0];
  for (const t of TIERS) if (score >= t.floor) cur = t;
  return cur;
}

/**
 * 把 stars 数按 base-4 拆成 (👑, 🌞, 🌛, 🌟) 四段
 * 1👑 = 64🌟，1🌞 = 16🌟，1🌛 = 4🌟，1🌟 = 1🌟
 * 必须和 backend kpi._stars_to_symbols 的权重保持一致，
 * 这样 UI 显示的 "k👑 + k🌞 + k🌛 + k🌟" 就能和 grade 字符串 (如 "瑞雪👑🌛🌟") 完全对齐。
 */
function starsBreakdown(stars) {
  const weights = [["👑", 64], ["🌞", 16], ["🌛", 4], ["🌟", 1]];
  const out = [];
  let remain = Math.max(0, stars | 0);
  for (const [sym, w] of weights) {
    const k = Math.floor(remain / w);
    remain -= k * w;
    out.push([sym, k]);
  }
  return out;
}

function animateKpi(delta) {
  const target = state.kpi + delta;
  const start = state.kpi;

  const dur = 500, t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const val = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
    kpiValueEl.textContent = val;
    if (p < 1) requestAnimationFrame(step);
    else state.kpi = target;
  }
  requestAnimationFrame(step);
  localStorage.setItem("ic_kpi", String(target));

  kpiDeltaEl.textContent = `+${delta}`;
  kpiDeltaEl.classList.add("show");
  clearTimeout(animateKpi._t);
  animateKpi._t = setTimeout(() => kpiDeltaEl.classList.remove("show"), 900);
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

function recordScoreEvent(result, emoji, gained, depth, tier) {
  state.scoreEvents.push({
    result, emoji, gained, depth: depth || 0, tier, ts: Date.now(),
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

function rememberRecipe(a, b, result, emoji) {
  const key = recipeKey(a, b);
  // 去重：同一组合只保留最后一次
  const exists = state.recipes.find(r => r.key === key);
  if (exists) {
    exists.result = result;
    exists.emoji = emoji;
    exists.ts = Date.now();
  } else {
    state.recipes.push({ key, a, b, result, emoji, ts: Date.now() });
  }
  persistDiscovered();
  if (window.__renderRecipebook) window.__renderRecipebook();
}

function bindSearch() {
  searchInput.addEventListener("input", (e) => renderSidebar(e.target.value));
}

function bindButtons() {
  $("#btn-reset").addEventListener("click", () => {
    state.onCanvas.slice().forEach(r => removeCanvasEl(r.id));
  });
  $("#nick-display")?.addEventListener("click", async () => {
    await rerollNickname();
  });

  // 操作引导 ❓ toggle（仅控制显示，不清除）
  $("#btn-help")?.addEventListener("click", () => {
    const hint = document.getElementById("hint");
    if (!hint) return;
    hint.classList.toggle("hide");
  });

  // 配方图鉴
  $("#btn-recipebook")?.addEventListener("click", toggleRecipebook);
  $("#recipebook-close")?.addEventListener("click", closeRecipebook);
  $("#recipebook-search")?.addEventListener("input", (e) => renderRecipebook(e.target.value));
  $("#recipebook-export")?.addEventListener("click", exportRecipes);
  $("#recipebook-import-file")?.addEventListener("change", importRecipes);

  // KPI 复盘面板（加分历史 + 段位路径 双栏）
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
// KPI 复盘面板（左: 加分历史 / 右: 段位路径）
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
  const total = $("#score-panel-total");
  if (!list) return;

  total.textContent = state.kpi;

  // 左：加分历史
  if (state.scoreEvents.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hide");
  } else {
    empty.classList.add("hide");
    // 最新在顶，最多展示 50 条
    const rows = state.scoreEvents.slice().reverse().slice(0, 50);
    list.innerHTML = "";
    for (const ev of rows) {
      const row = document.createElement("div");
      row.className = "score-row";
      const timeStr = formatTime(ev.ts);
      row.innerHTML = `
        <span class="emoji">${ev.emoji}</span>
        <span class="name" title="${escapeHTML(ev.result)}">${escapeHTML(ev.result)}</span>
        <span class="meta">d=${ev.depth} · ${timeStr}</span>
        <span class="gain tier-${ev.tier}">+${ev.gained}</span>
      `;
      list.appendChild(row);
    }
  }

  // 右：段位路径（异步拉后端，失败时纯前端回退）
  renderTiersPane();
}

async function renderTiersPane() {
  const box = $("#score-panel-tiers");
  const badge = $("#score-panel-rank");
  if (!box) return;
  let rank = null;
  // 用本地 state.kpi 作为权威分数（避免后端 chain 评分和前端 depth 评分不一致）
  try {
    rank = await fetch(`/api/rank?total=${state.kpi}`).then(r => r.json());
  } catch (_) { /* 下面走前端兜底 */ }
  if (!rank) {
    // 兜底：只用 TIERS + 当前 state.kpi 画静态表
    const cur = tierAt(state.kpi);
    rank = {
      total: state.kpi,
      grade: cur.grade, label: cur.label, emoji: cur.emoji,
      floor: cur.floor,
      next_floor: cur.floor, next_grade: cur.grade, next_label: cur.label, next_emoji: cur.emoji,
      to_next: 0, topped: false,
      // 兜底不暴露 stars 字段，避免在"还没进入瑞雪"时显示 0/256 误导
      all_tiers: TIERS,
    };
  }
  // 保证 rank.total 和本地 state.kpi 一致，highlight 用它做判断
  rank.total = state.kpi;

  if (badge) {
    badge.textContent = `· ${rank.emoji} ${rank.grade}`;
    badge.title = rank.label;
  }

  box.innerHTML = "";

  // 当前状态卡片（置顶）
  const header = document.createElement("div");
  header.className = "tier-current-card";
  const progressDenom = Math.max(1, rank.next_floor - rank.floor);
  const progressPct = Math.max(4, Math.min(100, ((rank.total - rank.floor) / progressDenom) * 100));

  // 下一档提示：未封顶时显示 "距 X 还差 Y 分"
  //   - 未到瑞雪：X 是基础档位（3.25 / 3.5 / …）
  //   - 瑞雪及以上：X 是下一次"🌟 视觉变化"后的形态，和 grade 字符串直接对齐
  //   （后端 next_grade 已经生成好，例如当前是 瑞雪🌛🌟 → next_grade = 瑞雪🌛🌟🌟）
  const nextLine = rank.topped
    ? `👑 已达 <b>${rank.emoji} ${escapeHTML(rank.grade)}</b>，继续堆分进入 <b>${escapeHTML(rank.next_grade)}</b>`
    : `距 <b>${rank.next_emoji} ${escapeHTML(rank.next_grade)}</b> 还差 <b>${rank.to_next}</b> 分`;

  // 🌟 breakdown：只在已经进入瑞雪阶（stars > 0 或 rank.grade 包含瑞雪）时显示
  //   显示时把 stars 拆成 👑/🌞/🌛/🌟 的组合，和 grade 字符串 1:1 对齐
  //   例：stars=69 → 1👑 + 0🌞 + 1🌛 + 1🌟，grade 恰好是 瑞雪👑🌛🌟
  let starsBlock = "";
  const inSnow = (rank.stars != null && rank.stars > 0)
    || (rank.grade && rank.grade.startsWith("瑞雪"));
  if (inSnow && rank.max_stars) {
    const breakdown = starsBreakdown(rank.stars || 0);
    const pieces = breakdown
      .filter(([, n]) => n > 0)
      .map(([sym, n]) => `${n}${sym}`)
      .join(" + ");
    const pretty = pieces || "0🌟";
    starsBlock = `
      <div class="tier-stars">
        已累积瑞雪 <b>${pretty}</b>（= ${rank.stars} / ${rank.max_stars} 🌟，每 ${rank.star_step} 分 1🌟）
      </div>
    `;
  }

  header.innerHTML = `
    <div class="tier-current-emoji">${rank.emoji}</div>
    <div class="tier-current-main">
      <div class="tier-current-grade">${escapeHTML(rank.grade)}</div>
      <div class="tier-current-label">${escapeHTML(rank.label || "")}</div>
    </div>
    <div class="tier-current-next">
      ${nextLine}
      <div class="tier-progress"><div class="tier-progress-fill" style="width:${progressPct}%"></div></div>
      ${starsBlock}
    </div>
  `;
  box.appendChild(header);

  // 全部段位列表
  const listBox = document.createElement("div");
  listBox.className = "tier-list";
  const tiers = rank.all_tiers || TIERS;
  for (const t of tiers) {
    const reached = rank.total >= t.floor;
    // "当前档"的判断：该档 floor 是 <=total 里最大的
    const isCurrent = reached &&
      !tiers.some(x => x.floor > t.floor && rank.total >= x.floor);
    const row = document.createElement("div");
    row.className = "tier-row " + (isCurrent ? "current" : reached ? "reached" : "locked");
    row.innerHTML = `
      <span class="tier-emoji">${t.emoji}</span>
      <span class="tier-grade">${escapeHTML(t.grade)}</span>
      <span class="tier-label">${escapeHTML(t.label)}</span>
      <span class="tier-floor">≥ ${t.floor}</span>
    `;
    listBox.appendChild(row);
  }
  box.appendChild(listBox);
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

function renderRecipebook(filter = "") {
  const list = $("#recipebook-list");
  const empty = $("#recipebook-empty");
  const countEl = $("#recipebook-count");
  if (!list) return;

  const q = filter.trim().toLowerCase();
  // 最新合成的在顶
  const rows = state.recipes.slice().sort((a, b) => b.ts - a.ts);

  list.innerHTML = "";
  let shown = 0;
  for (const r of rows) {
    const blob = `${r.a} ${r.b} ${r.result}`.toLowerCase();
    if (q && !blob.includes(q)) continue;
    const row = document.createElement("div");
    row.className = "recipe-row" + (q ? " highlight" : "");
    const aEmoji = state.elements[r.a]?.emoji || "❔";
    const bEmoji = state.elements[r.b]?.emoji || "❔";
    const score = r.full_score || estimateFullScore(r.result);

    // 让 chip 真正能拖和双击（和侧栏元素一样的行为）
    const aChipEl = makeInteractiveRecipeChip(r.a, aEmoji);
    const bChipEl = makeInteractiveRecipeChip(r.b, bEmoji);
    const resEl = makeInteractiveRecipeChip(r.result, r.emoji, { isResult: true });

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

// 让图鉴里的 chip 可拖、可双击（行为和侧栏元素一致）
function makeInteractiveRecipeChip(name, emoji, { isResult = false } = {}) {
  const chip = document.createElement("span");
  chip.className = "recipe-chip" + (isResult ? " recipe-result" : "");
  chip.dataset.name = name;
  chip.innerHTML = `<span class="emoji">${emoji}</span><span class="name">${escapeHTML(name)}</span>`;

  // 拖拽：复用主拖拽系统
  chip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    onPointerDown(e, chip, { name, emoji, source: "sidebar" });
  });
  // 双击：在画布中心生成
  bindDoubleTap(chip, () => spawnAtWorkspaceCenter(name, emoji));
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
    verify = await fetch("/api/recipes/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipes: formatValid }),
    }).then(r => r.json());
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
  // 老 settle() 已并入 KPI 复盘面板；保留入口兼容旧绑定
  const panel = $("#score-panel");
  if (panel && !panel.classList.contains("show")) {
    renderScorePanel();
    panel.classList.add("show");
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  })[c]);
}

init();
