"""Community formula publication, voting, moderation, and LLM feedback."""

from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
import secrets
import sqlite3
import time
import uuid
from typing import Any

from . import archive
from .prompt_spec import load_prompt_spec

UP_THRESHOLD = int(os.getenv("FORMULA_UP_THRESHOLD", "10"))
UP_MIN_VOTES = int(os.getenv("FORMULA_UP_MIN_VOTES", "12"))
DOWN_THRESHOLD = int(os.getenv("FORMULA_DOWN_THRESHOLD", "-5"))
DOWN_MIN_VOTES = int(os.getenv("FORMULA_DOWN_MIN_VOTES", "8"))
MAX_PUBLIC_PAGE = 100
MAX_PUBLIC_OFFSET = 10_000_000
ASCII_QUERY_WHITESPACE = " \t\n\f\r"
ASCII_DECIMAL = re.compile(
    r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",
    re.ASCII,
)


def _normalize_public_page_value(
    value: Any, fallback: int, minimum: int, maximum: int,
) -> int:
    if isinstance(value, str):
        raw = value.strip(ASCII_QUERY_WHITESPACE)
        if not raw or not ASCII_DECIMAL.fullmatch(raw):
            return fallback
        parsed = float(raw)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        parsed = float(value)
    else:
        return fallback
    if not math.isfinite(parsed):
        return fallback
    return max(minimum, min(maximum, math.trunc(parsed)))


