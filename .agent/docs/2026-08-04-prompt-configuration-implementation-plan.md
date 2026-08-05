# 本地 Prompt 配置与版本管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本地 FastAPI 部署增加受 `ADMIN_TOKEN` 保护的 Prompt 草稿编辑、概率聚合、版本预览、发布和回滚能力，并让 LLM 只读取当前生效版本。

**Architecture:** 新建独立的 `backend/prompt_store.py`，在现有 SQLite 文件中保存一份 JSON 草稿、不可变版本快照和当前生效指针。现有 `prompt_spec.py` 继续负责标准规范校验和渲染，Prompt Store 负责管理层校验、初始导入、聚合与版本读取；`main.py` 只负责鉴权、HTTP DTO 和路由。`/admin` 通过新增的独立 CSS/JS 文件提供编辑界面，避免继续扩大现有内联脚本。

**Tech Stack:** Python 3、FastAPI、Pydantic、SQLite、pytest、原生 HTML/CSS/JavaScript、Node test runner。

## Global Constraints

- 仅实现本地 FastAPI 部署；Makers/EdgeOne 继续使用 `shared/combine-prompt.json`。
- 所有 `/api/admin/prompt/*` 接口必须校验 `Authorization: Bearer <ADMIN_TOKEN>`。
- 所有已启用风格的百分比之和必须精确等于 `100`。
- 草稿保存不影响在线请求；只有显式激活的不可变版本才会生效。
- 首次启动从现有标准规范生成初始草稿和初始生效版本，渲染行为必须保持不变。
- 不提交 `.env`、凭据、SQLite 数据库或运行时数据。
- AI 设计和计划文档只保存在 `.agent/docs/`。

---

### Task 1: Prompt Store 数据表、草稿转换与初始导入

**Files:**
- Create: `backend/prompt_store.py`
- Modify: `backend/archive.py`
- Create: `tests/test_prompt_store.py`

**Interfaces:**
- Consumes: `backend.prompt_spec.load_prompt_spec()` 和 `validate_prompt_spec(spec)`。
- Produces: `init_prompt_store() -> None`、`get_draft() -> dict`、`save_draft(draft: dict) -> dict`、`get_active_spec() -> dict`。

- [x] **Step 1: 写入初始导入失败测试**

```python
def test_bootstrap_imports_canonical_prompt_as_active_version(
    isolated_prompt_db, canonical_spec
):
    prompt_store.init_prompt_store()

    draft = prompt_store.get_draft()
    active = prompt_store.get_active_version()

    assert sum(
        style["probability"]
        for style in draft["styles"]
        if style["enabled"]
    ) == 100
    assert active["effective_spec"] == canonical_spec
    assert prompt_store.get_active_spec() == canonical_spec
    assert draft["positive_examples"] == []
    assert draft["negative_examples"] == []
```

测试夹具通过 monkeypatch 将 `archive._DATA_DIR` 指向 `tmp_path`，设置
`APP_ENV=test`，调用 `archive.init_archive()`，并在每个测试后恢复环境。

- [x] **Step 2: 运行测试并确认按预期失败**

Run:

```text
python -m pytest tests/test_prompt_store.py::test_bootstrap_imports_canonical_prompt_as_active_version -q
```

Expected: FAIL，原因是 `backend.prompt_store` 或 Prompt 数据表尚不存在。

- [x] **Step 3: 在 SQLite 初始化中建立管理表**

向 `archive.init_archive()` 的同一个 `executescript` 增加：

```sql
CREATE TABLE IF NOT EXISTS prompt_draft (
    singleton   INTEGER PRIMARY KEY CHECK (singleton = 1),
    config_json TEXT NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id                  TEXT PRIMARY KEY,
    created_at          REAL NOT NULL,
    selected_style_id   TEXT,
    selected_style_name TEXT,
    snapshot_json       TEXT NOT NULL,
    effective_spec_json TEXT NOT NULL,
    preview             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_state (
    singleton         INTEGER PRIMARY KEY CHECK (singleton = 1),
    active_version_id TEXT NOT NULL REFERENCES prompt_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_created
ON prompt_versions(created_at DESC);
```

- [x] **Step 4: 实现标准规范与管理草稿的双向转换**

