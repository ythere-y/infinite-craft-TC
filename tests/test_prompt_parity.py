import json
from pathlib import Path
import subprocess

import pytest

from backend import prompt_spec
from backend.prompt_spec import build_prompt_messages


ROOT = Path(__file__).resolve().parent.parent
VARIANT = json.loads(
    (ROOT / "tests" / "fixtures" / "prompt-renderer-variant.json").read_text(
        encoding="utf-8"
    )
)


def fixture():
    return {
        "a": "需求",
        "b": "咖啡",
        "avoid_words": ["旧结果"],
        "bounty_candidates": [{"name": "CSIG", "emoji": "☁️", "category": "bg"}],
        "community_examples": [{
            "a": "需求",
            "b": "会议",
            "name": "排期",
            "emoji": "🗓️",
            "comment": "需求一进会议室，就有了截止日期。",
        }],
        "style_value": 0.30,
    }


def render_makers(data):
    node_source = """
import { buildPromptMessages } from "./edge-functions/_lib/prompt.js";
const input = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify(buildPromptMessages(input)));
""".strip()
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", node_source, json.dumps(data, ensure_ascii=False)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_python_and_makers_render_identical_messages():
    expected = build_prompt_messages(**fixture())
    assert render_makers(fixture()) == expected
    assert expected["style_id"] == "concrete-scene"
    assert "【本次偏好】偏具体场景" in expected["user"]
    assert "优先落到一个能直接想象的具体画面。" in expected["user"]


@pytest.mark.parametrize(
    ("style_value", "expected_style_id"),
    [
        (-0.01, "invented-word"),
        (1, "past-present"),
        (2, "past-present"),
    ],
)
def test_cross_runtime_clamps_style_values(style_value, expected_style_id):
    data = fixture()
    data["style_value"] = style_value

    expected = build_prompt_messages(**data)
    assert expected["style_id"] == expected_style_id
    assert render_makers(data) == expected


def test_cross_runtime_limits_dynamic_sections_and_preserves_section_order():
    data = {
        "a": "需求",
        "b": "咖啡",
        "style_value": 0,
        "community_examples": [
            {"a": f"社区输入{index}", "b": "会议", "name": f"社区保留{index}", "emoji": "🗓️", "comment": "有效示例"}
            for index in range(8)
        ] + [{"a": "社区截断输入", "b": "会议", "name": "社区截断", "emoji": "❌", "comment": "不应出现"}],
        "avoid_words": [f"禁词{index}" for index in range(31)],
        "bounty_candidates": [
            {"name": f"候选{index}", "emoji": "☁️", "category": "bg"}
            for index in range(12)
        ] + [{"name": "候选截断", "emoji": "❌", "category": "bg"}],
    }

    expected = build_prompt_messages(**data)
    assert render_makers(data) == expected
    user = expected["user"]
    assert "社区保留7" in user
    assert "社区截断" not in user
    assert "禁词29" in user
    assert "禁词30" not in user
    assert "候选11" in user
    assert "候选截断" not in user

    section_positions = [
        user.index("【示例】"),
        user.index("【社区高质量示例"),
        user.index("【avoid_words"),
        user.index("【悬赏候选"),
        user.index("【本次偏好】"),
        user.index("【本次输入】"),
    ]
    assert section_positions == sorted(section_positions)


def test_python_renderer_from_spec_matches_independent_variant_oracle():
    render_from_spec = getattr(prompt_spec, "build_prompt_messages_from_spec")
    assert render_from_spec(VARIANT["spec"], **VARIANT["input"]) == VARIANT["expected"]
