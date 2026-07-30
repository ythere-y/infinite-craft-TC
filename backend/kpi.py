"""
分数规则。
规则 chain 对应分值，首发加分，用于现场"打工人共鸣指数"。
"""

CHAIN_SCORE = {
    "tencent":       30,
    "meme_2026w16":  25,
    "meme_classic":  20,
    "worker":        20,
    "bizspeak":      15,
    "easter_egg":    40,   # 彩蛋组合高分，鼓励挖掘
    "classic":        5,
    "physical":       5,
    "life":           8,
    "abstract":      10,
}

FIRST_DISCOVERY_BONUS = 50


def score_for(chain: str | None, is_first: bool) -> tuple[int, str]:
    """给一次合成分数，返回便于写分数事件表的 (delta, reason)。"""
    base = CHAIN_SCORE.get(chain or "", 5)
    bonus = FIRST_DISCOVERY_BONUS if is_first else 0
    parts = [f"{chain or 'default'} +{base}"]
    if is_first:
        parts.append(f"首发 +{bonus}")
    return base + bonus, " / ".join(parts)


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


def should_explode(chain: str | None, result: str) -> bool:
    """危险组合触发 P0 爆炸动画。"""
    if chain == "easter_egg":
        return True
    danger_keywords = ("故障", "告警", "删库", "跑路", "猝死")
    return any(k in result for k in danger_keywords)