在 `backend/prompt_store.py` 中实现：

```python
def draft_from_canonical(spec: dict) -> dict:
    validated = validate_prompt_spec(spec)
    return {
        "schema_version": 1,
        "temperature": validated["temperature"],
        "system_modules": copy.deepcopy(validated["system_modules"]),
        "structured_examples": copy.deepcopy(validated["examples"]),
        "styles": [
            {
                "id": style["id"],
                "enabled": style["enabled"],
                "label": style["label"],
                "guidance": style["guidance"],
                "probability": str(
                    (Decimal(str(style["weight"])) * Decimal("100"))
                    .normalize()
                ),
            }
            for style in validated["styles"]
        ],
        "positive_examples": [],
        "negative_examples": [],
        "capacities": copy.deepcopy(validated["capacities"]),
        "limits": copy.deepcopy(validated["limits"]),
    }
```

`canonical_from_draft(draft, selected_style_id=None)` 必须在没有指定风格时保留所有
标准风格及其原始比例；指定风格时只输出该风格且权重为 `1.0`。初始版本直接保存未经变形的
`load_prompt_spec()` 结果，保证严格兼容。

- [x] **Step 5: 实现幂等初始化和基础读写**

`init_prompt_store()` 在 `_lock` 和单个 SQLite 事务中：

1. 查询 `prompt_draft`；
2. 已存在则校验草稿、版本和生效指针后返回；
3. 不存在则读取标准规范；
4. 插入草稿；
5. 插入 ID 为 `prompt-initial-<UTC timestamp>` 的初始版本；
6. 插入生效指针；
7. 提交事务。

所有 JSON 使用：

```python
json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
```

- [x] **Step 6: 添加幂等和持久化测试**

```python
def test_bootstrap_is_idempotent(isolated_prompt_db):
    prompt_store.init_prompt_store()
    first = prompt_store.get_active_version()["id"]
    prompt_store.init_prompt_store()
    assert prompt_store.get_active_version()["id"] == first
    assert len(prompt_store.list_versions()) == 1


def test_saved_draft_survives_store_reinitialization(isolated_prompt_db):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["temperature"] = 0.25
    prompt_store.save_draft(draft)
    prompt_store.init_prompt_store()
    assert prompt_store.get_draft()["temperature"] == 0.25
```

- [x] **Step 7: 运行 Prompt Store 测试**

Run:

```text
python -m pytest tests/test_prompt_store.py -q
```

Expected: PASS。

- [x] **Step 8: 提交**

```text
git add backend/archive.py backend/prompt_store.py tests/test_prompt_store.py
git commit -m "feat: persist local prompt drafts and versions"
```

---

### Task 2: 草稿校验、概率选择和不可变聚合版本

**Files:**
- Modify: `backend/prompt_store.py`
- Modify: `backend/prompt_spec.py`
- Modify: `tests/test_prompt_store.py`
- Modify: `tests/test_prompt_validation.py`

**Interfaces:**
- Consumes: Task 1 的 `get_draft()` 和 SQLite 表。
- Produces: `validate_draft(value: object) -> dict`、`aggregate_draft(random_value: float | None = None) -> dict`、`get_version(version_id: str) -> dict`、`activate_version(version_id: str) -> dict`、`list_versions() -> list[dict]`。

- [x] **Step 1: 写入非法概率和重复 ID 测试**

```python
@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d.update(styles=[]), "至少启用一种风格"),
        (
            lambda d: d["styles"][0].update(probability="99"),
            "概率总和必须等于 100%",
        ),
        (
            lambda d: d["styles"][1].update(id=d["styles"][0]["id"]),
            "风格 ID 不能重复",
        ),
    ],
)
def test_save_draft_rejects_invalid_configuration(
    isolated_prompt_db, mutate, message
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    mutate(draft)
    with pytest.raises(prompt_store.PromptValidationError, match=message):
        prompt_store.save_draft(draft)
```

- [x] **Step 2: 运行测试并确认失败**

Run:

```text
python -m pytest tests/test_prompt_store.py -k rejects_invalid -q
```

Expected: FAIL，原因是管理草稿校验尚未实现。

- [x] **Step 3: 实现十进制概率和模块校验**

使用 `Decimal(str(value))` 校验每个概率在 `0..100`，并使用：

