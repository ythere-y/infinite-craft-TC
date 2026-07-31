from __future__ import annotations

from html.parser import HTMLParser
import json
from pathlib import Path
import re

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


class CaseStepParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.steps: list[str] = []
        self._parts: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag != "div":
            return
        classes = dict(attrs).get("class", "").split()
        if "case-step" in classes:
            self._parts = []

    def handle_data(self, data):
        if self._parts is not None:
            self._parts.append(data)

    def handle_endtag(self, tag):
        if tag == "div" and self._parts is not None:
            self.steps.append(" ".join("".join(self._parts).split()))
            self._parts = None


def test_homepage_case_steps_all_exist_in_authoritative_seed_library():
    parser = CaseStepParser()
    parser.feed((ROOT / "frontend/index.html").read_text(encoding="utf-8"))
    assert len(parser.steps) == 9

    seed_source = json.loads(
        (ROOT / "backend/seed_combinations.json").read_text(encoding="utf-8")
    )["combinations"]
    normalized_seed = {}
    for raw_key, formula in seed_source.items():
        parents = [part.strip() for part in raw_key.split("+")]
        if len(parents) == 2:
            normalized_seed[" + ".join(sorted(parents))] = formula

    for step in parser.steps:
        match = re.fullmatch(
            r"\d+\.\s+(\S+)\s+\S+\s+\+\s+(\S+)\s+\S+\s+=\s+(\S+)\s+(\S+)",
            step,
        )
        assert match, step
        left, right, result, emoji = match.groups()
        formula = normalized_seed[" + ".join(sorted((left, right)))]
        assert (formula["result"], formula["emoji"]) == (result, emoji)
