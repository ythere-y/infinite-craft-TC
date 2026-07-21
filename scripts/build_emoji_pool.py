"""
生成 backend/emoji_pool.json —— 把 iamcal/emoji-data 的 1911 个 emoji
按我们场景需要聚合成 32 个类别。

规则：
- 过滤：Flags（国旗，政治敏感）/ Component（肤色）/ alphanum/keycap（纯符号数字）
- 每个 emoji 记录 unified→字符、short_name、keywords（用 short_names + 类别名）
- 输出的类别 id 是中文，便于 LLM prompt 里直接用

不依赖 GLM。离线纯手工映射。
"""

import json
from pathlib import Path
from collections import defaultdict

SRC = Path("words/emoji-data/emoji.json")
DST = Path("backend/emoji_pool.json")

# ============================================================
# 32 个类别映射表：(emoji-data 的 category, subcategory) → 我们的类别
# ============================================================
# 规则：键是 (category, subcategory)。若 subcategory=None，该 category 所有未被更细规则命中的都归这一类
CATEGORY_MAP = {
    # ---------- 笑脸与情绪（拆 5 类）----------
    ("Smileys & Emotion", "face-smiling"):    "正面笑脸",
    ("Smileys & Emotion", "face-affection"):  "爱意",
    ("Smileys & Emotion", "face-tongue"):     "搞怪吐舌",
    ("Smileys & Emotion", "face-hand"):       "手遮脸",
    ("Smileys & Emotion", "face-neutral-skeptical"): "中性怀疑",
    ("Smileys & Emotion", "face-sleepy"):     "困累",
    ("Smileys & Emotion", "face-unwell"):     "不适",
    ("Smileys & Emotion", "face-hat"):        "角色扮演脸",
    ("Smileys & Emotion", "face-glasses"):    "角色扮演脸",
    ("Smileys & Emotion", "face-concerned"):  "负面情绪",
    ("Smileys & Emotion", "face-negative"):   "负面情绪",
    ("Smileys & Emotion", "face-costume"):    "奇幻角色",
    ("Smileys & Emotion", "cat-face"):        "猫表情",
    ("Smileys & Emotion", "monkey-face"):     "猴子反应",
    ("Smileys & Emotion", "emotion"):         "心形情感",
    ("Smileys & Emotion", "heart"):           "心形情感",
    ("Smileys & Emotion", "heart"):           "心形情感",

    # ---------- 人物与手势 ----------
    ("People & Body", "hand-fingers-open"):   "手势",
    ("People & Body", "hand-fingers-partial"):"手势",
    ("People & Body", "hand-single-finger"):  "手势",
    ("People & Body", "hand-fingers-closed"): "手势",
    ("People & Body", "hands"):               "手势",
    ("People & Body", "hand-prop"):           "手势",
    ("People & Body", "body-parts"):          "身体部位",
    ("People & Body", "person"):              "人物",
    ("People & Body", "person-gesture"):      "人物动作",
    ("People & Body", "person-role"):         "职业角色",
    ("People & Body", "person-fantasy"):      "奇幻角色",
    ("People & Body", "person-activity"):     "人物动作",
    ("People & Body", "person-sport"):        "运动员",
    ("People & Body", "person-resting"):      "休息",
    ("People & Body", "family"):              "家庭",
    ("People & Body", "person-symbol"):       "抽象符号",

    # ---------- 动植物自然 ----------
    ("Animals & Nature", "animal-mammal"):    "哺乳动物",
    ("Animals & Nature", "animal-bird"):      "鸟类",
    ("Animals & Nature", "animal-amphibian"): "两栖水生",
    ("Animals & Nature", "animal-reptile"):   "两栖水生",
    ("Animals & Nature", "animal-marine"):    "两栖水生",
    ("Animals & Nature", "animal-bug"):       "昆虫",
    ("Animals & Nature", "plant-flower"):     "花朵",
    ("Animals & Nature", "plant-other"):      "植物",

    # ---------- 食物饮料 ----------
    ("Food & Drink", "food-fruit"):           "水果",
    ("Food & Drink", "food-vegetable"):       "蔬菜",
    ("Food & Drink", "food-prepared"):        "熟食",
    ("Food & Drink", "food-asian"):           "亚洲菜",
    ("Food & Drink", "food-marine"):          "海鲜",
    ("Food & Drink", "food-sweet"):           "甜点",
    ("Food & Drink", "drink"):                "饮料",
    ("Food & Drink", "dishware"):             "餐具",

    # ---------- 地点与交通 ----------
    ("Travel & Places", "place-map"):         "地图地形",
    ("Travel & Places", "place-geographic"):  "地图地形",
    ("Travel & Places", "place-building"):    "建筑",
    ("Travel & Places", "place-religious"):   "建筑",
    ("Travel & Places", "place-other"):       "建筑",
    ("Travel & Places", "transport-ground"):  "陆地交通",
    ("Travel & Places", "transport-water"):   "水空交通",
    ("Travel & Places", "transport-air"):     "水空交通",
    ("Travel & Places", "hotel"):             "建筑",
    ("Travel & Places", "time"):              "时间",
    ("Travel & Places", "sky & weather"):     "天气天体",

    # ---------- 活动 ----------
    ("Activities", "event"):                  "活动庆典",
    ("Activities", "award-medal"):            "奖杯奖章",
    ("Activities", "sport"):                  "运动器械",
    ("Activities", "game"):                   "游戏娱乐",
    ("Activities", "arts & crafts"):          "艺术创作",

    # ---------- 物品（大类，细分多）----------
    ("Objects", "clothing"):                  "服饰",
    ("Objects", "sound"):                     "音乐声音",
    ("Objects", "music"):                     "音乐声音",
    ("Objects", "musical-instrument"):        "音乐声音",
    ("Objects", "phone"):                     "电子设备",
    ("Objects", "computer"):                  "电子设备",
    ("Objects", "light & video"):             "电子设备",
    ("Objects", "book-paper"):                "文具书籍",
    ("Objects", "money"):                     "金钱",
    ("Objects", "mail"):                      "邮件",
    ("Objects", "writing"):                   "文具书籍",
    ("Objects", "office"):                    "办公用品",
    ("Objects", "lock"):                      "工具",
    ("Objects", "tool"):                      "工具",
    ("Objects", "science"):                   "科学实验",
    ("Objects", "medical"):                   "医疗",
    ("Objects", "household"):                 "家居",
    ("Objects", "other-object"):              "杂物",

    # ---------- 符号（大部分剔除，保留有用的）----------
    ("Symbols", "transport-sign"):            "标识",
    ("Symbols", "warning"):                   "警示",
    ("Symbols", "arrow"):                     "箭头",
    ("Symbols", "religion"):                  "宗教符号",
    ("Symbols", "zodiac"):                    "星座",
    ("Symbols", "av-symbol"):                 "控制按钮",
    ("Symbols", "gender"):                    "抽象符号",
    ("Symbols", "math"):                      "数学符号",
    ("Symbols", "punctuation"):               "标点",
    ("Symbols", "currency"):                  "金钱",
    ("Symbols", "other-symbol"):              "抽象符号",
    ("Symbols", "geometric"):                 "几何形状",
}

