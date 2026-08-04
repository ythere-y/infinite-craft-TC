"""Persistent local prompt drafts and active prompt specifications."""

from __future__ import annotations

import copy
import json
import random
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, List, Optional, TypeVar

from . import archive
from .prompt_spec import (
    PROMPT_WHITESPACE,
    _strip_prompt_whitespace,
    build_prompt_messages_from_spec,
    load_prompt_spec,
    validate_prompt_spec,
)


class PromptValidationError(ValueError):
    """Raised when an editable prompt draft is not publishable."""


class PromptRevisionConflict(RuntimeError):
    """Raised when an administrator mutates a stale draft revision."""

    def __init__(self, expected_revision: int, current_revision: int):
        super().__init__("prompt draft has changed; reload before continuing")
        self.expected_revision = expected_revision
        self.current_revision = current_revision


class PromptStoreBusyError(RuntimeError):
    """Raised after the bounded SQLite busy retry budget is exhausted."""


class PromptStoreCorruptionError(RuntimeError):
    """Raised when persisted prompt data cannot be safely decoded or validated."""

    def __init__(
        self,
        *,
        record_type: str,
        record_id: str,
        error_type: str,
    ):
        super().__init__("persisted prompt data is invalid")
        self.record_type = record_type
        self.record_id = record_id
        self.error_type = error_type


_WRITE_BUSY_TIMEOUT_SECONDS = 0.1
_WRITE_BUSY_RETRY_DELAYS = (0.02, 0.05)
_MAX_PROBABILITY_DECIMAL_PLACES = 6
_MAX_PROBABILITY_EXPONENT = 1000
_PROBABILITY_DECIMAL_PLACES_ERROR = (
    "\u98ce\u683c\u6982\u7387\u7684\u5c0f\u6570\u4f4d\u6570\u4e0d\u80fd\u8d85\u8fc7 6"
)
_ECMASCRIPT_TRIM_WHITESPACE = "".join(
    sorted(PROMPT_WHITESPACE - frozenset("\u0085"))
)
_PROBABILITY_DECIMAL_PATTERN = re.compile(
    r"^[+-]?(?:(?:[0-9]+(?:\.(?P<fraction>[0-9]*))?)"
    r"|(?:\.(?P<leading_fraction>[0-9]+)))"
    r"(?:[eE](?P<exponent>[+-]?[0-9]+))?$"
)
MAX_VERSION_OFFSET = (1 << 63) - 1
_T = TypeVar("_T")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _stored_corruption(
    *,
    record_type: str,
    record_id: str,
    error: BaseException,
) -> PromptStoreCorruptionError:
    return PromptStoreCorruptionError(
        record_type=record_type,
        record_id=record_id,
        error_type=type(error).__name__,
    )


def _decode_stored(
    value: str,
    *,
    record_type: str,
    record_id: str,
) -> Dict[str, Any]:
    try:
        decoded = json.loads(value)
        if not isinstance(decoded, dict):
            raise ValueError("stored prompt value must be an object")
        return decoded
    except (TypeError, ValueError) as exc:
        raise _stored_corruption(
            record_type=record_type,
            record_id=record_id,
            error=exc,
        ) from None


def _validate_stored_draft(
    value: str,
    *,
    record_type: str,
    record_id: str,
) -> dict:
    try:
        decoded = _decode_stored(
            value,
            record_type=record_type,
            record_id=record_id,
        )
        return validate_draft(decoded)
    except PromptStoreCorruptionError:
        raise
    except (TypeError, ValueError) as exc:
        raise _stored_corruption(
            record_type=record_type,
            record_id=record_id,
            error=exc,
        ) from None


def _validate_stored_spec(
    value: str,
    *,
    record_type: str,
    record_id: str,
) -> dict:
    try:
        decoded = _decode_stored(
            value,
            record_type=record_type,
            record_id=record_id,
        )
        return validate_prompt_spec(decoded)
    except PromptStoreCorruptionError:
        raise
    except (TypeError, ValueError) as exc:
        raise _stored_corruption(
            record_type=record_type,
            record_id=record_id,
            error=exc,
        ) from None


def _is_sqlite_busy(exc: sqlite3.OperationalError) -> bool:
    code = getattr(exc, "sqlite_errorcode", None)
    if isinstance(code, int):
        primary_code = code & 0xFF
        if primary_code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
            return True
    message = str(exc).lower()
    return "database is locked" in message or "database table is locked" in message


