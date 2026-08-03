"""Application-level request limits shared with the Makers runtime."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CONTRACT_PATH = (
    Path(__file__).parent.parent / "shared" / "runtime-contract.json"
)
_LIMIT_FIELDS = (
    "max_combine_element_length",
    "max_discoverer_length",
    "max_session_id_length",
    "max_verify_recipes",
    "max_recipe_field_length",
)
_CONTRACT_FIELDS = frozenset(("schema_version", *_LIMIT_FIELDS))
_MAX_SAFE_INTEGER = (1 << 53) - 1


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def validate_runtime_contract(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ValueError("runtime contract must be an object")
    if set(value) != _CONTRACT_FIELDS:
        raise ValueError(
            "runtime contract must contain exactly the supported fields"
        )
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ValueError("unsupported runtime contract schema version")
    for field in _LIMIT_FIELDS:
        limit = value[field]
        if (
            type(limit) is not int
            or limit <= 0
            or limit > _MAX_SAFE_INTEGER
        ):
            raise ValueError(
                f"runtime contract {field} must be a positive safe integer"
            )
    return dict(value)


@lru_cache(maxsize=1)
def load_runtime_contract() -> dict[str, int]:
    with CONTRACT_PATH.open(encoding="utf-8") as source:
        value = json.load(source, parse_constant=_reject_json_constant)
    return validate_runtime_contract(value)


_CONTRACT = load_runtime_contract()
MAX_COMBINE_ELEMENT_LENGTH = _CONTRACT["max_combine_element_length"]
MAX_DISCOVERER_LENGTH = _CONTRACT["max_discoverer_length"]
MAX_SESSION_ID_LENGTH = _CONTRACT["max_session_id_length"]
MAX_VERIFY_RECIPES = _CONTRACT["max_verify_recipes"]
MAX_RECIPE_FIELD_LENGTH = _CONTRACT["max_recipe_field_length"]
