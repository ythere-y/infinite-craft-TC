from __future__ import annotations

import json

import pytest

from backend import prompt
from backend.comments import DEFAULT_COMMENT, normalize_comment


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("  开会以后，需求有了自己的需求。  ", "开会以后，需求有了自己的需求。"),
        ("一句   有空格的点评", "一句 有空格的点评"),
        (None, DEFAULT_COMMENT),
        ("", DEFAULT_COMMENT),
        ("第一行\n第二行", DEFAULT_COMMENT),
        ("x" * 31, DEFAULT_COMMENT),
        (
            "<img src=x onerror=alert(1)>",
            "<img src=x onerror=alert(1)>",
        ),
    ],
)
def test_normalize_comment(value, expected):
    assert normalize_comment(value) == expected


def test_parse_response_keeps_valid_comment():
    payload = {
        "name": "需求膨胀",
        "emoji": "🎈",
        "comment": "开会之后，它有了自己的排期。",
    }
    assert prompt.parse_response(json.dumps(payload, ensure_ascii=False)) == payload


@pytest.mark.parametrize("comment", [None, "", "a\nb", "x" * 31])
def test_invalid_comment_does_not_discard_element(comment):
    payload = {"name": "需求膨胀", "emoji": "🎈"}
    if comment is not None:
        payload["comment"] = comment
    parsed = prompt.parse_response(json.dumps(payload, ensure_ascii=False))
    assert parsed == {
        "name": "需求膨胀",
        "emoji": "🎈",
        "comment": DEFAULT_COMMENT,
    }


def test_prompt_requires_comment_in_same_json_response():
    text = prompt.build_prompt("需求", "会议")
    assert '"comment"' in text
    assert "30" in text
    assert text.rstrip().endswith("输出：")
