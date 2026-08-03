"""
随机昵称生成器 —— 基于共享 THUOCL 快照 + 人工精选梗词池。

结构：<成语> + 的 + <状态词> + 鹅
示例："全力以赴的OKR鹅"、"坚定不移的代码审查鹅"、"心有灵犀的二哈鹅"

词库选择（有梗 / 幽默向 / 鹅厂强关联）：
- chengyu：4 字成语，做形容词前缀（过滤负面成语）
- IT：取高频 TOP 3000，和鹅厂强关联（字符串/初始化/字段/栈...）
- food：取高频 TOP 1500，自带喜感（土豆/火锅/螺蛳粉...）
- animal：取高频 TOP 1500，打工人共鸣（二哈/仓鼠/水母...）
- 精选梗词池 MEME_POOL：打工人黑话 / 鹅厂常用词，高权重注入

去重：已占用则追加 _<3位小写字母> 后缀。
"""

from __future__ import annotations

import json
import random
import string
from pathlib import Path
from typing import List

from . import db

_SHARED_DATA = Path(__file__).parent.parent / "shared" / "nickname-data.json"
_FALLBACK_CHENGYU = [
    "热情洋溢", "一本正经", "无所畏惧", "精神饱满",
    "坚定不移", "全力以赴", "心有灵犀", "目不转睛",
]
_FALLBACK_STATES = ["代码", "周报", "咖啡", "火锅"]

# ============================================================
# 人工精选梗词池（高权重，40% 几率从这抽）
# ============================================================
MEME_POOL = [
    # 鹅厂黑话
    "OKR", "KPI", "周报", "月报", "季报", "述职PPT", "TAPD",
    "P0", "P1", "活水", "瑞雪", "南极圈", "打工鹅", "赛马", "中台",
    "组织架构", "绩效3.5", "绩效3.75", "年终奖",
    "腾讯会议", "腾讯文档", "iWiki", "RTX",
    # 打工人梗
    "秃头", "黑眼圈", "班味", "摸鱼", "带薪摸鱼", "带薪拉屎",
    "007", "996", "画饼", "空头支票", "删库跑路",
    "发疯", "发癫", "破防", "显眼包", "松弛感",
    "已读不回", "已读乱回", "猝死",
    # 互联网黑话
    "闭环", "抓手", "颗粒度", "对齐", "赋能", "链路", "心智", "穿透",
    # 办公室
    "工位", "工牌", "打卡", "夜宵券", "咖啡", "美式", "奶茶",
    "外卖", "加班", "调休", "转岗", "离职", "述职",
    # 2026 年 4 月热梗
    "酱板鸭", "雪山狐狸", "人类丰容", "画饼可以直说", "老贝榨",
    "爱你老己", "我要验牌", "太湖三霸", "不做人", "SBTI",
    "吗喽", "颠颠上班", "过期酸奶", "松人", "紧人",
]

def _fallback_word_pools() -> tuple[List[str], List[str]]:
    return list(_FALLBACK_CHENGYU), list(_FALLBACK_STATES)


def _is_blank_word(value: str) -> bool:
    return all(char.isspace() or char == "\ufeff" for char in value)


def load_word_pools() -> tuple[List[str], List[str]]:
    """Load the committed nickname snapshot, or a minimal startup-safe fallback."""
    try:
        value = json.loads(_SHARED_DATA.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return _fallback_word_pools()

    if (
        not isinstance(value, dict)
        or set(value) != {"schema_version", "chengyu", "states"}
        or isinstance(value.get("schema_version"), bool)
        or value.get("schema_version") != 1
    ):
        return _fallback_word_pools()
    chengyu = value.get("chengyu")
    states = value.get("states")
    if (
        not isinstance(chengyu, list)
        or not isinstance(states, list)
        or not chengyu
        or not states
        or any(
            not isinstance(word, str) or _is_blank_word(word)
            for word in chengyu
        )
        or any(
            not isinstance(word, str) or _is_blank_word(word)
            for word in states
        )
    ):
        return _fallback_word_pools()
    return list(chengyu), list(states)


# ============================================================
# 运行时词库
# ============================================================
_CHENGYU: List[str] = []
_THUOCL_STATES: List[str] = []


def _ensure_loaded() -> None:
    global _CHENGYU, _THUOCL_STATES
    if _CHENGYU and _THUOCL_STATES:
        return

    _CHENGYU, _THUOCL_STATES = load_word_pools()


# ============================================================
# 生成
# ============================================================

# 精选池抽中概率
_MEME_WEIGHT = 0.4

_SUFFIX_POOL = string.ascii_lowercase


def _random_suffix(n: int = 3) -> str:
    return "".join(random.choices(_SUFFIX_POOL, k=n))


def _pick_state() -> str:
    """40% 从精选梗词池抽，60% 从 THUOCL 抽。"""
    if random.random() < _MEME_WEIGHT:
        return random.choice(MEME_POOL)
    return random.choice(_THUOCL_STATES)


def generate_one() -> str:
    """一个候选名字：<成语>的<状态>鹅"""
    _ensure_loaded()
    return f"{random.choice(_CHENGYU)}的{_pick_state()}鹅"


def generate_unique(max_tries: int = 30) -> str:
    """
    生成全局唯一昵称。
      1. 先尝试 10 次换词
      2. 若仍撞，固定 base，追加 _<3位字母> 后缀
      3. 极端兜底加长后缀
    """
    _ensure_loaded()
    for _ in range(10):
        name = generate_one()
        if db.claim_nickname(name):
            return name

    base = generate_one()
    for _ in range(max_tries):
        candidate = f"{base}_{_random_suffix(3)}"
        if db.claim_nickname(candidate):
            return candidate

    return f"{base}_{_random_suffix(6)}"


def stats() -> dict:
    """词库规模诊断。"""
    _ensure_loaded()
    return {
        "chengyu": len(_CHENGYU),
        "thuocl_states": len(_THUOCL_STATES),
        "meme_pool": len(MEME_POOL),
        "meme_weight": _MEME_WEIGHT,
        # 有效组合空间：40% × 精选 + 60% × THUOCL
        "effective_combo_space": len(_CHENGYU) * (
            len(MEME_POOL) + len(_THUOCL_STATES)
        ),
    }
