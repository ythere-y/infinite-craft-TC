"""Persistent local prompt drafts and active prompt specifications."""

from __future__ import annotations

import copy
import json
import random
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from . import archive
from .prompt_spec import (
    _strip_prompt_whitespace,
    build_prompt_messages_from_spec,
    load_prompt_spec,
    validate_prompt_spec,
)


class PromptValidationError(ValueError):
    """Raised when an editable prompt draft is not publishable."""


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

    spec: Dict[str, Any] = {
        "schema_version": 1,
        "temperature": draft.get("temperature"),
        "system_modules": copy.deepcopy(draft.get("system_modules")),
        "examples": copy.deepcopy(draft.get("structured_examples")),
        "styles": converted_styles,
        "capacities": copy.deepcopy(draft.get("capacities")),
        "limits": copy.deepcopy(draft.get("limits")),
    }
    for field in ("positive_examples", "negative_examples"):
        if draft.get(field):
            spec[field] = copy.deepcopy(draft[field])
    return validate_prompt_spec(spec)


def _stable_id(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise PromptValidationError(f"{label} ID 必须是字符串")
    stripped = _strip_prompt_whitespace(value)
    if not stripped or stripped != value:
        raise PromptValidationError(f"{label} ID 必须是稳定的非空字符串")
    return value


def _require_enabled_text(item: dict, field: str, label: str) -> None:
    value = item.get(field)
    if item["enabled"] and (
        not isinstance(value, str) or not _strip_prompt_whitespace(value)
    ):
        raise PromptValidationError(f"已启用{label}的{field}不能为空")


def _validate_managed_collection(
    draft: dict,
    field: str,
    label: str,
    text_fields: tuple[str, ...],
) -> List[dict]:
    items = draft.get(field)
    if not isinstance(items, list):
        raise PromptValidationError(f"{label}必须是列表")

    ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise PromptValidationError(f"{label}条目必须是对象")
        item_id = _stable_id(item.get("id"), label)
        if item_id in ids:
            raise PromptValidationError(f"{label} ID 不能重复")
        ids.add(item_id)
        if type(item.get("enabled")) is not bool:
            raise PromptValidationError(f"{label} enabled 必须是布尔值")
        for text_field in text_fields:
            _require_enabled_text(item, text_field, label)
    return items


def validate_draft(value: object) -> dict:
    """Validate and defensively copy an editable prompt configuration."""
    if not isinstance(value, dict):
        raise PromptValidationError("提示词草稿必须是对象")

    validated = copy.deepcopy(value)
    modules = _validate_managed_collection(
        validated, "system_modules", "系统模块", ("content",)
    )
    styles = _validate_managed_collection(
        validated, "styles", "风格", ("label", "guidance")
    )
    _validate_managed_collection(
        validated, "positive_examples", "正面案例", ("content",)
    )
    _validate_managed_collection(
        validated, "negative_examples", "负面案例", ("content",)
    )

    if not any(module["enabled"] for module in modules):
        raise PromptValidationError("至少启用一个系统模块")
    enabled_styles = [style for style in styles if style["enabled"]]
    if not enabled_styles:
        raise PromptValidationError("至少启用一种风格")

    for style in styles:
        value = style.get("probability")
        if isinstance(value, bool):
            raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")
        try:
            probability = Decimal(str(value))
        except (InvalidOperation, ValueError):
            raise PromptValidationError(
                "风格概率必须是 0 到 100 的有限数字"
            ) from None
        if not probability.is_finite() or not Decimal("0") <= probability <= Decimal(
            "100"
        ):
            raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")

    enabled_total = sum(
        Decimal(str(style["probability"]))
        for style in styles
        if style["enabled"]
    )
    if enabled_total != Decimal("100"):
        raise PromptValidationError("已启用风格的概率总和必须等于 100%")

    try:
        canonical_from_draft(validated)
    except (TypeError, ValueError) as exc:
        raise PromptValidationError(str(exc)) from exc
    return validated


def _version_from_row(row: Any) -> dict:
    selected_style = None
    if row["selected_style_id"] is not None:
        selected_style = {
            "id": row["selected_style_id"],
            "name": row["selected_style_name"],
        }
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "selected_style_id": row["selected_style_id"],
        "selected_style_name": row["selected_style_name"],
        "selected_style": selected_style,
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
                validate_draft(_decode(draft_row["config_json"]))
                active_row = con.execute(
                    """
                    SELECT v.* FROM prompt_state AS state
                    JOIN prompt_versions AS v ON v.id = state.active_version_id
                    WHERE state.singleton = 1
                    """
                ).fetchone()
                if active_row is None:
                    raise ValueError("prompt store has no active version")
                validate_draft(_decode(active_row["snapshot_json"]))
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
        return validate_draft(draft)
    finally:
        con.close()


def save_draft(draft: dict) -> dict:
    stored = validate_draft(draft)
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


def _select_draft_style(draft: dict, random_value: float | None) -> dict:
    enabled = [style for style in draft["styles"] if style["enabled"]]
    if random_value is None:
        random_value = random.random()
    try:
        roll = Decimal(str(random_value))
    except (InvalidOperation, ValueError):
        raise PromptValidationError("随机值必须是有限数字") from None
    if not roll.is_finite():
        raise PromptValidationError("随机值必须是有限数字")
    roll = min(Decimal("1"), max(Decimal("0"), roll))
    if roll == Decimal("1"):
        return enabled[-1]

    target = roll * Decimal("100")
    cumulative = Decimal("0")
    for style in enabled:
        cumulative += Decimal(str(style["probability"]))
        if target < cumulative:
            return style
    return enabled[-1]


def aggregate_draft(random_value: float | None = None) -> dict:
    """Persist an immutable, single-style snapshot of the current draft."""
    with archive._lock:
        con = archive._conn()
        try:
            con.execute("BEGIN")
            row = con.execute(
                "SELECT config_json FROM prompt_draft WHERE singleton = 1"
            ).fetchone()
            if row is None:
                raise RuntimeError("prompt store is not initialized")
            draft = validate_draft(_decode(row["config_json"]))
            selected_style = _select_draft_style(draft, random_value)
            effective_spec = canonical_from_draft(draft, selected_style["id"])
            preview_messages = build_prompt_messages_from_spec(
                effective_spec,
                a="{{元素A}}",
                b="{{元素B}}",
                avoid_words=["{{近期结果}}"],
                bounty_candidates=[],
                community_examples=[],
                style_value=0,
            )
            created_at = time.time()
            version_id = (
                "prompt-"
                + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                + "-"
                + uuid.uuid4().hex[:8]
            )
            con.execute(
                """
                INSERT INTO prompt_versions(
                    id, created_at, selected_style_id, selected_style_name,
                    snapshot_json, effective_spec_json, preview
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    version_id,
                    created_at,
                    selected_style["id"],
                    selected_style["label"],
                    _json(draft),
                    _json(effective_spec),
                    _json(preview_messages),
                ),
            )
            stored_row = con.execute(
                "SELECT * FROM prompt_versions WHERE id = ?", (version_id,)
            ).fetchone()
            con.commit()
            return _version_from_row(stored_row)
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()


def get_version(version_id: str) -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            "SELECT * FROM prompt_versions WHERE id = ?", (version_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown prompt version: {version_id}")
        version = _version_from_row(row)
        validate_draft(version["snapshot"])
        validate_prompt_spec(version["effective_spec"])
        return version
    finally:
        con.close()


def activate_version(version_id: str) -> dict:
    """Point the singleton active state at an existing immutable version."""
    with archive._lock:
        con = archive._conn()
        try:
            con.execute("BEGIN")
            row = con.execute(
                "SELECT * FROM prompt_versions WHERE id = ?", (version_id,)
            ).fetchone()
            if row is None:
                raise KeyError(f"unknown prompt version: {version_id}")
            version = _version_from_row(row)
            validate_draft(version["snapshot"])
            validate_prompt_spec(version["effective_spec"])
            cursor = con.execute(
                """
                UPDATE prompt_state SET active_version_id = ?
                WHERE singleton = 1
                """,
                (version_id,),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("prompt store is not initialized")
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
    return version


def list_versions() -> List[dict]:
    con = archive._conn()
    try:
        rows = con.execute(
            "SELECT * FROM prompt_versions ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [_version_from_row(row) for row in rows]
    finally:
        con.close()
