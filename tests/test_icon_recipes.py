from __future__ import annotations

import json
import sqlite3
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
