from __future__ import annotations

import html
import json
from pathlib import Path
import re
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
INDEX = FRONTEND / "index.html"


def _chrome() -> str:
    for command in ("google-chrome", "chrome", "chromium", "ungoogled-chromium", "msedge"):
        if executable := shutil.which(command):
            return executable
    raise AssertionError("Recipebook UI test requires a Chromium-family browser.")


def _production_page() -> str:
    index = INDEX.read_text(encoding="utf-8")
    styles = "\n".join(
        (FRONTEND / name).read_text(encoding="utf-8")
        for name in ("icon-system.css", "style.css")
    )
    index = re.sub(r'<link rel="stylesheet"[^>]+>', "", index)
    index = index.replace("</head>", f"<style>{styles}</style></head>")

    def inline_script(match: re.Match[str]) -> str:
        filename = match.group(1).split("?", 1)[0]
        if filename not in {
            "icon-system.js",
            "combine-feedback.js",
            "score-level.js",
            "effects.js",
            "app.js",
        }:
            return ""
        return f"<script>{(FRONTEND / filename).read_text(encoding='utf-8')}</script>"

    index = index.replace(
        "<body>",
        """<body>
        <script>
        localStorage.setItem("ic_nick", "测试鹅");
        localStorage.setItem("ic_nick_id", "ic-test");
        localStorage.setItem("ic_recipes", JSON.stringify([
          { a: "水", b: "火", result: "蒸汽", emoji: "💨", ts: 1 },
          {
            a: "超长元素甲乙丙丁戊己庚辛壬癸",
            b: "超长元素子丑寅卯辰巳午未申酉",
            result: "超长结果春夏秋冬东南西北天地",
            emoji: "🧪", ts: 2
          }
        ]));
        window.alert = function () {};
        window.fetch = function (url) {
          var path = String(url);
          var payload = path.indexOf("/api/starters") >= 0 ? { starters: [] }
            : path.indexOf("/api/elements") >= 0 ? { elements: {} }
            : {};
          return Promise.resolve({ ok: true, json: function () { return Promise.resolve(payload); } });
        };
        </script>""",
    )
    return re.sub(r'<script src="/([^"?]+)(?:\?[^\"]*)?"></script>', inline_script, index)


