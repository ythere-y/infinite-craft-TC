const login = document.querySelector("#login");
const queue = document.querySelector("#queue");
const queueList = document.querySelector("#queue-list");
const elementsByName = new Map();

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function elementInfo(name, fallback = {}) {
  const saved = elementsByName.get(name) || {};
  return {
    ...saved,
    name,
    emoji: saved.emoji || fallback.emoji || "❓",
    icon: saved.icon || fallback.icon,
    category: saved.category || fallback.category,
  };
}

function renderSticker(name, fallback = {}, className = "") {
  const target = document.createElement("span");
  target.className = `element formula-element ${className}`.trim();
  window.ICON_SYSTEM.renderElement(document, target, {
    ...elementInfo(name, fallback),
    size: "detail",
  });
  return target;
}

function actionButton(name, label, tone, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  window.ICON_SYSTEM.renderAction(document, button, {name, label, tone});
  button.addEventListener("click", onClick);
  return button;
}

async function loadElements() {
  const response = await fetch("/api/elements");
  if (!response.ok) return;
  const data = await response.json();
  for (const [name, info] of Object.entries(data.elements || {})) {
    elementsByName.set(name, info || {});
  }
}

async function loadQueue() {
  const [response] = await Promise.all([
    fetch("/api/community/admin/queue"),
    loadElements(),
  ]);
  if (!response.ok) return;
  const data = await response.json();
  login.hidden = true;
  queue.hidden = false;
  queueList.replaceChildren(...data.items.map(render));
}

function render(item) {
  const card = document.createElement("article");
  card.className = "formula-card";

  const title = document.createElement("h2");
  title.className = "formula-title";
  title.append(renderSticker(item.result, item, "formula-result"));

  const recipe = document.createElement("div");
  recipe.className = "recipe formula-recipe";
  recipe.append(
    renderSticker(item.a, {emoji: item.a_emoji, icon: item.a_icon}, "formula-input"),
    text("span", "+", "formula-operator"),
    renderSticker(item.b, {emoji: item.b_emoji, icon: item.b_icon}, "formula-input"),
  );

  const score = document.createElement("p");
  score.className = "moderation-score";
  for (const [name, label, value, tone] of [
    ["like", "支持", item.up_votes, "positive"],
    ["dislike", "反对", item.down_votes, "negative"],
  ]) {
    const metric = document.createElement("span");
    window.ICON_SYSTEM.renderAction(document, metric, {
      name,
      label: `${label} ${value}`,
      tone,
    });
    score.append(metric);
  }
  score.append(text("strong", `净支持 ${item.net_score}`));

  const reason = document.createElement("select");
  reason.setAttribute("aria-label", "治理原因");
  for (const [value, label] of [
    ["community_quality", "社区质量"],
    ["duplicate", "重复/低信息量"],
    ["unsafe", "安全或不当内容"],
    ["manual_exception", "人工例外"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    reason.append(option);
  }

  const actions = document.createElement("div");
  actions.className = "vote-actions";
  for (const [action, icon, label, tone] of [
    ["keep", "confirm", "保留", "positive"],
    ["protect", "warning", "保护", "neutral"],
    ["takedown", "close", "下架", "negative"],
    ["retire", "reset", "退役并允许 v2", "negative"],
  ]) {
    const button = actionButton(icon, label, tone, async () => {
      if (action === "retire" && !confirm("退役会使下一次合成调用模型生成新版本，确认继续？")) return;
      const response = await fetch(`/api/community/admin/formulas/${encodeURIComponent(item.id)}/moderate`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action, reason_code: reason.value, note: ""}),
      });
      if (!response.ok) return alert((await response.json()).detail || "操作失败");
      await loadQueue();
    });
    actions.append(button);
  }
  card.append(title, recipe, score, reason, actions);
  return card;
}

login.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/community/admin/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({key: document.querySelector("#admin-key").value}),
  });
  if (!response.ok) return alert("登录失败");
  document.querySelector("#admin-key").value = "";
  await loadQueue();
});

window.ICON_SYSTEM.ready.then(() => {
  window.ICON_SYSTEM.hydrateActions(document);
  loadQueue();
});
