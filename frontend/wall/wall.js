/* ============================================================
   wall.js —— 首发墙
   - 初始：/api/wall/page 分页加载（100/页，按 ts DESC）
   - 滚到底：自动加载下一页；全部加载完提示"已经加载完了"
   - 搜索：在已加载数据内按 result / emoji / discoverer 三字段过滤
     （搜索全量数据库留到 docs/improvements/wall-search-all.md）
   - 实时：轮询 /api/wall/page?offset=0 拉新首发，插到顶部
   - 右侧排行榜：顶部"我"的卡片 + Top 20；定时刷新 + 每次新首发后再拉
   ============================================================ */

import { collectUnseenPrefix, mergeFirstItems } from "./polling.js";

const PAGE_SIZE = 40;
const POLL_PAGE_SIZE = 500;       // 覆盖 100 QPS 下一个轮询周期的突发量
const MAX_POLL_PAGES = 20;
const LB_REFRESH_MS = 20000;     // 排行榜定时刷新
const POLL_REFRESH_MS = 3000;    // Makers Edge Functions 使用短轮询
const SCROLL_NEAR_PX = 400;      // 距底多少触发下一页

// ---- DOM ----
const feed        = document.getElementById("feed");
const feedScroll  = document.getElementById("feed-scroll");
const emptyHint   = document.getElementById("empty");
const statusLine  = document.getElementById("feed-status");
const statLoaded  = document.getElementById("stat-loaded");
const statTotal   = document.getElementById("stat-total");
const searchInput = document.getElementById("wall-search");
const searchWrap  = document.getElementById("wall-search-wrap");
const searchClear = document.getElementById("wall-search-clear");
const lbListEl    = document.getElementById("lb-list");
const lbMeCard    = document.getElementById("lb-me-card");
const lbMeNick    = document.getElementById("lb-me-nick");
const lbMeRow     = document.getElementById("lb-me-row");

// ---- State ----
const state = {
  items: [],                     // 已加载的所有首发（按 ts DESC）
  seen: new Set(),               // result 去重
  nextOffset: 0,                 // 下次 fetch 的 offset
  total: 0,                      // 服务端总条数
  loadingPage: false,            // 分页加载中标记
  exhausted: false,              // 全部加载完
  query: "",                     // 当前搜索词（小写）
};

// 读当前用户昵称（与 app.js 共用 localStorage key）
const MY_NICK = (() => {
  try { return localStorage.getItem("ic_nick") || ""; }
  catch (_) { return ""; }
})();

// ============================================================
// 工具
// ============================================================
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  })[c]);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在 HTML 转义后的字符串里做不区分大小写的高亮。q 必须非空小写。 */
function highlight(escapedText, q) {
  if (!q) return escapedText;
  try {
    const re = new RegExp(escapeRegex(q), "gi");
    return escapedText.replace(re, m => `<mark>${m}</mark>`);
  } catch (_) {
    return escapedText;
  }
}

function itemMatches(item, q) {
  if (!q) return true;
  const hay = `${item.result || ""}\n${item.emoji || ""}\n${item.discoverer || ""}`.toLowerCase();
  return hay.includes(q);
}

function padSeq(n) {
  if (n == null) return "";
  const s = String(n);
  return s.length < 4 ? s.padStart(4, "0") : s;
}

