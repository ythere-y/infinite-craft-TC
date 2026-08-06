from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import json
import sqlite3
import time

import pytest

from backend import archive, prompt, prompt_spec
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


def _draft_state():
    return prompt_store.get_draft_state()


def _save_current(draft):
    state = _draft_state()
    return prompt_store.save_draft(
        draft,
        expected_revision=state["revision"],
    )


def _aggregate_current(*, random_value=0):
    state = _draft_state()
    return prompt_store.aggregate_draft(
        expected_revision=state["revision"],
        random_value=random_value,
    )


def _replace_style_probabilities(draft, probabilities):
    draft["styles"] = [
        {
            "id": f"exact-style-{index}",
            "enabled": True,
            "label": f"精确风格 {index}",
            "guidance": f"精确引导 {index}",
            "probability": probability,
        }
        for index, probability in enumerate(probabilities)
    ]


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
    assert _draft_state()["revision"] == 1
    assert active["preview"]


def test_combine_uses_active_prompt_version(monkeypatch, isolated_prompt_db):
    """Default local LLM composition must render the published spec, not disk."""
    prompt_store.init_prompt_store()
    generated = _aggregate_current()
    prompt_store.activate_version(generated["id"])
    captured = {}

    def build_messages(spec, **inputs):
        captured["spec"] = spec
        return {"system": "s", "user": "u", "temperature": 0}

    monkeypatch.setattr(prompt, "build_prompt_messages_from_spec", build_messages)
    monkeypatch.setattr(prompt, "_select_bounty_candidates", lambda *a, **k: [])
    monkeypatch.setattr("backend.llm.query", lambda *a, **k: None)

    prompt.combine_via_llm("需求", "会议")

    assert captured["spec"] == generated["effective_spec"]


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
    saved = _save_current(draft)

    prompt_store.init_prompt_store()

    assert prompt_store.get_draft()["temperature"] == 0.25
    assert _draft_state()["revision"] == saved["revision"]