# 完全丢弃的子类（不进任何池）
DROPPED_SUBCATS = {
    ("Flags", "country-flag"),            # 国旗敏感
    ("Flags", "subdivision-flag"),        # 苏格兰/英格兰等
    ("Flags", "flag"),                    # 彩虹旗等
    ("Component", "skin-tone"),           # 肤色调色板
    ("Component", "hair-style"),
    ("Symbols", "alphanum"),              # 0️⃣ - 9️⃣, A-Z 方块
    ("Symbols", "keycap"),                # *️⃣ #️⃣
}


def unified_to_char(unified: str) -> str:
    """emoji-data 的 unified 字段形如 "1F600-FE0F"，转成实际 emoji 字符。"""
    try:
        return "".join(chr(int(cp, 16)) for cp in unified.split("-"))
    except Exception:
        return ""


def main():
    data = json.load(SRC.open(encoding="utf-8"))
    pool = defaultdict(list)
    dropped = 0
    uncategorized = defaultdict(int)

    for e in data:
        cat = e.get("category")
        sub = e.get("subcategory")
        key = (cat, sub)
        if key in DROPPED_SUBCATS:
            dropped += 1
            continue
        bucket = CATEGORY_MAP.get(key)
        if not bucket:
            # 未映射到，记录一下但用 fallback "杂物"
            uncategorized[key] += 1
            bucket = "杂物"

        ch = unified_to_char(e.get("unified", ""))
        if not ch:
            continue
        short_names = e.get("short_names", []) or []
        pool[bucket].append({
            "emoji": ch,
            "name": e.get("name") or e.get("short_name"),
            "short_names": short_names,
        })

    # 按每类元素数排序，便于查看
    out = {
        "_meta": {
            "source": "iamcal/emoji-data",
            "total_categories": len(pool),
            "dropped_count": dropped,
            "category_sizes": {k: len(v) for k, v in sorted(
                pool.items(), key=lambda x: -len(x[1]))},
        },
        "pool": {k: v for k, v in sorted(pool.items(), key=lambda x: -len(x[1]))},
    }
    DST.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ 写入 {DST}")
    print(f"   总类别数: {len(pool)}")
    print(f"   剔除 emoji: {dropped}")
    print(f"   总 emoji: {sum(len(v) for v in pool.values())}")
    print(f"\n类别分布:")
    for cat, items in sorted(pool.items(), key=lambda x: -len(x[1])):
        print(f"   {cat:12s}  {len(items)}")
    if uncategorized:
        print(f"\n⚠️  未映射的子类（已回落到'杂物'）:")
        for key, n in uncategorized.items():
            print(f"   {key}: {n}")


if __name__ == "__main__":
    main()
