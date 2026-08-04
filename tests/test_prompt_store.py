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


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d.update(styles=[]), "至少启用一种风格"),
        (
            lambda d: d["styles"][0].update(probability="99"),
            "概率总和必须等于 100%",
        ),
        (
            lambda d: d["styles"][1].update(id=d["styles"][0]["id"]),
            "风格 ID 不能重复",
        ),
    ],
)
def test_save_draft_rejects_invalid_configuration(
    isolated_prompt_db, mutate, message
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    mutate(draft)
    with pytest.raises(prompt_store.PromptValidationError, match=message):
        prompt_store.save_draft(draft)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(system_modules={}),
        lambda d: d["system_modules"][0].update(id=" "),
        lambda d: d["system_modules"][1].update(
            id=d["system_modules"][0]["id"]
        ),
        lambda d: d["system_modules"][0].update(enabled=1),
        lambda d: d["system_modules"][0].update(content=" "),
        lambda d: d.update(styles={}),
        lambda d: d["styles"][0].update(id=" padded "),
        lambda d: d["styles"][0].update(enabled="true"),
        lambda d: d["styles"][0].update(guidance=" "),
        lambda d: d["styles"][0].update(probability="-1"),
        lambda d: d["styles"][0].update(probability="101"),
        lambda d: d["styles"][0].update(probability="NaN"),
        lambda d: d.update(positive_examples={}),
        lambda d: d.update(
            positive_examples=[
                {"id": "positive", "enabled": True, "content": " "}
            ]
        ),
        lambda d: d.update(
            positive_examples=[
                {"id": "positive", "enabled": True, "content": "\ufeff"}
            ]
        ),
        lambda d: d.update(
            negative_examples=[
                {"id": "negative", "enabled": "true", "content": "反例"}
            ]
        ),
    ],
)
def test_validate_draft_rejects_malformed_managed_collections(
    isolated_prompt_db, mutate
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    mutate(draft)

    with pytest.raises(prompt_store.PromptValidationError):
        prompt_store.validate_draft(draft)


def test_validate_draft_allows_blank_text_only_on_disabled_entries(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["system_modules"].append(
        {
            "id": "disabled-module",
            "enabled": False,
            "order": 999,
            "content": "",
        }
    )
    draft["styles"].append(
        {
            "id": "disabled-style",
            "enabled": False,
            "label": "",
            "guidance": "",
            "probability": "0",
        }
    )
    draft["positive_examples"] = [
        {"id": "positive", "enabled": False, "content": ""}
    ]
    draft["negative_examples"] = [
        {"id": "negative", "enabled": False, "content": ""}
    ]

    assert prompt_store.validate_draft(draft) == draft


@pytest.mark.parametrize(
    ("random_value", "expected"),
    [
        (0.0, "first"),
        (0.599999, "first"),
        (0.6, "second"),
        (0.999999, "second"),
        (1.0, "second"),
    ],
)
def test_aggregate_selects_style_at_probability_boundaries(
    isolated_prompt_db, random_value, expected
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["styles"] = [
        {
            "id": "first",
            "enabled": True,
            "label": "第一",
            "guidance": "第一风格",
            "probability": "60",
        },
        {
            "id": "second",
            "enabled": True,
            "label": "第二",
            "guidance": "第二风格",
            "probability": "40",
        },
    ]
    prompt_store.save_draft(draft)

    assert (
        prompt_store.aggregate_draft(random_value=random_value)[
            "selected_style"
        ]["id"]
        == expected
    )


def test_aggregated_version_is_immutable_after_draft_changes(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    version = prompt_store.aggregate_draft(random_value=0)
    draft = prompt_store.get_draft()
    draft["system_modules"][0]["content"] = "后来修改"
    prompt_store.save_draft(draft)

    stored = prompt_store.get_version(version["id"])

    assert stored["snapshot"]["system_modules"][0]["content"] != "后来修改"
    assert "{{元素A}}" in stored["preview"]
    assert stored in prompt_store.list_versions()


def test_activate_can_publish_and_roll_back(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = prompt_store.aggregate_draft(random_value=0)
    prompt_store.activate_version(generated["id"])
    assert prompt_store.get_active_version()["id"] == generated["id"]
    assert prompt_store.get_version(generated["id"]) == generated

    prompt_store.activate_version(initial)

    assert prompt_store.get_active_version()["id"] == initial


def test_activate_rejects_corrupted_version_without_changing_active_state(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = prompt_store.aggregate_draft(random_value=0)["id"]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET snapshot_json = ? WHERE id = ?",
        ('{"schema_version":999}', generated),
    )
    con.commit()
    con.close()

    with pytest.raises(prompt_store.PromptValidationError):
        prompt_store.activate_version(generated)

    assert prompt_store.get_active_version()["id"] == initial


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
