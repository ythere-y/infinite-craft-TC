import json

from backend import nickname


def _reset_pools() -> None:
    nickname._CHENGYU = []
    nickname._THUOCL_STATES = []


def test_python_uses_the_committed_shared_nickname_snapshot():
    _reset_pools()

    nickname._ensure_loaded()

    assert len(nickname._CHENGYU) == 7_831
    assert len(nickname._THUOCL_STATES) == 4_350
    assert nickname.stats()["meme_weight"] == 0.4


def test_python_loads_a_valid_shared_snapshot_without_thuocl(
    monkeypatch,
    tmp_path,
):
    snapshot = tmp_path / "nickname-data.json"
    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chengyu": ["一心一意"],
                "states": ["代码"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(nickname, "_SHARED_DATA", snapshot)

    assert nickname.load_word_pools() == (["一心一意"], ["代码"])


def test_python_falls_back_for_missing_malformed_or_empty_snapshot(
    monkeypatch,
    tmp_path,
):
    fallback = (
        [
            "热情洋溢",
            "一本正经",
            "无所畏惧",
            "精神饱满",
            "坚定不移",
            "全力以赴",
            "心有灵犀",
            "目不转睛",
        ],
        ["代码", "周报", "咖啡", "火锅"],
    )
    snapshot = tmp_path / "nickname-data.json"
    monkeypatch.setattr(nickname, "_SHARED_DATA", snapshot)

    assert nickname.load_word_pools() == fallback

    snapshot.write_text("{", encoding="utf-8")
    assert nickname.load_word_pools() == fallback

    snapshot.write_text(
        json.dumps(
            {"schema_version": 1, "chengyu": [], "states": ["代码"]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert nickname.load_word_pools() == fallback

    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 999,
                "chengyu": ["一心一意"],
                "states": ["代码"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert nickname.load_word_pools() == fallback

    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chengyu": ["一心一意"],
                "states": ["代码"],
                "extra": True,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert nickname.load_word_pools() == fallback

    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chengyu": ["一心一意"],
                "states": [" "],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    assert nickname.load_word_pools() == fallback
