"""Validated access to the base seed graph plus compiled bounty content."""

from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from typing import Any


_ROOT = Path(__file__).resolve().parent.parent
SEED_ELEMENTS_PATH = _ROOT / "backend" / "seed_elements.json"
SEED_COMBINATIONS_PATH = _ROOT / "backend" / "seed_combinations.json"
BOUNTY_CONTENT_PATH = _ROOT / "backend" / "generated" / "bounty-content.json"

_CONTENT_EPOCH = 2
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_BINDING_STARTERS = (
    "水",
    "火",
    "风",
    "土",
    "企鹅",
    "人",
    "时间",
    "AI",
    "电脑",
    "手机",
    "网络",
)


def _read_object(path: Path, label: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _normalize_pair(a: str, b: str) -> str:
    return " + ".join(sorted((a.strip(), b.strip())))


def _parse_pair(raw_pair: str, label: str) -> tuple[str, str]:
    parts = [part.strip() for part in raw_pair.split(" + ")]
    if len(parts) != 2 or not all(parts):
        raise ValueError(
            f'{label} must contain two names separated by " + "'
        )
    return parts[0], parts[1]


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _digest_source(
    catalog: dict[str, Any],
    seed_elements: dict[str, Any],
    seed_combinations: dict[str, Any],
) -> dict[str, Any]:
    normalized_combinations = {}
    combinations = seed_combinations.get("combinations")
    if not isinstance(combinations, dict):
        raise ValueError("seed combinations must contain an object")
    for raw_pair, recipe in sorted(combinations.items()):
        if not isinstance(recipe, dict):
            raise ValueError(f"seed recipe {raw_pair} must be an object")
        a, b = _parse_pair(raw_pair, f"seed pair {raw_pair}")
        pair = _normalize_pair(a, b)
        if pair in normalized_combinations:
            raise ValueError(f"duplicate normalized seed pair {pair}")
        normalized_combinations[pair] = {**recipe, "a": a, "b": b}
    return {
        "catalog": catalog,
        "seedElements": seed_elements,
        "seedCombinations": {
            **seed_combinations,
            "combinations": normalized_combinations,
        },
    }


def _validate_base_content(
    compiled: dict[str, Any],
    seed_elements: dict[str, Any],
    seed_combinations: dict[str, Any],
) -> None:
    base_starters = seed_elements.get("starters")
    compiled_starters = compiled.get("starters")
    if not isinstance(base_starters, list) or compiled_starters != base_starters:
        raise ValueError("compiled starters conflict with base seed starters")

    base_elements = seed_elements.get("elements")
    compiled_elements = compiled.get("elements")
    if not isinstance(base_elements, dict) or not isinstance(
        compiled_elements, dict
    ):
        raise ValueError("seed and compiled elements must be objects")
    for name, info in base_elements.items():
        if compiled_elements.get(name) != info:
            raise ValueError(f"compiled element conflicts with base seed: {name}")

    base_combinations = seed_combinations.get("combinations")
    compiled_combinations = compiled.get("combinations")
    if not isinstance(base_combinations, dict) or not isinstance(
        compiled_combinations, dict
    ):
        raise ValueError("seed and compiled combinations must be objects")
    normalized_base: dict[str, dict[str, Any]] = {}
    for raw_pair, info in base_combinations.items():
        if not isinstance(info, dict):
            raise ValueError(f"seed recipe {raw_pair} must be an object")
        a, b = _parse_pair(raw_pair, f"seed pair {raw_pair}")
        pair = _normalize_pair(a, b)
        if pair in normalized_base:
            raise ValueError(f"duplicate normalized seed pair {pair}")
        normalized_base[pair] = info

    for pair, base_info in normalized_base.items():
        compiled_info = compiled_combinations.get(pair)
        if not isinstance(compiled_info, dict):
            raise ValueError(f"compiled content is missing base pair {pair}")
        for field in ("result", "emoji", "chain"):
            if compiled_info.get(field) != base_info.get(field):
                raise ValueError(
                    f"compiled pair conflicts with base seed: {pair}"
                )


def _validate_starter_binding(starters_value: Any) -> None:
    if not isinstance(starters_value, list):
        raise ValueError("compiled starter binding must be an array")
    names = []
    for index, starter in enumerate(starters_value):
        if not isinstance(starter, dict) or not isinstance(
            starter.get("name"), str
        ):
            raise ValueError(f"compiled starter binding row {index} is invalid")
        names.append(starter["name"])
    if tuple(names) != _BINDING_STARTERS:
        raise ValueError(
            "compiled content must use the exact eleven ordered starter binding"
        )


def _catalog_projection(
    catalog: dict[str, Any],
    seed_elements: dict[str, Any],
    seed_combinations: dict[str, Any],
) -> dict[str, Any]:
    targets = catalog.get("targets")
    support_elements = catalog.get("support_elements")
    support_recipes = catalog.get("support_recipes")
    if not all(
        isinstance(value, dict)
        for value in (targets, support_elements, support_recipes)
    ):
        raise ValueError(
            "compiled catalog targets and support content must be objects"
        )

    base_elements = seed_elements.get("elements")
    base_combinations = seed_combinations.get("combinations")
    if not isinstance(base_elements, dict) or not isinstance(
        base_combinations, dict
    ):
        raise ValueError("base seed elements and combinations must be objects")

    elements = {**base_elements, **support_elements}
    aliases = {}
    canonical_recipes = {}
    for name, target in targets.items():
        if not isinstance(target, dict):
            raise ValueError(f"catalog target {name} must be an object")
        recipe = target.get("canonical_recipe")
        if not isinstance(recipe, dict):
            raise ValueError(
                f"catalog target {name} must have a canonical recipe"
            )
        element = {
            key: value
            for key, value in target.items()
            if key != "canonical_recipe"
        }
        elements[name] = element
        canonical_recipes[name] = {**recipe, "result": name}
        target_aliases = target.get("aliases", [])
        if not isinstance(target_aliases, list):
            raise ValueError(f"catalog target {name} aliases must be an array")
        for alias in target_aliases:
            if alias in aliases:
                raise ValueError(f"duplicate catalog alias {alias}")
            aliases[alias] = name

    combinations: dict[str, dict[str, Any]] = {}

    def add_recipe(
        raw_pair: str,
        recipe: Any,
        *,
        source: str,
        result: str | None = None,
        emoji: str | None = None,
    ) -> None:
        if not isinstance(recipe, dict):
            raise ValueError(f"catalog recipe {raw_pair} must be an object")
        pair_a, pair_b = _parse_pair(raw_pair, f"catalog pair {raw_pair}")
        pair = _normalize_pair(pair_a, pair_b)
        a = recipe.get("a", pair_a)
        b = recipe.get("b", pair_b)
        if (
            not isinstance(a, str)
            or not isinstance(b, str)
            or _normalize_pair(a, b) != pair
        ):
            raise ValueError(
                f"catalog recipe inputs conflict with pair {raw_pair}"
            )
        if pair in combinations:
            raise ValueError(f"catalog pair conflict for {pair}")
        projected = {
            **recipe,
            "a": a,
            "b": b,
            "source": source,
        }
        if result is not None:
            projected["result"] = result
        if emoji is not None:
            projected["emoji"] = emoji
        combinations[pair] = projected

    for raw_pair, recipe in base_combinations.items():
        add_recipe(raw_pair, recipe, source="seed")
    for raw_pair, recipe in support_recipes.items():
        add_recipe(raw_pair, recipe, source="support")
    for name, target in targets.items():
        recipe = target["canonical_recipe"]
        raw_pair = f"{recipe.get('a', '')} + {recipe.get('b', '')}"
        add_recipe(
            raw_pair,
            recipe,
            source="target",
            result=name,
            emoji=target.get("emoji"),
        )

    return {
        "elements": elements,
        "combinations": combinations,
        "aliases": aliases,
        "canonical_recipes": canonical_recipes,
        "bounty": {
            "tabs": catalog.get("tabs"),
            "groups": catalog.get("groups"),
        },
        "retired_pairs": catalog.get("retired_pairs", []),
        "retired_elements": catalog.get("retired_elements", []),
    }


def _calculate_depths(
    starters_value: list[dict[str, Any]],
    combinations: dict[str, dict[str, Any]],
) -> dict[str, int]:
    starter_names = []
    for index, starter in enumerate(starters_value):
        if not isinstance(starter, dict) or not isinstance(
            starter.get("name"), str
        ):
            raise ValueError(f"starter {index} must have a name")
        starter_names.append(starter["name"])
    if len(set(starter_names)) != len(starter_names):
        raise ValueError("compiled starters contain duplicates")

    recipes = []
    for raw_pair, recipe in combinations.items():
        if not isinstance(recipe, dict) or not recipe.get("result"):
            raise ValueError(f"compiled recipe {raw_pair} is malformed")
        a, b = _parse_pair(raw_pair, f"compiled pair {raw_pair}")
        pair = _normalize_pair(a, b)
        if pair != raw_pair:
            raise ValueError(f"compiled pair is not normalized: {raw_pair}")
        if recipe.get("a") != a or recipe.get("b") != b:
            recipe_inputs = _normalize_pair(
                str(recipe.get("a", "")),
                str(recipe.get("b", "")),
            )
            if recipe_inputs != pair:
                raise ValueError(
                    f"compiled recipe inputs conflict with pair {raw_pair}"
                )
        recipes.append((a, b, recipe["result"]))

    depths = {name: 0 for name in starter_names}
    for _ in range(len(recipes)):
        changed = False
        for a, b, result in recipes:
            a_depth = depths.get(a)
            b_depth = depths.get(b)
            if a_depth is None or b_depth is None:
                continue
            candidate = max(a_depth, b_depth) + 1
            if result not in depths or candidate < depths[result]:
                depths[result] = candidate
                changed = True
        if not changed:
            break

    for a, b, _ in recipes:
        for name in (a, b):
            if name not in depths:
                raise ValueError(f"compiled recipe input is unreachable: {name}")
    return depths


def _validate_compiled_content(
    compiled: dict[str, Any],
    seed_elements: dict[str, Any],
    seed_combinations: dict[str, Any],
) -> None:
    if compiled.get("content_epoch") != _CONTENT_EPOCH:
        raise ValueError(
            f"compiled content_epoch must be {_CONTENT_EPOCH}"
        )
    catalog = compiled.get("catalog")
    if not isinstance(catalog, dict):
        raise ValueError("compiled catalog must be an object")
    if catalog.get("meta", {}).get("content_epoch") != _CONTENT_EPOCH:
        raise ValueError("compiled catalog epoch does not match content_epoch")
    catalog_policy = catalog.get("meta", {}).get("destructive_reset_from")
    compiled_policy = compiled.get("destructive_reset_from")
    if (
        not isinstance(catalog_policy, list)
        or not catalog_policy
        or compiled_policy != catalog_policy
    ):
        raise ValueError(
            "compiled destructive_reset_from must exactly match catalog metadata"
        )
    seen_policy_entries: set[str | int] = set()
    for entry in compiled_policy:
        valid_legacy = entry == "legacy"
        valid_epoch = (
            isinstance(entry, int)
            and not isinstance(entry, bool)
            and 0 < entry < _CONTENT_EPOCH
        )
        if not valid_legacy and not valid_epoch:
            raise ValueError(
                "compiled destructive_reset_from entries must be legacy "
                "or lower positive epochs"
            )
        if entry in seen_policy_entries:
            raise ValueError(
                "compiled destructive_reset_from entries must be unique"
            )
        seen_policy_entries.add(entry)

    digest = compiled.get("catalog_digest")
    if not isinstance(digest, str) or not _DIGEST_PATTERN.fullmatch(digest):
        raise ValueError("compiled catalog_digest is malformed")
    expected_digest = _canonical_digest(
        _digest_source(catalog, seed_elements, seed_combinations)
    )
    if digest != expected_digest:
        raise ValueError("compiled catalog_digest does not match base content")

    _validate_base_content(compiled, seed_elements, seed_combinations)
    _validate_starter_binding(compiled.get("starters"))
    projection = _catalog_projection(
        catalog,
        seed_elements,
        seed_combinations,
    )
    for field in (
        "elements",
        "combinations",
        "aliases",
        "canonical_recipes",
        "bounty",
        "retired_pairs",
        "retired_elements",
    ):
        if compiled.get(field) != projection[field]:
            raise ValueError(
                f"compiled {field} does not match catalog projection"
            )

    expected_recipes_by_result: dict[str, list[dict[str, Any]]] = {}
    for recipe in compiled["combinations"].values():
        expected_recipes_by_result.setdefault(recipe["result"], []).append(
            recipe
        )
    if compiled.get("recipes_by_result") != expected_recipes_by_result:
        raise ValueError(
            "compiled recipes_by_result does not match combination projection"
        )

    starters_value = compiled.get("starters")
    combinations = compiled.get("combinations")
    depths = compiled.get("depths")
    if not isinstance(starters_value, list) or not isinstance(
        combinations, dict
    ) or not isinstance(depths, dict):
        raise ValueError("compiled starters, combinations, and depths are required")
    calculated_depths = _calculate_depths(starters_value, combinations)
    if depths != calculated_depths:
        raise ValueError("compiled depths do not match strict starter reachability")

    bounty = compiled.get("bounty")
    groups = bounty.get("groups") if isinstance(bounty, dict) else None
    if not isinstance(groups, list):
        raise ValueError("compiled bounty groups are required")
    starter_names = {starter["name"] for starter in starters_value}
    for group in groups:
        targets = group.get("targets") if isinstance(group, dict) else None
        if not isinstance(targets, list):
            raise ValueError("compiled bounty group targets must be an array")
        for target in targets:
            if target in starter_names or target not in depths:
                raise ValueError(
                    f"bounty target is not strictly reachable: {target}"
                )


@lru_cache(maxsize=1)
def load_compiled_content() -> dict:
    seed_elements = _read_object(SEED_ELEMENTS_PATH, "seed elements")
    seed_combinations = _read_object(
        SEED_COMBINATIONS_PATH, "seed combinations"
    )
    compiled = _read_object(BOUNTY_CONTENT_PATH, "compiled bounty content")
    _validate_compiled_content(compiled, seed_elements, seed_combinations)
    return compiled


def merged_elements() -> dict[str, dict]:
    return load_compiled_content()["elements"]


def merged_combinations() -> dict[str, dict]:
    return load_compiled_content()["combinations"]


def starters() -> list[dict]:
    return load_compiled_content()["starters"]


def destructive_reset_from() -> tuple[str | int, ...]:
    return tuple(load_compiled_content()["destructive_reset_from"])


def normalize_alias(name: str) -> str:
    return load_compiled_content()["aliases"].get(name, name)


def _load_runtime_content(
    seed_elements_path: Path = SEED_ELEMENTS_PATH,
    seed_combinations_path: Path = SEED_COMBINATIONS_PATH,
) -> dict:
    """Load merged production content while preserving isolated seed fixtures."""
    if (
        seed_elements_path == SEED_ELEMENTS_PATH
        and seed_combinations_path == SEED_COMBINATIONS_PATH
    ):
        return load_compiled_content()
    seed_elements = _read_object(seed_elements_path, "seed elements")
    seed_combinations = _read_object(
        seed_combinations_path, "seed combinations"
    )
    return {
        "starters": seed_elements.get("starters", []),
        "elements": seed_elements.get("elements", {}),
        "combinations": seed_combinations.get("combinations", {}),
    }
