from __future__ import annotations

import contextlib
import html
import io
import json
from pathlib import Path
import re
import shutil
import subprocess


SOURCE = Path("frontend/combine-feedback.js")
EFFECTS_SOURCE = Path("frontend/effects.js")
APP_SOURCE = Path("frontend/app.js")

try:
    # js2py prints its bytecode comparison before raising on unsupported
    # interpreters, so keep expected compatibility failures out of test output.
    with contextlib.redirect_stdout(io.StringIO()):
        import js2py
except (ImportError, RuntimeError) as exc:
    js2py = None


CHROME_CANDIDATES = tuple(
    Path(found)
    for command in ("google-chrome", "chrome", "chromium", "msedge")
    if (found := shutil.which(command))
) + (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)


def _browser_path() -> Path:
    for candidate in CHROME_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise AssertionError(
        "Frontend runtime tests require js2py on a supported Python or "
        "headless Chrome/Edge; neither runtime is available."
    )


def _run_browser(tmp_path: Path, test_script: str, *, include_effects=False):
    scripts = [SOURCE.read_text(encoding="utf-8")]
    if include_effects:
        scripts.append(EFFECTS_SOURCE.read_text(encoding="utf-8"))
    page = tmp_path / "frontend-runtime-test.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(
        "\n".join(
            [
                "<!doctype html><meta charset=\"utf-8\">",
                '<div id="fixture"></div><pre id="__result"></pre>',
                *[f"<script>{source}</script>" for source in scripts],
                "<script>",
                "try {",
                f"  var value = (function () {{ {test_script} }})();",
                "  document.getElementById('__result').textContent = "
                "JSON.stringify({ok: true, value: value});",
                "} catch (error) {",
                "  document.getElementById('__result').textContent = "
                "JSON.stringify({ok: false, error: String(error && error.stack || error)});",
                "}",
                "</script>",
            ]
        ),
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            str(_browser_path()),
            "--headless=new",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
            "--dump-dom",
            page.as_uri(),
        ],
        check=False,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    match = re.search(
        r'<pre id="__result">(.*?)</pre>',
        completed.stdout,
        flags=re.DOTALL,
    )
    assert match, completed.stdout
    payload = json.loads(html.unescape(match.group(1)))
    assert payload["ok"], payload.get("error")
    return payload["value"]


def test_three_discovery_states(tmp_path):
    if js2py is not None:
        context = js2py.EvalJs({})
        context.execute("var window = {};")
        context.execute(SOURCE.read_text(encoding="utf-8"))
        api = context.window.COMBINE_FEEDBACK
        actual = [
            str(api.classify(True, False)),
            str(api.classify(False, False)),
            str(api.classify(False, True)),
            str(api.classify(True, True)),
        ]
    else:
        actual = _run_browser(
            tmp_path,
            """
            return [
              window.COMBINE_FEEDBACK.classify(true, false),
              window.COMBINE_FEEDBACK.classify(false, false),
              window.COMBINE_FEEDBACK.classify(false, true),
              window.COMBINE_FEEDBACK.classify(true, true)
            ];
            """,
        )
    assert actual == ["global_new", "global_known", "seen", "global_new"]


def test_render_toast_replaces_children_with_exact_text_nodes(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var target = document.getElementById("fixture");
        var stale = document.createElement("button");
        stale.id = "stale";
        target.appendChild(stale);
        window.COMBINE_FEEDBACK.renderToast(document, target, {
          tier: "global_known",
          emoji: "✨",
          name: "需求膨胀",
          comment: "一句点评"
        });
        return {
          staleGone: !document.getElementById("stale"),
          tags: Array.from(target.children).map(function (node) {
            return node.tagName;
          }),
          classes: Array.from(target.children).map(function (node) {
            return node.className;
          }),
          texts: Array.from(target.children).map(function (node) {
            return node.textContent;
          })
        };
        """,
    )
    assert actual == {
        "staleGone": True,
        "tags": ["DIV", "DIV", "DIV"],
        "classes": [
            "first-toast-title",
            "first-toast-result",
            "first-toast-comment",
        ],
        "texts": ["✨ 我的新发现", "✨ 需求膨胀", "“一句点评”"],
    }


def test_render_toast_uses_comment_fallback(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var target = document.getElementById("fixture");
        window.COMBINE_FEEDBACK.renderToast(document, target, {
          tier: "seen",
          emoji: "🧪",
          name: "回归测试",
          comment: ""
        });
        return {
          fallback: window.COMBINE_FEEDBACK.DEFAULT_COMMENT,
          rendered: target.querySelector(".first-toast-comment").textContent
        };
        """,
    )
    assert actual["rendered"] == f"“{actual['fallback']}”"


