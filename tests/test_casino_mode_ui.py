from __future__ import annotations

import html
import json
from pathlib import Path
import re
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
INDEX_SOURCE = FRONTEND / "index.html"
STYLE_SOURCE = FRONTEND / "style.css"
ICON_STYLE_SOURCE = FRONTEND / "icon-system.css"
RECIPE_LINKS_STYLE_SOURCE = FRONTEND / "recipe-links.css"
ROUND_SOURCE = FRONTEND / "casino-round.js"
CONTROLLER_SOURCE = FRONTEND / "casino-mode.js"
ANIME_SOURCE = FRONTEND / "vendor" / "anime.iife.min.js"


def _chrome() -> Path:
    commands = (
        "google-chrome",
        "chrome",
        "chromium",
        "ungoogled-chromium",
        "msedge",
    )
    for command in commands:
        if executable := shutil.which(command):
            return Path(executable)

    cache_root = Path.home() / ".cache" / "ms-playwright"
    for candidate in sorted(
        cache_root.glob(
            "chromium_headless_shell-*/chrome-headless-shell-linux64/"
            "chrome-headless-shell"
        ),
        reverse=True,
    ):
        if candidate.is_file():
            return candidate
    raise AssertionError("Casino UI tests require a Chromium-family browser.")


def _production_controller_page(*, reduced_motion: bool = True) -> str:
    for source in (ROUND_SOURCE, CONTROLLER_SOURCE, ANIME_SOURCE):
        assert source.is_file(), f"missing production asset: {source.relative_to(ROOT)}"

    index = INDEX_SOURCE.read_text(encoding="utf-8")
    assert 'id="casino-hud"' in index, "production casino table is missing"
    index = re.sub(r'<link rel="stylesheet"[^>]+>', "", index)
    index = re.sub(r'<script src="[^"]+"></script>', "", index)
    index = index.replace(
        "<body>",
        """<body class="ura-on">
        <script>
        window.__casinoReducedMotion = __CASINO_REDUCED_MOTION__;
        window.matchMedia = function () {
          return {
            matches: window.__casinoReducedMotion,
            addEventListener: function () {},
            removeEventListener: function () {}
          };
        };
        localStorage.clear();
        </script>""",
        1,
    )
    scripts = "\n".join(
        f"<script>{source.read_text(encoding='utf-8')}</script>"
        for source in (ANIME_SOURCE, ROUND_SOURCE, CONTROLLER_SOURCE)
    )
    probe = """
    <pre id="casino-test-result"></pre>
    <script>
    (async function () {
      try {
        window.CASINO_MODE.init({
          awardScore: function (payload) {
            var current = Number(localStorage.getItem("ic_kpi") || 0);
            localStorage.setItem("ic_kpi", String(current + payload.amount));
          }
        });
        var initial = {
          chips: document.querySelectorAll("#casino-chip-stack .casino-chip").length,
          buttons: Array.from(
            document.querySelectorAll("#casino-hud button")
          ).map(function (button) { return button.textContent.trim(); })
        };

        for (var index = 0; index < 6; index += 1) {
          window.CASINO_MODE.onCombineResult({
            isGlobalFirst: true,
            sourceEl: null
          });
        }
        var afterSix = {
          chips: document.querySelectorAll("#casino-chip-stack .casino-chip").length,
          pot: document.getElementById("casino-pot-value").textContent,
          streak: document.getElementById("casino-streak-count").textContent,
          next: document.getElementById("casino-next-multiplier").textContent
        };

        var tableRect = document.querySelector(".casino-table").getBoundingClientRect();
        var technicalLabels = (
          document.getElementById("casino-hud").textContent.match(
            /ANIME\\.JS|COMPOSITOR MODE/gi
          ) || []
        ).length;
        document.getElementById("casino-harvest").click();
        await new Promise(function (resolve) { setTimeout(resolve, 60); });
        var duringHarvest = {
          chips: document.querySelectorAll(
            "#casino-chip-stack .casino-chip"
          ).length,
          pot: document.getElementById("casino-pot-value").textContent,
          total: localStorage.getItem("ic_kpi"),
          busy: window.CASINO_MODE.isBusy(),
          activeAnimations: document.getAnimations().filter(function (animation) {
            return animation.playState === "running";
          }).length
        };
        var afterHarvest = {
          chips: document.querySelectorAll(
            "#casino-chip-stack .casino-chip"
          ).length,
          pot: document.getElementById("casino-pot-value").textContent,
          total: localStorage.getItem("ic_kpi"),
          busy: window.CASINO_MODE.isBusy()
        };
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: false });
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });
        await new Promise(function (resolve) { setTimeout(resolve, 60); });

        var result = {
          anime: {
            waapi: typeof window.anime?.waapi?.animate,
            timeline: typeof window.anime?.createTimeline,
            stagger: typeof window.anime?.stagger
          },
          initial: initial,
          after_six: afterSix,
          table_width: tableRect.width,
          table_height: tableRect.height,
          technical_labels: technicalLabels,
          during_harvest: duringHarvest,
          after_harvest: afterHarvest,
          after_queued_combine: window.CASINO_MODE.getState()
        };
        document.getElementById("casino-test-result").textContent =
          JSON.stringify({ ok: true, value: result });
      } catch (error) {
        document.getElementById("casino-test-result").textContent =
          JSON.stringify({
            ok: false,
            error: String(error && error.stack || error)
          });
      }
    })();
    </script>
    """
    return index.replace(
        "</head>",
        f"<style>{STYLE_SOURCE.read_text(encoding='utf-8')}</style></head>",
        1,
    ).replace(
        "__CASINO_REDUCED_MOTION__",
        "true" if reduced_motion else "false",
        1,
    ).replace("</body>", f"{scripts}{probe}</body>", 1)