```python
enabled_total = sum(
    Decimal(style["probability"])
    for style in styles
    if style["enabled"]
)
if enabled_total != Decimal("100"):
    raise PromptValidationError("已启用风格的概率总和必须等于 100%")
```

为 `system_modules`、`styles`、`positive_examples`、`negative_examples` 分别检查：
列表类型、稳定非空 ID、ID 唯一性、布尔 `enabled`，以及已启用条目的非空文本。
最后调用 `validate_prompt_spec(canonical_from_draft(validated))` 复用现有参数和结构化案例校验。

- [x] **Step 4: 写入确定性概率边界测试**

```python
@pytest.mark.parametrize(
    ("random_value", "expected"),
    [
        (0.0, "first"),
        (0.599999, "first"),
        (0.6, "second"),
        (0.999999, "second"),
        (1.0, "second"),
    ],
)
def test_aggregate_selects_style_at_probability_boundaries(
    isolated_prompt_db, random_value, expected
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["styles"] = [
        {
            "id": "first", "enabled": True, "label": "第一",
            "guidance": "第一风格", "probability": "60",
        },
        {
            "id": "second", "enabled": True, "label": "第二",
            "guidance": "第二风格", "probability": "40",
        },
    ]
    prompt_store.save_draft(draft)
    assert (
        prompt_store.aggregate_draft(random_value=random_value)
        ["selected_style"]["id"]
        == expected
    )
```

- [x] **Step 5: 扩展渲染器支持正负纯文本章节**

`build_prompt_messages_from_spec()` 在结构化示例之后、动态社区示例之前追加可选章节：

```python
positive_examples = [
    item["content"] for item in spec.get("positive_examples", [])
    if item["enabled"]
]
negative_examples = [
    item["content"] for item in spec.get("negative_examples", [])
    if item["enabled"]
]
```

正面章节标题为 `【正面案例】`，负面章节标题为 `【负面案例】`。字段缺失时输出必须与
现有规范完全一致，以保持 Makers parity 测试不变。

- [x] **Step 6: 实现聚合、预览、读取和激活**

风格选择将注入值限制到 `[0, 1]`，按启用风格的累计百分比选择，`1.0` 明确落到最后一个
启用风格。版本 ID 使用 `prompt-<UTC basic timestamp>-<uuid前8位>`。

预览通过 `build_prompt_messages_from_spec()` 使用固定占位数据渲染：

```python
{
    "a": "{{元素A}}",
    "b": "{{元素B}}",
    "avoid_words": ["{{近期结果}}"],
    "bounty_candidates": [],
    "community_examples": [],
    "style_value": 0,
}
```

`activate_version()` 只更新 `prompt_state.active_version_id`，不得复制或改写版本。

- [x] **Step 7: 添加版本不可变、预览和回滚测试**

```python
def test_aggregated_version_is_immutable_after_draft_changes(isolated_prompt_db):
    prompt_store.init_prompt_store()
    version = prompt_store.aggregate_draft(random_value=0)
    draft = prompt_store.get_draft()
    draft["system_modules"][0]["content"] = "后来修改"
    prompt_store.save_draft(draft)
    stored = prompt_store.get_version(version["id"])
    assert stored["snapshot"]["system_modules"][0]["content"] != "后来修改"
    assert "{{元素A}}" in stored["preview"]


def test_activate_can_publish_and_roll_back(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = prompt_store.aggregate_draft(random_value=0)["id"]
    prompt_store.activate_version(generated)
    assert prompt_store.get_active_version()["id"] == generated
    prompt_store.activate_version(initial)
    assert prompt_store.get_active_version()["id"] == initial
```

- [x] **Step 8: 运行相关测试并提交**

```text
python -m pytest tests/test_prompt_store.py tests/test_prompt_validation.py tests/test_prompt_parity.py -q
git add backend/prompt_store.py backend/prompt_spec.py tests/test_prompt_store.py tests/test_prompt_validation.py
git commit -m "feat: aggregate immutable prompt versions"
```

---

