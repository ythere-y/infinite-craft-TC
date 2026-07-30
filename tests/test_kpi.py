from backend import kpi

def test_score_level_uses_linear_star_costs_and_base_four_icons():
    assert kpi.level_threshold(0) == 0
    assert kpi.level_threshold(1) == 300
    assert kpi.level_threshold(4) == 1_320
    assert kpi.level_threshold(16) == 7_200
    assert kpi.level_threshold(64) == 59_520
    assert kpi.level_threshold(128) == 200_960

    assert kpi.rank_for(0)["icons"] == ""
    assert kpi.rank_for(300)["icons"] == "🌟"
    assert kpi.rank_for(1_320)["icons"] == "🌙"
    assert kpi.rank_for(7_200)["icons"] == "🌞"
    assert kpi.rank_for(59_520)["icons"] == "👑"
    assert kpi.rank_for(61_100)["icons"] == "👑🌟"
    assert kpi.rank_for(200_960)["icons"] == "👑👑"


def test_score_level_boundaries_are_exact_and_unlimited():
    for units in (1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024):
        floor = kpi.level_threshold(units)
        assert kpi.rank_for(floor - 1)["level_units"] == units - 1
        rank = kpi.rank_for(floor)
        assert rank["level_units"] == units
        assert rank["topped"] is False
        assert rank["progress"] == 0


def test_each_new_star_costs_more_than_the_previous_star():
    costs = [
        kpi.level_threshold(units) - kpi.level_threshold(units - 1)
        for units in range(1, 200)
    ]
    assert all(left < right for left, right in zip(costs, costs[1:]))


def test_invalid_scores_normalize_to_zero():
    assert kpi.rank_for(-1) == kpi.rank_for(0)
    assert kpi.rank_for(None) == kpi.rank_for(0)
    assert kpi.rank_for("not-a-number") == kpi.rank_for(0)
    assert kpi.rank_for(float("nan")) == kpi.rank_for(0)
    assert kpi.rank_for(float("inf")) == kpi.rank_for(0)


def test_huge_scores_are_bounded_to_javascript_safe_integer_contract():
    expected = kpi.rank_for(kpi.MAX_LEVEL_SCORE)
    assert kpi.rank_for(kpi.MAX_LEVEL_SCORE + 1) == expected
    assert kpi.rank_for(10**1000) == expected
    assert expected["level_units"] == kpi.MAX_LEVEL_UNITS
    assert len(expected["icons"]) < 1_100


def test_raw_score_normalization_keeps_values_above_the_display_cap():
    assert kpi.normalize_score(kpi.MAX_LEVEL_SCORE + 500) == kpi.MAX_LEVEL_SCORE + 500
    assert kpi.rank_for(kpi.MAX_LEVEL_SCORE + 500)["level_units"] == 65_535
