import json

import pytest

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


@pytest.mark.parametrize("blank_word", ["\ufeff", "\u001c", "\u0085"])
def test_python_falls_back_for_union_blank_strings(
    monkeypatch,
    tmp_path,
    blank_word,
):
    snapshot = tmp_path / "nickname-data.json"
    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chengyu": ["一心一意"],
                "states": [blank_word],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(nickname, "_SHARED_DATA", snapshot)

    _, states = nickname.load_word_pools()

    assert states == ["代码", "周报", "咖啡", "火锅"]


def test_python_blank_code_point_ranges_and_boundaries_are_explicit():
    ranges = (
        (0x0009, 0x000D),
        (0x001C, 0x0020),
        (0x0085, 0x0085),
        (0x00A0, 0x00A0),
        (0x1680, 0x1680),
        (0x2000, 0x200A),
        (0x2028, 0x2029),
        (0x202F, 0x202F),
        (0x205F, 0x205F),
        (0x3000, 0x3000),
        (0xFEFF, 0xFEFF),
    )
    blank_points = {
        code_point
        for start, end in ranges
        for code_point in range(start, end + 1)
    }
    boundary_points = {
        code_point
        for start, end in ranges
        for code_point in (start - 1, end + 1)
        if 0 <= code_point <= 0x10FFFF
    } - blank_points

    for code_point in blank_points:
        assert nickname._is_blank_word(chr(code_point))
    for code_point in boundary_points:
        assert not nickname._is_blank_word(chr(code_point))
    assert not nickname._is_blank_word("\u0085代码\ufeff")


def test_python_accepts_visible_words_with_union_whitespace(
    monkeypatch,
    tmp_path,
):
    snapshot = tmp_path / "nickname-data.json"
    snapshot.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "chengyu": ["一心一意"],
                "states": ["\ufeff代码\u001c"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(nickname, "_SHARED_DATA", snapshot)

    assert nickname.load_word_pools() == (
        ["一心一意"],
        ["\ufeff代码\u001c"],
    )


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
