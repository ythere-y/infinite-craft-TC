### Task 1: Replace finite performance tiers with unlimited score-level domains

**Files:**
- Modify: `backend/kpi.py`
- Modify: `edge-functions/_lib/kpi.js`
- Modify: `tests/test_kpi.py`
- Modify: `tests-makers/domain.test.mjs`

**Interfaces:**
- Produces Python `level_threshold(units: int) -> int`.
- Produces Python `rank_for(total: int) -> dict`.
- Produces Edge `levelThreshold(units: number) -> number`.
- Produces Edge `rankFor(total: number) -> LevelRank`.
- `LevelRank` keys are `level_units`, `crowns`, `suns`, `moons`, `stars`, `icons`, `aria_label`, `progress`, `grade`, `emoji`, and `topped`.
- Preserves `score_for`/`scoreFor` and `should_explode`/`shouldExplode` unchanged.

- [ ] **Step 1: Replace the Python rank test with boundary and monotonicity tests**

```python
from backend import kpi


def test_score_level_uses_linear_star_costs_and_base_four_icons():
    assert kpi.level_threshold(0) == 0
    assert kpi.level_threshold(1) == 300
    assert kpi.level_threshold(4) == 1_320
    assert kpi.level_threshold(16) == 7_200
    assert kpi.level_threshold(64) == 59_520
    assert kpi.level_threshold(128) == 200_960

    assert kpi.rank_for(0)["icons"] == ""
    assert kpi.rank_for(300)["icons"] == "🌟"
    assert kpi.rank_for(1_320)["icons"] == "🌙"
    assert kpi.rank_for(7_200)["icons"] == "🌞"
    assert kpi.rank_for(59_520)["icons"] == "👑"
    assert kpi.rank_for(61_100)["icons"] == "👑🌟"
    assert kpi.rank_for(200_960)["icons"] == "👑👑"


def test_score_level_boundaries_are_exact_and_unlimited():
    for units in (1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024):
        floor = kpi.level_threshold(units)
        assert kpi.rank_for(floor - 1)["level_units"] == units - 1
        rank = kpi.rank_for(floor)
        assert rank["level_units"] == units
        assert rank["topped"] is False
        assert rank["progress"] == 0


def test_each_new_star_costs_more_than_the_previous_star():
    costs = [
        kpi.level_threshold(units) - kpi.level_threshold(units - 1)
        for units in range(1, 200)
    ]
    assert all(left < right for left, right in zip(costs, costs[1:]))


def test_invalid_scores_normalize_to_zero():
    assert kpi.rank_for(-1) == kpi.rank_for(0)
```

- [ ] **Step 2: Replace the Edge rank test with the same contract**

```js
import {
  levelThreshold,
  rankFor,
  scoreFor,
  shouldExplode,
} from "../edge-functions/_lib/kpi.js";

test("score level uses increasing star costs and unlimited base-four icons", () => {
  assert.equal(levelThreshold(0), 0);
  assert.equal(levelThreshold(1), 300);
  assert.equal(levelThreshold(4), 1_320);
  assert.equal(levelThreshold(16), 7_200);
  assert.equal(levelThreshold(64), 59_520);
  assert.equal(levelThreshold(128), 200_960);
  assert.equal(rankFor(300).icons, "🌟");
  assert.equal(rankFor(1_320).icons, "🌙");
  assert.equal(rankFor(7_200).icons, "🌞");
  assert.equal(rankFor(59_520).icons, "👑");
  assert.equal(rankFor(200_960).icons, "👑👑");
});

test("score-level boundaries do not cap at crowns", () => {
  for (const units of [1, 4, 16, 64, 65, 128, 1024]) {
    const floor = levelThreshold(units);
    assert.equal(rankFor(floor - 1).level_units, units - 1);
    assert.equal(rankFor(floor).level_units, units);
    assert.equal(rankFor(floor).progress, 0);
    assert.equal(rankFor(floor).topped, false);
  }
});
```

- [ ] **Step 3: Run the focused tests and confirm the old finite implementation fails**

Run:

```bash
python3 -m pytest tests/test_kpi.py -q
node --test tests-makers/domain.test.mjs
```

Expected: failures because `level_threshold`/`levelThreshold` do not exist and old ranks still contain绩效/瑞雪 tiers.

- [ ] **Step 4: Implement the Python integer-safe level model**

Replace the tier constants and rank helpers in `backend/kpi.py` with:

