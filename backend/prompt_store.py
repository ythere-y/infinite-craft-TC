"""Persistent local prompt drafts and active prompt specifications."""

from __future__ import annotations

import copy
import json
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from . import archive
from .prompt_spec import load_prompt_spec, validate_prompt_spec


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _decode(value: str) -> Dict[str, Any]:
    decoded = json.loads(value)
    if not isinstance(decoded, dict):
        raise ValueError("stored prompt value must be an object")
    return decoded


def draft_from_canonical(spec: dict) -> dict:
    validated = validate_prompt_spec(spec)
    return {
        "schema_version": 1,
        "temperature": validated["temperature"],
        "system_modules": copy.deepcopy(validated["system_modules"]),
        "structured_examples": copy.deepcopy(validated["examples"]),
        "styles": [
            {
                "id": style["id"],
                "enabled": style["enabled"],
                "label": style["label"],
                "guidance": style["guidance"],
                "probability": str(
                    (Decimal(str(style["weight"])) * Decimal("100")).normalize()
                ),
            }
            for style in validated["styles"]
        ],
        "positive_examples": [],
        "negative_examples": [],
        "capacities": copy.deepcopy(validated["capacities"]),
        "limits": copy.deepcopy(validated["limits"]),
    }


def _probability(value: Any) -> float:
    if isinstance(value, bool):
        raise ValueError("style probability must be a finite number")
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("style probability must be a finite number") from exc
    if not number.is_finite():
        raise ValueError("style probability must be a finite number")
    return float(number / Decimal("100"))


def canonical_from_draft(
    draft: dict, selected_style_id: Optional[str] = None
) -> dict:
    if not isinstance(draft, dict):
        raise ValueError("prompt draft must be an object")
    if draft.get("schema_version") != 1:
        raise ValueError("unsupported prompt draft schema version")
    styles = draft.get("styles")
    if not isinstance(styles, list):
        raise ValueError("draft styles must be an array")
    if not isinstance(draft.get("positive_examples"), list):
        raise ValueError("positive_examples must be an array")
    if not isinstance(draft.get("negative_examples"), list):
        raise ValueError("negative_examples must be an array")

    converted_styles: List[Dict[str, Any]] = []
    for style in styles:
        if not isinstance(style, dict):
            raise ValueError("draft style must be an object")
        converted_styles.append(
            {
                "id": style.get("id"),
                "enabled": style.get("enabled"),
                "label": style.get("label"),
                "guidance": style.get("guidance"),
                "weight": _probability(style.get("probability")),
            }
        )

    if selected_style_id is not None:
        selected = [style for style in converted_styles if style["id"] == selected_style_id]
        if len(selected) != 1:
            raise ValueError("selected style does not exist")
        converted_styles = [dict(selected[0], enabled=True, weight=1.0)]

    spec = {
        "schema_version": 1,
        "temperature": draft.get("temperature"),
        "system_modules": copy.deepcopy(draft.get("system_modules")),
        "examples": copy.deepcopy(draft.get("structured_examples")),
        "styles": converted_styles,
        "capacities": copy.deepcopy(draft.get("capacities")),
        "limits": copy.deepcopy(draft.get("limits")),
    }
    return validate_prompt_spec(spec)


def _version_from_row(row: Any) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "selected_style_id": row["selected_style_id"],
        "selected_style_name": row["selected_style_name"],
        "snapshot": _decode(row["snapshot_json"]),
        "effective_spec": _decode(row["effective_spec_json"]),
        "preview": row["preview"],
    }


def init_prompt_store() -> None:
    """Create the initial draft and active version once, atomically."""
    archive.init_archive()
    with archive._lock:
        con = archive._conn()
        try:
            con.execute("BEGIN")
            draft_row = con.execute(
                "SELECT config_json FROM prompt_draft WHERE singleton = 1"
            ).fetchone()
            if draft_row is not None:
                canonical_from_draft(_decode(draft_row["config_json"]))
                active_row = con.execute(
                    """
                    SELECT v.* FROM prompt_state AS state
                    JOIN prompt_versions AS v ON v.id = state.active_version_id
                    WHERE state.singleton = 1
                    """
                ).fetchone()
                if active_row is None:
                    raise ValueError("prompt store has no active version")
                validate_prompt_spec(_decode(active_row["effective_spec_json"]))
                con.commit()
                return

            canonical = load_prompt_spec()
            draft = draft_from_canonical(canonical)
            created_at = time.time()
            version_id = "prompt-initial-" + datetime.now(timezone.utc).strftime(
                "%Y%m%dT%H%M%S%fZ"
            )
            con.execute(
                "INSERT INTO prompt_draft(singleton, config_json, updated_at) VALUES (1, ?, ?)",
                (_json(draft), created_at),
            )
            con.execute(
                """
                INSERT INTO prompt_versions(
                    id, created_at, selected_style_id, selected_style_name,
                    snapshot_json, effective_spec_json, preview
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (version_id, created_at, None, None, _json(draft), _json(canonical), ""),
            )
            con.execute(
                "INSERT INTO prompt_state(singleton, active_version_id) VALUES (1, ?)",
                (version_id,),
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()


def get_draft() -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            "SELECT config_json FROM prompt_draft WHERE singleton = 1"
        ).fetchone()
        if row is None:
            raise RuntimeError("prompt store is not initialized")
        draft = _decode(row["config_json"])
        canonical_from_draft(draft)
        return draft
    finally:
        con.close()


def save_draft(draft: dict) -> dict:
    canonical_from_draft(draft)
    stored = copy.deepcopy(draft)
    with archive._lock:
        con = archive._conn()
        try:
            cursor = con.execute(
                "UPDATE prompt_draft SET config_json = ?, updated_at = ? WHERE singleton = 1",
                (_json(stored), time.time()),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("prompt store is not initialized")
            con.commit()
        finally:
            con.close()
    return stored


def get_active_version() -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            """
            SELECT v.* FROM prompt_state AS state
            JOIN prompt_versions AS v ON v.id = state.active_version_id
            WHERE state.singleton = 1
            """
        ).fetchone()
        if row is None:
            raise RuntimeError("prompt store is not initialized")
        version = _version_from_row(row)
        validate_prompt_spec(version["effective_spec"])
        return version
    finally:
        con.close()


def get_active_spec() -> dict:
    return get_active_version()["effective_spec"]


def list_versions() -> List[dict]:
    con = archive._conn()
    try:
        rows = con.execute(
            "SELECT * FROM prompt_versions ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [_version_from_row(row) for row in rows]
    finally:
        con.close()
