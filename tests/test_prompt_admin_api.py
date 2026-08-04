from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from backend import archive, main, prompt_store


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def initialized_prompt_store(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    prompt_store.init_prompt_store()
    return prompt_store


@pytest.fixture
def authorized_client(initialized_prompt_store, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    return TestClient(
        main.app,
        headers={"Authorization": "Bearer secret"},
    )


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/prompt/config"),
        ("put", "/api/admin/prompt/config"),
        ("post", "/api/admin/prompt/aggregate"),
        ("get", "/api/admin/prompt/versions/missing"),
        ("post", "/api/admin/prompt/versions/missing/activate"),
    ],
)
def test_prompt_admin_routes_require_token(client, method, path, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")
    response = client.request(
        method,
        path,
        json={} if method != "get" else None,
    )
    assert response.status_code == 401


def test_admin_stats_uses_the_same_bearer_authentication(client, monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")

    assert client.get("/api/admin/stats").status_code == 401


def test_prompt_admin_rejects_access_when_admin_token_is_unconfigured(
    client, monkeypatch
):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)

    response = client.get(
        "/api/admin/prompt/config",
        headers={"Authorization": "Bearer anything"},
    )

    assert response.status_code == 401


@pytest.mark.parametrize(
    "authorization",
    [
        "Bearer wrong",
        "Basic secret",
        "Bearer ",
    ],
)
def test_prompt_admin_rejects_invalid_authorization(
    client, initialized_prompt_store, monkeypatch, authorization
):
    monkeypatch.setenv("ADMIN_TOKEN", "secret")

    response = client.get(
        "/api/admin/prompt/config",
        headers={"Authorization": authorization},
    )

    assert response.status_code == 401


def test_prompt_admin_accepts_case_insensitive_bearer_scheme(
    authorized_client,
):
    response = authorized_client.get(
        "/api/admin/prompt/config",
        headers={"Authorization": "bEaReR secret"},
    )

    assert response.status_code == 200


def test_admin_can_save_aggregate_preview_activate_and_roll_back(
    authorized_client, initialized_prompt_store
):
    config_response = authorized_client.get("/api/admin/prompt/config")
    assert config_response.status_code == 200
    payload = config_response.json()
    initial_id = payload["active_version"]["id"]
    assert payload["active_version"]["active"] is True
    assert any(
        version["id"] == initial_id and version["active"] is True
        for version in payload["versions"]
    )

    config = payload["config"]
    config["temperature"] = 0.42
    saved = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": config},
    )
    assert saved.status_code == 200
    assert saved.json()["config"]["temperature"] == 0.42

    generated_response = authorized_client.post("/api/admin/prompt/aggregate")
    assert generated_response.status_code == 200
    generated = generated_response.json()
    assert generated["active"] is False
    assert "{{元素A}}" in generated["preview"]

    detail_response = authorized_client.get(
        f"/api/admin/prompt/versions/{generated['id']}"
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["snapshot"]["temperature"] == 0.42
    assert detail["active"] is False

    activated_response = authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/activate"
    )
    assert activated_response.status_code == 200
    assert activated_response.json()["active"] is True

    rolled_back = authorized_client.post(
        f"/api/admin/prompt/versions/{initial_id}/activate"
    )
    assert rolled_back.status_code == 200
    assert rolled_back.json()["active"] is True
    assert initialized_prompt_store.get_active_version()["id"] == initial_id


def test_saving_invalid_prompt_draft_returns_422(
    authorized_client, initialized_prompt_store
):
    invalid = deepcopy(initialized_prompt_store.get_draft())
    invalid["styles"] = []

    response = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": invalid},
    )

    assert response.status_code == 422
    assert "至少启用一种风格" in response.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/admin/prompt/versions/missing"),
        ("post", "/api/admin/prompt/versions/missing/activate"),
    ],
)
def test_missing_prompt_version_returns_404(
    authorized_client, method, path
):
    response = getattr(authorized_client, method)(path)

    assert response.status_code == 404
