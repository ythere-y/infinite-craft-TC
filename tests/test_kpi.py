from backend import kpi

def test_score_level_includes_a_score_free_starting_star():
    assert kpi.level_threshold(0) == 0
    assert kpi.level_threshold(1) == 300
    assert kpi.level_threshold(4) == 1_320
    assert kpi.level_threshold(16) == 7_200
    assert kpi.level_threshold(64) == 59_520
    assert kpi.level_threshold(128) == 200_960

    for score, level_units, icons in (
        (0, 1, "🌟"),
        (299, 1, "🌟"),
        (300, 2, "🌟🌟"),
        (620, 3, "🌟🌟🌟"),
        (960, 4, "🌙"),
        (1_320, 5, "🌙🌟"),
        (57_960, 64, "👑"),
    ):
        rank = kpi.rank_for(score)
        assert rank["level_units"] == level_units
        assert rank["icons"] == icons


def test_earned_score_boundaries_add_exactly_one_display_unit():
    for earned_units in (1, 2, 3, 4, 15, 16, 63, 64, 65, 127, 128, 1024, 65_534):
        threshold = kpi.level_threshold(earned_units)
        assert kpi.rank_for(threshold - 1)["level_units"] == earned_units
        rank = kpi.rank_for(threshold)
        assert rank["level_units"] == min(65_535, earned_units + 1)
        assert rank["topped"] is False
        assert rank["progress"] == (1 if earned_units == 65_534 else 0)
    max_rank = kpi.rank_for(kpi.MAX_LEVEL_SCORE)
    assert max_rank["level_units"] == 65_535
    assert max_rank["progress"] == 1


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