/** 把 Date 格式化成 "MM-DD HH:mm:ss"。默认当前时间。 */
function fmtTime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 年月日时分秒，用于 title tooltip。 */
function fmtTimeFull(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ============================================================
// feed 渲染
// ============================================================
function buildCard(item, { pop = false, q = "" } = {}) {
  const card = document.createElement("div");
  card.className = "first-card" + (pop ? " pop" : "");
  card.dataset.result = item.result;

  const ts = item.ts ? new Date(item.ts * 1000) : new Date();
  const nameHtml = highlight(escapeHTML(item.result || ""), q);
  const emojiHtml = highlight(escapeHTML(item.emoji || "✨"), q);
  const nickHtml = highlight(escapeHTML(item.discoverer || "匿名鹅"), q);
  const seqStr = item.seq != null ? `#${padSeq(item.seq)}` : "";

  card.innerHTML = `
    <div class="first-corner" title="${fmtTimeFull(ts)}">
      ${seqStr ? `<span class="first-seq">${seqStr}</span>` : ""}
      <span class="first-time">${fmtTime(ts)}</span>
    </div>
    <div class="first-emoji">${emojiHtml}</div>
    <div class="first-name">${nameHtml}</div>
    <div class="first-meta">
      <span class="first-meta-nick">首发 · <b>${nickHtml}</b></span>
    </div>
  `;
  return card;
}

function renderFeed() {
  feed.innerHTML = "";
  const q = state.query;
  let shown = 0;
  for (const item of state.items) {
    if (!itemMatches(item, q)) continue;
    feed.appendChild(buildCard(item, { q }));
    shown++;
  }
  if (state.items.length === 0) {
    emptyHint.textContent = "等待第一位勇士合成新元素……";
    emptyHint.style.display = "block";
  } else if (q && shown === 0) {
    emptyHint.textContent =
      `在已加载的 ${state.items.length} 条里没找到"${q}"。` +
      (state.exhausted ? "" : " 滚动加载更多试试。");
    emptyHint.style.display = "block";
  } else {
    emptyHint.style.display = "none";
  }
  updateStatusLine();
  resetBodyMaxHeightIfOpen("feed-body");
}

function updateStatusLine() {
  statLoaded.textContent = state.items.length;
  statTotal.textContent = state.total;

  if (state.loadingPage) {
    statusLine.className = "feed-status";
    statusLine.innerHTML = `<span class="spinner"></span>加载中……`;
    statusLine.style.display = "block";
  } else if (state.exhausted && state.items.length > 0) {
    statusLine.className = "feed-status end";
    statusLine.textContent = `🎉 已经加载完了，共 ${state.items.length} 个首发`;
    statusLine.style.display = "block";
  } else {
    statusLine.style.display = "none";
  }
}

// ============================================================
// 分页加载
// ============================================================
async function loadNextPage() {
  if (state.loadingPage || state.exhausted) return;
  state.loadingPage = true;
  updateStatusLine();
  try {
    const r = await fetch(`/api/wall/page?offset=${state.nextOffset}&limit=${PAGE_SIZE}`)
      .then(x => x.json());
    const items = Array.isArray(r.items) ? r.items : [];
    state.total = r.total || 0;
    for (const item of items) {
      if (!item || !item.result) continue;
      if (state.seen.has(item.result)) continue;
      state.seen.add(item.result);
      state.items.push(item);
    }
    state.nextOffset += items.length;
    if (!r.has_more || items.length === 0) {
      state.exhausted = true;
    }
  } catch (e) {
    console.error("loadNextPage failed", e);
  } finally {
    state.loadingPage = false;
    renderFeed();
    // 若一次页面没撑满滚动容器，立刻尝试加载下一页
    if (!state.exhausted &&
        feedScroll.scrollHeight <= feedScroll.clientHeight + 4) {
      loadNextPage();
    }
  }
}

function onScroll() {
  if (state.loadingPage || state.exhausted) return;
  const distanceToBottom =
    feedScroll.scrollHeight - feedScroll.scrollTop - feedScroll.clientHeight;
  if (distanceToBottom < SCROLL_NEAR_PX) loadNextPage();
}

// ============================================================
// 搜索
// ============================================================
function onSearchInput() {
  const v = searchInput.value.trim().toLowerCase();
  state.query = v;
  searchWrap.classList.toggle("has-value", v.length > 0);
  renderFeed();
}

searchInput.addEventListener("input", onSearchInput);
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  onSearchInput();
  searchInput.focus();
});

// ============================================================
// Makers Edge Functions 实时新首发（短轮询）
// ============================================================
let _pollTimer = null;
let _polling = false;

