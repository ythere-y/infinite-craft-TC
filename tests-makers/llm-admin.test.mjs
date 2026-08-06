import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {runInNewContext} from "node:vm";


class Control {
  constructor({value = "", dataset = {}} = {}) {
    this.value = value;
    this.dataset = dataset;
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  async trigger(name) {
    return this.listeners.get(name)?.({preventDefault() {}});
  }
}


test("LLM admin loads, saves, and tests the selected provider", async () => {
  const makers = new Control({value: "makers"});
  const deepseek = new Control({value: "deepseek"});
  const makersStatus = new Control({dataset: {}});
  const deepseekStatus = new Control({dataset: {}});
  const save = new Control();
  const probe = new Control();
  const status = new Control({dataset: {}});
  const controls = [makers, deepseek, save, probe];
  const panel = {
    querySelector(selector) {
      if (selector.endsWith(":checked")) {
        return [makers, deepseek].find((input) => input.checked) || null;
      }
      if (selector.includes('value="makers"')) return makers;
      if (selector.includes('value="deepseek"')) return deepseek;
      if (selector.includes('status="makers"')) return makersStatus;
      if (selector.includes('status="deepseek"')) return deepseekStatus;
      return null;
    },
    querySelectorAll() {
      return controls;
    },
  };
  const documentListeners = new Map();
  const document = {
    getElementById(id) {
      return {
        "admin-llm-panel": panel,
        "llm-save": save,
        "llm-test": probe,
        "llm-status": status,
      }[id];
    },
    addEventListener(name, listener) {
      documentListeners.set(name, listener);
    },
  };
  const requests = [];
  const responses = [
    {
      provider: "makers",
      providers: [
        {id: "makers", configured: true},
        {id: "deepseek", configured: true},
      ],
    },
    {
      provider: "deepseek",
      providers: [
        {id: "makers", configured: true},
        {id: "deepseek", configured: true},
      ],
    },
    {ok: true, provider: "deepseek", message: "连接成功", latency_ms: 12},
  ];
  const fetch = async (path, options = {}) => {
    requests.push({path, options});
    return {
      ok: true,
      status: 200,
      json: async () => responses.shift(),
    };
  };
  const source = await readFile("frontend/admin/llm-admin.js", "utf8");
  runInNewContext(source, {
    document,
    fetch,
    prompt: () => "",
    sessionStorage: {
      getItem: () => "admin-secret",
      setItem() {},
    },
  }, {filename: "llm-admin.js"});

  documentListeners.get("admin:tab-selected")({detail: {name: "llm"}});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(makers.checked, true);
  assert.equal(makersStatus.textContent, "凭据已配置");

  makers.checked = false;
  deepseek.checked = true;
  await save.trigger("click");
  await probe.trigger("click");

  assert.deepEqual(
    requests.map(({path, options}) => [path, options.method || "GET"]),
    [
      ["/api/admin/llm/config", "GET"],
      ["/api/admin/llm/config", "PUT"],
      ["/api/admin/llm/test", "POST"],
    ],
  );
  assert.deepEqual(
    JSON.parse(requests[1].options.body),
    {provider: "deepseek"},
  );
  assert.equal(status.textContent, "连接成功（12 ms）");
  assert.equal(status.dataset.tone, "success");
});
