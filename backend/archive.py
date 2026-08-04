"""
SQLite 归档层 —— 作为 Redis 的冷副本 + 数据真相源。
- 每个环境独立文件：data/{prod|dev|test}.db
- 表：combinations / first_discoveries / kpi_events / elements / nicknames
- 用途：
    1. 启动时从 SQLite 预热 Redis（保留历史 AI 生成的所有配方和元素）
    2. combine 时双写，Redis 可随时 FLUSH 而不丢数据
    3. 分享后 SQL 分析（chain 分布、造梗榜、合成次数...）
"""

from __future__ import annotations

import os
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional, Dict, List

from .icon_recipes import normalize_icon

_DATA_DIR = Path(__file__).parent.parent / "data"
_lock = threading.Lock()
_GAMEPLAY_TABLES = (
    "formula_votes",
    "result_votes",
    "formula_reproductions",
    "formula_moderation",
    "formula_versions",
    "retired_combo_keys",
    "combinations",
    "elements",
    "first_discoveries",
    "kpi_events",
    "nicknames",
)


def _db_path() -> Path:
    """按 APP_ENV 选文件，默认 dev.db。"""
    env = os.environ.get("APP_ENV", "dev")
    return _DATA_DIR / f"{env}.db"


def _conn() -> sqlite3.Connection:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_db_path()))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")  # 并发写友好
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def init_archive() -> None:
    """首次启动建表。幂等。"""
    with _lock:
        con = _conn()
        try:
            con.executescript(
                """
                CREATE TABLE IF NOT EXISTS combinations (
                    key        TEXT PRIMARY KEY,
                    result     TEXT NOT NULL,
                    emoji      TEXT NOT NULL,
                    source     TEXT NOT NULL,   -- seed | llm
                    chain      TEXT,
                    comment    TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    hit_count  INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS elements (
                    name       TEXT PRIMARY KEY,
                    emoji      TEXT NOT NULL,
                    category   TEXT,
                    is_starter INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    icon_json  TEXT
                );

                CREATE TABLE IF NOT EXISTS first_discoveries (
                    result     TEXT PRIMARY KEY,
                    emoji      TEXT NOT NULL,
                    discoverer TEXT NOT NULL,
                    ts         REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS kpi_events (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    delta      INTEGER NOT NULL,
                    reason     TEXT NOT NULL,
                    ts         REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS nicknames (
                    name TEXT PRIMARY KEY,
                    ts   REAL NOT NULL
                );

                CREATE TABLE IF NOT EXISTS content_state (
                    singleton      INTEGER PRIMARY KEY CHECK(singleton = 1),
                    epoch          INTEGER NOT NULL,
                    catalog_digest TEXT NOT NULL,
                    status         TEXT NOT NULL,
                    phase          TEXT NOT NULL,
                    error          TEXT NOT NULL DEFAULT '',
                    updated_at     REAL NOT NULL,
                    completed_at   REAL
                );

                CREATE INDEX IF NOT EXISTS idx_kpi_session ON kpi_events(session_id);
                CREATE INDEX IF NOT EXISTS idx_first_ts    ON first_discoveries(ts DESC);
                CREATE INDEX IF NOT EXISTS idx_combo_chain ON combinations(chain);
                """
            )
            columns = {
                row["name"]
                for row in con.execute(
                    "PRAGMA table_info(combinations)"
                ).fetchall()
            }
            if "comment" not in columns:
                con.execute(
                    "ALTER TABLE combinations "
                    "ADD COLUMN comment TEXT NOT NULL DEFAULT ''"
                )
            element_columns = {
                row["name"]
                for row in con.execute(
                    "PRAGMA table_info(elements)"
                ).fetchall()
            }
            if "icon_json" not in element_columns:
                con.execute("ALTER TABLE elements ADD COLUMN icon_json TEXT")
            con.commit()
            print(f"[sqlite] archive ready: {_db_path()}")
        finally:
            con.close()


# ============================================================
# 内容版本迁移状态
# ============================================================

def content_state() -> Optional[Dict]:
    con = _conn()
    try:
        exists = con.execute(
            """
            SELECT 1 FROM sqlite_master
            WHERE type='table' AND name='content_state'
            """
        ).fetchone()
        if not exists:
            return None
        row = con.execute(
            "SELECT * FROM content_state WHERE singleton = 1"
        ).fetchone()
        return dict(row) if row else None
    finally:
        con.close()


