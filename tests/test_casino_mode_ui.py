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
    index = re.sub(
        r"<body(?:\s[^>]*)?>",
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
        index,
        count=1,
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
    index = re.sub(
        r"<body(?:\s[^>]*)?>",
        """<body>
        <script>
        localStorage.clear();
        localStorage.setItem("ic_nick", "测试鹅");
        localStorage.setItem("ic_nick_id", "ic-test");
        window.__uraEvents = [];
        window.__combineQueue = [
          {
            ok: true,
            payload: {
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
            }
          },
          {
            ok: true,
            payload: {
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
          },
          {
            ok: true,
            payload: {
              result: "fallback",
              emoji: "❔",
              source: "fallback"
            }
          },
          {
            ok: false,
            status: 500,
            payload: { detail: "测试失败" }
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
          var combineResponse =
            path.indexOf("/api/combine") >= 0
              ? window.__combineQueue.shift()
              : null;
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
            : combineResponse
              ? combineResponse.payload
            : { ok: true };
          return Promise.resolve({
            ok: combineResponse ? combineResponse.ok : true,
            status: combineResponse ? (combineResponse.status || 200) : 200,
            json: function () { return Promise.resolve(payload); }
          });
        };
        </script>""",
        index,
        count=1,
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
        function captureTopbar() {
          var helpButton = document.getElementById("btn-help");
          var helpRect = helpButton.getBoundingClientRect();
          var iconWells = {};
          ["btn-recipebook", "btn-score", "first-wall"].forEach(function (id) {
            var icon = document.querySelector("#" + id + " .action-icon");
            iconWells[id] = icon ? getComputedStyle(icon).backgroundColor : null;
          });
          return {
            reset_present: Boolean(document.getElementById("btn-reset")),
            icon_wells: iconWells,
            help_button: {
              width: helpRect.width,
              height: helpRect.height,
              border_radius: getComputedStyle(helpButton).borderRadius
            }
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
        function captureGuidance() {
          var hint = document.getElementById("hint");
          var advanced = document.getElementById("advanced-guidance");
          var button = document.getElementById("btn-help");
          return {
            visible_text: hint.innerText,
            advanced_hidden: advanced.hidden,
            expanded: button.getAttribute("aria-expanded")
          };
        }
        var initialGuidance = captureGuidance();
        document.getElementById("btn-help").click();
        var expandedGuidance = captureGuidance();
        document.getElementById("btn-help").click();
        var collapsedGuidance = captureGuidance();
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
        var midnightTopbar = captureTopbar();
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

        function tapElement(target, pointerId) {
          var rect = target.getBoundingClientRect();
          var x = rect.left + rect.width / 2;
          var y = rect.top + rect.height / 2;
          pointer("pointerdown", target, x, y, pointerId, 1);
          pointer("pointerup", target, x, y, pointerId, 0);
        }

        window.__audioFeedback = { unlocks: 0, clicks: 0, combines: 0 };
        window.AUDIO_FEEDBACK = {
          unlock: function () {
            window.__audioFeedback.unlocks += 1;
            return Promise.resolve(true);
          },
          playElementClick: function () {
            window.__audioFeedback.clicks += 1;
            return true;
          },
          playCombineSuccess: function () {
            window.__audioFeedback.combines += 1;
            return true;
          }
        };

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
        document.querySelectorAll("#workspace .element.on-canvas").forEach(
          function (element) { element.remove(); }
        );
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
        var combinesAfterSuccess = window.__audioFeedback.combines;

        await placeStarter(
          "水",
          workspaceRect.left + 210,
          workspaceRect.top + 300,
          44
        );
        await placeStarter(
          "火",
          workspaceRect.left + 430,
          workspaceRect.top + 300,
          45
        );
        await combineCanvasPair("水", "火", 46);
        var combinesAfterFallback = window.__audioFeedback.combines;
        await combineCanvasPair("水", "火", 47);
        var combinesAfterError = window.__audioFeedback.combines;

        var waterChip = document.querySelector(
          '#element-list .element[data-name="水"]'
        );
        var fireChip = document.querySelector(
          '#element-list .element[data-name="火"]'
        );
        var originalRandom = Math.random;
        Math.random = function () { return 0; };

        var watersBeforeListClick = new Set(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="水"]'
        ));
        var beforeListClick =
          document.querySelectorAll("#workspace .element.on-canvas").length;
        tapElement(waterChip, 51);
        var afterListClick =
          document.querySelectorAll("#workspace .element.on-canvas").length;
        var summonedWater = Array.from(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="水"]'
        )).find(function (element) {
          return !watersBeforeListClick.has(element);
        });
        var listRandomPosition = summonedWater ? {
          left: parseFloat(summonedWater.style.left),
          top: parseFloat(summonedWater.style.top)
        } : null;

        var beforeListDouble = afterListClick;
        var firesBeforeListDouble = new Set(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="火"]'
        ));
        tapElement(fireChip, 52);
        tapElement(fireChip, 53);
        var afterListDouble =
          document.querySelectorAll("#workspace .element.on-canvas").length;
        var summonedFire = Array.from(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="火"]'
        )).find(function (element) {
          return !firesBeforeListDouble.has(element);
        });
        Math.random = originalRandom;

        var canvasSingleUnchanged = false;
        if (summonedWater) {
          var waterBefore = {
            left: summonedWater.style.left,
            top: summonedWater.style.top
          };
          tapElement(summonedWater, 54);
          canvasSingleUnchanged =
            summonedWater.style.left === waterBefore.left
            && summonedWater.style.top === waterBefore.top;
        }

        var beforeCanvasDouble = document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="火"]'
        ).length;
        var firesBeforeCanvasDouble = new Set(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="火"]'
        ));
        var fireBefore = summonedFire ? {
          left: parseFloat(summonedFire.style.left),
          top: parseFloat(summonedFire.style.top)
        } : null;
        if (summonedFire) {
          tapElement(summonedFire, 55);
          tapElement(summonedFire, 56);
        }
        var firesAfterCanvasDouble = Array.from(document.querySelectorAll(
          '#workspace .element.on-canvas[data-name="火"]'
        ));
        var copiedFire = firesAfterCanvasDouble.find(function (element) {
          return !firesBeforeCanvasDouble.has(element);
        });
        var canvasCopyOffset = copiedFire && fireBefore ? {
          x: parseFloat(copiedFire.style.left) - fireBefore.left,
          y: parseFloat(copiedFire.style.top) - fireBefore.top
        } : null;

        var canvasDragMoved = false;
        if (summonedWater) {
          var dragBefore =
            summonedWater.style.left + "|" + summonedWater.style.top;
          var dragRect = summonedWater.getBoundingClientRect();
          var dragX = dragRect.left + dragRect.width / 2;
          var dragY = dragRect.top + dragRect.height / 2;
          pointer("pointerdown", summonedWater, dragX, dragY, 57, 1);
          pointer("pointermove", window, dragX + 80, dragY + 60, 57, 1);
          pointer("pointerup", window, dragX + 80, dragY + 60, 57, 0);
          await new Promise(function (resolve) { setTimeout(resolve, 20); });
          var dragAfter =
            summonedWater.style.left + "|" + summonedWater.style.top;
          canvasDragMoved = dragBefore !== dragAfter;
        }

        document.getElementById("btn-recipebook").click();
        var recipeResult = document.querySelector(
          "#recipebook .recipe-result"
        );
        var recipeBefore =
          document.querySelectorAll("#workspace .element.on-canvas").length;
        if (recipeResult) {
          tapElement(recipeResult, 58);
          tapElement(recipeResult, 59);
        }
        var recipeAfter =
          document.querySelectorAll("#workspace .element.on-canvas").length;

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
                initial_guidance: initialGuidance,
                expanded_guidance: expandedGuidance,
                collapsed_guidance: collapsedGuidance,
                midnight_topbar: midnightTopbar
              },
              interactions: {
                list_single_delta: afterListClick - beforeListClick,
                list_double_delta: afterListDouble - beforeListDouble,
                list_random_position: listRandomPosition,
                canvas_single_unchanged: canvasSingleUnchanged,
                canvas_double_delta:
                  firesAfterCanvasDouble.length - beforeCanvasDouble,
                canvas_copy_offset: canvasCopyOffset,
                canvas_drag_moved: canvasDragMoved,
                recipe_click_delta: recipeAfter - recipeBefore,
                element_click_sounds: window.__audioFeedback.clicks
              },
              audio: {
                after_success: combinesAfterSuccess,
                after_fallback: combinesAfterFallback,
                after_error: combinesAfterError,
                element_clicks: window.__audioFeedback.clicks
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


def test_midnight_toast_is_dark_and_advanced_guidance_toggles(
    tmp_path,
):
    actual = _run_app_page(tmp_path)["ui"]
    midnight = actual["midnight_toast"]
    light = actual["light_toast"]

    assert "拖" in actual["initial_guidance"]["visible_text"]
    assert "合成" in actual["initial_guidance"]["visible_text"]
    assert "双击" not in actual["initial_guidance"]["visible_text"]
    assert "案例展示" not in actual["initial_guidance"]["visible_text"]
    assert actual["initial_guidance"]["advanced_hidden"] is True
    assert actual["initial_guidance"]["expanded"] == "false"

    assert "双击" in actual["expanded_guidance"]["visible_text"]
    assert "案例展示" in actual["expanded_guidance"]["visible_text"]
    assert "滨海大厦" in actual["expanded_guidance"]["visible_text"]
    assert actual["expanded_guidance"]["advanced_hidden"] is False
    assert actual["expanded_guidance"]["expanded"] == "true"

    assert actual["collapsed_guidance"] == {
        "advanced_hidden": True,
        "expanded": "false",
        "visible_text": actual["initial_guidance"]["visible_text"],
    }
    assert midnight["backgroundImage"] != light["backgroundImage"]
    assert midnight["color"] != light["color"]
    assert midnight["resultColor"] != light["resultColor"]
    assert midnight["commentColor"] != light["commentColor"]
    assert midnight["dividerColor"] != light["dividerColor"]
    assert midnight["buttonBackground"] != light["buttonBackground"]
    assert midnight["buttonColor"] != light["buttonColor"]


def test_element_pointer_interactions_are_action_specific(tmp_path):
    actual = _run_app_page(tmp_path)["interactions"]

    assert actual["list_single_delta"] == 1
    assert actual["list_double_delta"] == 1
    assert actual["list_random_position"] == {"left": 10, "top": 16}
    assert actual["canvas_single_unchanged"] is True
    assert actual["canvas_double_delta"] == 1
    assert actual["canvas_copy_offset"] == {"x": 28, "y": 28}
    assert actual["canvas_drag_moved"] is True
    assert actual["recipe_click_delta"] == 0
    assert actual["element_click_sounds"] == 4


def test_audio_routes_only_completed_actions(tmp_path):
    actual = _run_app_page(tmp_path)["audio"]

    assert actual["after_success"] == 2
    assert actual["after_fallback"] == 2
    assert actual["after_error"] == 2
    assert actual["element_clicks"] == 4


def test_reset_control_is_replaced_by_reload_guidance(tmp_path):
    actual = _run_app_page(tmp_path)["ui"]

    assert actual["midnight_topbar"]["reset_present"] is False
    assert "F5" in actual["expanded_guidance"]["visible_text"]
    assert "清空画布" in actual["expanded_guidance"]["visible_text"]


def test_inner_mode_topbar_icons_are_legible_and_help_button_stays_round(tmp_path):
    topbar = _run_app_page(tmp_path)["ui"]["midnight_topbar"]

    assert set(topbar["icon_wells"]) == {
        "btn-recipebook",
        "btn-score",
        "first-wall",
    }
    for background in topbar["icon_wells"].values():
        assert background not in (None, "rgba(0, 0, 0, 0)")
    assert topbar["help_button"]["width"] == topbar["help_button"]["height"]
    assert topbar["help_button"]["border_radius"] == "50%"


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
