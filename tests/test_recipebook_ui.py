from __future__ import annotations

import base64
import html
import json
from pathlib import Path
import re
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
INDEX = FRONTEND / "index.html"
CLOSE_SVG = FRONTEND / "assets/icons/actions/x.svg"


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

    index = re.sub(
        r"<body(?:\s[^>]*)?>",
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
          },
          {
            a: "配方压缩输入甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸",
            b: "配方压缩输入子丑寅卯辰巳午未申酉子丑寅卯辰巳午未申酉",
            result: "配方测量终点春夏秋冬东南西北天地春夏秋冬东南西北天地",
            emoji: "🧬", ts: 3
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
        index,
        count=1,
    )
    return re.sub(r'<script src="/([^"?]+)(?:\?[^\"]*)?"></script>', inline_script, index)


def _run_recipebook(tmp_path: Path, viewport: tuple[int, int]) -> dict[str, object]:
    tmp_path.mkdir()
    page = tmp_path / "recipebook-browser-frame.html"
    profile = tmp_path / "chrome-profile"
    probe = """
    <img id="close-asset-probe"
         src="data:image/svg+xml;base64,__CLOSE_SVG_DATA__"
         width="64" height="64" alt=""
         style="position:fixed;left:-10000px;top:0">
    <pre id="recipebook-result"></pre>
    <script>
    setTimeout(function () {
      try {
        ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
         "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"]
          .forEach(function (key) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
          });
        var drawer = document.getElementById("recipebook");
        var close = document.getElementById("recipebook-close");
        var scorePanel = document.getElementById("score-panel");
        var scoreClose = document.getElementById("score-panel-close");
        drawer.style.transition = "none";
        close.style.transition = "none";
        scorePanel.style.animation = "none";
        scoreClose.style.transition = "none";
        document.getElementById("btn-recipebook").click();
        document.getElementById("btn-score").click();
        var header = drawer.querySelector(".recipebook-header");
        var rows = Array.from(drawer.querySelectorAll(".recipe-row"));
        var shortRow = rows.find(function (row) { return row.textContent.indexOf("蒸汽") >= 0; });
        var longRow = rows.find(function (row) { return row.textContent.indexOf("超长结果") >= 0; });
        var fitRow = rows.find(function (row) { return row.textContent.indexOf("配方测量终点") >= 0; });
        var longPlus = longRow.querySelector(".recipe-plus");
        var fitPlus = fitRow.querySelector(".recipe-plus");
        var fitName = fitRow.querySelector(".recipe-chip[data-name] .name");
        var fitArrow = fitRow.querySelector(".recipe-arrow");
        var closeRect = close.getBoundingClientRect();
        var closeStyle = getComputedStyle(close);
        var closeBorderRadius = closeStyle.borderRadius;
        var closeBorderColor = closeStyle.borderColor;
        var scoreCloseRect = scoreClose.getBoundingClientRect();
        var scoreCloseStyle = getComputedStyle(scoreClose);
        var scoreCloseBackground = scoreCloseStyle.backgroundColor;
        var scoreCloseBorderRadius = scoreCloseStyle.borderRadius;
        var scoreCloseBorderColor = scoreCloseStyle.borderColor;
        var headerRect = header.getBoundingClientRect();
        var titleRange = document.createRange();
        titleRange.selectNodeContents(drawer.querySelector(".recipebook-title"));
        var titleRects = Array.from(titleRange.getClientRects());
        var titleRight = titleRects[titleRects.length - 1].right;
        close.focus();
        var focusVisible = close.matches(":focus-visible");
        var focusBoxShadow = getComputedStyle(close).boxShadow;
        var focusRingVisible = focusBoxShadow.indexOf("3px") >= 0
          && focusBoxShadow.indexOf("0.25") >= 0;
        var closeIcon = close.querySelector(".action-icon img");
        var closeIconWell = close.querySelector(".action-icon");
        var closeIconWellRect = closeIconWell.getBoundingClientRect();
        var closeIconRect = closeIcon.getBoundingClientRect();
        var scoreCloseIcon = scoreClose.querySelector(".action-icon img");
        var scoreCloseIconWell = scoreClose.querySelector(".action-icon");
        var scoreCloseIconWellRect = scoreCloseIconWell.getBoundingClientRect();
        var scoreCloseIconRect = scoreCloseIcon.getBoundingClientRect();
        var assetCanvas = document.createElement("canvas");
        assetCanvas.width = 64;
        assetCanvas.height = 64;
        var assetContext = assetCanvas.getContext("2d");
        assetContext.drawImage(document.getElementById("close-asset-probe"), 0, 0, 64, 64);
        var closeAssetBackdropAlpha =
          assetContext.getImageData(32, 14, 1, 1).data[3];
        var shortChip = shortRow.querySelector(".recipe-chip[data-name]");
        var shortName = shortChip.querySelector(".name");
        var shortPlus = shortRow.querySelector(".recipe-plus");
        var shortArrow = shortRow.querySelector(".recipe-arrow");
        var shortRowStyle = getComputedStyle(shortRow);
        var shortChipStyle = getComputedStyle(shortChip);
        var shortNameStyle = getComputedStyle(shortName);
        var shortPlusStyle = getComputedStyle(shortPlus);
        var shortArrowStyle = getComputedStyle(shortArrow);
        var longPlusStyle = getComputedStyle(longPlus);
        var fitPlusStyle = getComputedStyle(fitPlus);
        var fitNameStyle = getComputedStyle(fitName);
        var fitArrowStyle = getComputedStyle(fitArrow);
        var shortChipIcon = shortChip.querySelector(".element-icon-canvas");
        var closeIconUrl = closeIcon && closeIcon.getAttribute("src");
        var lightIconFilter = closeIcon && getComputedStyle(closeIcon).filter;
        document.body.classList.add("ura-on");
        var nightBackground = getComputedStyle(close).backgroundColor;
        var nightColor = getComputedStyle(close).color;
        var nightScoreCloseBackground = getComputedStyle(scoreClose).backgroundColor;
        var nightScoreCloseColor = getComputedStyle(scoreClose).color;
        var nightIconFilter = closeIcon && getComputedStyle(closeIcon).filter;
        var nightIconRect = closeIcon && closeIcon.getBoundingClientRect();
        var nightRowColor = getComputedStyle(shortRow).color;
        var nightPlusColor = getComputedStyle(shortPlus).color;
        var nightArrowColor = getComputedStyle(shortArrow).color;
        var nightFitPlusVisible = getComputedStyle(fitPlus).display !== "none"
          && getComputedStyle(fitPlus).visibility !== "hidden"
          && getComputedStyle(fitPlus).opacity !== "0";
        var nightFitArrowVisible = getComputedStyle(fitArrow).display !== "none"
          && getComputedStyle(fitArrow).visibility !== "hidden"
          && getComputedStyle(fitArrow).opacity !== "0";
        var nightIconVisible = !!nightIconRect && nightIconRect.width > 0 && nightIconRect.height > 0
          && getComputedStyle(closeIcon).display !== "none"
          && getComputedStyle(closeIcon).visibility !== "hidden"
          && getComputedStyle(closeIcon).opacity !== "0";
        document.body.classList.remove("ura-on");
        var canvasCountBefore = document.querySelectorAll("#workspace .element.on-canvas").length;
        longRow.querySelector(".recipe-result").dispatchEvent(new MouseEvent("dblclick", {
          bubbles: true, cancelable: true
        }));
        var denseChipDoubleIgnored =
          document.querySelectorAll("#workspace .element.on-canvas").length === canvasCountBefore;
        var dragChip = longRow.querySelector(".recipe-chip[data-name]");
        var dragChipRect = dragChip.getBoundingClientRect();
        var workspaceRect = document.getElementById("workspace").getBoundingClientRect();
        var canvasCountBeforeDrag = document.querySelectorAll("#workspace .element.on-canvas").length;
        dragChip.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, pointerId: 41, pointerType: "mouse",
          button: 0, buttons: 1,
          clientX: dragChipRect.left + dragChipRect.width / 2,
          clientY: dragChipRect.top + dragChipRect.height / 2
        }));
        dragChip.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true, cancelable: true, pointerId: 41, pointerType: "mouse",
          button: 0, buttons: 1,
          clientX: workspaceRect.left + 24, clientY: workspaceRect.top + 24
        }));
        dragChip.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true, cancelable: true, pointerId: 41, pointerType: "mouse",
          button: 0, buttons: 0,
          clientX: workspaceRect.left + 24, clientY: workspaceRect.top + 24
        }));
        var denseChipDragged =
          document.querySelectorAll("#workspace .element.on-canvas").length === canvasCountBeforeDrag + 1;
        var scoreWasOpen = scorePanel.classList.contains("show");
        scoreClose.click();
        var scoreClosed = !scorePanel.classList.contains("show");
        var beforeClose = drawer.classList.contains("show");
        close.click();
        document.getElementById("recipebook-result").textContent = JSON.stringify({
          drawerWidth: drawer.getBoundingClientRect().width,
          viewportWidth: window.innerWidth,
          closeRightGap: headerRect.right - closeRect.right,
          closeBackground: getComputedStyle(close).backgroundColor,
          closeWidth: closeRect.width,
          closeHeight: closeRect.height,
          closeBorderRadius: closeBorderRadius,
          closeBorderColor: closeBorderColor,
          closeTitle: close.title,
          closeAriaLabel: close.getAttribute("aria-label"),
          hydratedCloseIcon: !!closeIcon && closeIcon.getAttribute("src").indexOf("/actions/x.svg") >= 0,
          closeIconUrl: closeIconUrl,
          closeIconWellWidth: closeIconWellRect.width,
          closeIconWellHeight: closeIconWellRect.height,
          closeIconWidth: closeIconRect.width,
          closeIconHeight: closeIconRect.height,
          closeIconCenterDeltaX: Math.abs(
            (closeIconRect.left + closeIconRect.width / 2) -
            (closeIconWellRect.left + closeIconWellRect.width / 2)
          ),
          closeIconCenterDeltaY: Math.abs(
            (closeIconRect.top + closeIconRect.height / 2) -
            (closeIconWellRect.top + closeIconWellRect.height / 2)
          ),
          closeAssetBackdropAlpha: closeAssetBackdropAlpha,
          scoreCloseBackground: scoreCloseBackground,
          scoreCloseWidth: scoreCloseRect.width,
          scoreCloseHeight: scoreCloseRect.height,
          scoreCloseBorderRadius: scoreCloseBorderRadius,
          scoreCloseBorderColor: scoreCloseBorderColor,
          scoreCloseTitle: scoreClose.title,
          scoreCloseAriaLabel: scoreClose.getAttribute("aria-label"),
          scoreCloseIconWellWidth: scoreCloseIconWellRect.width,
          scoreCloseIconWellHeight: scoreCloseIconWellRect.height,
          scoreCloseIconWidth: scoreCloseIconRect.width,
          scoreCloseIconHeight: scoreCloseIconRect.height,
          scoreCloseIconCenterDeltaX: Math.abs(
            (scoreCloseIconRect.left + scoreCloseIconRect.width / 2) -
            (scoreCloseIconWellRect.left + scoreCloseIconWellRect.width / 2)
          ),
          scoreCloseIconCenterDeltaY: Math.abs(
            (scoreCloseIconRect.top + scoreCloseIconRect.height / 2) -
            (scoreCloseIconWellRect.top + scoreCloseIconWellRect.height / 2)
          ),
          shortRowGap: parseFloat(shortRowStyle.gap),
          shortChipPaddingLeft: parseFloat(shortChipStyle.paddingLeft),
          shortChipIconWidth: shortChipIcon.getBoundingClientRect().width,
          shortPlusPaddingLeft: parseFloat(shortPlusStyle.paddingLeft),
          longPlusPaddingLeft: parseFloat(longPlusStyle.paddingLeft),
          fitPlusPaddingLeft: parseFloat(fitPlusStyle.paddingLeft),
          fitPlusFontSize: parseFloat(fitPlusStyle.fontSize),
          fitArrowFontSize: parseFloat(fitArrowStyle.fontSize),
          fitNameFontSize: parseFloat(fitNameStyle.fontSize),
          shortPlusFontSize: parseFloat(shortPlusStyle.fontSize),
          shortArrowFontSize: parseFloat(shortArrowStyle.fontSize),
          shortNameFontSize: parseFloat(shortNameStyle.fontSize),
          shortPlusFontWeight: parseInt(shortPlusStyle.fontWeight, 10),
          shortArrowFontWeight: parseInt(shortArrowStyle.fontWeight, 10),
          shortPlusColor: shortPlusStyle.color,
          shortArrowColor: shortArrowStyle.color,
          shortNameColor: shortNameStyle.color,
          nightPlusColor: nightPlusColor,
          nightArrowColor: nightArrowColor,
          nightRowColor: nightRowColor,
          nightFitPlusVisible: nightFitPlusVisible,
          nightFitArrowVisible: nightFitArrowVisible,
          lightIconFilter: lightIconFilter,
          nightIconFilter: nightIconFilter,
          nightIconVisible: nightIconVisible,
          focusVisible: focusVisible,
          focusBoxShadow: focusBoxShadow,
          focusRingVisible: focusRingVisible,
          titleDoesNotOverlapClose: titleRight <= closeRect.left,
          nightBackground: nightBackground,
          nightColor: nightColor,
          nightScoreCloseBackground: nightScoreCloseBackground,
          nightScoreCloseColor: nightScoreCloseColor,
          denseChipDoubleIgnored: denseChipDoubleIgnored,
          denseChipDragged: denseChipDragged,
          scoreWasOpen: scoreWasOpen,
          scoreClosed: scoreClosed,
          wasOpen: beforeClose,
          closed: !drawer.classList.contains("show"),
          shortClasses: Array.from(shortRow.classList),
          longClasses: Array.from(longRow.classList),
          fitClasses: Array.from(fitRow.classList),
          longFits: longRow.scrollWidth <= longRow.clientWidth,
          fitFits: fitRow.scrollWidth <= fitRow.clientWidth,
          rowWhiteSpace: rows.map(function (row) { return getComputedStyle(row).whiteSpace; })
        });
      } catch (error) {
        document.getElementById("recipebook-result").textContent = JSON.stringify({ error: String(error.stack || error) });
      }
    }, 600);
    </script>
    """
    probe = probe.replace(
        "__CLOSE_SVG_DATA__",
        base64.b64encode(CLOSE_SVG.read_bytes()).decode("ascii"),
    )
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
    assert desktop["closeIconUrl"].endswith("/assets/icons/actions/x.svg")
    assert desktop["closeIconWellWidth"] == 30
    assert desktop["closeIconWellHeight"] == 30
    assert desktop["closeIconWidth"] == 14
    assert desktop["closeIconHeight"] == 14
    assert desktop["closeIconCenterDeltaX"] <= 0.5
    assert desktop["closeIconCenterDeltaY"] <= 0.5
    assert desktop["closeAssetBackdropAlpha"] == 0
    assert desktop["scoreCloseBackground"] == desktop["closeBackground"]
    assert desktop["scoreCloseWidth"] == desktop["closeWidth"] == 30
    assert desktop["scoreCloseHeight"] == desktop["closeHeight"] == 30
    assert desktop["scoreCloseBorderRadius"] == desktop["closeBorderRadius"]
    assert desktop["scoreCloseBorderColor"] == desktop["closeBorderColor"]
    assert desktop["scoreCloseTitle"] == "关闭"
    assert desktop["scoreCloseAriaLabel"] == "关闭分数记录"
    assert desktop["scoreCloseIconWellWidth"] == desktop["closeIconWellWidth"]
    assert desktop["scoreCloseIconWellHeight"] == desktop["closeIconWellHeight"]
    assert desktop["scoreCloseIconWidth"] == desktop["closeIconWidth"]
    assert desktop["scoreCloseIconHeight"] == desktop["closeIconHeight"]
    assert desktop["scoreCloseIconCenterDeltaX"] <= 0.5
    assert desktop["scoreCloseIconCenterDeltaY"] <= 0.5
    assert desktop["shortRowGap"] <= 4
    assert desktop["shortChipPaddingLeft"] <= 5
    assert desktop["shortChipIconWidth"] <= 22
    assert desktop["shortPlusPaddingLeft"] == 0
    assert desktop["shortPlusFontSize"] > desktop["shortNameFontSize"]
    assert desktop["shortArrowFontSize"] > desktop["shortNameFontSize"]
    assert desktop["shortPlusFontWeight"] >= 600
    assert desktop["shortArrowFontWeight"] >= 600
    assert desktop["shortPlusColor"] != desktop["shortNameColor"]
    assert desktop["shortArrowColor"] != desktop["shortNameColor"]
    assert desktop["nightPlusColor"] != desktop["nightRowColor"]
    assert desktop["nightArrowColor"] != desktop["nightRowColor"]
    assert desktop["lightIconFilter"] == "none"
    assert desktop["nightIconFilter"] != "none"
    assert desktop["nightIconVisible"] is True
    assert desktop["focusVisible"] is True
    assert desktop["focusRingVisible"] is True
    assert desktop["titleDoesNotOverlapClose"] is True
    assert desktop["nightBackground"] == "rgb(36, 36, 60)"
    assert desktop["nightColor"] == "rgb(215, 212, 245)"
    assert desktop["nightScoreCloseBackground"] == desktop["nightBackground"]
    assert desktop["nightScoreCloseColor"] == desktop["nightColor"]
    assert desktop["denseChipDoubleIgnored"] is True
    assert desktop["scoreWasOpen"] is True
    assert desktop["scoreClosed"] is True
    assert desktop["wasOpen"] is True
    assert desktop["closed"] is True
    assert "recipe-row-dense" not in desktop["shortClasses"]
    assert "recipe-row-ultra-dense" not in desktop["shortClasses"]
    assert desktop["longFits"] is True
    assert desktop["rowWhiteSpace"] and set(desktop["rowWhiteSpace"]) == {"nowrap"}
    assert mobile["drawerWidth"] <= 360
    assert {"recipe-row-dense", "recipe-row-ultra-dense"} & set(mobile["longClasses"])
    assert mobile["longPlusPaddingLeft"] == 0
    assert mobile["longFits"] is True
    assert mobile["denseChipDoubleIgnored"] is True
    assert mobile["denseChipDragged"] is True
    assert "recipe-row-fit" in mobile["fitClasses"]
    assert mobile["fitFits"] is True
    assert mobile["fitPlusPaddingLeft"] == 0
    assert mobile["fitPlusFontSize"] > mobile["fitNameFontSize"]
    assert mobile["fitArrowFontSize"] > mobile["fitNameFontSize"]
    assert mobile["nightFitPlusVisible"] is True
    assert mobile["nightFitArrowVisible"] is True
    assert mobile["rowWhiteSpace"] and set(mobile["rowWhiteSpace"]) == {"nowrap"}