```python
BASE_STAR_COST = 300
STAR_COST_STEP = 20
MERGE_BASE = 4
LEVEL_WEIGHTS = (("👑", 64), ("🌞", 16), ("🌙", 4), ("🌟", 1))


def level_threshold(units: int) -> int:
    value = max(0, int(units))
    return value * BASE_STAR_COST + STAR_COST_STEP * value * (value - 1) // 2


def _level_units(total: int) -> int:
    score = max(0, int(total))
    low, high = 0, 1
    while level_threshold(high) <= score:
        high *= 2
    while low + 1 < high:
        middle = (low + high) // 2
        if level_threshold(middle) <= score:
            low = middle
        else:
            high = middle
    return low


def _breakdown(units: int) -> tuple[int, int, int, int, str]:
    remaining = units
    counts: list[int] = []
    icons: list[str] = []
    for icon, weight in LEVEL_WEIGHTS:
        count, remaining = divmod(remaining, weight)
        counts.append(count)
        if count:
            icons.append(icon * count)
    return counts[0], counts[1], counts[2], counts[3], "".join(icons)


def rank_for(total: int) -> dict:
    score = max(0, int(total))
    units = _level_units(score)
    crowns, suns, moons, stars, icons = _breakdown(units)
    floor = level_threshold(units)
    ceiling = level_threshold(units + 1)
    progress = (score - floor) / max(1, ceiling - floor)
    labels = [
        f"{crowns}个皇冠" if crowns else "",
        f"{suns}个太阳" if suns else "",
        f"{moons}个月亮" if moons else "",
        f"{stars}颗星星" if stars else "",
    ]
    aria_label = "、".join(label for label in labels if label) or "尚未获得星星"
    return {
        "level_units": units,
        "crowns": crowns,
        "suns": suns,
        "moons": moons,
        "stars": stars,
        "icons": icons,
        "aria_label": aria_label,
        "progress": progress,
        "grade": icons or "尚未获得星星",
        "emoji": icons[:1] or "🌟",
        "topped": False,
    }
```

Keep `CHAIN_SCORE`, `FIRST_DISCOVERY_BONUS`, `score_for`, and `should_explode` intact, changing only their module comments from “KPI” to “分数” where they describe the feature.

- [ ] **Step 5: Mirror the model in Edge JavaScript**

Replace finite tier constants and helpers in `edge-functions/_lib/kpi.js` with:

```js
export const BASE_STAR_COST = 300;
export const STAR_COST_STEP = 20;
export const MERGE_BASE = 4;
export const LEVEL_ICONS = Object.freeze(["👑", "🌞", "🌙", "🌟"]);

export function levelThreshold(rawUnits) {
  const units = Math.max(0, Math.trunc(Number(rawUnits) || 0));
  return units * BASE_STAR_COST
    + (STAR_COST_STEP * units * (units - 1)) / 2;
}

function levelUnits(score) {
  let low = 0;
  let high = 1;
  while (levelThreshold(high) <= score) high *= 2;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (levelThreshold(middle) <= score) low = middle;
    else high = middle;
  }
  return low;
}

export function rankFor(rawTotal) {
  const score = Math.max(0, Math.trunc(Number(rawTotal) || 0));
  const units = levelUnits(score);
  let remaining = units;
  const crowns = Math.floor(remaining / 64);
  remaining %= 64;
  const suns = Math.floor(remaining / 16);
  remaining %= 16;
  const moons = Math.floor(remaining / 4);
  const stars = remaining % 4;
  const icons = "👑".repeat(crowns)
    + "🌞".repeat(suns) + "🌙".repeat(moons) + "🌟".repeat(stars);
  const floor = levelThreshold(units);
  const ceiling = levelThreshold(units + 1);
  const labels = [
    crowns ? `${crowns}个皇冠` : "",
    suns ? `${suns}个太阳` : "",
    moons ? `${moons}个月亮` : "",
    stars ? `${stars}颗星星` : "",
  ].filter(Boolean);
  return {
    level_units: units,
    crowns,
    suns,
    moons,
    stars,
    icons,
    aria_label: labels.join("、") || "尚未获得星星",
    progress: (score - floor) / Math.max(1, ceiling - floor),
    grade: icons || "尚未获得星星",
    emoji: icons[0] || "🌟",
    topped: false,
  };
}
```

Clamp Edge input to `Number.MAX_SAFE_INTEGER` before threshold search if a larger numeric input arrives. Keep `scoreFor` and `shouldExplode` behavior unchanged.

- [ ] **Step 6: Run both domain suites**

Run:

```bash
python3 -m pytest tests/test_kpi.py -q
node --test tests-makers/domain.test.mjs
```

Expected: all tests pass, including existing scoring and explosion assertions.

- [ ] **Step 7: Commit only the domain files**

```bash
git add backend/kpi.py edge-functions/_lib/kpi.js tests/test_kpi.py tests-makers/domain.test.mjs
git commit -m "feat: add unlimited score levels"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated pre-existing path without changing its working-tree contents.

---
