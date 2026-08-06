from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from backend import main, prompt


class FakeRedis:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value):
        self.values[key] = value
        return True


def test_llm_admin_routes_require_a_bearer_token(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    client = TestClient(main.app)

    for method, path, body in (
        ("get", "/api/admin/llm/config", None),
        ("put", "/api/admin/llm/config", {"provider": "makers"}),
        ("post", "/api/admin/llm/test", {"provider": "makers"}),
    ):
        response = client.request(method, path, json=body)
        assert response.status_code == 401


def test_llm_admin_configuration_is_persisted_and_never_exposes_keys(
    monkeypatch,
):
    redis = FakeRedis()
    monkeypatch.setattr(main.db, "get_client", lambda: redis)
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setenv("LLM_API_KEY", "deepseek-secret")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.deepseek.test")
    monkeypatch.setenv("LLM_MODEL", "deepseek-test")
    monkeypatch.setenv("MAKERS_MODELS_KEY", "makers-secret")
    monkeypatch.setenv("AI_GATEWAY_MODEL", "@makers/test")
    client = TestClient(
        main.app,
        headers={"Authorization": "Bearer secret"},
    )

    initial = client.get("/api/admin/llm/config")
    assert initial.status_code == 200
    assert initial.json()["provider"] == "deepseek"

    saved = client.put(
        "/api/admin/llm/config",
        json={"provider": "makers"},
    )
    assert saved.status_code == 200
    assert saved.json()["provider"] == "makers"
    assert redis.values["admin:llm:provider"] == "makers"

    reloaded = client.get("/api/admin/llm/config")
    assert reloaded.json()["provider"] == "makers"
    serialized = reloaded.text
    assert "deepseek-secret" not in serialized
    assert "makers-secret" not in serialized
    assert {
        item["id"]: item["configured"]
        for item in reloaded.json()["providers"]
    } == {"makers": True, "deepseek": True}

    monkeypatch.delenv("LLM_API_KEY")
    assert asyncio.run(main.api_health())["llm"] == "configured"


def test_llm_admin_test_reports_provider_availability(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(main.db, "get_client", lambda: redis)
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    monkeypatch.setattr(
        main,
        "test_llm_provider",
        lambda provider: {
            "ok": provider == "makers",
            "provider": provider,
            "message": "连接成功" if provider == "makers" else "连接失败",
            "latency_ms": 12,
        },
        raising=False,
    )
    client = TestClient(
        main.app,
        headers={"Authorization": "Bearer secret"},
    )

    response = client.post(
        "/api/admin/llm/test",
        json={"provider": "makers"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "provider": "makers",
        "message": "连接成功",
        "latency_ms": 12,
    }


def test_saved_provider_reaches_the_local_combine_transport(monkeypatch):
    redis = FakeRedis()
    redis.set("admin:llm:provider", "makers")
    captured = {}

    def fake_combine(**kwargs):
        captured.update(kwargs)
        return None

    monkeypatch.setattr(main.db, "get_client", lambda: redis)
    monkeypatch.setattr(main.db, "recent_result_names", lambda _limit: [])
    monkeypatch.setattr(main.community, "feedback_examples", lambda **_kwargs: ([], []))
    monkeypatch.setattr(prompt, "combine_via_llm", fake_combine)

    result = asyncio.run(
        main._combine_via_llm(
            "甲",
            "乙",
            "provider-test",
            prompt_spec={
                "limits": {
                    "avoid_words": 1,
                    "community_examples": 1,
                    "bounty_candidates": 1,
                }
            },
        )
    )

    assert result is None
    assert captured["provider"] == "makers"
