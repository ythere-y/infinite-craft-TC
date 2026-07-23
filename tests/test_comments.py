from __future__ import annotations

import json
import sqlite3
import asyncio

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


@pytest.mark.parametrize("separator", ["\u0085", "\u2028"])
def test_unicode_line_separators_degrade_to_default(separator):
    assert normalize_comment(f"第一行{separator}第二行") == DEFAULT_COMMENT


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


def test_hit_only_sqlite_update_preserves_original_comment(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    archive.upsert_combination(
        "甲 + 乙",
        "项目",
        "📝",
        "llm",
        None,
        comment="一次生成，长期复用。",
    )

    archive.upsert_combination(
        key="甲 + 乙",
        result="",
        emoji="",
        source="",
        chain=None,
        increment_hit=True,
    )

    con = archive._conn()
    row = con.execute(
        "SELECT result, emoji, comment, hit_count "
        "FROM combinations WHERE key = ?",
        ("甲 + 乙",),
    ).fetchone()
    con.close()
    assert dict(row) == {
        "result": "项目",
        "emoji": "📝",
        "comment": "一次生成，长期复用。",
        "hit_count": 2,
    }


def test_archive_warmup_leaves_existing_legacy_redis_hash_untouched(monkeypatch):
    fake = FakeRedis()
    legacy = {
        "result": "旧项目",
        "emoji": "📦",
        "source": "llm",
        "chain": "",
        "ts": "123.000",
    }
    fake.hashes["combo:旧 + 数据"] = dict(legacy)
    monkeypatch.setattr(db, "get_client", lambda: fake)
    monkeypatch.setattr(
        db.archive,
        "all_combinations",
        lambda: [
            {
                "key": "旧 + 数据",
                "result": "归档项目",
                "emoji": "🗄️",
                "source": "llm",
                "chain": "",
                "comment": "归档点评",
            }
        ],
    )
    monkeypatch.setattr(db.archive, "all_firsts", lambda: [])
    monkeypatch.setattr(db.archive, "all_nicknames", lambda: [])

    stats = db.warm_up_from_archive()

    assert stats == {"combos": 0, "firsts": 0, "nicks": 0}
    assert fake.hashes["combo:旧 + 数据"] == legacy


class FakeMetricsRedis:
    def setex(self, *args, **kwargs):
        return True

    def incr(self, *args, **kwargs):
        return 1

    def zadd(self, *args, **kwargs):
        return 1

    def zremrangebyscore(self, *args, **kwargs):
        return 0

    def setnx(self, *args, **kwargs):
        return True


def prepare_cached_combine(monkeypatch, hit):
    from backend import main

    monkeypatch.setattr(main.db, "get_client", lambda: FakeMetricsRedis())
    monkeypatch.setattr(main.db, "get_cached", lambda key: dict(hit))
    monkeypatch.setattr(main.db, "record_first", lambda *args: False)
    monkeypatch.setattr(
        main.db,
        "get_first",
        lambda result: {"discoverer": "别的玩家"},
    )
    monkeypatch.setattr(main.db, "kpi_add", lambda *args: None)
    monkeypatch.setattr(main.kpi, "score_for", lambda *args: (0, ""))
    monkeypatch.setattr(main.kpi, "should_explode", lambda *args: False)
    monkeypatch.setattr(main.depth_mod, "update_on_combine", lambda *args: 1)
    monkeypatch.setattr(
        main.store,
        "elements",
        {"项目": {"emoji": "📦", "category": "ai"}},
    )

    async def forbidden_llm(*args, **kwargs):
        raise AssertionError("cache hit must not call the LLM")

    monkeypatch.setattr(main, "_combine_via_llm", forbidden_llm)
    return main


def test_cached_comment_is_returned_without_llm(monkeypatch):
    main = prepare_cached_combine(
        monkeypatch,
        {
            "result": "项目",
            "emoji": "📦",
            "source": "llm",
            "chain": "",
            "comment": "第一次生成的点评。",
        },
    )

    response = asyncio.run(
        main.api_combine(main.CombineReq(a="甲", b="乙", discoverer="测试鹅"))
    )

    assert response.comment == "第一次生成的点评。"


def test_old_cache_without_comment_uses_default(monkeypatch):
    main = prepare_cached_combine(
        monkeypatch,
        {
            "result": "项目",
            "emoji": "📦",
            "source": "llm",
            "chain": "",
        },
    )

    response = asyncio.run(
        main.api_combine(main.CombineReq(a="甲", b="乙", discoverer="测试鹅"))
    )

    assert response.comment == DEFAULT_COMMENT


def test_llm_comment_is_persisted_once(monkeypatch):
    from backend import main

    monkeypatch.setattr(main.db, "recent_result_names", lambda limit: [])
    monkeypatch.setattr(
        prompt,
        "combine_via_llm",
        lambda *args, **kwargs: {
            "name": "需求膨胀",
            "emoji": "🎈",
            "comment": "一行需求开完会，变成季度项目。",
        },
    )
    writes = []
    monkeypatch.setattr(
        main.db,
        "put_cache",
        lambda *args, **kwargs: writes.append((args, kwargs)),
    )

    result = asyncio.run(main._combine_via_llm("需求", "会议", "req-comment"))

    assert result["comment"] == "一行需求开完会，变成季度项目。"
    assert len(writes) == 1
    assert writes[0][1]["comment"] == result["comment"]
