(() => {
  "use strict";

  const CONFIRMATION = "DESTROY_ALL_MAKERS_KV";
  const TYPED_PHRASE = "清空 Makers KV";
  const MAX_BATCHES = 1_000;
  const button = document.getElementById("kv-destroy");
  const status = document.getElementById("kv-destroy-status");

  function setStatus(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function destroyBatch() {
    let token = sessionStorage.getItem("infinity_admin_token") || "";
    const send = () => fetch("/api/admin/kv/destroy", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ confirmation: CONFIRMATION }),
    });
    let response = await send();
    if (response.status === 401) {
      token = prompt("危险操作受保护，请输入 ADMIN_TOKEN：") || "";
      if (token) {
        sessionStorage.setItem("infinity_admin_token", token);
        response = await send();
      }
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  button.addEventListener("click", async () => {
    if (!confirm(
      "这会永久删除 Makers 生产 KV 的全部数据，且无法恢复。确定继续吗？",
    )) {
      return;
    }
    if (prompt(`请输入“${TYPED_PHRASE}”确认：`) !== TYPED_PHRASE) {
      setStatus("确认文字不匹配，操作已取消。", "warning");
      return;
    }

    button.disabled = true;
    let deleted = 0;
    try {
      for (let batch = 1; batch <= MAX_BATCHES; batch += 1) {
        const result = await destroyBatch();
        deleted += Number(result.deleted) || 0;
        setStatus(`正在清空 Makers KV：已删除 ${deleted} 条…`, "warning");
        if (result.done === true) {
          setStatus(
            `Makers KV 已清空，共删除 ${deleted} 条。下一次访问将重新初始化。`,
            "success",
          );
          return;
        }
      }
      throw new Error("数据量超出单次后台操作上限，请再次点击继续清理");
    } catch (error) {
      setStatus(`清空失败：${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
})();