def normalize_public_pagination(
    limit: Any = None, offset: Any = None,
) -> tuple[int, int]:
    return (
        _normalize_public_page_value(limit, 50, 1, MAX_PUBLIC_PAGE),
        _normalize_public_page_value(offset, 0, 0, MAX_PUBLIC_OFFSET),
    )


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
            CREATE TABLE IF NOT EXISTS result_votes (
                result TEXT NOT NULL,
                player_id TEXT NOT NULL,
                value INTEGER NOT NULL CHECK(value IN (-1, 1)),
                updated_at REAL NOT NULL,
                PRIMARY KEY(result, player_id)
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


def reconcile_seed_formulas(formulas: list[dict[str, Any]]) -> int:
    """Supersede active formulas that conflict with authoritative seed data."""
    now = time.time()
    replaced = 0
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        for formula in formulas:
            combo_key = str(formula.get("combo_key") or "").strip()
            result = str(formula.get("result") or "").strip()
            if not combo_key or not result:
                continue
            try:
                existing = con.execute(
                    """
                    SELECT * FROM formula_versions
                    WHERE combo_key=? AND status='active'
                    """,
                    (combo_key,),
                ).fetchone()
            except sqlite3.OperationalError:
                con.rollback()
                return 0
            if not existing:
                continue

            expected = (
                result,
                str(formula.get("emoji") or "❓"),
                str(formula.get("comment") or ""),
                "seed",
            )
            current = (
                existing["result"],
                existing["emoji"],
                existing["comment"],
                existing["source"],
            )
            if current == expected:
                continue

            con.execute(
                """
                UPDATE formula_versions
                SET status='retired', visibility='hidden', updated_at=?
                WHERE id=?
                """,
                (now, existing["id"]),
            )
            latest = con.execute(
                """
                SELECT COALESCE(MAX(version), 0)
                FROM formula_versions WHERE combo_key=?
                """,
                (combo_key,),
            ).fetchone()[0]
            con.execute(
                """
                INSERT INTO formula_versions(
                    id, combo_key, a, b, result, emoji, comment, source,
                    version, visibility, status, global_discoverer,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'seed', ?, 'hidden', 'active',
                          NULL, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    combo_key,
                    str(formula.get("a") or ""),
                    str(formula.get("b") or ""),
                    expected[0],
                    expected[1],
                    expected[2],
                    latest + 1,
                    now,
                    now,
                ),
            )
            con.execute(
                "DELETE FROM retired_combo_keys WHERE combo_key=?",
                (combo_key,),
            )
            replaced += 1
        con.commit()
        return replaced
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
               FROM formula_versions
               WHERE id=? AND visibility='public' AND status!='takedown'""",
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


def list_public(limit: Any = None, offset: Any = None) -> list[dict[str, Any]]:
    limit, offset = normalize_public_pagination(limit, offset)
    con = archive._conn()
    try:
        rows = con.execute(
            """SELECT id,a,b,result,emoji,comment,version,status,first_publisher,
                      published_at,up_votes,down_votes,(up_votes-down_votes) net_score,
                      protected
               FROM formula_versions WHERE visibility='public' AND status!='takedown'
               ORDER BY net_score DESC, published_at DESC, id DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        con.close()


def public_by_results(
    results: list[str], player_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    wanted = [str(item or "").strip() for item in results if str(item or "").strip()]
    if not wanted:
        return {}
    placeholders = ",".join("?" for _ in wanted)
    con = archive._conn()
    try:
        rows = con.execute(
            f"""SELECT id,a,b,result,emoji,comment,version,status,first_publisher,
                       published_at,up_votes,down_votes,(up_votes-down_votes) net_score,
                       protected
                FROM formula_versions
                WHERE visibility='public' AND status='active'
                  AND result IN ({placeholders})
                ORDER BY result ASC, net_score DESC, published_at DESC""",
            wanted,
        ).fetchall()
        votes: dict[str, int] = {}
        if player_id and rows:
            formula_ids = [row["id"] for row in rows]
            id_placeholders = ",".join("?" for _ in formula_ids)
            vote_rows = con.execute(
                f"""SELECT formula_id,value FROM formula_votes
                    WHERE player_id=? AND formula_id IN ({id_placeholders})""",
                [player_id, *formula_ids],
            ).fetchall()
            votes = {row["formula_id"]: row["value"] for row in vote_rows}
        output: dict[str, dict[str, Any]] = {}
        for row in rows:
            result = row["result"]
            if result in output:
                continue
            item = dict(row)
            item["my_vote"] = votes.get(item["id"])
            output[result] = item
        return output
    finally:
        con.close()


def _empty_reaction(my_vote: int | None = None) -> dict[str, Any]:
    return {
        "up_votes": 0,
        "down_votes": 0,
        "net_score": 0,
        "my_vote": my_vote,
    }


def reactions_by_results(
    results: list[str], player_id: str | None = None,
) -> dict[str, dict[str, Any]]:
    wanted = [str(item or "").strip() for item in results if str(item or "").strip()]
    output = {result: _empty_reaction() for result in wanted}
    if not wanted:
        return output
    placeholders = ",".join("?" for _ in wanted)
    con = archive._conn()
    try:
        rows = con.execute(
            f"""SELECT result,
                       COALESCE(SUM(value=1),0) up_votes,
                       COALESCE(SUM(value=-1),0) down_votes
                FROM result_votes
                WHERE result IN ({placeholders})
                GROUP BY result""",
            wanted,
        ).fetchall()
        for row in rows:
            up_votes = int(row["up_votes"] or 0)
            down_votes = int(row["down_votes"] or 0)
            output[row["result"]] = {
                "up_votes": up_votes,
                "down_votes": down_votes,
                "net_score": up_votes - down_votes,
                "my_vote": None,
            }
        if player_id:
            vote_rows = con.execute(
                f"""SELECT result,value FROM result_votes
                    WHERE player_id=? AND result IN ({placeholders})""",
                [player_id, *wanted],
            ).fetchall()
            for row in vote_rows:
                if row["result"] in output:
                    output[row["result"]]["my_vote"] = row["value"]
        return output
    finally:
        con.close()


def vote_result(result: str, player_id: str, value: int) -> dict[str, Any]:
    """value -1/1 toggles that reaction; 0 cancels any existing reaction."""
    clean_result = str(result or "").strip()
    clean_player = str(player_id or "").strip()
    if not clean_result:
        raise ValueError("result 不能为空")
    if not clean_player:
        raise ValueError("player_id 不能为空")
    if value not in (-1, 0, 1):
        raise ValueError("vote 必须是 -1、0 或 1")
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        existing = con.execute(
            "SELECT value FROM result_votes WHERE result=? AND player_id=?",
            (clean_result, clean_player),
        ).fetchone()
        old_value = existing["value"] if existing else None
        next_value = None if value == 0 or old_value == value else value
        if next_value is None:
            con.execute(
                "DELETE FROM result_votes WHERE result=? AND player_id=?",
                (clean_result, clean_player),
            )
        else:
            con.execute(
                """INSERT INTO result_votes VALUES (?, ?, ?, ?)
                   ON CONFLICT(result,player_id) DO UPDATE SET
                   value=excluded.value, updated_at=excluded.updated_at""",
                (clean_result, clean_player, next_value, time.time()),
            )
        con.commit()
        return reactions_by_results([clean_result], clean_player)[clean_result]
    finally:
        con.close()


def _vote_view(row: Any, player_id: str | None = None) -> dict[str, Any]:
    out = dict(row)
    out["net_score"] = out["up_votes"] - out["down_votes"]
    if out["visibility"] == "public":
        return public_formula(out["id"], player_id) or {}
    return {
        "id": out["id"],
        "visibility": out["visibility"],
        "status": out["status"],
        "up_votes": out["up_votes"],
        "down_votes": out["down_votes"],
        "net_score": out["net_score"],
        "my_vote": None,
    }


def vote(formula_id: str, player_id: str, value: int) -> dict[str, Any]:
    """value -1/1 sets or switches a vote; 0 cancels it."""
    if value not in (-1, 0, 1):
        raise ValueError("vote 必须是 -1、0 或 1")
    con = archive._conn()
    try:
        con.execute("BEGIN IMMEDIATE")
        formula = con.execute(
            """SELECT id,visibility,status,up_votes,down_votes FROM formula_versions
               WHERE id=? AND status='active'""",
            (formula_id,),
        ).fetchone()
        if not formula:
            raise LookupError("只能为有效公式投票")
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
        updated = con.execute(
            "SELECT id,visibility,status,up_votes,down_votes FROM formula_versions WHERE id=?",
            (formula_id,),
        ).fetchone()
        out = _vote_view(updated, player_id)
        out["my_vote"] = value or None
        return out
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


def feedback_examples(
    *,
    positive_limit: int | None = None,
    negative_limit: int | None = None,
) -> tuple[list[dict[str, str]], list[str]]:
    """Return curated positive examples and retired/negative result words."""
    if positive_limit is None or negative_limit is None:
        prompt_limits = load_prompt_spec()["limits"]
        if positive_limit is None:
            positive_limit = prompt_limits["community_examples"]
        if negative_limit is None:
            negative_limit = prompt_limits["avoid_words"]
    con = archive._conn()
    try:
        try:
            positives = con.execute(
            """SELECT a,b,result AS name,emoji,comment FROM formula_versions
               WHERE visibility='public' AND status='active'
               AND ai_positive_enabled=1 AND (up_votes-down_votes)>=?
               AND (up_votes+down_votes)>=?
               ORDER BY (up_votes-down_votes) DESC, updated_at DESC, id DESC LIMIT ?""",
            (UP_THRESHOLD, UP_MIN_VOTES, positive_limit),
            ).fetchall()
            negatives = con.execute(
            """SELECT retired_result FROM retired_combo_keys
               ORDER BY created_at DESC LIMIT ?""", (negative_limit,)
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
