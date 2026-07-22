"""
GLM-5.1-64K Prompt 模板
职责：当 Redis 缓存 miss 时，构造 prompt 调用 GLM 生成合成结果。
约束：输出必须是 JSON { "name": str, "emoji": str }，温度稍高，few-shot 提供风格示例。

多样性策略（2026-04 优化）：
- 不再给"优先级词表"做 anchor（模型会反复抽里面的词）
- 改为"主题方向池"，鼓励跨方向组合和造词
- 每次调用传入 `avoid_words` 作为禁词列表（见 backend/main.py）
- 温度 0.85 + 每次随机 hint，让相同组合在未缓存时也能有不同候选
"""

import json
import random
import re
from typing import Optional, Dict, List

# ============================================================
# System Prompt：定义裁判身份 + 鼓励多样性
# ============================================================
SYSTEM_PROMPT = """你是《鹅厂无限合成 ♾️》的合成裁判。
用户给你两个元素，你要判断它们合成后得到什么元素。
绝大多数情况下，你应该返回一个全新的元素。
只有在其中一方是具有"吞噬/尽头"性质的元素时（例如 黑洞、虚无、深渊、
熵增、终点），它会把另一个元素吞没，此时直接返回那个"吞噬者"本身即可。
除此之外，不要偷懒返回输入元素之一。

【硬约束】
1. 只返回 JSON，禁止任何解释性文字、markdown、代码块围栏。
2. JSON 格式：{"name": "元素名", "emoji": "单个emoji"}
3. name 必须是中文或中英混搭，长度 2-8 个字。
4. emoji 必须是单个 emoji 字符（可以是复合 emoji，如 👨‍🦲）。

【风格主题（不是词表，不要反复抽同一个词）】
合成结果可以来自以下任一方向，每次要"意料之外情理之中"：
- 鹅厂/互联网大厂职场文化：工作流、组织、绩效、岗位、工种、项目周期
- 打工人日常：通勤、工位、午休、餐食、加班、离职、焦虑、摆烂、反抗
- 中文互联网近期热梗：短视频段子、网红事件、二创文化、青年亚文化
- 自造词（**首选**）：用常见字重组一个以前没出现过但一看就懂的新词
- 具体场景词：直接描述一个可视化画面（如"带薪冥想""工位床位"）
- 跨界混搭：科技词 × 生活词、古语 × 现代名词、中文 × 英文缩写
- 成语/俗语化用（**偶尔一次**，别成为默认答案）：把日常梗套进成语形式，要求有反差感

【多样性硬要求】
- 不要让一半以上的合成都指向"南极圈、打工鹅、周报、OKR、瑞雪、酱板鸭"这几个老词
- 同一个元素 × 不同搭档 应该产出不同方向的结果
- 同一个元素 × 自己（如"腾讯会议+腾讯会议"）返回"升级/过载/叠加态"含义（例：马拉松会议、会议疲劳、会议套娃）
- 见到 avoid_words 列表里的词，严禁再用，必须换新角度
- **避免成语路径依赖**：
  · 单次合成结果最多只能有一个是四字成语形式，其余应该是自造词/场景词/中英混搭
  · 不要用"望梅止渴、人间炼狱、学海无涯、一地鸡毛、鸡飞蛋打"等常见成语堆砌
  · 如果想不到新点子，**优先自造一个 3-5 字新词**，而不是回落到成语

【合成哲学】
- 不要生硬科普（水+火 别只给"蒸汽"）
- 一个物理 + 一个打工人元素 → 往打工人方向走
- 两个打工人元素 → 找职场/生活里能对应的具象场景
- 两个抽象元素 → **优先自造词或具体画面**（不要默认给成语）
- 合成要有梗，接地气，不装腔
- **默认首选"自造词/场景词/中英混搭"，四字成语不是安全牌，慎用**

【✨ 惰性合成 / 吞噬合成（允许返回原料之一）】
不是每次合成都必须造出新词。当两个元素中的一方"强大/根本/无限/吞噬一切"时，
另一方会被"吞掉"或"失效"，**合成结果直接等于那个强元素本身**（name 和 emoji 都照搬）。
适用场景（举例）：
- 吞噬型元素 + 任何普通元素 → 吞噬型元素本身
  例：「虚空 + 加班 = 虚空」「♾️infinity + 水 = ♾️infinity」「黑洞 + 摸鱼 = 黑洞」
- 超大尺度 > 小尺度，大的不变、小的被吸收
  例：「宇宙 + 人 = 宇宙」「海洋 + 水塘 = 海洋」「地球 + 土 = 地球」
- 强抽象 + 弱具象（绝对属性保留自己）
  例：「时间 + 焦虑 = 时间」「死亡 + 希望 = 死亡」
- 鹅厂元宇宙级别符号 + 小打工人元素
  例：「小马哥 + 打工人 = 小马哥」「Pony + 发疯 = Pony」（强符号压过普通情绪）
判断原则：
- 只有当一方**语义上明显吞噬另一方**时才返回原料，不是偷懒的万能解
- 返回原料时 name 必须和原输入**完全一致**（含大小写、emoji、符号）
- 如果不确定谁吞谁，就按普通合成处理，产出新词
- 悬赏候选（若有提供）的优先级仍高于惰性合成，能命中悬赏就别返回原料

【🎯 悬赏榜倾向（软偏好，非硬约束）】
系统维护了一份"腾讯悬赏图鉴"：包含腾讯的 BG 代号、产品线、游戏工作室、办公楼、T/P/M族
职级、被投公司、创始人及其花名等强腾讯相关的目标词。用户的游戏目标之一就是把这些词
"合成出来"解锁图鉴。
- 每次调用会在【悬赏候选】段给你列一批"**与本次输入语义相关、且玩家尚未解锁**"的目标词。
- 如果其中某个词跟本次 a+b 在语义上顺理成章（比如 老板+创始人→可能是张志东/许晨晔/
  陈一丹/曾李青 中的一位，云+鹅厂→CSIG，枪+游戏→和平精英，工位+小床→程序员床位），
  **请优先产出这个悬赏词**。
- 如果候选里没有任何一个在语义上合适，千万不要硬塞——退回到正常的创意合成。
- 悬赏词自带权威 emoji，若产出悬赏词请尽量用榜单预设 emoji（示例会告诉你）。

【内容安全】
- 输出必须遵循部署环境配置的内容安全策略和人工审核要求。
- 不确定时，回落到中性的场景词或自造词。
"""