def has_gameplay_data() -> bool:
    con = _conn()
    try:
        existing = {
            row["name"]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        return any(
            con.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
            for table in _GAMEPLAY_TABLES
            if table in existing
        )
    finally:
        con.close()


def begin_content_migration(epoch: int, digest: str, phase: str) -> None:
    now = time.time()
    with _lock:
        con = _conn()
        try:
            con.execute(
                """
                INSERT INTO content_state(
                    singleton, epoch, catalog_digest, status, phase, error,
                    updated_at, completed_at
                ) VALUES (1, ?, ?, 'migrating', ?, '', ?, NULL)
                ON CONFLICT(singleton) DO UPDATE SET
                    epoch=excluded.epoch,
                    catalog_digest=excluded.catalog_digest,
                    status='migrating',
                    phase=excluded.phase,
                    error='',
                    updated_at=excluded.updated_at,
                    completed_at=NULL
                """,
                (epoch, digest, phase, now),
            )
            con.commit()
        finally:
            con.close()


def reset_gameplay_data() -> None:
    """Atomically clear local gameplay data while retaining durable metadata."""
    with _lock:
        con = _conn()
        try:
            con.execute("BEGIN IMMEDIATE")
            existing = {
                row["name"]
                for row in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            for table in _GAMEPLAY_TABLES:
                if table in existing:
                    con.execute(f"DELETE FROM {table}")
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()


def retire_fixed_content(
    pair_keys: set[str],
    element_names: set[str],
) -> None:
    """Remove only generated seed rows superseded by a catalog digest change."""
    with _lock:
        con = _conn()
        try:
            con.execute("BEGIN IMMEDIATE")
            if pair_keys:
                placeholders = ",".join("?" for _ in pair_keys)
                con.execute(
                    f"""
                    DELETE FROM combinations
                    WHERE source='seed' AND key IN ({placeholders})
                    """,
                    tuple(sorted(pair_keys)),
                )
            if element_names:
                placeholders = ",".join("?" for _ in element_names)
                con.execute(
                    f"DELETE FROM elements WHERE name IN ({placeholders})",
                    tuple(sorted(element_names)),
                )
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()


def complete_content_migration(epoch: int, digest: str) -> None:
    now = time.time()
    with _lock:
        con = _conn()
        try:
            con.execute(
                """
                INSERT INTO content_state(
                    singleton, epoch, catalog_digest, status, phase, error,
                    updated_at, completed_at
                ) VALUES (1, ?, ?, 'ready', 'ready', '', ?, ?)
                ON CONFLICT(singleton) DO UPDATE SET
                    epoch=excluded.epoch,
                    catalog_digest=excluded.catalog_digest,
                    status='ready',
                    phase='ready',
                    error='',
                    updated_at=excluded.updated_at,
                    completed_at=excluded.completed_at
                """,
                (epoch, digest, now, now),
            )
            con.commit()
        finally:
            con.close()


# ============================================================
# 写：combine 时双写调用
# ============================================================

def upsert_combination(
    key: str, result: str, emoji: str, source: str,
    chain: Optional[str], comment: str = "", increment_hit: bool = False,
    replace_existing: bool = False,
) -> int:
    """
    插入或更新一条合成规则。
    首次写入：source/chain/created_at 定型
    重复命中：增加 hit_count（可选）
    权威同步：替换公式字段，但保留 created_at / hit_count
    """
    with _lock:
        con = _conn()
        try:
            if replace_existing:
                conflict_update = """
                    result = excluded.result,
                    emoji = excluded.emoji,
                    source = excluded.source,
                    chain = excluded.chain,
                    comment = excluded.comment,
                    hit_count = combinations.hit_count
                        + CASE WHEN ? THEN 1 ELSE 0 END
                """
            else:
                conflict_update = """
                    hit_count = combinations.hit_count
                        + CASE WHEN ? THEN 1 ELSE 0 END
                """
            con.execute(
                f"""
                INSERT INTO combinations(
                    key, result, emoji, source, chain, comment, created_at, hit_count
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(key) DO UPDATE SET {conflict_update}
                """,
                (
                    key,
                    result,
                    emoji,
                    source,
                    chain or "",
                    str(comment or ""),
                    time.time(),
                    1 if increment_hit else 0,
                ),
            )
            con.commit()
            row = con.execute(
                "SELECT hit_count FROM combinations WHERE key = ?",
                (key,),
            ).fetchone()
            return max(1, int(row["hit_count"])) if row else 1
        finally:
            con.close()


def upsert_element(
    name: str,
    emoji: str,
    category: Optional[str],
    is_starter: bool = False,
    icon: Optional[dict] = None,
) -> None:
    normalized_icon = normalize_icon(icon)
    icon_json = (
        json.dumps(normalized_icon, ensure_ascii=False, separators=(",", ":"))
        if normalized_icon is not None
        else None
    )
    with _lock:
        con = _conn()
        try:
            existing = con.execute(
                "SELECT icon_json FROM elements WHERE name = ?",
                (name,),
            ).fetchone()
            replace_invalid = bool(
                icon_json is not None
                and existing is not None
                and existing["icon_json"]
                and normalize_icon(existing["icon_json"]) is None
            )
            con.execute(
                """
                INSERT INTO elements(
                    name, emoji, category, is_starter, created_at, icon_json
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    icon_json = CASE
                        WHEN elements.icon_json IS NULL
                             OR TRIM(elements.icon_json) = ''
                             OR ?
                        THEN excluded.icon_json
                        ELSE elements.icon_json
                    END
                """,
                (
                    name,
                    emoji,
                    category or "",
                    1 if is_starter else 0,
                    time.time(),
                    icon_json,
                    1 if replace_invalid else 0,
                ),
            )
            con.commit()
        finally:
            con.close()


def record_first_archive(result: str, emoji: str, discoverer: str, ts: float) -> None:
    with _lock:
        con = _conn()
        try:
            con.execute(
                """INSERT OR IGNORE INTO first_discoveries(result, emoji, discoverer, ts)
                   VALUES (?, ?, ?, ?)""",
                (result, emoji, discoverer, ts),
            )
            con.commit()
        finally:
            con.close()


def kpi_archive(session_id: str, delta: int, reason: str) -> None:
    with _lock:
        con = _conn()
        try:
            con.execute(
                "INSERT INTO kpi_events(session_id, delta, reason, ts) VALUES (?, ?, ?, ?)",
                (session_id, delta, reason, time.time()),
            )
            con.commit()
        finally:
            con.close()


def nickname_archive(name: str) -> None:
    with _lock:
        con = _conn()
        try:
            con.execute(
                "INSERT OR IGNORE INTO nicknames(name, ts) VALUES (?, ?)",
                (name, time.time()),
            )
            con.commit()
        finally:
            con.close()


# ============================================================
# 读：启动时预热 Redis
# ============================================================

def all_combinations() -> List[Dict]:
    con = _conn()
    try:
        rows = con.execute(
            "SELECT key, result, emoji, source, chain, comment FROM combinations"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def all_elements() -> List[Dict]:
    con = _conn()
    try:
        rows = con.execute(
            "SELECT name, emoji, category, is_starter, icon_json FROM elements"
        ).fetchall()
        out: List[Dict] = []
        for row in rows:
            item = dict(row)
            raw_icon = item.pop("icon_json", None)
            try:
                decoded = json.loads(raw_icon) if raw_icon else None
            except (json.JSONDecodeError, TypeError):
                decoded = None
            item["icon"] = normalize_icon(decoded)
            out.append(item)
        return out
    finally:
        con.close()


def all_firsts() -> List[Dict]:
    con = _conn()
    try:
        rows = con.execute(
            "SELECT result, emoji, discoverer, ts FROM first_discoveries"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def all_nicknames() -> List[str]:
    con = _conn()
    try:
        rows = con.execute("SELECT name FROM nicknames").fetchall()
        return [r["name"] for r in rows]
    finally:
        con.close()


# ============================================================
# 分析：分享后 SQL 查询
# ============================================================

def top_chains(limit: int = 10) -> List[Dict]:
    """哪条 chain 最火。"""
    con = _conn()
    try:
        rows = con.execute(
            """SELECT chain, COUNT(*) AS cnt, SUM(hit_count) AS total_hits
               FROM combinations GROUP BY chain ORDER BY total_hits DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def top_discoverers(limit: int = 10) -> List[Dict]:
    """造梗榜：谁首发最多。"""
    con = _conn()
    try:
        rows = con.execute(
            """SELECT discoverer, COUNT(*) AS firsts
               FROM first_discoveries GROUP BY discoverer ORDER BY firsts DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def top_combinations(limit: int = 20) -> List[Dict]:
    """最热合成。"""
    con = _conn()
    try:
        rows = con.execute(
            """SELECT key, result, emoji, hit_count
               FROM combinations ORDER BY hit_count DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def recipes_for(result: str, limit: int = 50) -> List[Dict]:
    """
    查所有能合成出 `result` 的配方。
    返回：[{key, a, b, source, chain, hit_count}, ...]
    key = "a + b"（经 normalize，字典序排过）。
    """
    con = _conn()
    try:
        rows = con.execute(
            """SELECT key, source, chain, comment, hit_count
               FROM combinations WHERE result = ?
               ORDER BY source ASC, hit_count DESC LIMIT ?""",
            (result, limit),
        ).fetchall()
        out: List[Dict] = []
        for r in rows:
            key = r["key"] or ""
            parts = [p.strip() for p in key.split(" + ", 1)]
            a = parts[0] if len(parts) >= 1 else ""
            b = parts[1] if len(parts) >= 2 else ""
            out.append({
                "key": key,
                "a": a,
                "b": b,
                "source": r["source"],
                "chain": r["chain"] or None,
                "comment": r["comment"] or "",
                "hit_count": r["hit_count"],
            })
        return out
    finally:
        con.close()


def db_path_str() -> str:
    return str(_db_path())