@pytest.mark.parametrize("temperature", [-0.01, 2.01])
def test_save_draft_rejects_temperature_outside_provider_range(
    isolated_prompt_db,
    temperature,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["temperature"] = temperature

    with pytest.raises(
        prompt_store.PromptValidationError,
        match="temperature",
    ):
        _save_current(draft)


@pytest.mark.parametrize("temperature", [0, 2])
def test_save_draft_accepts_temperature_provider_boundaries(
    isolated_prompt_db,
    temperature,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    draft["temperature"] = temperature

    saved = _save_current(draft)

    assert saved["config"]["temperature"] == temperature


def test_probability_precision_limit_accepts_six_decimal_places(isolated_prompt_db):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    _replace_style_probabilities(draft, ["99.999999", "0.000001"])

    assert prompt_store.validate_draft(draft) == draft


@pytest.mark.parametrize(
    "probabilities",
    [
        ["99.9999999", "0.0000001"],
        ["99.999999", "1e-7"],
    ],
)
def test_probability_precision_limit_rejects_seven_decimal_places(
    isolated_prompt_db, probabilities
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    _replace_style_probabilities(draft, probabilities)

    with pytest.raises(prompt_store.PromptValidationError) as error:
        prompt_store.validate_draft(draft)

    assert str(error.value) == "风格概率的小数位数不能超过 6"


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
        _save_current(draft)


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


def test_probability_total_rejects_a_sub_context_increment_above_100(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    _replace_style_probabilities(draft, ["100", "1e-6"])

    with pytest.raises(
        prompt_store.PromptValidationError,
        match="概率总和必须等于 100%",
    ):
        prompt_store.validate_draft(draft)


def test_probability_total_accepts_an_exact_100_at_six_decimal_precision(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    _replace_style_probabilities(
        draft,
        [
            "99.99999",
            *(["1e-6"] * 10),
        ],
    )

    assert prompt_store.validate_draft(draft) == draft


@pytest.mark.parametrize(
    ("invalid_probability", "companion_probability"),
    [
        ("5_0", "50"),
        ("\uff15\uff10", "50"),
        ("\u008550\u0085", "50"),
        ("0." + ("0" * 1000) + "1e1001", "99"),
    ],
)
def test_probability_rejects_values_outside_the_browser_decimal_grammar(
    isolated_prompt_db,
    invalid_probability,
    companion_probability,
):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft()
    _replace_style_probabilities(
        draft,
        [invalid_probability, companion_probability],
    )

    with pytest.raises(prompt_store.PromptValidationError):
        prompt_store.validate_draft(draft)


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
    saved = _save_current(draft)

    assert (
        prompt_store.aggregate_draft(
            expected_revision=saved["revision"],
            random_value=random_value,
        )[
            "selected_style"
        ]["id"]
        == expected
    )


def test_version_page_reaches_history_older_than_fifty_and_active_version(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    active_id = prompt_store.get_active_version()["id"]
    revision = _draft_state()["revision"]
    for _ in range(51):
        prompt_store.aggregate_draft(
            expected_revision=revision,
            random_value=0,
        )

    first = prompt_store.list_version_page(limit=50, offset=0)
    second = prompt_store.list_version_page(
        limit=50,
        offset=first["next_offset"],
    )

    assert len(first["versions"]) == 50
    assert first["has_more"] is True
    assert first["next_offset"] == 50
    assert active_id not in {version["id"] for version in first["versions"]}
    assert second["has_more"] is False
    assert active_id in {version["id"] for version in second["versions"]}


def test_aggregated_version_is_immutable_after_draft_changes(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    version = _aggregate_current()
    draft = prompt_store.get_draft()
    draft["system_modules"][0]["content"] = "后来修改"
    _save_current(draft)

    stored = prompt_store.get_version(version["id"])

    assert stored["snapshot"]["system_modules"][0]["content"] != "后来修改"
    assert "{{元素A}}" in stored["preview"]
    summary = next(
        item for item in prompt_store.list_versions()
        if item["id"] == version["id"]
    )
    assert set(summary) == {
        "id",
        "created_at",
        "selected_style_id",
        "selected_style_name",
        "selected_style",
    }


def test_activate_can_publish_and_roll_back(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = _aggregate_current()
    prompt_store.activate_version(generated["id"])
    assert prompt_store.get_active_version()["id"] == generated["id"]
    assert prompt_store.get_version(generated["id"]) == generated

    prompt_store.activate_version(initial)

    assert prompt_store.get_active_version()["id"] == initial


def test_copy_version_to_draft_uses_revision_cas(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_draft_state()
    generated = prompt_store.aggregate_draft(
        expected_revision=initial["revision"], random_value=0
    )
    changed = deepcopy(initial["config"])
    changed["temperature"] = 0.25
    saved = prompt_store.save_draft(
        changed, expected_revision=initial["revision"]
    )

    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.copy_version_to_draft(
            generated["id"], expected_revision=initial["revision"]
        )

    copied = prompt_store.copy_version_to_draft(
        generated["id"], expected_revision=saved["revision"]
    )
    assert copied["config"] == generated["snapshot"]
    assert copied["revision"] == saved["revision"] + 1
    assert prompt_store.get_active_version()["id"] != generated["id"]


def test_delete_version_protects_active_and_initial_versions(isolated_prompt_db):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(initial)

    draft = prompt_store.get_draft_state()
    generated = prompt_store.aggregate_draft(
        expected_revision=draft["revision"], random_value=0
    )
    prompt_store.activate_version(generated["id"])
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(generated["id"])
    with pytest.raises(prompt_store.PromptStoreConflictError):
        prompt_store.delete_version(initial)


def test_delete_inactive_non_initial_version(isolated_prompt_db):
    prompt_store.init_prompt_store()
    draft = prompt_store.get_draft_state()
    generated = prompt_store.aggregate_draft(
        expected_revision=draft["revision"], random_value=0
    )
    prompt_store.delete_version(generated["id"])
    with pytest.raises(KeyError):
        prompt_store.get_version(generated["id"])


def test_activate_rejects_corrupted_version_without_changing_active_state(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = _aggregate_current()["id"]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET snapshot_json = ? WHERE id = ?",
        ('{"schema_version":999}', generated),
    )
    con.commit()
    con.close()

    with pytest.raises(prompt_store.PromptStoreCorruptionError):
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

    with pytest.raises(prompt_store.PromptStoreCorruptionError):
        prompt_store.init_prompt_store()


def test_archive_migrates_existing_prompt_draft_revision_once(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    database = tmp_path / "test.db"
    con = sqlite3.connect(database)
    con.execute(
        """
        CREATE TABLE prompt_draft (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            config_json TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    con.execute(
        "INSERT INTO prompt_draft(singleton, config_json, updated_at) VALUES (1, '{}', 1)"
    )
    con.commit()
    con.close()

    archive.init_archive()
    migrated = archive._conn()
    columns = {
        row["name"] for row in migrated.execute("PRAGMA table_info(prompt_draft)")
    }
    assert "revision" in columns
    assert migrated.execute(
        "SELECT revision FROM prompt_draft WHERE singleton = 1"
    ).fetchone()["revision"] == 1
    migrated.execute(
        "UPDATE prompt_draft SET revision = 7 WHERE singleton = 1"
    )
    migrated.commit()
    migrated.close()

    archive.init_archive()
    reopened = archive._conn()
    assert reopened.execute(
        "SELECT revision FROM prompt_draft WHERE singleton = 1"
    ).fetchone()["revision"] == 7
    reopened.close()


@pytest.mark.parametrize("operation_name", ["bootstrap", "save", "aggregate", "activate"])
def test_prompt_write_transactions_fail_fast_with_a_typed_busy_error(
    isolated_prompt_db,
    monkeypatch,
    operation_name,
):
    prompt_store.init_prompt_store()
    state = _draft_state()
    active_id = prompt_store.get_active_version()["id"]
    operations = {
        "bootstrap": prompt_store.init_prompt_store,
        "save": lambda: prompt_store.save_draft(
            state["config"],
            expected_revision=state["revision"],
        ),
        "aggregate": lambda: prompt_store.aggregate_draft(
            expected_revision=state["revision"],
            random_value=0,
        ),
        "activate": lambda: prompt_store.activate_version(active_id),
    }
    operation = operations[operation_name]
    if operation_name == "bootstrap":
        monkeypatch.setattr(archive, "init_archive", lambda: None)
    monkeypatch.setattr(
        prompt_store,
        "_WRITE_BUSY_TIMEOUT_SECONDS",
        0.01,
        raising=False,
    )
    monkeypatch.setattr(
        prompt_store,
        "_WRITE_BUSY_RETRY_DELAYS",
        (0.0, 0.0),
        raising=False,
    )

    blocker = sqlite3.connect(str(isolated_prompt_db), timeout=0)
    blocker.execute("PRAGMA journal_mode=WAL")
    blocker.execute("BEGIN IMMEDIATE")
    started = time.monotonic()
    try:
        with pytest.raises(prompt_store.PromptStoreBusyError):
            operation()
    finally:
        elapsed = time.monotonic() - started
        blocker.rollback()
        blocker.close()

    assert elapsed < 0.5
    operation()


def test_activate_rejects_corrupted_effective_examples_without_switching_active(
    isolated_prompt_db,
):
    prompt_store.init_prompt_store()
    initial = prompt_store.get_active_version()["id"]
    generated = _aggregate_current()
    corrupted = deepcopy(generated["effective_spec"])
    corrupted["positive_examples"] = [
        {
            "id": "positive",
            "enabled": "yes",
            "content": "PRIVATE_PROMPT_SENTINEL",
        }
    ]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET effective_spec_json = ? WHERE id = ?",
        (json.dumps(corrupted), generated["id"]),
    )
    con.commit()
    con.close()

    with pytest.raises(prompt_store.PromptStoreCorruptionError):
        prompt_store.activate_version(generated["id"])

    assert prompt_store.get_active_version()["id"] == initial


def test_runtime_rejects_corrupted_active_effective_examples(isolated_prompt_db):
    prompt_store.init_prompt_store()
    active = prompt_store.get_active_version()
    corrupted = deepcopy(active["effective_spec"])
    corrupted["negative_examples"] = [
        {"id": "negative", "enabled": True, "content": ""}
    ]
    con = archive._conn()
    con.execute(
        "UPDATE prompt_versions SET effective_spec_json = ? WHERE id = ?",
        (json.dumps(corrupted), active["id"]),
    )
    con.commit()
    con.close()

    with pytest.raises(prompt_store.PromptStoreCorruptionError):
        prompt_store.get_active_spec()
