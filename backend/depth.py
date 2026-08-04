"""
元素合成深度（depth）算法。

定义：
- starter 元素 depth = 0
- 对每条合成规则 A + B → R：candidate_depth(R) = max(depth(A), depth(B)) + 1
- 一个元素可能被多条规则合成出来，取所有候选中的最小值作为它的真实 depth

分值：
- score = 10 * depth * depth
- starter 的 score = 0（没有花任何合成）
- 玩家首次合成该元素：获得全分
- 玩家再次合成已知元素：获得 1/10 分（向下取整，至少 1）

存储：
- Redis Hash "element_depth"  field=元素名  value=depth(整数字符串)
- 启动时：用经过校验的严格 compiled depth map 原子替换
- 运行时：每次 combine 成功后增量更新 result 的 depth（若更短）

读取：
- get_depth(name) 查 Redis；显式 starter 在预热表中为 0；未知返回 None
- score_for(depth, known_to_player) 计算分数
"""

from __future__ import annotations

import math
from typing import Dict, Optional

from . import content_catalog, db

_DEPTH_KEY = "element_depth"

# ============================================================
# 读写
# ============================================================

def set_depth(name: str, depth: int) -> None:
    db.get_client().hset(_DEPTH_KEY, name, str(int(depth)))


def get_depth(name: str) -> Optional[int]:
    v = db.get_client().hget(_DEPTH_KEY, name)
    return int(v) if v is not None else None


def try_shorten_depth(name: str, candidate: int) -> int:
    """
    如果 candidate 比当前 depth 小（或当前没 depth），则更新。
    返回最终的 depth。
    """
    cur = get_depth(name)
    if cur is None or candidate < cur:
        set_depth(name, candidate)
        return candidate
    return cur


def all_depths() -> Dict[str, int]:
    raw = db.get_client().hgetall(_DEPTH_KEY)
    return {k: int(v) for k, v in raw.items()}


# ============================================================
# 运行时：AI / 缓存命中后增量更新
# ============================================================

def update_on_combine(a: str, b: str, result: str) -> int:
    """
    一次合成结束后调用：
      candidate = max(depth(a), depth(b)) + 1
      如果某个输入没 depth（新 AI 元素链条中间）就跳过本次更新
    返回 result 的最终 depth（可能是老的也可能是新的）。
    """
    da = get_depth(a)
    db_ = get_depth(b)
    if da is None or db_ is None:
        # 无法推导；保持 result 原 depth（或 None）
        cur = get_depth(result)
        return cur if cur is not None else _fallback_unknown_depth()
    candidate = max(da, db_) + 1
    return try_shorten_depth(result, candidate)


def _fallback_unknown_depth() -> int:
    """当完全无法推导时，给一个保守的"中等难度"值，避免 0 分尴尬。"""
    return 3


# ============================================================
# 分数计算
# ============================================================

def score_for(depth: Optional[int], known_to_player: bool) -> int:
    """
    给一个元素打分。
      未知（首次发现）→ 全分 = 10 * d * d
      已知（再次合成）→ 1/10 分，至少 1 分（避免完全没反馈）
      starter（depth=0）→ 0 分（不鼓励反复拖 starter 刷分）
    """
    if depth is None:
        depth = _fallback_unknown_depth()
    full = 10 * depth * depth
    if full <= 0:
        return 0
    if known_to_player:
        return max(1, full // 10)
    return full


# ============================================================
# 启动预热：读取并替换严格 compiled depth
# ============================================================

def _load_seed():
    """读取 seed，返回 (starter 名字集合, [(a, b, result), ...])。"""
    data = content_catalog.load_compiled_content()
    starters = {s["name"] for s in data["starters"]}
    rules = []
    for raw_key, info in data["combinations"].items():
        parts = [p.strip() for p in raw_key.split("+")]
        if len(parts) != 2:
            continue
        a, b = parts
        r = info.get("result")
        if not r:
            continue
        rules.append((a, b, r))
    return starters, rules


def warm_up_from_seed() -> Dict[str, int]:
    """Replace Redis depth state with the exact compiled strict depth map."""
    depth = dict(content_catalog.load_compiled_content()["depths"])
    client = db.get_client()
    pipe = client.pipeline()
    pipe.delete(_DEPTH_KEY)
    if depth:
        pipe.hset(_DEPTH_KEY, mapping={k: str(v) for k, v in depth.items()})
    pipe.execute()
    return depth


# ============================================================
# 诊断
# ============================================================

def summary() -> Dict:
    d = all_depths()
    if not d:
        return {"total": 0}
    by_level: Dict[int, int] = {}
    for v in d.values():
        by_level[v] = by_level.get(v, 0) + 1
    return {
        "total": len(d),
        "max_depth": max(d.values()),
        "min_depth": min(d.values()),
        "by_level": dict(sorted(by_level.items())),
        "sample_hard": sorted(d.items(), key=lambda x: -x[1])[:10],
    }
