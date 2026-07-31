# Wall Leaderboard and Default Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bounty section initially collapsed, keep the first-discovery feed initially expanded, and replace the flat Top 20 list with a first-discovery podium and an independent first-honor level display.

**Architecture:** Keep `/api/wall/leaderboard` and its first-count ordering unchanged. Add one pure browser module that converts `firsts` into the independent base-four first-honor representation, then let `wall.js` build accessible podium/list DOM from that representation and `wall.css` own visual ordering and responsive layout.

**Tech Stack:** Vanilla HTML/CSS/JavaScript ES modules, Node.js built-in test runner, pytest with headless Chromium, existing Makers static build.

## Global Constraints

- Ranking remains first-count descending; ties remain nickname ascending as returned by the backend.
- The first-honor system is independent from `SCORE_LEVEL` and must never call `SCORE_LEVEL.rankFor`.
- `1 🌟 = 1 first`, `4 🌟 = 1 🌙`, `4 🌙 = 1 🌞`, and `4 🌞 = 1 👑`.
- Render at most 5 honor items per row and at most 4 rows; if the decomposed icon count exceeds 20, aggregate every nonzero tier as `icon × count`.
- Always show the exact metric as `N 个首发`.
- Do not modify the leaderboard API, backend storage, backend sorting, wall pagination, search, polling, bounty contents, or recipe modal.
- Preserve every unrelated working-tree and index change. Before editing `frontend/wall/index.html`, `frontend/wall/wall.js`, `frontend/wall/wall.css`, or `tests-makers/frontend.test.mjs`, inspect the existing diff and merge with it rather than replacing it.
- Treat every commit command below as conditional: record the baseline dirty paths before Task 1, and never commit a path that was already dirty at that baseline. If a task touches any baseline-dirty path, skip that task's commit and leave the feature changes visible for user review instead of absorbing pre-existing work into a commit.

---

## File Structure

- Create `frontend/wall/first-honor.js`: normalize first counts and return the independent first-honor counts, display items, aggregation state, and accessible label.
- Create `tests-makers/wall-honor.test.mjs`: unit coverage for base-four conversion, invalid inputs, the 20-icon boundary, and aggregation.
- Create `tests/test_wall_ui.py`: real-browser coverage for section defaults, saved preferences, leaderboard DOM, accessible text, visual podium order, and responsive overflow.
- Modify `frontend/wall/index.html`: make the no-JavaScript bounty markup initially collapsed to avoid a flash of expanded content.
- Modify `frontend/wall/wall.js`: accept per-section default collapse state, render current-player honor, create semantic podium/list DOM, and consume `firstHonorFor`.
- Modify `frontend/wall/wall.css`: style the current-player honor, podium, compact rows, five-column honor grid, aggregated tokens, and narrow layout.
- Modify `scripts/build-makers.mjs`: require the new browser module in build output.
- Modify `tests-makers/build.test.mjs`: verify `dist/wall/first-honor.js` exists.

---

### Task 1: Pure First-Honor Conversion

**Files:**
- Create: `frontend/wall/first-honor.js`
- Create: `tests-makers/wall-honor.test.mjs`
- Modify: `scripts/build-makers.mjs`
- Modify: `tests-makers/build.test.mjs`

**Interfaces:**
- Consumes: a raw first-count value accepted by `firstHonorFor(rawFirsts)`.
- Produces: `firstHonorFor(rawFirsts) -> { firsts, crowns, suns, moons, stars, iconCount, aggregated, displayItems, ariaLabel }`.
- `displayItems` entries have the exact shape `{ tier, icon, count, text }`.

- [ ] **Step 1: Write the failing conversion and aggregation tests**

