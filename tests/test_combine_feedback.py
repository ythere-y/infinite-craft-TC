from __future__ import annotations

import contextlib
import html
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import shutil
import subprocess


SOURCE = Path("frontend/combine-feedback.js")
ICON_SOURCE = Path("frontend/icon-system.js")
ICON_CSS_SOURCE = Path("frontend/icon-system.css")
STYLE_SOURCE = Path("frontend/style.css")
WALL_STYLE_SOURCE = Path("frontend/wall/wall.css")
EFFECTS_SOURCE = Path("frontend/effects.js")
RECIPE_LINKS_SOURCE = Path("frontend/recipe-links.js")
RECIPE_LINKS_CSS_SOURCE = Path("frontend/recipe-links.css")
APP_SOURCE = Path("frontend/app.js")
INDEX_SOURCE = Path("frontend/index.html")
SCORE_LEVEL_SOURCE = Path("frontend/score-level.js")

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


class _StylesheetLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "link":
            return
        attributes = dict(attrs)
        rel = set((attributes.get("rel") or "").lower().split())
        href = attributes.get("href")
        if "stylesheet" in rel and href:
            self.hrefs.append(href)


def _production_stylesheet_paths() -> list[Path]:
    parser = _StylesheetLinkParser()
    parser.feed(INDEX_SOURCE.read_text(encoding="utf-8"))
    paths = []
    for href in parser.hrefs:
        if href.startswith(("http://", "https://", "//")):
            raise AssertionError(f"Production stylesheet must be local: {href}")
        clean_path = href.split("?", 1)[0].split("#", 1)[0]
        paths.append(INDEX_SOURCE.parent / clean_path.lstrip("/"))
    return paths


def test_browser_harness_styles_follow_production_index_order():
    assert _production_stylesheet_paths() == [
        ICON_CSS_SOURCE,
        STYLE_SOURCE,
        RECIPE_LINKS_CSS_SOURCE,
    ]


