import {
  ELEMENT_ICONS,
  ICON_RULES,
} from "../_generated/icon-data.js";

const PALETTES = new Set(ICON_RULES.palettes || []);
const SOURCES = new Set(ICON_RULES.allowed_sources || []);
const STABLE_HASH_MODULUS = 2_147_483_647;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeIcon(value) {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return null;
    }
  }
  if (!isObject(decoded)) return null;

  const { base, palette, source } = decoded;
  if (typeof base !== "string" || !base.trim()) return null;
  if (!PALETTES.has(palette) || !SOURCES.has(source)) return null;

  const recipe = { base, palette, source };
  if (decoded.badge != null) {
    if (
      typeof decoded.badge !== "string" ||
      !decoded.badge.trim() ||
      decoded.badge === base
    ) {
      return null;
    }
    recipe.badge = decoded.badge;
  }
  return recipe;
}

export function presetIcon(name) {
  const row = ELEMENT_ICONS[name];
  if (!isObject(row)) return null;
  return normalizeIcon(row.icon ?? row);
}

function contextText({ name, category, parents, chain, comment }) {
  return [
    name,
    ...(Array.isArray(parents) ? parents : []),
    category || "",
    chain || "",
    comment,
  ]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .toLowerCase();
}

function dynamicBadge({ text, category, chain, base }) {
  for (const rule of ICON_RULES.keyword_badges || []) {
    if (!isObject(rule)) continue;
    if (
      Array.isArray(rule.categories) &&
      rule.categories.length &&
      !rule.categories.includes(category) &&
      !rule.categories.includes(chain)
    ) {
      continue;
    }
    if (!Array.isArray(rule.keywords)) continue;
    if (
      !rule.keywords.some(
        (keyword) =>
          typeof keyword === "string" &&
          keyword &&
          text.includes(keyword.toLowerCase()),
      )
    ) {
      continue;
    }
    if (
      typeof rule.badge === "string" &&
      rule.badge &&
      rule.badge !== base
    ) {
      return rule.badge;
    }
  }
  return null;
}

function stablePoolBadge({ name, pool, base }) {
  if (!Array.isArray(pool)) return null;
  const candidates = pool.filter(
    (badge) =>
      typeof badge === "string" &&
      badge &&
      badge !== base,
  );
  if (!candidates.length) return null;

  let value = 0;
  for (const character of String(name || "").normalize("NFC")) {
    value =
      (value * 31 + character.codePointAt(0)) % STABLE_HASH_MODULUS;
  }
  return candidates[value % candidates.length];
}

export function resolveIconRecipe({
  name,
  emoji,
  category,
  parents = [],
  chain = null,
  comment = "",
  persisted = null,
}) {
  const saved = normalizeIcon(persisted);
  if (saved) return saved;

  const preset = presetIcon(name);
  if (preset) return preset;

  const categoryPalettes = ICON_RULES.category_palettes || {};
  let palette =
    categoryPalettes[category] ||
    categoryPalettes[chain] ||
    "place";
  if (!PALETTES.has(palette)) palette = "place";

  const base = typeof emoji === "string" && emoji ? emoji : "❓";
  let badge = dynamicBadge({
    text: contextText({ name, category, parents, chain, comment }),
    category,
    chain,
    base,
  });
  if (!badge) {
    const badgePools = ICON_RULES.category_badge_pools || {};
    badge = stablePoolBadge({
      name,
      pool: badgePools[category] ?? badgePools[chain],
      base,
    });
  }
  const recipe = {
    base,
    palette,
    source: badge ? "generated" : "fallback",
  };
  if (badge) recipe.badge = badge;
  return recipe;
}

export function attachIcon(name, info) {
  const source = isObject(info) ? info : {};
  return {
    ...source,
    icon: resolveIconRecipe({
      name,
      emoji: source.emoji ?? "❓",
      category: source.category,
      parents: Array.isArray(source.parents)
        ? source.parents.filter((parent) => typeof parent === "string")
        : [],
      chain: source.chain,
      comment: source.comment ?? "",
      persisted: source.icon,
    }),
  };
}