# ============================================================
# Few-shot 示例：精简，只示范"风格"不示范"词表"
# ============================================================
# 设计原则：
# - 每条 few-shot 的 result 都不同（不重复用词）
# - 覆盖不同风格：成语化 / 自造词 / 场景词 / 英文混搭
# - 不堆砌"南极圈/打工鹅/瑞雪"这种高频词（会被模型当成标准答案）
FEW_SHOT_EXAMPLES = [
    # 成语化（只保留 1 条，示范"有反差感的成语化用"这一风味）
    ({"a": "老板", "b": "画饼"}, {"name": "望梅止渴", "emoji": "🥧"}),
    # 自造词（主力风格，多示范几条）
    ({"a": "咖啡", "b": "夜宵券"}, {"name": "续命二连", "emoji": "☕"}),
    ({"a": "会议", "b": "会议"}, {"name": "会议套娃", "emoji": "🪆"}),
    ({"a": "工位", "b": "折叠椅"}, {"name": "工位床位", "emoji": "🛏️"}),
    ({"a": "周报", "b": "ChatGPT"}, {"name": "AI代笔", "emoji": "🤖"}),
    # 场景词（具体到一个画面，不追求对仗工整）
    ({"a": "厕所", "b": "手机"}, {"name": "带薪冥想", "emoji": "🧘"}),
    ({"a": "火", "b": "头发"}, {"name": "地中海", "emoji": "👨‍🦲"}),
    ({"a": "周一", "b": "地铁"}, {"name": "沙丁鱼罐头", "emoji": "🚇"}),
    # 中英混搭
    ({"a": "周五", "b": "下班"}, {"name": "GG时刻", "emoji": "🎉"}),
    ({"a": "PPT", "b": "通宵"}, {"name": "deadline战士", "emoji": "💀"}),
    # 同元素 × 2
    ({"a": "腾讯会议", "b": "腾讯会议"}, {"name": "会议通缉令", "emoji": "📢"}),
    # 抽象 → 自造词（原来这里是"学海无涯"成语，换成自造概念词，避免暗示"抽象=成语"）
    ({"a": "知识", "b": "时间"}, {"name": "学费复利", "emoji": "📚"}),
    # 纯物理（保底）
    ({"a": "水", "b": "土"}, {"name": "泥", "emoji": "🟤"}),
    # ✨ 惰性/吞噬合成（返回原料之一）
    ({"a": "虚空", "b": "加班"}, {"name": "虚空", "emoji": "🕳️"}),
    ({"a": "宇宙", "b": "人"}, {"name": "宇宙", "emoji": "🌌"}),
]


