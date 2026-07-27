const list = document.querySelector("#formula-list");
const empty = document.querySelector("#empty");

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
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
  const title = text("h2", `${item.emoji} ${item.result}`);
  const recipe = text("p", `${item.a} + ${item.b}`, "recipe");
  const comment = text("p", `“${item.comment}”`, "comment");
  const score = text("span", `净支持 ${item.net_score}`, "score");
  const actions = document.createElement("div");
  actions.className = "vote-actions";
  for (const [label, value] of [["👍", 1], ["取消", 0], ["👎", -1]]) {
    const button = text("button", label);
    button.type = "button";
    button.addEventListener("click", async () => {
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
  const response = await fetch("/api/community/formulas");
  const data = await response.json();
  list.replaceChildren(...data.items.map(renderFormula));
  empty.hidden = data.items.length !== 0;
}

load().catch(() => {
  empty.textContent = "公式广场暂时加载失败，请稍后重试。";
  empty.hidden = false;
});
