"""
启动时预热 seed 元素 + seed 合成规则到 Redis 和 SQLite。
幂等：put_cache/upsert_element 在已存在时不覆盖。
"""

import json
from pathlib import Path
from typing import Dict, Tuple, List

from . import db, archive

_HERE = Path(__file__).parent
SEED_ELEMENTS_PATH = _HERE / "seed_elements.json"
SEED_COMBINATIONS_PATH = _HERE / "seed_combinations.json"


class SeedStore:
    """内存里存 seed，供 /api/elements /api/starters 直出。"""

    def __init__(self) -> None:
        self.elements: Dict[str, Dict] = {}
        self.starters: List[Dict] = []

    def load(self) -> Tuple[int, int]:
        with open(SEED_ELEMENTS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        self.starters = data.get("starters", [])
        self.elements = dict(data.get("elements", {}))

        # 把 starter 和基础 element 灌进 SQLite
        starter_names = {s["name"] for s in self.starters}
        for s in self.starters:
            archive.upsert_element(
                name=s["name"], emoji=s["emoji"],
                category=s.get("category"), is_starter=True,
            )
        for name, info in self.elements.items():
            archive.upsert_element(
                name=name, emoji=info.get("emoji", "❓"),
                category=info.get("category"),
                is_starter=(name in starter_names),
            )

        # 从 SQLite 恢复历史 element（AI 之前生成过但不在 seed 里的）
        for row in archive.all_elements():
            if row["name"] not in self.elements:
                self.elements[row["name"]] = {
                    "emoji": row["emoji"],
                    "category": row["category"] or "unknown",
                }

        # 合成规则
        with open(SEED_COMBINATIONS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        combos = data.get("combinations", {})

        warmed = 0
        bad = 0
        for raw_key, info in combos.items():
            parts = [p.strip() for p in raw_key.split("+")]
            if len(parts) != 2:
                continue
            # 防御：info 必须是 dict，且至少有 result 字段
            if not isinstance(info, dict) or not info.get("result"):
                bad += 1
                continue
            key = db.normalize_key(parts[0], parts[1])
            before = db.get_cached(key)
            if before:
                continue
            db.put_cache(
                key=key,
                result=info["result"],
                emoji=info.get("emoji", "❓"),
                source="seed",
                chain=info.get("chain"),
            )
            warmed += 1
            if info["result"] not in self.elements:
                self.elements[info["result"]] = {
                    "emoji": info.get("emoji", "❓"),
                    "category": info.get("chain", "seed"),
                }
                archive.upsert_element(
                    name=info["result"], emoji=info.get("emoji", "❓"),
                    category=info.get("chain"), is_starter=False,
                )
        if bad > 0:
            print(f"[seed_loader] skipped {bad} malformed combinations")

        return len(self.elements), warmed


store = SeedStore()
