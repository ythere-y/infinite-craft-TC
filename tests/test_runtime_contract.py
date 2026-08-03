import asyncio

import pytest
from fastapi import HTTPException

from backend import main
from backend.runtime_contract import (
    MAX_COMBINE_ELEMENT_LENGTH,
    MAX_DISCOVERER_LENGTH,
    MAX_RECIPE_FIELD_LENGTH,
    MAX_SESSION_ID_LENGTH,
    MAX_VERIFY_RECIPES,
    validate_runtime_contract,
)


class _MetricsRedis:
    def setex(self, *_args, **_kwargs):
        return True

    def incr(self, *_args, **_kwargs):
        return 1

    def zadd(self, *_args, **_kwargs):
        return 1

    def zremrangebyscore(self, *_args, **_kwargs):
        return 0

    def setnx(self, *_args, **_kwargs):
        return True


def _prepare_fallback_combine(monkeypatch):
    monkeypatch.setattr(main.db, "get_client", lambda: _MetricsRedis())
    monkeypatch.setattr(
        main.db,
        "get_cached",
        lambda _key: {
            "result": "未知产物",
            "emoji": "❓",
            "source": "fallback",
            "chain": None,
        },
    )
    monkeypatch.setattr(main.community, "is_retired_key", lambda _key: False)
    monkeypatch.setattr(
        main,
        "community_player",
        lambda _request, _response: "runtime-contract-player",
    )
    monkeypatch.setattr(main.kpi, "should_explode", lambda *_args: False)
    monkeypatch.setattr(main.store, "elements", {})


def test_shared_runtime_contract_uses_canonical_limits():
    assert (
        MAX_COMBINE_ELEMENT_LENGTH,
        MAX_DISCOVERER_LENGTH,
        MAX_SESSION_ID_LENGTH,
        MAX_VERIFY_RECIPES,
        MAX_RECIPE_FIELD_LENGTH,
    ) == (80, 80, 128, 500, 80)


def test_python_runtime_contract_rejects_values_outside_js_safe_integer_domain():
    contract = {
        "schema_version": 1,
        "max_combine_element_length": 80,
        "max_discoverer_length": 80,
        "max_session_id_length": 128,
        "max_verify_recipes": 500,
        "max_recipe_field_length": 80,
    }

    with pytest.raises(ValueError, match="positive safe integer"):
        validate_runtime_contract(
            {
                **contract,
                "max_verify_recipes": 9_007_199_254_740_992,
            }
        )


def test_combine_accepts_exact_astral_code_point_boundaries(monkeypatch):
    _prepare_fallback_combine(monkeypatch)
    astral = "🪿"

    response = asyncio.run(
        main.api_combine(
            main.CombineReq(
                a=astral * 80,
                b=astral * 80,
                discoverer=astral * 80,
                session_id=astral * 128,
            )
        )
    )

    assert response.a == astral * 80
    assert response.b == astral * 80
    assert response.source == "fallback"


@pytest.mark.parametrize(
    ("field", "value", "detail"),
    [
        ("a", "🪿" * 81, "a/b 过长"),
        ("b", "🪿" * 81, "a/b 过长"),
        ("discoverer", "🪿" * 81, "discoverer 过长"),
        ("session_id", "🪿" * 129, "session_id 过长"),
    ],
)
def test_combine_rejects_overlong_fields_before_side_effects(
    monkeypatch, field, value, detail
):
    side_effects = []

    def observed_metrics():
        side_effects.append("metrics")
        return _MetricsRedis()

    def forbidden_side_effect(name):
        def fail(*_args, **_kwargs):
            side_effects.append(name)
            raise AssertionError(
                "combine validation must happen before side effects"
            )

        return fail

    monkeypatch.setattr(main.db, "get_client", observed_metrics)
    monkeypatch.setattr(
        main.db,
        "get_cached",
        forbidden_side_effect("cache"),
    )
    monkeypatch.setattr(
        main,
        "_combine_via_llm",
        forbidden_side_effect("model"),
    )
    monkeypatch.setattr(
        main,
        "community_player",
        forbidden_side_effect("community"),
    )

    values = {
        "a": "甲",
        "b": "乙",
        "discoverer": "测试鹅",
        "session_id": "session",
    }
    values[field] = value

    with pytest.raises(HTTPException, match=detail) as error:
        asyncio.run(main.api_combine(main.CombineReq(**values)))

    assert error.value.status_code == 400
    assert side_effects == []


