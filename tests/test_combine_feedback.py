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
ICON_SOURCE = Path("frontend/icon-system.js")
ICON_CSS_SOURCE = Path("frontend/icon-system.css")
EFFECTS_SOURCE = Path("frontend/effects.js")
APP_SOURCE = Path("frontend/app.js")
INDEX_SOURCE = Path("frontend/index.html")

try:
    # js2py prints its bytecode comparison before raising on unsupported
    # interpreters, so keep expected compatibility failures out of test output.
    with contextlib.redirect_stdout(io.StringIO()):
        import js2py
except (ImportError, RuntimeError) as exc:
    js2py = None


CHROME_CANDIDATES = tuple(
    Path(found)
    for command in ("google-chrome", "chrome", "chromium", "ungoogled-chromium", "msedge")
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
    scripts = [ICON_SOURCE.read_text(encoding="utf-8"), SOURCE.read_text(encoding="utf-8")]
    if include_effects:
        scripts.append(EFFECTS_SOURCE.read_text(encoding="utf-8"))
    page = tmp_path / "frontend-runtime-test.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(
        "\n".join(
            [
                "<!doctype html><meta charset=\"utf-8\">",
                f"<style>{ICON_CSS_SOURCE.read_text(encoding='utf-8')}</style>",
                '<div id="fixture"></div><pre id="__result"></pre>',
                "<script>",
                "window.fetch = function (url) {",
                "  var fixtures = String(url).indexOf('element-icon-map') >= 0",
                "    ? { '预设': { icon: { base: '🧩', badge: '⭐', palette: 'product', source: 'preset' } }, '水': { icon: { base: '💧', palette: 'nature', source: 'fallback' } } }",
                "    : { '🧩': '/assets/base.png', '⭐': '/assets/badge.png', '💧': '/assets/water.png', '🔥': '/assets/fire.png' };",
                "  return Promise.resolve({ ok: true, json: function () { return Promise.resolve(fixtures); } });",
                "};",
                "</script>",
                *[f"<script>{source}</script>" for source in scripts],
                "<script>",
                "var pending;",
                "try {",
                f"  pending = (function () {{ {test_script} }})();",
                "} catch (error) {",
                "  pending = Promise.reject(error);",
                "}",
                "Promise.resolve(pending).then(function (value) {",
                "  document.getElementById('__result').textContent = "
                "JSON.stringify({ok: true, value: value});",
                "}, function (error) {",
                "  document.getElementById('__result').textContent = "
                "JSON.stringify({ok: false, error: String(error && error.stack || error)});",
                "});",
                "</script>",
            ]
        ),
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            str(_browser_path()),
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--virtual-time-budget=1000",
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
        "classes": [
            "first-toast-title",
            "first-toast-result",
            "first-toast-comment",
        ],
        "texts": ["✨ 我的新发现", "✨需求膨胀", "“一句点评”"],
    }


def test_icon_system_resolution_and_dom_fallbacks(tmp_path):
    hostile_name = '<svg id="chip-name-xss" onload="window.__xss=1"></svg>'
    actual = _run_browser(
        tmp_path,
        f"""
        return window.ICON_SYSTEM.ready.then(function () {{
          window.__xss = 0;
          var persisted = window.ICON_SYSTEM.resolveElementRecipe({{
            name: "预设", emoji: "🔥", icon: {{ base: "💧", palette: "nature", source: "entity" }}
          }});
          var preset = window.ICON_SYSTEM.resolveElementRecipe({{ name: "预设", emoji: "🔥" }});
          var target = document.getElementById("fixture");
          window.ICON_SYSTEM.renderElement(document, target, {{
            name: {json.dumps(hostile_name)}, emoji: "🧩",
            icon: {{ base: "🧩", badge: "⭐", palette: "product", source: "entity" }},
            isStarter: true, isFirst: true, isPersonalNew: true,
            dragging: true, combineTarget: true
          }});
          var sticker = target.querySelector(".emoji");
          var base = sticker.querySelector(".element-icon-base");
          var badge = sticker.querySelector(".element-icon-badge");
          base.dispatchEvent(new Event("error"));
          badge.dispatchEvent(new Event("error"));
          return {{
            persisted: persisted,
            preset: preset,
            outerClass: sticker.className,
            baseFallback: sticker.textContent,
            badgeGone: sticker.querySelector(".element-icon-badge") === null,
            stateClasses: Array.from(target.classList).filter(function (className) {{
              return className.indexOf("state-") === 0;
            }}),
            nameIsText: target.querySelector(".name").firstChild.nodeType === Node.TEXT_NODE,
            nameText: target.querySelector(".name").textContent,
            injected: target.querySelector("#chip-name-xss") !== null,
            xss: window.__xss
          }};
        }});
        """,
    )
    assert actual == {
        "persisted": {"base": "💧", "palette": "nature", "source": "entity"},
        "preset": {"base": "🧩", "badge": "⭐", "palette": "product", "source": "preset"},
        "outerClass": "emoji element-icon palette-product element-icon-sidebar",
        "baseFallback": "🧩",
        "badgeGone": True,
        "stateClasses": ["state-combine-target"],
        "nameIsText": True,
        "nameText": hostile_name,
        "injected": False,
        "xss": 0,
    }


