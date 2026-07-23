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
export const STAR_STEP = 800;
export const MAX_STARS = 256;
export const SNOW_BASE = 8_000;
export const SNOW_LORD_FLOOR = SNOW_BASE + MAX_STARS * STAR_STEP;
export const VIRTUAL_NEXT_STEP = 100_000;

const BASE_TIERS = [
  [0, "3-", "待改进", "🔴", "班味不够浓，再拖几次。"],
  [500, "3.25", "勉强合格", "🟡", "有班味，但还能更疯。"],
  [1_500, "3.5", "达标", "🟢", "合格打工鹅。"],
  [3_500, "3.75", "优秀", "🔵", "年终奖有了。"],
  [SNOW_BASE, "瑞雪", "瑞雪兆丰年", "❄️", "瑞雪 +1，建议转岗当产品。"],
];

const SNOW_MILESTONES = [
  [SNOW_BASE + 4 * STAR_STEP, "瑞雪🌛", "月华如水", "🌛", "四片瑞雪凝成一轮瑞月。"],
  [SNOW_BASE + 16 * STAR_STEP, "瑞雪🌞", "日耀乾坤", "🌞", "四轮瑞月聚成一颗瑞日。"],
  [SNOW_BASE + 64 * STAR_STEP, "瑞雪👑", "加冕鹅王", "👑", "四颗瑞日铸成一顶瑞冠。"],
  [SNOW_LORD_FLOOR, "暴雪领主", "极地主宰鹅", "🌨️", "四顶瑞冠凝成一场暴雪，极地鹅王即位。"],
];

function tierObject(tier, includeComment = true) {
  const result = {
    floor: tier[0],
    grade: tier[1],
    label: tier[2],
    emoji: tier[3],
  };
  if (includeComment) result.comment = tier[4];
  return result;
}

export const TIERS = [...BASE_TIERS, ...SNOW_MILESTONES].map((tier) =>
  tierObject(tier),
);

export function scoreFor(chain, isFirst) {
  const base = CHAIN_SCORE[chain || ""] ?? 5;
  const bonus = isFirst ? FIRST_DISCOVERY_BONUS : 0;
  const reasons = [`${chain || "default"} +${base}`];
  if (isFirst) reasons.push(`首发 +${bonus}`);
  return { delta: base + bonus, reason: reasons.join(" / ") };
}

function starsToSymbols(value) {
  const weights = [
    ["👑", 64],
    ["🌞", 16],
    ["🌛", 4],
    ["🌟", 1],
  ];
  let remaining = value;
  let output = "";
  for (const [symbol, weight] of weights) {
    const count = Math.floor(remaining / weight);
    remaining %= weight;
    output += symbol.repeat(count);
  }
  return output;
}

function snowTierDisplay(stars) {
  if (stars <= 0) return BASE_TIERS.at(-1).slice(1);
  if (stars >= MAX_STARS) return SNOW_MILESTONES.at(-1).slice(1);
  const suffix = starsToSymbols(stars);
  const emoji = suffix[0] || "❄️";
  const label = suffix.includes("👑")
    ? "加冕鹅王"
    : suffix.includes("🌞")
      ? "日耀乾坤"
      : suffix.includes("🌛")
        ? "月华如水"
        : "星光熠熠";
  return [
    `瑞雪${suffix}`,
    label,
    emoji,
    `已累积 ${stars} 颗瑞雪 🌟（4🌟=🌛，4🌛=🌞，4🌞=👑，4👑=暴雪领主）。`,
  ];
}

function allTierSummary() {
  return TIERS.map(({ floor, grade, label, emoji }) => ({
    floor,
    grade,
    label,
    emoji,
  }));
}

export function rankFor(rawTotal) {
  const total = Math.max(0, Math.trunc(Number(rawTotal) || 0));
  if (total < SNOW_BASE) {
    let current = BASE_TIERS[0];
    let next = BASE_TIERS[1];
    for (let index = 0; index < BASE_TIERS.length; index += 1) {
      if (total < BASE_TIERS[index][0]) break;
      current = BASE_TIERS[index];
      next = BASE_TIERS[index + 1] || BASE_TIERS.at(-1);
    }
    return {
      grade: current[1],
      label: current[2],
      emoji: current[3],
      comment: current[4],
      floor: current[0],
      next_floor: next[0],
      next_grade: next[1],
      next_label: next[2],
      next_emoji: next[3],
      to_next: Math.max(0, next[0] - total),
      topped: false,
      stars: 0,
      max_stars: MAX_STARS,
      star_step: STAR_STEP,
      all_tiers: allTierSummary(),
    };
  }

  const stars = Math.min(
    MAX_STARS,
    Math.floor((total - SNOW_BASE) / STAR_STEP),
  );
  const [grade, label, emoji, comment] = snowTierDisplay(stars);
  const floor = SNOW_BASE + stars * STAR_STEP;
  let nextFloor;
  let nextGrade;
  let nextLabel;
  let nextEmoji;
  let topped = false;

  if (stars >= MAX_STARS) {
    topped = true;
    const cycles =
      Math.floor((total - SNOW_LORD_FLOOR) / VIRTUAL_NEXT_STEP) + 1;
    nextFloor = SNOW_LORD_FLOOR + cycles * VIRTUAL_NEXT_STEP;
    nextGrade = `暴雪领主+${cycles}`;
    nextLabel = "雪上加霜";
    nextEmoji = "🌨️";
  } else {
    [nextGrade, nextLabel, nextEmoji] = snowTierDisplay(stars + 1);
    nextFloor = SNOW_BASE + (stars + 1) * STAR_STEP;
  }

  return {
    grade,
    label,
    emoji,
    comment,
    floor,
    next_floor: nextFloor,
    next_grade: nextGrade,
    next_label: nextLabel,
    next_emoji: nextEmoji,
    to_next: Math.max(0, nextFloor - total),
    topped,
    stars,
    max_stars: MAX_STARS,
    star_step: STAR_STEP,
    all_tiers: allTierSummary(),
  };
}

export function shouldExplode(chain, result) {
  if (chain === "easter_egg") return true;
  return ["故障", "告警", "删库", "跑路", "猝死"].some((keyword) =>
    String(result || "").includes(keyword),
  );
}