### Task 3: 在线 LLM 链路读取当前生效版本

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/prompt.py`
- Modify: `tests/test_llm.py`
- Modify: `tests/test_comments.py`
- Modify: `tests/test_prompt_store.py`

**Interfaces:**
- Consumes: `prompt_store.init_prompt_store()` 和 `prompt_store.get_active_spec()`。
- Produces: 启动阶段完成 Prompt Store 初始化；所有未显式传入 `prompt_spec` 的本地在线合成使用当前生效版本。

- [x] **Step 1: 写入在线链路失败测试**

```python
def test_combine_uses_active_prompt_version(monkeypatch, isolated_prompt_db):
    prompt_store.init_prompt_store()
    generated = prompt_store.aggregate_draft(random_value=0)
    prompt_store.activate_version(generated["id"])
    captured = {}

    monkeypatch.setattr(
        prompt,
        "build_prompt_messages_from_spec",
        lambda spec, **inputs: captured.setdefault("spec", spec)
        or {"system": "s", "user": "u", "temperature": 0},
    )
    monkeypatch.setattr(prompt, "_select_bounty_candidates", lambda *a, **k: [])
    monkeypatch.setattr("backend.llm.query", lambda *a, **k: None)

    prompt.combine_via_llm("需求", "会议")

    assert captured["spec"] == generated["effective_spec"]