Create `tests-makers/wall-honor.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { firstHonorFor } from "../frontend/wall/first-honor.js";

test("first honor uses direct base-four first counts", () => {
  for (const [firsts, expected] of [
    [0, { crowns: 0, suns: 0, moons: 0, stars: 0, icons: [] }],
    [1, { crowns: 0, suns: 0, moons: 0, stars: 1, icons: ["🌟"] }],
    [4, { crowns: 0, suns: 0, moons: 1, stars: 0, icons: ["🌙"] }],
    [16, { crowns: 0, suns: 1, moons: 0, stars: 0, icons: ["🌞"] }],
    [64, { crowns: 1, suns: 0, moons: 0, stars: 0, icons: ["👑"] }],
    [76, { crowns: 1, suns: 0, moons: 3, stars: 0, icons: ["👑", "🌙", "🌙", "🌙"] }],
  ]) {
    const honor = firstHonorFor(firsts);
    assert.deepEqual(
      {
        crowns: honor.crowns,
        suns: honor.suns,
        moons: honor.moons,
        stars: honor.stars,
        icons: honor.displayItems.map((item) => item.text),
      },
      expected,
    );
  }
});

test("first honor normalizes invalid counts to zero", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "not-a-number"]) {
    const honor = firstHonorFor(value);
    assert.equal(honor.firsts, 0);
    assert.equal(honor.ariaLabel, "尚未获得首发星星");
    assert.deepEqual(honor.displayItems, []);
  }
});

test("first honor shows twenty icons directly and aggregates above twenty", () => {
  const boundary = firstHonorFor(1_280);
  assert.equal(boundary.iconCount, 20);
  assert.equal(boundary.aggregated, false);
  assert.equal(boundary.displayItems.length, 20);
  assert.ok(boundary.displayItems.every((item) => item.text === "👑"));

  const overflow = firstHonorFor(1_344);
  assert.equal(overflow.iconCount, 21);
  assert.equal(overflow.aggregated, true);
  assert.deepEqual(overflow.displayItems, [
    { tier: "crowns", icon: "👑", count: 21, text: "👑 × 21" },
  ]);
  assert.equal(overflow.ariaLabel, "首发荣誉等级：21个皇冠");
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run:

```bash
node --test tests-makers/wall-honor.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frontend/wall/first-honor.js`.

- [ ] **Step 3: Implement the pure converter**

Create `frontend/wall/first-honor.js`:

```js
const MAX_DIRECT_ICONS = 20;
const TIERS = Object.freeze([
  { tier: "crowns", icon: "👑", label: "皇冠" },
  { tier: "suns", icon: "🌞", label: "太阳" },
  { tier: "moons", icon: "🌙", label: "月亮" },
  { tier: "stars", icon: "🌟", label: "首发星星" },
]);

function normalizeFirsts(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(numeric)));
}

export function firstHonorFor(rawFirsts) {
  const firsts = normalizeFirsts(rawFirsts);
  let remainder = firsts;
  const crowns = Math.floor(remainder / 64);
  remainder %= 64;
  const suns = Math.floor(remainder / 16);
  remainder %= 16;
  const moons = Math.floor(remainder / 4);
  const stars = remainder % 4;
  const counts = { crowns, suns, moons, stars };
  const iconCount = crowns + suns + moons + stars;
  const aggregated = iconCount > MAX_DIRECT_ICONS;
  const displayItems = [];

  for (const { tier, icon } of TIERS) {
    const count = counts[tier];
    if (!count) continue;
    if (aggregated) {
      displayItems.push({ tier, icon, count, text: `${icon} × ${count}` });
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      displayItems.push({ tier, icon, count: 1, text: icon });
    }
  }

  const labels = TIERS
    .filter(({ tier }) => counts[tier] > 0)
    .map(({ tier, label }) => `${counts[tier]}个${label}`);

  return {
    firsts,
    crowns,
    suns,
    moons,
    stars,
    iconCount,
    aggregated,
    displayItems,
    ariaLabel: labels.length
      ? `首发荣誉等级：${labels.join("、")}`
      : "尚未获得首发星星",
  };
}
```

- [ ] **Step 4: Add the module to build assertions**

Add `"wall/first-honor.js"` to `REQUIRED_ENTRIES` in
`scripts/build-makers.mjs`, immediately before `"wall/wall.js"`.

Add `"dist/wall/first-honor.js"` to `REQUIRED_FILES` in
`tests-makers/build.test.mjs`, immediately before `"dist/wall/polling.js"`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test tests-makers/wall-honor.test.mjs
```

Expected: 3 tests PASS.

Stage the new module before the committed-input build fixture runs:

