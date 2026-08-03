from __future__ import annotations

import json
from pathlib import Path

from backend import archive, community, db, seed_loader


ROOT = Path(__file__).resolve().parent.parent


class FakeRedis:
    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}

    def exists(self, key: str) -> bool:
        return key in self.hashes

    def hgetall(self, key: str) -> dict[str, str]:
        return dict(self.hashes.get(key, {}))

    def hset(self, key: str, mapping: dict[str, str]) -> int:
        self.hashes.setdefault(key, {}).update(mapping)
        return len(mapping)


def test_seed_load_replaces_conflicting_stores_without_touching_dynamic_formulas(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(archive, "_DATA_DIR", tmp_path)
    monkeypatch.setenv("APP_ENV", "test")
    archive.init_archive()
    community.init()

    for increment_hit in (False, True, True):
        archive.upsert_combination(
            "水 + 水",
            "海洋",
            "🌊",
            "seed",
            "geo",
            increment_hit=increment_hit,
        )
    archive.upsert_combination(
        "甲 + 乙",
        "历史结果",
        "📦",
        "llm",
        None,
    )
    community.ensure_formula(
        "水 + 水",
        "水",
        "水",
        "海洋",
        "🌊",
        "旧公式。",
        "seed",
        "旧发现者",
    )

    fake = FakeRedis()
    fake.hashes["combo:水 + 水"] = {
        "result": "海洋",
        "emoji": "🌊",
        "source": "seed",
        "chain": "geo",
        "comment": "",
        "ts": "1",
    }
    fake.hashes["combo:甲 + 乙"] = {
        "result": "历史结果",
        "emoji": "📦",
        "source": "llm",
        "chain": "",
        "comment": "保留我",
        "ts": "1",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    seed_elements_path = tmp_path / "seed_elements.json"
    seed_combinations_path = tmp_path / "seed_combinations.json"
    seed_elements_path.write_text(
        json.dumps(
            {
                "starters": [
                    {
                        "id": "water",
                        "name": "水",
                        "emoji": "💧",
                        "category": "classic",
                    }
                ],
                "elements": {
                    "水": {"emoji": "💧", "category": "classic"},
                    "水塘": {"emoji": "💧", "category": "geo"},
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    seed_combinations_path.write_text(
        json.dumps(
            {
                "combinations": {
                    "水 + 水": {
                        "result": "水塘",
                        "emoji": "💧",
                        "chain": "geo",
                        "comment": "两滴水先汇成池塘。",
                    }
                }
            },
            ensure_ascii=False,
        ),
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

    assert fake.hashes["combo:水 + 水"] == {
        "result": "水塘",
        "emoji": "💧",
        "source": "seed",
        "chain": "geo",
        "comment": "两滴水先汇成池塘。",
        "ts": fake.hashes["combo:水 + 水"]["ts"],
    }
    assert fake.hashes["combo:甲 + 乙"]["result"] == "历史结果"

    con = archive._conn()
    try:
        seed_row = dict(
            con.execute(
                """
                SELECT result, emoji, source, chain, comment, hit_count
                FROM combinations WHERE key = ?
                """,
                ("水 + 水",),
            ).fetchone()
        )
        dynamic_row = dict(
            con.execute(
                "SELECT result, source FROM combinations WHERE key = ?",
                ("甲 + 乙",),
            ).fetchone()
        )
        active_formula = dict(
            con.execute(
                """
                SELECT result,emoji,comment,source,version,visibility,status
                FROM formula_versions
                WHERE combo_key=? AND status='active'
                """,
                ("水 + 水",),
            ).fetchone()
        )
    finally:
        con.close()

    assert seed_row == {
        "result": "水塘",
        "emoji": "💧",
        "source": "seed",
        "chain": "geo",
        "comment": "两滴水先汇成池塘。",
        "hit_count": 3,
    }
    assert dynamic_row == {"result": "历史结果", "source": "llm"}
    assert active_formula == {
        "result": "水塘",
        "emoji": "💧",
        "comment": "两滴水先汇成池塘。",
        "source": "seed",
        "version": 2,
        "visibility": "hidden",
        "status": "active",
    }


def test_homepage_guidance_omits_case_study_and_double_click_copy():
    homepage = (ROOT / "frontend/index.html").read_text(encoding="utf-8")

    hint = homepage.split('<div id="hint" class="hint">', 1)[1].split(
        '<section id="casino-hud"',
        1,
    )[0]
    assert "案例展示" not in hint
    assert "case-step" not in hint
    assert "双击" not in hint