def _run_browser(
    tmp_path: Path,
    test_script: str,
    *,
    include_effects=False,
    include_recipe_links=False,
    include_app_styles=False,
    include_wall_styles=False,
    viewport: tuple[int, int] | None = None,
):
    scripts = [ICON_SOURCE.read_text(encoding="utf-8"), SOURCE.read_text(encoding="utf-8")]
    if include_effects:
        scripts.append(EFFECTS_SOURCE.read_text(encoding="utf-8"))
    if include_recipe_links:
        assert RECIPE_LINKS_SOURCE.exists(), "recipe-links.js must exist"
        assert RECIPE_LINKS_CSS_SOURCE.exists(), "recipe-links.css must exist"
        scripts.append(RECIPE_LINKS_SOURCE.read_text(encoding="utf-8"))
    if include_app_styles:
        stylesheet_paths = _production_stylesheet_paths()
    elif include_wall_styles:
        stylesheet_paths = [ICON_CSS_SOURCE, WALL_STYLE_SOURCE]
    else:
        stylesheet_paths = [ICON_CSS_SOURCE]
    if include_recipe_links:
        stylesheet_paths.append(RECIPE_LINKS_CSS_SOURCE)
    stylesheet_source = "".join(
        path.read_text(encoding="utf-8") for path in stylesheet_paths
    )
    page = tmp_path / "frontend-runtime-test.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(
        "\n".join(
            [
                "<!doctype html><meta charset=\"utf-8\">",
                f"<style>{stylesheet_source}</style>",
                '<div id="fixture"></div><pre id="__result"></pre>',
                "<script>",
                "window.fetch = function (url) {",
                "  var fixtures = String(url).indexOf('element-icon-map') >= 0",
                "    ? { '预设': { icon: { base: '🧩', badge: '⭐', palette: 'product', source: 'preset' } }, '水': { icon: { base: '💧', palette: 'nature', source: 'fallback' } } }",
                "    : { '🧩': '/assets/base.png', '⭐': '/assets/badge.png', '💧': '/assets/water.png', '🔥': '/assets/fire.png' };",
                "  return Promise.resolve({ ok: true, json: function () { return Promise.resolve(fixtures); } });",
                "};",
                "window.requestAnimationFrame = function (callback) {",
                "  return window.setTimeout(function () {",
                "    callback(window.performance.now());",
                "  }, 16);",
                "};",
                "window.cancelAnimationFrame = window.clearTimeout.bind(window);",
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
    command = [
        str(_browser_path()),
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=1000",
        f"--user-data-dir={profile}",
    ]
    if viewport:
        command.append(f"--window-size={viewport[0]},{viewport[1]}")
    command.extend(["--dump-dom", page.as_uri()])
    completed = subprocess.run(
        command,
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


def test_sidebar_repository_names_wrap_and_expand_without_clipping(tmp_path):
    fixtures = [
        "水",
        "腾讯音乐娱乐",
        "上坟都不敢这么烧",
        "ima.copilot",
        "这是一个故意长到标准两行绝对放不下的元素名称",
        "这是一个故意长到横跨两列以后两行仍然放不下并且必须占满三列的元素名称来验证最终布局是否会完整显示全部文字内容",
    ]
    actual = _run_browser(
        tmp_path,
        f"""
        return window.ICON_SYSTEM.ready.then(function () {{
          var list = document.createElement("div");
          list.className = "element-list";
          list.style.width = "320px";
          list.style.height = "auto";
          document.body.appendChild(list);

          function lineRects(node) {{
            var range = document.createRange();
            range.selectNodeContents(node);
            var tops = [];
            return Array.from(range.getClientRects()).filter(function (rect) {{
              if (!rect.width && !rect.height) return false;
              var top = Math.round(rect.top * 2) / 2;
              if (!tops.some(function (seen) {{ return Math.abs(seen - top) < 0.5; }})) {{
                tops.push(top);
              }}
              return true;
            }});
          }}

          return {json.dumps(fixtures, ensure_ascii=False)}.map(function (name) {{
            var chip = document.createElement("div");
            chip.className = "element";
            list.appendChild(chip);
            window.ICON_SYSTEM.renderElement(document, chip, {{
              name: name,
              emoji: "🧩",
              icon: {{ base: "🧩", palette: "product", source: "generated" }}
            }});
            window.ICON_SYSTEM.fitSidebarChip(chip);
            var nameNode = chip.querySelector(".name");
            var chipRect = chip.getBoundingClientRect();
            var rects = lineRects(nameNode);
            return {{
              name: nameNode.textContent,
              lines: Array.from(new Set(rects.map(function (rect) {{
                return Math.round(rect.top * 2) / 2;
              }}))).length,
              classes: Array.from(chip.classList),
              iconWidth: chip.querySelector(".element-icon").getBoundingClientRect().width,
              chipHeight: chipRect.height,
              contained: rects.every(function (rect) {{
                return rect.left >= chipRect.left - 0.5 &&
                  rect.right <= chipRect.right + 0.5;
              }}),
              overflow: getComputedStyle(chip).overflow
            }};
          }});
        }});
        """,
        include_app_styles=True,
        viewport=(1440, 800),
    )

    assert [row["name"] for row in actual] == fixtures
    assert all(row["contained"] for row in actual)
    assert all(row["lines"] <= 2 for row in actual)
    assert all(row["iconWidth"] == 22 for row in actual)
    assert all(row["chipHeight"] >= 41 for row in actual)
    assert all(row["overflow"] != "hidden" for row in actual)
    assert all(
        "sidebar-span-2" not in row["classes"]
        and "sidebar-span-3" not in row["classes"]
        for row in actual[:4]
    )
    assert "sidebar-span-2" in actual[4]["classes"]
    assert "sidebar-span-3" in actual[5]["classes"], actual


def test_first_toast_icon_and_name_have_safe_spacing(tmp_path):
    for viewport in ((1440, 800), (390, 844)):
        actual = _run_browser(
            tmp_path,
            """
            return window.ICON_SYSTEM.ready.then(function () {
              var toast = document.getElementById("fixture");
              toast.className = "first-toast show";
              document.body.appendChild(toast);
              window.COMBINE_FEEDBACK.renderToast(document, toast, {
                tier: "global_new",
                name: "地基复利",
                emoji: "🏗️",
                icon: {
                  base: "🏗️",
                  badge: "🧠",
                  palette: "product",
                  source: "generated"
                }
              });
              var icon = toast.querySelector(".element-icon");
              var name = toast.querySelector(".name");
              var iconRect = icon.getBoundingClientRect();
              var nameRect = name.getBoundingClientRect();
              return {
                gap: nameRect.left - iconRect.right,
                overlaps: !(
                  iconRect.right <= nameRect.left ||
                  nameRect.right <= iconRect.left ||
                  iconRect.bottom <= nameRect.top ||
                  nameRect.bottom <= iconRect.top
                ),
                iconWidth: iconRect.width,
                name: name.textContent
              };
            });
            """,
            include_app_styles=True,
            viewport=viewport,
        )
        assert actual["gap"] >= 12, (viewport, actual)
        assert actual["overlaps"] is False, (viewport, actual)
        assert actual["iconWidth"] == 40
        assert actual["name"] == "地基复利"


def test_recipe_comment_shares_formula_card_background(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var fixture = document.getElementById("fixture");
        fixture.style.width = "520px";

        var entry = document.createElement("div");
        entry.className = "recipe-entry has-comment";
        var row = document.createElement("div");
        row.className = "recipe-row";
        row.textContent = "张志东 + 秃头循环  AI";
        var comment = document.createElement("div");
        comment.className = "recipe-comment";
        comment.textContent = "大佬面前，秃头循环只能绕道走。";
        entry.append(row, comment);

        var plain = document.createElement("div");
        plain.className = "recipe-entry";
        var plainRow = document.createElement("div");
        plainRow.className = "recipe-row";
        plainRow.textContent = "代码 + 创始人  预设";
        plain.append(plainRow);
        fixture.append(entry, plain);

        var entryRect = entry.getBoundingClientRect();
        var rowRect = row.getBoundingClientRect();
        var commentRect = comment.getBoundingClientRect();
        var entryStyle = getComputedStyle(entry);
        var rowStyle = getComputedStyle(row);
        var plainRowStyle = getComputedStyle(plainRow);
        return {
          entryBackground: entryStyle.backgroundColor,
          rowBackground: rowStyle.backgroundColor,
          verticalGap: commentRect.top - rowRect.bottom,
          commentInsideCard:
            commentRect.left >= entryRect.left &&
            commentRect.right <= entryRect.right &&
            commentRect.bottom <= entryRect.bottom,
          commentPaddingBottom: parseFloat(getComputedStyle(comment).paddingBottom),
          commentedRowPaddingBottom: parseFloat(rowStyle.paddingBottom),
          plainRowPaddingBottom: parseFloat(plainRowStyle.paddingBottom),
          plainHasComment: plain.querySelector(".recipe-comment") !== null
        };
        """,
        include_wall_styles=True,
        viewport=(1440, 800),
    )

    assert actual["entryBackground"] == "rgb(250, 250, 250)"
    assert actual["rowBackground"] == "rgba(0, 0, 0, 0)"
    assert actual["verticalGap"] <= 4
    assert actual["commentInsideCard"] is True
    assert actual["commentPaddingBottom"] == 10
    assert actual["commentedRowPaddingBottom"] == 6
    assert actual["plainRowPaddingBottom"] == 10
    assert actual["plainHasComment"] is False


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


def test_icon_system_accepts_curated_entity_recipes(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          return window.ICON_SYSTEM.resolveElementRecipe({
            name: "Riot",
            emoji: "❓",
            icon: {
              base: "👊", badge: "🎮",
              palette: "studio", source: "curated"
            }
          });
        });
        """,
    )
    assert actual == {
        "base": "👊",
        "badge": "🎮",
        "palette": "studio",
        "source": "curated",
    }


def test_icon_tooltip_refreshes_metadata_when_reusing_a_target(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          var target = document.getElementById("fixture");
          target.title = "旧的调用方标题";
          window.ICON_SYSTEM.renderElement(document, target, {
            name: "水", emoji: "💧", category: "classic",
            icon: { base: "💧", palette: "nature", source: "curated" },
            state: "starter"
          });
          var first = target.title;
          window.ICON_SYSTEM.renderElement(document, target, {
            name: "智能咖啡", emoji: "☕", category: "ai",
            icon: {
              base: "☕", badge: "🧠",
              palette: "product", source: "generated"
            },
            state: "combine-target"
          });
          var second = target.title;
          window.ICON_SYSTEM.renderElement(document, target, {
            name: "显式提示", emoji: "✨", category: "abstract",
            tooltip: "自定义 Tooltip"
          });
          var tooltipOverride = target.title;
          window.ICON_SYSTEM.renderElement(document, target, {
            name: "显式标题", emoji: "✨", category: "abstract",
            title: "自定义 Title"
          });
          return {
            first: first,
            second: second,
            tooltipOverride: tooltipOverride,
            titleOverride: target.title
          };
        });
        """,
    )
    assert actual == {
        "first": "水 · 类别：classic · 来源：curated · 状态：基础元素",
        "second": "智能咖啡 · 类别：ai · 来源：generated · 状态：合成目标",
        "tooltipOverride": "自定义 Tooltip",
        "titleOverride": "自定义 Title",
    }


def test_element_sticker_tilt_never_exceeds_two_degrees(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          return ["a", "b", "Riot", "智能咖啡", "水"].map(function (name) {
            var target = document.createElement("div");
            window.ICON_SYSTEM.renderElement(document, target, {
              name: name, emoji: "🧩"
            });
            return Number.parseFloat(
              target.querySelector(".element-icon").style
                .getPropertyValue("--element-icon-tilt")
            );
          });
        });
        """,
    )
    assert all(-2 <= angle <= 2 for angle in actual), actual


def test_approved_sticker_states_have_exclusive_visuals_and_toast_tiers(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          function renderState(state) {
            var target = document.createElement("div");
            document.body.appendChild(target);
            window.ICON_SYSTEM.renderElement(document, target, {
              name: state, emoji: "🧩", state: state
            });
            var sticker = target.querySelector(".element-icon");
            var styles = window.getComputedStyle(sticker);
            return {
              states: Array.from(target.classList).filter(function (name) {
                return name.indexOf("state-") === 0;
              }),
              outlineStyle: styles.outlineStyle,
              outlineColor: styles.outlineColor,
              marker: window.getComputedStyle(sticker, "::after").content
            };
          }
          var toast = document.createElement("div");
          window.COMBINE_FEEDBACK.renderToast(document, toast, {
            tier: "global_new", name: "全球结果", emoji: "✨"
          });
          var globalToastStates = Array.from(
            toast.querySelector(".first-toast-icon").classList
          ).filter(function (name) { return name.indexOf("state-") === 0; });
          window.COMBINE_FEEDBACK.renderToast(document, toast, {
            tier: "global_known", name: "个人结果", emoji: "✨"
          });
          var personalToastStates = Array.from(
            toast.querySelector(".first-toast-icon").classList
          ).filter(function (name) { return name.indexOf("state-") === 0; });
          return {
            starter: renderState("starter"),
            global: renderState("global-new"),
            personal: renderState("personal-new"),
            combine: renderState("combine-target"),
            globalToastStates: globalToastStates,
            personalToastStates: personalToastStates
          };
        });
        """,
    )
    assert actual == {
        "starter": {
            "states": ["state-starter"],
            "outlineStyle": "none",
            "outlineColor": "rgb(0, 0, 0)",
            "marker": '"原"',
        },
        "global": {
            "states": ["state-global-new"],
            "outlineStyle": "solid",
            "outlineColor": "rgb(210, 138, 0)",
            "marker": '"✦"',
        },
        "personal": {
            "states": ["state-personal-new"],
            "outlineStyle": "solid",
            "outlineColor": "rgb(128, 73, 167)",
            "marker": '"＋"',
        },
        "combine": {
            "states": ["state-combine-target"],
            "outlineStyle": "solid",
            "outlineColor": "rgb(47, 128, 237)",
            "marker": "none",
        },
        "globalToastStates": ["state-global-new"],
        "personalToastStates": ["state-personal-new"],
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


def test_canvas_ghost_and_recipe_stickers_keep_the_30px_visual_size(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(function () {
          function render(className) {
            var target = document.createElement("div");
            target.className = className;
            document.body.appendChild(target);
            window.ICON_SYSTEM.renderElement(document, target, {
              name: "预设", emoji: "🧩",
              icon: { base: "🧩", palette: "product", source: "entity" },
              size: "canvas"
            });
            return target.querySelector(".element-icon").getBoundingClientRect().width;
          }
          return {
            canvas: render("element on-canvas"),
            ghost: render("element ghost"),
            recipe: render("element recipe-chip")
          };
        });
        """,
        include_app_styles=True,
    )
    assert actual == {"canvas": 30, "ghost": 30, "recipe": 30}


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
    assert re.search(
        r"function renderGameElement\(target, info, options = \{\}\).*?"
        r"icon:\s*info\.icon.*?"
        r"window\.COMBINE_FEEDBACK\.renderElement\(document, target, payload\)",
        app_source,
        flags=re.DOTALL,
    )


