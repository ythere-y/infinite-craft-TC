"""
悬赏清单（Bounty List）——"首发墙"顶部图鉴的数据层。

只筛选**与腾讯强相关**的词，其他 seed 里的通用词（例如"漫画""电脑""地图"）不进悬赏榜。
扩词时：
- 想加新悬赏词 → 在对应分组的 WHITELIST 里加。
- 想新增 tab / 子分组 → 改 TABS / GROUPS。

与后端状态（Redis / seed_loader.store）交互只读，不写。
"""

from __future__ import annotations

from typing import Dict, List, Optional


# ============================================================
# Tab 定义（父层级）——目前只留"鹅厂生态"一个 tab
# ============================================================
TABS: List[Dict] = [
    {"key": "tencent", "label": "鹅厂生态", "emoji": "🐧"},
]


# ============================================================
# 名人堂：腾讯 1998 年成立时的五位创始人
#
# ⚠️ 花名（alias）准确性备注：
#   - "Pony"   —— 100% 确认（马化腾本人公开使用超过 20 年）
#   - 其余四位的花名来自公开资料，**使用前建议再核实**；有错改这里即可。
# 任一"花名 / 真名"被首发过即视为该创始人被发现
# ============================================================
HALL_OF_FAME: List[Dict] = [
    {
        "real": "马化腾",
        "alias": "Pony",
        "emoji": "🐎",
        "title": "创始人 · 董事会主席兼 CEO",
    },
    {"real": "张志东", "alias": "Tony", "emoji": "💻", "title": "创始人 · 首任 CTO"},
    {
        "real": "许晨晔",
        "alias": "Daniel",
        "emoji": "📡",
        "title": "创始人 · 首席信息官 (CIO)",
    },
    {
        "real": "陈一丹",
        "alias": "Charles",
        "emoji": "📜",
        "title": "创始人 · 首席行政官 (CAO)",
    },
    {
        "real": "曾李青",
        "alias": "Jason",
        "emoji": "🚀",
        "title": "创始人 · 首席运营官 (COO)",
    },
]