```bash
git add frontend/wall/first-honor.js tests-makers/wall-honor.test.mjs scripts/build-makers.mjs tests-makers/build.test.mjs
node --test tests-makers/build.test.mjs
```

Expected: build tests PASS and `dist/wall/first-honor.js` is nonempty.

- [ ] **Step 6: Commit the converter**

```bash
git commit -m "feat: add first-discovery honor levels" -- frontend/wall/first-honor.js tests-makers/wall-honor.test.mjs scripts/build-makers.mjs tests-makers/build.test.mjs
```

---

### Task 2: Section Defaults and Saved Preferences

**Files:**
- Create: `tests/test_wall_ui.py`
- Modify: `frontend/wall/index.html:22-37`
- Modify: `frontend/wall/wall.js:805-850`
- Modify: `frontend/wall/wall.js:1019-1026`

**Interfaces:**
- Consumes: `localStorage["ic_wall_collapse_" + storageKey]`, where `"1"` means collapsed and `"0"` means expanded.
- Produces: `bindCollapsible(toggleId, bodyId, storageKey, defaultCollapsed = false)`.
- The persisted value always overrides `defaultCollapsed`.

- [ ] **Step 1: Create a browser harness and failing default-state tests**

Create `tests/test_wall_ui.py` with this real-browser harness. It uses the
production wall markup, styles, and scripts; the only doubles are the icon
renderer and HTTP boundary:

```python
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
```

Add these assertions:

```python
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
```

- [ ] **Step 2: Run the default-state tests and verify the first one fails**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
```

Expected: the first test FAILS because the bounty currently starts expanded.

- [ ] **Step 3: Make the static bounty markup collapsed**

In `frontend/wall/index.html`, change only the bounty header and body:

```html
<button type="button" class="section-header collapsible"
        id="bounty-toggle" aria-expanded="false">
  ...
</button>
<div class="section-body collapsed" id="bounty-body" style="max-height:0">
```

Leave the feed header `aria-expanded="true"` and `#feed-body` open.

- [ ] **Step 4: Add a per-section default to `bindCollapsible`**

Change the function and initial-state calculation in `wall.js`:

```js
function bindCollapsible(
  toggleId,
  bodyId,
  storageKey,
  defaultCollapsed = false,
) {
  // existing element lookup and saved-value read
  const startCollapsed =
    saved === null ? Boolean(defaultCollapsed) : saved === "1";
```

Make both initial branches fully normalize the static markup:

```js
if (startCollapsed) {
  body.classList.add("collapsed");
  btn.setAttribute("aria-expanded", "false");
  body.style.maxHeight = "0";
} else {
  body.classList.remove("collapsed");
  btn.setAttribute("aria-expanded", "true");
  body.style.maxHeight = "";
}
```

Update initialization:

```js
bindCollapsible("bounty-toggle", "bounty-body", "bounty", true);
bindCollapsible("feed-toggle", "feed-body", "feed", false);
```

- [ ] **Step 5: Run browser tests**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit section defaults**

```bash
git add tests/test_wall_ui.py frontend/wall/index.html frontend/wall/wall.js
git commit -m "feat: set wall section defaults" -- tests/test_wall_ui.py frontend/wall/index.html frontend/wall/wall.js
```

---

### Task 3: Accessible Podium and Compact Ranking DOM

**Files:**
- Modify: `tests/test_wall_ui.py`
- Modify: `frontend/wall/wall.js:12-13`
- Modify: `frontend/wall/wall.js:432-492`

**Interfaces:**
- Consumes: `firstHonorFor(row.firsts)` from Task 1 and unchanged leaderboard rows `{ rank, discoverer, firsts }`.
- Produces: `buildHonorLevel(rawFirsts, className = "") -> HTMLElement`.
- Produces: `buildRankingEntry(row, variant) -> HTMLElement`, where `variant` is `"podium"` or `"list"`.
- `renderTop(data)` emits `.lb-podium` followed by `.lb-ranking-rest`.

- [ ] **Step 1: Add failing DOM and accessibility tests**

Extend `tests/test_wall_ui.py` with a leaderboard payload containing ranks 1–4
and `me: { rank: 4, firsts: 4 }`:

```python
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
```