def test_icon_system_uses_allowlisted_action_icons(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          var target = document.getElementById("fixture");
          window.ICON_SYSTEM.renderAction(document, target, {
            name: "not-allowed", label: "", tone: "hostile", size: "large"
          });
          var button = target.firstChild;
          var validTarget = document.createElement("div");
          window.ICON_SYSTEM.renderAction(document, validTarget, { name: "reset", label: "" });
          var image = validTarget.querySelector("img");
          return {
            className: button.className,
            ariaLabel: button.getAttribute("aria-label"),
            image: button.querySelector("img") === null,
            validImageLoading: image.loading,
            validImageDecoding: image.decoding
          };
        });
        """,
    )
    assert actual == {
        "className": "action-icon tone-default size-large",
        "ariaLabel": "操作",
        "image": True,
        "validImageLoading": "lazy",
        "validImageDecoding": "async",
    }


def test_combine_target_overrides_legacy_dragging_visuals(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          var target = document.getElementById("fixture");
          target.className = "element dragging";
          window.ICON_SYSTEM.renderElement(document, target, {
            name: "目标", emoji: "🧩", combineTarget: true
          });
          var icon = target.querySelector(".emoji");
          var styles = window.getComputedStyle(icon);
          return {
            stateClasses: Array.from(target.classList).filter(function (className) {
              return className.indexOf("state-") === 0;
            }),
            opacity: styles.opacity,
            filter: styles.filter
          };
        });
        """,
    )
    assert actual == {
        "stateClasses": ["state-combine-target"],
        "opacity": "1",
        "filter": "saturate(1.25)",
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


def test_publish_action_renders_inside_toast_and_handles_success(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return (async function () {
          var toast = document.getElementById("fixture");
          toast.id = "first-toast";
          var calls = 0;
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
            publish: async function () {
              calls += 1;
              return { ok: true };
            }
          });
          toast.querySelector(".first-toast-actions button").click();
          await Promise.resolve();
          await Promise.resolve();
          var link = toast.querySelector(".first-toast-actions a");
          return {
            calls: calls,
            standalone: document.querySelector(".formula-publish") !== null,
            text: toast.querySelector(".first-toast-actions").textContent,
            href: link && link.getAttribute("href")
          };
        })();
        """,
    )
    assert actual == {
        "calls": 1,
        "standalone": False,
        "text": "✅ 已公开",
        "href": None,
    }


def test_publish_action_restores_button_with_safe_server_error(tmp_path):
    hostile_detail = '<img id="publish-xss" src=x onerror="window.__xss=1">'
    actual = _run_browser(
        tmp_path,
        f"""
        return (async function () {{
          window.__xss = 0;
          var toast = document.getElementById("fixture");
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {{
            publish: async function () {{
              return {{ ok: false, detail: {json.dumps(hostile_detail)} }};
            }}
          }});
          toast.querySelector("button").click();
          await Promise.resolve();
          await Promise.resolve();
          var button = toast.querySelector("button");
          return {{
            disabled: button.disabled,
            text: button.textContent,
            injected: toast.querySelector("#publish-xss") !== null,
            xss: window.__xss
          }};
        }})();
        """,
    )
    assert actual == {
        "disabled": False,
        "text": hostile_detail,
        "injected": False,
        "xss": 0,
    }


def test_publish_action_recovers_from_network_error(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return (async function () {
          var toast = document.getElementById("fixture");
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
            publish: async function () {
              throw new Error("offline");
            }
          });
          toast.querySelector("button").click();
          await Promise.resolve();
          await Promise.resolve();
          var button = toast.querySelector("button");
          return {
            disabled: button.disabled,
            text: button.textContent
          };
        })();
        """,
    )
    assert actual == {
        "disabled": False,
        "text": "公开失败，请重试",
    }


def test_stale_publish_request_does_not_replace_newer_feedback(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return (async function () {
          var toast = document.getElementById("fixture");
          var finish;
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
            publish: function () {
              return new Promise(function (resolve) { finish = resolve; });
            }
          });
          toast.querySelector("button").click();
          window.COMBINE_FEEDBACK.renderToast(document, toast, {
            tier: "seen",
            emoji: "🆕",
            name: "下一次结果",
            comment: "新点评"
          });
          window.COMBINE_FEEDBACK.renderPublishAction(document, toast, {
            publish: async function () { return { ok: true }; }
          });
          finish({ ok: true });
          await Promise.resolve();
          await Promise.resolve();
          return {
            result: toast.querySelector(".first-toast-result").textContent,
            hasButton: toast.querySelector(".first-toast-actions button") !== null,
            published: toast.textContent.indexOf("已公开") >= 0
          };
        })();
        """,
    )
    assert actual == {
        "result": "🆕下一次结果",
        "hasButton": True,
        "published": False,
    }


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
    assert actual["resultText"] == f"{hostile_emoji}{hostile_name}"
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
        "classes": [
            "emoji element-icon palette-place element-icon-sidebar",
            "name",
        ],
        "elementCount": 0,
        "xss": 0,
        "emojiText": hostile_emoji,
        "nameText": hostile_name,
    }

    app_source = APP_SOURCE.read_text(encoding="utf-8")
    assert ".innerHTML" not in app_source
    assert app_source.count("window.COMBINE_FEEDBACK.renderElement") == 5
    assert 'renderElement(document, ghost, { name, emoji, size: "canvas" })' in app_source
    assert re.search(
        r"renderElement\(document, el, \{\s+name,\s+emoji,\s+isStarter,\s+size: \"canvas\",",
        app_source,
    )


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
    assert actual == {"delays": [8000], "showing": True}


def test_combine_feedback_assets_share_one_cache_version():
    index_source = INDEX_SOURCE.read_text(encoding="utf-8")
    asset_urls = re.findall(
        r'(?:href|src)="(/(?:style\.css|icon-system\.css|icon-system\.js|combine-feedback\.js|effects\.js|app\.js)[^"]*)"',
        index_source,
    )

    assert len(asset_urls) == 6
    versions = {
        url.partition("?v=")[2]
        for url in asset_urls
        if "?v=" in url
    }
    assert len(versions) == 1
    assert all("?v=" in url for url in asset_urls)
