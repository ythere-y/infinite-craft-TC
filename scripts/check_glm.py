#!/usr/bin/env python3
"""
LLM API 可用性验证脚本

用法：
  python scripts/check_glm.py
  或：
  python scripts/check_glm.py "你的问题"

输出内容：
  1. HTTP 状态码 / 耗时
  2. 原始响应 JSON 的顶层键和完整内容
  3. 用 prompt.parse_response 尝试解析，看是否走得通合成逻辑
"""

from __future__ import annotations

import json
import os
import sys
import time

import requests

API_URL = os.environ.get("GLM_API_URL", "").strip()
TIMEOUT = float(os.environ.get("GLM_TIMEOUT", "15"))


def query(payload: dict) -> tuple[int, float, object]:
    """返回 (status_code, elapsed_seconds, response_obj_or_text)。"""
    t0 = time.time()
    resp = requests.post(API_URL, json=payload, timeout=TIMEOUT)
    elapsed = time.time() - t0
    try:
        body = resp.json()
    except ValueError:
        body = resp.text
    return resp.status_code, elapsed, body


def pretty(obj) -> str:
    if isinstance(obj, (dict, list)):
        return json.dumps(obj, ensure_ascii=False, indent=2)
    return str(obj)


def summarize_keys(obj, prefix: str = "") -> list[str]:
    """递归列出 JSON 的所有路径（便于识别返回结构）。"""
    paths: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            paths.append(f"{p}  ({type(v).__name__})")
            if isinstance(v, (dict, list)):
                paths.extend(summarize_keys(v, p))
    elif isinstance(obj, list) and obj:
        paths.append(f"{prefix}[0]  ({type(obj[0]).__name__})")
        if isinstance(obj[0], (dict, list)):
            paths.extend(summarize_keys(obj[0], f"{prefix}[0]"))
    return paths


def try_extract_text(obj) -> str | None:
    """尝试从常见字段里抽文本，看能不能复用进 combine 逻辑。"""
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        for k in ("text", "answer", "output", "result", "data", "content", "message"):
            if k in obj:
                v = obj[k]
                if isinstance(v, str) and v.strip():
                    return v
                # 嵌套一层再试
                nested = try_extract_text(v)
                if nested:
                    return nested
    return None


def main() -> int:
    if not API_URL:
        print("❌ 未配置 GLM_API_URL。请在本地 .env 或当前 shell 中设置。")
        return 1

    question = sys.argv[1] if len(sys.argv) > 1 else "Hey, how are you?"

    print("URL     : configured")
    print(f"Timeout : {TIMEOUT}s")
    print(f"Question: {question!r}")
    print("-" * 60)

    # ---- 1. 基础连通性 ----
    try:
        status, elapsed, body = query({"question": question})
    except requests.Timeout:
        print(f"❌ TIMEOUT after {TIMEOUT}s")
        return 2
    except requests.ConnectionError as e:
        print(f"❌ CONNECTION ERROR: {e}")
        return 3
    except Exception as e:
        print(f"❌ UNEXPECTED ERROR: {type(e).__name__}: {e}")
        return 4

    print(f"HTTP    : {status}")
    print(f"Elapsed : {elapsed:.2f}s")
    print()

    # ---- 2. 响应结构 ----
    print("---- 响应结构（路径 & 类型）----")
    paths = summarize_keys(body) if isinstance(body, (dict, list)) else ["(string/text)"]
    for p in paths[:30]:
        print("  ", p)
    if len(paths) > 30:
        print(f"  ... ({len(paths) - 30} more)")
    print()

    # ---- 3. 完整 body（截断）----
    print("---- 完整响应 ----")
    raw = pretty(body)
    if len(raw) > 2000:
        print(raw[:2000] + "\n...(truncated)")
    else:
        print(raw)
    print()

    # ---- 4. 尝试抽文本 ----
    text = try_extract_text(body)
    print("---- 文本字段抽取 ----")
    if text:
        print(f"✅ 找到可用文本 (len={len(text)})：")
        print("   " + (text[:300] + "..." if len(text) > 300 else text))
    else:
        print("⚠️  未能从常见字段 (text/answer/output/result/data/content/message) 提取到文本")
        print("   如果要接入 combine 路径，需要在 backend/prompt.py::combine_via_llm 补对应字段")
    print()

    # ---- 5. 模拟合成调用 ----
    print("---- 模拟 combine（水 + 火）----")
    try:
        # 不 import backend，避免依赖；手搓一个和 prompt.py 同构的请求
        from pathlib import Path
        backend = Path(__file__).resolve().parent.parent / "backend"
        if str(backend.parent) not in sys.path:
            sys.path.insert(0, str(backend.parent))
        from backend.prompt import build_prompt, parse_response  # type: ignore

        combine_q = build_prompt("水", "火")
        status2, elapsed2, body2 = query({"question": combine_q})
        print(f"HTTP    : {status2}")
        print(f"Elapsed : {elapsed2:.2f}s")
        raw_text = try_extract_text(body2) or ""
        if not raw_text:
            print("⚠️  响应里没抽到文本，combine 会回落 fallback")
        else:
            print(f"原始文本片段: {raw_text[:200]!r}")
            parsed = parse_response(raw_text)
            if parsed:
                print(f"✅ parse 成功: {parsed}")
            else:
                print("⚠️  parse_response 解析不到 {name, emoji} JSON，需要调 prompt 或 parser")
    except Exception as e:
        print(f"⚠️  模拟 combine 时异常：{type(e).__name__}: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
