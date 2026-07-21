"""
管理员工具：查询任一元素的合成链路（纯命令行，不占玩家 UI）。

数据源：
  - 基础：backend/seed_elements.json + backend/seed_combinations.json（预设真相源）
  - 默认叠加：data/{APP_ENV}.db 中 source='llm' 的玩家触发 AI 配方 + 新元素
    （seed 条目优先，archive 只补充长尾；用 --no-llm 可关闭；--env dev 切换库）

用法：
  python scripts/trace_recipe.py 滨海大厦
  python scripts/trace_recipe.py Pony 张小龙 活水                # 多元素批量
  python scripts/trace_recipe.py --all-recipes 王者荣耀           # 只列直接配方
  python scripts/trace_recipe.py --tree 天美                      # 展开分叉树（深度 2）
  python scripts/trace_recipe.py --tree 天美 --tree-depth 3      # 展开更深
  python scripts/trace_recipe.py --bounty-report                  # 列出所有悬赏目标的深度
  python scripts/trace_recipe.py --unreachable                    # 列出不可达元素
  python scripts/trace_recipe.py --list-starters                  # 列出当前 starter
  python scripts/trace_recipe.py --no-llm 滨海大厦                # 关闭 AI 配方合并
  python scripts/trace_recipe.py --env dev 滨海大厦               # 查 dev.db

退出码：
  0 = 全部查询成功
  1 = 任一目标不可达 / 不存在

输出风格和新手教程 9 步案例一致：`步骤N: a 🧍 + b 🪑 = 结果 🧑‍💻`
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# -------------------- 路径 & 数据 --------------------
ROOT = Path(__file__).resolve().parent.parent
ELEMENTS_PATH = ROOT / "backend" / "seed_elements.json"
COMBOS_PATH = ROOT / "backend" / "seed_combinations.json"


def _merge_archive(
    elems: Dict, combos: Dict, env: str, verbose: bool = True
) -> Tuple[int, int, str]:
    """
    从 SQLite 归档库合并玩家触发的 AI 配方（source='llm'）和新元素。
    seed 条目不会被覆盖：以 JSON 为真相源，archive 只补充长尾。
    返回 (合并的 llm 配方数, 合并的新元素数, db 路径)。
    """
    # 让 archive 模块按 env 选库
    os.environ["APP_ENV"] = env
    # 延迟导入：只有启用合并时才依赖 sqlite3 和 backend 包
    sys.path.insert(0, str(ROOT))
    try:
        from backend import archive  # noqa
    except Exception as e:
        if verbose:
            print(f"⚠️  合并 archive 失败（将继续仅用 seed JSON）：{e}", file=sys.stderr)
        return 0, 0, ""

    db_path = archive.db_path_str() if hasattr(archive, "db_path_str") else ""
    if not Path(db_path).exists() if db_path else False:
        if verbose:
            print(f"⚠️  数据库不存在 {db_path}（将继续仅用 seed JSON）", file=sys.stderr)
        return 0, 0, db_path

    # 1) 合并 llm 配方
    llm_added = 0
    try:
        for row in archive.all_combinations():
            if row.get("source") != "llm":
                continue
            key = row["key"]
            if key in combos:
                continue  # seed 优先，已有则跳过
            combos[key] = {
                "result": row["result"],
                "emoji": row.get("emoji") or "❓",
                "chain": row.get("chain") or "llm",
            }
            llm_added += 1
    except Exception as e:
        if verbose:
            print(f"⚠️  读 combinations 失败：{e}", file=sys.stderr)

    # 2) 合并新元素（补 emoji 索引）
    elem_added = 0
    try:
        existing = set(elems.get("elements", {}).keys()) | {
            s["name"] for s in elems.get("starters", [])
        }
        for e in archive.all_elements():
            name = e["name"]
            if name in existing:
                continue
            elems.setdefault("elements", {})[name] = {
                "emoji": e.get("emoji") or "❓",
                "category": e.get("category") or "",
            }
            elem_added += 1
        # 额外兜底：llm 配方里出现的 result 若无元素行，也要登记 emoji
        existing |= set(elems["elements"].keys())
        for key, val in combos.items():
            r = val.get("result")
            if r and r not in existing:
                elems["elements"][r] = {"emoji": val.get("emoji") or "❓", "category": ""}
                existing.add(r)
                elem_added += 1
    except Exception as e:
        if verbose:
            print(f"⚠️  读 elements 失败：{e}", file=sys.stderr)

    return llm_added, elem_added, db_path


def load_data(include_llm: bool = True, env: str = "prod", verbose: bool = True) -> Tuple[Dict, Dict]:
    with open(ELEMENTS_PATH, encoding="utf-8") as f:
        elems = json.load(f)
    with open(COMBOS_PATH, encoding="utf-8") as f:
        combos = json.load(f)["combinations"]
    if include_llm:
        llm_n, elem_n, db_path = _merge_archive(elems, combos, env, verbose=verbose)
        if verbose and (llm_n or elem_n):
            print(
                f"[archive:{env}] 已合并 {llm_n} 条 AI 配方 + {elem_n} 个新元素  "
                f"(db={db_path})",
                file=sys.stderr,
            )
    return elems, combos


def build_index(elems: Dict, combos: Dict):
    """构建元素 emoji 索引 + (a,b,r) 规则列表 + 每个结果的所有产出规则。"""
    emoji: Dict[str, str] = {}
    starter_names: Set[str] = set()
    for s in elems["starters"]:
        emoji[s["name"]] = s.get("emoji") or "❓"
        starter_names.add(s["name"])
    for name, info in elems["elements"].items():
        if name not in emoji:
            emoji[name] = info.get("emoji") or "❓"

    rules: List[Tuple[str, str, str]] = []
    producers: Dict[str, List[Tuple[str, str]]] = {}
    for key, val in combos.items():
        parts = [p.strip() for p in key.split("+")]
        if len(parts) != 2:
            continue
        a, b = parts
        r = val["result"]
        rules.append((a, b, r))
        producers.setdefault(r, []).append((a, b))
    return emoji, starter_names, rules, producers


# -------------------- 可达性 & 最短路径 --------------------
def compute_depth_and_paths(
    starter_names: Set[str], rules: List[Tuple[str, str, str]]
) -> Tuple[Dict[str, int], Dict[str, List[Tuple[str, str, str]]]]:
    """
    对每个元素计算：
      - depth[x] = 从任一 starter 组合到 x 需要的最小合成步数
      - path[x] = 达到 x 的最短步骤序列 [(a, b, r), ...]（拼接父路径，去重）

    使用类 BFS 松弛：starter depth=0，path=[]；
    对任一规则 (a,b,r)：若 a,b 已有 depth，则 r 的候选深度 = max(d_a, d_b) + 1。
    不断松弛直到稳定。
    """
    depth: Dict[str, int] = {s: 0 for s in starter_names}
    path: Dict[str, List[Tuple[str, str, str]]] = {s: [] for s in starter_names}

    changed = True
    while changed:
        changed = False
        for a, b, r in rules:
            if a not in depth or b not in depth:
                continue
            cand_d = max(depth[a], depth[b]) + 1
            if r not in depth or depth[r] > cand_d:
                # 合并双分支路径并附加本步骤；保持顺序不重复
                merged: List[Tuple[str, str, str]] = []
                seen: Set[str] = set()
                for step in path[a] + path[b]:
                    if step[2] not in seen:
                        seen.add(step[2])
                        merged.append(step)
                merged.append((a, b, r))
                depth[r] = cand_d
                path[r] = merged
                changed = True
    return depth, path


# -------------------- 输出 --------------------
def em(name: str, emoji_idx: Dict[str, str]) -> str:
    return emoji_idx.get(name, "❓")


def format_step(i: int, a: str, b: str, r: str, emoji_idx: Dict[str, str]) -> str:
    return (
        f"  步骤{i:>2}: "
        f"{a} {em(a, emoji_idx)} + {b} {em(b, emoji_idx)} "
        f"= {r} {em(r, emoji_idx)}"
    )


def print_shortest(target: str, emoji_idx, starter_names, depth, path) -> bool:
    if target in starter_names:
        print(f"\n【{target} {em(target, emoji_idx)}】是 starter（开局自带 🌱）")
        return True
    if target not in depth:
        print(f"\n【{target}】不可达或不存在 ✗")
        return False
    steps = path[target]
    print(f"\n【{target} {em(target, emoji_idx)}】最短路径（{depth[target]} 步）:")
    for i, (a, b, r) in enumerate(steps, 1):
        print(format_step(i, a, b, r, emoji_idx))
    return True


def print_all_recipes(target: str, emoji_idx, producers) -> bool:
    rs = producers.get(target, [])
    if not rs:
        print(f"\n【{target}】没有直接配方（可能是 starter 或未定义）")
        return False
    print(f"\n【{target} {em(target, emoji_idx)}】的全部直接配方（{len(rs)} 条）:")
    for a, b in rs:
        print(f"  {a} {em(a, emoji_idx)} + {b} {em(b, emoji_idx)} = {target} {em(target, emoji_idx)}")
    return True


def print_tree(target: str, emoji_idx, producers, starter_names, depth: int, max_depth: int):
    """递归打印分叉树（每节点展开它的直接配方），到 max_depth 层后截断。"""
    visited: Set[str] = set()

    def _walk(name: str, lvl: int, prefix: str, is_last: bool):
        marker = "└─ " if is_last else "├─ "
        tag = ""
        if name in starter_names:
            tag = " 🌱"
        if name in visited:
            print(f"{prefix}{marker}{name} {em(name, emoji_idx)}{tag} (已展开，省略)")
            return
        print(f"{prefix}{marker}{name} {em(name, emoji_idx)}{tag}")
        if lvl >= max_depth or name in starter_names:
            return
        visited.add(name)
        child_prefix = prefix + ("    " if is_last else "│   ")
        rs = producers.get(name, [])
        if not rs:
            return
        for i, (a, b) in enumerate(rs):
            combo_label = f"{a} + {b}"
            last = i == len(rs) - 1
            print(f"{child_prefix}{'└' if last else '├'}◆ {combo_label}")
            # 递归展开 a 和 b
            sub_prefix = child_prefix + ("    " if last else "│   ")
            _walk(a, lvl + 1, sub_prefix, False)
            _walk(b, lvl + 1, sub_prefix, True)

    print(f"\n【{target} {em(target, emoji_idx)}】合成树（展开深度 {max_depth}）:")
    _walk(target, 0, "", True)


# -------------------- 子命令 --------------------
def cmd_trace(args, emoji_idx, starter_names, producers, depth, path) -> int:
    ok = True
    for t in args.names:
        if args.all_recipes:
            ok &= print_all_recipes(t, emoji_idx, producers)
        elif args.tree:
            if t not in emoji_idx:
                print(f"\n【{t}】不存在 ✗")
                ok = False
                continue
            print_tree(t, emoji_idx, producers, starter_names, 0, args.tree_depth)
        else:
            ok &= print_shortest(t, emoji_idx, starter_names, depth, path)
    return 0 if ok else 1


def cmd_bounty_report(emoji_idx, starter_names, depth) -> int:
    """列出悬赏榜所有目标的深度，按深度排序。"""
    try:
        sys.path.insert(0, str(ROOT / "backend"))
        import bounty as bounty_mod  # noqa
    except Exception as e:
        print(f"加载 bounty.py 失败: {e}")
        return 1

    targets: Set[str] = set()
    for p in bounty_mod.HALL_OF_FAME:
        targets.add(p["real"])
        targets.add(p["alias"])
    for g in bounty_mod.GROUPS:
        targets.update(g.get("whitelist", []))

    rows = []
    for t in sorted(targets):
        d = depth.get(t)
        rows.append((t, d if d is not None else -1))
    rows.sort(key=lambda x: (x[1] if x[1] >= 0 else 9999, x[0]))

    print(f"\n悬赏榜 {len(targets)} 个目标的深度分布:")
    print(f"{'深度':>5}  目标")
    print("-" * 40)
    for t, d in rows:
        label = "❌ 不可达" if d < 0 else f"{d:>2}步"
        print(f"{label:>5}  {t} {em(t, emoji_idx)}")

    # 简短 histogram
    from collections import Counter
    hist = Counter(d for _, d in rows if d >= 0)
    print("\n直方图（合成步数）:")
    for d in sorted(hist):
        bar = "█" * hist[d]
        print(f"  {d:>2}步: {hist[d]:>3} 个  {bar}")
    avg = sum(d for _, d in rows if d >= 0) / max(1, sum(1 for _, d in rows if d >= 0))
    print(f"\n平均深度: {avg:.2f}")
    unreach = sum(1 for _, d in rows if d < 0)
    if unreach:
        print(f"⚠️ {unreach} 个悬赏不可达")
    return 0 if unreach == 0 else 1


def cmd_unreachable(emoji_idx, starter_names, depth) -> int:
    all_names = set(emoji_idx)
    reach = set(depth)
    unreach = sorted(all_names - reach)
    print(f"\n不可达元素: {len(unreach)} 个")
    for u in unreach:
        print(f"  {u} {em(u, emoji_idx)}")
    return 0 if not unreach else 1


def cmd_list_starters(emoji_idx, starter_names) -> int:
    print(f"\n当前 starter（开局自带 🌱）共 {len(starter_names)} 个:")
    for s in sorted(starter_names):
        print(f"  {em(s, emoji_idx)} {s}")
    return 0


# -------------------- main --------------------
def main():
    parser = argparse.ArgumentParser(
        prog="trace_recipe",
        description="查询元素合成链路（管理员工具，纯读 seed JSON）",
    )
    parser.add_argument(
        "names",
        nargs="*",
        help="要查询的元素名（支持多个，如 '滨海大厦 天美 Pony'）",
    )
    parser.add_argument(
        "--all-recipes", "-a",
        action="store_true",
        help="列出目标的所有直接配方（a+b=target），而不是最短路径",
    )
    parser.add_argument(
        "--tree", "-t",
        action="store_true",
        help="展开成树形（每节点递归显示它的直接配方）",
    )
    parser.add_argument(
        "--tree-depth",
        type=int,
        default=2,
        help="树形展开深度（配合 --tree 使用），默认 2",
    )
    parser.add_argument(
        "--bounty-report",
        action="store_true",
        help="打印悬赏榜所有目标的深度分布报告",
    )
    parser.add_argument(
        "--unreachable",
        action="store_true",
        help="列出所有当前不可达的元素",
    )
    parser.add_argument(
        "--list-starters",
        action="store_true",
        help="列出当前所有 starter",
    )
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="关闭 AI 配方合并，仅用 seed JSON（默认会叠加 data/{env}.db 里的 llm 配方）",
    )
    parser.add_argument(
        "--env",
        default=os.environ.get("APP_ENV", "prod"),
        help="选择 archive 库：prod / dev / test（默认 prod，也读 $APP_ENV）",
    )
    args = parser.parse_args()

    elems, combos = load_data(include_llm=not args.no_llm, env=args.env)
    emoji_idx, starter_names, rules, producers = build_index(elems, combos)
    depth, path = compute_depth_and_paths(starter_names, rules)

    # 专用子命令优先
    if args.list_starters:
        return cmd_list_starters(emoji_idx, starter_names)
    if args.bounty_report:
        return cmd_bounty_report(emoji_idx, starter_names, depth)
    if args.unreachable:
        return cmd_unreachable(emoji_idx, starter_names, depth)

    # 无参数 + 无子命令 → 帮助
    if not args.names:
        parser.print_help()
        print("\n示例:")
        print("  python scripts/trace_recipe.py 滨海大厦")
        print("  python scripts/trace_recipe.py --all-recipes 王者荣耀")
        print("  python scripts/trace_recipe.py --tree 天美")
        print("  python scripts/trace_recipe.py --bounty-report")
        return 0

    return cmd_trace(args, emoji_idx, starter_names, producers, depth, path)


if __name__ == "__main__":
    sys.exit(main())
