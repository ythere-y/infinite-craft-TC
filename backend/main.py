"""
FastAPI 主入口。
路由：
  GET  /                  → frontend/index.html
  GET  /wall              → frontend/wall.html
  GET  /api/starters      → 8 个 starter
  GET  /api/elements      → 当前全部元素
  POST /api/combine       → 合成（seed/cache miss 时接 LLM）
  GET  /api/wall/stream   → SSE 首发推送（M4）
  POST /api/session/kpi   → 上报 KPI（M4）
  GET  /api/session/{sid}/rank → 绩效评级（M4）
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
import uuid
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, kpi, archive, depth as depth_mod, bounty as bounty_mod
from .seed_loader import store
from .nickname import generate_unique, stats as nickname_stats

# ---- app bootstrap ----
app = FastAPI(title="Infinity Craft · 鹅厂打工人版", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@app.on_event("startup")
async def _startup() -> None:
    db.init_db()  # 连 Redis + 建 SQLite 表
    # 1) 从 SQLite 恢复历史数据到 Redis（重启不丢 AI 生成的长尾）
    warm = db.warm_up_from_archive()
    print(
        f"[warmup] restored from SQLite: combos={warm['combos']} firsts={warm['firsts']} nicks={warm['nicks']}"
    )
    # 2) 加载 seed（会补齐 SQLite 没有的那些）
    n_el, n_warmed = store.load()
    # 3) 计算元素深度（合成分数用）
    depth_table = depth_mod.warm_up_from_seed()
    env = os.environ.get("APP_ENV", "dev")
    redis_configured = "yes" if os.environ.get("REDIS_URL") else "default"
    print(f"[env] APP_ENV={env}  REDIS_URL={redis_configured}")
    print(f"[sqlite] archive path: {archive.db_path_str()}")
    print(f"[seed] loaded {n_el} elements, warmed {n_warmed} seed combinations")
    print(
        f"[depth] computed {len(depth_table)} elements, "
        f"max depth = {max(depth_table.values()) if depth_table else 0}"
    )
    # 首发事件广播队列
    app.state.first_queue: asyncio.Queue = asyncio.Queue()


# ============================================================
# Schemas
# ============================================================
class CombineReq(BaseModel):
    a: str
    b: str
    discoverer: Optional[str] = "匿名鹅"
    session_id: Optional[str] = "default"


class CombineResp(BaseModel):
    a: str
    b: str
    result: str
    emoji: str
    source: str  # seed | llm | fallback
    chain: Optional[str] = None
    is_first: bool = False
    discoverer: Optional[str] = None
    explode: bool = False
    # 旧 KPI（保留兼容，但推荐用 depth/full_score）
    kpi_delta: int = 0
    kpi_reason: str = ""
    # 新加分系统：depth 合成难度 + full_score（玩家未知时应得分）
    # 前端自己判断是否"玩家已知"：已知给 full_score // 10，未知给 full_score
    depth: int = 0
    full_score: int = 0


class KPIReq(BaseModel):
    session_id: str
    delta: int
    reason: str


# ============================================================
# API
# ============================================================
@app.get("/api/tiers")
async def api_tiers():
    """前端用于检测段位跃迁、渲染进度条。和 kpi.TIERS 保持一致。"""
    return {
        "tiers": [
            {
                "floor": t[0],
                "grade": t[1],
                "label": t[2],
                "emoji": t[3],
                "comment": t[4],
            }
            for t in kpi.TIERS
        ]
    }


@app.get("/api/starters")
async def api_starters():
    return {"starters": store.starters}


@app.get("/api/health")
async def api_health():
    """Report dependencies and LLM configuration without billing a model call."""
    from .llm import configuration_status

    out = {
        "redis": "?",
        "llm": configuration_status(),
        "redis_dbsize": 0,
        "sqlite": archive.db_path_str(),
        "app_env": os.environ.get("APP_ENV", "dev"),
    }
    try:
        c = db.get_client()
        c.ping()
        out["redis"] = "ok"
        out["redis_dbsize"] = c.dbsize()
    except Exception as exc:
        out["redis"] = f"error: {type(exc).__name__}"
    return out


# ---- SQL 分析（分享后复盘）----
@app.get("/api/analytics/chains")
async def api_analytics_chains(limit: int = 10):
    return {"items": archive.top_chains(limit)}


@app.get("/api/analytics/discoverers")
async def api_analytics_discoverers(limit: int = 10):
    return {"items": archive.top_discoverers(limit)}


@app.get("/api/analytics/combinations")
async def api_analytics_combinations(limit: int = 20):
    return {"items": archive.top_combinations(limit)}


# ============================================================
# Admin 监控（无鉴权，只监听 localhost / 内网。生产可加 token）
# ============================================================
@app.get("/api/admin/stats")
async def api_admin_stats():
    """后台监控：实时活跃、累计合成、Top 榜单、最近首发。"""
    c = db.get_client()
    now_ts = int(time.time())

    # 活跃 session（5 分钟滑动）
    active_keys = list(c.scan_iter(match="active:*", count=500))
    active_sessions = len(active_keys)

    # 累计合成调用
    total_calls_raw = c.get("stats:combine_calls")
    total_calls = int(total_calls_raw) if total_calls_raw else 0

    # 最近 1 分钟 / 5 分钟 / 60 分钟 的调用量
    def window_count(sec: int) -> int:
        return int(c.zcount("stats:calls_ts", now_ts - sec, now_ts))

    calls_1m = window_count(60)
    calls_5m = window_count(300)
    calls_60m = window_count(3600)

    # 每分钟时间序列（最近 30 分钟）
    # 关键：按整分钟对齐（:00 ~ :59 秒为一格），而不是"当前时刻往前数 60 秒"
    # 否则每次请求都会重新切一次刻度，bar 会看起来随机闪动。
    # 当前分钟 bucket_start = now_ts - (now_ts % 60)
    bucket_end = now_ts - (now_ts % 60)  # 当前整分钟起点
    timeseries = []
    for i in range(29, -1, -1):
        t_start = bucket_end - i * 60  # 该分钟的起点
        t_end = t_start + 60  # 该分钟的终点（不含）
        # zcount 包含两端，这里用 t_end - 1 避免跨分钟重复计数
        count = int(c.zcount("stats:calls_ts", t_start, t_end - 1))
        timeseries.append(
            {
                "ts": t_start,  # 用分钟起点做时间戳，UI 显示"HH:MM"
                "count": count,
            }
        )

    # 24 小时时间序列（每小时一格，整点对齐）
    # 数据源：stats:calls_hourly sorted set，每次 combine 把"当前整点 ts"
    # 作为 member 的一部分，member 唯一但 score = 该 hour 起点
    # 简化：直接从 stats:calls_ts 里 zcount 也行，但 stats:calls_ts 只保留 1h。
    # 所以专门维护 stats:calls_ts_day，保留 25h，足够画 24h
    hour_end = now_ts - (now_ts % 3600)  # 当前整点起点
    timeseries_24h = []
    for i in range(23, -1, -1):
        t_start = hour_end - i * 3600
        t_end = t_start + 3600
        count = int(c.zcount("stats:calls_ts_day", t_start, t_end - 1))
        timeseries_24h.append(
            {
                "ts": t_start,
                "count": count,
            }
        )

    # 昵称总数（nick:* key 数）
    nick_count = sum(1 for _ in c.scan_iter(match="nick:*", count=500))

    # 首发总数
    firsts_total = int(c.zcard("first_index") or 0)

    # Top 10 首发玩家
    lb = db.leaderboard(limit=10)
    top_discoverers = lb["top"]

    # Top 10 热门合成（从 SQLite archive 拿）
    top_combos = archive.top_combinations(10)

    # Top 10 chain 分布
    top_chains = archive.top_chains(10)

    # 最近 15 条首发
    recent_firsts = db.recent_firsts(limit=15)

    return {
        "now": now_ts,
        "env": os.environ.get("APP_ENV", "dev"),
        "active_sessions": active_sessions,
        "nick_count": nick_count,
        "firsts_total": firsts_total,
        "total_calls": total_calls,
        "calls_1m": calls_1m,
        "calls_5m": calls_5m,
        "calls_60m": calls_60m,
        "timeseries_30m": timeseries,
        "timeseries_24h": timeseries_24h,
        "top_discoverers": top_discoverers,
        "top_combinations": top_combos,
        "top_chains": top_chains,
        "recent_firsts": recent_firsts,
    }


@app.get("/admin")
async def admin_page():
    """后台监控页，返回静态 HTML。"""
    return FileResponse(FRONTEND_DIR / "admin" / "index.html")


@app.get("/api/nickname")
async def api_nickname():
    """分配一个全局唯一的随机昵称（成语+状态+鹅），同时立刻占位。"""
    return {"nickname": generate_unique()}


@app.get("/api/nickname/peek")
async def api_nickname_peek():
    """生成一个候选名字但不占位（用于改名界面的预览随机）。
    注意：多次调用返回的名字可能最终被别人抢占。
    最终确认时应该再调 /api/nickname/claim。"""
    from .nickname import generate_one

    return {"nickname": generate_one()}


class NickClaimReq(BaseModel):
    nickname: str


@app.post("/api/nickname/claim")
async def api_nickname_claim(req: NickClaimReq):
    """确认占用某个名字。若已被占用则分配一个新的。"""
    ok = db.claim_nickname(req.nickname)
    if ok:
        return {"ok": True, "nickname": req.nickname}
    # 被抢了 → 现场重新生成一个
    fresh = generate_unique()
    return {"ok": False, "nickname": fresh, "reason": "已被占用，已重抽一个"}


@app.post("/api/nickname/touch")
async def api_nickname_touch(req: NickClaimReq):
    """幂等的"补登记"：如果 nick:<name> 不在服务端（服务端清过数据、
    或本地 localStorage 留存的旧名字从未在当前 Redis 登记过），就补上。
    已存在则无副作用。这个端点不会把名字换掉，即使有人抢占了同名字，
    仍然返回本地想要的那个（只影响 admin 统计精度，不影响玩家体验）。"""
    name = (req.nickname or "").strip()
    if not name:
        return {"ok": False}
    c = db.get_client()
    created = bool(c.setnx(f"nick:{name}", "1"))
    return {"ok": True, "nickname": name, "created": created}


@app.get("/api/nickname/stats")
async def api_nickname_stats():
    """词库规模诊断。"""
    return nickname_stats()


@app.get("/api/elements")
async def api_elements():
    return {"elements": store.elements}


@app.post("/api/combine", response_model=CombineResp)
async def api_combine(req: CombineReq):
    request_id = uuid.uuid4().hex[:12]
    started = time.perf_counter()
    a, b = req.a.strip(), req.b.strip()
    if not a or not b:
        raise HTTPException(400, "a/b 不能为空")
    print(
        f"[combine] event=request_started request_id={request_id} "
        f"a={a[:40]!r} b={b[:40]!r}",
        flush=True,
    )

    # 监控打点：活跃 session + 合成总次数 + 时间序列
    try:
        c = db.get_client()
        sid = (req.session_id or "anon").strip() or "anon"
        # 5 分钟滑动活跃
        c.setex(f"active:{sid}", 300, "1")
        # 累计调用计数
        c.incr("stats:combine_calls")
        # 最近 60 分钟的调用时间点（sorted set）
        now_ts = int(time.time())
        c.zadd("stats:calls_ts", {f"{now_ts}:{sid}:{random.random()}": now_ts})
        c.zremrangebyscore("stats:calls_ts", 0, now_ts - 3600)
        # 最近 25 小时（给 24h 折线图用）
        c.zadd("stats:calls_ts_day", {f"{now_ts}:{sid}:{random.random()}": now_ts})
        c.zremrangebyscore("stats:calls_ts_day", 0, now_ts - 25 * 3600)
        # 补登记 discoverer（防止旧 localStorage 昵称没在服务端注册过，
        # 影响 admin 的"在册花名"统计）
        d_name = (req.discoverer or "").strip()
        if d_name:
            c.setnx(f"nick:{d_name}", "1")
    except Exception as exc:
        print(
            f"[combine] event=metrics_failed request_id={request_id} "
            f"error_type={type(exc).__name__}",
            flush=True,
        )

    key = db.normalize_key(a, b)

    # 1. Redis 缓存查询（含 seed 预热数据 + 历史 AI 结果）
    hit = db.get_cached(key)
    print(
        f"[combine] event=cache_{'hit' if hit else 'miss'} " f"request_id={request_id}",
        flush=True,
    )

    # 2. miss → 默认走 LLM
    if not hit:
        hit = await _combine_via_llm(a, b, request_id)

    # 3. 彻底失败 → fallback
    if not hit:
        hit = {"result": "未知产物", "emoji": "❓", "source": "fallback", "chain": None}

    result = hit["result"]
    emoji = hit["emoji"]
    chain = hit.get("chain") or None
    source = hit.get("source", "seed")

    # 4. 首发记录
    #    说明：即使 source == "seed"（缓存命中预设配方），只要 first:{result} 在 Redis 中
    #    尚不存在，当前玩家就是这个预设词的"第一个实际合成出来"的人，应被记为首发。
    #    record_first() 用 HSETNX 原子化，保证同一结果只有一个 discoverer。
    #    禁止把 "seed" / "system" / 空字符串当成 discoverer 塞进去——这是一道防守栏杆。
    is_first = False
    discoverer = None
    if source != "fallback":
        who = (req.discoverer or "").strip()
        if who.lower() in {"", "seed", "system", "匿名鹅"} or not who:
            who = "匿名鹅"
        is_first = db.record_first(result, emoji, who)
        if is_first:
            queue: asyncio.Queue = app.state.first_queue
            await queue.put(
                {
                    "result": result,
                    "emoji": emoji,
                    "discoverer": who,
                }
            )
        row = db.get_first(result)
        discoverer = row["discoverer"] if row else None

    # 5. result 纳入 elements + 归档到 SQLite
    if result not in store.elements and source != "fallback":
        store.elements[result] = {"emoji": emoji, "category": chain or "ai"}
        archive.upsert_element(
            name=result, emoji=emoji, category=chain, is_starter=False
        )

    # 6. KPI（保留旧 chain 打分）
    delta, reason = kpi.score_for(chain, is_first)
    if source != "fallback":
        db.kpi_add(req.session_id or "default", delta, reason)

    # 7. 合成难度 depth 与分值
    if source != "fallback":
        depth_val = depth_mod.update_on_combine(a, b, result)
    else:
        depth_val = 0
    full_score = 10 * depth_val * depth_val

    explode = kpi.should_explode(chain, result)

    elapsed_ms = round((time.perf_counter() - started) * 1000)
    print(
        f"[combine] event=request_completed request_id={request_id} "
        f"elapsed_ms={elapsed_ms} source={source} result={result[:40]!r}",
        flush=True,
    )

    return CombineResp(
        a=a,
        b=b,
        result=result,
        emoji=emoji,
        source=source,
        chain=chain,
        is_first=is_first,
        discoverer=discoverer,
        explode=explode,
        kpi_delta=delta if source != "fallback" else 0,
        kpi_reason=reason,
        depth=depth_val,
        full_score=full_score,
    )


async def _combine_via_llm(a: str, b: str, request_id: str) -> Optional[dict]:
    """seed/cache miss 后调 LLM，成功则落 Redis。"""
    started = time.perf_counter()
    try:
        from .prompt import combine_via_llm
    except Exception as exc:
        print(
            f"[combine] event=llm_import_failed request_id={request_id} "
            f"error_type={type(exc).__name__}",
            flush=True,
        )
        return None
    # 传入最近的 30 个 result 作为 avoid_words，减少撞词
    avoid = db.recent_result_names(30)
    print(
        f"[combine] event=llm_started request_id={request_id} "
        f"avoid_words={len(avoid)}",
        flush=True,
    )
    result = await asyncio.to_thread(
        combine_via_llm,
        a,
        b,
        avoid,
        request_id=request_id,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    if not result:
        print(
            f"[combine] event=llm_no_result request_id={request_id} "
            f"elapsed_ms={elapsed_ms}",
            flush=True,
        )
        return None
    key = db.normalize_key(a, b)
    db.put_cache(
        key=key, result=result["name"], emoji=result["emoji"], source="llm", chain=None
    )
    print(
        f"[combine] event=llm_succeeded request_id={request_id} "
        f"elapsed_ms={elapsed_ms}",
        flush=True,
    )
    return {
        "result": result["name"],
        "emoji": result["emoji"],
        "source": "llm",
        "chain": None,
    }


# ---- KPI ----
@app.post("/api/session/kpi")
async def api_kpi(req: KPIReq):
    db.kpi_add(req.session_id, req.delta, req.reason)
    return {"ok": True, "total": db.kpi_total(req.session_id)}


# ============================================================
# 配方导入合法性校验（P0）
# ============================================================
class VerifyReq(BaseModel):
    recipes: list  # [{a, b, result, emoji, ...}]


@app.post("/api/recipes/verify")
async def api_recipes_verify(req: VerifyReq):
    """
    校验玩家导入的配方是否与全球配方表一致。
    返回：
      valid:   [{a,b,result,emoji}]      — 跟全球库完全一致的
      invalid: [{a,b,expected,got,reason}] — 不一致的（可能被篡改）
      unknown: [{a,b}]                   — 全球库里还没有这对组合（可能是旧导出）
    只接受 valid 的条目，另两类前端会告知用户被拒绝的数量。
    """
    valid, invalid, unknown = [], [], []
    for r in req.recipes or []:
        a = (r.get("a") or "").strip()
        b = (r.get("b") or "").strip()
        result = (r.get("result") or "").strip()
        emoji = (r.get("emoji") or "").strip()
        if not a or not b or not result:
            invalid.append({"a": a, "b": b, "reason": "缺少必填字段"})
            continue

        key = db.normalize_key(a, b)
        hit = db.get_cached(key)
        if not hit:
            unknown.append({"a": a, "b": b})
            continue

        if hit["result"] != result:
            invalid.append(
                {
                    "a": a,
                    "b": b,
                    "expected": hit["result"],
                    "got": result,
                    "reason": "result 与全球配方不一致",
                }
            )
            continue

        # emoji 不强制一致（全球可能后来改过），用全球的
        valid.append(
            {
                "a": a,
                "b": b,
                "result": hit["result"],
                "emoji": hit["emoji"],
            }
        )

    return {
        "valid": valid,
        "invalid": invalid,
        "unknown": unknown,
        "total_input": len(req.recipes or []),
    }


@app.get("/api/session/{sid}/rank")
async def api_rank(sid: str):
    total = db.kpi_total(sid)
    return {"session_id": sid, "total": total, **kpi.rank_for(total)}


@app.get("/api/rank")
async def api_rank_for_total(total: int = 0):
    """给定累计分数，返回对应段位。前端用它来按 state.kpi 正确显示段位。
    和 /api/session/{sid}/rank 的区别：不依赖 Redis 里的 session total，
    让前端完全掌握积分来源（depth-based），避免和后端 chain 评分不一致。"""
    total = max(0, int(total))
    return {"total": total, **kpi.rank_for(total)}


# ---- 首发墙 SSE ----
@app.get("/api/wall/stream")
async def api_wall_stream(skip_history: int = 0):
    """
    SSE 推送新首发事件。
    - skip_history=0（默认，兼容旧前端）：先回放最近 20 条历史，再推增量
    - skip_history=1（新版首发墙）：只推增量；历史由 /api/wall/page 分页拉
    """
    from sse_starlette.sse import EventSourceResponse

    async def gen():
        if not skip_history:
            for row in reversed(db.recent_firsts(limit=20)):
                yield {"event": "first", "data": json.dumps(row, ensure_ascii=False)}
        queue: asyncio.Queue = app.state.first_queue
        while True:
            item = await queue.get()
            yield {"event": "first", "data": json.dumps(item, ensure_ascii=False)}

    return EventSourceResponse(gen())


@app.get("/api/wall/recent")
async def api_wall_recent(limit: int = 50):
    return {"items": db.recent_firsts(limit=limit)}


@app.get("/api/wall/page")
async def api_wall_page(offset: int = 0, limit: int = 100):
    """
    首发墙分页接口：按 ts DESC（最新首发在前）分页返回。
    - offset: 从第几条开始（0-based）
    - limit:  本页条数，默认 100，最大 500
    - 返回 total / has_more 供前端判断是否还有下一页
    """
    offset = max(0, int(offset))
    limit = max(1, min(500, int(limit)))
    items = db.recent_firsts(limit=limit, offset=offset)
    total = db.firsts_total()
    return {
        "items": items,
        "offset": offset,
        "limit": limit,
        "total": total,
        "has_more": offset + len(items) < total,
    }


@app.get("/api/wall/leaderboard")
async def api_wall_leaderboard(limit: int = 20, me: Optional[str] = None):
    """
    玩家排行榜：按首发数量降序。
    - limit: top 几名（最大 100）
    - me:    当前用户昵称（可选）；若提供则额外返回其排名
    """
    limit = max(1, min(100, int(limit)))
    return db.leaderboard(limit=limit, me=me)


@app.get("/api/wall/category/{category}")
async def api_wall_category(category: str):
    """
    单分类的 helper 接口（按 seed_elements.json 全量返回，不经白名单过滤）。
    - starter（种子元素）：始终视为已"发现"
    - 非 starter：看是否已经被人首发过
    这是底层调试接口。前端页面统一用 /api/wall/bounty。
    """
    cat = (category or "").strip()
    if not cat:
        raise HTTPException(400, "category 不能为空")
    return _build_category_raw(cat)


def _build_category_raw(cat: str) -> dict:
    """遍历 seed 里的元素，返回该分类的全部发现状态（不过白名单）。"""
    starter_names = {s["name"] for s in store.starters if s.get("category") == cat}
    names_in_cat: List[str] = []
    for name, info in store.elements.items():
        if (info or {}).get("category") == cat:
            names_in_cat.append(name)
    names_in_cat = sorted(set(names_in_cat), key=lambda s: s)

    items = []
    for name in names_in_cat:
        info = store.elements.get(name) or {}
        is_starter = name in starter_names
        first_row, seq = bounty_mod._first_row_and_seq(db, name)
        discovered = bool(first_row) or is_starter
        item = {
            "name": name,
            "emoji": info.get("emoji", "❓"),
            "category": cat,
            "is_starter": is_starter,
            "discovered": discovered,
        }
        bounty_mod._fill_discovery(item, first_row, seq)
        items.append(item)

    return {
        "category": cat,
        "total": len(items),
        "found": sum(1 for x in items if x["discovered"]),
        "items": items,
    }


@app.get("/api/wall/bounty")
async def api_wall_bounty():
    """
    悬赏清单：只包含与腾讯强相关的词（白名单在 backend/bounty.py）。
    返回 { tabs, groups, total, found }
    """
    return bounty_mod.build_bounty(db, store)


@app.get("/api/element/{name}/recipes")
async def api_element_recipes(name: str):
    """
    查询能合成出该元素的所有配方。
    数据源：SQLite `combinations` 表（seed + 历史 LLM 结果的真相源）。
    返回：
      {
        result: str,
        result_emoji: str,
        count: int,
        recipes: [
          { a, b, a_emoji, b_emoji, source, chain, hit_count },
          ...
        ]
      }
    """
    target = (name or "").strip()
    if not target:
        raise HTTPException(400, "name 不能为空")

    raw = archive.recipes_for(target, limit=100)
    result_info = store.elements.get(target) or {}
    recipes = []
    for r in raw:
        a, b = r["a"], r["b"]
        a_info = store.elements.get(a) or {}
        b_info = store.elements.get(b) or {}
        recipes.append(
            {
                "a": a,
                "b": b,
                "a_emoji": a_info.get("emoji") or "❓",
                "b_emoji": b_info.get("emoji") or "❓",
                "source": r.get("source"),
                "chain": r.get("chain"),
                "hit_count": r.get("hit_count"),
            }
        )
    return {
        "result": target,
        "result_emoji": result_info.get("emoji") or "❓",
        "count": len(recipes),
        "recipes": recipes,
    }


# ============================================================
# 静态页面
# ============================================================
@app.get("/wall")
async def page_wall():
    return FileResponse(FRONTEND_DIR / "wall" / "index.html")


# 静态文件挂在 / 下（放在最后，防止覆盖 API 路由）
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