async function pollNewFirsts() {
  if (_polling || document.hidden) return;
  _polling = true;
  try {
    const fresh = [];
    const collectedNames = new Set();
    let offset = 0;
    let boundaryFound = false;
    let hasMore = false;
    let latestTotal = state.total;

    for (let page = 0; page < MAX_POLL_PAGES; page += 1) {
      const response = await fetch(
        `/api/wall/page?offset=${offset}&limit=${POLL_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const incoming = Array.isArray(data.items) ? data.items : [];
      if (page === 0) latestTotal = Number(data.total) || 0;
      hasMore = Boolean(data.has_more);

      const prefix = collectUnseenPrefix(incoming, state.seen);
      for (const item of prefix.items) {
        if (!collectedNames.has(item.result)) {
          collectedNames.add(item.result);
          fresh.push(item);
        }
      }
      if (prefix.boundaryFound) {
        boundaryFound = true;
        break;
      }
      if (!hasMore || incoming.length === 0) break;
      offset += incoming.length;
    }

    // 页面隐藏太久且积压超过安全分页上限时，重载最新页，避免跳过中间记录。
    if (!boundaryFound && hasMore) {
      state.items = [];
      state.seen.clear();
      state.nextOffset = 0;
      state.total = 0;
      state.exhausted = false;
      await loadNextPage();
      return;
    }

    for (const item of fresh) state.seen.add(item.result);
    state.items = mergeFirstItems(state.items, fresh);
    state.total = latestTotal;
    state.nextOffset += fresh.length;

    if (fresh.length > 0) {
      renderFeed();
      scheduleLeaderboardRefresh();
      for (const item of fresh) scheduleCategoryRefresh(item.result);
    } else {
      statTotal.textContent = state.total;
    }
  } catch (error) {
    console.warn("wall polling failed", error);
  } finally {
    _polling = false;
  }
}

function scheduleWallPoll(delay = POLL_REFRESH_MS) {
  clearTimeout(_pollTimer);
  if (document.hidden) return;
  _pollTimer = setTimeout(async () => {
    await pollNewFirsts();
    scheduleWallPoll();
  }, delay);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(_pollTimer);
  } else {
    pollNewFirsts().finally(() => scheduleWallPoll());
  }
});

function startWallPolling() {
  scheduleWallPoll();
}

// ============================================================
// 排行榜
// ============================================================
function renderMeCard(data) {
  const { total_players = 0, me = null } = data || {};

  if (!MY_NICK) {
    lbMeCard.classList.add("no-rank");
    lbMeNick.textContent = "未登录昵称";
    lbMeRow.innerHTML = `回主页点击顶部昵称领一个花名，就能出现在这里了`;
    return;
  }

  lbMeNick.textContent = MY_NICK;

  if (me && me.rank) {
    lbMeCard.classList.remove("no-rank");
    lbMeRow.innerHTML =
      `您的排名：<b>第 ${me.rank} 名</b> · ` +
      `首发 <b>${me.firsts}</b> 个 · ` +
      `共 <b>${total_players}</b> 位打工人`;
  } else {
    lbMeCard.classList.add("no-rank");
    lbMeRow.innerHTML =
      `您还未上榜 · 共 <b>${total_players}</b> 位打工人 · ` +
      `去合成一个没见过的元素吧！`;
  }
}

function renderTop(data) {
  const { top = [] } = data || {};
  lbListEl.innerHTML = "";
  if (top.length === 0) {
    lbListEl.innerHTML = `<div class="lb-empty">还没有首发，快去合成吧～</div>`;
    return;
  }
  for (const row of top) {
    const rank = row.rank;
    const div = document.createElement("div");
    const classes = ["lb-row"];
    if (rank === 1) classes.push("top1");
    else if (rank === 2) classes.push("top2");
    else if (rank === 3) classes.push("top3");
    if (MY_NICK && row.discoverer === MY_NICK) classes.push("me");
    div.className = classes.join(" ");
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    div.innerHTML = `
      <span class="lb-rank">${medal}</span>
      <span class="lb-name" title="${escapeHTML(row.discoverer)}">${escapeHTML(row.discoverer)}</span>
      <span class="lb-score">${row.firsts}<span class="lb-score-suffix">个</span></span>
    `;
    lbListEl.appendChild(div);
  }
}

function renderLeaderboardError(msg) {
  lbListEl.innerHTML = `<div class="lb-empty">榜单加载失败：${escapeHTML(msg)}</div>`;
}

async function fetchLeaderboard() {
  try {
    const q = MY_NICK ? `?limit=20&me=${encodeURIComponent(MY_NICK)}` : "?limit=20";
    const resp = await fetch(`/api/wall/leaderboard${q}`);
    if (!resp.ok) {
      renderLeaderboardError(`HTTP ${resp.status}`);
      return;
    }
    const r = await resp.json();
    renderMeCard(r);
    renderTop(r);
  } catch (e) {
    console.error("fetchLeaderboard failed", e);
    renderLeaderboardError(String(e.message || e));
  }
}

// 新首发触发刷新，但 800ms 内合并多次
let _lbTimer = null;
function scheduleLeaderboardRefresh() {
  clearTimeout(_lbTimer);
  _lbTimer = setTimeout(fetchLeaderboard, 800);
}

// ============================================================
// 悬赏清单（父 tab + 子分组）
// ============================================================
const bountyTabsEl   = document.getElementById("bounty-tabs");
const bountyGroupsEl = document.getElementById("bounty-groups");
const bountyFoundEl  = document.getElementById("bounty-found");
const bountyTotalEl  = document.getElementById("bounty-total");

const bountyState = {
  loaded: false,
  tabs: [],            // [{key,label,emoji,total,found}]
  groups: [],          // [{category,label,emoji,tab,total,found,items}]
  activeTab: null,
  // 元素名 → 所属 tab（SSE 新首发判断是否相关）
  nameToTab: new Map(),
  collapsedGroups: new Set(),  // localStorage 持久化折叠状态
};

// 初始化：读取已折叠的子分组
try {
  const saved = localStorage.getItem("ic_wall_bounty_collapsed");
  if (saved) bountyState.collapsedGroups = new Set(JSON.parse(saved));
} catch (_) {}

function persistCollapsed() {
  try {
    localStorage.setItem(
      "ic_wall_bounty_collapsed",
      JSON.stringify([...bountyState.collapsedGroups])
    );
  } catch (_) {}
}

// 同 .first-card 的版式
function buildCatChip(item) {
  const chip = document.createElement("div");
  const classes = ["cat-chip"];
  if (item.is_starter) classes.push("starter");
  else if (item.discovered) classes.push("discovered");
  else classes.push("undiscovered");
  // 名人堂（boss 分类，带 real/alias）用特殊版式
  const isFounder = item.category === "boss" && item.real && item.alias;
  if (isFounder) classes.push("founder");
  chip.className = classes.join(" ");

  const seqStr = item.seq != null ? `#${padSeq(item.seq)}` : "";
  const ts = item.ts ? new Date(item.ts * 1000) : null;

  let meta = "尚未发现";
  if (item.is_starter) {
    meta = `🌱 基础元素`;
  } else if (item.discovered) {
    const who = item.discoverer || "匿名鹅";
    meta = `首发 · <b>${escapeHTML(who)}</b>`;
  }

  const cornerHtml = (seqStr || ts) ? `
    <div class="cat-chip-corner" ${ts ? `title="${fmtTimeFull(ts)}"` : ""}>
      ${seqStr ? `<span class="seq">${seqStr}</span>` : ""}
      ${ts ? `<span class="time">${fmtTime(ts)}</span>` : ""}
    </div>
  ` : "";

  if (isFounder) {
    // 名人堂版式：大字真名 + 英文花名 + 职务
    const titleLine = item.title ? `<div class="cat-chip-title" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</div>` : "";
    chip.innerHTML = `
      ${cornerHtml}
      <div class="cat-chip-emoji">${escapeHTML(item.emoji || "❓")}</div>
      <div class="cat-chip-name" title="${escapeHTML(item.name)}">
        ${escapeHTML(item.real)}
        <span class="cat-chip-alias">${escapeHTML(item.alias)}</span>
      </div>
      ${titleLine}
      <div class="cat-chip-meta">${meta}</div>
    `;
  } else {
    chip.innerHTML = `
      ${cornerHtml}
      <div class="cat-chip-emoji">${escapeHTML(item.emoji || "❓")}</div>
      <div class="cat-chip-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
      <div class="cat-chip-meta">${meta}</div>
    `;
  }

  // 已发现（含 starter）→ 可点击查看合成配方
  // 名人堂要用 hit_as（首发时的花名/真名）才能查到记录，否则用 name
  if (item.discovered) {
    chip.classList.add("clickable");
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    // starter 的 name 就是元素名；名人堂取 hit_as，其余用 name
    const queryName = item.hit_as || (isFounder ? item.real : item.name);
    const displayEmoji = item.emoji || "✨";
    const displayName = isFounder ? `${item.real} · ${item.alias}` : item.name;
    chip.addEventListener("click", () => openRecipeModal(queryName, displayName, displayEmoji));
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openRecipeModal(queryName, displayName, displayEmoji);
      }
    });
  }
  return chip;
}