def _write_transaction(callback: Callable[[sqlite3.Connection], _T]) -> _T:
    """Run a write transaction with an up-front lock and finite busy retries."""
    with archive._lock:
        for attempt in range(len(_WRITE_BUSY_RETRY_DELAYS) + 1):
            con: sqlite3.Connection | None = None
            try:
                con = archive._conn(timeout=_WRITE_BUSY_TIMEOUT_SECONDS)
                con.execute("BEGIN IMMEDIATE")
                result = callback(con)
                con.commit()
                return result
            except sqlite3.OperationalError as exc:
                if con is not None:
                    con.rollback()
                if not _is_sqlite_busy(exc):
                    raise
                if attempt >= len(_WRITE_BUSY_RETRY_DELAYS):
                    raise PromptStoreBusyError() from None
                time.sleep(_WRITE_BUSY_RETRY_DELAYS[attempt])
            except Exception:
                if con is not None:
                    con.rollback()
                raise
            finally:
                if con is not None:
                    con.close()
    raise AssertionError("unreachable prompt transaction state")


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


def _parse_probability_decimal(value: Any) -> Decimal:
    if isinstance(value, bool):
        raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")
    text = str(value).strip(_ECMASCRIPT_TRIM_WHITESPACE)
    match = _PROBABILITY_DECIMAL_PATTERN.fullmatch(text)
    if match is None:
        raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")
    try:
        exponent = int(match.group("exponent") or 0)
    except ValueError:
        raise PromptValidationError(
            "风格概率必须是 0 到 100 的有限数字"
        ) from None
    fraction = match.group("fraction") or match.group("leading_fraction") or ""
    scale = len(fraction) - exponent
    if scale > _MAX_PROBABILITY_DECIMAL_PLACES:
        raise PromptValidationError(_PROBABILITY_DECIMAL_PLACES_ERROR)
    if abs(exponent) > _MAX_PROBABILITY_EXPONENT:
        raise PromptValidationError("风格概率的小数位数不能超过 1000")
    try:
        number = Decimal(text)
    except (InvalidOperation, ValueError):
        raise PromptValidationError(
            "风格概率必须是 0 到 100 的有限数字"
        ) from None
    if not number.is_finite():
        raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")
    return number


def _probability(value: Any) -> float:
    number = _parse_probability_decimal(value)
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


def _probability_coefficient_and_scale(value: Decimal) -> tuple[int, int]:
    decimal_tuple = value.as_tuple()
    exponent = int(decimal_tuple.exponent)
    if exponent < -_MAX_PROBABILITY_DECIMAL_PLACES:
        raise PromptValidationError(_PROBABILITY_DECIMAL_PLACES_ERROR)
    if exponent > _MAX_PROBABILITY_EXPONENT:
        raise PromptValidationError("风格概率的小数位数不能超过 1000")
    coefficient = int("".join(str(digit) for digit in decimal_tuple.digits))
    if decimal_tuple.sign:
        coefficient = -coefficient
    if exponent >= 0:
        return coefficient * (10 ** exponent), 0
    return coefficient, -exponent


def _probabilities_sum_to_100(values: List[Decimal]) -> bool:
    parts = [_probability_coefficient_and_scale(value) for value in values]
    scale = max((part_scale for _coefficient, part_scale in parts), default=0)
    total = sum(
        coefficient * (10 ** (scale - part_scale))
        for coefficient, part_scale in parts
    )
    return total == 100 * (10 ** scale)


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

    enabled_probabilities: List[Decimal] = []
    for style in styles:
        value = style.get("probability")
        probability = _parse_probability_decimal(value)
        if not probability.is_finite() or not Decimal("0") <= probability <= Decimal(
            "100"
        ):
            raise PromptValidationError("风格概率必须是 0 到 100 的有限数字")
        _probability_coefficient_and_scale(probability)
        if style["enabled"]:
            enabled_probabilities.append(probability)

    if not _probabilities_sum_to_100(enabled_probabilities):
        raise PromptValidationError("已启用风格的概率总和必须等于 100%")

    try:
        canonical_from_draft(validated)
    except (TypeError, ValueError) as exc:
        raise PromptValidationError(str(exc)) from exc
    return validated


def _selected_style_from_row(row: Any) -> dict | None:
    if row["selected_style_id"] is None:
        return None
    return {
        "id": row["selected_style_id"],
        "name": row["selected_style_name"],
    }


