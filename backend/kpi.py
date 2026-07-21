"""
KPI 评分规则 + 绩效评级。
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
    """
    给一次合成评分。
    返回 (delta, reason) 便于写 kpi_events 表。
    """
    base = CHAIN_SCORE.get(chain or "", 5)
    bonus = FIRST_DISCOVERY_BONUS if is_first else 0
    parts = [f"{chain or 'default'} +{base}"]
    if is_first:
        parts.append(f"首发 +{bonus}")
    return base + bonus, " / ".join(parts)


# ============================================================
# 段位定义
# ============================================================
# 前 5 档是传统打工人绩效曲线。阈值设计目标：
#   - 一次深度 3 合成 (+90 分) 不会直接跳两档
#   - 到达"瑞雪"需要相当多合成（不像之前 1000 分瞬间到）
# 到达"瑞雪 ❄️" 后进入"祥瑞阶"（base-4 累加）
#   每 +STAR_STEP 分 = 累积一颗 🌟
#   4🌟=🌛 / 4🌛=🌞 / 4🌞=👑 / 4👑=暴雪领主

STAR_STEP = 800                              # 每颗 🌟 = 800 分（之前 200 太低）
MAX_STARS = 256                              # 4^4；再多一档就是暴雪领主
STAR_WEIGHTS = (("👑", 64), ("🌞", 16), ("🌛", 4), ("🌟", 1))  # 位权降序
SNOW_BASE = 8000                             # 瑞雪 floor
SNOW_LORD_FLOOR = SNOW_BASE + MAX_STARS * STAR_STEP  # 8000 + 204800 = 212800

# 基础 5 档（普通 KPI 曲线）
BASE_TIERS = [
    (0,     "3-",   "待改进",     "🔴", "班味不够浓，再拖几次。"),
    (500,   "3.25", "勉强合格",   "🟡", "有班味，但还能更疯。"),
    (1500,  "3.5",  "达标",       "🟢", "合格打工鹅。"),
    (3500,  "3.75", "优秀",       "🔵", "年终奖有了。"),
    (SNOW_BASE, "瑞雪", "瑞雪兆丰年", "❄️", "瑞雪 +1，建议转岗当产品。"),
]

# 瑞雪上面的"里程碑"档位（UI 右栏只列这几个，避免 256 行爆屏）
SNOW_MILESTONES = [
    (SNOW_BASE + 4  * STAR_STEP, "瑞雪🌛",   "月华如水",       "🌛", "四片瑞雪凝成一轮瑞月。"),
    (SNOW_BASE + 16 * STAR_STEP, "瑞雪🌞",   "日耀乾坤",       "🌞", "四轮瑞月聚成一颗瑞日。"),
    (SNOW_BASE + 64 * STAR_STEP, "瑞雪👑",   "加冕鹅王",       "👑", "四颗瑞日铸成一顶瑞冠。"),
    (SNOW_LORD_FLOOR,            "暴雪领主", "极地主宰鹅",     "🌨️", "四顶瑞冠凝成一场暴雪，极地鹅王即位。"),
]

# 对外兼容 API：TIERS = 里程碑合集
TIERS = BASE_TIERS + SNOW_MILESTONES
# 封顶后的虚拟下一档（供 UI 显示"距离下一档还差 N"）
VIRTUAL_NEXT_STEP = 100000


def _stars_to_symbols(n: int) -> str:
    """把 0..256 的 🌟 等价计数转成 '👑🌞🌛🌟' 组合后缀。"""
    out = []
    remaining = n
    for sym, weight in STAR_WEIGHTS:
        k, remaining = divmod(remaining, weight)
        if k > 0:
            out.append(sym * k)
    return "".join(out)


def _snow_tier_display(n_stars: int) -> tuple[str, str, str, str]:
    """n_stars: 0..MAX_STARS 返回 (grade, label, emoji, comment)。
    n_stars == 0 → 瑞雪 本体
    0 < n < MAX_STARS → 瑞雪 + 后缀
    n == MAX_STARS → 暴雪领主
    """
    if n_stars <= 0:
        base = BASE_TIERS[-1]  # 瑞雪
        return base[1], base[2], base[3], base[4]
    if n_stars >= MAX_STARS:
        m = SNOW_MILESTONES[-1]
        return m[1], m[2], m[3], m[4]
    suffix = _stars_to_symbols(n_stars)
    # 以最高位符号为主 emoji
    main_emoji = suffix[0] if suffix else "❄️"
    grade = "瑞雪" + suffix
    # label 按最高位取一个好听的
    if "👑" in suffix:
        label = "加冕鹅王"
    elif "🌞" in suffix:
        label = "日耀乾坤"
    elif "🌛" in suffix:
        label = "月华如水"
    else:
        label = "星光熠熠"
    comment = f"已累积 {n_stars} 颗瑞雪 🌟（4🌟=🌛，4🌛=🌞，4🌞=👑，4👑=暴雪领主）。"
    return grade, label, main_emoji, comment


def rank_for(total: int) -> dict:
    """当前段位 + 下一档阈值，供 UI 画进度。
    瑞雪以下走 BASE_TIERS；
    瑞雪以上走 base-4 累加（每 STAR_STEP 分 = 1🌟）。
    """
    # ---- 未到瑞雪：沿用基础段位 ----
    if total < BASE_TIERS[-1][0]:
        cur = BASE_TIERS[0]
        next_tier = None
        for i, t in enumerate(BASE_TIERS):
            if total >= t[0]:
                cur = t
                next_tier = BASE_TIERS[i + 1] if i + 1 < len(BASE_TIERS) else None
            else:
                break
        next_tier = next_tier or BASE_TIERS[-1]
        topped = False
        return {
            "grade": cur[1],
            "label": cur[2],
            "emoji": cur[3],
            "comment": cur[4],
            "floor": cur[0],
            "next_floor": next_tier[0],
            "next_grade": next_tier[1],
            "next_label": next_tier[2],
            "next_emoji": next_tier[3],
            "to_next": max(0, next_tier[0] - total),
            "topped": topped,
            "stars": 0,
            "max_stars": MAX_STARS,
            "star_step": STAR_STEP,
            "all_tiers": [
                {"floor": t[0], "grade": t[1], "label": t[2], "emoji": t[3]}
                for t in TIERS
            ],
        }

    # ---- 瑞雪及以上：按 🌟 累积 ----
    stars = min(MAX_STARS, (total - BASE_TIERS[-1][0]) // STAR_STEP)  # 0..MAX_STARS
    grade, label, emoji, comment = _snow_tier_display(stars)
    cur_floor = BASE_TIERS[-1][0] + stars * STAR_STEP

    if stars >= MAX_STARS:
        # 暴雪领主封顶 → 虚拟 +N
        topped = True
        overflow = total - SNOW_LORD_FLOOR
        cycles = overflow // VIRTUAL_NEXT_STEP + 1
        next_floor = SNOW_LORD_FLOOR + cycles * VIRTUAL_NEXT_STEP
        next_grade = f"暴雪领主+{cycles}"
        next_label = "雪上加霜"
        next_emoji = "🌨️"
    else:
        # 下一颗 🌟 / 里程碑
        next_stars = stars + 1
        n_grade, n_label, n_emoji, _ = _snow_tier_display(next_stars)
        next_floor = BASE_TIERS[-1][0] + next_stars * STAR_STEP
        next_grade = n_grade
        next_label = n_label
        next_emoji = n_emoji
        topped = False

    return {
        "grade": grade,
        "label": label,
        "emoji": emoji,
        "comment": comment,
        "floor": cur_floor,
        "next_floor": next_floor,
        "next_grade": next_grade,
        "next_label": next_label,
        "next_emoji": next_emoji,
        "to_next": max(0, next_floor - total),
        "topped": topped,
        "stars": stars,
        "max_stars": MAX_STARS,
        "star_step": STAR_STEP,
        "all_tiers": [
            {"floor": t[0], "grade": t[1], "label": t[2], "emoji": t[3]}
            for t in TIERS
        ],
    }


def should_explode(chain: str | None, result: str) -> bool:
    """危险组合触发 P0 爆炸动画。"""
    if chain == "easter_egg":
        return True
    danger_keywords = ("故障", "告警", "删库", "跑路", "猝死")
    return any(k in result for k in danger_keywords)
