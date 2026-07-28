import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PALETTES = new Set([
  "nature",
  "product",
  "office",
  "studio",
  "people",
  "place",
]);
const SOURCES = new Set(["curated", "entity", "generated", "fallback"]);

const LOCKED_ENTITIES = {
  Riot: {
    icon: {
      base: "👊",
      badge: "🎮",
      palette: "studio",
      source: "curated",
    },
    entity_type: "company",
    canonical_name: "Riot Games",
  },
  Epic: {
    icon: {
      base: "🛡️",
      badge: "🎮",
      palette: "studio",
      source: "curated",
    },
    entity_type: "company",
    canonical_name: "Epic Games",
  },
  COO: {
    icon: {
      base: "🧑‍💼",
      badge: "⚙️",
      palette: "office",
      source: "curated",
    },
    entity_type: "role",
    canonical_name: "Chief Operating Officer",
  },
  任宇昕: {
    icon: {
      base: "👔",
      badge: "🎮",
      palette: "people",
      source: "curated",
    },
    entity_type: "person",
    canonical_name: "任宇昕",
  },
};

const ENTITY_CATEGORIES = new Set(["product", "studio", "level", "boss", "invest"]);
const ENGLISH_TOKEN = /(?:^|[.\s])(?:[A-Za-z][A-Za-z0-9.]*|[A-Z0-9]{2,})(?:$|[.\s])/u;