Add a second test with `top: []`, `me: null` and nickname set. Assert
`#lb-me-row` contains `尚未获得首发星星`, `.lb-honor[aria-label]` has the
same text, and `.lb-empty` still says `还没有首发`.

Add a third test with one row whose `firsts` is `1_344`. Its probe and assertion
must be:

```python
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
```

- [ ] **Step 2: Run the DOM tests and verify selectors are missing**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py::test_wall_renders_podium_rest_list_and_first_honor -q
```

Expected: FAIL because `.lb-podium-card` and `.lb-honor` do not exist.

- [ ] **Step 3: Import the first-honor converter and build honor DOM**

Add the import beside the existing wall module imports:

```js
import { firstHonorFor } from "./first-honor.js";
```

Add:

```js
function buildHonorLevel(rawFirsts, className = "") {
  const honor = firstHonorFor(rawFirsts);
  const level = node("div", `lb-honor${className ? ` ${className}` : ""}`);
  level.setAttribute("aria-label", honor.ariaLabel);
  level.classList.toggle("aggregated", honor.aggregated);
  for (const item of honor.displayItems) {
    const icon = node(
      "span",
      `lb-honor-item tier-${item.tier}${honor.aggregated ? " aggregated" : ""}`,
      item.text,
    );
    icon.setAttribute("aria-hidden", "true");
    level.append(icon);
  }
  if (!honor.displayItems.length) {
    level.append(node("span", "lb-honor-empty", "尚未获得首发星星"));
  }
  return level;
}
```

- [ ] **Step 4: Replace ambiguous current-player copy**

For a ranked player, build `lbMeRow` from a summary container plus honor:

```js
const summary = node("div", "lb-me-summary");
summary.append(
  document.createTextNode("您的排名："),
  node("b", "", `第 ${me.rank} 名`),
  document.createTextNode(" · "),
  node("span", "lb-firsts", `${firstHonorFor(me.firsts).firsts} 个首发`),
  document.createTextNode(` · 共 ${total_players} 位打工人`),
);
lbMeRow.replaceChildren(summary, buildHonorLevel(me.firsts, "lb-me-honor"));
```

For an unranked named player, keep the existing encouragement, then append
`buildHonorLevel(0, "lb-me-honor")`.

- [ ] **Step 5: Build podium and rest entries**

Create `buildRankingEntry` so all API text is assigned through `textContent`:

```js
function buildRankingEntry(row, variant) {
  const rank = Number(row?.rank) || 0;
  const discoverer = row?.discoverer || "匿名鹅";
  const firsts = firstHonorFor(row?.firsts).firsts;
  const entry = node(
    variant === "podium" ? "article" : "div",
    variant === "podium"
      ? `lb-podium-card rank-${rank}`
      : "lb-row",
  );
  entry.dataset.rank = String(rank);
  if (MY_NICK && discoverer === MY_NICK) entry.classList.add("me");
  entry.setAttribute("role", "listitem");

  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
  const rankNode = node("span", "lb-rank", medal);
  rankNode.setAttribute("aria-label", `第 ${rank} 名`);
  const name = node("span", "lb-name", discoverer);
  name.title = discoverer;
  const count = node("span", "lb-firsts", `${firsts} 个首发`);
  const honor = buildHonorLevel(firsts);

  entry.append(rankNode, name, count, honor);
  return entry;
}
```

Replace `renderTop` with:

```js
function renderTop(data) {
  const { top = [] } = data || {};
  lbListEl.replaceChildren();
  if (top.length === 0) {
    lbListEl.append(node("div", "lb-empty", "还没有首发，快去合成吧～"));
    return;
  }

  const podium = node("section", "lb-podium");
  podium.setAttribute("aria-label", "排行榜前三名");
  podium.setAttribute("role", "list");
  for (const row of top.slice(0, 3)) {
    podium.append(buildRankingEntry(row, "podium"));
  }

  const rest = node("div", "lb-ranking-rest");
  rest.setAttribute("role", "list");
  rest.setAttribute("aria-label", "排行榜第 4 至 20 名");
  for (const row of top.slice(3)) {
    rest.append(buildRankingEntry(row, "list"));
  }
  lbListEl.append(podium);
  if (rest.childElementCount) lbListEl.append(rest);
}
```

The DOM order remains rank 1, rank 2, rank 3; CSS performs only the visual
second-first-third arrangement.

- [ ] **Step 6: Run DOM tests**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
node --test tests-makers/wall-honor.test.mjs
```

