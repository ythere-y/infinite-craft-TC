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


def test_retired_bad_formulas_are_absent():
    combinations = content_catalog.merged_combinations()
    for pair in [
        "DNF + 工作室",
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
