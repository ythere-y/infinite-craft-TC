from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADMIN_HTML = ROOT / "frontend" / "admin" / "index.html"
ADMIN_JS = ROOT / "frontend" / "admin" / "prompt-admin.js"
ADMIN_CSS = ROOT / "frontend" / "admin" / "prompt-admin.css"


def test_admin_page_exposes_prompt_management_controls():
    html = ADMIN_HTML.read_text(encoding="utf-8")

    assert 'data-admin-tab="monitor"' in html
    assert 'data-admin-tab="prompt"' in html
    assert 'id="prompt-system-modules"' in html
    assert 'id="prompt-styles"' in html
    assert 'id="prompt-positive-examples"' in html
    assert 'id="prompt-negative-examples"' in html
    assert 'id="prompt-structured-examples"' in html
    assert 'id="prompt-capacities"' in html
    assert 'id="prompt-limits"' in html
    assert 'id="prompt-aggregate"' in html
    assert 'id="prompt-activate"' in html
    assert 'id="prompt-preview"' in html
    assert 'id="prompt-preview-title"' in html
    assert 'aria-labelledby="prompt-preview-title"' in html
    assert 'id="prompt-version-history"' in html
    assert 'src="/admin/prompt-decimal.js"' in html
    assert 'src="/admin/prompt-admin.js"' in html
    assert 'href="/admin/prompt-admin.css"' in html


def test_prompt_collections_have_templates_and_add_controls():
    html = ADMIN_HTML.read_text(encoding="utf-8")

    for template_id in (
        "prompt-module-template",
        "prompt-style-template",
        "prompt-example-template",
    ):
        assert f'id="{template_id}"' in html
    for collection in (
        "system-modules",
        "styles",
        "positive-examples",
        "negative-examples",
    ):
        assert f'data-add-prompt-item="{collection}"' in html


def test_prompt_admin_script_uses_bearer_auth_and_safe_text_updates():
    source = ADMIN_JS.read_text(encoding="utf-8")

    assert "Authorization" in source or "authorization" in source
    assert "Bearer ${token}" in source
    assert "textContent" in source
    assert ".innerHTML =" not in source
    assert "/api/admin/prompt/config" in source
    assert "/api/admin/prompt/aggregate" in source
    assert "/activate" in source


def test_prompt_admin_script_preserves_draft_workflow_contracts():
    source = ADMIN_JS.read_text(encoding="utf-8")

    assert 'sessionStorage.getItem("infinity_admin_token")' in source
    assert 'method: "PUT"' in source
    assert "JSON.stringify({config: draft})" in source
    assert "await saveDraft()" in source
    assert "pendingVersionId = null" in source
    assert "window.confirm(" in source
    assert "preview.value" in source
    assert "probability" in source
    assert "PromptDecimal.summarize" in source
    assert "summary.error" in source
    assert "let draftRevision = null" in source
    assert '"If-Match"' in source
    assert "expected_revision: draftRevision" in source
    assert "editor.oninput =" in source
    assert '"positive_examples": "prompt-positive-examples"' in source
    assert '"negative_examples": "prompt-negative-examples"' in source


def test_history_actions_have_version_specific_accessible_names():
    source = ADMIN_JS.read_text(encoding="utf-8")

    assert 'view.setAttribute("aria-label"' in source
    assert 'activate.setAttribute("aria-label"' in source
    assert "version.id" in source


def test_prompt_admin_locks_editors_during_mutations_without_rebuilding_them():
    source = ADMIN_JS.read_text(encoding="utf-8")
    save_body = source.split("async function saveDraft()", 1)[1].split(
        "async function aggregateDraft", 1
    )[0]

    assert 'promptPanel.querySelectorAll("button, input, textarea")' in source
    assert "control.disabled = true" in source
    assert "renderDraft()" not in save_body
    assert "draft = payload.config" not in save_body


def test_admin_tabs_expose_accessible_relationships_and_keyboard_navigation():
    html = ADMIN_HTML.read_text(encoding="utf-8")
    source = ADMIN_JS.read_text(encoding="utf-8")

    assert 'class="admin-tabs" role="tablist"' in html
    assert (
        'id="admin-monitor-tab" role="tab" aria-controls="admin-monitor-panel"'
        in html
    )
    assert (
        'id="admin-prompt-tab" role="tab" aria-controls="admin-prompt-panel"'
        in html
    )
    assert 'role="tabpanel" aria-labelledby="admin-monitor-tab"' in html
    assert 'role="tabpanel" aria-labelledby="admin-prompt-tab"' in html
    assert 'tabindex="0"' in html
    assert 'tabindex="-1"' in html
    for key in ("ArrowLeft", "ArrowRight", "Home", "End"):
        assert f'"{key}"' in source
    assert "event.preventDefault()" in source
    assert "tab.tabIndex = selected ? 0 : -1" in source
    assert "nextTab.focus()" in source


def test_initial_prompt_load_is_single_flight_and_ignores_stale_responses():
    source = ADMIN_JS.read_text(encoding="utf-8")
    load_body = source.split("function loadPromptConfig()", 1)[1].split(
        "async function refreshVersionSummaries", 1
    )[0]

    assert "let promptLoadPromise = null" in source
    assert "let promptLoadRequestId = 0" in source
    assert "if (promptLoadPromise)" in load_body
    assert "return promptLoadPromise" in load_body
    assert "const requestId = ++promptLoadRequestId" in load_body
    assert "requestId !== promptLoadRequestId" in load_body


def test_mutation_success_is_not_reclassified_when_history_refresh_fails():
    source = ADMIN_JS.read_text(encoding="utf-8")
    assert "async function refreshAfterMutation" in source
    refresh_body = source.split(
        "async function refreshAfterMutation", 1
    )[1].split("async function saveDraft", 1)[0]

    assert "版本列表同步失败" in refresh_body
    assert '"warning"' in refresh_body
    for start, end in (
        ("async function aggregateDraft", "async function activatePreviewVersion"),
        ("async function activatePreviewVersion", "async function viewVersion"),
        ("async function activateHistoricalVersion", "function selectTab"),
    ):
        mutation_body = source.split(start, 1)[1].split(end, 1)[0]
        assert "await refreshAfterMutation(" in mutation_body
        assert "await refreshVersionSummaries()" not in mutation_body


def test_prompt_admin_stylesheet_exists():
    assert ADMIN_CSS.read_text(encoding="utf-8").strip()