def test_inner_mode_preserves_icon_identity_and_uses_dark_palette(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        return window.ICON_SYSTEM.ready.then(async function () {
          var workspace = document.getElementById("fixture");
          workspace.id = "workspace";
          workspace.className = "workspace";
          var nativeImageAddEventListener = HTMLImageElement.prototype.addEventListener;
          HTMLImageElement.prototype.addEventListener = function (type, listener, options) {
            if (type === "error") return;
            return nativeImageAddEventListener.call(this, type, listener, options);
          };
          var payload = {
            name: "预设",
            emoji: "🔥",
            category: "product",
            icon: {
              base: "🧩",
              badge: "⭐",
              palette: "product",
              source: "entity"
            },
            isFirst: true,
            size: "canvas"
          };

          function makeCanvasElement(name, left) {
            var target = document.createElement("div");
            target.className = "element on-canvas";
            target.dataset.name = name;
            target.style.left = left + "px";
            target.style.top = (left / 2) + "px";
            window.ICON_SYSTEM.renderElement(
              document,
              target,
              { ...payload, name: name }
            );
            workspace.appendChild(target);
            return target;
          }

          function snapshot(target) {
            var sticker = target.querySelector(".element-icon");
            var base = target.querySelector(".element-icon-base");
            var badge = target.querySelector(".element-icon-badge");
            var rect = target.getBoundingClientRect();
            var baseStyle = base ? getComputedStyle(base) : null;
            return {
              name: target.querySelector(".name").textContent,
              base: base ? base.getAttribute("src") : "",
              badge: badge ? badge.getAttribute("src") : "",
              stickerClass: sticker ? sticker.className : "",
              stateClasses: Array.from(target.classList)
                .filter(function (name) { return name.indexOf("state-") === 0; }),
              geometry: [rect.x, rect.y, rect.width, rect.height],
              background: baseStyle ? baseStyle.backgroundColor : "",
              border: baseStyle ? baseStyle.borderColor : "",
              shadow: baseStyle ? baseStyle.boxShadow : ""
            };
          }

          var target = makeCanvasElement("预设", 0);
          var before = snapshot(target);
          window.EFFECTS.initBossMode({ defaultOn: false });
          var code = [
            "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
            "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"
          ];
          code.forEach(function (key) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
          });
          await new Promise(function (resolve) { setTimeout(resolve, 650); });
          var during = snapshot(target);

          var addedDuringInnerMode = makeCanvasElement("新增元素", 120);
          await Promise.resolve();
          var added = snapshot(addedDuringInnerMode);
          code.forEach(function (key) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
          });
          var after = snapshot(target);
          return {
            before: before,
            during: during,
            added: added,
            after: after,
          };
        });
        """,
        include_effects=True,
        include_app_styles=True,
    )
    semantic_keys = ("name", "base", "badge", "stickerClass", "stateClasses")
    for key in semantic_keys:
        assert actual["during"][key] == actual["before"][key]
        assert actual["after"][key] == actual["before"][key]
    assert actual["during"]["geometry"] == actual["before"]["geometry"]
    assert actual["after"]["geometry"] == actual["before"]["geometry"]
    assert actual["during"]["background"] == "rgb(24, 44, 70)"
    assert actual["during"]["border"] == "rgb(74, 68, 106)"
    assert actual["during"]["shadow"] != actual["before"]["shadow"]
    assert actual["added"]["name"] == "新增元素"
    assert actual["added"]["base"] == "/assets/base.png"
    assert actual["added"]["badge"] == "/assets/badge.png"
    assert actual["added"]["background"] == "rgb(24, 44, 70)"


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
        window.EFFECTS.firstToast({ name: "结果", emoji: "🧪" }, {
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


def test_combine_effect_lifecycle_marks_sources_and_emits_impact(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var workspace = document.getElementById("fixture");
        workspace.style.position = "relative";
        var source = document.createElement("div");
        var target = document.createElement("div");
        source.className = "element";
        target.className = "element";
        workspace.append(source, target);

        window.EFFECTS.setCombineTarget(target, true);
        var handle = window.EFFECTS.beginCombine(
          workspace, source, target, 120, 80
        );
        var during = {
          targetLocked: target.classList.contains("combine-target"),
          sourceActive: source.classList.contains("combine-source"),
          targetActive: target.classList.contains("combine-source"),
          coreCount: workspace.querySelectorAll(".combine-core").length
        };
        handle.finish({ depth: 5, discovered: true });

        return {
          during: during,
          targetUnlocked: !target.classList.contains("combine-target"),
          sourcesCleared: !source.classList.contains("combine-source")
            && !target.classList.contains("combine-source"),
          coreGone: workspace.querySelector(".combine-core") === null,
          impactRarity: workspace.querySelector(".combine-impact").dataset.rarity,
          impactDiscovery: workspace.querySelector(".combine-impact").dataset.discovery
        };
        """,
        include_effects=True,
        include_app_styles=True,
    )
    assert actual == {
        "during": {
            "targetLocked": True,
            "sourceActive": True,
            "targetActive": True,
            "coreCount": 1,
        },
        "targetUnlocked": True,
        "sourcesCleared": True,
        "coreGone": True,
        "impactRarity": "rare",
        "impactDiscovery": "new",
    }


