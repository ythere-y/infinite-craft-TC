export const CHAIN_SCORE = {
  tencent: 30,
  meme_2026w16: 25,
  meme_classic: 20,
  worker: 20,
  bizspeak: 15,
  easter_egg: 40,
  classic: 5,
  physical: 5,
  life: 8,
  abstract: 10,
};

export const FIRST_DISCOVERY_BONUS = 50;
export const BASE_STAR_COST = 300;
export const STAR_COST_STEP = 20;
export const MERGE_BASE = 4;
export const LEVEL_ICONS = Object.freeze(["👑", "🌞", "🌙", "🌟"]);
export const MAX_LEVEL_UNITS = 65_535;

export function scoreFor(chain, isFirst) {
  const base = CHAIN_SCORE[chain || ""] ?? 5;
  const bonus = isFirst ? FIRST_DISCOVERY_BONUS : 0;
  const reasons = [`${chain || "default"} +${base}`];
  if (isFirst) reasons.push(`首发 +${bonus}`);
  return { delta: base + bonus, reason: reasons.join(" / ") };
}

function safeInteger(rawValue, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return 0;
  const value = Math.trunc(numeric);
  return Math.min(maximum, Math.max(0, value));
}

export function normalizeScore(rawValue) {
  return safeInteger(rawValue);
}

export function levelThreshold(rawUnits) {
  const units = safeInteger(rawUnits);
  return units * BASE_STAR_COST
    + (STAR_COST_STEP * units * (units - 1)) / 2;
}

export const MAX_LEVEL_SCORE = levelThreshold(MAX_LEVEL_UNITS - 1);

function levelUnits(score) {
  let low = 0;
  let high = 1;
  while (levelThreshold(high) <= score) high *= 2;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (levelThreshold(middle) <= score) low = middle;
    else high = middle;
  }
  return low;
}

export function rankFor(rawTotal) {
  const displayScore = Math.min(normalizeScore(rawTotal), MAX_LEVEL_SCORE);
  const earnedUnits = levelUnits(displayScore);
  const displayUnits = Math.min(MAX_LEVEL_UNITS, earnedUnits + 1);
  let remaining = displayUnits;
  const crowns = Math.floor(remaining / 64);
  remaining %= 64;
  const suns = Math.floor(remaining / 16);
  remaining %= 16;
  const moons = Math.floor(remaining / 4);
  const stars = remaining % 4;
  const icons = "👑".repeat(crowns)
    + "🌞".repeat(suns) + "🌙".repeat(moons) + "🌟".repeat(stars);
  const floor = levelThreshold(earnedUnits);
  const ceiling = levelThreshold(earnedUnits + 1);
  const labels = [
    crowns ? `${crowns}个皇冠` : "",
    suns ? `${suns}个太阳` : "",
    moons ? `${moons}个月亮` : "",
    stars ? `${stars}颗星星` : "",
  ].filter(Boolean);
  return {
    level_units: displayUnits,
    crowns,
    suns,
    moons,
    stars,
    icons,
    aria_label: labels.join("、") || "尚未获得星星",
    progress: displayUnits === MAX_LEVEL_UNITS
      ? 1
      : (displayScore - floor) / Math.max(1, ceiling - floor),
    grade: icons || "尚未获得星星",
    emoji: Array.from(icons)[0] || "🌟",
    topped: false,
  };
}

export function shouldExplode(chain, result) {
  if (chain === "easter_egg") return true;
  return ["故障", "告警", "删库", "跑路", "猝死"].some((keyword) =>
    String(result || "").includes(keyword),
  );
}
