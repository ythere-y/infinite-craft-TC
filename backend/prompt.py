"""Prompt orchestration, bounty candidate selection, and response parsing."""

import json
import re
from typing import Dict, List, Optional

from .comments import normalize_comment
from . import prompt_store
from .prompt_spec import (
    build_prompt_messages,
    build_prompt_messages_from_spec,
    load_prompt_spec,
)


def _select_bounty_candidates(
    a: str,
    b: str,
    limit: Optional[int] = None,
) -> List[Dict]:
    """Return relevant, undiscovered bounty candidates for a combination."""
    if limit is None:
        limit = load_prompt_spec()["limits"]["bounty_candidates"]
    try:
        from . import bounty, db, seed_loader
    except Exception:
        return []

    store = getattr(seed_loader, "store", None)
    if store is None:
        return []
    try:
        payload = bounty.build_bounty(db, store)
    except Exception:
        return []

    a_info = store.elements.get(a) or {}
    b_info = store.elements.get(b) or {}
    a_cat = a_info.get("category")
    b_cat = b_info.get("category")
    scored: List[tuple] = []

    for group in payload.get("groups", []):
        group_category = group.get("category")
        for item in group.get("items", []):
            if item.get("discovered"):
                continue
            name = item.get("name", "")
            emoji = item.get("emoji", "❓")
            if not name:
                continue
            score = 0
            if group_category and (group_category == a_cat or group_category == b_cat):
                score += 4
            if a and a in name:
                score += 3
            if b and b in name:
                score += 3
            if name in a or name in b:
                score += 2

            bg_hints = {
                "游戏": "IEG", "微信": "WXG", "云": "CSIG", "视频号": "PCG",
                "代码": "TEG", "广告": "CDG", "腾讯云": "CSIG",
            }
            for trigger, target in bg_hints.items():
                if trigger in (a, b) and name == target:
                    score += 6

            if group_category == "building":
                geo_hints = {
                    "深圳": ("腾讯大厦", "滨海大厦", "T1塔楼", "金地威新"),
                    "南山": ("滨海大厦", "T1塔楼"),
                    "滨海": ("滨海大厦",), "前海": ("T1塔楼",),
                    "科兴": ("科兴科学园",), "琶洲": ("琶洲新总部",),
                    "广州": ("TIT创意园", "微信总部"), "北京": ("北京总部",),
                    "上海": ("上海总部",), "成都": ("成都办公楼",),
                }
                for trigger, targets in geo_hints.items():
                    if trigger in (a, b) and name in targets:
                        score += 6
            if score > 0:
                scored.append((score, {"name": name, "emoji": emoji, "category": group_category}))

    scored.sort(key=lambda entry: -entry[0])
    return [item for _, item in scored[:limit]]


def build_prompt(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    bounty_candidates: Optional[List[Dict]] = None,
    community_examples: Optional[List[Dict]] = None,
) -> str:
    """Preserve the legacy single-string prompt interface."""
    messages = build_prompt_messages(
        a=a,
        b=b,
        avoid_words=avoid_words or [],
        bounty_candidates=bounty_candidates or [],
        community_examples=community_examples or [],
    )
    return f'{messages["system"]}\n\n{messages["user"]}'


_JSON_RE = re.compile(r'\{[^{}]*"name"[^{}]*"emoji"[^{}]*\}', re.DOTALL)


def parse_response(text: str) -> Optional[Dict[str, str]]:
    """Extract a valid combination result from an LLM response."""
    if not text:
        return None
    try:
        obj = json.loads(text.strip())
        if "name" in obj and "emoji" in obj:
            return _sanitize(obj)
    except json.JSONDecodeError:
        pass
    match = _JSON_RE.search(text)
    if match:
        try:
            obj = json.loads(match.group(0))
            if "name" in obj and "emoji" in obj:
                return _sanitize(obj)
        except json.JSONDecodeError:
            pass
    return None


def _sanitize(obj: Dict) -> Optional[Dict[str, str]]:
    name = str(obj.get("name", "")).strip()
    emoji = str(obj.get("emoji", "")).strip()
    if not name or not emoji or len(name) > 10:
        return None
    return {
        "name": name,
        "emoji": emoji,
        "comment": normalize_comment(obj.get("comment")),
    }


def combine_via_llm(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    community_examples: Optional[List[Dict]] = None,
    request_id: Optional[str] = None,
    prompt_spec: Optional[Dict] = None,
) -> Optional[Dict[str, str]]:
    """Call the configured OpenAI-compatible LLM for a combination."""
    from .llm import query

    spec = prompt_spec if prompt_spec is not None else prompt_store.get_active_spec()
    try:
        bounty_candidates = _select_bounty_candidates(
            a,
            b,
            limit=spec["limits"]["bounty_candidates"],
        )
    except Exception:
        bounty_candidates = []

    messages = build_prompt_messages_from_spec(
        spec,
        a=a,
        b=b,
        avoid_words=avoid_words or [],
        bounty_candidates=bounty_candidates,
        community_examples=community_examples or [],
    )
    raw = query(
        {
            "system_prompt": messages["system"],
            "question": messages["user"],
            "request_id": request_id,
        },
        temperature=messages["temperature"],
    )
    text = ""
    if isinstance(raw, dict):
        data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
        text = (
            data.get("answer") or raw.get("answer") or raw.get("text")
            or raw.get("output") or raw.get("result") or ""
        )
    elif isinstance(raw, str):
        text = raw
    return parse_response(text)
