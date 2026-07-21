"""
把 seed_combinations.json 里所有配方强制写入 Redis + SQLite。
无论 DB 里之前有什么（哪怕一致），都用 seed 作为最终真相覆盖。

用于修复 validate_seed.py --rewrite 中途崩溃后的半一致状态，或者
在词库大改后想要"硬同步"一次。

使用：
  APP_ENV=dev python scripts/reseed_combos.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("APP_ENV", "dev")

from backend import archive, db  # noqa: E402

SEED_PATH = ROOT / "backend" / "seed_combinations.json"


def normalize_key(a: str, b: str) -> str:
    return " + ".join(sorted([a.strip(), b.strip()]))


def main():
    archive.init_archive()
    try:
        db.get_client().ping()
    except Exception as e:
        print(f"[redis] 连接失败：{e}")
        sys.exit(1)

    raw = json.load(open(SEED_PATH, encoding="utf-8"))
    combos = raw.get("combinations", {})
    print(f"[seed] 读到 {len(combos)} 条 seed 配方")

    # 先把所有 seed key 从 SQLite 清空（绕过 ON CONFLICT 只更新 hit_count 的限制）
    con = archive._conn()
    try:
        for k in combos.keys():
            parts = [p.strip() for p in k.split("+")]
            if len(parts) != 2:
                continue
            nk = normalize_key(parts[0], parts[1])
            con.execute("DELETE FROM combinations WHERE key = ?", (nk,))
        con.commit()
    finally:
        con.close()
    print("[sqlite] 已清空 seed 覆盖的 key，准备重写入")

    n_ok = 0
    n_skip = 0
    for k, v in combos.items():
        parts = [p.strip() for p in k.split("+")]
        if len(parts) != 2:
            n_skip += 1
            continue
        key = normalize_key(parts[0], parts[1])
        result = v.get("result") or ""
        emoji = v.get("emoji") or "❓"
        chain = v.get("chain") or ""
        if not result:
            n_skip += 1
            continue
        # put_cache_force 覆盖 Redis；archive 这边因为已先 DELETE，INSERT 会走 fresh 路径
        db.put_cache_force(
            key=key, result=result, emoji=emoji, source="seed", chain=chain
        )
        n_ok += 1

    print(f"[done] 写入 {n_ok} 条 (跳过 {n_skip} 条无效)")


if __name__ == "__main__":
    main()