function sortChipItems(items) {
  // 已发现（非 starter）优先 → starter → 未发现；同组已发现按 ts 降序
  return items.slice().sort((a, b) => {
    const aKey = a.is_starter ? 1 : a.discovered ? 0 : 2;
    const bKey = b.is_starter ? 1 : b.discovered ? 0 : 2;
    if (aKey !== bKey) return aKey - bKey;
    if (aKey === 0) return (b.ts || 0) - (a.ts || 0);
    return a.name.localeCompare(b.name, "zh");
  });
}

function buildGroupBlock(group) {
  const groupKey = group.category;
  const collapsed = bountyState.collapsedGroups.has(groupKey);

  const wrap = document.createElement("div");
  wrap.className = "bounty-group";
  wrap.dataset.category = groupKey;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "bounty-group-header";
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const progressCls = (group.found >= group.total && group.total > 0) ? "all-found" : "";
  header.innerHTML = `
    <span class="chevron">▾</span>
    <span class="g-emoji">${escapeHTML(group.emoji || "🏷️")}</span>
    <span class="g-label">${escapeHTML(group.label)}</span>
    <span class="g-progress ${progressCls}">
      <b>${group.found}</b>/<b>${group.total}</b>
    </span>
  `;

  const body = document.createElement("div");
  body.className = "bounty-group-body" + (collapsed ? " collapsed" : "");

  const grid = document.createElement("div");
  grid.className = "category-grid";
  if (!group.items.length) {
    grid.innerHTML = `<div class="category-loading">（这个分类还没有元素）</div>`;
  } else {
    for (const it of sortChipItems(group.items)) {
      grid.appendChild(buildCatChip(it));
      bountyState.nameToTab.set(it.name, group.tab);
    }
  }
  body.appendChild(grid);

  header.addEventListener("click", () => {
    const nowCollapsed = !body.classList.contains("collapsed");
    if (nowCollapsed) {
      body.style.maxHeight = body.scrollHeight + "px";
      void body.offsetHeight;
      body.classList.add("collapsed");
      header.setAttribute("aria-expanded", "false");
      bountyState.collapsedGroups.add(groupKey);
    } else {
      body.classList.remove("collapsed");
      body.style.maxHeight = body.scrollHeight + "px";
      header.setAttribute("aria-expanded", "true");
      const clear = () => { body.style.maxHeight = ""; body.removeEventListener("transitionend", clear); };
      body.addEventListener("transitionend", clear);
      bountyState.collapsedGroups.delete(groupKey);
    }
    persistCollapsed();
    resetBodyMaxHeightIfOpen("bounty-body");
  });

  if (collapsed) body.style.maxHeight = "0";

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderBountyTabs() {
  bountyTabsEl.innerHTML = "";
  bountyState.nameToTab.clear();
  // 只剩一个 tab 时，隐藏切换栏（避免无意义的单按钮）
  if (bountyState.tabs.length <= 1) {
    bountyTabsEl.style.display = "none";
    return;
  }
  bountyTabsEl.style.display = "";
  for (const t of bountyState.tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    const classes = ["bounty-tab"];
    if (t.key === bountyState.activeTab) classes.push("active");
    if (t.total > 0 && t.found >= t.total) classes.push("all-found");
    btn.className = classes.join(" ");
    btn.innerHTML = `
      <span class="t-emoji">${escapeHTML(t.emoji || "🏷️")}</span>
      <span>${escapeHTML(t.label)}</span>
      <span class="t-count">${t.found}/${t.total}</span>
    `;
    btn.addEventListener("click", () => {
      if (bountyState.activeTab === t.key) return;
      bountyState.activeTab = t.key;
      try { localStorage.setItem("ic_wall_bounty_tab", t.key); } catch (_) {}
      renderBountyTabs();
      renderBountyGroups();
    });
    bountyTabsEl.appendChild(btn);
  }
}

function renderBountyGroups() {
  bountyGroupsEl.innerHTML = "";
  const active = bountyState.activeTab;
  const groups = bountyState.groups.filter(g => g.tab === active);
  if (!groups.length) {
    bountyGroupsEl.innerHTML = `<div class="category-loading">这个分组还没有元素</div>`;
    return;
  }
  for (const g of groups) bountyGroupsEl.appendChild(buildGroupBlock(g));
  resetBodyMaxHeightIfOpen("bounty-body");
}

function renderBounty(data) {
  const { tabs = [], groups = [], total = 0, found = 0 } = data || {};
  bountyState.tabs = tabs;
  bountyState.groups = groups;
  bountyState.loaded = true;
  bountyTotalEl.textContent = total;
  bountyFoundEl.textContent = found;

  // 选择活动 tab：localStorage > 第一个有词的 tab > 第一个
  let active = null;
  try { active = localStorage.getItem("ic_wall_bounty_tab"); } catch (_) {}
  if (!active || !tabs.some(t => t.key === active)) {
    active = (tabs.find(t => t.total > 0) || tabs[0] || {}).key || null;
  }
  bountyState.activeTab = active;

  renderBountyTabs();
  renderBountyGroups();
}

async function fetchBounty() {
  try {
    const r = await fetch("/api/wall/bounty");
    if (!r.ok) {
      bountyGroupsEl.innerHTML = `<div class="category-loading">加载失败：HTTP ${r.status}</div>`;
      return;
    }
    const data = await r.json();
    renderBounty(data);
  } catch (e) {
    console.error("fetchBounty failed", e);
    bountyGroupsEl.innerHTML =
      `<div class="category-loading">加载失败：${escapeHTML(String(e.message || e))}</div>`;
  }
}

// 新首发触发：元素命中悬赏清单任意分类时 800ms 节流刷新
let _bountyTimer = null;
function scheduleCategoryRefresh(resultName) {
  if (!bountyState.loaded) return;
  if (resultName && !bountyState.nameToTab.has(resultName)) return;
  clearTimeout(_bountyTimer);
  _bountyTimer = setTimeout(fetchBounty, 800);
}

// ============================================================
// 可折叠 section
// ============================================================
const COLLAPSE_KEY_PREFIX = "ic_wall_collapse_";

function bindCollapsible(toggleId, bodyId, storageKey) {
  const btn = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  if (!btn || !body) return;

  const saved = (() => {
    try { return localStorage.getItem(COLLAPSE_KEY_PREFIX + storageKey); }
    catch (_) { return null; }
  })();
  const startCollapsed = saved === "1";

  // 设置初始态：用固定 max-height 让动画有基线
  const applyState = (collapsed, animate = true) => {
    if (collapsed) {
      // 先固定 scrollHeight，再改 0，触发动画
      body.style.maxHeight = body.scrollHeight + "px";
      // force reflow
      void body.offsetHeight;
      body.classList.add("collapsed");
      btn.setAttribute("aria-expanded", "false");
    } else {
      body.classList.remove("collapsed");
      body.style.maxHeight = body.scrollHeight + "px";
      btn.setAttribute("aria-expanded", "true");
      // 动画后清掉 max-height，允许内容高度自适应变化
      const clear = () => { body.style.maxHeight = ""; body.removeEventListener("transitionend", clear); };
      if (animate) body.addEventListener("transitionend", clear);
      else body.style.maxHeight = "";
    }
  };

  // 初始无动画地应用
  if (startCollapsed) {
    body.classList.add("collapsed");
    btn.setAttribute("aria-expanded", "false");
    body.style.maxHeight = "0";
  } else {
    btn.setAttribute("aria-expanded", "true");
  }

  btn.addEventListener("click", () => {
    const nowCollapsed = !body.classList.contains("collapsed");
    applyState(nowCollapsed, true);
    try { localStorage.setItem(COLLAPSE_KEY_PREFIX + storageKey, nowCollapsed ? "1" : "0"); } catch (_) {}
  });
}

// 展开态 section 内容变化时，若 max-height 是固定值，需要重新计算，避免动画后被截断
function resetBodyMaxHeightIfOpen(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body || body.classList.contains("collapsed")) return;
  body.style.maxHeight = "";
}

