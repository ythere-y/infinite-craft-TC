from types import SimpleNamespace

from backend import bounty


class FakeDb:
    @staticmethod
    def get_first(name):
        if name == "腾讯大厦":
            return {"discoverer": "测试鹅", "ts": "1700000000"}
        return None

    @staticmethod
    def get_client():
        return SimpleNamespace(zrank=lambda key, name: 0 if name == "腾讯大厦" else None)


def test_bounty_hides_role_group_but_keeps_other_discoveries():
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
    assert next(item for item in tencent["items"] if item["name"] == "企鹅")["discovered"]
    buildings = next(group for group in payload["groups"] if group["category"] == "building")
    tower = next(item for item in buildings["items"] if item["name"] == "腾讯大厦")
    assert tower["discoverer"] == "测试鹅"
    assert tower["seq"] == 1


def test_hidden_role_names_are_not_bounty_refresh_targets():
    names = bounty.all_whitelisted_names()

    assert "马化腾" not in names
    assert "Pony" not in names
    assert "腾讯大厦" in names
