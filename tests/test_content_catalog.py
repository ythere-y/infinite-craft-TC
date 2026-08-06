from copy import deepcopy
import json

import pytest

from backend import content_catalog
from scripts import trace_recipe, validate_seed


EXPECTED_STARTERS = [
    "水",
    "火",
    "风",
    "土",
    "企鹅",
    "人",
    "时间",
    "AI",
    "电脑",
    "手机",
    "网络",
]


def test_compiled_content_has_exact_starters_and_aliases():
    assert [row["name"] for row in content_catalog.starters()] == EXPECTED_STARTERS
    assert content_catalog.normalize_alias("Q宠大乱斗") == "Q宠大乐斗"
    assert content_catalog.normalize_alias("CF") == "穿越火线"
    assert content_catalog.normalize_alias("微信") == "微信"


def test_compiled_content_publishes_destructive_reset_authorization():
    compiled = content_catalog.load_compiled_content()

    assert compiled["destructive_reset_from"] == ["legacy", 1]
    assert compiled["catalog"]["meta"]["destructive_reset_from"] == [
        "legacy",
        1,
    ]
    assert content_catalog.destructive_reset_from() == ("legacy", 1)


@pytest.mark.parametrize(
    "policy",
    [
        None,
        [],
        ["legacy", "legacy"],
        [1, 1],
        [0],
        [2],
        [3],
        [True],
        [1.5],
        [2**53],
        [""],
        ["epoch-1"],
    ],
)
def test_compiled_content_rejects_invalid_destructive_reset_authorization(
    policy,
):
    compiled = deepcopy(content_catalog.load_compiled_content())
    seed_elements = json.loads(
        content_catalog.SEED_ELEMENTS_PATH.read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        content_catalog.SEED_COMBINATIONS_PATH.read_text(encoding="utf-8")
    )
    compiled["destructive_reset_from"] = policy
    compiled["catalog"]["meta"]["destructive_reset_from"] = policy
    compiled["catalog_digest"] = content_catalog._canonical_digest(
        content_catalog._digest_source(
            compiled["catalog"],
            seed_elements,
            seed_combinations,
        )
    )

    with pytest.raises(ValueError, match="destructive_reset_from"):
        content_catalog._validate_compiled_content(
            compiled,
            seed_elements,
            seed_combinations,
        )


def test_compiled_content_rejects_reset_authorization_projection_drift():
    compiled = deepcopy(content_catalog.load_compiled_content())
    seed_elements = json.loads(
        content_catalog.SEED_ELEMENTS_PATH.read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        content_catalog.SEED_COMBINATIONS_PATH.read_text(encoding="utf-8")
    )
    compiled["destructive_reset_from"] = ["legacy"]

    with pytest.raises(ValueError, match="destructive_reset_from"):
        content_catalog._validate_compiled_content(
            compiled,
            seed_elements,
            seed_combinations,
        )


def test_every_bounty_target_is_strictly_reachable():
    content = content_catalog.load_compiled_content()
    targets = {
        name
        for group in content["bounty"]["groups"]
        for name in group["targets"]
    }
    assert targets
    assert targets <= content["depths"].keys()
    assert not targets & set(EXPECTED_STARTERS)
    assert len({content["depths"][name] for name in targets}) >= 3


def test_every_preset_element_is_strictly_reachable():
    content = content_catalog.load_compiled_content()
    preset_names = set(content["elements"]) | {
        row["name"] for row in content["starters"]
    }

    assert preset_names == set(content["depths"])


def test_retired_bad_formulas_are_absent():
    combinations = content_catalog.merged_combinations()
    for pair in [
        "DNF + 工作室",
        "DNF + QQ会员",
        "工作室 + 穿越火线",
        "云 + 微信",
        "人情 + 鹅厂",
        "堡垒之夜 + 收购",
        "打工鹅 + 时间",
        "拳头 + 收购",
        "视频号 + 鹅厂",
    ]:
        assert pair not in combinations


def test_trace_bounty_report_uses_generated_groups(capsys):
    elements, combinations = trace_recipe.load_data(
        include_llm=False,
        verbose=False,
    )
    emoji, starter_names, rules, _ = trace_recipe.build_index(
        elements,
        combinations,
    )
    depths, _ = trace_recipe.compute_depth_and_paths(starter_names, rules)

    assert trace_recipe.cmd_bounty_report(
        emoji,
        starter_names,
        depths,
    ) == 0
    output = capsys.readouterr().out
    assert "悬赏榜 254 个目标" in output
    assert "不可达" not in output


