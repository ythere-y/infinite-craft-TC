"""
Redis 存储层。
Key 约定：
  combo:{key}           Hash {result, emoji, source, chain, ts}
  first:{result}        Hash {emoji, discoverer, ts}
  first_index           Sorted Set  member=result  score=ts        （首发榜）
  kpi:{session_id}      Counter
  kpi_log:{session_id}  List of JSON {delta, reason, ts}          （可选审计）
  nick:{name}           占位 key，存在即已被占用
  nick_index            Set（可选，用于 dump 所有已用昵称）

key = sorted([a, b]).join(" + ")  保证交换律。
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional, Dict, List

import redis

from . import archive

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:16739/0")

# decode_responses=True 让我们收到 str 而非 bytes
_r: Optional[redis.Redis] = None


def get_client() -> redis.Redis:
    global _r
    if _r is None:
        _r = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=5)
        _r.ping()
    return _r


def normalize_key(a: str, b: str) -> str:
    return " + ".join(sorted([a.strip(), b.strip()]))


def init_db() -> None:
    """启动自检 + 建 SQLite 表。"""
    try:
        c = get_client()
        c.ping()
        print("[redis] connected")
    except Exception as e:
        raise RuntimeError(f"Redis 连接失败: {type(e).__name__}") from e
    archive.init_archive()


# ============================================================
# combinations
# ============================================================
def _combo_key(key: str) -> str:
    return f"combo:{key}"


def get_cached(key: str) -> Optional[Dict]:
    data = get_client().hgetall(_combo_key(key))
    if not data or "result" not in data:
        return None
    return data


def put_cache(key: str, result: str, emoji: str, source: str, chain: Optional[str] = None) -> None:
    c = get_client()
    # 防御：Redis HSET 不接受 None 值，所有字段一律强制转成 str（空串兜底）
    payload = {
        "result": str(result) if result is not None else "",
        "emoji":  str(emoji)  if emoji  is not None else "❓",
        "source": str(source) if source is not None else "seed",
        "chain":  str(chain)  if chain  is not None else "",
        "ts": f"{time.time():.3f}",
    }
    # 若已存在则不覆盖（保留最早落库的 source，避免 LLM 结果覆盖 seed）
    if not c.exists(_combo_key(key)):
        c.hset(_combo_key(key), mapping=payload)
    # 双写 SQLite（冷副本 / 真相源）
    archive.upsert_combination(key, result, emoji, source, chain, increment_hit=False)


def put_cache_force(key: str, result: str, emoji: str, source: str, chain: Optional[str] = None) -> None:
    """强制覆盖版本（仅用于手工运维）。"""
    c = get_client()
    c.hset(_combo_key(key), mapping={
        "result": result, "emoji": emoji, "source": source,
        "chain": chain or "", "ts": f"{time.time():.3f}",
    })
    archive.upsert_combination(key, result, emoji, source, chain, increment_hit=False)


def touch_hit(key: str) -> None:
    """缓存命中时 +1 热度（只打 archive，Redis 不需要）。"""
    archive.upsert_combination(
        key=key, result="", emoji="", source="",
        chain=None, increment_hit=True,
    )


# ============================================================
# first discovery
# ============================================================
def record_first(result: str, emoji: str, discoverer: str) -> bool:
    """返回 True 表示新记录成功（即 first）。"""
    c = get_client()
    ts = time.time()
    # HSETNX 原子性：key 已存在则整个 hash 不创建
    created = c.hsetnx(f"first:{result}", "discoverer", discoverer)
    if not created:
        return False
    # 补其他字段 + 加入 ZSET
    c.hset(f"first:{result}", mapping={"emoji": emoji, "ts": f"{ts:.3f}"})
    c.zadd("first_index", {result: ts})
    # 双写 SQLite
    archive.record_first_archive(result, emoji, discoverer, ts)
    return True


def get_first(result: str) -> Optional[Dict]:
    data = get_client().hgetall(f"first:{result}")
    if not data:
        return None
    data["result"] = result
    return data


def recent_firsts(limit: int = 50, offset: int = 0) -> List[Dict]:
    """按 ts DESC 返回首发条目（支持 offset/limit 分页）。
    每条附加 seq 字段：全局序号 = 按 ts 升序中的位置 + 1（从 1 开始）。
    """
    c = get_client()
    total = int(c.zcard("first_index") or 0)
    start = max(0, offset)
    stop = start + max(1, limit) - 1
    names_with_ts = c.zrevrange("first_index", start, stop, withscores=True)
    out: List[Dict] = []
    # offset 位置在 "按 ts 升序" 的坐标：total - 1 - offset, 依次递减
    base_seq_desc = total - start  # 第一条的 seq（按升序编号后的值）
    for i, (name, ts) in enumerate(names_with_ts):
        h = c.hgetall(f"first:{name}")
        if not h:
            continue
        out.append({
            "result": name,
            "emoji": h.get("emoji", "❓"),
            "discoverer": h.get("discoverer", "匿名鹅"),
            "ts": float(h.get("ts", ts)),
            "seq": base_seq_desc - i,   # 越早发现 seq 越小
        })
    return out


def firsts_total() -> int:
    """已登记的首发总数。"""
    try:
        return int(get_client().zcard("first_index"))
    except Exception:
        return 0


def leaderboard(limit: int = 20, me: Optional[str] = None) -> Dict:
    """
    玩家排行榜：按首发次数从多到少。
    实现：扫 first_index 拿到所有 result，pipeline 取 discoverer 做内存聚合。
    在分享现场的量级（数千条）下完全够用，避免在 Redis 里再维护一张榜。
    返回：
      {
        top: [{rank, discoverer, firsts}, ...],     # 最多 limit 条
        total_players: int,
        me: {rank, firsts} | null,                   # 若 me 提供且有上榜
      }
    """
    c = get_client()
    names = c.zrange("first_index", 0, -1)
    if not names:
        return {"top": [], "total_players": 0, "me": None}

    counts: Dict[str, int] = {}
    pipe = c.pipeline()
    for n in names:
        pipe.hget(f"first:{n}", "discoverer")
    discoverers = pipe.execute()
    for d in discoverers:
        if not d:
            continue
        counts[d] = counts.get(d, 0) + 1

    # 排序：次数降序，再按昵称升序（稳定）
    ranking = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    top: List[Dict] = [
        {"rank": i + 1, "discoverer": name, "firsts": n}
        for i, (name, n) in enumerate(ranking[:limit])
    ]

    me_info = None
    if me:
        for i, (name, n) in enumerate(ranking):
            if name == me:
                me_info = {"rank": i + 1, "firsts": n}
                break

    return {"top": top, "total_players": len(ranking), "me": me_info}


def recent_result_names(limit: int = 30) -> List[str]:
    """
    取最近一批首发的 result 名字，作为 avoid_words 传给 GLM。
    既避免重复，又能让模型知道已经造过哪些词。
    """
    c = get_client()
    names = c.zrevrange("first_index", 0, limit - 1)
    return list(names)


# ============================================================
# KPI
# ============================================================
def kpi_add(session_id: str, delta: int, reason: str) -> None:
    c = get_client()
    pipe = c.pipeline()
    pipe.incrby(f"kpi:{session_id}", delta)
    pipe.rpush(f"kpi_log:{session_id}", json.dumps({
        "delta": delta, "reason": reason, "ts": time.time()
    }, ensure_ascii=False))
    pipe.expire(f"kpi_log:{session_id}", 7 * 24 * 3600)  # 一周后过期
    pipe.execute()
    # 双写 SQLite（永久保留，便于复盘）
    archive.kpi_archive(session_id, delta, reason)


def kpi_total(session_id: str) -> int:
    v = get_client().get(f"kpi:{session_id}")
    return int(v) if v else 0


# ============================================================
# nicknames
# ============================================================
def claim_nickname(name: str) -> bool:
    """尝试占用昵称。已存在返回 False。"""
    # SETNX：不存在才 set
    ok = get_client().setnx(f"nick:{name}", "1")
    if ok:
        get_client().sadd("nick_index", name)
        archive.nickname_archive(name)
    return bool(ok)


# ============================================================
# 启动预热：SQLite → Redis
# ============================================================
def warm_up_from_archive() -> dict:
    """
    启动时从 SQLite 恢复所有历史数据到 Redis。
    幂等（Redis 已有的 key 不会被覆盖）。
    """
    stats = {"combos": 0, "firsts": 0, "nicks": 0}
    c = get_client()

    for row in archive.all_combinations():
        key = row["key"]
        if not c.exists(_combo_key(key)):
            c.hset(_combo_key(key), mapping={
                "result": row["result"], "emoji": row["emoji"],
                "source": row["source"], "chain": row["chain"] or "",
                "ts": f"{time.time():.3f}",
            })
            stats["combos"] += 1

    for row in archive.all_firsts():
        if not c.exists(f"first:{row['result']}"):
            c.hset(f"first:{row['result']}", mapping={
                "emoji": row["emoji"], "discoverer": row["discoverer"],
                "ts": f"{row['ts']:.3f}",
            })
            c.zadd("first_index", {row["result"]: row["ts"]})
            stats["firsts"] += 1

    for name in archive.all_nicknames():
        if not c.exists(f"nick:{name}"):
            c.set(f"nick:{name}", "1")
            c.sadd("nick_index", name)
            stats["nicks"] += 1

    return stats
