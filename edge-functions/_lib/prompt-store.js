import { PROMPT_SPEC } from "../_generated/prompt-data.js";
import { buildPromptMessagesFromSpec } from "./prompt.js";

const STATE_KEY = "prompt_admin_state";
const INITIAL_VERSION_ID = "prompt-initial-v1";
const MAX_VERSIONS = 100;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(422, message);
  }
}

function validateManaged(items, label, fields) {
  if (!Array.isArray(items)) fail(422, `${label}必须是列表`);
  const ids = new Set();
  for (const item of items) {
    assertObject(item, `${label}条目必须是对象`);
    if (typeof item.id !== "string" || !item.id.trim() || item.id !== item.id.trim()) {
      fail(422, `${label} ID 必须是稳定的非空字符串`);
    }
    if (ids.has(item.id)) fail(422, `${label} ID 不能重复`);
    ids.add(item.id);
    if (typeof item.enabled !== "boolean") {
      fail(422, `${label} enabled 必须是布尔值`);
    }
    for (const field of fields) {
      if (
        item.enabled &&
        (typeof item[field] !== "string" || !item[field].trim())
      ) {
        fail(422, `已启用${label}的${field}不能为空`);
      }
    }
  }
  return items;
}

function validateDraft(value) {
  assertObject(value, "提示词草稿必须是对象");
  const draft = clone(value);
  if (draft.schema_version !== 1) fail(422, "不支持的 Prompt 草稿版本");
  const temperature = Number(draft.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    fail(422, "Temperature 必须是 0 到 2 之间的数字");
  }
  draft.temperature = temperature;

  const modules = validateManaged(
    draft.system_modules,
    "系统模块",
    ["content"],
  );
  const styles = validateManaged(draft.styles, "风格", ["label", "guidance"]);
  validateManaged(draft.positive_examples, "正面案例", ["content"]);
  validateManaged(draft.negative_examples, "负面案例", ["content"]);
  if (!modules.some((item) => item.enabled)) fail(422, "至少启用一个系统模块");

  const enabledStyles = styles.filter((item) => item.enabled);
  if (!enabledStyles.length) fail(422, "至少启用一种风格");
  let total = 0;
  for (const style of styles) {
    const probability = Number(style.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      fail(422, "风格概率必须是 0 到 100 的有限数字");
    }
    if (style.enabled) total += probability;
  }
  if (Math.abs(total - 100) > 1e-9) {
    fail(422, "已启用风格的概率总和必须等于 100%");
  }
  if (!Array.isArray(draft.structured_examples)) {
    fail(422, "structured_examples 必须是列表");
  }
  assertObject(draft.capacities, "capacities 必须是对象");
  assertObject(draft.limits, "limits 必须是对象");
  for (const name of ["avoid_words", "community_examples", "bounty_candidates"]) {
    const limit = Number(draft.limits[name]);
    if (!Number.isSafeInteger(limit) || limit < 0) {
      fail(422, `${name} 必须是非负整数`);
    }
    draft.limits[name] = limit;
  }
  return draft;
}

export function draftFromPromptSpec(spec = PROMPT_SPEC) {
  return {
    schema_version: 1,
    temperature: Number(spec.temperature),
    system_modules: clone(spec.system_modules),
    structured_examples: clone(spec.examples),
    styles: spec.styles.map((style) => ({
      id: style.id,
      enabled: style.enabled !== false,
      label: style.label,
      guidance: style.guidance,
      probability: String(Number(style.weight) * 100),
    })),
    positive_examples: clone(spec.positive_examples || []),
    negative_examples: clone(spec.negative_examples || []),
    capacities: clone(spec.capacities),
    limits: clone(spec.limits),
  };
}

export function promptSpecFromDraft(rawDraft, selectedStyleId = null) {
  const draft = validateDraft(rawDraft);
  let styles = draft.styles.map((style) => ({
    id: style.id,
    enabled: style.enabled,
    label: style.label,
    guidance: style.guidance,
    weight: Number(style.probability) / 100,
  }));
  if (selectedStyleId != null) {
    const selected = styles.find((style) => style.id === selectedStyleId);
    if (!selected) fail(422, "选择的风格不存在");
    styles = [{ ...selected, enabled: true, weight: 1 }];
  }
  return {
    schema_version: 1,
    temperature: draft.temperature,
    system_modules: clone(draft.system_modules),
    examples: clone(draft.structured_examples),
    styles,
    ...(draft.positive_examples.length
      ? { positive_examples: clone(draft.positive_examples) }
      : {}),
    ...(draft.negative_examples.length
      ? { negative_examples: clone(draft.negative_examples) }
      : {}),
    capacities: clone(draft.capacities),
    limits: clone(draft.limits),
  };
}

function versionSummary(version, activeId) {
  return {
    id: version.id,
    created_at: version.created_at,
    selected_style_id: version.selected_style_id,
    selected_style_name: version.selected_style_name,
    selected_style: version.selected_style,
    active: version.id === activeId,
  };
}

function versionResponse(version, activeId) {
  return {
    ...clone(version),
    active: version.id === activeId,
  };
}

function previewFor(spec) {
  return JSON.stringify(buildPromptMessagesFromSpec(spec, {
    a: "{{元素A}}",
    b: "{{元素B}}",
    avoid_words: ["{{近期结果}}"],
    bounty_candidates: [],
    community_examples: [],
    style_value: 0,
  }));
}

export class PromptStore {
  constructor(kv, {
    now = () => Date.now(),
    random = Math.random,
  } = {}) {
    if (!kv) throw new TypeError("Prompt store requires KV");
    this.kv = kv;
    this.now = now;
    this.random = random;
    this.sequence = 0;
    this.cached = null;
    this.cacheUntil = 0;
  }