// ============================================================
// 配方 modal
// ============================================================
const recipeModal     = document.getElementById("recipe-modal");
const recipeBackdrop  = document.getElementById("recipe-modal-backdrop");
const recipeCloseBtn  = document.getElementById("recipe-modal-close");
const recipeNameEl    = document.getElementById("recipe-modal-name");
const recipeEmojiEl   = document.getElementById("recipe-modal-emoji");
const recipeBodyEl    = document.getElementById("recipe-modal-body");

let _recipeOpenForName = null;    // 去重：同 name 连续点不重复请求

function openRecipeModal(queryName, displayName, displayEmoji) {
  if (!recipeModal) return;
  _recipeOpenForName = queryName;
  recipeNameEl.textContent = displayName || queryName;
  recipeEmojiEl.textContent = displayEmoji || "✨";
  recipeBodyEl.innerHTML = `<div class="recipe-loading">加载中…</div>`;
  recipeModal.classList.add("show");
  recipeModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  fetchRecipes(queryName);
}

function closeRecipeModal() {
  if (!recipeModal) return;
  recipeModal.classList.remove("show");
  recipeModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  _recipeOpenForName = null;
}

async function fetchRecipes(name) {
  try {
    const url = `/api/element/${encodeURIComponent(name)}/recipes`;
    const r = await fetch(url);
    if (!r.ok) {
      renderRecipesError(`HTTP ${r.status}`);
      return;
    }
    const data = await r.json();
    // 防止打开 A 后用户又打开 B，A 的响应晚到覆盖
    if (_recipeOpenForName !== name) return;
    renderRecipes(data);
  } catch (e) {
    console.error("fetchRecipes failed", e);
    renderRecipesError(String(e.message || e));
  }
}

