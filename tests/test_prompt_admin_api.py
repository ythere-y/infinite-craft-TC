from __future__ import annotations

from copy import deepcopy
import json
import logging

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
        ("post", "/api/admin/prompt/versions/missing/copy-to-draft"),
        ("delete", "/api/admin/prompt/versions/missing"),
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
    assert payload["revision"] == 1
    assert config_response.headers["etag"] == '"1"'
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
        headers={"If-Match": config_response.headers["etag"]},
    )
    assert saved.status_code == 200
    assert saved.json()["config"]["temperature"] == 0.42
    assert saved.json()["revision"] == 2
    assert saved.headers["etag"] == '"2"'

    generated_response = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": saved.json()["revision"]},
    )
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
        headers={"If-Match": '"1"'},
    )

    assert response.status_code == 422
    assert "至少启用一种风格" in response.json()["detail"]


@pytest.mark.parametrize("temperature", [-0.01, 2.01])
def test_saving_temperature_outside_provider_range_returns_422(
    authorized_client,
    initialized_prompt_store,
    temperature,
):
    invalid = deepcopy(initialized_prompt_store.get_draft())
    invalid["temperature"] = temperature

    response = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": invalid},
        headers={"If-Match": '"1"'},
    )

    assert response.status_code == 422
    assert "temperature" in response.json()["detail"]


@pytest.mark.parametrize("temperature", [0, 2])
def test_saving_temperature_provider_boundary_returns_200(
    authorized_client,
    initialized_prompt_store,
    temperature,
):
    config = deepcopy(initialized_prompt_store.get_draft())
    config["temperature"] = temperature

    response = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": config},
        headers={"If-Match": '"1"'},
    )

    assert response.status_code == 200
    assert response.json()["config"]["temperature"] == temperature


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/api/admin/prompt/versions/missing", None),
        ("post", "/api/admin/prompt/versions/missing/activate", None),
        (
            "post",
            "/api/admin/prompt/versions/missing/copy-to-draft",
            {"expected_revision": 1},
        ),
        ("delete", "/api/admin/prompt/versions/missing", None),
    ],
)
def test_missing_prompt_version_returns_404(
    authorized_client, method, path, payload
):
    kwargs = {} if payload is None else {"json": payload}
    response = getattr(authorized_client, method)(path, **kwargs)

    assert response.status_code == 404


def test_admin_copies_version_to_draft_with_revision(
    authorized_client, initialized_prompt_store
):
    state = authorized_client.get("/api/admin/prompt/config").json()
    generated = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": state["revision"]},
    ).json()
    response = authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/copy-to-draft",
        json={"expected_revision": state["revision"]},
    )
    assert response.status_code == 200
    assert response.json()["config"] == generated["snapshot"]


def test_admin_rejects_stale_copy_and_protected_delete(
    authorized_client, initialized_prompt_store
):
    state = authorized_client.get("/api/admin/prompt/config").json()
    generated = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": state["revision"]},
    ).json()
    changed = deepcopy(state["config"])
    changed["temperature"] = 0.25
    authorized_client.put(
        "/api/admin/prompt/config",
        headers={"if-match": f'"{state["revision"]}"'},
        json={"config": changed},
    )
    assert authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/copy-to-draft",
        json={"expected_revision": state["revision"]},
    ).status_code == 409
    active_id = state["active_version"]["id"]
    assert authorized_client.delete(
        f"/api/admin/prompt/versions/{active_id}"
    ).status_code == 409


def test_admin_treats_zero_copy_revision_as_a_stale_cas_value(
    authorized_client,
):
    state = authorized_client.get("/api/admin/prompt/config").json()
    generated = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": state["revision"]},
    ).json()

    response = authorized_client.post(
        f"/api/admin/prompt/versions/{generated['id']}/copy-to-draft",
        json={"expected_revision": 0},
    )

    assert response.status_code == 409


def test_put_requires_a_draft_precondition(authorized_client):
    payload = authorized_client.get("/api/admin/prompt/config").json()

    response = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": payload["config"]},
    )

    assert response.status_code == 428


def test_interleaved_admin_tabs_cannot_overwrite_or_aggregate_another_draft(
    authorized_client,
    initialized_prompt_store,
):
    tab_a = authorized_client.get("/api/admin/prompt/config")
    tab_b = authorized_client.get("/api/admin/prompt/config")
    assert tab_a.json()["revision"] == tab_b.json()["revision"] == 1

    draft_a = tab_a.json()["config"]
    draft_a["temperature"] = 0.31
    saved_a = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": draft_a},
        headers={"If-Match": tab_a.headers["etag"]},
    )
    assert saved_a.status_code == 200
    assert saved_a.json()["revision"] == 2

    stale_b = tab_b.json()["config"]
    stale_b["temperature"] = 0.32
    rejected_save = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": stale_b},
        headers={"If-Match": tab_b.headers["etag"]},
    )
    assert rejected_save.status_code == 409
    assert initialized_prompt_store.get_draft()["temperature"] == 0.31

    refreshed_b = authorized_client.get("/api/admin/prompt/config")
    draft_b = refreshed_b.json()["config"]
    draft_b["temperature"] = 0.33
    saved_b = authorized_client.put(
        "/api/admin/prompt/config",
        json={"config": draft_b},
        headers={"If-Match": refreshed_b.headers["etag"]},
    )
    assert saved_b.status_code == 200
    assert saved_b.json()["revision"] == 3

    versions_before = len(initialized_prompt_store.list_versions())
    rejected_aggregate = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": saved_a.json()["revision"]},
    )
    assert rejected_aggregate.status_code == 409
    assert len(initialized_prompt_store.list_versions()) == versions_before
    assert initialized_prompt_store.get_draft()["temperature"] == 0.33