  initialState() {
    const draft = validateDraft(draftFromPromptSpec());
    const effectiveSpec = promptSpecFromDraft(draft);
    const version = {
      id: INITIAL_VERSION_ID,
      created_at: Math.floor(this.now() / 1_000),
      selected_style_id: null,
      selected_style_name: null,
      selected_style: null,
      snapshot: clone(draft),
      effective_spec: effectiveSpec,
      preview: previewFor(effectiveSpec),
    };
    return {
      schema_version: 1,
      revision: 1,
      draft,
      active_version_id: version.id,
      versions: [version],
    };
  }

  cache(state) {
    this.cached = clone(state);
    this.cacheUntil = this.now() + 5_000;
    return clone(state);
  }

  async readState() {
    if (this.cached && this.now() <= this.cacheUntil) {
      return clone(this.cached);
    }
    const raw = await this.kv.get(STATE_KEY);
    if (raw) {
      try {
        const state = JSON.parse(raw);
        if (
          state?.schema_version === 1 &&
          Number.isSafeInteger(state.revision) &&
          Array.isArray(state.versions)
        ) {
          return this.cache(state);
        }
      } catch {
        fail(503, "Prompt 配置数据损坏");
      }
      fail(503, "Prompt 配置数据损坏");
    }
    const state = this.initialState();
    await this.writeState(state);
    return clone(state);
  }

  async writeState(state) {
    const limited = {
      ...state,
      versions: state.versions.slice(0, MAX_VERSIONS),
    };
    await this.kv.put(STATE_KEY, JSON.stringify(limited));
    this.cache(limited);
  }

  async configuration({ limit = 50, offset = 0 } = {}) {
    const state = await this.readState();
    const versions = state.versions.slice(offset, offset + limit);
    const active = state.versions.find(
      (item) => item.id === state.active_version_id,
    );
    return {
      config: clone(state.draft),
      revision: state.revision,
      active_version: active
        ? versionSummary(active, state.active_version_id)
        : null,
      versions: versions.map(
        (item) => versionSummary(item, state.active_version_id),
      ),
      version_page: {
        limit,
        offset,
        next_offset: offset + versions.length,
        has_more: offset + versions.length < state.versions.length,
      },
    };
  }

  assertRevision(state, expected) {
    if (!Number.isSafeInteger(expected) || expected !== state.revision) {
      fail(409, `Prompt 草稿已更新，当前版本为 ${state.revision}`);
    }
  }

  async saveDraft(config, expectedRevision) {
    const state = await this.readState();
    this.assertRevision(state, expectedRevision);
    state.draft = validateDraft(config);
    state.revision += 1;
    await this.writeState(state);
    return { config: clone(state.draft), revision: state.revision };
  }

  selectStyle(draft) {
    const enabled = draft.styles.filter((style) => style.enabled);
    const total = enabled.reduce(
      (sum, style) => sum + Number(style.probability),
      0,
    );
    let roll = Math.max(0, Math.min(0.9999999999999999, this.random())) * total;
    for (const style of enabled) {
      roll -= Number(style.probability);
      if (roll < 0) return style;
    }
    return enabled[enabled.length - 1];
  }

  async aggregate(expectedRevision) {
    const state = await this.readState();
    this.assertRevision(state, expectedRevision);
    const draft = validateDraft(state.draft);
    const style = this.selectStyle(draft);
    const effectiveSpec = promptSpecFromDraft(draft, style.id);
    this.sequence += 1;
    const version = {
      id: `prompt-${this.now()}-${this.sequence}`,
      created_at: Math.floor(this.now() / 1_000),
      selected_style_id: style.id,
      selected_style_name: style.label,
      selected_style: { id: style.id, name: style.label },
      snapshot: clone(draft),
      effective_spec: effectiveSpec,
      preview: previewFor(effectiveSpec),
    };
    state.versions.unshift(version);
    await this.writeState(state);
    return versionResponse(version, state.active_version_id);
  }

  findVersion(state, id) {
    const version = state.versions.find((item) => item.id === id);
    if (!version) fail(404, "Prompt 版本不存在");
    return version;
  }

  async getVersion(id) {
    const state = await this.readState();
    return versionResponse(
      this.findVersion(state, id),
      state.active_version_id,
    );
  }

  async activate(id) {
    const state = await this.readState();
    const version = this.findVersion(state, id);
    state.active_version_id = id;
    await this.writeState(state);
    return versionResponse(version, id);
  }

  async copyToDraft(id, expectedRevision) {
    const state = await this.readState();
    this.assertRevision(state, expectedRevision);
    const version = this.findVersion(state, id);
    state.draft = validateDraft(version.snapshot);
    state.revision += 1;
    await this.writeState(state);
    return { config: clone(state.draft), revision: state.revision };
  }

  async deleteVersion(id) {
    const state = await this.readState();
    const version = this.findVersion(state, id);
    if (id === state.active_version_id) fail(409, "不能删除当前生效版本");
    if (id === INITIAL_VERSION_ID) fail(409, "不能删除初始版本");
    state.versions = state.versions.filter((item) => item !== version);
    await this.writeState(state);
  }

  async activeSpec() {
    try {
      const state = await this.readState();
      const active = state.versions.find(
        (item) => item.id === state.active_version_id,
      );
      return active?.effective_spec
        ? clone(active.effective_spec)
        : clone(PROMPT_SPEC);
    } catch {
      return clone(PROMPT_SPEC);
    }
  }
}
