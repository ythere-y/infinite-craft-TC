import asyncio
import copy
from types import SimpleNamespace
import json
from pathlib import Path

import pytest

from backend import main, prompt_spec


ROOT = Path(__file__).resolve().parent.parent
CANONICAL_PATH = ROOT / "shared" / "combine-prompt.json"
INVALID_CASES = json.loads(
    (ROOT / "tests" / "fixtures" / "prompt-invalid-specs.json").read_text(
        encoding="utf-8"
    )
)


def _at_path(value, path):
    current = value
    for part in path[:-1]:
        current = current[part]
    return current, path[-1]


def _invalid_source(case):
    source = CANONICAL_PATH.read_text(encoding="utf-8")
    if case["op"] == "raw_replace":
        assert case["target"] in source
        return source.replace(case["target"], case["replacement"], 1)

    value = json.loads(source)
    if case["op"] == "replace_root":
        value = case["value"]
    elif case["op"] == "disable_all":
        parent, key = _at_path(value, case["path"])
        for item in parent[key]:
            item["enabled"] = False
    elif case["op"] == "copy":
        source_parent, source_key = _at_path(value, case["from"])
        target_parent, target_key = _at_path(value, case["path"])
        target_parent[target_key] = copy.deepcopy(source_parent[source_key])
    elif case["op"] == "delete":
        parent, key = _at_path(value, case["path"])
        parent.pop(key, None)
    else:
        parent, key = _at_path(value, case["path"])
        parent[key] = case["value"]
    return json.dumps(value, ensure_ascii=False)


@pytest.mark.parametrize("case", INVALID_CASES, ids=lambda case: case["name"])
def test_python_loader_rejects_shared_invalid_spec_corpus(
    case, monkeypatch, tmp_path
):
    invalid_path = tmp_path / "combine-prompt.json"
    invalid_path.write_text(_invalid_source(case), encoding="utf-8")
    monkeypatch.setattr(prompt_spec, "SPEC_PATH", invalid_path)
    prompt_spec.load_prompt_spec.cache_clear()

    try:
        with pytest.raises(ValueError):
            prompt_spec.load_prompt_spec()
    finally:
        prompt_spec.load_prompt_spec.cache_clear()


def test_python_validation_accepts_capacity_boundaries():
    spec = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
    formula_capacity = spec["capacities"]["community_formula_catalog"]
    recent_capacity = spec["capacities"]["recent_firsts"]
    spec["limits"]["community_examples"] = formula_capacity
    spec["limits"]["avoid_words"] = recent_capacity

    validated = prompt_spec.validate_prompt_spec(spec)

    assert formula_capacity == 500
    assert recent_capacity == 10_000
    assert validated["limits"]["community_examples"] == 500
    assert validated["limits"]["avoid_words"] == 10_000


@pytest.mark.parametrize("temperature", [0, 2])
def test_python_validation_accepts_temperature_provider_boundaries(temperature):
    spec = copy.deepcopy(prompt_spec.load_prompt_spec())
    spec["temperature"] = temperature

    assert prompt_spec.validate_prompt_spec(spec)["temperature"] == temperature


@pytest.mark.parametrize("field", ["positive_examples", "negative_examples"])
@pytest.mark.parametrize(
    "collection",
    [
        {},
        [None],
        [{"id": " ", "enabled": True, "content": "example"}],
        [{"id": " padded ", "enabled": True, "content": "example"}],
        [
            {"id": "duplicate", "enabled": True, "content": "first"},
            {"id": "duplicate", "enabled": False, "content": ""},
        ],
        [{"id": "strict-bool", "enabled": 1, "content": "example"}],
        [{"id": "enabled-blank", "enabled": True, "content": "\ufeff"}],
    ],
)
def test_prompt_spec_rejects_malformed_optional_text_examples(field, collection):
    spec = copy.deepcopy(prompt_spec.load_prompt_spec())
    spec[field] = collection

    with pytest.raises(ValueError):
        prompt_spec.validate_prompt_spec(spec)


