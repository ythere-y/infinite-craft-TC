from __future__ import annotations

import json
import sqlite3
import asyncio
from pathlib import Path

import pytest

from backend import archive, seed_loader
from backend.icon_recipes import (
    attach_icon,
    normalize_icon,
    preset_icon,
    resolve_icon_recipe,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "icon-resolution-cases.json"


def fixture_cases() -> list[dict]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", fixture_cases(), ids=lambda case: case["name"])
def test_shared_resolution_cases(case):
    actual = resolve_icon_recipe(
        name=case["name"],
        emoji=case["emoji"],
        category=case["category"],
        parents=tuple(case["parents"]),
        comment=case["comment"],
    )

    assert actual == case["expected"]


def test_exact_preset_override_ignores_supplied_emoji():
    assert preset_icon("Riot") == {
        "base": "👊",
        "badge": "🎮",
        "palette": "studio",
        "source": "curated",
    }
    assert resolve_icon_recipe(
        name="Riot",
        emoji="⚡",
        category="studio",
    ) == preset_icon("Riot")


def test_valid_persisted_recipe_takes_precedence_over_exact_preset():
    persisted = {
        "base": "🪨",
        "badge": "🧭",
        "palette": "place",
        "source": "generated",
    }

    assert resolve_icon_recipe(
        name="Riot",
        emoji="⚡",
        category="studio",
        persisted=persisted,
    ) == persisted


def test_dynamic_resolution_is_deterministic():
    inputs = {
        "name": "智能咖啡",
        "emoji": "☕",
        "category": "ai",
        "parents": ("AI", "咖啡"),
        "chain": "ai",
        "comment": "咖啡完成智能升级",
    }

    assert resolve_icon_recipe(**inputs) == resolve_icon_recipe(**inputs)
    assert resolve_icon_recipe(**inputs) == fixture_cases()[1]["expected"]


@pytest.mark.parametrize(
    "malformed",
    [
        "{not json",
        {"base": "", "palette": "product", "source": "generated"},
        {"base": "☕", "palette": "unknown", "source": "generated"},
        {"base": "☕", "palette": "product", "source": "unknown"},
        ["☕", "🧠"],
    ],
)
def test_malformed_persisted_recipe_falls_back_without_crashing(malformed):
    assert normalize_icon(malformed) is None
    assert resolve_icon_recipe(
        name="智能咖啡",
        emoji="☕",
        category="ai",
        parents=("AI", "咖啡"),
        comment="咖啡完成智能升级",
        persisted=malformed,
    ) == fixture_cases()[1]["expected"]


@pytest.fixture
def isolated_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    return tmp_path / "test.db"


def create_legacy_elements_table(db_path: Path) -> None:
    con = sqlite3.connect(db_path)
    con.execute(
        """
        CREATE TABLE elements (
            name TEXT PRIMARY KEY,
            emoji TEXT NOT NULL,
            category TEXT,
            is_starter INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        )
        """
    )
    con.commit()
    con.close()


def test_init_archive_migrates_old_elements_schema(isolated_archive):
    create_legacy_elements_table(isolated_archive)

    archive.init_archive()
    archive.init_archive()

    con = archive._conn()
    columns = {
        row["name"] for row in con.execute("PRAGMA table_info(elements)")
    }
    con.close()
    assert "icon_json" in columns


def test_icon_json_round_trips_without_overwriting_persisted_recipe(isolated_archive):
    archive.init_archive()
    original = {
        "base": "☕",
        "badge": "🧠",
        "palette": "product",
        "source": "generated",
    }
    archive.upsert_element("智能咖啡", "☕", "ai", icon=original)
    archive.upsert_element(
        "智能咖啡",
        "❌",
        "other",
        icon={
            "base": "❌",
            "palette": "place",
            "source": "fallback",
        },
    )

    assert archive.all_elements() == [
        {
            "name": "智能咖啡",
            "emoji": "☕",
            "category": "ai",
            "is_starter": 0,
            "icon": original,
        }
    ]


def test_invalid_historic_icon_json_decodes_as_missing(isolated_archive):
    archive.init_archive()
    con = archive._conn()
    con.execute(
        """
        INSERT INTO elements(
            name, emoji, category, is_starter, created_at, icon_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("坏图标", "🧪", "ai", 0, 1.0, "{not json"),
    )
    con.commit()
    con.close()

    assert archive.all_elements()[0]["icon"] is None


def test_upsert_repairs_invalid_nonempty_icon_json_without_overwriting_valid_recipe(
    isolated_archive,
):
    archive.init_archive()
    con = archive._conn()
    con.execute(
        """
        INSERT INTO elements(
            name, emoji, category, is_starter, created_at, icon_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("智能咖啡", "☕", "ai", 0, 1.0, "{not json"),
    )
    con.commit()
    con.close()
    assert archive.all_elements()[0]["icon"] is None

    derived = {
        "base": "☕",
        "badge": "🧠",
        "palette": "product",
        "source": "generated",
    }
    archive.upsert_element("智能咖啡", "☕", "ai", icon=derived)
    archive.upsert_element(
        "智能咖啡",
        "❌",
        "other",
        icon={
            "base": "❌",
            "palette": "place",
            "source": "fallback",
        },
    )

    assert archive.all_elements()[0]["icon"] == derived
    con = archive._conn()
    stored = con.execute(
        "SELECT icon_json FROM elements WHERE name = ?",
        ("智能咖啡",),
    ).fetchone()["icon_json"]
    con.close()
    assert json.loads(stored) == derived


def test_seed_store_derives_and_backfills_old_dynamic_row(
    isolated_archive,
    tmp_path,
    monkeypatch,
):
    create_legacy_elements_table(isolated_archive)
    con = sqlite3.connect(isolated_archive)
    con.execute(
        """
        INSERT INTO elements(name, emoji, category, is_starter, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("智能咖啡", "☕", "ai", 0, 1.0),
    )
    con.commit()
    con.close()

    seed_elements_path = tmp_path / "seed_elements.json"
    seed_combinations_path = tmp_path / "seed_combinations.json"
    seed_elements_path.write_text(
        '{"starters": [], "elements": {}}',
        encoding="utf-8",
    )
    seed_combinations_path.write_text(
        '{"combinations": {}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(seed_loader, "SEED_ELEMENTS_PATH", seed_elements_path)
    monkeypatch.setattr(
        seed_loader,
        "SEED_COMBINATIONS_PATH",
        seed_combinations_path,
    )

    archive.init_archive()
    local_store = seed_loader.SeedStore()
    local_store.load()

    expected = {
        "base": "☕",
        "badge": "🧠",
        "palette": "product",
        "source": "generated",
    }
    assert local_store.elements["智能咖啡"]["icon"] == expected
    assert archive.all_elements()[0]["icon"] == expected


def test_seed_store_prefers_archived_icon_when_seed_name_collides(
    isolated_archive,
    tmp_path,
    monkeypatch,
):
    archive.init_archive()
    persisted = {
        "base": "🪨",
        "badge": "🧭",
        "palette": "place",
        "source": "generated",
    }
    archive.upsert_element(
        "Riot",
        "⚡",
        "studio",
        is_starter=True,
        icon=persisted,
    )
    seed_elements_path = tmp_path / "seed_elements.json"
    seed_combinations_path = tmp_path / "seed_combinations.json"
    seed_elements_path.write_text(
        json.dumps(
            {
                "starters": [
                    {
                        "id": "riot",
                        "name": "Riot",
                        "emoji": "⚡",
                        "category": "studio",
                    }
                ],
                "elements": {
                    "Riot": {"emoji": "⚡", "category": "studio"}
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    seed_combinations_path.write_text(
        '{"combinations": {}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(seed_loader, "SEED_ELEMENTS_PATH", seed_elements_path)
    monkeypatch.setattr(
        seed_loader,
        "SEED_COMBINATIONS_PATH",
        seed_combinations_path,
    )

    local_store = seed_loader.SeedStore()
    local_store.load()

    assert local_store.elements["Riot"]["icon"] == persisted
    assert local_store.starters[0]["icon"] == persisted
    assert archive.all_elements()[0]["icon"] == persisted


def test_attach_icon_preserves_existing_fields():
    original = {"emoji": "☕", "category": "ai", "extra": True}

    enriched = attach_icon("智能咖啡", original)

    assert enriched == {
        **original,
        "icon": {
            "base": "☕",
            "badge": "🧠",
            "palette": "product",
            "source": "generated",
        },
    }
    assert original == {"emoji": "☕", "category": "ai", "extra": True}


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


def prepare_dynamic_combine(monkeypatch, existing_elements=None):
    from backend import main

    hit = {
        "result": "智能咖啡",
        "emoji": "☕",
        "source": "llm",
        "chain": "ai",
        "comment": "咖啡完成智能升级",
    }
    monkeypatch.setattr(main.db, "get_client", lambda: FakeMetricsRedis())
    monkeypatch.setattr(main.db, "get_cached", lambda key: dict(hit))
    monkeypatch.setattr(main.db, "record_first", lambda *args: False)
    monkeypatch.setattr(main.db, "get_first", lambda result: None)
    monkeypatch.setattr(main.db, "kpi_add", lambda *args: None)
    monkeypatch.setattr(main.db, "touch_hit", lambda key, hit: 1)
    monkeypatch.setattr(main.kpi, "score_for", lambda *args: (0, ""))
    monkeypatch.setattr(main.kpi, "should_explode", lambda *args: False)
    monkeypatch.setattr(main.depth_mod, "update_on_combine", lambda *args: 1)
    monkeypatch.setattr(main.community, "is_retired_key", lambda key: False)
    monkeypatch.setattr(main, "community_player", lambda request, response: "p_test")
    monkeypatch.setattr(main.store, "elements", existing_elements or {})
    return main


def test_new_dynamic_combine_persists_and_returns_icon(monkeypatch):
    main = prepare_dynamic_combine(monkeypatch)
    writes = []
    monkeypatch.setattr(
        main.archive,
        "upsert_element",
        lambda *args, **kwargs: writes.append(kwargs),
    )

    response = asyncio.run(
        main.api_combine(main.CombineReq(a="AI", b="咖啡", discoverer="测试鹅"))
    )

    assert response.icon == fixture_cases()[1]["expected"]
    assert main.store.elements["智能咖啡"]["icon"] == response.icon
    assert writes == [
        {
            "name": "智能咖啡",
            "emoji": "☕",
            "category": "ai",
            "is_starter": False,
            "icon": response.icon,
        }
    ]


def test_cached_combine_uses_persisted_element_icon(monkeypatch):
    persisted = {
        "base": "🫘",
        "badge": "⚙️",
        "palette": "office",
        "source": "generated",
    }
    main = prepare_dynamic_combine(
        monkeypatch,
        {
            "智能咖啡": {
                "emoji": "☕",
                "category": "ai",
                "icon": persisted,
            }
        },
    )
    monkeypatch.setattr(
        main.archive,
        "upsert_element",
        lambda *args, **kwargs: pytest.fail("existing element must not be rewritten"),
    )

    response = asyncio.run(
        main.api_combine(main.CombineReq(a="AI", b="咖啡", discoverer="测试鹅"))
    )

    assert response.icon == persisted


def test_wall_and_formula_projections_attach_current_icons(monkeypatch):
    from backend import main

    expected = fixture_cases()[1]["expected"]
    monkeypatch.setattr(
        main.store,
        "elements",
        {
            "AI": {"emoji": "🤖", "category": "abstract", "icon": preset_icon("AI")},
            "咖啡": {
                "emoji": "☕",
                "category": "worker",
                "icon": preset_icon("咖啡"),
            },
            "智能咖啡": {"emoji": "☕", "category": "ai", "icon": expected},
        },
    )

    wall = main._attach_icons_to_firsts(
        [{"result": "智能咖啡", "emoji": "☕", "discoverer": "测试鹅"}]
    )
    formula = main._attach_formula_icons(
        {"result": "智能咖啡", "a": "AI", "b": "咖啡"}
    )

    assert wall[0]["icon"] == expected
    assert formula["result_icon"] == expected
    assert formula["a_icon"] == preset_icon("AI")
    assert formula["b_icon"] == preset_icon("咖啡")


def test_category_bounty_and_recipe_items_project_icons(monkeypatch):
    from backend import bounty, main

    riot = fixture_cases()[0]["expected"]
    monkeypatch.setattr(
        main.store,
        "starters",
        [],
    )
    monkeypatch.setattr(
        main.store,
        "elements",
        {"Riot": {"emoji": "⚡", "category": "studio", "icon": riot}},
    )
    monkeypatch.setattr(main.db, "get_first", lambda name: None)
    monkeypatch.setattr(
        main.db,
        "get_client",
        lambda: type("Redis", (), {"zrank": lambda self, key, name: None})(),
    )
    group = bounty.build_group(
        {
            "category": "studio",
            "label": "工作室",
            "emoji": "🎮",
            "tab": "games",
            "whitelist": ["Riot"],
        },
        main.db,
        main.store,
    )
    category = main._build_category_raw("studio")
    monkeypatch.setattr(
        main.archive,
        "recipes_for",
        lambda result, limit: [
            {
                "a": "Riot",
                "b": "Riot",
                "source": "seed",
                "chain": "studio",
                "hit_count": 1,
            }
        ],
    )
    recipes = asyncio.run(main.api_element_recipes("Riot"))

    assert group["items"][0]["icon"] == riot
    assert category["items"][0]["icon"] == riot
    assert recipes["result_icon"] == riot
    assert recipes["recipes"][0]["a_icon"] == riot
    assert recipes["recipes"][0]["b_icon"] == riot


def test_community_formula_list_projects_icons(monkeypatch):
    from backend import community_api

    expected = fixture_cases()[1]["expected"]
    monkeypatch.setattr(
        community_api.store,
        "elements",
        {
            "AI": {"emoji": "🤖", "category": "abstract", "icon": preset_icon("AI")},
            "咖啡": {
                "emoji": "☕",
                "category": "worker",
                "icon": preset_icon("咖啡"),
            },
            "智能咖啡": {"emoji": "☕", "category": "ai", "icon": expected},
        },
    )
    monkeypatch.setattr(
        community_api.community,
        "list_public",
        lambda limit, offset: [
            {"id": "f1", "result": "智能咖啡", "a": "AI", "b": "咖啡"}
        ],
    )

    item = community_api.formulas()["items"][0]

    assert item["result_icon"] == expected
    assert item["a_icon"] == preset_icon("AI")
    assert item["b_icon"] == preset_icon("咖啡")