# ============================================================
# 各子分组定义
#
# category: 对应 seed_elements.json 里的 category key（用于从 store.elements 读 emoji/is_starter）
# label / emoji / tab: 显示用
# whitelist: 这个分组里允许展示的元素名（**强相关于腾讯**的白名单）
#            —— 未在 whitelist 的 seed 词不会出现在悬赏清单中。
#            —— whitelist 里有，但 seed 里没有的，也会作为"占位"显示（从下面 extras dict 拿 emoji）。
# extras: 白名单里的词若不在 seed 里，给一个兜底 emoji（可选）
# ============================================================
GROUPS: List[Dict] = [
    # 🐧 鹅厂文化 —— 内部独有名词
    {
        "category": "tencent",
        "label": "鹅厂文化",
        "emoji": "🐧",
        "tab": "tencent",
        "whitelist": [
            "企鹅",
            "鹅厂",
            "工牌",
            "电梯",
            "打卡",
            "掌纹",
            "iWiki",
            "RTX",
            "乐享",
            "鹅卡",
            "食堂",
            "鹅餐",
            "班车",
            "健身房",
            "按摩椅",
            "小马哥",
            "南极圈",
            "活水",
            "瑞雪",
            "赛马",
            "中台",
            "TAPD",
            "腾讯会议",
            "腾讯文档",
            "微信",
            "QQ",
            "朋友圈",
            "视频号",
            "组织架构调整",
            # 鹅厂内的生活梗
            "烤企鹅",
            "打工鹅",
            "续命鹅",
            "鹅咖",
            "鹅式小憩",
            "爆料",
            "水帖",
            "道别贴",
            "深夜食堂",
            "工位食堂",
            "免费午餐",
            "带薪养生",
            "带薪健身",
            "午间撸铁",
            "早会",
            "晨会",
            "周会",
            "周会纪要",
            "虚拟背景",
            "静音挂机",
            "黑屏挂机",
            "背景音",
            "多人编辑打架",
            "文档不同步",
            "@所有人",
            "全员信",
            "排队堵梯",
            "尴尬同框",
            "最后一班",
            "晚班",
            "通勤睡眠",
            "程序员床位",
            "灯火通明",
            # BG 缩写
            "IEG",
            "WXG",
            "CSIG",
            "PCG",
            "TEG",
            "CDG",
        ],
    },
    # 📦 腾讯产品线 —— 必须是"腾讯/鹅/QQ/微信"前缀的产品 or 业内公认的鹅厂旗舰游戏
    {
        "category": "product",
        "label": "腾讯产品线",
        "emoji": "📦",
        "tab": "tencent",
        "whitelist": [
            # QQ 系
            "QQ",
            "QQ邮箱",
            "QQ音乐",
            "QQ浏览器",
            "QQ空间",
            "TIM",
            # 微信系
            "微信",
            "企业微信",
            "微云",
            "公众号",
            "小程序",
            "微信支付",
            "微视",
            "红包",
            # 视频/内容
            "腾讯视频",
            "腾讯新闻",
            "腾讯体育",
            "腾讯动漫",
            "阅文集团",
            # 音乐
            "TME",
            "全民K歌",
            "腾讯音乐娱乐",
            # 云/工具
            "腾讯云",
            "腾讯会议",
            "腾讯文档",
            "应用宝",
            "电脑管家",
            "CODING",
            "腾讯地图",
            "腾讯翻译君",
            "混元大模型",
            "元宝",
            "CodeBuddy",
            "WorkBuddy",
            "AnyDev",
            "Wedata",
            "ima.copilot",
            "腾讯企点",
            "CDC",
            # 游戏
            "王者荣耀",
            "和平精英",
            "英雄联盟",
            "英雄联盟手游",
            "金铲铲",
            "穿越火线",
            "DNF",
            "火影忍者手游",
            "元梦之星",
            "PUBG",
            "Valorant",
            "欢乐斗地主",
            "欢乐麻将",
        ],
    },
    # 🎮 游戏工作室 —— 必须是鹅厂旗下或已被鹅厂收购
    {
        "category": "studio",
        "label": "游戏工作室",
        "emoji": "🎮",
        "tab": "tencent",
        "whitelist": [
            "天美",
            "光子",
            "魔方",
            "北极光",
            "量子",
            "极光",
            "波士顿",
            "拳头",
            "Riot",
            "Supercell",
            "Epic",
        ],
    },
    # 🏢 办公楼/园区 —— 必须是鹅厂自有/主租用办公场所
    {
        "category": "building",
        "label": "办公楼/园区",
        "emoji": "🏢",
        "tab": "tencent",
        "whitelist": [
            "腾讯大厦",
            "滨海大厦",
            "鹅厂双子塔",
            "T1塔楼",
            "琶洲新总部",
            "科兴科学园",
            "TIT创意园",
            "微信总部",
            "北京总部",
            "上海总部",
            "成都办公楼",
            "金地威新",
        ],
    },
    # 🎖️ 职级 —— 鹅厂特有的 族体系 + 职位阶梯（不展示具体 T 档）
    {
        "category": "level",
        "label": "职级体系",
        "emoji": "🎖️",
        "tab": "tencent",
        "whitelist": [
            "T族",
            "P族",
            "M族",
            "S族",
            "应届生",
            "实习生",
            "正式员工",
            "外包",
            "专家",
            "总监",
            "VP",
        ],
    },
    # 💼 被投公司 —— 鹅厂公开披露的战略投资/并购
    {
        "category": "invest",
        "label": "被投公司",
        "emoji": "💼",
        "tab": "tencent",
        "whitelist": [
            "拼多多",
            "美团",
            "快手",
            "B站",
            "京东",
            "知乎",
            "蔚来",
            "小红书",
            "Riot",
            "99公益日",
        ],
    },
]


# ============================================================
# 数据构造
# ============================================================


def _first_row_and_seq(db_mod, name: str):
    """返回 (first_row, seq) —— first_row 来自 Redis first:{name}，seq = zrank + 1。"""
    first_row = db_mod.get_first(name)
    seq = None
    if first_row:
        try:
            c = db_mod.get_client()
            rank = c.zrank("first_index", name)
            seq = (rank + 1) if rank is not None else None
        except Exception:
            seq = None
    return first_row, seq