def _run_controller_page(
    tmp_path: Path,
    *,
    reduced_motion: bool = True,
) -> dict[str, object]:
    page = tmp_path / "casino-controller.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(
        _production_controller_page(reduced_motion=reduced_motion),
        encoding="utf-8",
    )
    command = [
        str(_chrome()),
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=5000",
        "--window-size=1280,900",
        f"--user-data-dir={profile}",
        "--dump-dom",
        page.as_uri(),
    ]
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
        r'<pre id="casino-test-result">(.*?)</pre>',
        completed.stdout,
        flags=re.DOTALL,
    )
    assert match, completed.stdout
    payload = json.loads(html.unescape(match.group(1)))
    assert payload["ok"], payload.get("error")
    return payload["value"]


def _production_app_page() -> str:
    index = INDEX_SOURCE.read_text(encoding="utf-8")
    index = re.sub(r'<link rel="stylesheet"[^>]+>', "", index)
    styles = "\n".join(
        source.read_text(encoding="utf-8")
        for source in (
            ICON_STYLE_SOURCE,
            STYLE_SOURCE,
            RECIPE_LINKS_STYLE_SOURCE,
        )
    )
    index = index.replace("</head>", f"<style>{styles}</style></head>", 1)
    index = index.replace(
        "<body>",
        """<body>
        <script>
        localStorage.clear();
        localStorage.setItem("ic_nick", "测试鹅");
        localStorage.setItem("ic_nick_id", "ic-test");
        window.__uraEvents = [];
        window.__combineQueue = [
          {
            result: "午夜蒸汽",
            emoji: "💨",
            chain: "test",
            icon: null,
            is_first: true,
            depth: 2,
            full_score: 40,
            hit_count: 1,
            comment: "测试点评",
            source: "seed",
            explode: false
          },
          {
            result: "白昼泥浆",
            emoji: "🟤",
            chain: "test",
            icon: null,
            is_first: true,
            depth: 2,
            full_score: 50,
            hit_count: 1,
            comment: "测试点评",
            source: "seed",
            explode: false
          }
        ];
        window.addEventListener("ura-mode-change", function (event) {
          window.__uraEvents.push(event.detail);
        });
        window.alert = function () {};
        window.matchMedia = function (query) {
          return {
            matches: String(query).indexOf("prefers-reduced-motion") >= 0,
            addEventListener: function () {},
            removeEventListener: function () {}
          };
        };
        window.fetch = function (url) {
          var path = String(url);
          var payload =
            path.indexOf("emoji-icon-manifest") >= 0 ? {}
            : path.indexOf("element-icon-map") >= 0 ? {}
            : path.indexOf("/api/starters") >= 0 ? {
                starters: [
                  { name: "水", emoji: "💧", category: "classic" },
                  { name: "火", emoji: "🔥", category: "classic" }
                ]
              }
            : path.indexOf("/api/elements") >= 0 ? {
                elements: {
                  "水": { emoji: "💧", category: "classic", is_starter: true },
                  "火": { emoji: "🔥", category: "classic", is_starter: true }
                }
              }
            : path.indexOf("/api/combine") >= 0
              ? window.__combineQueue.shift()
            : { ok: true };
          return Promise.resolve({
            ok: true,
            json: function () { return Promise.resolve(payload); }
          });
        };
        </script>""",
        1,
    )

    def inline_script(match: re.Match[str]) -> str:
        filename = match.group(1).split("?", 1)[0]
        source = FRONTEND / filename
        assert source.is_file(), f"missing production script: {filename}"
        return f"<script>{source.read_text(encoding='utf-8')}</script>"

    index = re.sub(
        r'<script src="/([^"]+)"></script>',
        inline_script,
        index,
    )
    probe = """
    <pre id="casino-app-result"></pre>
    <script>
    (async function () {
      try {
        await new Promise(function (resolve) { setTimeout(resolve, 120); });
        function captureToastStyles() {
          var toast = document.getElementById("first-toast");
          var comment = toast.querySelector(".first-toast-comment");
          var actions = toast.querySelector(".first-toast-actions");
          var button = actions.querySelector("button");
          var result = toast.querySelector(".first-toast-result");
          var toastStyle = getComputedStyle(toast);
          var buttonStyle = getComputedStyle(button);
          return {
            backgroundImage: toastStyle.backgroundImage,
            color: toastStyle.color,
            borderColor: toastStyle.borderColor,
            resultColor: getComputedStyle(result).color,
            commentColor: getComputedStyle(comment).color,
            dividerColor: getComputedStyle(actions).borderTopColor,
            buttonBackground: buttonStyle.backgroundImage + "|" + buttonStyle.backgroundColor,
            buttonColor: buttonStyle.color
          };
        }
        function captureModeButton() {
          var button = document.getElementById("btn-mode-toggle");
          if (!button) return null;
          return {
            text: button.textContent.replace(/\\s+/g, " ").trim(),
            title: button.title,
            label: button.getAttribute("aria-label"),
            pressed: button.getAttribute("aria-pressed")
          };
        }
        window.EFFECTS.firstToast({
          name: "救火总指挥",
          emoji: "🧯",
          comment: "老板亲自下场，火势瞬间变成绩效。"
        }, {
          tier: "global_new",
          depth: 12,
          comment: "老板亲自下场，火势瞬间变成绩效。"
        });
        window.COMBINE_FEEDBACK.renderPublishAction(
          document,
          document.getElementById("first-toast"),
          { publish: async function () { return { ok: true }; } }
        );
        var lightToast = captureToastStyles();
        var hintText = document.getElementById("hint").textContent;
        var initial = {
          active: window.EFFECTS.isUraMode(),
          transitionCount: document.querySelectorAll(".ura-transition").length,
          event: window.__uraEvents[0] || null,
          button: captureModeButton()
        };
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });

        var modeButton = document.getElementById("btn-mode-toggle");
        if (modeButton) modeButton.click();
        var buttonEntranceTransitionCount =
          document.querySelectorAll(".ura-transition.ura-enter").length;
        await new Promise(function (resolve) { setTimeout(resolve, 650); });
        var midnightToast = captureToastStyles();
        var afterButtonEnter = {
          active: window.EFFECTS.isUraMode(),
          entranceTransitionCount: buttonEntranceTransitionCount,
          chips: window.CASINO_MODE.getState().chips,
          button: captureModeButton()
        };

        if (modeButton) modeButton.click();
        await new Promise(function (resolve) { setTimeout(resolve, 30); });
        var afterButtonExit = {
          active: window.EFFECTS.isUraMode(),
          chips: window.CASINO_MODE.getState().chips,
          button: captureModeButton()
        };

        var code = [
          "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
          "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"
        ];
        var transitionsBeforeCode =
          document.querySelectorAll(".ura-transition.ura-enter").length;
        code.forEach(function (key) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
        });
        var entranceTransitionCount =
          document.querySelectorAll(".ura-transition.ura-enter").length
          - transitionsBeforeCode;
        await new Promise(function (resolve) { setTimeout(resolve, 650); });
        var afterCode = {
          active: window.EFFECTS.isUraMode(),
          entranceTransitionCount: entranceTransitionCount,
          chips: window.CASINO_MODE.getState().chips,
          button: captureModeButton()
        };
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: false });
        await new Promise(function (resolve) { setTimeout(resolve, 20); });

        function pointer(type, target, x, y, pointerId, buttons) {
          target.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: pointerId,
            pointerType: "mouse",
            button: 0,
            buttons: buttons,
            clientX: x,
            clientY: y
          }));
        }

        async function placeStarter(name, x, y, pointerId) {
          var source = document.querySelector(
            '#element-list .element[data-name="' + name + '"]'
          );
          var sourceRect = source.getBoundingClientRect();
          pointer(
            "pointerdown",
            source,
            sourceRect.left + sourceRect.width / 2,
            sourceRect.top + sourceRect.height / 2,
            pointerId,
            1
          );
          pointer("pointermove", window, x, y, pointerId, 1);
          pointer("pointerup", window, x, y, pointerId, 0);
          await new Promise(function (resolve) { setTimeout(resolve, 20); });
        }

        async function combineCanvasPair(leftName, rightName, pointerId) {
          var source = document.querySelector(
            '#workspace .element.on-canvas[data-name="' + leftName + '"]'
          );
          var target = document.querySelector(
            '#workspace .element.on-canvas[data-name="' + rightName + '"]'
          );
          var sourceRect = source.getBoundingClientRect();
          var targetRect = target.getBoundingClientRect();
          var sourceX = sourceRect.left + sourceRect.width / 2;
          var sourceY = sourceRect.top + sourceRect.height / 2;
          var targetX = targetRect.left + targetRect.width / 2;
          var targetY = targetRect.top + targetRect.height / 2;
          pointer("pointerdown", source, sourceX, sourceY, pointerId, 1);
          pointer("pointermove", window, targetX, targetY, pointerId, 1);
          pointer("pointerup", window, targetX, targetY, pointerId, 0);
          await new Promise(function (resolve) { setTimeout(resolve, 90); });
        }

        var workspaceRect = document.getElementById("workspace").getBoundingClientRect();
        await placeStarter(
          "水",
          workspaceRect.left + 210,
          workspaceRect.top + 210,
          31
        );
        await placeStarter(
          "火",
          workspaceRect.left + 430,
          workspaceRect.top + 210,
          32
        );
        await combineCanvasPair("水", "火", 33);
        var beforeHarvest = {
          total: localStorage.getItem("ic_kpi"),
          state: window.CASINO_MODE.getState()
        };
        document.getElementById("casino-harvest").click();
        await new Promise(function (resolve) { setTimeout(resolve, 30); });
        var afterHarvest = {
          total: localStorage.getItem("ic_kpi"),
          state: window.CASINO_MODE.getState(),
          tiers: JSON.parse(localStorage.getItem("ic_scores") || "[]")
            .map(function (event) { return event.tier; })
        };

        code.forEach(function (key) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
        });
        await new Promise(function (resolve) { setTimeout(resolve, 30); });
        document.getElementById("btn-reset").click();
        await placeStarter(
          "水",
          workspaceRect.left + 210,
          workspaceRect.top + 210,
          41
        );
        await placeStarter(
          "火",
          workspaceRect.left + 430,
          workspaceRect.top + 210,
          42
        );
        await combineCanvasPair("水", "火", 43);
        var afterNormalCombine = {
          total: localStorage.getItem("ic_kpi"),
          state: window.CASINO_MODE.getState(),
          tiers: JSON.parse(localStorage.getItem("ic_scores") || "[]")
            .map(function (event) { return event.tier; })
        };
        var beforeDoubleClick =
          document.querySelectorAll("#workspace .element.on-canvas").length;
        document.querySelector('#element-list .element[data-name="水"]')
          .dispatchEvent(new MouseEvent("dblclick", {
            bubbles: true,
            cancelable: true
          }));
        await new Promise(function (resolve) { setTimeout(resolve, 20); });
        var doubleClickRetained =
          document.querySelectorAll("#workspace .element.on-canvas").length
          === beforeDoubleClick + 1;

        document.getElementById("casino-app-result").textContent =
          JSON.stringify({
            ok: true,
            value: {
              initial: initial,
              after_button_enter: afterButtonEnter,
              after_button_exit: afterButtonExit,
              after_code: afterCode,
              events: window.__uraEvents,
              ui: {
                midnight_toast: midnightToast,
                light_toast: lightToast,
                hint_text: hintText,
                double_click_retained: doubleClickRetained
              },
              scoring: {
                before_harvest: beforeHarvest,
                after_harvest: afterHarvest,
                after_normal_combine: afterNormalCombine
              }
            }
          });
      } catch (error) {
        document.getElementById("casino-app-result").textContent =
          JSON.stringify({
            ok: false,
            error: String(error && error.stack || error)
          });
      }
    })();
    </script>
    """
    before_body_close, separator, after_body_close = index.rpartition("</body>")
    assert separator, "production page must contain a closing body tag"
    return f"{before_body_close}{probe}</body>{after_body_close}"