def _version_from_row(row: Any) -> dict:
    version_id = str(row["id"])
    return {
        "id": version_id,
        "created_at": row["created_at"],
        "selected_style_id": row["selected_style_id"],
        "selected_style_name": row["selected_style_name"],
        "selected_style": _selected_style_from_row(row),
        "snapshot": _validate_stored_draft(
            row["snapshot_json"],
            record_type="prompt_version_snapshot",
            record_id=version_id,
        ),
        "effective_spec": _validate_stored_spec(
            row["effective_spec_json"],
            record_type="prompt_version_spec",
            record_id=version_id,
        ),
        "preview": row["preview"],
    }


def _version_summary_from_row(row: Any) -> dict:
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "selected_style_id": row["selected_style_id"],
        "selected_style_name": row["selected_style_name"],
        "selected_style": _selected_style_from_row(row),
    }


def _render_preview(spec: dict) -> str:
    messages = build_prompt_messages_from_spec(
        spec,
        a="{{元素A}}",
        b="{{元素B}}",
        avoid_words=["{{近期结果}}"],
        bounty_candidates=[],
        community_examples=[],
        style_value=0,
    )
    return _json(messages)


def _missing_store_record(record_type: str, record_id: str) -> None:
    raise PromptStoreCorruptionError(
        record_type=record_type,
        record_id=record_id,
        error_type="MissingRecord",
    )


def _draft_state_from_row(row: Any) -> dict:
    revision = row["revision"]
    if type(revision) is not int or revision < 1:
        raise PromptStoreCorruptionError(
            record_type="prompt_draft",
            record_id="singleton",
            error_type="InvalidRevision",
        )
    return {
        "config": _validate_stored_draft(
            row["config_json"],
            record_type="prompt_draft",
            record_id="singleton",
        ),
        "revision": revision,
    }


def _validate_expected_revision(expected_revision: int) -> int:
    if type(expected_revision) is not int or expected_revision < 1:
        raise PromptValidationError("draft revision must be a positive integer")
    return expected_revision


def init_prompt_store() -> None:
    """Create or validate the initial draft and active version atomically."""
    archive.init_archive()

    def initialize(con: sqlite3.Connection) -> None:
        draft_row = con.execute(
            """
            SELECT config_json, revision
            FROM prompt_draft
            WHERE singleton = 1
            """
        ).fetchone()
        if draft_row is not None:
            _draft_state_from_row(draft_row)
            active_row = con.execute(
                """
                SELECT
                    v.id, v.created_at, v.selected_style_id,
                    v.selected_style_name, v.snapshot_json,
                    v.effective_spec_json, v.preview
                FROM prompt_state AS state
                JOIN prompt_versions AS v ON v.id = state.active_version_id
                WHERE state.singleton = 1
                """
            ).fetchone()
            if active_row is None:
                _missing_store_record("prompt_state", "singleton")
            active = _version_from_row(active_row)
            if not active["preview"]:
                con.execute(
                    "UPDATE prompt_versions SET preview = ? WHERE id = ?",
                    (_render_preview(active["effective_spec"]), active["id"]),
                )
            return

        canonical = load_prompt_spec()
        draft = draft_from_canonical(canonical)
        created_at = time.time()
        version_id = "prompt-initial-" + datetime.now(timezone.utc).strftime(
            "%Y%m%dT%H%M%S%fZ"
        )
        con.execute(
            """
            INSERT INTO prompt_draft(
                singleton, config_json, updated_at, revision
            ) VALUES (1, ?, ?, 1)
            """,
            (_json(draft), created_at),
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
                None,
                None,
                _json(draft),
                _json(canonical),
                _render_preview(canonical),
            ),
        )
        con.execute(
            "INSERT INTO prompt_state(singleton, active_version_id) VALUES (1, ?)",
            (version_id,),
        )

    _write_transaction(initialize)


def get_draft_state() -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            """
            SELECT config_json, revision
            FROM prompt_draft
            WHERE singleton = 1
            """
        ).fetchone()
        if row is None:
            _missing_store_record("prompt_draft", "singleton")
        return _draft_state_from_row(row)
    finally:
        con.close()


def get_draft() -> dict:
    return get_draft_state()["config"]


def save_draft(draft: dict, *, expected_revision: int) -> dict:
    expected = _validate_expected_revision(expected_revision)
    stored = validate_draft(draft)

    def save(con: sqlite3.Connection) -> dict:
        row = con.execute(
            "SELECT revision FROM prompt_draft WHERE singleton = 1"
        ).fetchone()
        if row is None:
            _missing_store_record("prompt_draft", "singleton")
        current = row["revision"]
        if type(current) is not int or current < 1:
            _missing_store_record("prompt_draft_revision", "singleton")
        if current != expected:
            raise PromptRevisionConflict(expected, current)
        cursor = con.execute(
            """
            UPDATE prompt_draft
            SET config_json = ?, updated_at = ?, revision = revision + 1
            WHERE singleton = 1 AND revision = ?
            """,
            (_json(stored), time.time(), expected),
        )
        if cursor.rowcount != 1:
            refreshed = con.execute(
                "SELECT revision FROM prompt_draft WHERE singleton = 1"
            ).fetchone()
            if refreshed is None:
                _missing_store_record("prompt_draft", "singleton")
            raise PromptRevisionConflict(expected, refreshed["revision"])
        return {"config": stored, "revision": expected + 1}

    return _write_transaction(save)