async function readJson(path, label) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing at ${path}`);
    }
    throw error;
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function iconSignature(icon) {
  return `${icon.base}\u0000${icon.badge ?? ""}\u0000${icon.palette}`;
}

function displaySignature(signature) {
  const [base, badge, palette] = signature.split("\u0000");
  return `${base}${badge ? ` + ${badge}` : ""} · ${palette}`;
}

function collectReuseGroups(iconMap, keyOf) {
  const groups = new Map();
  for (const [name, entry] of Object.entries(iconMap)) {
    if (!entry?.icon) continue;
    const key = keyOf(entry.icon);
    const names = groups.get(key) ?? [];
    names.push(name);
    groups.set(key, names);
  }
  return [...groups.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([signature, names]) => ({
      signature,
      display: displaySignature(signature),
      count: names.length,
      names,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.display.localeCompare(right.display, "zh-CN"),
    );
}

function isDeepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function lockedEntityResults(iconMap) {
  return Object.entries(LOCKED_ENTITIES).map(([name, expected]) => {
    const actual = iconMap[name];
    const issues = [];
    if (!actual) {
      issues.push("missing");
    } else {
      for (const [field, value] of Object.entries(expected)) {
        if (!isDeepEqual(actual[field], value)) {
          issues.push(`${field} differs`);
        }
      }
      if (name === "Riot" && /闪电|暴乱/u.test(actual.rationale ?? "")) {
        issues.push("rationale contains a forbidden literal sense");
      }
    }
    return { name, passed: issues.length === 0, issues, expected };
  });
}

function findEntityCandidates(seedElements, knowledge) {
  return Object.entries(seedElements.elements)
    .filter(
      ([name, seed]) =>
        ENTITY_CATEGORIES.has(seed.category) || ENGLISH_TOKEN.test(name),
    )
    .map(([name, seed]) => ({
      name,
      category: seed.category,
      status: knowledge[name] ? "mapped" : "review",
      reason: ENTITY_CATEGORIES.has(seed.category)
        ? `${seed.category} category`
        : "English name or abbreviation",
    }));
}

export function auditIconMap({
  seedElements,
  iconMap,
  emojiManifest,
  knowledge,
}) {
  const seedNames = Object.keys(seedElements.elements);
  const mapNames = Object.keys(iconMap);
  const seedNameSet = new Set(seedNames);
  const invalidAssets = [];

  for (const name of seedNames) {
    const entry = iconMap[name];
    if (!entry) {
      invalidAssets.push(`${name}: missing recipe`);
      continue;
    }
    if (!entry.icon?.base || !emojiManifest[entry.icon.base]) {
      invalidAssets.push(`${name}: base does not resolve through the Emoji manifest`);
    }
    if (entry.icon?.badge && !emojiManifest[entry.icon.badge]) {
      invalidAssets.push(`${name}: badge does not resolve through the Emoji manifest`);
    }
    if (!PALETTES.has(entry.icon?.palette)) {
      invalidAssets.push(`${name}: invalid palette`);
    }
    if (!SOURCES.has(entry.icon?.source)) {
      invalidAssets.push(`${name}: invalid source`);
    }
    if (typeof entry.rationale !== "string" || !entry.rationale.trim()) {
      invalidAssets.push(`${name}: missing rationale`);
    }
  }
  for (const name of mapNames) {
    if (!seedNameSet.has(name)) {
      invalidAssets.push(`${name}: recipe does not belong to a seed element`);
    }
  }

  const entityIssues = [];
  for (const [name, row] of Object.entries(knowledge)) {
    if (!Array.isArray(row.aliases) || !row.aliases.length) {
      entityIssues.push(`${name}: entity row is missing aliases`);
    }
    if (typeof row.rationale !== "string" || !row.rationale.trim()) {
      entityIssues.push(`${name}: entity row is missing rationale`);
    }
  }

  const baseReuseGroups = collectReuseGroups(
    iconMap,
    (icon) => `${icon.base}\u0000\u0000`,
  );
  const fullSignatureReuseGroups = collectReuseGroups(iconMap, iconSignature);
  const duplicateEntries = fullSignatureReuseGroups.reduce(
    (total, group) => total + group.count - 1,
    0,
  );
  const duplicateRate = mapNames.length
    ? duplicateEntries / mapNames.length
    : 0;
  const signaturesOverTwice = fullSignatureReuseGroups.filter(
    (group) => group.count > 2,
  );
  const acceptedExceptions = [];
  const unexceptedOveruse = [];
  for (const group of signaturesOverTwice) {
    const rows = group.names.map((name) => iconMap[name]);
    if (
      rows.every(
        (entry) =>
          typeof entry.duplicate_exception === "string" &&
          entry.duplicate_exception.trim(),
      )
    ) {
      acceptedExceptions.push({
        ...group,
        rationales: group.names.map(
          (name) => iconMap[name].duplicate_exception,
        ),
      });
    } else {
      unexceptedOveruse.push(group);
    }
  }

  const lockedResults = lockedEntityResults(iconMap);
  const violations = [];
  if (mapNames.length !== seedNames.length) {
    violations.push(
      `Mapped total ${mapNames.length} differs from seed total ${seedNames.length}`,
    );
  }
  if (invalidAssets.length) {
    violations.push(`${invalidAssets.length} missing or invalid assets/recipes`);
  }
  if (entityIssues.length) {
    violations.push(`${entityIssues.length} entity rows lack rationale or aliases`);
  }
  for (const result of lockedResults.filter((item) => !item.passed)) {
    violations.push(
      `Locked semantic regression for ${result.name}: ${result.issues.join(", ")}`,
    );
  }
  if (duplicateRate >= 0.1) {
    violations.push(
      `Full-signature duplicate rate ${(duplicateRate * 100).toFixed(2)}% is at least 10%`,
    );
  }
  for (const group of unexceptedOveruse) {
    violations.push(
      `Signature ${group.display} is used more than twice without an explicit duplicate_exception on every row`,
    );
  }

  return {
    acceptedExceptions,
    baseReuseGroups,
    entityCandidates: findEntityCandidates(seedElements, knowledge),
    entityIssues,
    fullSignatureReuseGroups,
    invalidAssets,
    lockedResults,
    metrics: {
      baseReuseGroups: baseReuseGroups.length,
      duplicateEntries,
      duplicateRate,
      fullSignatureReuseGroups: fullSignatureReuseGroups.length,
      mappedElements: mapNames.length,
      seedElements: seedNames.length,
    },
    signaturesOverTwice,
    violations,
  };
}

function formatTopGroups(groups, limit = 20) {
  if (!groups.length) return "- None";
  return groups
    .slice(0, limit)
    .map(
      (group) =>
        `- ${group.display}: ${group.count} — ${group.names.join("、")}`,
    )
    .join("\n");
}

export function formatAuditReport(audit) {
  const percentage = (audit.metrics.duplicateRate * 100).toFixed(2);
  const exceptionText = audit.acceptedExceptions.length
    ? audit.acceptedExceptions
        .map(
          (group) =>
            `- ${group.display}: ${group.names.join("、")} — ${[
              ...new Set(group.rationales),
            ].join("；")}`,
        )
        .join("\n")
    : "- None";
  const lockedText = audit.lockedResults
    .map(
      (result) =>
        `### ${result.name}\n\nStatus: ${result.passed ? "PASS" : "FAIL"}\n\n` +
        "```json\n" +
        `${JSON.stringify(result.expected, null, 2)}\n` +
        "```",
    )
    .join("\n\n");

  return `# Icon System Audit

Generated by \`scripts/audit-icon-map.mjs\` from the committed seed, icon map,
knowledge layer, rules, and Emoji manifest.

## Metric definitions

- **Mapped elements**: explicit icon-map rows compared with the preset seed total.
- **Base reuse group**: two or more rows sharing the same base Emoji, regardless
  of badge or palette.
- **Full signature**: \`base + badge + palette\`.
- **Duplicate entries**: for every reused full signature, all uses after its
  first use. The duplicate rate is duplicate entries divided by mapped elements.
- **Signature overuse**: a full signature used by more than two rows. It is
  accepted only when every affected row provides a non-empty
  \`duplicate_exception\` explaining why the shared visual meaning is correct.

## Current metrics

- Mapped elements: ${audit.metrics.mappedElements} / ${audit.metrics.seedElements}
- Missing or invalid assets/recipes: ${audit.invalidAssets.length}
- Base reuse groups: ${audit.metrics.baseReuseGroups}
- Full-signature reuse groups: ${audit.metrics.fullSignatureReuseGroups}
- Duplicate entries: ${audit.metrics.duplicateEntries}
- Full-signature duplicate rate: ${percentage}%
- Signatures used more than twice: ${audit.signaturesOverTwice.length}
- Gate violations: ${audit.violations.length}

## Top 20 base reuse groups

${formatTopGroups(audit.baseReuseGroups)}

## Top 20 full-signature reuse groups

${formatTopGroups(audit.fullSignatureReuseGroups)}

## Accepted exceptions

${exceptionText}

## Locked entity examples

${lockedText}
`;
}

