const list = document.querySelector("#formula-list");
const empty = document.querySelector("#empty");
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

async function vote(id, value) {
  const response = await fetch(`/api/community/formulas/${encodeURIComponent(id)}/vote`, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({value}),
  });
  if (!response.ok) throw new Error((await response.json()).detail || "投票失败");
  return response.json();
}

function renderFormula(item) {
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

  const comment = text("p", `“${item.comment || ""}”`, "comment");
  const score = text("span", `净支持 ${item.net_score}`, "score");
  const actions = document.createElement("div");
  actions.className = "vote-actions";

  for (const [name, label, tone, value] of [
    ["like", "支持", "positive", 1],
    ["close", "取消投票", "neutral", 0],
    ["dislike", "反对", "negative", -1],
  ]) {
    let button;
    button = actionButton(name, label, tone, async () => {
      button.disabled = true;
      try {
        const updated = await vote(item.id, value);
        score.textContent = `净支持 ${updated.net_score}`;
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
    actions.append(button);
  }
  actions.append(score);
  card.append(title, recipe, comment, actions);
  return card;
}

async function load() {
  await window.ICON_SYSTEM.ready;
  window.ICON_SYSTEM.hydrateActions(document);
  const [formulaResponse, elementResponse] = await Promise.all([
    fetch("/api/community/formulas"),
    fetch("/api/elements"),
  ]);
  if (!formulaResponse.ok) throw new Error("公式加载失败");
  const [data, elementData] = await Promise.all([
    formulaResponse.json(),
    elementResponse.ok ? elementResponse.json() : {elements: {}},
  ]);
  for (const [name, info] of Object.entries(elementData.elements || {})) {
    elementsByName.set(name, info || {});
  }
  list.replaceChildren(...data.items.map(renderFormula));
  empty.hidden = data.items.length !== 0;
}

load().catch(() => {
  empty.textContent = "公式广场暂时加载失败，请稍后重试。";
  empty.hidden = false;
});