def get_active_version() -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            """
            SELECT
                v.id, v.created_at, v.selected_style_id,
                v.selected_style_name, v.snapshot_json,
                v.effective_spec_json, v.preview
            FROM prompt_state AS state
            JOIN prompt_versions AS v ON v.id = state.active_version_id
            WHERE state.singleton = 1
            """
        ).fetchone()
        if row is None:
            _missing_store_record("prompt_state", "singleton")
        return _version_from_row(row)
    finally:
        con.close()


def get_active_version_summary() -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            """
            SELECT
                v.id, v.created_at, v.selected_style_id,
                v.selected_style_name
            FROM prompt_state AS state
            JOIN prompt_versions AS v ON v.id = state.active_version_id
            WHERE state.singleton = 1
            """
        ).fetchone()
        if row is None:
            _missing_store_record("prompt_state", "singleton")
        return _version_summary_from_row(row)
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


def aggregate_draft(
    *,
    expected_revision: int,
    random_value: float | None = None,
) -> dict:
    """Persist an immutable, single-style snapshot of the current draft."""
    expected = _validate_expected_revision(expected_revision)

    def aggregate(con: sqlite3.Connection) -> dict:
        row = con.execute(
            """
            SELECT config_json, revision
            FROM prompt_draft
            WHERE singleton = 1
            """
        ).fetchone()
        if row is None:
            _missing_store_record("prompt_draft", "singleton")
        current = row["revision"]
        if type(current) is not int or current < 1:
            _missing_store_record("prompt_draft_revision", "singleton")
        if current != expected:
            raise PromptRevisionConflict(expected, current)
        draft = _validate_stored_draft(
            row["config_json"],
            record_type="prompt_draft",
            record_id="singleton",
        )
        selected_style = _select_draft_style(draft, random_value)
        effective_spec = canonical_from_draft(draft, selected_style["id"])
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
                _render_preview(effective_spec),
            ),
        )
        stored_row = con.execute(
            """
            SELECT
                id, created_at, selected_style_id, selected_style_name,
                snapshot_json, effective_spec_json, preview
            FROM prompt_versions
            WHERE id = ?
            """,
            (version_id,),
        ).fetchone()
        return _version_from_row(stored_row)

    return _write_transaction(aggregate)


def get_version(version_id: str) -> dict:
    con = archive._conn()
    try:
        row = con.execute(
            """
            SELECT
                id, created_at, selected_style_id, selected_style_name,
                snapshot_json, effective_spec_json, preview
            FROM prompt_versions
            WHERE id = ?
            """,
            (version_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown prompt version: {version_id}")
        return _version_from_row(row)
    finally:
        con.close()


def activate_version(version_id: str) -> dict:
    """Point the singleton active state at an existing immutable version."""
    def activate(con: sqlite3.Connection) -> dict:
        row = con.execute(
            """
            SELECT
                id, created_at, selected_style_id, selected_style_name,
                snapshot_json, effective_spec_json, preview
            FROM prompt_versions
            WHERE id = ?
            """,
            (version_id,),
        ).fetchone()
        if row is None:
            raise KeyError(f"unknown prompt version: {version_id}")
        version = _version_from_row(row)
        cursor = con.execute(
            """
            UPDATE prompt_state SET active_version_id = ?
            WHERE singleton = 1
            """,
            (version_id,),
        )
        if cursor.rowcount != 1:
            _missing_store_record("prompt_state", "singleton")
        return version

    return _write_transaction(activate)


def list_versions(*, limit: int = 50, offset: int = 0) -> List[dict]:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("version limit must be between 1 and 100")
    if type(offset) is not int or not 0 <= offset <= MAX_VERSION_OFFSET:
        raise ValueError("version offset is outside SQLite integer range")
    con = archive._conn()
    try:
        rows = con.execute(
            """
            SELECT
                id, created_at, selected_style_id, selected_style_name
            FROM prompt_versions
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
        return [_version_summary_from_row(row) for row in rows]
    finally:
        con.close()
