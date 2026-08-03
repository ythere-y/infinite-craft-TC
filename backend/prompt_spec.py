"""Render combination prompts from the canonical shared specification."""

import json
import random
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional


SPEC_PATH = Path(__file__).parent.parent / "shared" / "combine-prompt.json"


@lru_cache(maxsize=1)
def load_prompt_spec() -> Dict[str, Any]:
    with SPEC_PATH.open(encoding="utf-8") as source:
        return json.load(source)


def select_style(spec: Dict[str, Any], value: float) -> Dict[str, Any]:
    roll = max(0.0, min(0.9999999999999999, float(value)))
    cumulative = 0.0
    enabled = [item for item in spec["styles"] if item.get("enabled", True)]
    for item in enabled:
        cumulative += float(item["weight"])
        if roll < cumulative:
            return item
    return enabled[-1]


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_prompt_messages(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    bounty_candidates: Optional[List[Dict[str, Any]]] = None,
    community_examples: Optional[List[Dict[str, Any]]] = None,
    style_value: Optional[float] = None,
) -> Dict[str, Any]:
    spec = load_prompt_spec()
    style = select_style(spec, random.random() if style_value is None else style_value)
    system = "\n\n".join(
        item["content"]
        for item in sorted(spec["system_modules"], key=lambda item: item["order"])
        if item.get("enabled", True)
    )
    limits = spec["limits"]
    lines = ["【示例】"]

    for example in spec["examples"]:
        if not example.get("enabled", True):
            continue
        lines.append(f"输入：{_json(example['input'])}")
        lines.append(f"输出：{_json(example['output'])}")
    lines.append("")

    if community_examples:
        lines.append("【社区高质量示例（仅参考风格，不要照抄）】")
        for item in community_examples[: limits["community_examples"]]:
            input_example = {"a": item.get("a", ""), "b": item.get("b", "")}
            output_example = {
                "name": item.get("name", ""),
                "emoji": item.get("emoji", ""),
                "comment": item.get("comment", ""),
            }
            lines.append(f"输入：{_json(input_example)} 输出：{_json(output_example)}")
        lines.append("")

    if avoid_words:
        lines.append("【avoid_words（禁词，不要再用）】")
        lines.append("、".join(avoid_words[: limits["avoid_words"]]))
        lines.append("")

    if bounty_candidates:
        lines.append("【悬赏候选（未解锁 · 若语义顺理成章，请优先产出其中一个）】")
        for item in bounty_candidates[: limits["bounty_candidates"]]:
            name = item.get("name", "")
            if name:
                lines.append(
                    f"- {name} {item.get('emoji', '')}  [{item.get('category', '')}]"
                )
        lines.append("（以上词语义不合适就忽略，不要硬塞。）")
        lines.append("")

    lines.extend([
        f"【本次偏好】{style['label']}",
        style["guidance"],
        "",
        "【本次输入】",
        f"输入：{_json({'a': a, 'b': b})}",
        "输出：",
    ])
    return {
        "system": system,
        "user": "\n".join(lines),
        "temperature": float(spec["temperature"]),
        "style_id": style["id"],
    }