def test_combine_impact_uses_depth_rarity_and_discovery_brightness(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var workspace = document.getElementById("fixture");
        workspace.style.position = "relative";
        var pause = document.createElement("style");
        pause.textContent = [
          ".combine-impact, .combine-impact::after {",
          "animation-play-state: paused !important;",
          "animation-delay: -410ms !important;",
          "}"
        ].join("");
        document.head.appendChild(pause);

        function trigger(depth, discovered) {
          var source = document.createElement("div");
          var target = document.createElement("div");
          workspace.append(source, target);
          var handle = window.EFFECTS.beginCombine(
            workspace, source, target, 120, 80
          );
          handle.finish({ depth: depth, discovered: discovered });
          var impacts = workspace.querySelectorAll(".combine-impact");
          var impact = impacts[impacts.length - 1];
          return {
            rarity: impact.dataset.rarity,
            discovery: impact.dataset.discovery,
            color: impact.style.getPropertyValue("--impact-color"),
            scale: Number(impact.style.getPropertyValue("--impact-scale")),
            opacity: Number(
              impact.style.getPropertyValue("--impact-start-opacity")
            ),
            brightness: Number(
              impact.style.getPropertyValue("--impact-brightness")
            ),
            saturation: Number(
              impact.style.getPropertyValue("--impact-saturation")
            ),
            glow: impact.style.getPropertyValue("--impact-glow"),
            echoScale: Number(
              getComputedStyle(impact, "::after").transform
                .slice(7, -1).split(",")[0]
            )
          };
        }

        return [
          trigger(undefined, false),
          trigger(2, true),
          trigger(3, true),
          trigger(4, true),
          trigger(5, true),
          trigger(6, true),
          trigger(7, true),
          trigger(9, true),
          trigger(10, true),
          trigger(10, false)
        ];
        """,
        include_effects=True,
        include_app_styles=True,
    )

    assert [row["rarity"] for row in actual] == [
        "common",
        "common",
        "uncommon",
        "uncommon",
        "rare",
        "rare",
        "epic",
        "epic",
        "legendary",
        "legendary",
    ]
    assert [row["scale"] for row in actual[1:9:2]] == [5.5, 6.5, 7.6, 8.9]
    assert actual[8]["scale"] == 10.5
    assert actual[1]["opacity"] == actual[8]["opacity"] == 0.98
    assert actual[0]["opacity"] == actual[9]["opacity"] == 0.42
    assert actual[1]["brightness"] == actual[8]["brightness"] == 1.18
    assert actual[0]["brightness"] == actual[9]["brightness"] == 0.72
    assert actual[1]["saturation"] == actual[8]["saturation"] == 1.12
    assert actual[0]["saturation"] == actual[9]["saturation"] == 0.62
    assert actual[8]["glow"] != actual[9]["glow"]
    assert all(0.8 <= row["echoScale"] <= 1.1 for row in actual)


def test_discovery_effects_have_distinct_personal_and_global_signatures(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var firstToast = document.createElement("div");
        firstToast.id = "first-toast";
        document.body.appendChild(firstToast);

        function trigger(tier) {
          var target = document.createElement("div");
          target.className = "element";
          document.body.appendChild(target);
          window.EFFECTS.onCombineResult(
            target,
            { name: tier, emoji: "✨" },
            tier,
            { comment: "点评" }
          );
          var stamp = document.querySelector(".discovery-stamp[data-tier='" + tier + "']");
          return {
            targetClass: target.className,
            stamp: stamp && stamp.textContent,
            particles: document.querySelectorAll(
              ".celebration-particle[data-tier='" + tier + "']"
            ).length
          };
        }

        return {
          personal: trigger("global_known"),
          global: trigger("global_new")
        };
        """,
        include_effects=True,
        include_app_styles=True,
    )
    assert actual["personal"]["targetClass"].find("reveal-personal") >= 0
    assert actual["personal"]["stamp"] == "我的新发现"
    assert actual["personal"]["particles"] == 10
    assert actual["global"]["targetClass"].find("reveal-global") >= 0
    assert actual["global"]["stamp"] == "全球首发"
    assert actual["global"]["particles"] == 28


