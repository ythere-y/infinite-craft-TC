"""Provider-neutral OpenAI-compatible LLM transport."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


@dataclass(frozen=True)
class LLMSettings:
    api_key: str
    base_url: str
    model: str
    timeout: float
    max_retries: int

    @classmethod
    def from_env(cls) -> "LLMSettings":
        api_key = (
            os.getenv("LLM_API_KEY", "").strip()
            or os.getenv("MAKERS_MODELS_KEY", "").strip()
        )
        timeout = float(os.getenv("LLM_TIMEOUT", "15"))
        max_retries = int(os.getenv("LLM_MAX_RETRIES", "2"))
        if timeout <= 0 or max_retries < 0:
            raise ValueError("invalid timeout or retry configuration")
        return cls(
            api_key=api_key,
            base_url=os.getenv("LLM_BASE_URL", "").strip().rstrip("/"),
            model=os.getenv("LLM_MODEL", "").strip(),
            timeout=timeout,
            max_retries=max_retries,
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)


def configuration_status() -> Literal["configured", "not_configured"]:
    try:
        settings = LLMSettings.from_env()
    except (TypeError, ValueError):
        return "not_configured"
    return "configured" if settings.is_configured else "not_configured"


def query(
    payload: dict[str, Any],
    temperature: Optional[float] = None,
    *,
    _client_factory: Callable[..., Any] = OpenAI,
) -> Optional[dict[str, Any]]:
    """Send the existing internal question payload through chat completions."""
    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        print("[llm] invalid question payload; using fallback")
        return None
    try:
        settings = LLMSettings.from_env()
    except (TypeError, ValueError):
        print("[llm] invalid configuration; using fallback")
        return None
    if not settings.is_configured:
        print("[llm] provider is not configured; using fallback")
        return None

    request: dict[str, Any] = {
        "model": settings.model,
        "messages": [{"role": "user", "content": question}],
    }
    if temperature is not None:
        request["temperature"] = float(temperature)

    try:
        client = _client_factory(
            api_key=settings.api_key,
            base_url=settings.base_url,
            timeout=settings.timeout,
            max_retries=settings.max_retries,
        )
        completion = client.chat.completions.create(**request)
        choices = getattr(completion, "choices", None)
        if not choices:
            return None
        content = getattr(getattr(choices[0], "message", None), "content", None)
        if not isinstance(content, str) or not content.strip():
            return None
        return {"text": content}
    except Exception as exc:
        print(f"[llm] query failed: {type(exc).__name__}")
        return None
