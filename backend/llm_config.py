"""Runtime-selectable LLM provider configuration."""

from __future__ import annotations

from typing import Any

from . import db, llm

PROVIDERS = ("makers", "deepseek")
REDIS_KEY = "admin:llm:provider"
DEFAULT_PROVIDER = "deepseek"


def normalize_provider(value: Any) -> str:
    provider = str(value or "").strip().lower()
    if provider not in PROVIDERS:
        raise ValueError("provider must be makers or deepseek")
    return provider


def get_provider() -> str:
    try:
        value = db.get_client().get(REDIS_KEY)
    except Exception:
        return DEFAULT_PROVIDER
    try:
        return normalize_provider(value or DEFAULT_PROVIDER)
    except ValueError:
        return DEFAULT_PROVIDER


def set_provider(provider: str) -> str:
    normalized = normalize_provider(provider)
    db.get_client().set(REDIS_KEY, normalized)
    return normalized


def public_configuration(provider: str | None = None) -> dict[str, Any]:
    selected = normalize_provider(provider) if provider else get_provider()
    return {
        "provider": selected,
        "providers": [
            {
                "id": candidate,
                "label": "Makers" if candidate == "makers" else "DeepSeek",
                "configured": llm.configuration_status(candidate) == "configured",
            }
            for candidate in PROVIDERS
        ],
    }
