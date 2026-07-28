from backend import archive, community


def setup_db(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    community.init()


def formula():
    return community.ensure_formula(
        "会议 + 需求", "需求", "会议", "排期", "📅", "需求一开会就有了日期。",
        "llm", "全球首发者",
    )


def test_formula_is_hidden_and_only_reproducer_can_publish(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()
    assert community.list_public() == []

    try:
        community.publish(row["id"], "not-a-reproducer")
        assert False, "publish should reject a player who never reproduced"
    except PermissionError:
        pass

    community.record_reproduction(row["id"], "publisher")
    published = community.publish(row["id"], "publisher")
    assert published["visibility"] == "public"
    assert published["global_discoverer"] == "全球首发者"
    assert published["first_publisher"] == "publisher"


def test_vote_is_unique_switchable_and_cancellable(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()
    community.record_reproduction(row["id"], "p1")
    community.publish(row["id"], "p1")

    assert community.vote(row["id"], "p1", 1)["net_score"] == 1
    switched = community.vote(row["id"], "p1", -1)
    assert (switched["up_votes"], switched["down_votes"], switched["net_score"]) == (0, 1, -1)
    cancelled = community.vote(row["id"], "p1", 0)
    assert (cancelled["up_votes"], cancelled["down_votes"], cancelled["net_score"]) == (0, 0, 0)


def test_public_formulas_are_grouped_by_result_for_wall(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    first = formula()
    community.record_reproduction(first["id"], "publisher")
    community.publish(first["id"], "publisher")
    community.vote(first["id"], "up-1", 1)

    second = community.ensure_formula(
        "产品 + 日历", "产品", "日历", "排期", "🗓️", "新的排期。",
        "llm", "另一个首发者",
    )
    community.record_reproduction(second["id"], "publisher")
    community.publish(second["id"], "publisher")
    community.vote(second["id"], "down-1", -1)

    formulas = community.public_by_results(["排期"], "up-1")

    assert formulas["排期"]["id"] == first["id"]
    assert formulas["排期"]["a"] == "需求"
    assert formulas["排期"]["b"] == "会议"
    assert formulas["排期"]["net_score"] == 1
    assert formulas["排期"]["my_vote"] == 1


def test_result_reactions_toggle_and_group_by_result(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)

    liked = community.vote_result("排期", "p1", 1)
    assert liked == {
        "up_votes": 1,
        "down_votes": 0,
        "net_score": 1,
        "my_vote": 1,
    }
    cancelled = community.vote_result("排期", "p1", 1)
    assert cancelled == {
        "up_votes": 0,
        "down_votes": 0,
        "net_score": 0,
        "my_vote": None,
    }
    disliked = community.vote_result("排期", "p1", -1)
    assert disliked["down_votes"] == 1
    assert disliked["net_score"] == -1
    assert disliked["my_vote"] == -1

    reactions = community.reactions_by_results(["排期", "未知"], "p1")
    assert reactions["排期"]["my_vote"] == -1
    assert reactions["未知"] == {
        "up_votes": 0,
        "down_votes": 0,
        "net_score": 0,
        "my_vote": None,
    }


def test_wall_page_attaches_formula_and_reaction_to_first_items(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()
    community.record_reproduction(row["id"], "publisher")
    community.publish(row["id"], "publisher")
    community.vote_result("排期", "p1", 1)

    from backend import main

    items = main._attach_wall_context_to_firsts(
        [
            {
                "result": "排期",
                "emoji": "📅",
                "discoverer": "全球首发者",
                "ts": 1_700_000_000,
            }
        ],
        "p1",
    )

    assert items[0]["formula"]["id"] == row["id"]
    assert items[0]["formula"]["a"] == "需求"
    assert items[0]["formula"]["b"] == "会议"
    assert items[0]["formula"]["net_score"] == 0
    assert items[0]["reaction"] == {
        "up_votes": 1,
        "down_votes": 0,
        "net_score": 1,
        "my_vote": 1,
    }


def test_hidden_active_formula_can_receive_votes_without_becoming_public(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()

    voted = community.vote(row["id"], "early-voter", 1)

    assert voted == {
        "id": row["id"],
        "visibility": "hidden",
        "status": "active",
        "up_votes": 1,
        "down_votes": 0,
        "net_score": 1,
        "my_vote": 1,
    }
    assert community.list_public() == []


def test_low_score_queues_but_never_auto_retires(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()
    community.record_reproduction(row["id"], "publisher")
    community.publish(row["id"], "publisher")
    for number in range(8):
        community.vote(row["id"], f"down-{number}", -1)

    queued = community.moderation_queue()
    assert queued[0]["id"] == row["id"]
    assert queued[0]["status"] == "active"


def test_retirement_preserves_history_and_creates_v2(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    first = formula()
    community.moderate(first["id"], "retire", "community_quality", "结果不合适")
    assert community.is_retired_key(first["combo_key"])

    second = community.ensure_formula(
        first["combo_key"], "需求", "会议", "需求排期", "🗓️", "二次生成。",
        "llm", "第二位发现者",
    )
    assert second["version"] == 2
    assert second["id"] != first["id"]
    assert not community.is_retired_key(first["combo_key"])


def test_only_threshold_qualified_formulas_enter_positive_examples(tmp_path, monkeypatch):
    setup_db(tmp_path, monkeypatch)
    row = formula()
    community.record_reproduction(row["id"], "publisher")
    community.publish(row["id"], "publisher")
    for number in range(11):
        community.vote(row["id"], f"up-{number}", 1)
    community.vote(row["id"], "down", -1)

    positive, _ = community.feedback_examples()
    assert positive[0]["name"] == "排期"
