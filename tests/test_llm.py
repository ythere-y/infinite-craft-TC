from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Optional

import pytest

from backend import llm

ENV_NAMES = (
    "LLM_API_KEY",
    "MAKERS_MODELS_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_TIMEOUT",
    "LLM_MAX_RETRIES",
    "LLM_REASONING_EFFORT",
    "LLM_THINKING_ENABLED",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def configure(monkeypatch, generic_key="", makers_key="makers-test-key"):
    monkeypatch.setenv("LLM_API_KEY", generic_key)
    monkeypatch.setenv("MAKERS_MODELS_KEY", makers_key)
    monkeypatch.setenv("LLM_BASE_URL", "https://gateway.test/v1")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    monkeypatch.setenv("LLM_TIMEOUT", "12.5")
    monkeypatch.setenv("LLM_MAX_RETRIES", "3")


def fake_factory(
    content: Optional[str] = '{"name":"云朵","emoji":"☁️"}',
    error: Optional[Exception] = None,
):
    captured: dict[str, Any] = {"init": None, "create": None}

    class Completions:
        def create(self, **kwargs):
            captured["create"] = kwargs
            if error:
                raise error
            if content is None:
                return SimpleNamespace(choices=[])
            message = SimpleNamespace(content=content)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    class Client:
        def __init__(self):
            self.chat = SimpleNamespace(completions=Completions())

    def factory(**kwargs):
        captured["init"] = kwargs
        return Client()

    return factory, captured


def test_generic_key_precedence_and_request_mapping(monkeypatch):
    configure(monkeypatch, generic_key="generic-test-key")
    factory, captured = fake_factory()
    result = llm.query(
        {"question": "咖啡 + 代码"},
        temperature=0.42,
        _client_factory=factory,
    )
    assert result == {"text": '{"name":"云朵","emoji":"☁️"}'}
    assert captured["init"] == {
        "api_key": "generic-test-key",
        "base_url": "https://gateway.test/v1",
        "timeout": 12.5,
        "max_retries": 3,
    }
    assert captured["create"] == {
        "model": "test-model",
        "messages": [{"role": "user", "content": "咖啡 + 代码"}],
        "temperature": 0.42,
    }


def test_makers_key_fallback_and_optional_temperature(monkeypatch):
    configure(monkeypatch)
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory)
    assert captured["init"]["api_key"] == "makers-test-key"
    assert "temperature" not in captured["create"]


def test_reasoning_options_are_mapped(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_THINKING_ENABLED", "true")
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory)
    assert captured["create"]["reasoning_effort"] == "high"
    assert captured["create"]["extra_body"] == {
        "thinking": {"type": "enabled"},
    }


def test_thinking_can_be_explicitly_disabled(monkeypatch):
    configure(monkeypatch)
    monkeypatch.setenv("LLM_THINKING_ENABLED", "false")
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory)
    assert captured["create"]["extra_body"] == {
        "thinking": {"type": "disabled"},
    }


@pytest.mark.parametrize("missing", ["MAKERS_MODELS_KEY", "LLM_BASE_URL", "LLM_MODEL"])
def test_incomplete_configuration_returns_none(monkeypatch, missing):
    configure(monkeypatch)
    monkeypatch.delenv(missing)
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory) is None
    assert captured["init"] is None


@pytest.mark.parametrize("payload", [{}, {"question": ""}, {"question": 123}])
def test_invalid_question_returns_none(monkeypatch, payload):
    configure(monkeypatch)
    factory, captured = fake_factory()
    assert llm.query(payload, _client_factory=factory) is None
    assert captured["init"] is None


def test_empty_completion_returns_none(monkeypatch):
    configure(monkeypatch)
    factory, _ = fake_factory(content=None)
    assert llm.query({"question": "ping"}, _client_factory=factory) is None


def test_provider_error_is_redacted(monkeypatch, capsys):
    configure(monkeypatch, makers_key="do-not-print-this-key")
    factory, _ = fake_factory(error=RuntimeError("private provider body"))
    assert llm.query({"question": "private prompt"}, _client_factory=factory) is None
    output = capsys.readouterr().out
    assert "RuntimeError" in output
    assert "do-not-print-this-key" not in output
    assert "provider body" not in output
    assert "private prompt" not in output


def test_logs_include_request_id_and_safe_timing_fields(monkeypatch, capsys):
    configure(monkeypatch)
    factory, _ = fake_factory()
    result = llm.query(
        {"question": "private prompt", "request_id": "req-test-123"},
        _client_factory=factory,
    )
    assert result
    output = capsys.readouterr().out
    assert "event=request_started" in output
    assert "event=request_succeeded" in output
    assert "request_id=req-test-123" in output
    assert "elapsed_ms=" in output
    assert "prompt_chars=14" in output
    assert "private prompt" not in output
    assert "makers-test-key" not in output


def test_configuration_status(monkeypatch):
    assert llm.configuration_status() == "not_configured"
    configure(monkeypatch)
    assert llm.configuration_status() == "configured"
    monkeypatch.setenv("LLM_TIMEOUT", "invalid")
    assert llm.configuration_status() == "not_configured"


def test_health_reports_configuration_without_model_call(monkeypatch):
    import asyncio
    from backend import main

    configure(monkeypatch)

    class FakeRedis:
        def ping(self):
            return True

        def dbsize(self):
            return 7

    def forbidden_query(*args, **kwargs):
        raise AssertionError("health must not call the model")

    monkeypatch.setattr(main.db, "get_client", lambda: FakeRedis())
    monkeypatch.setattr(llm, "query", forbidden_query)
    result = asyncio.run(main.api_health())
    assert result["redis"] == "ok"
    assert result["redis_dbsize"] == 7
    assert result["llm"] == "configured"
    assert "glm" not in result