def _run_app_page(tmp_path: Path) -> dict[str, object]:
    page = tmp_path / "casino-production-app.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(_production_app_page(), encoding="utf-8")
    completed = subprocess.run(
        [
            str(_chrome()),
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--virtual-time-budget=2600",
            "--window-size=1280,900",
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
        r'<pre id="casino-app-result">(.*?)</pre>',
        completed.stdout,
        flags=re.DOTALL,
    )
    assert match, completed.stdout
    payload = json.loads(html.unescape(match.group(1)))
    assert payload["ok"], payload.get("error")
    return payload["value"]


def test_compact_casino_controller_scores_six_chips_and_harvests(tmp_path):
    actual = _run_controller_page(tmp_path)

    assert actual["anime"] == {
        "waapi": "function",
        "timeline": "function",
        "stagger": "function",
    }
    assert actual["initial"] == {
        "chips": 0,
        "buttons": ["暂无可收获分数"],
    }
    assert actual["after_six"] == {
        "chips": 6,
        "pot": "3,200",
        "streak": "6 连续首发",
        "next": "下一次 ×2",
    }
    assert actual["table_width"] <= 720
    assert actual["table_height"] <= 180
    assert actual["technical_labels"] == 0
    assert actual["after_harvest"] == {
        "chips": 0,
        "pot": "0",
        "total": "3200",
        "busy": False,
    }
    assert actual["after_queued_combine"] == {
        "baseScore": 100,
        "pot": 100,
        "chips": 1,
    }


def test_anime_harvest_runs_composited_motion_before_settling_score(tmp_path):
    actual = _run_controller_page(tmp_path, reduced_motion=False)

    assert actual["during_harvest"]["chips"] == 6
    assert actual["during_harvest"]["pot"] == "3,200"
    assert actual["during_harvest"]["total"] is None
    assert actual["during_harvest"]["busy"] is True
    assert actual["during_harvest"]["activeAnimations"] > 0


def test_game_starts_in_normal_mode_and_button_and_code_toggle_inner_mode(
    tmp_path,
):
    actual = _run_app_page(tmp_path)

    assert actual["initial"] == {
        "active": False,
        "transitionCount": 0,
        "event": None,
        "button": {
            "text": "🌙 里模式",
            "title": "切换到里模式",
            "label": "切换到里模式",
            "pressed": "false",
        },
    }
    assert actual["after_button_enter"] == {
        "active": True,
        "entranceTransitionCount": 1,
        "chips": 2,
        "button": {
            "text": "☀️ 普通模式",
            "title": "切换到普通模式",
            "label": "切换到普通模式",
            "pressed": "true",
        },
    }
    assert actual["after_button_exit"] == {
        "active": False,
        "chips": 2,
        "button": {
            "text": "🌙 里模式",
            "title": "切换到里模式",
            "label": "切换到里模式",
            "pressed": "false",
        },
    }
    assert actual["after_code"] == {
        "active": True,
        "entranceTransitionCount": 1,
        "chips": 2,
        "button": {
            "text": "☀️ 普通模式",
            "title": "切换到普通模式",
            "label": "切换到普通模式",
            "pressed": "true",
        },
    }
    assert actual["events"][:3] == [
        {"active": True, "initial": False},
        {"active": False, "initial": False},
        {"active": True, "initial": False},
    ]


def test_midnight_toast_is_dark_and_desktop_guidance_retains_case_and_double_click(
    tmp_path,
):
    actual = _run_app_page(tmp_path)["ui"]
    midnight = actual["midnight_toast"]
    light = actual["light_toast"]

    assert "案例展示" in actual["hint_text"]
    assert "双击" in actual["hint_text"]
    assert actual["double_click_retained"] is True
    assert midnight["backgroundImage"] != light["backgroundImage"]
    assert midnight["color"] != light["color"]
    assert midnight["resultColor"] != light["resultColor"]
    assert midnight["commentColor"] != light["commentColor"]
    assert midnight["dividerColor"] != light["dividerColor"]
    assert midnight["buttonBackground"] != light["buttonBackground"]
    assert midnight["buttonColor"] != light["buttonColor"]


def test_inner_mode_routes_score_to_harvest_and_normal_mode_keeps_direct_score(
    tmp_path,
):
    actual = _run_app_page(tmp_path)["scoring"]

    assert actual["before_harvest"] == {
        "total": None,
        "state": {"baseScore": 100, "pot": 100, "chips": 1},
    }
    assert actual["after_harvest"] == {
        "total": "100",
        "state": {"baseScore": 100, "pot": 0, "chips": 0},
        "tiers": ["casino"],
    }
    assert actual["after_normal_combine"] == {
        "total": "150",
        "state": {"baseScore": 100, "pot": 0, "chips": 0},
        "tiers": ["casino", "global_new"],
    }
