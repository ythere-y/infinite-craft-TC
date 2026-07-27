const login = document.querySelector("#login");
const queue = document.querySelector("#queue");
const queueList = document.querySelector("#queue-list");

async function loadQueue() {
  const response = await fetch("/api/community/admin/queue");
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
  title.textContent = `${item.emoji} ${item.a} + ${item.b} → ${item.result}`;
  const score = document.createElement("p");
  score.textContent = `👍 ${item.up_votes} / 👎 ${item.down_votes} / 净支持 ${item.net_score}`;
  const reason = document.createElement("select");
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
  for (const [action, label] of [["keep", "保留"], ["protect", "保护"], ["takedown", "下架"], ["retire", "退役并允许 v2"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (action === "retire" && !confirm("退役会使下一次合成调用模型生成新版本，确认继续？")) return;
      const response = await fetch(`/api/community/admin/formulas/${item.id}/moderate`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action, reason_code: reason.value, note: ""}),
      });
      if (!response.ok) return alert((await response.json()).detail || "操作失败");
      await loadQueue();
    });
    actions.append(button);
  }
  card.append(title, score, reason, actions);
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

loadQueue();