```

- [x] **Step 2: 运行并确认测试失败**

Run:

```text
python -m pytest tests/test_prompt_store.py::test_combine_uses_active_prompt_version -q
```

Expected: FAIL，捕获到的是静态文件规范。

- [x] **Step 3: 接入启动和运行时读取**

在 `_startup()` 中保持静态规范先校验的顺序，然后：

```python
load_prompt_spec()
db.init_db()
prompt_store.init_prompt_store()
```

在 `prompt.combine_via_llm()` 和 `main._combine_via_llm()` 中将默认值改为：

```python
spec = prompt_spec if prompt_spec is not None else prompt_store.get_active_spec()
```

保留测试和内部调用显式传入 `prompt_spec` 的能力。

- [x] **Step 4: 验证显式规范优先且启动失败顺序明确**

扩展现有启动测试，断言顺序为：

```python
assert events == ["canonical", "db", "prompt_store"]
```

新增测试确认 `prompt_spec=custom` 时不会调用 `get_active_spec()`。

- [x] **Step 5: 运行 LLM 与评论链路测试并提交**

```text
python -m pytest tests/test_llm.py tests/test_comments.py tests/test_prompt_store.py tests/test_prompt_validation.py -q
git add backend/main.py backend/prompt.py tests/test_llm.py tests/test_comments.py tests/test_prompt_store.py
git commit -m "feat: serve active prompt version to local LLM"
```

---

### Task 4: Admin 鉴权和 Prompt 管理 API

**Files:**
- Modify: `backend/main.py`
- Create: `tests/test_prompt_admin_api.py`

**Interfaces:**
- Consumes: Task 2 的 Prompt Store 接口。
- Produces: 五个 `/api/admin/prompt/*` JSON API 和共享 `require_admin_token(request)`。

- [x] **Step 1: 写入各接口鉴权失败测试**

```python
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/prompt/config"),
        ("put", "/api/admin/prompt/config"),
        ("post", "/api/admin/prompt/aggregate"),
        ("get", "/api/admin/prompt/versions/missing"),
        ("post", "/api/admin/prompt/versions/missing/activate"),
    ],
)
def test_prompt_admin_routes_require_token(client, method, path, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    response = getattr(client, method)(path, json={} if method != "get" else None)
    assert response.status_code == 401
```

- [x] **Step 2: 运行测试并确认失败**

Run:

```text
python -m pytest tests/test_prompt_admin_api.py -q
```

Expected: FAIL，接口返回 404。

- [x] **Step 3: 实现共享常量时间鉴权**

```python
def require_admin_token(request: Request) -> None:
    expected = os.environ.get("ADMIN_TOKEN", "").strip()
    supplied = request.headers.get("authorization", "")
    token = supplied[7:].strip() if supplied.lower().startswith("bearer ") else ""
    if not expected or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="管理员密钥无效")
```

现有 `/api/admin/stats` 同样调用该函数，使监控页与 Prompt 页行为一致。

- [x] **Step 4: 定义 DTO 和路由错误映射**

使用 Pydantic 根对象接收完整草稿：

```python
class PromptDraftReq(BaseModel):
    config: dict
```

路由将 `PromptValidationError` 映射为 `HTTPException(422, detail=str(exc))`，
`PromptVersionNotFound` 映射为 `404`。`GET config` 返回：

```python
{
    "config": prompt_store.get_draft(),
    "active_version": prompt_store.get_active_version_summary(),
    "versions": prompt_store.list_versions(),
}
```

- [x] **Step 5: 添加保存、聚合、查看、激活和回滚 API 测试**

```python
def test_admin_can_save_aggregate_preview_and_activate(
    authorized_client, initialized_prompt_store
):
    config = authorized_client.get("/api/admin/prompt/config").json()["config"]
    config["temperature"] = 0.42
    assert authorized_client.put(
        "/api/admin/prompt/config", json={"config": config}
    ).status_code == 200
    generated = authorized_client.post("/api/admin/prompt/aggregate").json()
    assert generated["active"] is False
    detail = authorized_client.get(
        f"/api/admin/prompt/versions/{generated['id']}"
    ).json()
    assert detail["snapshot"]["temperature"] == 0.42
    activated = authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/activate"
    ).json()
    assert activated["active"] is True
```

- [x] **Step 6: 运行 API 测试并提交**

```text
python -m pytest tests/test_prompt_admin_api.py tests/test_prompt_store.py -q
git add backend/main.py tests/test_prompt_admin_api.py
git commit -m "feat: expose authenticated prompt admin API"
```

---

### Task 5: `/admin` Prompt 管理界面

**Files:**
- Modify: `frontend/admin/index.html`
- Create: `frontend/admin/prompt-admin.css`
- Create: `frontend/admin/prompt-admin.js`
- Create: `tests/test_prompt_admin_ui.py`

**Interfaces:**
- Consumes: Task 4 的 API，复用 sessionStorage 键 `infinity_admin_token`。
- Produces: “运行监控 / Prompt 管理”页签、完整草稿编辑、聚合预览、激活和历史版本交互。

- [x] **Step 1: 写入页面结构失败测试**

```python
def test_admin_page_exposes_prompt_management_controls():
    html = ADMIN_HTML.read_text(encoding="utf-8")
    assert 'data-admin-tab="monitor"' in html
    assert 'data-admin-tab="prompt"' in html
    assert 'id="prompt-styles"' in html
    assert 'id="prompt-positive-examples"' in html
    assert 'id="prompt-negative-examples"' in html
    assert 'id="prompt-aggregate"' in html
    assert 'id="prompt-activate"' in html
    assert 'id="prompt-preview"' in html
    assert 'id="prompt-version-history"' in html
    assert 'src="/admin/prompt-admin.js"' in html
```

- [x] **Step 2: 运行并确认测试失败**

Run:

```text
python -m pytest tests/test_prompt_admin_ui.py -q
```

Expected: FAIL，缺少 Prompt 管理 DOM。

- [x] **Step 3: 增加页签和语义化编辑区域**

保留现有监控内容，外包为：

```html
<nav class="admin-tabs" aria-label="后台功能">
  <button data-admin-tab="monitor" aria-selected="true">运行监控</button>
  <button data-admin-tab="prompt" aria-selected="false">Prompt 管理</button>
</nav>
<section id="admin-monitor-panel" data-admin-panel="monitor">...</section>
<section id="admin-prompt-panel" data-admin-panel="prompt" hidden>...</section>
```

Prompt 面板使用 `<template>` 定义模块、风格和案例行，所有动态文本使用
`textContent`/表单 `value`，禁止用配置内容拼接 `innerHTML`。

- [x] **Step 4: 实现共享鉴权请求和草稿编辑**

`prompt-admin.js` 提供：

```javascript
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
```

维护单个内存 `draft`，DOM 修改先回写 draft；保存时发送完整
`PUT /api/admin/prompt/config`。概率总计只提供即时反馈，不在前端自动改值。

- [x] **Step 5: 实现聚合、预览、激活和历史版本**

- “聚合”先确保草稿已保存，再调用 aggregate。
- 返回版本后将完整 preview 写入只读 `<textarea>`，记录待激活版本 ID。
- “设为生效”只激活当前预览 ID；成功后重新加载版本摘要。
- 历史版本“查看”读取详情，“设为生效”要求一次 `window.confirm()`。
- 修改草稿后清除待激活状态并提示必须重新聚合。

- [x] **Step 6: 添加静态安全与交互契约测试**

```python
def test_prompt_admin_script_uses_bearer_auth_and_safe_text_updates():
    source = ADMIN_JS.read_text(encoding="utf-8")
    assert "Authorization" in source or "authorization" in source
    assert "Bearer ${token}" in source
    assert "textContent" in source
    assert ".innerHTML =" not in source
    assert "/api/admin/prompt/aggregate" in source
    assert "/activate" in source
```

- [x] **Step 7: 运行 UI 测试并提交**

```text
python -m pytest tests/test_prompt_admin_ui.py -q
git add frontend/admin/index.html frontend/admin/prompt-admin.css frontend/admin/prompt-admin.js tests/test_prompt_admin_ui.py
git commit -m "feat: add prompt management to local admin"
```

---

### Task 6: 文档、全量回归与 PR 准备

**Files:**
- Modify: `backend/README.md`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `.agent/docs/2026-08-04-prompt-configuration-implementation-plan.md`

**Interfaces:**
- Consumes: Tasks 1–5 的最终行为。
- Produces: 本地管理员操作说明、通过的必需验证和可审阅提交历史。

- [x] **Step 1: 更新用户可见文档**

在 README 本地部署段说明：

```text
1. 在 `.env` 设置非空 `ADMIN_TOKEN`。
2. 启动本地服务并访问 `/admin`。
3. 在 Prompt 管理页保存草稿。
4. 点击聚合并检查完整预览。
5. 确认后设为生效；需要回滚时重新启用历史版本。
```

明确说明 Makers 构建不读取本地 SQLite Prompt 配置。

- [x] **Step 2: 运行针对性 Python 测试**

Run:

```text
python -m pytest tests/test_prompt_store.py tests/test_prompt_admin_api.py tests/test_prompt_admin_ui.py tests/test_prompt_validation.py tests/test_prompt_parity.py tests/test_llm.py tests/test_comments.py -q
```

Expected: PASS，零失败。

- [ ] **Step 3: 运行仓库要求的完整验证**

Run:

```text
npm test
python -m pytest tests --ignore=tests/test_combine_feedback.py -q
npm run build
```

Expected: 三条命令全部以退出码 0 完成。若本机存在 EdgeOne CLI，再运行
`npm run makers:build`；否则在 PR 中注明由部署维护者执行。

- [x] **Step 4: 检查差异和敏感信息**

Run:

```text
git diff --check upstream/main...HEAD
git status --short
git diff --stat upstream/main...HEAD
git log --oneline upstream/main..HEAD
```

确认没有 `.env`、数据库、日志、运行时文件或无关改动。

- [x] **Step 5: 提交文档**

```text
git add README.md backend/README.md .env.example .agent/docs/2026-08-04-prompt-configuration-implementation-plan.md
git commit -m "docs: explain local prompt publishing workflow"
```

- [x] **Step 6: 请求代码审查并修复发现的问题**

使用 `requesting-code-review` 技能，对照 issue #22、设计文档、提交范围和验证结果检查。
任何修改必须重新运行受影响测试及三条仓库必需验证。

- [ ] **Step 7: 推送分支并创建 Draft PR**

使用 `github:yeet` 技能将 `feat/issue-22-prompt-configuration` 推送到 `origin`，
创建目标为 `ythere-y/infinite-craft-TC:main` 的 Draft PR。PR 正文包含：

- `Closes #22`；
- 数据模型、鉴权、聚合/发布隔离和本地限定的摘要；
- 自动化测试结果；
- 手工测试步骤；
- `npm run makers:build` 是否由维护者待执行；
- “等待需求方测试确认后再合并”的明确说明。

- [ ] **Step 8: 等待人工测试确认**

不得自行合并。向需求方提供本地测试步骤和 PR 地址；只有收到明确确认后，才使用 GitHub
合并到 `upstream/main`，随后检查合并状态和 issue 关闭状态。

---

### Task 7: 历史版本复制为草稿与受保护删除

**Files:**
- Modify: `backend/prompt_store.py`
- Modify: `backend/main.py`
- Modify: `frontend/admin/prompt-admin.js`
- Modify: `tests/test_prompt_store.py`
- Modify: `tests/test_prompt_admin_api.py`
- Modify: `tests/test_prompt_admin_ui.py`
- Modify: `tests-makers/build.test.mjs`

**Interfaces:**
- Consumes: 现有 draft revision/CAS、`PromptStoreConflictError`、写事务 busy 重试和版本详情读取。
- Produces: `copy_version_to_draft(version_id: str, *, expected_revision: int) -> dict`、`delete_version(version_id: str) -> None`、`POST /api/admin/prompt/versions/{version_id}/copy-to-draft` 和 `DELETE /api/admin/prompt/versions/{version_id}`。

- [x] **Step 1: 写入 Store RED 测试**

```python
def test_copy_version_to_draft_uses_revision_cas(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_draft_record()
    generated = prompt_store.aggregate_draft(
        expected_revision=initial["revision"], random_value=0
    )
    changed = copy.deepcopy(initial["config"])
    changed["temperature"] = 0.25
    saved = prompt_store.save_draft(
        changed, expected_revision=initial["revision"]
    )

    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.copy_version_to_draft(
            generated["id"], expected_revision=initial["revision"]
        )

    copied = prompt_store.copy_version_to_draft(
        generated["id"], expected_revision=saved["revision"]
    )
    assert copied["config"] == generated["snapshot"]
    assert copied["revision"] == saved["revision"] + 1
    assert prompt_store.get_active_version()["id"] != generated["id"]


def test_delete_version_protects_active_and_initial_versions(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(initial)

    draft = prompt_store.get_draft_record()
    generated = prompt_store.aggregate_draft(
        expected_revision=draft["revision"], random_value=0
    )
    prompt_store.activate_version(generated["id"])
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(generated["id"])
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(initial)


def test_delete_inactive_non_initial_version(isolated_prompt_db):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft_record()
    generated = prompt_store.aggregate_draft(
        expected_revision=draft["revision"], random_value=0
    )
    prompt_store.delete_version(generated["id"])
    with pytest.raises(KeyError):
        prompt_store.get_version(generated["id"])
```

- [x] **Step 2: 运行 Store 测试并确认失败**

Run:

```text
python -m pytest tests/test_prompt_store.py -k "copy_version or delete_version" -q
```

Expected: FAIL，原因是两个 Store 接口尚不存在。

- [x] **Step 3: 实现事务化复制与删除**

`copy_version_to_draft()` 在现有 `_write_transaction()` 内：

1. 读取版本，不存在抛 `KeyError`；
2. 解码并校验版本 `snapshot_json`，损坏使用 `PromptStoreCorruptionError`；
3. 读取当前 draft revision；
4. revision 不一致抛 `PromptStoreConflictError`；
5. 使用 `UPDATE ... WHERE revision = ?` 替换 `config_json` 并将 revision 加一；
6. 返回防御性复制的 `{config, revision}`，不修改 active pointer。

`delete_version()` 在相同写事务内：

1. 查询版本和当前 active pointer；
2. 不存在抛 `KeyError`；
3. ID 以 `prompt-initial-` 开头时抛 `PromptStoreConflictError`；
4. ID 等于 active pointer 时抛 `PromptStoreConflictError`；
5. 执行参数化 `DELETE FROM prompt_versions WHERE id = ?`；
6. 不修改草稿和 active pointer。

- [x] **Step 4: 写入 API RED 测试**

```python
def test_admin_copies_version_to_draft_with_revision(
    authorized_client, initialized_prompt_store
):
    state = authorized_client.get("/api/admin/prompt/config").json()
    generated = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": state["revision"]},
    ).json()
    response = authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/copy-to-draft",
        json={"expected_revision": state["revision"]},
    )
    assert response.status_code == 200
    assert response.json()["config"] == generated["snapshot"]


def test_admin_rejects_stale_copy_and_protected_delete(
    authorized_client, initialized_prompt_store
):
    state = authorized_client.get("/api/admin/prompt/config").json()
    generated = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": state["revision"]},
    ).json()
    changed = copy.deepcopy(state["config"])
    changed["temperature"] = 0.25
    authorized_client.put(
        "/api/admin/prompt/config",
        headers={"if-match": f'"{state["revision"]}"'},
        json={"config": changed},
    )
    assert authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/copy-to-draft",
        json={"expected_revision": state["revision"]},
    ).status_code == 409
    active_id = state["active_version"]["id"]
    assert authorized_client.delete(
        f"/api/admin/prompt/versions/{active_id}"
    ).status_code == 409
```

- [x] **Step 5: 增加 DTO、路由和错误映射**

使用严格非负整数：

```python
class PromptVersionCopyReq(BaseModel):
    expected_revision: int = Field(ge=0, le=SQLITE_INT64_MAX)
```

新增路由：

```python
@app.post("/api/admin/prompt/versions/{version_id}/copy-to-draft")
def api_copy_prompt_version(
    version_id: str,
    body: PromptVersionCopyReq,
    _: None = Depends(require_admin_token),
):
    return prompt_store.copy_version_to_draft(
        version_id, expected_revision=body.expected_revision
    )


@app.delete("/api/admin/prompt/versions/{version_id}", status_code=204)
def api_delete_prompt_version(
    version_id: str,
    _: None = Depends(require_admin_token),
):
    prompt_store.delete_version(version_id)
    return Response(status_code=204)
```

复用现有 `KeyError -> 404`、conflict `-> 409`、busy `-> 503` 和 corruption
`-> 500` 映射，不在响应或日志中输出 Prompt 快照。

- [x] **Step 6: 写入 UI RED 测试**

```python
def test_history_exposes_copy_and_delete_contracts():
    source = ADMIN_JS.read_text(encoding="utf-8")
    assert "/copy-to-draft" in source
    assert 'method: "DELETE"' in source
    assert "expected_revision" in source
    assert "删除后无法恢复" in source
    assert "当前草稿将被覆盖" in source
    assert "scrollIntoView" in source
```

Makers 真实构建测试必须继续断言 `dist/admin/index.html`、对应脚本或生成产物中
不存在 `/copy-to-draft`、Prompt 删除 API 或本地 Prompt 管理控件。

- [x] **Step 7: 实现前端管理按钮**

每个版本行：

- 所有版本显示“复制为草稿”；
- 当前生效版本显示禁用的“已生效”，不显示删除；
- 初始版本不显示删除；
- 其他未生效版本显示“删除”。

复制流程：

```javascript
if (!window.confirm(`当前草稿将被覆盖。确定复制版本 ${version.id} 吗？`)) return;
const copied = await promptRequest(
  `/api/admin/prompt/versions/${encodeURIComponent(version.id)}/copy-to-draft`,
  {
    method: "POST",
    body: JSON.stringify({expected_revision: draftRevision}),
  },
);
draft = copied.config;
draftRevision = copied.revision;
renderPromptEditor();
document.querySelector("#prompt-editor").scrollIntoView({
  behavior: "smooth",
  block: "start",
});
```

删除流程必须确认：

```javascript
window.confirm(`永久删除版本 ${version.id}？删除后无法恢复。`)
```

DELETE 成功后重新加载版本摘要；失败时保留当前列表并显示服务端中文错误。

- [x] **Step 8: 运行定向验证并提交**

```text
python -m pytest tests/test_prompt_store.py tests/test_prompt_admin_api.py tests/test_prompt_admin_ui.py -q
node --test tests-makers/build.test.mjs tests-makers/prompt-admin.test.mjs
node --check frontend/admin/prompt-admin.js
npm run build
git diff --check
git add backend/prompt_store.py backend/main.py frontend/admin/prompt-admin.js tests/test_prompt_store.py tests/test_prompt_admin_api.py tests/test_prompt_admin_ui.py tests-makers/build.test.mjs .agent/docs/2026-08-04-prompt-configuration-implementation-plan.md
git commit -m "feat: manage prompt version history"
```

- [ ] **Step 9: 更新 Draft PR 并等待人工验证**

推送当前分支，使 PR #23 包含新增提交。PR 正文补充：

- 非生效、非初始版本可永久删除；
- 任意版本可通过 revision 安全复制为草稿；
- 当前生效版本和初始版本受保护；
- 复制不会自动聚合或发布。

向需求方提供手工测试步骤，明确等待确认后才合并。
