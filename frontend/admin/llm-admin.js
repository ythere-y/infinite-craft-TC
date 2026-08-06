(() => {
  "use strict";

  const panel = document.getElementById("admin-llm-panel");
  const saveButton = document.getElementById("llm-save");
  const testButton = document.getElementById("llm-test");
  const status = document.getElementById("llm-status");
  let loaded = false;

  function selectedProvider() {
    return panel.querySelector('input[name="llm-provider"]:checked')?.value || "";
  }

  function setStatus(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setBusy(busy) {
    for (const control of panel.querySelectorAll("button, input")) {
      control.disabled = busy;
    }
  }

  async function request(path, options = {}) {
    let token = sessionStorage.getItem("infinity_admin_token") || "";
    const send = () => fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(options.headers || {}),
      },
    });
    let response = await send();
    if (response.status === 401) {
      token = prompt("LLM 配置受保护，请输入 ADMIN_TOKEN：") || "";
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

  function renderConfiguration(config) {
    const selected = panel.querySelector(
      `input[name="llm-provider"][value="${config.provider}"]`,
    );
    if (selected) selected.checked = true;
    for (const provider of config.providers || []) {
      const target = panel.querySelector(
        `[data-provider-status="${provider.id}"]`,
      );
      if (target) {
        target.textContent = provider.configured ? "凭据已配置" : "凭据未配置";
        target.dataset.configured = String(provider.configured);
      }
    }
  }

  async function load() {
    if (loaded) return;
    setBusy(true);
    try {
      renderConfiguration(await request("/api/admin/llm/config"));
      loaded = true;
      setStatus("已加载当前接口配置。");
    } catch (error) {
      setStatus(`加载失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  }

  saveButton.addEventListener("click", async () => {
    const provider = selectedProvider();
    if (!provider) return;
    setBusy(true);
    try {
      renderConfiguration(await request("/api/admin/llm/config", {
        method: "PUT",
        body: JSON.stringify({provider}),
      }));
      setStatus("接口选择已保存，并将用于后续新组合生成。", "success");
    } catch (error) {
      setStatus(`保存失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  });

  testButton.addEventListener("click", async () => {
    const provider = selectedProvider();
    if (!provider) return;
    setBusy(true);
    setStatus("正在发起最小模型请求…");
    try {
      const result = await request("/api/admin/llm/test", {
        method: "POST",
        body: JSON.stringify({provider}),
      });
      setStatus(
        `${result.message}（${result.latency_ms} ms）`,
        result.ok ? "success" : "error",
      );
    } catch (error) {
      setStatus(`测试失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  });

  document.addEventListener("admin:tab-selected", (event) => {
    if (event.detail?.name === "llm") load();
  });
})();
