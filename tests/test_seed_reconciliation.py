from __future__ import annotations

import json
from pathlib import Path

from backend import archive, community, content_catalog, db, depth, seed_loader


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


class FakeDepthPipeline:
    def __init__(self, redis: "FakeDepthRedis") -> None:
        self.redis = redis
        self.operations: list[str] = []
        self.commands: list[tuple[str, str, dict[str, str] | None]] = []

    def delete(self, key: str):
        self.operations.append("delete")
        self.commands.append(("delete", key, None))
        return self

    def hset(self, key: str, mapping: dict[str, str]):
        self.operations.append("hset")
        self.commands.append(("hset", key, mapping))
        return self

    def execute(self):
        self.operations.append("execute")
        for command, key, mapping in self.commands:
            if command == "delete":
                self.redis.hashes.pop(key, None)
            else:
                assert mapping is not None
                self.redis.hset(key, mapping=mapping)
        return []


class FakeDepthRedis(FakeRedis):
    def __init__(self) -> None:
        super().__init__()
        self.last_pipeline: FakeDepthPipeline | None = None

    def pipeline(self) -> FakeDepthPipeline:
        self.last_pipeline = FakeDepthPipeline(self)
        return self.last_pipeline


def test_depth_warm_up_atomically_replaces_stale_hash(monkeypatch):
    fake = FakeDepthRedis()
    fake.hashes["element_depth"] = {
        "水": "99",
        "stale-input-only": "0",
    }
    monkeypatch.setattr(db, "get_client", lambda: fake)

    warmed = depth.warm_up_from_seed()

    assert warmed == content_catalog.load_compiled_content()["depths"]
    assert fake.hashes["element_depth"] == {
        name: str(value) for name, value in warmed.items()
    }
    assert fake.last_pipeline is not None
    assert fake.last_pipeline.operations == ["delete", "hset", "execute"]


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


def test_homepage_guidance_keeps_advanced_operations_behind_help_toggle():
    homepage = (ROOT / "frontend/index.html").read_text(encoding="utf-8")

    hint = homepage.split('<div id="hint" class="hint">', 1)[1].split(
        '<section id="casino-hud"',
        1,
    )[0]
    basic, advanced = hint.split('id="advanced-guidance"', 1)
    assert "拖" in basic
    assert "合成" in basic
    assert "双击" not in basic
    assert "案例展示" not in basic
    assert "案例展示" in advanced
    assert "case-step" in advanced
    assert "desktop-only-help" in advanced
    assert "双击" in advanced
