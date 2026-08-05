"""
悬赏清单（Bounty List）——"首发墙"顶部图鉴的数据层。

与后端状态（Redis / seed_loader.store）交互只读，不写。
"""

from __future__ import annotations

from typing import Dict, List, Optional

from . import content_catalog

_BOUNTY = content_catalog.load_compiled_content()["bounty"]
TABS: List[Dict] = [dict(tab) for tab in _BOUNTY["tabs"]]
GROUPS: List[Dict] = [
    {**group, "targets": list(group["targets"])}
    for group in _BOUNTY["groups"]
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


def build_group(group_def: Dict, db_mod, store) -> dict:
    """
    按 group_def 的 generated targets 生成一个 group payload。
    emoji 优先从 seed_elements.json（store.elements）取，取不到就用 "❓"。
    未在 seed 里的目标词 → 以"尚未发现"占位显示。
    """
    cat = group_def["category"]
    items: List[dict] = []
    found = 0

    targets = group_def.get("targets", group_def.get("whitelist", []))
    for name in targets:
        info = store.elements.get(name) or {}
        emoji = info.get("emoji") or "❓"
        first_row, seq = _first_row_and_seq(db_mod, name)
        discovered = bool(first_row)
        if discovered:
            found += 1
        item = {
            "name": name,
            "emoji": emoji,
            "icon": info.get("icon"),
            "category": cat,
            "is_starter": False,
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
    for g in GROUPS:
        names.update(g.get("targets", []))
    return names
