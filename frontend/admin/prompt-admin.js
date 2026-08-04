(() => {
  "use strict";

  const promptPanel = document.getElementById("admin-prompt-panel");
  const preview = document.getElementById("prompt-preview");
  const activateButton = document.getElementById("prompt-activate");
  const saveButton = document.getElementById("prompt-save");
  const aggregateButton = document.getElementById("prompt-aggregate");
  const adminTabs = Array.from(document.querySelectorAll("[data-admin-tab]"));

  let draft = null;
  let promptLoaded = false;
  let promptLoadPromise = null;
  let promptLoadRequestId = 0;
  let pendingVersionId = null;
  let draftRevision = null;
  let idSequence = 0;
  const invalidJsonFields = new Set();

  async function promptRequest(path, options = {}) {
    const token = sessionStorage.getItem("infinity_admin_token") || "";
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(token ? {authorization: `Bearer ${token}`} : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${response.status}`);
    }
    return response.json();
  }

  function setStatus(message, tone = "neutral") {
    const status = document.getElementById("prompt-status");
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setOperationDisabled(disabled) {
    const controls = promptPanel.querySelectorAll("button, input, textarea");
    if (disabled) {
      for (const control of controls) {
        if (!control.hasAttribute("data-operation-disabled")) {
          control.dataset.operationDisabled = String(control.disabled);
        }
        control.disabled = true;
      }
      return;
    }
    for (const control of controls) {
      if (control.dataset.operationDisabled === undefined) {
        continue;
      }
      control.disabled = control.dataset.operationDisabled === "true";
      delete control.dataset.operationDisabled;
    }
    activateButton.disabled = !pendingVersionId;
  }

  function clearPendingVersion(message) {
    pendingVersionId = null;
    activateButton.disabled = true;
    preview.value = "";
    if (message) {
      setStatus(message, "warning");
    }
  }

  function markDraftDirty() {
    clearPendingVersion("草稿已修改，请保存并重新聚合后再设为生效。");
  }

  function fieldValue(input, field) {
    if (input.type === "checkbox") {
      return input.checked;
    }
    if (field === "order") {
      return Number(input.value);
    }
    return input.value;
  }

  function populateManagedItem(element, item, collectionName, index) {
    for (const input of element.querySelectorAll("[data-field]")) {
      const field = input.dataset.field;
      if (input.type === "checkbox") {
        input.checked = item[field] === true;
      } else {
        input.value = item[field] ?? "";
      }
      const eventName = input.type === "checkbox" ? "change" : "input";
      input.addEventListener(eventName, () => {
        item[field] = fieldValue(input, field);
        if (collectionName === "styles") {
          updateProbabilityFeedback();
        }
        markDraftDirty();
      });
    }

    element.querySelector("[data-remove-prompt-item]").addEventListener("click", () => {
      draft[collectionName].splice(index, 1);
      renderManagedCollection(collectionName);
      markDraftDirty();
    });
  }

  function collectionDefinition(collectionName) {
    const exampleContainers = {
      "positive_examples": "prompt-positive-examples",
      "negative_examples": "prompt-negative-examples",
    };
    if (collectionName === "system_modules") {
      return {
        containerId: "prompt-system-modules",
        templateId: "prompt-module-template",
      };
    }
    if (collectionName === "styles") {
      return {
        containerId: "prompt-styles",
        templateId: "prompt-style-template",
      };
    }
    return {
      containerId: exampleContainers[collectionName],
      templateId: "prompt-example-template",
    };
  }

  function renderManagedCollection(collectionName) {
    const definition = collectionDefinition(collectionName);
    const container = document.getElementById(definition.containerId);
    const template = document.getElementById(definition.templateId);
    const nodes = draft[collectionName].map((item, index) => {
      const node = template.content.firstElementChild.cloneNode(true);
      populateManagedItem(node, item, collectionName, index);
      return node;
    });
    container.replaceChildren(...nodes);
    if (collectionName === "styles") {
      updateProbabilityFeedback();
    }
  }

  function updateProbabilityFeedback() {
    const enabled = draft.styles.filter((style) => style.enabled);
    const summary = PromptDecimal.summarize(
      enabled.map((style) => style.probability),
    );
    const feedback = document.getElementById("prompt-probability-total");
    if (summary.error) {
      feedback.textContent = summary.error;
      feedback.dataset.valid = String(summary.valid);
      return;
    }
    feedback.textContent = `已启用概率合计：${summary.total}%（必须为 100%）`;
    feedback.dataset.valid = String(summary.valid);
  }

  function newStableId(prefix, items) {
    const existing = new Set(items.map((item) => item.id));
    let candidate = "";
    do {
      idSequence += 1;
      candidate = `${prefix}-${Date.now()}-${idSequence}`;
    } while (existing.has(candidate));
    return candidate;
  }

  function addManagedItem(collectionName) {
    const items = draft[collectionName];
    if (collectionName === "system_modules") {
      items.push({
        id: newStableId("module", items),
        enabled: true,
        order: items.length === 0
          ? 10
          : Math.max(...items.map((item) => Number(item.order) || 0)) + 10,
        content: "",
      });
    } else if (collectionName === "styles") {
      items.push({
        id: newStableId("style", items),
        enabled: false,
        label: "",
        guidance: "",
        probability: "0",
      });
    } else {
      items.push({
        id: newStableId(
          collectionName === "positive_examples" ? "positive" : "negative",
          items,
        ),
        enabled: false,
        content: "",
      });
    }
    renderManagedCollection(collectionName);
    markDraftDirty();
  }

  function bindJsonEditor(elementId, fieldName) {
    const editor = document.getElementById(elementId);
    editor.value = JSON.stringify(draft[fieldName], null, 2);
    editor.setAttribute("aria-invalid", "false");
    editor.oninput = () => {
      clearPendingVersion();
      try {
        draft[fieldName] = JSON.parse(editor.value);
        invalidJsonFields.delete(fieldName);
        editor.setAttribute("aria-invalid", "false");
        setStatus("草稿已修改，请保存并重新聚合后再设为生效。", "warning");
      } catch (error) {
        invalidJsonFields.add(fieldName);
        editor.setAttribute("aria-invalid", "true");
        setStatus(`${fieldName} 不是有效 JSON：${error.message}`, "error");
      }
    };
  }

  function renderDraft() {
    document.getElementById("prompt-schema-version").value =
      draft.schema_version ?? "";
    const temperature = document.getElementById("prompt-temperature");
    temperature.value = draft.temperature ?? "";
    temperature.oninput = () => {
      draft.temperature = Number(temperature.value);
      markDraftDirty();
    };

    renderManagedCollection("system_modules");
    renderManagedCollection("styles");
    renderManagedCollection("positive_examples");
    renderManagedCollection("negative_examples");
    bindJsonEditor("prompt-structured-examples", "structured_examples");
    bindJsonEditor("prompt-capacities", "capacities");
    bindJsonEditor("prompt-limits", "limits");
  }

  function versionNode(version) {
    const wrapper = document.createElement("article");
    wrapper.className = "prompt-version";

    const heading = document.createElement("div");
    heading.className = "prompt-version-heading";
    const id = document.createElement("span");
    id.className = "prompt-version-id";
    id.textContent = version.id;
    heading.append(id);
    if (version.active) {
      const active = document.createElement("span");
      active.className = "prompt-version-active";
      active.textContent = "当前生效";
      heading.append(active);
    }

    const meta = document.createElement("p");
    meta.className = "prompt-version-meta";
    const created = Number(version.created_at);
    const createdText = Number.isFinite(created)
      ? new Date(created * 1000).toLocaleString("zh-CN")
      : "时间未知";
    const styleText = version.selected_style_name || "初始完整配置";
    meta.textContent = `${createdText} · ${styleText}`;

    const actions = document.createElement("div");
    actions.className = "prompt-version-actions";
    const view = document.createElement("button");
    view.type = "button";
    view.textContent = "查看";
    view.setAttribute("aria-label", `查看版本 ${version.id}`);
    view.addEventListener("click", () => viewVersion(version.id));
    const activate = document.createElement("button");
    activate.type = "button";
    activate.textContent = version.active ? "已生效" : "设为生效";
    activate.setAttribute("aria-label",
      version.active ? `版本 ${version.id} 已生效` : `将版本 ${version.id} 设为生效`);
    activate.disabled = version.active === true;
    activate.addEventListener("click", () => activateHistoricalVersion(version.id));
    actions.append(view, activate);

    wrapper.append(heading, meta, actions);
    return wrapper;
  }

  function renderVersions(versions) {
    const history = document.getElementById("prompt-version-history");
    if (versions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "prompt-empty";
      empty.textContent = "暂无历史版本。";
      history.replaceChildren(empty);
      return;
    }
    history.replaceChildren(...versions.map(versionNode));
  }

  function loadPromptConfig() {
    if (promptLoadPromise) {
      return promptLoadPromise;
    }
    const requestId = ++promptLoadRequestId;
    setStatus("正在加载 Prompt 配置…");
    promptLoadPromise = (async () => {
      try {
        const payload = await promptRequest("/api/admin/prompt/config");
        if (requestId !== promptLoadRequestId) {
          return;
        }
        draft = payload.config;
        draftRevision = payload.revision;
        invalidJsonFields.clear();
        renderDraft();
        renderVersions(payload.versions);
        promptLoaded = true;
        const activeId = payload.active_version?.id || "未知";
        setStatus(`配置已加载，当前生效版本：${activeId}`, "success");
      } catch (error) {
        if (requestId !== promptLoadRequestId) {
          return;
        }
        setStatus(`配置加载失败：${error.message}`, "error");
      } finally {
        if (requestId === promptLoadRequestId) {
          promptLoadPromise = null;
        }
      }
    })();
    return promptLoadPromise;
  }

  async function refreshVersionSummaries() {
    const payload = await promptRequest("/api/admin/prompt/config");
    renderVersions(payload.versions);
    return payload;
  }

  async function refreshAfterMutation(successMessage) {
    try {
      await refreshVersionSummaries();
      setStatus(successMessage, "success");
    } catch (error) {
      setStatus(
        `${successMessage}；版本列表同步失败：${error.message}`,
        "warning",
      );
    }
  }

  async function saveDraft() {
    if (!draft) {
      throw new Error("Prompt 配置尚未加载");
    }
    if (invalidJsonFields.size > 0) {
      throw new Error("请先修正标记为无效的 JSON 字段");
    }
    if (!Number.isSafeInteger(draftRevision)) {
      throw new Error("Prompt 配置版本尚未加载");
    }
    const saved = await promptRequest("/api/admin/prompt/config", {
      method: "PUT",
      headers: {"If-Match": `"${draftRevision}"`},
      body: JSON.stringify({config: draft}),
    });
    draftRevision = saved.revision;
    invalidJsonFields.clear();
    setStatus("草稿已保存。", "success");
    return saved.config;
  }

  async function aggregateDraft() {
    setOperationDisabled(true);
    try {
      await saveDraft();
      const version = await promptRequest("/api/admin/prompt/aggregate", {
        method: "POST",
        body: JSON.stringify({expected_revision: draftRevision}),
      });
      pendingVersionId = version.id;
      preview.value = version.preview || "";
      await refreshAfterMutation(
        `已聚合版本 ${version.id}，确认预览后可设为生效。`,
      );
    } catch (error) {
      setStatus(`聚合失败：${error.message}`, "error");
    } finally {
      setOperationDisabled(false);
    }
  }

  async function activatePreviewVersion() {
    if (!pendingVersionId) {
      setStatus("当前没有可激活的聚合预览，请先重新聚合。", "warning");
      return;
    }
    const versionId = pendingVersionId;
    setOperationDisabled(true);
    try {
      await promptRequest(
        `/api/admin/prompt/versions/${encodeURIComponent(versionId)}/activate`,
        {method: "POST"},
      );
      pendingVersionId = null;
      await refreshAfterMutation(`版本 ${versionId} 已设为生效。`);
    } catch (error) {
      setStatus(`激活失败：${error.message}`, "error");
    } finally {
      setOperationDisabled(false);
    }
  }

  async function viewVersion(versionId) {
    setOperationDisabled(true);
    try {
      const version = await promptRequest(
        `/api/admin/prompt/versions/${encodeURIComponent(versionId)}`,
      );
      pendingVersionId = null;
      preview.value = version.preview || "";
      setStatus(`正在查看历史版本 ${version.id}。`, "neutral");
    } catch (error) {
      setStatus(`版本加载失败：${error.message}`, "error");
    } finally {
      setOperationDisabled(false);
    }
  }

  async function activateHistoricalVersion(versionId) {
    const confirmed = window.confirm(
      `确定将历史版本 ${versionId} 设为生效吗？`,
    );
    if (!confirmed) {
      return;
    }
    setOperationDisabled(true);
    try {
      await promptRequest(
        `/api/admin/prompt/versions/${encodeURIComponent(versionId)}/activate`,
        {method: "POST"},
      );
      pendingVersionId = null;
      await refreshAfterMutation(`历史版本 ${versionId} 已设为生效。`);
    } catch (error) {
      setStatus(`历史版本激活失败：${error.message}`, "error");
    } finally {
      setOperationDisabled(false);
    }
  }

  function selectTab(name) {
    for (const tab of adminTabs) {
      const selected = tab.dataset.adminTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-admin-panel]")) {
      panel.hidden = panel.dataset.adminPanel !== name;
    }
    if (name === "prompt" && !promptLoaded) {
      loadPromptConfig();
    }
  }

  function moveTabFocus(event, currentIndex) {
    let nextIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % adminTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + adminTabs.length) % adminTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = adminTabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = adminTabs[nextIndex];
    selectTab(nextTab.dataset.adminTab);
    nextTab.focus();
  }

  adminTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.adminTab));
    tab.addEventListener("keydown", (event) => moveTabFocus(event, index));
  });

  for (const button of promptPanel.querySelectorAll("[data-add-prompt-item]")) {
    button.addEventListener("click", () => {
      if (draft) {
        addManagedItem(button.dataset.addPromptItem.replaceAll("-", "_"));
      }
    });
  }

  saveButton.addEventListener("click", async () => {
    setOperationDisabled(true);
    try {
      await saveDraft();
    } catch (error) {
      setStatus(`保存失败：${error.message}`, "error");
    } finally {
      setOperationDisabled(false);
    }
  });
  aggregateButton.addEventListener("click", aggregateDraft);
  activateButton.addEventListener("click", activatePreviewVersion);
})();
