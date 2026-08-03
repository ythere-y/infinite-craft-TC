import asyncio
import copy
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


def test_startup_validates_prompt_before_initializing_services(monkeypatch):
    events = []

    def reject_prompt():
        events.append("prompt")
        raise ValueError("invalid prompt")

    def fail_db():
        events.append("db")
        raise RuntimeError("database initialized before prompt validation")

    monkeypatch.setattr(main, "load_prompt_spec", reject_prompt, raising=False)
    monkeypatch.setattr(main.db, "init_db", fail_db)

    with pytest.raises(ValueError, match="invalid prompt"):
        asyncio.run(main._startup())
    assert events == ["prompt"]