function renderRecipes(data) {
  const recipes = Array.isArray(data.recipes) ? data.recipes : [];
  if (recipes.length === 0) {
    recipeBodyEl.innerHTML = `
      <div class="recipe-empty">
        还没有已知配方。<br>
        可能是首发时由 AI 自由生成 —— 去画布尝试把几个元素拖到一起看看？
      </div>`;
    return;
  }

  const sourceLabel = (s) => {
    if (s === "seed") return "预设";
    if (s === "llm")  return "AI";
    return s || "—";
  };

  let html = `<div class="recipe-count-line">共 <b>${recipes.length}</b> 种配方</div>`;
  html += `<div class="recipe-list">`;
  for (const r of recipes) {
    const src = r.source || "";
    html += `
      <div class="recipe-row">
        <span class="recipe-pill" title="${escapeHTML(r.a)}">
          <span class="e">${escapeHTML(r.a_emoji || "❓")}</span>
          <span class="n">${escapeHTML(r.a)}</span>
        </span>
        <span class="recipe-plus">+</span>
        <span class="recipe-pill" title="${escapeHTML(r.b)}">
          <span class="e">${escapeHTML(r.b_emoji || "❓")}</span>
          <span class="n">${escapeHTML(r.b)}</span>
        </span>
        <span class="recipe-source-tag ${escapeHTML(src)}">${escapeHTML(sourceLabel(src))}</span>
      </div>
    `;
  }
  html += `</div>`;
  recipeBodyEl.innerHTML = html;
}

function renderRecipesError(msg) {
  recipeBodyEl.innerHTML = `<div class="recipe-error">加载失败：${escapeHTML(msg)}</div>`;
}

// 绑定关闭事件（全局只绑一次）
if (recipeModal) {
  recipeCloseBtn?.addEventListener("click", closeRecipeModal);
  recipeBackdrop?.addEventListener("click", closeRecipeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && recipeModal.classList.contains("show")) {
      closeRecipeModal();
    }
  });
}

// ============================================================
// 启动
// ============================================================
async function init() {
  feedScroll.addEventListener("scroll", onScroll, { passive: true });
  // 折叠面板
  bindCollapsible("bounty-toggle", "bounty-body", "bounty");
  bindCollapsible("feed-toggle", "feed-body", "feed");
  // 先把"我的卡片"渲染成骨架，避免观感空白
  renderMeCard({ total_players: 0, me: null });
  await loadNextPage();     // 首屏 40 条
  fetchLeaderboard();
  fetchBounty();            // 悬赏清单（父 tab + 子分组）
  setInterval(fetchLeaderboard, LB_REFRESH_MS);
  startWallPolling();
}

init();
