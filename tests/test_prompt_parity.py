import json
from pathlib import Path
import subprocess

from backend.prompt_spec import build_prompt_messages


ROOT = Path(__file__).resolve().parent.parent


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


def test_python_and_makers_render_identical_messages():
    expected = build_prompt_messages(**fixture())
    node_source = """
import { buildPromptMessages } from "./edge-functions/_lib/prompt.js";
const input = JSON.parse(process.argv[1]);
process.stdout.write(JSON.stringify(buildPromptMessages(input)));
""".strip()
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", node_source, json.dumps(fixture(), ensure_ascii=False)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(completed.stdout) == expected
    assert expected["style_id"] == "concrete-scene"
    assert "【本次偏好】偏具体场景" in expected["user"]
    assert "优先落到一个能直接想象的具体画面。" in expected["user"]