def test_hostile_emoji_name_and_comment_are_rendered_as_text(tmp_path):
    hostile_emoji = '<img id="emoji-xss" src=x onerror="window.__xss=1">'
    hostile_name = '<svg id="name-xss" onload="window.__xss=1"></svg>'
    hostile_comment = '<iframe id="comment-xss" srcdoc="<img onerror=parent.__xss=1>">'
    actual = _run_browser(
        tmp_path,
        f"""
        window.__xss = 0;
        var target = document.getElementById("fixture");
        window.COMBINE_FEEDBACK.renderToast(document, target, {{
          tier: "global_new",
          emoji: {json.dumps(hostile_emoji)},
          name: {json.dumps(hostile_name)},
          comment: {json.dumps(hostile_comment)}
        }});
        return {{
          childCount: target.children.length,
          elementCount: target.querySelectorAll("img,svg,iframe,script").length,
          xss: window.__xss,
          resultText: target.querySelector(".first-toast-result").textContent,
          commentText: target.querySelector(".first-toast-comment").textContent
        }};
        """,
    )
    assert actual["childCount"] == 3
    assert actual["elementCount"] == 0
    assert actual["xss"] == 0
    assert actual["resultText"] == f"{hostile_emoji} {hostile_name}"
    assert actual["commentText"] == f"“{hostile_comment}”"


def test_hostile_element_payload_is_text_and_app_has_no_inner_html_sinks(tmp_path):
    hostile_emoji = '<img id="chip-xss" src=x onerror="window.__xss=1">'
    hostile_name = '<svg id="chip-name-xss" onload="window.__xss=1"></svg>'
    actual = _run_browser(
        tmp_path,
        f"""
        window.__xss = 0;
        var target = document.getElementById("fixture");
        window.COMBINE_FEEDBACK.renderElement(document, target, {{
          emoji: {json.dumps(hostile_emoji)},
          name: {json.dumps(hostile_name)},
          isStarter: true
        }});
        return {{
          classes: Array.from(target.children).map(function (node) {{
            return node.className;
          }}),
          elementCount: target.querySelectorAll("img,svg,script").length,
          xss: window.__xss,
          emojiText: target.querySelector(".emoji").textContent,
          nameText: target.querySelector(".name").textContent
        }};
        """,
    )
    assert actual == {
        "classes": ["starter-badge", "emoji", "name"],
        "elementCount": 0,
        "xss": 0,
        "emojiText": hostile_emoji,
        "nameText": hostile_name,
    }

    app_source = APP_SOURCE.read_text(encoding="utf-8")
    assert ".innerHTML" not in app_source
    assert app_source.count("window.COMBINE_FEEDBACK.renderElement") == 5


def test_first_toast_uses_exact_design_duration(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var delays = [];
        window.setTimeout = function (_callback, delay) {
          delays.push(delay);
          return delays.length;
        };
        window.clearTimeout = function () {};
        var target = document.getElementById("fixture");
        target.id = "first-toast";
        window.EFFECTS.firstToast("结果", "🧪", {
          tier: "global_new",
          comment: "点评"
        });
        return {
          delays: delays,
          showing: target.classList.contains("show")
        };
        """,
        include_effects=True,
    )
    assert actual == {"delays": [4200], "showing": True}
