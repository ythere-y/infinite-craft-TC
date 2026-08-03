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
