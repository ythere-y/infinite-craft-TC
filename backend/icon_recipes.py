"""Deterministic element icon recipe resolution.

Persisted recipes and exact generated presets are stable identities. Dynamic
recipes are derived only from committed JSON rules and request context.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NotRequired, TypedDict


class IconRecipe(TypedDict):
    base: str
    palette: str
    source: str
    badge: NotRequired[str]


_BACKEND_DIR = Path(__file__).parent
_PROJECT_DIR = _BACKEND_DIR.parent
_RULES_PATH = _BACKEND_DIR / "icon_rules.json"
_PRESET_PATH = (
    _PROJECT_DIR
    / "frontend"
    / "assets"
    / "icons"
    / "generated"
    / "element-icon-map.json"
)


def _read_object(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


_RULES = _read_object(_RULES_PATH)
_PRESETS = _read_object(_PRESET_PATH)
_PALETTES = frozenset(_RULES.get("palettes", ()))
_SOURCES = frozenset(_RULES.get("allowed_sources", ()))


def normalize_icon(value: object) -> dict | None:
    """Return a canonical recipe, or ``None`` for malformed historic data."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(value, dict):
        return None

    base = value.get("base")
    palette = value.get("palette")
    source = value.get("source")
    if not isinstance(base, str) or not base.strip():
        return None
    if palette not in _PALETTES or source not in _SOURCES:
        return None

    recipe: IconRecipe = {
        "base": base,
        "palette": palette,
        "source": source,
    }
    badge = value.get("badge")
    if badge is not None:
        if not isinstance(badge, str) or not badge.strip() or badge == base:
            return None
        recipe["badge"] = badge
    return dict(recipe)


def preset_icon(name: str) -> dict | None:
    """Resolve an exact-name preset from the generated 591-element map."""
    row = _PRESETS.get(name)
    if not isinstance(row, dict):
        return None
    return normalize_icon(row.get("icon", row))


def _context_text(
    *,
    name: str,
    category: str | None,
    parents: tuple[str, ...],
    chain: str | None,
    comment: str,
) -> str:
    return " ".join(
        part
        for part in (
            name,
            *parents,
            category or "",
            chain or "",
            comment,
        )
        if isinstance(part, str) and part
    ).casefold()


def _dynamic_badge(
    *,
    text: str,
    category: str | None,
    chain: str | None,
    base: str,
) -> str | None:
    for rule in _RULES.get("keyword_badges", ()):
        if not isinstance(rule, dict):
            continue
        categories = rule.get("categories")
        if isinstance(categories, list) and categories:
            if category not in categories and chain not in categories:
                continue
        keywords = rule.get("keywords")
        if not isinstance(keywords, list):
            continue
        if not any(
            isinstance(keyword, str)
            and keyword
            and keyword.casefold() in text
            for keyword in keywords
        ):
            continue
        badge = rule.get("badge")
        if isinstance(badge, str) and badge and badge != base:
            return badge
    return None


def resolve_icon_recipe(
    *,
    name: str,
    emoji: str,
    category: str | None,
    parents: tuple[str, ...] = (),
    chain: str | None = None,
    comment: str = "",
    persisted: object = None,
) -> dict:
    """Resolve persisted, exact preset, then deterministic dynamic recipe."""
    saved = normalize_icon(persisted)
    if saved is not None:
        return saved

    preset = preset_icon(name)
    if preset is not None:
        return preset

    category_palettes = _RULES.get("category_palettes", {})
    palette = (
        category_palettes.get(category)
        or category_palettes.get(chain)
        or "place"
    )
    if palette not in _PALETTES:
        palette = "place"

    base = emoji if isinstance(emoji, str) and emoji else "❓"
    badge = _dynamic_badge(
        text=_context_text(
            name=name,
            category=category,
            parents=parents,
            chain=chain,
            comment=comment,
        ),
        category=category,
        chain=chain,
        base=base,
    )
    recipe: IconRecipe = {
        "base": base,
        "palette": palette,
        "source": "generated" if badge else "fallback",
    }
    if badge:
        recipe["badge"] = badge
    return dict(recipe)


def attach_icon(name: str, info: dict) -> dict:
    """Return a copy of an element payload with a resolved ``icon`` field."""
    enriched = dict(info)
    raw_parents = info.get("parents", ())
    parents = (
        tuple(parent for parent in raw_parents if isinstance(parent, str))
        if isinstance(raw_parents, (list, tuple))
        else ()
    )
    enriched["icon"] = resolve_icon_recipe(
        name=name,
        emoji=info.get("emoji", "❓"),
        category=info.get("category"),
        parents=parents,
        chain=info.get("chain"),
        comment=info.get("comment", ""),
        persisted=info.get("icon"),
    )
    return enriched