def test_score_flight_uses_text_content_and_reduced_motion_skips_particles(tmp_path):
    hostile_delta = '<img id="score-xss" src=x onerror="window.__xss=1">'
    actual = _run_browser(
        tmp_path,
        f"""
        window.__xss = 0;
        var source = document.createElement("div");
        var target = document.createElement("div");
        document.body.append(source, target);
        window.EFFECTS.flyScore(source, target, {json.dumps(hostile_delta)});
        var flight = document.querySelector(".score-flight");
        var safeText = flight.textContent;
        var injected = document.querySelector("#score-xss") !== null;

        window.matchMedia = function () {{ return {{ matches: true }}; }};
        var result = document.createElement("div");
        result.className = "element";
        document.body.appendChild(result);
        window.EFFECTS.onCombineResult(
          result,
          {{ name: "无动画", emoji: "✨" }},
          "global_new",
          {{ comment: "点评" }}
        );
        return {{
          safeText: safeText,
          injected: injected,
          xss: window.__xss,
          reducedParticles: document.querySelectorAll(
            ".celebration-particle[data-tier='global_new']"
          ).length,
          reducedStamp: document.querySelector(
            ".discovery-stamp[data-tier='global_new']"
          ) === null
        }};
        """,
        include_effects=True,
    )
    assert actual == {
        "safeText": f"+{hostile_delta} 分",
        "injected": False,
        "xss": 0,
        "reducedParticles": 0,
        "reducedStamp": True,
    }


