"""Render combination prompts from the canonical shared specification."""

import json
import math
import random
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


SPEC_PATH = Path(__file__).parent.parent / "shared" / "combine-prompt.json"
MAX_SAFE_INTEGER = (1 << 53) - 1
PROMPT_WHITESPACE = frozenset(
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _require_record(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_boolean(value: Any, label: str) -> None:
    if type(value) is not bool:
        raise ValueError(f"{label} must be a boolean")


def _strip_prompt_whitespace(value: str) -> str:
    start = 0
    end = len(value)
    while start < end and value[start] in PROMPT_WHITESPACE:
        start += 1
    while end > start and value[end - 1] in PROMPT_WHITESPACE:
        end -= 1
    return value[start:end]


def _require_non_empty_string(value: Any, label: str) -> None:
    if not isinstance(value, str) or not _strip_prompt_whitespace(value):
        raise ValueError(f"{label} must be a non-empty string")


def _validate_id(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} id must be a string")
    stripped = _strip_prompt_whitespace(value)
    if not stripped:
        raise ValueError(f"{field} id must not be blank")
    if value != stripped:
        raise ValueError(f"{field} id must not have surrounding whitespace")
    return value


def _is_finite_number(value: Any) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _is_safe_integer_number(value: Any) -> bool:
    return (
        _is_finite_number(value)
        and float(value).is_integer()
        and abs(value) <= MAX_SAFE_INTEGER
    )


def _validate_system_module(item: Any) -> str:
    record = _require_record(item, "system_modules record")
    item_id = _validate_id(record.get("id"), "system_modules")
    _require_boolean(record.get("enabled"), "system_modules enabled")
    if not _is_safe_integer_number(record.get("order")):
        raise ValueError("system_modules order must be an integer")
    if record["enabled"]:
        _require_non_empty_string(record.get("content"), "system_modules content")
    return item_id


def _validate_example(item: Any) -> str:
    record = _require_record(item, "examples record")
    item_id = _validate_id(record.get("id"), "examples")
    _require_boolean(record.get("enabled"), "examples enabled")
    input_record = _require_record(record.get("input"), "examples input")
    _require_non_empty_string(input_record.get("a"), "examples input.a")
    _require_non_empty_string(input_record.get("b"), "examples input.b")
    output_record = _require_record(record.get("output"), "examples output")
    _require_non_empty_string(output_record.get("name"), "examples output.name")
    _require_non_empty_string(output_record.get("emoji"), "examples output.emoji")
    _require_non_empty_string(output_record.get("comment"), "examples output.comment")
    return item_id


def _validate_style(item: Any) -> str:
    record = _require_record(item, "styles record")
    item_id = _validate_id(record.get("id"), "styles")
    _require_boolean(record.get("enabled"), "styles enabled")
    if record["enabled"]:
        _require_non_empty_string(record.get("label"), "styles label")
        _require_non_empty_string(record.get("guidance"), "styles guidance")
    if not _is_finite_number(record.get("weight")):
        raise ValueError("styles weight must be a finite number")
    return item_id


def _validate_text_example(item: Any, field: str) -> str:
    record = _require_record(item, f"{field} record")
    item_id = _validate_id(record.get("id"), field)
    _require_boolean(record.get("enabled"), f"{field} enabled")
    if record["enabled"]:
        _require_non_empty_string(record.get("content"), f"{field} content")
    return item_id


def validate_prompt_spec(value: Any) -> Dict[str, Any]:
    record = _require_record(value, "prompt spec")
    schema_version = record.get("schema_version")
    if not _is_finite_number(schema_version) or schema_version != 1:
        raise ValueError("unsupported prompt schema version")
    temperature = record.get("temperature")
    if not _is_finite_number(temperature):
        raise ValueError("temperature must be finite")
    if not 0 <= temperature <= 2:
        raise ValueError("temperature must be between 0 and 2")

    validators = {
        "system_modules": _validate_system_module,
        "examples": _validate_example,
        "styles": _validate_style,
    }
    for field, validator in validators.items():
        items = record.get(field)
        if not isinstance(items, list):
            raise ValueError(f"{field} must be an array")
        ids = [validator(item) for item in items]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate {field} id")

    for field in ("positive_examples", "negative_examples"):
        if field not in record:
            continue
        items = record[field]
        if not isinstance(items, list):
            raise ValueError(f"{field} must be an array")
        ids = [_validate_text_example(item, field) for item in items]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate {field} id")

    enabled_modules = [
        item for item in record["system_modules"] if item["enabled"] is not False
    ]
    if not enabled_modules:
        raise ValueError("at least one system module must be enabled")

    enabled_styles = [
        item for item in record["styles"] if item["enabled"] is not False
    ]
    if any(item["weight"] <= 0 for item in enabled_styles):
        raise ValueError("enabled style weights must be positive")
    if abs(sum(item["weight"] for item in enabled_styles) - 1) > 1e-9:
        raise ValueError("style weights must sum to 1")

    capacities = _require_record(record.get("capacities"), "capacities")
    for name in ("community_formula_catalog", "recent_firsts"):
        if (
            not _is_safe_integer_number(capacities.get(name))
            or capacities[name] <= 0
        ):
            raise ValueError(f"{name} capacity must be a positive integer")

    limits = _require_record(record.get("limits"), "limits")
    for name in ("avoid_words", "community_examples", "bounty_candidates"):
        if not _is_safe_integer_number(limits.get(name)) or limits[name] <= 0:
            raise ValueError(f"{name} must be a positive integer")
    if limits["community_examples"] > capacities["community_formula_catalog"]:
        raise ValueError(
            "community_examples must not exceed community formula catalog capacity"
        )
    if limits["avoid_words"] > capacities["recent_firsts"]:
        raise ValueError(
            "avoid_words must not exceed recent firsts capacity"
        )
    return deepcopy(record)


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


@lru_cache(maxsize=1)
def load_prompt_spec() -> Dict[str, Any]:
    with SPEC_PATH.open(encoding="utf-8") as source:
        value = json.load(source, parse_constant=_reject_json_constant)
    return validate_prompt_spec(value)


def select_style(spec: Dict[str, Any], value: float) -> Dict[str, Any]:
    roll = max(0.0, min(0.9999999999999999, float(value)))
    cumulative = 0.0
    enabled = [item for item in spec["styles"] if item.get("enabled", True)]
    for item in enabled:
        cumulative += float(item["weight"])
        if roll < cumulative:
            return item
    return enabled[-1]


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_prompt_messages_from_spec(
    spec: Dict[str, Any],
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    bounty_candidates: Optional[List[Dict[str, Any]]] = None,
    community_examples: Optional[List[Dict[str, Any]]] = None,
    style_value: Optional[float] = None,
) -> Dict[str, Any]:
    style = select_style(spec, random.random() if style_value is None else style_value)
    system = "\n\n".join(
        item["content"]
        for item in sorted(spec["system_modules"], key=lambda item: item["order"])
        if item.get("enabled", True)
    )
    limits = spec["limits"]
    lines = ["【示例】"]

    for example in spec["examples"]:
        if not example.get("enabled", True):
            continue
        input_example = {
            "a": example["input"]["a"],
            "b": example["input"]["b"],
        }
        output_example = {
            "name": example["output"]["name"],
            "emoji": example["output"]["emoji"],
            "comment": example["output"]["comment"],
        }
        lines.append(f"输入：{_json(input_example)}")
        lines.append(f"输出：{_json(output_example)}")
    lines.append("")

    positive_examples = [
        item["content"]
        for item in spec.get("positive_examples", [])
        if item["enabled"]
    ]
    negative_examples = [
        item["content"]
        for item in spec.get("negative_examples", [])
        if item["enabled"]
    ]
    if positive_examples:
        lines.append("【正面案例】")
        lines.extend(positive_examples)
        lines.append("")
    if negative_examples:
        lines.append("【负面案例】")
        lines.extend(negative_examples)
        lines.append("")

    if community_examples:
        lines.append("【社区高质量示例（仅参考风格，不要照抄）】")
        for item in community_examples[: limits["community_examples"]]:
            input_example = {"a": item.get("a", ""), "b": item.get("b", "")}
            output_example = {
                "name": item.get("name", ""),
                "emoji": item.get("emoji", ""),
                "comment": item.get("comment", ""),
            }
            lines.append(f"输入：{_json(input_example)} 输出：{_json(output_example)}")
        lines.append("")

    if avoid_words:
        lines.append("【avoid_words（禁词，不要再用）】")
        lines.append("、".join(avoid_words[: limits["avoid_words"]]))
        lines.append("")

    if bounty_candidates:
        lines.append("【悬赏候选（未解锁 · 若语义顺理成章，请优先产出其中一个）】")
        for item in bounty_candidates[: limits["bounty_candidates"]]:
            name = item.get("name", "")
            if name:
                lines.append(
                    f"- {name} {item.get('emoji', '')}  [{item.get('category', '')}]"
                )
        lines.append("（以上词语义不合适就忽略，不要硬塞。）")
        lines.append("")

    lines.extend([
        f"【本次偏好】{style['label']}",
        style["guidance"],
        "",
        "【本次输入】",
        f"输入：{_json({'a': a, 'b': b})}",
        "输出：",
    ])
    return {
        "system": system,
        "user": "\n".join(lines),
        "temperature": float(spec["temperature"]),
        "style_id": style["id"],
    }


def build_prompt_messages(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    bounty_candidates: Optional[List[Dict[str, Any]]] = None,
    community_examples: Optional[List[Dict[str, Any]]] = None,
    style_value: Optional[float] = None,
) -> Dict[str, Any]:
    return build_prompt_messages_from_spec(
        load_prompt_spec(),
        a=a,
        b=b,
        avoid_words=avoid_words,
        bounty_candidates=bounty_candidates,
        community_examples=community_examples,
        style_value=style_value,
    )