def test_prompt_store_busy_maps_to_a_predictable_retryable_response(
    authorized_client,
    monkeypatch,
):
    revision = authorized_client.get("/api/admin/prompt/config").json()["revision"]

    def busy(*args, **kwargs):
        raise prompt_store.PromptStoreBusyError()

    monkeypatch.setattr(prompt_store, "aggregate_draft", busy)
    response = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": revision},
    )

    assert response.status_code == 503
    assert response.headers["retry-after"] == "1"
    assert response.json() == {"detail": "Prompt store is busy"}


def test_corrupted_persisted_spec_returns_sanitized_500_and_log(
    authorized_client,
    initialized_prompt_store,
    caplog,
):
    active = initialized_prompt_store.get_active_version()
    corrupted = deepcopy(active["effective_spec"])
    corrupted["positive_examples"] = [
        {
            "id": "private",
            "enabled": 1,
            "content": "PRIVATE_PROMPT_SENTINEL",
        }
    ]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET effective_spec_json = ? WHERE id = ?",
        (json.dumps(corrupted), active["id"]),
    )
    con.commit()
    con.close()
    caplog.set_level(logging.ERROR)

    response = authorized_client.get(
        f"/api/admin/prompt/versions/{active['id']}"
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "Prompt store is unavailable"}
    assert "prompt_store_corruption" in caplog.text
    assert active["id"] in caplog.text
    assert "PRIVATE_PROMPT_SENTINEL" not in caplog.text
    assert "Bearer secret" not in caplog.text


def test_version_summaries_are_metadata_only_allowlisted_and_paginated(
    authorized_client,
):
    config = authorized_client.get("/api/admin/prompt/config").json()
    first = authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": config["revision"]},
    ).json()
    authorized_client.post(
        "/api/admin/prompt/aggregate",
        json={"expected_revision": config["revision"]},
    )
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET snapshot_json = ? WHERE id = ?",
        ("{", first["id"]),
    )
    con.commit()
    con.close()

    response = authorized_client.get(
        "/api/admin/prompt/config?version_limit=1&version_offset=1"
    )

    assert response.status_code == 200
    versions = response.json()["versions"]
    assert len(versions) == 1
    assert set(versions[0]) == {
        "id",
        "created_at",
        "selected_style_id",
        "selected_style_name",
        "selected_style",
        "active",
    }


def test_version_pages_expose_all_history_when_active_is_older_than_fifty(
    authorized_client,
    initialized_prompt_store,
):
    state = initialized_prompt_store.get_draft_state()
    active_id = initialized_prompt_store.get_active_version()["id"]
    for _ in range(51):
        initialized_prompt_store.aggregate_draft(
            expected_revision=state["revision"],
            random_value=0,
        )

    first_response = authorized_client.get(
        "/api/admin/prompt/config?version_limit=50&version_offset=0"
    )
    assert first_response.status_code == 200
    first = first_response.json()
    assert first["version_page"] == {
        "limit": 50,
        "offset": 0,
        "next_offset": 50,
        "has_more": True,
    }
    assert active_id not in {version["id"] for version in first["versions"]}
    assert first["active_version"]["id"] == active_id

    second_response = authorized_client.get(
        "/api/admin/prompt/config?version_limit=50&version_offset=50"
    )
    assert second_response.status_code == 200
    second = second_response.json()
    assert second["version_page"]["has_more"] is False
    assert active_id in {version["id"] for version in second["versions"]}

    active_detail = authorized_client.get(
        f"/api/admin/prompt/versions/{active_id}"
    )
    assert active_detail.status_code == 200
    assert active_detail.json()["id"] == active_id


def test_version_offset_rejects_values_outside_sqlite_integer_range(
    authorized_client,
):
    response = authorized_client.get(
        "/api/admin/prompt/config?version_offset=9223372036854775808"
    )

    assert response.status_code == 422


class _RequestStub:
    def __init__(self, authorization):
        self.headers = {"authorization": authorization}


def test_admin_token_comparison_handles_non_ascii_without_500(monkeypatch):
    monkeypatch.setenv("ADMIN_TOKEN", "绠＄悊鍛橀攣馃攽")

    main.require_admin_token(_RequestStub("Bearer 绠＄悊鍛橀攣馃攽"))
    with pytest.raises(main.HTTPException) as caught:
        main.require_admin_token(_RequestStub("Bearer 閿欒馃攽"))

    assert caught.value.status_code == 401
