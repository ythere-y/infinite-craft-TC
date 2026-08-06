from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Optional

import pytest

from backend import llm

ENV_NAMES = (
    "LLM_API_KEY",
    "MAKERS_MODELS_KEY",
    "AI_GATEWAY_BASE_URL",
    "AI_GATEWAY_MODEL",
    "AI_GATEWAY_TIMEOUT",
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


def configure(
    monkeypatch,
    generic_key="local-test-key",
    makers_key="makers-test-key",
):
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


def test_optional_system_prompt_uses_two_message_shape(monkeypatch):
    configure(monkeypatch, generic_key="generic-test-key")
    factory, captured = fake_factory()

    assert llm.query(
        {"system_prompt": "系统规则", "question": "用户输入"},
        temperature=0.85,
        _client_factory=factory,
    )

    assert captured["create"]["messages"] == [
        {"role": "system", "content": "系统规则"},
        {"role": "user", "content": "用户输入"},
    ]


def test_combine_orchestration_builds_shared_messages_once(monkeypatch):
    from backend import prompt

    spec = deepcopy(prompt.load_prompt_spec())
    spec["limits"] = {
        "avoid_words": 31,
        "community_examples": 9,
        "bounty_candidates": 13,
    }
    avoid_words = [f"禁词{index}" for index in range(31)]
    community_examples = [
        {
            "a": f"社区输入{index}",
            "b": "会议",
            "name": f"社区结果{index}",
            "emoji": "🗓️",
            "comment": "有效示例",
        }
        for index in range(9)
    ]
    renderer_calls = []
    query_calls = []

    def select_candidates(a, b, limit):
        assert (a, b) == ("需求", "咖啡")
        return [
            {"name": f"悬赏{index}", "emoji": "🎯", "category": "tencent"}
            for index in range(limit)
        ]

    def render_messages(prompt_spec, **inputs):
        renderer_calls.append((prompt_spec, inputs))
        return {
            "system": "系统消息",
            "user": "用户消息",
            "temperature": 0.73,
            "style_id": "test-style",
        }

    def query(payload, temperature):
        query_calls.append((payload, temperature))
        return {
            "text": '{"name":"需求续杯","emoji":"☕","comment":"需求先续一杯。"}'
        }

    monkeypatch.setattr(prompt, "_select_bounty_candidates", select_candidates)
    monkeypatch.setattr(
        prompt,
        "build_prompt_messages_from_spec",
        render_messages,
        raising=False,
    )
    monkeypatch.setattr(llm, "query", query)

    result = prompt.combine_via_llm(
        "需求",
        "咖啡",
        avoid_words=avoid_words,
        community_examples=community_examples,
        request_id="req-shared-limits",
        prompt_spec=spec,
    )

    assert result == {
        "name": "需求续杯",
        "emoji": "☕",
        "comment": "需求先续一杯。",
    }
    assert len(renderer_calls) == 1
    assert renderer_calls[0] == (
        spec,
        {
            "a": "需求",
            "b": "咖啡",
            "avoid_words": avoid_words,
            "bounty_candidates": [
                {
                    "name": f"悬赏{index}",
                    "emoji": "🎯",
                    "category": "tencent",
                }
                for index in range(13)
            ],
            "community_examples": community_examples,
        },
    )
    assert query_calls == [
        (
            {
                "system_prompt": "系统消息",
                "question": "用户消息",
                "request_id": "req-shared-limits",
            },
            0.73,
        )
    ]


def test_combine_prefers_explicit_prompt_spec(monkeypatch):
    from backend import prompt, prompt_store

    spec = deepcopy(prompt.load_prompt_spec())

    monkeypatch.setattr(
        prompt_store,
        "get_active_spec",
        lambda: (_ for _ in ()).throw(AssertionError("active spec was read")),
    )
    monkeypatch.setattr(prompt, "_select_bounty_candidates", lambda *a, **k: [])
    monkeypatch.setattr(llm, "query", lambda *a, **k: None)

    assert prompt.combine_via_llm("需求", "会议", prompt_spec=spec) is None


def test_local_configuration_ignores_makers_key(monkeypatch):
    configure(monkeypatch, generic_key="")
    factory, captured = fake_factory()
    assert llm.query({"question": "ping"}, _client_factory=factory) is None
    assert captured["init"] is None
    assert llm.LLMSettings.from_env().is_configured is False


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


@pytest.mark.parametrize("missing", ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"])
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
    configure(monkeypatch, generic_key="do-not-print-this-key")
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
    assert "local-test-key" not in output


def test_configuration_status(monkeypatch):
    assert llm.configuration_status() == "not_configured"
    configure(monkeypatch)
    assert llm.configuration_status() == "configured"
    monkeypatch.setenv("LLM_TIMEOUT", "invalid")
    assert llm.configuration_status() == "not_configured"


def test_provider_settings_keep_makers_and_deepseek_credentials_separate(
    monkeypatch,
):
    configure(
        monkeypatch,
        generic_key="deepseek-secret",
        makers_key="makers-secret",
    )
    monkeypatch.setenv("AI_GATEWAY_BASE_URL", "https://makers.test/v1/")
    monkeypatch.setenv("AI_GATEWAY_MODEL", "@makers/test-model")
    monkeypatch.setenv("AI_GATEWAY_TIMEOUT", "9")

    deepseek = llm.LLMSettings.from_env("deepseek")
    makers = llm.LLMSettings.from_env("makers")

    assert (deepseek.api_key, deepseek.base_url, deepseek.model) == (
        "deepseek-secret",
        "https://gateway.test/v1",
        "test-model",
    )
    assert (makers.api_key, makers.base_url, makers.model, makers.timeout) == (
        "makers-secret",
        "https://makers.test/v1",
        "@makers/test-model",
        9,
    )


def test_query_uses_the_explicit_provider(monkeypatch):
    configure(
        monkeypatch,
        generic_key="deepseek-secret",
        makers_key="makers-secret",
    )
    monkeypatch.setenv("AI_GATEWAY_BASE_URL", "https://makers.test/v1")
    monkeypatch.setenv("AI_GATEWAY_MODEL", "@makers/test-model")
    factory, captured = fake_factory(content="OK")

    result = llm.query(
        {"question": "ping"},
        provider="makers",
        _client_factory=factory,
    )

    assert result == {"text": "OK"}
    assert captured["init"]["api_key"] == "makers-secret"
    assert captured["init"]["base_url"] == "https://makers.test/v1"
    assert captured["create"]["model"] == "@makers/test-model"


def test_query_supports_a_bounded_zero_retry_availability_probe(monkeypatch):
    configure(monkeypatch)
    factory, captured = fake_factory(content="OK")

    assert llm.query(
        {"question": "ping"},
        max_tokens=8,
        max_retries=0,
        _client_factory=factory,
    ) == {"text": "OK"}

    assert captured["init"]["max_retries"] == 0
    assert captured["create"]["max_tokens"] == 8


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
