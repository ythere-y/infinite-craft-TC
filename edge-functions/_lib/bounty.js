import {
  BOUNTY_ALIASES,
  BOUNTY_GROUPS,
  BOUNTY_TABS,
} from "../_generated/bounty-content.js";
import { PROMPT_SPEC } from "../_generated/prompt-data.js";

export function normalizeBountyAlias(value) {
  const clean = String(value ?? "").trim();
  return BOUNTY_ALIASES[clean] || clean;
}

function addFirstMetadata(item, first) {
  if (!first) return item;
  return {
    ...item,
    discoverer: first.discoverer,
    ts: Number(first.ts) || null,
    ...(first.seq == null ? {} : { seq: first.seq }),
  };
}

function buildGroup(definition, elements, firstByName) {
  const items = definition.targets.map((name) => {
    const first = firstByName.get(name);
    const item = {
      name,
      emoji: elements[name]?.emoji || "❓",
      ...(elements[name]?.icon ? { icon: elements[name].icon } : {}),
      category: definition.category,
      is_starter: false,
      discovered: Boolean(first),
    };
    return addFirstMetadata(item, first);
  });
  return {
    category: definition.category,
    label: definition.label,
    emoji: definition.emoji,
    tab: definition.tab,
    total: items.length,
    found: items.filter((item) => item.discovered).length,
    items,
  };
}

export function buildBounty({ elements, firsts }) {
  const firstByName = new Map(
    (firsts || []).map((item) => [item.result, item]),
  );
  const groups = BOUNTY_GROUPS.map((definition) =>
    buildGroup(definition, elements, firstByName),
  );
  const tabs = BOUNTY_TABS.map((tab) => {
    const owned = groups.filter((group) => group.tab === tab.key);
    return {
      ...tab,
      total: owned.reduce((sum, group) => sum + group.total, 0),
      found: owned.reduce((sum, group) => sum + group.found, 0),
    };
  });
  return {
    tabs,
    groups,
    total: groups.reduce((sum, group) => sum + group.total, 0),
    found: groups.reduce((sum, group) => sum + group.found, 0),
  };
}

export function buildCategory({ category, elements, starters, firsts }) {
  const starterNames = new Set(
    starters
      .filter((item) => item.category === category)
      .map((item) => item.name),
  );
  const firstByName = new Map(
    (firsts || []).map((item) => [item.result, item]),
  );
  const items = Object.entries(elements)
    .filter(([, info]) => info?.category === category)
    .map(([name, info]) =>
      addFirstMetadata(
        {
          name,
          emoji: info?.emoji || "❓",
          ...(info?.icon ? { icon: info.icon } : {}),
          category,
          is_starter: starterNames.has(name),
          discovered: starterNames.has(name) || firstByName.has(name),
        },
        firstByName.get(name),
      ),
    )
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return {
    category,
    total: items.length,
    found: items.filter((item) => item.discovered).length,
    items,
  };
}

export function selectBountyCandidates({
  a,
  b,
  elements,
  starters,
  firsts,
  limit = PROMPT_SPEC.limits.bounty_candidates,
}) {
  const firstByName = new Map(
    (firsts || []).map((item) => [item.result, item]),
  );
  const groups = BOUNTY_GROUPS.map((definition) =>
    buildGroup(definition, elements, firstByName),
  );
  const inputCategories = new Set(
    [elements[a]?.category, elements[b]?.category].filter(Boolean),
  );
  const bgHints = {
    "游戏": "IEG",
    "微信": "WXG",
    "云": "CSIG",
    "视频号": "PCG",
    "代码": "TEG",
    "广告": "CDG",
    "腾讯云": "CSIG",
  };
  const geoHints = {
    "深圳": ["腾讯大厦", "滨海大厦", "T1塔楼", "金地威新"],
    "南山": ["滨海大厦", "T1塔楼"],
    "滨海": ["滨海大厦"],
    "前海": ["T1塔楼"],
    "科兴": ["科兴科学园"],
    "琶洲": ["琶洲新总部"],
    "广州": ["TIT创意园", "微信总部"],
    "北京": ["北京总部"],
    "上海": ["上海总部"],
    "成都": ["成都办公楼"],
  };
  const inputs = new Set([a, b]);
  const scored = [];

  for (const group of groups) {
    for (const item of group.items) {
      if (item.discovered || !item.name) continue;
      let score = 0;
      if (inputCategories.has(group.category)) score += 4;
      if (a && item.name.includes(a)) score += 3;
      if (b && item.name.includes(b)) score += 3;
      if ((a && a.includes(item.name)) || (b && b.includes(item.name))) {
        score += 2;
      }
      for (const [trigger, target] of Object.entries(bgHints)) {
        if (inputs.has(trigger) && item.name === target) score += 6;
      }
      if (group.category === "building") {
        for (const [trigger, targets] of Object.entries(geoHints)) {
          if (inputs.has(trigger) && targets.includes(item.name)) score += 6;
        }
      }
      if (score > 0) {
        scored.push({
          score,
          value: {
            name: item.name,
            emoji: item.emoji,
            category: group.category,
          },
        });
      }
    }
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.trunc(Number(limit))))
    .map((item) => item.value);
}
