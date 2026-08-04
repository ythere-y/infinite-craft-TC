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
    assert 'id="prompt-version-history"' in html
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
    assert "editor.oninput =" in source
    assert '"positive_examples": "prompt-positive-examples"' in source
    assert '"negative_examples": "prompt-negative-examples"' in source


def test_prompt_admin_locks_editors_during_mutations_without_rebuilding_them():
    source = ADMIN_JS.read_text(encoding="utf-8")
    save_body = source.split("async function saveDraft()", 1)[1].split(
        "async function aggregateDraft", 1
    )[0]

    assert 'promptPanel.querySelectorAll("button, input, textarea")' in source
    assert "control.disabled = true" in source
    assert "renderDraft()" not in save_body
    assert "draft = payload.config" not in save_body


def test_prompt_admin_stylesheet_exists():
    assert ADMIN_CSS.read_text(encoding="utf-8").strip()
