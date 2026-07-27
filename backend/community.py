"""Community formula publication, voting, moderation, and LLM feedback."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
import uuid
from typing import Any

from . import archive

UP_THRESHOLD = int(os.getenv("FORMULA_UP_THRESHOLD", "10"))
UP_MIN_VOTES = int(os.getenv("FORMULA_UP_MIN_VOTES", "12"))
DOWN_THRESHOLD = int(os.getenv("FORMULA_DOWN_THRESHOLD", "-5"))
DOWN_MIN_VOTES = int(os.getenv("FORMULA_DOWN_MIN_VOTES", "8"))


def init() -> None:
    con = archive._conn()
    try:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS formula_versions (
                id TEXT PRIMARY KEY,
                combo_key TEXT NOT NULL,
                a TEXT NOT NULL,
                b TEXT NOT NULL,
                result TEXT NOT NULL,
                emoji TEXT NOT NULL,
                comment TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL,
                version INTEGER NOT NULL,
                visibility TEXT NOT NULL DEFAULT 'hidden',
                status TEXT NOT NULL DEFAULT 'active',
                global_discoverer TEXT,
                first_publisher TEXT,
                published_at REAL,
                up_votes INTEGER NOT NULL DEFAULT 0,
                down_votes INTEGER NOT NULL DEFAULT 0,
                protected INTEGER NOT NULL DEFAULT 0,
                ai_positive_enabled INTEGER NOT NULL DEFAULT 1,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL,
                UNIQUE(combo_key, version)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_formula_active
                ON formula_versions(combo_key) WHERE status = 'active';
            CREATE INDEX IF NOT EXISTS idx_formula_public
                ON formula_versions(visibility, status, updated_at DESC);
            CREATE TABLE IF NOT EXISTS formula_reproductions (
                formula_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                first_seen_at REAL NOT NULL,
                PRIMARY KEY(formula_id, player_id)
            );
            CREATE TABLE IF NOT EXISTS formula_votes (
                formula_id TEXT NOT NULL,
                player_id TEXT NOT NULL,
                value INTEGER NOT NULL CHECK(value IN (-1, 1)),
                updated_at REAL NOT NULL,
                PRIMARY KEY(formula_id, player_id)
            );
            CREATE TABLE IF NOT EXISTS formula_moderation (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                formula_id TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                reason_code TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS retired_combo_keys (
                combo_key TEXT PRIMARY KEY,
                latest_version INTEGER NOT NULL,
                retired_result TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """
        )
        con.commit()
    finally:
        con.close()


def _row(row: Any) -> dict[str, Any] | None:
    return dict(row) if row else None


