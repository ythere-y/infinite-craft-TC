import asyncio
from types import SimpleNamespace

from backend import bounty, main


class FakeDb:
    @staticmethod
    def get_first(name):
        if name == "腾讯大厦":
            return {"discoverer": "测试鹅", "ts": "1700000000"}
        return None

    @staticmethod
    def get_client():
        return SimpleNamespace(zrank=lambda key, name: 0 if name == "腾讯大厦" else None)


def test_bounty_uses_generated_groups_and_excludes_starters():
    names = bounty.all_whitelisted_names()

    assert "企鹅" not in names
    assert "QQ游戏大厅" in names
    assert "Q宠大乐斗" in names
    assert "Q宠大乱斗" not in names
    assert next(
        group
        for group in bounty.GROUPS
        if group["category"] == "association"
    )["label"] == "关联组织"


def test_bounty_hides_starters_but_keeps_other_discoveries():
    store = SimpleNamespace(
        starters=[{"name": "企鹅", "category": "tencent"}],
        elements={
            "企鹅": {"emoji": "🐧", "category": "tencent"},
            "腾讯大厦": {"emoji": "🏢", "category": "building"},
        },
    )

    payload = bounty.build_bounty(FakeDb, store)

    assert not any(group["category"] == "boss" for group in payload["groups"])
    assert not any(group["label"] == "角色" for group in payload["groups"])
    tencent = next(group for group in payload["groups"] if group["category"] == "tencent")
    assert not any(item["name"] == "企鹅" for item in tencent["items"])
    assert all(
        item["is_starter"] is False
        for group in payload["groups"]
        for item in group["items"]
    )
    buildings = next(group for group in payload["groups"] if group["category"] == "building")
    tower = next(item for item in buildings["items"] if item["name"] == "腾讯大厦")
    assert tower["discoverer"] == "测试鹅"
    assert tower["seq"] == 1


def test_hidden_role_names_are_not_bounty_refresh_targets():
    names = bounty.all_whitelisted_names()

    assert "马化腾" not in names
    assert "Pony" not in names
    assert "腾讯大厦" in names


class FakeMetricsRedis:
    def setex(self, *_args):
        return True

    def incr(self, *_args):
        return 1

    def zadd(self, *_args):
        return 1

    def zremrangebyscore(self, *_args):
        return 0

    def setnx(self, *_args):
        return True


def test_combine_aliases_use_and_return_canonical_inputs(monkeypatch):
    observed = {}
    hit = {
        "result": "黑钻",
        "emoji": "💬",
        "source": "target",
        "chain": "qq_memory",
        "comment": "DNF与会员合成黑钻。",
    }

    monkeypatch.setattr(main.db, "get_client", lambda: FakeMetricsRedis())
    monkeypatch.setattr(
        main.db,
        "get_cached",
        lambda key: observed.setdefault("key", key) and dict(hit),
    )
    monkeypatch.setattr(main.db, "record_first", lambda *_args: False)
    monkeypatch.setattr(main.db, "get_first", lambda _result: None)
    monkeypatch.setattr(main.db, "kpi_add", lambda *_args: None)
    monkeypatch.setattr(main.db, "touch_hit", lambda *_args: 1)
    monkeypatch.setattr(main.community, "is_retired_key", lambda _key: False)
    monkeypatch.setattr(main, "community_player", lambda *_args: "p_test")
    monkeypatch.setattr(main.depth_mod, "update_on_combine", lambda *_args: 1)
    monkeypatch.setattr(main.store, "elements", {
        "DNF": {"emoji": "🎮", "category": "tencent_game"},
        "会员": {"emoji": "🎫", "category": "abstract"},
        "黑钻": {"emoji": "💬", "category": "qq_memory"},
    })

    response = asyncio.run(
        main.api_combine(
            main.CombineReq(
                a="地下城与勇士",
                b="会员",
                discoverer="测试鹅",
                session_id="alias-test",
            )
        )
    )

    assert response.result == "黑钻"
    assert response.a == "DNF"
    assert response.b == "会员"
    assert observed["key"] == main.db.normalize_key("DNF", "会员")


def test_recipe_alias_looks_up_and_returns_canonical_target(monkeypatch):
    observed = {}
    monkeypatch.setattr(
        main.archive,
        "recipes_for",
        lambda result, limit: (
            observed.update(result=result, limit=limit)
            or [
                {
                    "a": "QQ宠物",
                    "b": "格斗",
                    "source": "target",
                    "chain": "tencent_game",
                    "hit_count": 0,
                }
            ]
        ),
    )
    monkeypatch.setattr(main.store, "elements", {
        "Q宠大乐斗": {"emoji": "🎮", "category": "tencent_game"},
        "QQ宠物": {"emoji": "💬", "category": "qq_memory"},
        "格斗": {"emoji": "🥊", "category": "tencent_game"},
    })

    response = asyncio.run(main.api_element_recipes("Q宠大乱斗"))

    assert observed == {"result": "Q宠大乐斗", "limit": 100}
    assert response["result"] == "Q宠大乐斗"
    assert response["count"] == 1


def test_recipe_verification_uses_and_returns_canonical_inputs(monkeypatch):
    observed = {}
    hit = {"result": "黑钻", "emoji": "💬"}
    monkeypatch.setattr(
        main.db,
        "get_cached",
        lambda key: observed.setdefault("key", key) and dict(hit),
    )

    response = asyncio.run(
        main.api_recipes_verify(
            main.VerifyReq(
                recipes=[
                    {
                        "a": "地下城与勇士",
                        "b": "会员",
                        "result": "黑钻",
                        "emoji": "💬",
                    }
                ]
            )
        )
    )

    assert observed["key"] == main.db.normalize_key("DNF", "会员")
    assert response["valid"] == [
        {
            "a": "DNF",
            "b": "会员",
            "result": "黑钻",
            "emoji": "💬",
        }
    ]