def test_recipe_links_expand_all_discovered_instance_pairs(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var workspace = document.getElementById("fixture");
        workspace.style.cssText =
          "position:relative;width:800px;height:500px;overflow:hidden";
        var controller = window.RECIPE_LINKS.create(workspace);
        controller.sync({
          recipes: [
            { key: "A + B", a: "A", b: "B", hit_count: 8, depth: 5 },
            { key: "A + A", a: "A", b: "A", hit_count: 40, depth: 10 }
          ],
          elements: [
            { id: 1, name: "A", x: 100, y: 100 },
            { id: 2, name: "A", x: 180, y: 180 },
            { id: 3, name: "B", x: 500, y: 100 },
            { id: 4, name: "B", x: 560, y: 220 },
            { id: 5, name: "B", x: 620, y: 340 }
          ]
        });
        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            resolve({
              groups: workspace.querySelectorAll(".recipe-link").length,
              basePaths:
                workspace.querySelectorAll(".recipe-link-base").length,
              emphasisPaths:
                workspace.querySelectorAll(".recipe-link-emphasis").length,
              drawPaths:
                workspace.querySelectorAll(".recipe-link-draw").length,
              selfLinks: workspace.querySelectorAll(
                ".recipe-link[data-recipe-key='A + A']"
              ).length,
              svgPointerEvents: getComputedStyle(
                workspace.querySelector(".recipe-links")
              ).pointerEvents
            });
          });
        });
        """,
        include_recipe_links=True,
    )

    assert actual == {
        "groups": 7,
        "basePaths": 7,
        "emphasisPaths": 7,
        "drawPaths": 7,
        "selfLinks": 1,
        "svgPointerEvents": "none",
    }


def test_recipe_links_scale_to_40_update_geometry_and_clean_up(tmp_path):
    actual = _run_browser(
        tmp_path,
        """
        var workspace = document.getElementById("fixture");
        workspace.style.cssText =
          "position:relative;width:800px;height:500px;overflow:hidden";
        var controller = window.RECIPE_LINKS.create(workspace);
        var counts = [1, 3, 8, 20, 40, 400, "invalid"];
        var depths = [1, 3, 5, 7, 10, 10, "invalid"];
        var recipes = counts.map(function (hits, index) {
          return {
            key: "A" + index + " + B" + index,
            a: "A" + index,
            b: "B" + index,
            hit_count: hits,
            depth: depths[index]
          };
        });
        var elements = [];
        recipes.forEach(function (recipe, index) {
          elements.push(
            {
              id: "a" + index,
              name: recipe.a,
              x: 60,
              y: 45 + index * 52
            },
            {
              id: "b" + index,
              name: recipe.b,
              x: 520,
              y: 65 + index * 52
            }
          );
        });
        controller.sync({ recipes: recipes, elements: elements });
        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            var groups = Array.from(
              workspace.querySelectorAll(".recipe-link")
            );
            var firstPath = groups[0].querySelector("path");
            var secondPath = groups[1].querySelector("path");
            var beforeFirst = firstPath.getAttribute("d");
            var beforeSecond = secondPath.getAttribute("d");
            elements[0] = {
              id: "a0", name: "A0", x: 180, y: 160
            };
            controller.scheduleGeometryUpdate(elements);
            requestAnimationFrame(function () {
              var rows = groups.map(function (group) {
                var base = group.querySelector(".recipe-link-base");
                return {
                  width: Number(group.style.getPropertyValue("--recipe-link-width")),
                  opacity: Number(group.style.getPropertyValue("--recipe-link-opacity")),
                  glow: Number(group.style.getPropertyValue("--recipe-link-glow")),
                  duration: Number(group.style.getPropertyValue("--recipe-link-duration")),
                  color: group.style.getPropertyValue("--recipe-link-color"),
                  baseAnimation: getComputedStyle(base).animationName
                };
              });
              var movedFirst = beforeFirst !== firstPath.getAttribute("d");
              var keptSecond =
                beforeSecond === secondPath.getAttribute("d");
              controller.clear();
              var afterClear =
                workspace.querySelectorAll(".recipe-link").length;
              var svgRetained =
                workspace.querySelector(".recipe-links") !== null;
              controller.destroy();
              resolve({
                rows: rows,
                movedFirst: movedFirst,
                keptSecond: keptSecond,
                afterClear: afterClear,
                svgRetained: svgRetained,
                svgGone:
                  workspace.querySelector(".recipe-links") === null
              });
            });
          });
        });
        """,
        include_recipe_links=True,
    )

    rows = actual["rows"]
    assert len({row["color"] for row in rows}) == 1
    assert all(row["baseAnimation"] == "none" for row in rows)
    assert [row["width"] for row in rows[:5]] == sorted(
        row["width"] for row in rows[:5]
    )
    assert [row["opacity"] for row in rows[:5]] == sorted(
        row["opacity"] for row in rows[:5]
    )
    assert [row["glow"] for row in rows[:5]] == sorted(
        row["glow"] for row in rows[:5]
    )
    assert [row["duration"] for row in rows[:5]] == sorted(
        (row["duration"] for row in rows[:5]), reverse=True
    )
    assert rows[4] == rows[5]
    assert rows[0] == rows[6]
    assert actual["movedFirst"] is True
    assert actual["keptSecond"] is True
    assert actual["afterClear"] == 0
    assert actual["svgRetained"] is True
    assert actual["svgGone"] is True


def test_recipe_links_are_isolated_and_honor_reduced_motion():
    assert RECIPE_LINKS_SOURCE.exists(), "recipe-links.js must exist"
    assert RECIPE_LINKS_CSS_SOURCE.exists(), "recipe-links.css must exist"
    source = RECIPE_LINKS_SOURCE.read_text(encoding="utf-8")
    css = RECIPE_LINKS_CSS_SOURCE.read_text(encoding="utf-8")

    for forbidden in ("localStorage", "fetch(", "state.", "recipebook"):
        assert forbidden not in source
    assert ".RECIPE_LINKS" in source
    assert "@media (prefers-reduced-motion: reduce)" in css


def test_combine_feedback_assets_share_one_cache_version():
    index_source = INDEX_SOURCE.read_text(encoding="utf-8")
    asset_urls = re.findall(
        r'(?:href|src)="(/(?:style\.css|recipe-links\.css|icon-system\.css|icon-system\.js|combine-feedback\.js|effects\.js|recipe-links\.js|app\.js)[^"]*)"',
        index_source,
    )

    assert len(asset_urls) == 8
    versions = {
        url.partition("?v=")[2]
        for url in asset_urls
        if "?v=" in url
    }
    assert len(versions) == 1
    assert all("?v=" in url for url in asset_urls)