def _run_recipebook(tmp_path: Path, viewport: tuple[int, int]) -> dict[str, object]:
    tmp_path.mkdir()
    page = tmp_path / "recipebook-browser-frame.html"
    profile = tmp_path / "chrome-profile"
    probe = """
    <pre id="recipebook-result"></pre>
    <script>
    setTimeout(function () {
      try {
        document.getElementById("btn-recipebook").click();
        var drawer = document.getElementById("recipebook");
        var header = drawer.querySelector(".recipebook-header");
        var close = document.getElementById("recipebook-close");
        var rows = Array.from(drawer.querySelectorAll(".recipe-row"));
        var shortRow = rows.find(function (row) { return row.textContent.indexOf("蒸汽") >= 0; });
        var longRow = rows.find(function (row) { return row.textContent.indexOf("春夏秋冬东南西北天地") >= 0; });
        var closeRect = close.getBoundingClientRect();
        var headerRect = header.getBoundingClientRect();
        var titleRange = document.createRange();
        titleRange.selectNodeContents(drawer.querySelector(".recipebook-title"));
        var titleRects = Array.from(titleRange.getClientRects());
        var titleRight = titleRects[titleRects.length - 1].right;
        close.focus();
        var focusVisible = close.matches(":focus-visible");
        var focusBoxShadow = getComputedStyle(close).boxShadow;
        var closeIcon = close.querySelector(".action-icon img");
        document.body.classList.add("ura-on");
        var nightBackground = getComputedStyle(close).backgroundColor;
        var nightColor = getComputedStyle(close).color;
        document.body.classList.remove("ura-on");
        var beforeClose = drawer.classList.contains("show");
        close.click();
        document.getElementById("recipebook-result").textContent = JSON.stringify({
          drawerWidth: drawer.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
          closeRightGap: headerRect.right - closeRect.right,
          closeBackground: getComputedStyle(close).backgroundColor,
          closeWidth: closeRect.width,
          closeHeight: closeRect.height,
          closeTitle: close.title,
          closeAriaLabel: close.getAttribute("aria-label"),
          hydratedCloseIcon: !!closeIcon && closeIcon.getAttribute("src").indexOf("/actions/x.svg") >= 0,
          focusVisible: focusVisible,
          focusBoxShadow: focusBoxShadow,
          titleDoesNotOverlapClose: titleRight <= closeRect.left,
          nightBackground: nightBackground,
          nightColor: nightColor,
          wasOpen: beforeClose,
          closed: !drawer.classList.contains("show"),
          shortClasses: Array.from(shortRow.classList),
          longClasses: Array.from(longRow.classList),
          longFits: longRow.scrollWidth <= longRow.clientWidth,
          rowWhiteSpace: rows.map(function (row) { return getComputedStyle(row).whiteSpace; })
        });
      } catch (error) {
        document.getElementById("recipebook-result").textContent = JSON.stringify({ error: String(error.stack || error) });
      }
    }, 200);
    </script>
    """
    production = _production_page().replace("</body>", probe + "</body>")
    page.write_text(
        f"""<!doctype html><meta charset=\"utf-8\">
        <iframe id=\"recipebook-frame\" srcdoc=\"{html.escape(production, quote=True)}\"
                style=\"border:0;width:{viewport[0]}px;height:{viewport[1]}px\"></iframe>
        <pre id=\"recipebook-result\"></pre>
        <script>
        var poll = setInterval(function () {{
          try {{
            var frameDocument = document.getElementById("recipebook-frame").contentDocument;
            if (!frameDocument) return;
            var innerResult = frameDocument.getElementById("recipebook-result");
            if (!innerResult) return;
            var result = innerResult.textContent;
            if (!result) return;
            clearInterval(poll);
            document.getElementById("recipebook-result").textContent = result;
          }} catch (error) {{
            clearInterval(poll);
            document.getElementById("recipebook-result").textContent = JSON.stringify({{ error: String(error) }});
          }}
        }}, 10);
        </script>""",
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            _chrome(), "--headless=new", "--no-sandbox", "--disable-gpu",
            "--disable-background-networking", "--no-first-run",
            "--no-default-browser-check", "--virtual-time-budget=1000",
            f"--user-data-dir={profile}", "--window-size=1600,1000",
            "--dump-dom", page.as_uri(),
        ],
        check=False,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    assert completed.returncode == 0, completed.stderr
    match = re.search(r'<pre id="recipebook-result">(.*?)</pre>', completed.stdout, re.DOTALL)
    assert match, completed.stdout
    actual = json.loads(html.unescape(match.group(1)))
    assert "error" not in actual, actual["error"]
    return actual


def test_recipebook_close_control_and_formula_density_use_real_production_page(tmp_path: Path):
    desktop = _run_recipebook(tmp_path / "desktop", (1440, 900))
    mobile = _run_recipebook(tmp_path / "mobile", (360, 800))

    assert desktop["drawerWidth"] == 480
    assert 0 <= desktop["closeRightGap"] <= 16
    assert desktop["closeBackground"] != "rgb(255, 95, 87)"
    assert desktop["closeWidth"] == 30
    assert desktop["closeHeight"] == 30
    assert desktop["closeTitle"] == "关闭"
    assert desktop["closeAriaLabel"] == "关闭配方图鉴"
    assert desktop["hydratedCloseIcon"] is True
    assert desktop["focusVisible"] is True
    assert desktop["focusBoxShadow"] != "none"
    assert desktop["titleDoesNotOverlapClose"] is True
    assert desktop["nightBackground"] != "rgb(255, 95, 87)"
    assert desktop["nightColor"] != desktop["nightBackground"]
    assert desktop["wasOpen"] is True
    assert desktop["closed"] is True
    assert "recipe-row-dense" not in desktop["shortClasses"]
    assert "recipe-row-ultra-dense" not in desktop["shortClasses"]
    assert {"recipe-row-dense", "recipe-row-ultra-dense"} & set(desktop["longClasses"])
    assert desktop["longFits"] is True
    assert desktop["rowWhiteSpace"] and set(desktop["rowWhiteSpace"]) == {"nowrap"}
    assert mobile["drawerWidth"] <= 360
    assert {"recipe-row-dense", "recipe-row-ultra-dense"} & set(mobile["longClasses"])
    assert mobile["longFits"] is True
    assert mobile["rowWhiteSpace"] and set(mobile["rowWhiteSpace"]) == {"nowrap"}