def test_prompt_spec_accepts_missing_or_disabled_blank_text_examples():
    spec = copy.deepcopy(prompt_spec.load_prompt_spec())
    validated_without_optional_fields = prompt_spec.validate_prompt_spec(spec)
    spec["positive_examples"] = [
        {"id": "positive-disabled", "enabled": False, "content": ""}
    ]
    spec["negative_examples"] = [
        {"id": "negative-disabled", "enabled": False, "content": ""}
    ]

    assert "positive_examples" not in validated_without_optional_fields
    assert prompt_spec.validate_prompt_spec(spec)["negative_examples"][0][
        "enabled"
    ] is False


def test_renderer_adds_enabled_positive_and_negative_examples_before_community():
    spec = copy.deepcopy(prompt_spec.load_prompt_spec())
    spec["positive_examples"] = [
        {"id": "positive", "enabled": True, "content": "正面保留"},
        {"id": "positive-off", "enabled": False, "content": "正面禁用"},
    ]
    spec["negative_examples"] = [
        {"id": "negative", "enabled": True, "content": "负面保留"},
        {"id": "negative-off", "enabled": False, "content": "负面禁用"},
    ]

    rendered = prompt_spec.build_prompt_messages_from_spec(
        spec,
        a="甲",
        b="乙",
        community_examples=[
            {
                "a": "社区甲",
                "b": "社区乙",
                "name": "社区标记",
                "emoji": "✅",
                "comment": "社区说明",
            }
        ],
        style_value=0,
    )

    user = rendered["user"]
    final_structured_comment = spec["examples"][-1]["output"]["comment"]
    assert final_structured_comment in user
    assert "【正面案例】\n正面保留" in user
    assert "【负面案例】\n负面保留" in user
    assert "正面禁用" not in user
    assert "负面禁用" not in user
    assert (
        user.index(final_structured_comment)
        < user.index("【正面案例】")
        < user.index("【负面案例】")
        < user.index("社区标记")
    )


def test_renderer_is_unchanged_when_plain_text_examples_are_missing_or_empty():
    spec = copy.deepcopy(prompt_spec.load_prompt_spec())
    without_fields = prompt_spec.build_prompt_messages_from_spec(
        spec, a="甲", b="乙", style_value=0
    )
    spec["positive_examples"] = []
    spec["negative_examples"] = []

    assert (
        prompt_spec.build_prompt_messages_from_spec(
            spec, a="甲", b="乙", style_value=0
        )
        == without_fields
    )


def test_startup_initializes_prompt_store_after_validating_prompt_and_database(
    monkeypatch,
):
    events = []

    def canonical_prompt():
        events.append("canonical")

    def initialize_db():
        events.append("db")

    def fail_prompt_store():
        events.append("prompt_store")
        raise ValueError("invalid prompt store")

    def fail_community():
        events.append("community")
        raise RuntimeError("community initialized before prompt store")

    monkeypatch.setattr(main, "load_prompt_spec", canonical_prompt, raising=False)
    monkeypatch.setattr(main.db, "init_db", initialize_db)
    monkeypatch.setattr(
        main,
        "prompt_store",
        SimpleNamespace(init_prompt_store=fail_prompt_store),
        raising=False,
    )
    monkeypatch.setattr(main.community, "init", fail_community)

    with pytest.raises(ValueError, match="invalid prompt store"):
        asyncio.run(main._startup())
    assert events == ["canonical", "db", "prompt_store"]


def test_startup_rejects_canonical_prompt_before_initializing_database(monkeypatch):
    events = []

    def reject_prompt():
        events.append("canonical")
        raise ValueError("invalid prompt")

    def fail_db():
        events.append("db")
        raise RuntimeError("database initialized before prompt validation")

    monkeypatch.setattr(main, "load_prompt_spec", reject_prompt, raising=False)
    monkeypatch.setattr(main.db, "init_db", fail_db)

    with pytest.raises(ValueError, match="invalid prompt"):
        asyncio.run(main._startup())
    assert events == ["canonical"]