def test_score_session_id_uses_astral_code_point_boundary(monkeypatch):
    writes = []
    monkeypatch.setattr(
        main.db,
        "kpi_add",
        lambda session_id, delta, reason: writes.append(
            (session_id, delta, reason)
        ),
    )
    monkeypatch.setattr(main.db, "kpi_total", lambda _session_id: 7)
    astral = "🪿"

    result = asyncio.run(
        main.api_score(
            main.ScoreReq(
                session_id=astral * 128,
                delta=7,
                reason="测试",
            )
        )
    )

    assert result == {"ok": True, "total": 7}
    assert writes == [(astral * 128, 7, "测试")]

    writes.clear()
    with pytest.raises(HTTPException, match="session_id 过长") as error:
        asyncio.run(
            main.api_score(
                main.ScoreReq(
                    session_id=astral * 129,
                    delta=7,
                    reason="测试",
                )
            )
        )
    assert error.value.status_code == 400
    assert writes == []


def test_recipe_verify_rejects_oversized_batch_before_datastore(monkeypatch):
    def forbidden_lookup(*_args, **_kwargs):
        raise AssertionError("batch validation must happen before datastore reads")

    monkeypatch.setattr(main.db, "normalize_key", forbidden_lookup)
    monkeypatch.setattr(main.db, "get_cached", forbidden_lookup)

    with pytest.raises(HTTPException, match="每次最多校验 500") as error:
        asyncio.run(
            main.api_recipes_verify(
                main.VerifyReq(recipes=[{}] * 501)
            )
        )

    assert error.value.status_code == 400


def test_recipe_verify_handles_non_object_items_as_missing_fields(monkeypatch):
    def forbidden_lookup(*_args, **_kwargs):
        raise AssertionError("invalid recipes must not reach the datastore")

    monkeypatch.setattr(main.db, "normalize_key", forbidden_lookup)
    monkeypatch.setattr(main.db, "get_cached", forbidden_lookup)

    result = asyncio.run(
        main.api_recipes_verify(
            main.VerifyReq(recipes=[None, 7, "not-an-object"])
        )
    )

    assert result["invalid"] == [
        {"a": "", "b": "", "reason": "缺少必填字段"},
        {"a": "", "b": "", "reason": "缺少必填字段"},
        {"a": "", "b": "", "reason": "缺少必填字段"},
    ]
    assert result["total_input"] == 3


@pytest.mark.parametrize("field", ["a", "b", "result"])
def test_recipe_verify_rejects_overlong_fields_before_datastore(
    monkeypatch, field
):
    def forbidden_lookup(*_args, **_kwargs):
        raise AssertionError("field validation must happen before datastore reads")

    monkeypatch.setattr(main.db, "normalize_key", forbidden_lookup)
    monkeypatch.setattr(main.db, "get_cached", forbidden_lookup)
    recipe = {"a": "甲", "b": "乙", "result": "结果"}
    recipe[field] = "🪿" * 81

    response = asyncio.run(
        main.api_recipes_verify(main.VerifyReq(recipes=[recipe]))
    )

    assert response["invalid"] == [
        {
            "a": recipe["a"].strip(),
            "b": recipe["b"].strip(),
            "reason": "字段过长",
        }
    ]


def test_recipe_verify_accepts_exact_astral_field_boundary(monkeypatch):
    reads = []
    monkeypatch.setattr(main.db, "normalize_key", lambda a, b: f"{a}+{b}")
    monkeypatch.setattr(
        main.db,
        "get_cached",
        lambda key: reads.append(key) or None,
    )
    astral = "🪿"

    response = asyncio.run(
        main.api_recipes_verify(
            main.VerifyReq(
                recipes=[
                    {
                        "a": astral * 80,
                        "b": astral * 80,
                        "result": astral * 80,
                    }
                ]
            )
        )
    )

    assert response["invalid"] == []
    assert response["unknown"] == [
        {"a": astral * 80, "b": astral * 80}
    ]
    assert len(reads) == 1