def _select_bounty_candidates(a: str, b: str, limit: int = 12) -> List[Dict]:
    """
    从 bounty 图鉴里挑出"与 a/b 语义相关、且尚未被玩家解锁"的候选目标词。

    评分启发：
    - 同 category 的词加权（a/b 在 seed 里的 category 决定方向）
    - BG/产品线/工作室/办公楼对具体触发词更敏感
    - 名字里含 a 或 b 的子串的优先
    - 创始人类词在含"创始人/老板/Pony/代码/RTX/工牌/投资"时加权

    返回 [{"name": str, "emoji": str, "hint": str}, ...] 最多 limit 条，都是**未发现**的。
    """
    try:
        from . import bounty, db, seed_loader
    except Exception:
        return []

    store = getattr(seed_loader, "store", None)
    if store is None:
        return []

    # 收集所有悬赏目标（带 emoji、category、是否已发现）
    try:
        payload = bounty.build_bounty(db, store)
    except Exception:
        return []

    a_info = store.elements.get(a) or {}
    b_info = store.elements.get(b) or {}
    a_cat = a_info.get("category")
    b_cat = b_info.get("category")

    scored: List[tuple] = []  # (score, item_dict)

    for g in payload.get("groups", []):
        gcat = g.get("category")
        for it in g.get("items", []):
            if it.get("discovered"):
                continue  # 已解锁的跳过
            name = it.get("name", "")
            emoji = it.get("emoji", "❓")
            if not name:
                continue
            score = 0
            # category 匹配
            if gcat and (gcat == a_cat or gcat == b_cat):
                score += 4
            # 名字含 a / b 的子串（比如 a="云"→"腾讯云""CSIG" 命中词很少）
            if a and a in name:
                score += 3
            if b and b in name:
                score += 3
            # 名字与 a/b 互为包含的反向（a="腾讯云"→"云"）
            if name in a or name in b:
                score += 2
            # 创始人类目——a/b 含高管/创始人信号时加权
            founder_signals = {
                "创始人",
                "老板",
                "Pony",
                "代码",
                "RTX",
                "工牌",
                "投资",
                "COO",
                "iWiki",
                "门禁",
            }
            if gcat == "boss" and ({a, b} & founder_signals):
                score += 5
            # BG 类——含具体业务触发词时加权
            bg_hints = {
                "游戏": "IEG",
                "微信": "WXG",
                "云": "CSIG",
                "视频号": "PCG",
                "代码": "TEG",
                "广告": "CDG",
                "腾讯云": "CSIG",
            }
            for trigger, bg in bg_hints.items():
                if trigger in (a, b) and name == bg:
                    score += 6
            # 地理/办公楼——含地名触发
            if gcat == "building":
                geo_hints = {
                    "深圳": ("腾讯大厦", "滨海大厦", "T1塔楼", "金地威新"),
                    "南山": ("滨海大厦", "T1塔楼"),
                    "滨海": ("滨海大厦",),
                    "前海": ("T1塔楼",),
                    "科兴": ("科兴科学园",),
                    "琶洲": ("琶洲新总部",),
                    "广州": ("TIT创意园", "微信总部"),
                    "北京": ("北京总部",),
                    "上海": ("上海总部",),
                    "成都": ("成都办公楼",),
                }
                for trigger, targets in geo_hints.items():
                    if trigger in (a, b) and name in targets:
                        score += 6
            if score <= 0:
                continue
            scored.append((score, {"name": name, "emoji": emoji, "category": gcat}))

    scored.sort(key=lambda x: -x[0])
    return [item for _, item in scored[:limit]]


