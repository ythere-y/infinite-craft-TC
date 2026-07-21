"""
校验 seed_combinations.json 与数据库（SQLite + Redis）中的配方一致性。

使用：
  APP_ENV=dev  python scripts/validate_seed.py              # dry-run，只列冲突
  APP_ENV=dev  python scripts/validate_seed.py --apply      # 真删 DB 里冲突的行
  APP_ENV=dev  python scripts/validate_seed.py --apply --rewrite  # 删完再用 seed 重新写入

"冲突"定义：同一 key（a+b 规范化后）在 seed 里的 result 与 DB 里不同。
- 默认只处理 `source=seed` 的 key（历史上是 seed 写进去的才可能和新版 seed 冲突）。
  因为 `source=llm` 是 AI 生成的长尾，不应被 seed 覆盖。
- 真删后，建议：
    option A: touch backend/bounty.py 让 uvicorn 重启，seed_loader 会重新预热冲突 key
    option B: 跑脚本时加 --rewrite 直接把 seed 的正确 result 写回 DB
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# 让脚本从仓库根跑
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("APP_ENV", "dev")

from backend import archive, db  # noqa: E402

SEED_COMBINATIONS_PATH = ROOT / "backend" / "seed_combinations.json"


def normalize_key(a: str, b: str) -> str:
    return " + ".join(sorted([a.strip(), b.strip()]))


def load_seed_combos() -> dict:
    """返回 {normalized_key: (result, emoji, chain)}"""
    raw = json.load(open(SEED_COMBINATIONS_PATH, encoding="utf-8"))
    combos = raw.get("combinations", {})
    out = {}
    for k, v in combos.items():
        parts = [p.strip() for p in k.split("+")]
        if len(parts) != 2:
            continue
        nk = normalize_key(parts[0], parts[1])
        out[nk] = (v.get("result"), v.get("emoji", "❓"), v.get("chain"))
    return out


def load_db_combos() -> dict:
    """返回 {key: dict(result, emoji, source, chain, hit_count)}（只遍历 combinations 表）"""
    archive.init_archive()
    out = {}
    for row in archive.all_combinations():
        out[row["key"]] = row
    return out


def find_conflicts(seed: dict, live: dict) -> list:
    """
    返回冲突项 [{key, seed_result, db_result, db_source, db_chain, db_hit_count}]
    只考虑 key 同时在 seed 和 DB 里、且 result 不同的情况。
    """
    conflicts = []
    for key, (seed_r, seed_e, seed_c) in seed.items():
        if key not in live:
            continue
        row = live[key]
        if row["result"] != seed_r:
            conflicts.append({
                "key": key,
                "seed_result": seed_r,
                "seed_emoji": seed_e,
                "seed_chain": seed_c,
                "db_result": row["result"],
                "db_emoji": row["emoji"],
                "db_source": row["source"],
                "db_chain": row["chain"] or "",
                "db_hit_count": row.get("hit_count", 1),
            })
    return conflicts


def apply_fix(conflicts: list, rewrite: bool = False) -> None:
    """
    删 SQLite + Redis 里的冲突 key；若 rewrite=True，再用 seed 的正确值写回。
    first_discoveries 表里的历史 result **不动**（玩家首发记录是玩家数据，保留）。
    """
    if not conflicts:
        print("[apply] 没有冲突，跳过")
        return

    # SQLite
    con = archive._conn()
    try:
        for c in conflicts:
            con.execute("DELETE FROM combinations WHERE key = ?", (c["key"],))
        con.commit()
        print(f"[sqlite] 已从 combinations 表删除 {len(conflicts)} 行")
    finally:
        con.close()

    # Redis
    try:
        r = db.get_client()
        pipe = r.pipeline()
        for c in conflicts:
            pipe.delete(f"combo:{c['key']}")
        pipe.execute()
        print(f"[redis] 已删除 {len(conflicts)} 个 combo:{{key}} 缓存")
    except Exception as e:
        print(f"[redis] 删除失败（Redis 不可达？）: {e}")

    if rewrite:
        # 用 seed 正确值重新写入（复用 db.put_cache，它会自动同步 SQLite）
        for c in conflicts:
            db.put_cache(
                key=c["key"],
                result=c["seed_result"] or "",
                emoji=c["seed_emoji"] or "❓",
                source="seed",
                chain=c["seed_chain"] or "",
            )
        print(f"[rewrite] 已用 seed 值重写 {len(conflicts)} 条")


def print_report(conflicts: list, total_seed: int, total_db: int) -> None:
    print()
    print("=" * 70)
    print(f"seed 配方总数:     {total_seed}")
    print(f"DB  combinations: {total_db}")
    print(f"冲突条目:          {len(conflicts)}")
    print("=" * 70)
    if not conflicts:
        print("✅ 没有冲突，DB 和 seed 一致。")
        return
    # 按 source 分组统计
    by_source = {}
    for c in conflicts:
        by_source.setdefault(c["db_source"] or "?", 0)
        by_source[c["db_source"] or "?"] += 1
    print("按 DB source 分布:")
    for s, n in sorted(by_source.items(), key=lambda kv: -kv[1]):
        print(f"  {s:8s}: {n}")
    print()
    print(f"{'KEY':36s} {'DB current':16s}  →  {'SEED wants':16s}  [src/hits]")
    print("-" * 100)
    for c in conflicts[:200]:
        print(
            f"{c['key']:36s} "
            f"{c['db_emoji'] or '':2s}{c['db_result']:14s}  →  "
            f"{c['seed_emoji'] or '':2s}{c['seed_result']:14s}  "
            f"[{c['db_source']}/{c['db_hit_count']}]"
        )
    if len(conflicts) > 200:
        print(f"... 还有 {len(conflicts) - 200} 条未显示")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真删冲突行（默认 dry-run）")
    ap.add_argument("--rewrite", action="store_true",
                    help="删后用 seed 正确值重写到 DB/Redis（需配合 --apply）")
    ap.add_argument("--include-llm", action="store_true",
                    help="默认只处理 source=seed 的冲突；加此参数会一并处理 llm 的")
    args = ap.parse_args()

    print(f"[env] APP_ENV={os.environ.get('APP_ENV')}  db={archive.db_path_str()}")

    seed = load_seed_combos()
    live = load_db_combos()
    conflicts = find_conflicts(seed, live)

    if not args.include_llm:
        # 默认保留 llm 生成的长尾，不视为冲突
        before = len(conflicts)
        conflicts = [c for c in conflicts if c["db_source"] == "seed"]
        skipped = before - len(conflicts)
        if skipped:
            print(f"（过滤掉 {skipped} 条 source=llm 的差异。用 --include-llm 查看全部）")

    print_report(conflicts, len(seed), len(live))

    if args.apply and conflicts:
        print()
        print(">>> 准备真删数据库里这 {n} 条冲突记录 …".format(n=len(conflicts)))
        apply_fix(conflicts, rewrite=args.rewrite)
        print("done")
    elif not args.apply:
        print()
        print("（dry-run，未改动任何数据。加 --apply 真删；加 --apply --rewrite 删后立即用 seed 重写）")


if __name__ == "__main__":
    main()