def _fill_discovery(item: dict, first_row: Optional[dict], seq: Optional[int]) -> dict:
    """把首发元信息（发现者 / 时间戳 / seq）写进 item。"""
    if not first_row:
        return item
    item["discoverer"] = first_row.get("discoverer")
    ts = first_row.get("ts")
    try:
        item["ts"] = float(ts) if ts is not None else None
    except (TypeError, ValueError):
        item["ts"] = None
    if seq is not None:
        item["seq"] = seq
    return item


def build_hall_of_fame(db_mod) -> dict:
    """名人堂 payload：5 位创始人，真名或花名任一被首发即算发现。

    返回的每个 item 会带 real / alias / title 三个字段，供前端分开排版。
    `name` 字段保留作兼容（= "真名 · 花名"）。
    """
    items: List[dict] = []
    found = 0
    for person in HALL_OF_FAME:
        hit_name = None
        first_row = None
        seq = None
        for candidate in (person["real"], person["alias"]):
            row, s = _first_row_and_seq(db_mod, candidate)
            if row:
                hit_name = candidate
                first_row = row
                seq = s
                break
        discovered = bool(first_row)
        if discovered:
            found += 1
        item = {
            "name": f'{person["real"]} · {person["alias"]}',
            "real": person["real"],
            "alias": person["alias"],
            "title": person.get("title", ""),
            "emoji": person["emoji"],
            "category": "boss",
            "is_starter": False,
            "discovered": discovered,
        }
        _fill_discovery(item, first_row, seq)
        if hit_name:
            item["hit_as"] = hit_name
        items.append(item)

    return {
        "category": "boss",
        "label": "角色",
        "emoji": "🏛️",
        "tab": "tencent",
        "total": len(HALL_OF_FAME),
        "found": found,
        "items": items,
    }


def build_group(group_def: Dict, db_mod, store) -> dict:
    """
    按 group_def 的 whitelist 生成一个 group payload。
    emoji 优先从 seed_elements.json（store.elements）取，取不到就用 "❓"。
    未在 seed 里的白名单词 → 以"尚未发现"占位显示。
    """
    cat = group_def["category"]
    starter_names = {s["name"] for s in store.starters if s.get("category") == cat}
    items: List[dict] = []
    found = 0

    for name in group_def.get("whitelist", []):
        info = store.elements.get(name) or {}
        emoji = info.get("emoji") or "❓"
        is_starter = name in starter_names
        first_row, seq = _first_row_and_seq(db_mod, name)
        discovered = bool(first_row) or is_starter
        if discovered:
            found += 1
        item = {
            "name": name,
            "emoji": emoji,
            "category": cat,
            "is_starter": is_starter,
            "discovered": discovered,
        }
        _fill_discovery(item, first_row, seq)
        items.append(item)

    return {
        "category": cat,
        "label": group_def["label"],
        "emoji": group_def["emoji"],
        "tab": group_def["tab"],
        "total": len(items),
        "found": found,
        "items": items,
    }


def build_bounty(db_mod, store) -> dict:
    """
    返回完整悬赏清单 payload。
    {
      tabs: [{key, label, emoji, total, found}, ...],
      groups: [{category, label, emoji, tab, total, found, items: [...]}, ...],
      total, found
    }
    """
    groups: List[dict] = []
    # 名人堂置顶
    groups.append(build_hall_of_fame(db_mod))
    # 其余白名单分组
    for g in GROUPS:
        groups.append(build_group(g, db_mod, store))

    # tab 聚合
    tab_stats = {t["key"]: {"total": 0, "found": 0} for t in TABS}
    for g in groups:
        tkey = g.get("tab")
        if tkey and tkey in tab_stats:
            tab_stats[tkey]["total"] += g["total"]
            tab_stats[tkey]["found"] += g["found"]

    tabs = [
        {
            **t,
            "total": tab_stats[t["key"]]["total"],
            "found": tab_stats[t["key"]]["found"],
        }
        for t in TABS
    ]

    total = sum(g["total"] for g in groups)
    found = sum(g["found"] for g in groups)
    return {"tabs": tabs, "groups": groups, "total": total, "found": found}


def all_whitelisted_names() -> set:
    """供 SSE 判断一条新首发是否属于悬赏清单。"""
    names: set = set()
    for person in HALL_OF_FAME:
        names.add(person["real"])
        names.add(person["alias"])
    for g in GROUPS:
        names.update(g.get("whitelist", []))
    return names
