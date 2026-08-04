from __future__ import annotations

from copy import deepcopy
from decimal import Decimal

import pytest

from backend import archive, prompt_spec
from backend import prompt_store


@pytest.fixture
def isolated_prompt_db(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    return tmp_path / "test.db"


@pytest.fixture
def canonical_spec():
    return deepcopy(prompt_spec.load_prompt_spec())


def test_bootstrap_imports_canonical_prompt_as_active_version(
    isolated_prompt_db, canonical_spec
):
    prompt_store.init_prompt_store()

    draft = prompt_store.get_draft()
    active = prompt_store.get_active_version()

    assert sum(
        Decimal(style["probability"])
        for style in draft["styles"]
        if style["enabled"]
    ) == Decimal("100")
    assert active["effective_spec"] == canonical_spec
    assert prompt_store.get_active_spec() == canonical_spec
    assert draft["positive_examples"] == []
    assert draft["negative_examples"] == []


def test_draft_conversion_preserves_all_styles_or_selects_one(canonical_spec):
    draft = prompt_store.draft_from_canonical(canonical_spec)

    assert prompt_store.canonical_from_draft(draft) == canonical_spec
    selected = prompt_store.canonical_from_draft(draft, "idiom")
    assert selected["styles"] == [
        {
            "id": "idiom",
            "enabled": True,
            "label": canonical_spec["styles"][5]["label"],
            "guidance": canonical_spec["styles"][5]["guidance"],
            "weight": 1.0,
        }
    ]


def test_bootstrap_is_idempotent(isolated_prompt_db):
    prompt_store.init_prompt_store()
    first = prompt_store.get_active_version()["id"]

    prompt_store.init_prompt_store()

    assert prompt_store.get_active_version()["id"] == first
    assert len(prompt_store.list_versions()) == 1


def test_saved_draft_survives_store_reinitialization(isolated_prompt_db):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["temperature"] = 0.25
    prompt_store.save_draft(draft)

    prompt_store.init_prompt_store()

    assert prompt_store.get_draft()["temperature"] == 0.25


def test_reinitialization_rejects_corrupted_active_version_snapshot(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    version_id = prompt_store.get_active_version()["id"]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET snapshot_json = ? WHERE id = ?",
        ('{"schema_version":999}', version_id),
    )
    con.commit()
    con.close()

    with pytest.raises(ValueError):
        prompt_store.init_prompt_store()