Expected: all wall UI and honor tests PASS.

- [ ] **Step 7: Commit accessible leaderboard DOM**

```bash
git add tests/test_wall_ui.py frontend/wall/wall.js
git commit -m "feat: render first-discovery podium" -- tests/test_wall_ui.py frontend/wall/wall.js
```

---

### Task 4: Podium, Honor Grid, and Responsive Styling

**Files:**
- Modify: `tests/test_wall_ui.py`
- Modify: `frontend/wall/wall.css:670-795`

**Interfaces:**
- Consumes: Task 3 classes `.lb-podium`, `.lb-podium-card.rank-N`, `.lb-ranking-rest`, `.lb-firsts`, `.lb-honor`, `.lb-honor-item`, and `.aggregated`.
- Produces: visual order second-first-third while preserving DOM order first-second-third.

- [ ] **Step 1: Add failing desktop and narrow layout tests**

Use the existing `_run_wall(..., viewport=(width, height))` parameter for both
desktop and narrow runs.

At `1280 × 900`, probe real element rectangles and computed styles:

```js
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
```

Assert `visualOrder` and `firstRaised` are true, `fiveColumns == 5`,
`sideOverflow` is false, and `cardsInsideSide` is true.

At `390 × 844`, assert:

```js
return {
  pageOverflow: document.documentElement.scrollWidth > innerWidth,
  sideOverflow: side.scrollWidth > side.clientWidth,
  visibleCards: Array.from(document.querySelectorAll(".lb-podium-card"))
    .every(function (card) {
      var rect = card.getBoundingClientRect();
      return rect.width > 0 && rect.right <= side.getBoundingClientRect().right + 1;
    })
};
```

Expected values: both overflow fields false and `visibleCards` true.

- [ ] **Step 2: Run the new layout tests and verify they fail**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
```

Expected: layout tests FAIL because the podium and five-column honor layout
have no CSS yet.

- [ ] **Step 3: Replace the flat leaderboard styles**

Keep `.wall-side`, `.side-title`, `.lb-me-card`, scrollbar, and `.lb-empty`
foundations, then add:

```css
.lb-me-summary {
  line-height: 1.5;
}

.lb-firsts {
  color: #1E88E5;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.lb-honor {
  display: grid;
  grid-template-columns: repeat(5, 18px);
  gap: 4px;
  width: max-content;
  max-width: 100%;
  margin-top: 7px;
}

.lb-honor-item {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: #F5F7FA;
  font-size: 14px;
  line-height: 1;
}

.lb-honor.aggregated {
  grid-template-columns: repeat(2, max-content);
}

.lb-honor-item.aggregated {
  width: auto;
  min-width: 0;
  padding: 0 6px;
  color: #555;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.lb-honor-empty {
  grid-column: 1 / -1;
  width: max-content;
  color: #999;
  font-size: 11px;
}

.lb-podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
  padding: 18px 10px 12px;
  border-bottom: 1px solid #ECECEC;
}

.lb-podium-card {
  width: calc((100% - 12px) / 3);
  min-width: 0;
  padding: 10px 5px;
  display: grid;
  justify-items: center;
  border: 1px solid #E4E7EC;
  border-radius: 10px;
  background: #FFF;
}