def test_seed_diagnostic_compares_the_merged_pair_map():
    assert set(validate_seed.load_seed_combos()) == set(
        content_catalog.merged_combinations()
    )


@pytest.mark.parametrize(
    ("label", "mutate"),
    [
        ("missing aliases", lambda value: value.pop("aliases")),
        (
            "incorrect alias",
            lambda value: value["aliases"].__setitem__("CF", "错误名称"),
        ),
        ("missing retired pairs", lambda value: value.pop("retired_pairs")),
        (
            "incorrect retired elements",
            lambda value: value.__setitem__("retired_elements", []),
        ),
        (
            "mismatched bounty tabs",
            lambda value: value["bounty"].__setitem__("tabs", []),
        ),
        (
            "mismatched projected element",
            lambda value: value["elements"]["微信"].__setitem__(
                "emoji",
                "❌",
            ),
        ),
    ],
)
def test_compiled_content_rejects_catalog_projection_drift(label, mutate):
    compiled = deepcopy(content_catalog.load_compiled_content())
    seed_elements = json.loads(
        content_catalog.SEED_ELEMENTS_PATH.read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        content_catalog.SEED_COMBINATIONS_PATH.read_text(encoding="utf-8")
    )
    mutate(compiled)

    with pytest.raises(ValueError, match="compiled|bounty|retired|alias"):
        content_catalog._validate_compiled_content(
            compiled,
            seed_elements,
            seed_combinations,
        )


def _consistent_starter_mutation(mutate):
    compiled = deepcopy(content_catalog.load_compiled_content())
    seed_elements = json.loads(
        content_catalog.SEED_ELEMENTS_PATH.read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        content_catalog.SEED_COMBINATIONS_PATH.read_text(encoding="utf-8")
    )
    mutate(seed_elements["starters"])
    compiled["starters"] = deepcopy(seed_elements["starters"])
    compiled["depths"] = content_catalog._calculate_depths(
        compiled["starters"],
        compiled["combinations"],
    )
    compiled["catalog_digest"] = content_catalog._canonical_digest(
        content_catalog._digest_source(
            compiled["catalog"],
            seed_elements,
            seed_combinations,
        )
    )
    return compiled, seed_elements, seed_combinations


def _remove_starter(name):
    def mutate(starters):
        starters[:] = [row for row in starters if row["name"] != name]

    return mutate


def _reorder_starters(starters):
    starters[0], starters[1] = starters[1], starters[0]


def _append_starter(row):
    return lambda starters: starters.append(row)


@pytest.mark.parametrize(
    ("label", "mutate"),
    [
        ("missing", _remove_starter("电脑")),
        (
            "extra",
            _append_starter(
                {
                    "id": "extra",
                    "name": "额外素材",
                    "emoji": "❌",
                    "category": "invalid",
                }
            ),
        ),
        ("reordered", _reorder_starters),
        (
            "input-only promoted",
            _append_starter(
                {
                    "id": "desk",
                    "name": "工位",
                    "emoji": "🪑",
                    "category": "worker",
                }
            ),
        ),
    ],
)
def test_compiled_content_requires_immutable_starter_binding(label, mutate):
    compiled, seed_elements, seed_combinations = (
        _consistent_starter_mutation(mutate)
    )

    with pytest.raises(ValueError, match="exact eleven|starter binding"):
        content_catalog._validate_compiled_content(
            compiled,
            seed_elements,
            seed_combinations,
        )


@pytest.mark.parametrize(
    ("label", "mutate"),
    [
        (
            "missing recipes_by_result",
            lambda value: value.pop("recipes_by_result"),
        ),
        (
            "drifted recipes_by_result",
            lambda value: value["recipes_by_result"].__setitem__("微信", []),
        ),
        (
            "missing canonical_recipes",
            lambda value: value.pop("canonical_recipes"),
        ),
        (
            "drifted canonical_recipes",
            lambda value: value["canonical_recipes"]["QQ"].__setitem__(
                "result",
                "错误结果",
            ),
        ),
    ],
)
def test_compiled_content_requires_complete_recipe_indexes(label, mutate):
    compiled = deepcopy(content_catalog.load_compiled_content())
    seed_elements = json.loads(
        content_catalog.SEED_ELEMENTS_PATH.read_text(encoding="utf-8")
    )
    seed_combinations = json.loads(
        content_catalog.SEED_COMBINATIONS_PATH.read_text(encoding="utf-8")
    )
    mutate(compiled)

    with pytest.raises(ValueError, match="recipes"):
        content_catalog._validate_compiled_content(
            compiled,
            seed_elements,
            seed_combinations,
        )
