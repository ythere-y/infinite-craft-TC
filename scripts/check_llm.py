#!/usr/bin/env python3
"""Safely verify the configured OpenAI-compatible LLM adapter."""

from __future__ import annotations

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.llm import configuration_status, query


def main() -> int:
    if configuration_status() != "configured":
        print("llm configuration: not_configured")
        return 1

    result = query({"question": "Reply with exactly: OK"}, temperature=0)
    if not result or not isinstance(result.get("text"), str):
        print("llm live request: failed")
        return 2

    print("llm live request: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