.lb-podium-card.rank-1 {
  order: 2;
  transform: translateY(-8px);
  border-color: #E6C64F;
  background: linear-gradient(180deg, #FFF6C7, #FFF);
}

.lb-podium-card.rank-2 { order: 1; }
.lb-podium-card.rank-3 { order: 3; }

.lb-podium-card .lb-rank {
  font-size: 18px;
}

.lb-podium-card .lb-name {
  width: 100%;
  margin: 5px 0 3px;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-podium-card .lb-firsts {
  font-size: 10px;
}

.lb-podium-card .lb-honor {
  grid-template-columns: repeat(5, 14px);
  gap: 2px;
  justify-content: center;
}

.lb-podium-card .lb-honor.aggregated {
  grid-template-columns: max-content;
}

.lb-podium-card .lb-honor-item {
  width: 14px;
  height: 14px;
  font-size: 12px;
}

.lb-ranking-rest .lb-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border-bottom: 1px dashed #F0F0F0;
}

.lb-ranking-rest .lb-row > .lb-honor {
  grid-column: 2 / -1;
  margin-top: 0;
}
```

Retain the current-player highlight, adapting its selector from the old flat
row styles to `.lb-ranking-rest .lb-row.me`. Remove obsolete `.top1`,
`.top2`, `.top3`, `.lb-score`, and `.lb-score-suffix` rules.

- [ ] **Step 4: Add narrow-screen reductions**

Inside the existing `@media (max-width: 780px)` block add:

```css
.lb-podium {
  gap: 4px;
  padding-inline: 8px;
}

.lb-podium-card {
  width: calc((100% - 8px) / 3);
  padding-inline: 3px;
}

.lb-podium-card .lb-name {
  font-size: 11px;
}

.lb-podium-card .lb-honor {
  grid-template-columns: repeat(5, 13px);
}

.lb-podium-card .lb-honor-item {
  width: 13px;
  height: 13px;
  font-size: 11px;
}
```

Keep the existing mobile side placement and `max-height: 40vh`.

- [ ] **Step 5: Run layout and unit tests**

Run:

```bash
python3 -m pytest tests/test_wall_ui.py -q
node --test tests-makers/wall-honor.test.mjs
```

Expected: all tests PASS at both viewports.

- [ ] **Step 6: Commit leaderboard styling**

```bash
git add tests/test_wall_ui.py frontend/wall/wall.css
git commit -m "style: add wall leaderboard podium" -- tests/test_wall_ui.py frontend/wall/wall.css
```

---

### Task 5: Full Verification and Scope Audit

**Files:**
- Modify only if a verification failure identifies a defect in the files from Tasks 1–4.

**Interfaces:**
- Consumes: the finished wall UI and all repository tests.
- Produces: evidence that the implementation satisfies the design without backend changes.

- [ ] **Step 1: Confirm the backend and score system are untouched**

Run:

```bash
git diff --name-only b538494..HEAD
git diff b538494..HEAD -- frontend/score-level.js edge-functions/_lib/kpi.js backend/kpi.py edge-functions/_lib/kv-store.js backend/db.py
```

Expected: the first command lists this plan document plus the planned
frontend/test/build files; the second command has no output attributable to
this feature. Existing unrelated dirty changes must be identified separately
from feature commits.

- [ ] **Step 2: Run JavaScript tests**

Run:

```bash
npm test
```

Expected: all `tests-makers/*.test.mjs` tests PASS with zero failures.

- [ ] **Step 3: Run Python tests required by the repository**

Run:

```bash
python3 -m pytest tests --ignore=tests/test_combine_feedback.py -q
```

Expected: all collected tests PASS with zero failures.

- [ ] **Step 4: Build the static site**

Run:

```bash
npm run build
```

Expected: exit code 0 and `dist/wall/first-honor.js`,
`dist/wall/wall.js`, `dist/wall/wall.css`, and `dist/wall/index.html`
exist and are nonempty.

- [ ] **Step 5: Inspect the final UI at desktop and narrow widths**

Serve the normal local application according to `AGENTS.md`, open `/wall`, and
verify:

```text
Fresh storage: bounty collapsed, feed expanded
Saved storage: each section restores independently
Podium visual order: second, first, third
Podium DOM order: first, second, third
Every row: explicit “N 个首发”
76 firsts: 👑 🌙 🌙 🌙
1,344 firsts: 👑 × 21
Desktop and 390px viewport: no horizontal overflow
```

Stop the local application with `npm run dev:down`.

- [ ] **Step 6: Review commit scope**

Run:

```bash
git log --oneline b538494..HEAD
git status --short
```

Expected: zero to four feature commits from Tasks 1–4, depending on the
baseline-dirty-path rule. No commit may include unrelated user changes. Leave
all pre-existing unrelated worktree and index changes untouched.
