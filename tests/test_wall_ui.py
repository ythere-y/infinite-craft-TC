from __future__ import annotations

import html
import json
from pathlib import Path
import re
import subprocess

from test_combine_feedback import _browser_path


FRONTEND = Path("frontend")
WALL = FRONTEND / "wall"


def _classic_module(path: Path) -> str:
    return re.sub(r"\bexport\s+", "", path.read_text(encoding="utf-8"))


def _wall_runtime_source() -> str:
    source = (WALL / "wall.js").read_text(encoding="utf-8")
    return re.sub(
        r"^import[\s\S]*?;\s*$",
        "",
        source,
        flags=re.MULTILINE,
    )


def _run_wall(
    tmp_path: Path,
    *,
    setup: str,
    probe: str,
    viewport: tuple[int, int] = (1280, 900),
) -> dict[str, object]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    index = (WALL / "index.html").read_text(encoding="utf-8")
    body = re.search(r"<body>([\s\S]*?)</body>", index).group(1)
    body = re.sub(r'<script\b[^>]*\bsrc="[^"]+"[^>]*></script>', "", body)
    styles = "\n".join([
        (FRONTEND / "icon-system.css").read_text(encoding="utf-8"),
        (WALL / "wall.css").read_text(encoding="utf-8"),
    ])
    stubs = """
    window.ICON_SYSTEM = {
      ready: Promise.resolve(),
      hydrateActions: function () {},
      renderAction: function (doc, target, options) {
        target.textContent = options.label || options.name || "";
      },
      renderElement: function (doc, target, options) {
        var name = doc.createElement("span");
        name.className = "name";
        name.textContent = options.name || "";
        target.replaceChildren(name);
      }
    };
    window.fetch = function (url) {
      var path = String(url);
      var payload = path.indexOf("/api/wall/page") >= 0
        ? { items: [], total: 0, has_more: false }
        : path.indexOf("/api/wall/leaderboard") >= 0
          ? (window.__leaderboardPayload || { top: [], total_players: 0, me: null })
          : path.indexOf("/api/wall/bounty") >= 0
            ? { tabs: [], groups: [], total: 0, found: 0 }
            : {};
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(payload); }
      });
    };
    """
    page = tmp_path / "wall-runtime.html"
    page.write_text("\n".join([
        "<!doctype html><meta charset=utf-8>",
        f"<style>{styles}</style>",
        body,
        '<pre id="result"></pre>',
        f"<script>{stubs}</script>",
        f"<script>{_classic_module(WALL / 'first-honor.js')}</script>",
        f"<script>{_classic_module(WALL / 'polling.js')}</script>",
        f"<script>{_classic_module(WALL / 'recipe-comments.js')}</script>",
        f"<script>{setup}</script>",
        f"<script>{_wall_runtime_source()}</script>",
        "<script>",
        "setTimeout(function(){try{",
        f"var value=(function(){{{probe}}})();",
        "document.querySelector('#result').textContent=JSON.stringify({ok:true,value:value});",
        "}catch(error){",
        "document.querySelector('#result').textContent=JSON.stringify({ok:false,error:String(error.stack||error)});",
        "}},80);",
        "</script>",
    ]), encoding="utf-8")
    width, height = viewport
    done = subprocess.run([
        str(_browser_path()),
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=1200",
        f"--window-size={width},{height}",
        f"--user-data-dir={tmp_path / 'profile'}",
        "--dump-dom",
        page.as_uri(),
    ], check=False, capture_output=True, encoding="utf-8", timeout=25)
    assert done.returncode == 0, done.stderr
    result = re.search(r'<pre id="result">(.*?)</pre>', done.stdout, re.S)
    assert result, done.stdout
    payload = json.loads(html.unescape(result.group(1)))
    assert payload["ok"], payload["error"]
    return payload["value"]


def test_wall_uses_distinct_first_visit_section_defaults(tmp_path):
    actual = _run_wall(tmp_path, setup="", probe="""
      return {
        bountyExpanded: document.querySelector("#bounty-toggle").getAttribute("aria-expanded"),
        bountyCollapsed: document.querySelector("#bounty-body").classList.contains("collapsed"),
        feedExpanded: document.querySelector("#feed-toggle").getAttribute("aria-expanded"),
        feedCollapsed: document.querySelector("#feed-body").classList.contains("collapsed")
      };
    """)
    assert actual == {
        "bountyExpanded": "false",
        "bountyCollapsed": True,
        "feedExpanded": "true",
        "feedCollapsed": False,
    }


def test_wall_saved_section_preferences_override_defaults(tmp_path):
    actual = _run_wall(tmp_path, setup="""
      localStorage.setItem("ic_wall_collapse_bounty", "0");
      localStorage.setItem("ic_wall_collapse_feed", "1");
    """, probe="""
      document.querySelector("#bounty-toggle").click();
      document.querySelector("#feed-toggle").click();
      return {
        bountyExpanded: document.querySelector("#bounty-toggle").getAttribute("aria-expanded"),
        feedExpanded: document.querySelector("#feed-toggle").getAttribute("aria-expanded"),
        bountySaved: localStorage.getItem("ic_wall_collapse_bounty"),
        feedSaved: localStorage.getItem("ic_wall_collapse_feed")
      };
    """)
    assert actual == {
        "bountyExpanded": "false",
        "feedExpanded": "true",
        "bountySaved": "1",
        "feedSaved": "0",
    }