def build_prompt(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    bounty_candidates: Optional[List[Dict]] = None,
) -> str:
    """
    构造给 GLM 的完整 prompt。

    Args:
        a, b: 两个待合成元素
        avoid_words: 最近已经被用过的结果词列表，作为禁词提示
        bounty_candidates: 与本次输入相关的"未解锁悬赏目标"候选（最多 ~12 条）
    """
    avoid_words = avoid_words or []
    bounty_candidates = bounty_candidates or []
    lines = [SYSTEM_PROMPT, "", "【示例】"]
    for inp, out in FEW_SHOT_EXAMPLES:
        lines.append(f"输入：{json.dumps(inp, ensure_ascii=False)}")
        lines.append(f"输出：{json.dumps(out, ensure_ascii=False)}")
    lines.append("")

    if avoid_words:
        # 避免 prompt 过长，截断到 30 个
        sample = avoid_words[:30]
        lines.append(f"【avoid_words（禁词，不要再用）】")
        lines.append("、".join(sample))
        lines.append("")

    if bounty_candidates:
        lines.append("【悬赏候选（未解锁 · 若语义顺理成章，请优先产出其中一个）】")
        for it in bounty_candidates:
            nm = it.get("name", "")
            em = it.get("emoji", "")
            cat = it.get("category", "")
            if not nm:
                continue
            lines.append(f"- {nm} {em}  [{cat}]")
        lines.append("（以上词语义不合适就忽略，不要硬塞。）")
        lines.append("")

    # 加一个随机风格 hint，让相同 (a,b) 未缓存时也能有不同候选。
    # 权重显著倾向"自造词/场景词/跨界混搭"，成语/古今方向压到 10% 以内，
    # 避免模型形成"默认输出四字成语"的路径依赖。
    hint_options = [
        ("偏自造词", 0.30),
        ("偏具体场景", 0.25),
        ("偏跨界混搭", 0.15),
        ("偏中英混搭", 0.10),
        ("偏动作描述", 0.10),
        ("偏成语化", 0.05),
        ("偏古今对照", 0.05),
    ]
    hint = random.choices(
        [h for h, _ in hint_options],
        weights=[w for _, w in hint_options],
        k=1,
    )[0]
    lines.append(f"【本次偏好】{hint}")
    lines.append("")

    lines.append("【本次输入】")
    lines.append(f"输入：{json.dumps({'a': a, 'b': b}, ensure_ascii=False)}")
    lines.append("输出：")
    return "\n".join(lines)


# ============================================================
# 解析 GLM 返回
# ============================================================
_JSON_RE = re.compile(r'\{[^{}]*"name"[^{}]*"emoji"[^{}]*\}', re.DOTALL)


def parse_response(text: str) -> Optional[Dict[str, str]]:
    """
    从 LLM 返回文本里抽 JSON。模型有时会包 ```json ... ``` 或加解释，做兼容。
    返回 {"name": str, "emoji": str} 或 None（解析失败）。
    """
    if not text:
        return None
    try:
        obj = json.loads(text.strip())
        if "name" in obj and "emoji" in obj:
            return _sanitize(obj)
    except json.JSONDecodeError:
        pass
    m = _JSON_RE.search(text)
    if m:
        try:
            obj = json.loads(m.group(0))
            if "name" in obj and "emoji" in obj:
                return _sanitize(obj)
        except json.JSONDecodeError:
            pass
    return None


def _sanitize(obj: Dict) -> Optional[Dict[str, str]]:
    name = str(obj.get("name", "")).strip()
    emoji = str(obj.get("emoji", "")).strip()
    if not name or not emoji:
        return None
    if len(name) > 10:
        return None
    return {"name": name, "emoji": emoji}


# ============================================================
# 调用入口
# ============================================================
def combine_via_llm(
    a: str,
    b: str,
    avoid_words: Optional[List[str]] = None,
    request_id: Optional[str] = None,
) -> Optional[Dict[str, str]]:
    """
    调用已配置的 OpenAI-compatible LLM 合成。

    Args:
        a, b: 两个元素
        avoid_words: 已有结果词（禁词提示）
    """
    from .llm import query  # noqa: 延迟 import

    # 基于 bounty 图鉴挑选与 (a,b) 相关且未解锁的悬赏候选词，让 LLM 有机会产出它们
    try:
        bounty_candidates = _select_bounty_candidates(a, b, limit=12)
    except Exception:
        bounty_candidates = []

    prompt = build_prompt(
        a, b, avoid_words=avoid_words, bounty_candidates=bounty_candidates
    )
    # 带温度调用，让相同输入也能有多样输出
    raw = query(
        {"question": prompt, "request_id": request_id},
        temperature=0.85,
    )
    text = ""
    if isinstance(raw, dict):
        data = raw.get("data") if isinstance(raw.get("data"), dict) else {}
        text = (
            data.get("answer")
            or raw.get("answer")
            or raw.get("text")
            or raw.get("output")
            or raw.get("result")
            or ""
        )
    elif isinstance(raw, str):
        text = raw
    return parse_response(text)
