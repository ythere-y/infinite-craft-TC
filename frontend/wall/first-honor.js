const MAX_DIRECT_ICONS = 20;
const TIERS = Object.freeze([
  { tier: "crowns", icon: "👑", label: "皇冠" },
  { tier: "suns", icon: "🌞", label: "太阳" },
  { tier: "moons", icon: "🌙", label: "月亮" },
  { tier: "stars", icon: "🌟", label: "首发星星" },
]);

function normalizeFirsts(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(numeric)));
}

export function firstHonorFor(rawFirsts) {
  const firsts = normalizeFirsts(rawFirsts);
  let remainder = firsts;
  const crowns = Math.floor(remainder / 64);
  remainder %= 64;
  const suns = Math.floor(remainder / 16);
  remainder %= 16;
  const moons = Math.floor(remainder / 4);
  const stars = remainder % 4;
  const counts = { crowns, suns, moons, stars };
  const iconCount = crowns + suns + moons + stars;
  const aggregated = iconCount > MAX_DIRECT_ICONS;
  const displayItems = [];

  for (const { tier, icon } of TIERS) {
    const count = counts[tier];
    if (!count) continue;
    if (aggregated) {
      displayItems.push({ tier, icon, count, text: `${icon} × ${count}` });
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      displayItems.push({ tier, icon, count: 1, text: icon });
    }
  }

  const labels = TIERS
    .filter(({ tier }) => counts[tier] > 0)
    .map(({ tier, label }) => `${counts[tier]}个${label}`);

  return {
    firsts,
    crowns,
    suns,
    moons,
    stars,
    iconCount,
    aggregated,
    displayItems,
    ariaLabel: labels.length
      ? `首发荣誉等级：${labels.join("、")}`
      : "尚未获得首发星星",
  };
}
