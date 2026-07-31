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


def test_wall_assets_share_current_cache_version():
    index_source = (WALL / "index.html").read_text(encoding="utf-8")
    runtime_source = (WALL / "wall.js").read_text(encoding="utf-8")
    asset_urls = re.findall(
        r'(?:href|src)="(/(?:icon-system\.(?:css|js)|wall/wall\.(?:css|js))[^"]*)"',
        index_source,
    )
    dependency_urls = re.findall(r'from "(\./[^"]+)"', runtime_source)

    assert asset_urls == [
        "/icon-system.css?v=20260731a",
        "/wall/wall.css?v=20260731a",
        "/icon-system.js?v=20260731a",
        "/wall/wall.js?v=20260731a",
    ]
    assert dependency_urls == [
        "./polling.js?v=20260731a",
        "./first-honor.js?v=20260731a",
        "./recipe-comments.js?v=20260731a",
    ]


def test_wall_collapsible_sections_manage_keyboard_focus(tmp_path):
    actual = _run_wall(tmp_path, setup="""
      var focusTarget = document.createElement("button");
      focusTarget.id = "bounty-focus-target";
      focusTarget.textContent = "悬赏操作";
      document.querySelector("#bounty-body").append(focusTarget);

      var nestedPanel = document.createElement("div");
      nestedPanel.id = "nested-collapsed-panel";
      nestedPanel.inert = true;
      document.querySelector("#bounty-body").append(nestedPanel);
    """, probe="""
      var toggle = document.querySelector("#bounty-toggle");
      var body = document.querySelector("#bounty-body");
      var focusTarget = document.querySelector("#bounty-focus-target");
      var nestedPanel = document.querySelector("#nested-collapsed-panel");

      focusTarget.focus();
      var initial = {
        inert: body.inert,
        focusBlocked: document.activeElement !== focusTarget,
        controls: toggle.getAttribute("aria-controls")
      };

      toggle.click();
      focusTarget.focus();
      var expanded = {
        inert: body.inert,
        targetFocused: document.activeElement === focusTarget,
        nestedStillInert: nestedPanel.inert
      };

      toggle.focus();
      toggle.click();
      focusTarget.focus();
      var recollapsed = {
        inert: body.inert,
        focusBlocked: document.activeElement !== focusTarget,
        focusStayedOnToggle: document.activeElement === toggle,
        nestedStillInert: nestedPanel.inert
      };

      return {
        initial: initial,
        expanded: expanded,
        recollapsed: recollapsed,
        feedControls: document.querySelector("#feed-toggle").getAttribute("aria-controls")
      };
    """)
    assert actual == {
        "initial": {
            "inert": True,
            "focusBlocked": True,
            "controls": "bounty-body",
        },
        "expanded": {
            "inert": False,
            "targetFocused": True,
            "nestedStillInert": True,
        },
        "recollapsed": {
            "inert": True,
            "focusBlocked": True,
            "focusStayedOnToggle": True,
            "nestedStillInert": True,
        },
        "feedControls": "feed-body",
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


LEADERBOARD_SETUP = """
localStorage.setItem("ic_nick", "当前鹅");
window.__leaderboardPayload = {
  total_players: 4,
  me: { rank: 4, firsts: 4 },
  top: [
    { rank: 1, discoverer: "第一名长昵称鹅", firsts: 76 },
    { rank: 2, discoverer: "第二名鹅", firsts: 64 },
    { rank: 3, discoverer: "第三名鹅", firsts: 16 },
    { rank: 4, discoverer: "当前鹅", firsts: 4 }
  ]
};
"""


def test_wall_renders_podium_rest_list_and_first_honor(tmp_path):
    actual = _run_wall(tmp_path, setup=LEADERBOARD_SETUP, probe="""
      var podium = Array.from(document.querySelectorAll(".lb-podium-card"));
      var rest = Array.from(document.querySelectorAll(".lb-ranking-rest .lb-row"));
      return {
        podiumRanks: podium.map(function (row) { return row.dataset.rank; }),
        podiumFirsts: podium.map(function (row) {
          return row.querySelector(".lb-firsts").textContent.trim();
        }),
        firstHonor: podium[0].querySelector(".lb-honor").getAttribute("aria-label"),
        firstHonorItems: Array.from(
          podium[0].querySelectorAll(".lb-honor-item")
        ).map(function (item) { return item.textContent; }),
        restRanks: rest.map(function (row) { return row.dataset.rank; }),
        currentFirsts: document.querySelector("#lb-me-row .lb-firsts").textContent.trim(),
        currentHonor: document.querySelector("#lb-me-row .lb-honor").getAttribute("aria-label"),
        currentHighlighted: rest[0].classList.contains("me")
      };
    """)
    assert actual == {
        "podiumRanks": ["1", "2", "3"],
        "podiumFirsts": ["76 个首发", "64 个首发", "16 个首发"],
        "firstHonor": "首发荣誉等级：1个皇冠、3个月亮",
        "firstHonorItems": ["👑", "🌙", "🌙", "🌙"],
        "restRanks": ["4"],
        "currentFirsts": "4 个首发",
        "currentHonor": "首发荣誉等级：1个月亮",
        "currentHighlighted": True,
    }


def test_wall_renders_unranked_player_empty_honor(tmp_path):
    actual = _run_wall(tmp_path, setup="""
      localStorage.setItem("ic_nick", "还在合成的鹅");
      window.__leaderboardPayload = { total_players: 0, me: null, top: [] };
    """, probe="""
      return {
        meText: document.querySelector("#lb-me-row").textContent,
        firsts: document.querySelector("#lb-me-row .lb-firsts").textContent,
        honor: document.querySelector("#lb-me-row .lb-honor").getAttribute("aria-label"),
        empty: document.querySelector(".lb-empty").textContent
      };
    """)
    assert actual == {
        "meText": "您还未上榜 · 0 个首发 · 共 0 位打工人 · 去合成一个没见过的元素吧！尚未获得首发星星",
        "firsts": "0 个首发",
        "honor": "尚未获得首发星星",
        "empty": "还没有首发，快去合成吧～",
    }


def test_wall_aggregates_large_first_honor_levels(tmp_path):
    actual = _run_wall(tmp_path, setup="""
window.__leaderboardPayload = {
  total_players: 1,
  me: null,
  top: [{ rank: 1, discoverer: "皇冠鹅", firsts: 1344 }]
};
""", probe="""
  var honor = document.querySelector(".lb-podium-card .lb-honor");
  return {
    aggregated: honor.classList.contains("aggregated"),
    items: Array.from(honor.querySelectorAll(".lb-honor-item"))
      .map(function (item) { return item.textContent; }),
    count: document.querySelector(".lb-podium-card .lb-firsts").textContent.trim()
  };
""")
    assert actual == {
        "aggregated": True,
        "items": ["👑 × 21"],
        "count": "1344 个首发",
    }


def test_wall_leaderboard_desktop_podium_layout(tmp_path):
    actual = _run_wall(
        tmp_path,
        setup=LEADERBOARD_SETUP,
        viewport=(1280, 900),
        probe="""
          var side = document.querySelector(".wall-side");
          var first = document.querySelector('.lb-podium-card[data-rank="1"]');
          var second = document.querySelector('.lb-podium-card[data-rank="2"]');
          var third = document.querySelector('.lb-podium-card[data-rank="3"]');
          var honor = first.querySelector(".lb-honor");
          var sideRect = side.getBoundingClientRect();
          var firstRect = first.getBoundingClientRect();
          var secondRect = second.getBoundingClientRect();
          var thirdRect = third.getBoundingClientRect();
          return {
            visualOrder: secondRect.left < firstRect.left && firstRect.left < thirdRect.left,
            firstRaised: firstRect.top < secondRect.top && firstRect.top < thirdRect.top,
            fiveColumns: getComputedStyle(honor).gridTemplateColumns.trim().split(/\\s+/).length,
            sideOverflow: side.scrollWidth > side.clientWidth,
            cardsInsideSide:
              secondRect.left >= sideRect.left &&
              thirdRect.right <= sideRect.right + 1
          };
        """,
    )
    assert actual == {
        "visualOrder": True,
        "firstRaised": True,
        "fiveColumns": 5,
        "sideOverflow": False,
        "cardsInsideSide": True,
    }


def test_wall_leaderboard_narrow_layout_has_no_horizontal_overflow(tmp_path):
    actual = _run_wall(
        tmp_path,
        setup=LEADERBOARD_SETUP,
        viewport=(390, 844),
        probe="""
          var side = document.querySelector(".wall-side");
          return {
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
            sideOverflow: side.scrollWidth > side.clientWidth,
            visibleCards: Array.from(document.querySelectorAll(".lb-podium-card"))
              .every(function (card) {
                var rect = card.getBoundingClientRect();
                return rect.width > 0 &&
                  rect.right <= side.getBoundingClientRect().right + 1;
              })
          };
        """,
    )
    assert actual == {
        "pageOverflow": False,
        "sideOverflow": False,
        "visibleCards": True,
    }
