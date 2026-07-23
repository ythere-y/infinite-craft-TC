from __future__ import annotations

import json
import sqlite3

import pytest

from backend import archive, db, prompt
from backend.comments import DEFAULT_COMMENT, normalize_comment


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  开会以后，需求有了自己的需求。  ", "开会以后，需求有了自己的需求。"),
        ("一句   有空格的点评", "一句 有空格的点评"),
        (None, DEFAULT_COMMENT),
        ("", DEFAULT_COMMENT),
        ("第一行\n第二行", DEFAULT_COMMENT),
        ("x" * 31, DEFAULT_COMMENT),
        (
            "<img src=x onerror=alert(1)>",
            "<img src=x onerror=alert(1)>",
        ),
    ],
)
def test_normalize_comment(value, expected):
    assert normalize_comment(value) == expected


def test_parse_response_keeps_valid_comment():
    payload = {
        "name": "需求膨胀",
        "emoji": "🎈",
        "comment": "开会之后，它有了自己的排期。",
    }
    assert prompt.parse_response(json.dumps(payload, ensure_ascii=False)) == payload


@pytest.mark.parametrize("comment", [None, "", "a\nb", "x" * 31])
def test_invalid_comment_does_not_discard_element(comment):
    payload = {"name": "需求膨胀", "emoji": "🎈"}
    if comment is not None:
        payload["comment"] = comment
    parsed = prompt.parse_response(json.dumps(payload, ensure_ascii=False))
    assert parsed == {
        "name": "需求膨胀",
        "emoji": "🎈",
        "comment": DEFAULT_COMMENT,
    }


def test_prompt_requires_comment_in_same_json_response():
    text = prompt.build_prompt("需求", "会议")
    assert '"comment"' in text
    assert "30" in text
    assert text.rstrip().endswith("输出：")


class FakeRedis:
    def __init__(self):
        self.hashes = {}

    def exists(self, key):
        return key in self.hashes

    def hset(self, key, mapping):
        self.hashes.setdefault(key, {}).update(mapping)

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def zadd(self, *args, **kwargs):
        return 1

    def set(self, *args, **kwargs):
        return True

    def sadd(self, *args, **kwargs):
        return 1


def test_archive_migrates_legacy_combinations_and_preserves_comment(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    db_path = tmp_path / "test.db"

    con = sqlite3.connect(db_path)
    con.execute(
        """
        CREATE TABLE combinations (
            key TEXT PRIMARY KEY,
            result TEXT NOT NULL,
            emoji TEXT NOT NULL,
            source TEXT NOT NULL,
            chain TEXT,
            created_at REAL NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    con.commit()
    con.close()

    archive.init_archive()
    archive.init_archive()

    con = archive._conn()
    columns = {
        row["name"] for row in con.execute("PRAGMA table_info(combinations)")
    }
    con.close()
    assert "comment" in columns

    archive.upsert_combination(
        "甲 + 乙",
        "项目",
        "📦",
        "llm",
        None,
        comment="一次生成，长期复用。",
    )
    assert archive.all_combinations()[0]["comment"] == "一次生成，长期复用。"


def test_redis_cache_writes_comment_and_reads_legacy_hash(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    archived = []
    monkeypatch.setattr(
        db.archive,
        "upsert_combination",
        lambda *args, **kwargs: archived.append((args, kwargs)),
    )

    db.put_cache(
        "甲 + 乙",
        "项目",
        "📦",
        "llm",
        comment="一次生成，长期复用。",
    )
    assert fake.hashes["combo:甲 + 乙"]["comment"] == "一次生成，长期复用。"
    assert archived[0][1]["comment"] == "一次生成，长期复用。"

    fake.hashes["combo:旧 + 数据"] = {
        "result": "旧项目",
        "emoji": "📁",
        "source": "llm",
        "chain": "",
    }
    assert "comment" not in db.get_cached("旧 + 数据")


def test_archive_warmup_restores_comment_to_redis(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    archive.upsert_combination(
        "甲 + 乙",
        "项目",
        "📦",
        "llm",
        None,
        comment="归档重新上线。",
    )

    fake = FakeRedis()
    monkeypatch.setattr(db, "get_client", lambda: fake)
    stats = db.warm_up_from_archive()

    assert stats["combos"] == 1
    assert fake.hashes["combo:甲 + 乙"]["comment"] == "归档重新上线。"
