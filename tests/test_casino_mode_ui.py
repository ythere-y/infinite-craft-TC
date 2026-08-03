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


def _production_controller_page() -> str:
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
        window.matchMedia = function () {
          return {
            matches: true,
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
          after_harvest: {
            chips: document.querySelectorAll(
              "#casino-chip-stack .casino-chip"
            ).length,
            pot: document.getElementById("casino-pot-value").textContent,
            total: localStorage.getItem("ic_kpi"),
            busy: window.CASINO_MODE.isBusy()
          }
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
    ).replace("</body>", f"{scripts}{probe}</body>", 1)


def _run_controller_page(tmp_path: Path) -> dict[str, object]:
    page = tmp_path / "casino-controller.html"
    profile = tmp_path / "chrome-profile"
    page.write_text(_production_controller_page(), encoding="utf-8")
    command = [
        str(_chrome()),
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=1500",
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
        window.addEventListener("ura-mode-change", function (event) {
          window.__uraEvents.push(event.detail);
        });
        window.alert = function () {};
        window.fetch = function (url) {
          var path = String(url);
          var payload =
            path.indexOf("emoji-icon-manifest") >= 0 ? {}
            : path.indexOf("element-icon-map") >= 0 ? {}
            : path.indexOf("/api/starters") >= 0 ? { starters: [] }
            : path.indexOf("/api/elements") >= 0 ? { elements: {} }
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
        var initial = {
          active: window.EFFECTS.isUraMode(),
          transitionCount: document.querySelectorAll(".ura-transition").length,
          event: window.__uraEvents[0] || null
        };
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });
        window.CASINO_MODE.onCombineResult({ isGlobalFirst: true });

        var code = [
          "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
          "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"
        ];
        code.forEach(function (key) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
        });
        await new Promise(function (resolve) { setTimeout(resolve, 30); });
        var afterFirstCode = {
          active: window.EFFECTS.isUraMode(),
          chips: window.CASINO_MODE.getState().chips
        };

        code.forEach(function (key) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: key }));
        });
        var entranceTransitionCount =
          document.querySelectorAll(".ura-transition.ura-enter").length;
        await new Promise(function (resolve) { setTimeout(resolve, 650); });
        var afterSecondCode = {
          active: window.EFFECTS.isUraMode(),
          entranceTransitionCount: entranceTransitionCount,
          chips: window.CASINO_MODE.getState().chips
        };

        document.getElementById("casino-app-result").textContent =
          JSON.stringify({
            ok: true,
            value: {
              initial: initial,
              after_first_code: afterFirstCode,
              after_second_code: afterSecondCode,
              events: window.__uraEvents
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
            "--virtual-time-budget=1800",
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


def test_game_starts_silently_in_inner_mode_and_preserves_reentry_animation(
    tmp_path,
):
    actual = _run_app_page(tmp_path)

    assert actual["initial"] == {
        "active": True,
        "transitionCount": 0,
        "event": {"active": True, "initial": True},
    }
    assert actual["after_first_code"] == {
        "active": False,
        "chips": 2,
    }
    assert actual["after_second_code"] == {
        "active": True,
        "entranceTransitionCount": 1,
        "chips": 2,
    }
    assert actual["events"][:3] == [
        {"active": True, "initial": True},
        {"active": False, "initial": False},
        {"active": True, "initial": False},
    ]