function printAudit(audit) {
  console.log(`Mapped elements: ${audit.metrics.mappedElements}/${audit.metrics.seedElements}`);
  console.log(`Missing/invalid assets: ${audit.invalidAssets.length}`);
  console.log(`Base reuse groups: ${audit.metrics.baseReuseGroups}`);
  console.log(
    `Full-signature reuse groups: ${audit.metrics.fullSignatureReuseGroups}`,
  );
  console.log(
    `Full-signature duplicate rate: ${(audit.metrics.duplicateRate * 100).toFixed(2)}% (${audit.metrics.duplicateEntries}/${audit.metrics.mappedElements})`,
  );
  console.log(`Signatures used more than twice: ${audit.signaturesOverTwice.length}`);
  console.log("\nTop 20 base reuse groups:");
  console.log(formatTopGroups(audit.baseReuseGroups));
  console.log("\nTop 20 full-signature reuse groups:");
  console.log(formatTopGroups(audit.fullSignatureReuseGroups));
  console.log("\nLocked semantic regressions:");
  for (const result of audit.lockedResults) {
    console.log(
      `- ${result.name}: ${result.passed ? "PASS" : `FAIL (${result.issues.join(", ")})`}`,
    );
  }
  if (audit.violations.length) {
    console.error("\nAudit violations:");
    for (const violation of audit.violations) console.error(`- ${violation}`);
  }
}

function printEntityCandidates(candidates) {
  console.log("\nEntity review candidates:");
  for (const item of candidates) {
    console.log(
      `- [${item.status}] ${item.name} (${item.category}; ${item.reason})`,
    );
  }
}

export async function runIconAudit({
  root = ROOT,
  listEntities = false,
  writeReport,
} = {}) {
  const projectRoot = resolve(root);
  const [seedElements, iconMap, emojiManifest, knowledge] = await Promise.all([
    readJson(resolve(projectRoot, "backend/seed_elements.json"), "Seed elements"),
    readJson(
      resolve(
        projectRoot,
        "frontend/assets/icons/generated/element-icon-map.json",
      ),
      "Element icon map",
    ),
    readJson(
      resolve(
        projectRoot,
        "frontend/assets/icons/generated/emoji-icon-manifest.json",
      ),
      "Emoji manifest",
    ),
    readJson(resolve(projectRoot, "backend/icon_knowledge.json"), "Icon knowledge"),
  ]);
  const audit = auditIconMap({
    seedElements,
    iconMap,
    emojiManifest,
    knowledge,
  });
  printAudit(audit);
  if (listEntities) printEntityCandidates(audit.entityCandidates);
  if (writeReport) {
    const reportPath = resolve(projectRoot, writeReport);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, formatAuditReport(audit));
    console.log(`\nWrote audit report to ${writeReport}`);
  }
  return audit;
}

function parseArguments(arguments_) {
  let listEntities = false;
  let writeReport;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--list-entities") {
      listEntities = true;
    } else if (argument === "--write-report") {
      writeReport = arguments_[index + 1];
      if (!writeReport) {
        throw new Error("--write-report requires a path");
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { listEntities, writeReport };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const audit = await runIconAudit(options);
    if (audit.violations.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Icon audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