def ensure_formula(
    combo_key: str, a: str, b: str, result: str, emoji: str, comment: str,
    source: str, discoverer: str | None,
) -> dict[str, Any]:
    """Return/create the active version and preserve the original discoverer."""
    now = time.time()
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        existing = con.execute(
            "SELECT * FROM formula_versions WHERE combo_key=? AND status='active'",
            (combo_key,),
        ).fetchone()
        if existing:
            con.commit()
            return dict(existing)
        latest = con.execute(
            "SELECT COALESCE(MAX(version), 0) FROM formula_versions WHERE combo_key=?",
            (combo_key,),
        ).fetchone()[0]
        formula_id = uuid.uuid4().hex
        con.execute(
            """INSERT INTO formula_versions(
                 id, combo_key, a, b, result, emoji, comment, source, version,
                 global_discoverer, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (formula_id, combo_key, a, b, result, emoji, comment, source,
             latest + 1, discoverer, now, now),
        )
        con.execute("DELETE FROM retired_combo_keys WHERE combo_key=?", (combo_key,))
        row = con.execute(
            "SELECT * FROM formula_versions WHERE id=?", (formula_id,)
        ).fetchone()
        con.commit()
        return dict(row)
    finally:
        con.close()


def record_reproduction(formula_id: str, player_id: str) -> None:
    con = archive._conn()
    try:
        con.execute(
            "INSERT OR IGNORE INTO formula_reproductions VALUES (?, ?, ?)",
            (formula_id, player_id, time.time()),
        )
        con.commit()
    finally:
        con.close()


def publish(formula_id: str, player_id: str) -> dict[str, Any]:
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        reproduced = con.execute(
            "SELECT 1 FROM formula_reproductions WHERE formula_id=? AND player_id=?",
            (formula_id, player_id),
        ).fetchone()
        if not reproduced:
            raise PermissionError("只有实际复现过该公式的玩家才能公开")
        row = con.execute(
            "SELECT * FROM formula_versions WHERE id=? AND status='active'",
            (formula_id,),
        ).fetchone()
        if not row:
            raise LookupError("公式不存在或已退役")
        now = time.time()
        con.execute(
            """UPDATE formula_versions SET visibility='public',
               first_publisher=COALESCE(first_publisher, ?),
               published_at=COALESCE(published_at, ?), updated_at=? WHERE id=?""",
            (player_id, now, now, formula_id),
        )
        out = con.execute(
            "SELECT * FROM formula_versions WHERE id=?", (formula_id,)
        ).fetchone()
        con.commit()
        return dict(out)
    finally:
        con.close()


def public_formula(formula_id: str, player_id: str | None = None) -> dict[str, Any] | None:
    con = archive._conn()
    try:
        row = con.execute(
            """SELECT id,a,b,result,emoji,comment,version,status,first_publisher,
                      published_at,up_votes,down_votes,(up_votes-down_votes) net_score,
                      protected
               FROM formula_versions WHERE id=? AND visibility='public'""",
            (formula_id,),
        ).fetchone()
        if not row:
            return None
        out = dict(row)
        vote = None
        if player_id:
            found = con.execute(
                "SELECT value FROM formula_votes WHERE formula_id=? AND player_id=?",
                (formula_id, player_id),
            ).fetchone()
            vote = found["value"] if found else None
        out["my_vote"] = vote
        return out
    finally:
        con.close()


def list_public(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    con = archive._conn()
    try:
        rows = con.execute(
            """SELECT id,a,b,result,emoji,comment,version,status,first_publisher,
                      published_at,up_votes,down_votes,(up_votes-down_votes) net_score,
                      protected
               FROM formula_versions WHERE visibility='public' AND status!='takedown'
               ORDER BY net_score DESC, published_at DESC LIMIT ? OFFSET ?""",
            (min(max(limit, 1), 100), max(offset, 0)),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def vote(formula_id: str, player_id: str, value: int) -> dict[str, Any]:
    """value -1/1 sets or switches a vote; 0 cancels it."""
    if value not in (-1, 0, 1):
        raise ValueError("vote 必须是 -1、0 或 1")
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        formula = con.execute(
            """SELECT 1 FROM formula_versions
               WHERE id=? AND visibility='public' AND status='active'""",
            (formula_id,),
        ).fetchone()
        if not formula:
            raise LookupError("只能为公开且有效的公式投票")
        if value == 0:
            con.execute(
                "DELETE FROM formula_votes WHERE formula_id=? AND player_id=?",
                (formula_id, player_id),
            )
        else:
            con.execute(
                """INSERT INTO formula_votes VALUES (?, ?, ?, ?)
                   ON CONFLICT(formula_id,player_id) DO UPDATE SET
                   value=excluded.value, updated_at=excluded.updated_at""",
                (formula_id, player_id, value, time.time()),
            )
        counts = con.execute(
            """SELECT COALESCE(SUM(value=1),0), COALESCE(SUM(value=-1),0)
               FROM formula_votes WHERE formula_id=?""",
            (formula_id,),
        ).fetchone()
        con.execute(
            "UPDATE formula_versions SET up_votes=?,down_votes=?,updated_at=? WHERE id=?",
            (counts[0], counts[1], time.time(), formula_id),
        )
        con.commit()
        return public_formula(formula_id, player_id) or {}
    finally:
        con.close()


def moderation_queue() -> list[dict[str, Any]]:
    con = archive._conn()
    try:
        rows = con.execute(
            """SELECT *, (up_votes-down_votes) net_score
               FROM formula_versions WHERE visibility='public' AND status='active'
               AND protected=0 AND (up_votes-down_votes)<=?
               AND (up_votes+down_votes)>=?
               ORDER BY net_score ASC, updated_at ASC""",
            (DOWN_THRESHOLD, DOWN_MIN_VOTES),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def moderate(formula_id: str, action: str, reason_code: str, note: str = "") -> dict[str, Any]:
    if action not in {"keep", "ignore", "protect", "takedown", "retire"}:
        raise ValueError("不支持的治理操作")
    if not reason_code.strip():
        raise ValueError("必须提供结构化原因")
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        row = con.execute(
            "SELECT * FROM formula_versions WHERE id=?", (formula_id,)
        ).fetchone()
        if not row:
            raise LookupError("公式不存在")
        status = row["status"]
        protected = row["protected"]
        if action == "protect":
            protected = 1
        elif action == "takedown":
            status = "takedown"
        elif action == "retire":
            status = "retired"
            con.execute(
                """INSERT INTO retired_combo_keys VALUES (?, ?, ?, ?)
                   ON CONFLICT(combo_key) DO UPDATE SET
                   latest_version=excluded.latest_version,
                   retired_result=excluded.retired_result,
                   created_at=excluded.created_at""",
                (row["combo_key"], row["version"], row["result"], time.time()),
            )
        con.execute(
            "UPDATE formula_versions SET status=?,protected=?,updated_at=? WHERE id=?",
            (status, protected, time.time(), formula_id),
        )
        con.execute(
            """INSERT INTO formula_moderation(
                 formula_id,actor,action,reason_code,note,created_at
               ) VALUES (?, 'admin', ?, ?, ?, ?)""",
            (formula_id, action, reason_code.strip(), note.strip()[:500], time.time()),
        )
        con.commit()
        return _row(con.execute(
            "SELECT * FROM formula_versions WHERE id=?", (formula_id,)
        ).fetchone()) or {}
    finally:
        con.close()


def is_retired_key(combo_key: str) -> bool:
    con = archive._conn()
    try:
        try:
            return bool(con.execute(
                "SELECT 1 FROM retired_combo_keys WHERE combo_key=?", (combo_key,)
            ).fetchone())
        except sqlite3.OperationalError:
            return False
    finally:
        con.close()


def feedback_examples(limit: int = 8) -> tuple[list[dict[str, str]], list[str]]:
    """Return curated positive examples and retired/negative result words."""
    con = archive._conn()
    try:
        try:
            positives = con.execute(
            """SELECT a,b,result AS name,emoji,comment FROM formula_versions
               WHERE visibility='public' AND status='active'
               AND ai_positive_enabled=1 AND (up_votes-down_votes)>=?
               AND (up_votes+down_votes)>=?
               ORDER BY (up_votes-down_votes) DESC LIMIT ?""",
            (UP_THRESHOLD, UP_MIN_VOTES, limit),
            ).fetchall()
            negatives = con.execute(
            """SELECT retired_result FROM retired_combo_keys
               ORDER BY created_at DESC LIMIT ?""", (limit,)
            ).fetchall()
        except sqlite3.OperationalError:
            return [], []
        return [dict(row) for row in positives], [row[0] for row in negatives]
    finally:
        con.close()


def secret() -> bytes:
    value = os.getenv("SESSION_SECRET") or os.getenv("COMMUNITY_ADMIN_KEY") or "dev-only-change-me"
    return value.encode()


def sign(value: str) -> str:
    digest = hmac.new(secret(), value.encode(), hashlib.sha256).hexdigest()
    return f"{value}.{digest}"


def unsign(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    value, digest = token.rsplit(".", 1)
    expected = hmac.new(secret(), value.encode(), hashlib.sha256).hexdigest()
    return value if hmac.compare_digest(digest, expected) else None


def new_player_id() -> str:
    return f"p_{secrets.token_urlsafe(18)}"
