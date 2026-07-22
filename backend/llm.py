"""Provider-neutral OpenAI-compatible LLM transport."""

from __future__ import annotations

import os
import time
import uuid
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
    reasoning_effort: str
    thinking_enabled: bool

    @classmethod
    def from_env(cls) -> "LLMSettings":
        api_key = (
            os.getenv("LLM_API_KEY", "").strip()
            or os.getenv("MAKERS_MODELS_KEY", "").strip()
        )
        timeout = float(os.getenv("LLM_TIMEOUT", "15"))
        max_retries = int(os.getenv("LLM_MAX_RETRIES", "2"))
        thinking = os.getenv("LLM_THINKING_ENABLED", "").strip().lower()
        if thinking not in {"", "true", "false"}:
            raise ValueError("invalid thinking configuration")
        if timeout <= 0 or max_retries < 0:
            raise ValueError("invalid timeout or retry configuration")
        return cls(
            api_key=api_key,
            base_url=os.getenv("LLM_BASE_URL", "").strip().rstrip("/"),
            model=os.getenv("LLM_MODEL", "").strip(),
            timeout=timeout,
            max_retries=max_retries,
            reasoning_effort=os.getenv("LLM_REASONING_EFFORT", "").strip(),
            thinking_enabled=thinking == "true",
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
    request_id = str(payload.get("request_id") or uuid.uuid4().hex[:12])[:32]
    question = payload.get("question")
    if not isinstance(question, str) or not question.strip():
        print(f"[llm] event=invalid_payload request_id={request_id}", flush=True)
        return None
    try:
        settings = LLMSettings.from_env()
    except (TypeError, ValueError):
        print(f"[llm] event=invalid_config request_id={request_id}", flush=True)
        return None
    if not settings.is_configured:
        print(f"[llm] event=not_configured request_id={request_id}", flush=True)
        return None

    request: dict[str, Any] = {
        "model": settings.model,
        "messages": [{"role": "user", "content": question}],
    }
    if temperature is not None:
        request["temperature"] = float(temperature)
    if settings.reasoning_effort:
        request["reasoning_effort"] = settings.reasoning_effort
    if settings.thinking_enabled:
        request["extra_body"] = {"thinking": {"type": "enabled"}}

    started = time.perf_counter()
    print(
        f"[llm] event=request_started request_id={request_id} "
        f"model={settings.model} prompt_chars={len(question)} "
        f"timeout_s={settings.timeout:g} max_retries={settings.max_retries} "
        f"reasoning={settings.reasoning_effort or 'off'} "
        f"thinking={'on' if settings.thinking_enabled else 'off'}",
        flush=True,
    )
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
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            print(
                f"[llm] event=empty_choices request_id={request_id} "
                f"elapsed_ms={elapsed_ms}",
                flush=True,
            )
            return None
        content = getattr(getattr(choices[0], "message", None), "content", None)
        if not isinstance(content, str) or not content.strip():
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            print(
                f"[llm] event=empty_content request_id={request_id} "
                f"elapsed_ms={elapsed_ms}",
                flush=True,
            )
            return None
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        usage = getattr(completion, "usage", None)
        total_tokens = getattr(usage, "total_tokens", None)
        print(
            f"[llm] event=request_succeeded request_id={request_id} "
            f"elapsed_ms={elapsed_ms} response_chars={len(content)} "
            f"total_tokens={total_tokens if total_tokens is not None else 'unknown'}",
            flush=True,
        )
        return {"text": content}
    except Exception as exc:
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        print(
            f"[llm] event=request_failed request_id={request_id} "
            f"elapsed_ms={elapsed_ms} error_type={type(exc).__name__}",
            flush=True,
        )
        return None
