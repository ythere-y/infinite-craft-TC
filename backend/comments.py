"""Synthesis-comment validation and degradation policy."""

from __future__ import annotations

import re
from typing import Any

DEFAULT_COMMENT = "这波组合很有想法，建议先小范围灰度。"
MAX_COMMENT_CHARS = 30

_CONTROL_OR_NEWLINE_RE = re.compile(r"[\x00-\x1f\x7f]")
_SPACE_RE = re.compile(r"[^\S\r\n]+")


def normalize_comment(value: Any) -> str:
    """Return one safe, short comment or the shared default."""
    if not isinstance(value, str):
        return DEFAULT_COMMENT
    if _CONTROL_OR_NEWLINE_RE.search(value):
        return DEFAULT_COMMENT
    normalized = _SPACE_RE.sub(" ", value.strip())
    if not normalized or len(normalized) > MAX_COMMENT_CHARS:
        return DEFAULT_COMMENT
    return normalized
