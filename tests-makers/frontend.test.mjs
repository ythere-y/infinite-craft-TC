import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectUnseenPrefix,
  mergeFirstItems,
} from "../frontend/wall/polling.js";
import { recipeCommentFor } from "../frontend/wall/recipe-comments.js";

test("score and audio helpers load before consumers", async () => {
  const [html, build] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("scripts/build-makers.mjs", "utf8"),
  ]);

  assert.ok(html.indexOf("icon-system.js") < html.indexOf("score-level.js"));
  assert.ok(html.indexOf("score-level.js") < html.indexOf("effects.js"));
  assert.ok(html.indexOf("score-level.js") < html.indexOf("app.js"));
  assert.ok(html.indexOf("audio-feedback.js") < html.indexOf("app.js"));
  assert.match(html, /audio-feedback\.js\?v=20260804b/);
  assert.ok(html.indexOf("anime.iife.min.js") < html.indexOf("casino-mode.js"));
  assert.ok(html.indexOf("casino-round.js") < html.indexOf("casino-mode.js"));
  assert.ok(html.indexOf("effects.js") < html.indexOf("casino-mode.js"));
  assert.ok(html.indexOf("casino-mode.js") < html.indexOf("app.js"));
  assert.match(build, /"audio-feedback\.js"/);
});

test("homepage keeps basic guidance visible and advanced guidance collapsed", async () => {
  const html = await readFile("frontend/index.html", "utf8");
  const hint = html.match(/<div id="hint" class="hint">([\s\S]*?)<\/div>\s*<section id="casino-hud"/);
  const basic = html.match(/<div class="basic-guidance">([\s\S]*?)<\/div>\s*<div id="advanced-guidance"/);

  assert.ok(hint, "homepage hint should remain present before the casino table");
  assert.ok(basic, "homepage should separate basic and advanced guidance");
  assert.match(html, /id="btn-help"[^>]*aria-expanded="false"[^>]*aria-controls="advanced-guidance"/);
  assert.match(hint[1], /id="advanced-guidance"[^>]*hidden/);
  assert.match(
    hint[1],
    /id="advanced-guidance"[\s\S]*单击[\s\S]*右侧元素[\s\S]*随机[\s\S]*双击[\s\S]*画布[\s\S]*右下[\s\S]*配方库[\s\S]*仅支持拖拽[\s\S]*案例展示[\s\S]*滨海大厦/,
  );
  assert.match(
    basic[1],
    /class="guidance-formula"[^>]*aria-label="拖拽元素，加以合成，创造新元素。"/,
  );
  assert.match(
    basic[1],
    /class="guidance-board guidance-drag"[\s\S]*data-icon-action="next"[\s\S]*拖拽！/,
  );
  assert.match(
    basic[1],
    /class="guidance-operator"[^>]*>\+<\/span>[\s\S]*class="guidance-board guidance-combine"[\s\S]*data-icon-action="sparkle"[\s\S]*合成！/,
  );
  assert.match(
    basic[1],
    /class="guidance-operator"[^>]*>=<\/span>[\s\S]*class="guidance-board guidance-innovation"[\s\S]*class="guidance-infinity"[\s\S]*创新！/,
  );
  assert.doesNotMatch(basic[1], /data-icon-action="combine"/);
  assert.doesNotMatch(basic[1], /把右边的元素|把下方的元素/);
  assert.doesNotMatch(basic[1], /双击|案例展示|↑↑↓↓←→←→BA/);
});

test("vendored casino animation runtime keeps its license and adds no npm dependency", async () => {
  const [vendor, notices, packageJson] = await Promise.all([
    readFile("frontend/vendor/anime.iife.min.js", "utf8"),
    readFile("THIRD_PARTY_NOTICES.md", "utf8"),
    readFile("package.json", "utf8").then(JSON.parse),
  ]);

  assert.match(vendor.slice(0, 220), /Anime\.js - UMD minified bundle/);
  assert.match(vendor.slice(0, 220), /@version v4\.5\.0/);
  assert.match(vendor.slice(0, 220), /@license MIT/);
  assert.match(notices, /## Anime\.js/);
  assert.match(notices, /Copyright \(c\) 2026 Julian Garnier/);
  assert.equal(packageJson.dependencies?.animejs, undefined);
  assert.equal(packageJson.devDependencies?.animejs, undefined);
});

test("main game ships the opening stage in dependency order", async () => {
  const [html, build] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("scripts/build-makers.mjs", "utf8"),
  ]);

  assert.match(html, /<body class="opening-active">/);
  assert.match(html, /id="opening-stage"/);
  assert.match(html, /id="opening-identity-card"/);
  assert.ok(
    html.indexOf("icon-system.css") <
      html.indexOf("opening-animation.css"),
  );
  assert.ok(
    html.indexOf("anime.iife.min.js") <
      html.indexOf("opening-animation.js"),
  );
  assert.ok(
    html.indexOf("opening-animation.js") <
      html.indexOf("app.js"),
  );
  assert.match(
    html,
    /<script src="\/app\.js\?v=20260807a"><\/script>/,
  );
  assert.match(
    html,
    /<link rel="stylesheet" href="\/opening-animation\.css\?v=20260804b" \/>/,
  );
  assert.match(
    html,
    /<link rel="stylesheet" href="\/style\.css\?v=20260804d" \/>/,
  );
  assert.match(
    html,
    /<script src="\/opening-animation\.js\?v=20260804b"><\/script>/,
  );
  assert.match(build, /"opening-animation\.css"/);
  assert.match(build, /"opening-animation\.js"/);
});

test("app delegates startup identity to the opening controller", async () => {
  const app = await readFile("frontend/app.js", "utf8");
  const init = app.match(
    /async function init\(\)\s*\{([\s\S]*?)\n\}\n\nasync function /,
  );

  assert.ok(init, "init should remain a standalone async startup function");
  assert.match(app, /function createOpeningIdentityAdapter\(\)/);
  assert.match(
    app,
    /await window\.OPENING_ANIMATION\.start\(\{[\s\S]*identity:/,
  );
  assert.doesNotMatch(init[1], /await ensureNickname\(\)/);
  assert.match(init[1], /await runOpeningIdentity\(\)/);
  assert.match(app, /async function rerollNickname\(\)/);
  assert.match(app, /openNickModal\(false\)/);
});

test("main game loads the startup API before app and warms migrating content", async () => {
  const [html, app, build] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
    readFile("scripts/build-makers.mjs", "utf8"),
  ]);

  assert.ok(html.indexOf("startup-api.js") < html.indexOf("app.js"));
  assert.match(app, /window\.STARTUP_API\.loadInitialCatalog\(/);
  assert.match(app, /window\.STARTUP_API\.warmContentUntilReady\(/);
  assert.match(app, /window\.STARTUP_API\.startupErrorMessage\(/);
  assert.match(build, /"startup-api\.js"/);
});

test("THUOCL notice names the canonical and generated nickname artifacts", async () => {
  const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");

  assert.match(notices, /shared\/nickname-data\.json/);
  assert.match(
    notices,
    /edge-functions\/_generated\/nickname-data\.js/,
  );
});

test("recipe comments prefer API rows and safely fall back to an open formula", () => {
  const formula = {
    id: "formula-1",
    a: "秃头循环",
    b: "张志东",
    comment: "社区公式里的旧点评。",
  };

  assert.equal(
    recipeCommentFor(
      {
        a: "张志东",
        b: "秃头循环",
        comment: "  大佬面前，秃头循环只能绕道走。  ",
      },
      formula,
    ),
    "大佬面前，秃头循环只能绕道走。",
  );
  assert.equal(
    recipeCommentFor(
      { a: "张志东", b: "秃头循环" },
      formula,
    ),
    "社区公式里的旧点评。",
  );
  assert.equal(
    recipeCommentFor(
      { a: "代码", b: "创始人", comment: "" },
      formula,
    ),
    null,
  );
});

test("wall uses visibility-aware incremental polling instead of SSE", async () => {
  const [source, html] = await Promise.all([
    readFile("frontend/wall/wall.js", "utf8"),
    readFile("frontend/wall/index.html", "utf8"),
  ]);

  assert.doesNotMatch(source, /new EventSource\s*\(/);
  assert.match(source, /offset=\$\{offset\}&limit=\$\{POLL_PAGE_SIZE\}/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pollNewFirsts/);
  assert.match(source, /buildReaction/);
  assert.match(source, /voteElement/);
  assert.match(source, /updateReactionDom/);
  assert.doesNotMatch(
    source,
    /async function voteElement[\s\S]*?renderFeed\(\);[\s\S]*?function renderFeed/,
  );
  assert.match(source, /recipeCommentFor/);
  assert.match(source, /recipe-comment/);
  assert.doesNotMatch(source, /recipe-public-formula/);
  assert.doesNotMatch(source, /公开公式/);
  assert.match(source, /renderWallAction\(button,\s*action/);
  assert.doesNotMatch(source, /data-vote="1">👍</);
  assert.doesNotMatch(source, /data-vote="-1">👎</);
  assert.doesNotMatch(source, /formula-vote cancel/);
  assert.doesNotMatch(source, /👍 点赞/);
  assert.doesNotMatch(source, /👎 点菜/);
  assert.match(html, /\/wall\/wall\.css\?v=/);
  assert.match(html, /\/wall\/wall\.js\?v=/);
});

test("secondary pages load the shared icon system before page scripts", async () => {
  const entries = [
    ["frontend/wall/index.html", "wall/wall.js"],
    ["frontend/community.html", "community.js"],
    ["frontend/community-admin.html", "community-admin.js"],
    ["frontend/admin/index.html", "<script>"],
  ];

  for (const [file, pageScript] of entries) {
    const html = await readFile(file, "utf8");
    assert.match(html, /\/icon-system\.css/, `${file} should load shared icon CSS`);
    assert.match(html, /\/icon-system\.js/, `${file} should load shared icon JS`);
    assert.ok(
      html.indexOf("icon-system.js") < html.indexOf(pageScript),
      `${file} should load shared icon JS before ${pageScript}`,
    );
  }
});

test("secondary element views use safe sticker and action renderers", async () => {
  const [wall, community, communityAdmin, admin] = await Promise.all([
    readFile("frontend/wall/wall.js", "utf8"),
    readFile("frontend/community.js", "utf8"),
    readFile("frontend/community-admin.js", "utf8"),
    readFile("frontend/admin/index.html", "utf8"),
  ]);

  assert.match(wall, /function renderWallElement\(/);
  assert.match(wall, /ICON_SYSTEM\.renderElement\(document,\s*target,/);
  assert.match(wall, /function buildCatChip\([^]*?renderWallElement\(/);
  assert.match(wall, /function buildRecipePill\([^]*?renderWallElement\(/);
  assert.match(wall, /ICON_SYSTEM\.renderAction\(document,/);
  assert.doesNotMatch(wall, /innerHTML\s*=\s*`[^`]*\$\{[^}]*(?:icon|emoji|result|name)/i);

  for (const [file, source] of [
    ["frontend/community.js", community],
    ["frontend/community-admin.js", communityAdmin],
  ]) {
    assert.match(source, /fetch\(["']\/api\/elements["']\)/, `${file} should load elements`);
    assert.match(source, /ICON_SYSTEM\.renderElement\(document,/, `${file} should render stickers`);
    assert.match(source, /ICON_SYSTEM\.renderAction\(document,/, `${file} should render actions`);
    assert.doesNotMatch(
      source,
      /innerHTML\s*=\s*`[^`]*\$\{[^}]*(?:icon|emoji|result|name|comment)/i,
      `${file} should not interpolate API display fields into HTML`,
    );
  }

  assert.match(admin, /function renderRecentFirsts\(/);
  assert.match(admin, /ICON_SYSTEM\.renderElement\(document,\s*elementCell,/);
  assert.doesNotMatch(admin, /recent_firsts\.map\([^]*?innerHTML/);
});

test("wall polling stops at the first known row instead of replaying history", () => {
  const known = new Set(["已见最新", "旧记录"]);
  const result = collectUnseenPrefix(
    [
      { result: "新记录2", seq: 102 },
      { result: "新记录1", seq: 101 },
      { result: "已见最新", seq: 100 },
      { result: "旧记录", seq: 99 },
    ],
    known,
  );

  assert.equal(result.boundaryFound, true);
  assert.deepEqual(
    result.items.map((item) => item.result),
    ["新记录2", "新记录1"],
  );
  assert.deepEqual(
    mergeFirstItems(
      [{ result: "已见最新", seq: 100 }],
      result.items,
    ).map((item) => item.result),
    ["新记录2", "新记录1", "已见最新"],
  );
});

test("an established 40-row wall does not treat rows 41-500 as fresh", () => {
  const incoming = Array.from({ length: 500 }, (_, index) => ({
    result: `历史${500 - index}`,
    seq: 500 - index,
  }));
  const known = new Set(incoming.slice(0, 40).map((item) => item.result));

  const result = collectUnseenPrefix(incoming, known);
  assert.equal(result.boundaryFound, true);
  assert.deepEqual(result.items, []);
});

test("frontend supports protected admin stats and batched recipe verification", async () => {
  const [admin, app, html] = await Promise.all([
    readFile("frontend/admin/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/index.html", "utf8"),
  ]);

  assert.match(admin, /sessionStorage\.getItem\("infinity_admin_token"\)/);
  assert.match(admin, /authorization:\s*`Bearer \$\{token\}`/);
  assert.match(app, /const VERIFY_BATCH_SIZE = 500/);
  assert.match(app, /formatValid\.slice\(index, index \+ VERIFY_BATCH_SIZE\)/);
  assert.match(html, /combine-feedback\.js/);
  assert.match(html, /icon-system\.css/);
  assert.match(html, /icon-system\.js/);
  assert.ok(html.indexOf("icon-system.css") < html.indexOf("style.css"));
  assert.ok(html.indexOf("icon-system.js") < html.indexOf("combine-feedback.js"));
  assert.match(app, /comment:\s*resp\.comment/);
});

test("main game feeds plain snapshots to the replaceable recipe-link module", async () => {
  const [html, app, links, build] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/recipe-links.js", "utf8"),
    readFile("scripts/build-makers.mjs", "utf8"),
  ]);

  assert.match(html, /recipe-links\.css\?v=([^"]+)/);
  assert.match(html, /recipe-links\.css\?v=20260803d/);
  assert.match(html, /recipe-links\.js\?v=20260803d/);
  assert.ok(html.indexOf("anime.iife.min.js") < html.indexOf("recipe-links.js"));
  assert.ok(html.indexOf("recipe-links.js") < html.indexOf("app.js"));
  assert.match(app, /const NOOP_RECIPE_LINKS = Object\.freeze/);
  assert.match(app, /window\.RECIPE_LINKS\?\.create\?\.\(workspace\)/);
  assert.match(app, /function recipeLinkSnapshots\(\)/);
  assert.match(app, /recipeLinks\.sync\(\{\s*recipes,\s*elements\s*\}\)/s);
  assert.match(app, /recipeLinks\.scheduleGeometryUpdate\(elements\)/);
  assert.match(
    app,
    /pagehide[\s\S]*if \(!event\.persisted\) recipeLinks\.destroy\(\)/,
  );
  assert.match(
    app,
    /rememberRecipe\(src,\s*dst,\s*resultInfo,\s*\{\s*hitCount:\s*resp\.hit_count,\s*depth:\s*resp\.depth,\s*\}\)/s,
  );
  assert.match(app, /hit_count:\s*Math\.max\(1,/);
  assert.match(app, /depth:\s*Number\.isFinite\(Number\(meta\.depth\)\)/);
  assert.doesNotMatch(links, /localStorage|fetch\(|state\.|recipebook/);
  assert.match(build, /"recipe-links\.css"/);
  assert.match(build, /"recipe-links\.js"/);
});

test("combine feedback owns the only formula publication bubble", async () => {
  const [app, effects, styles, feedback] = await Promise.all([
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/effects.js", "utf8"),
    readFile("frontend/style.css", "utf8"),
    readFile("frontend/combine-feedback.js", "utf8"),
  ]);

  assert.match(app, /renderPublishAction\(document,\s*toast,/);
  assert.match(app, /showPublishAction\(resp\.formula_id\)/);
  assert.doesNotMatch(app, /className\s*=\s*["']formula-publish["']/);
  assert.match(
    effects,
    /setTimeout\(\s*\(\)\s*=>\s*el\.classList\.remove\("show"\),\s*8000\s*\)/,
  );
  assert.doesNotMatch(styles, /\.formula-publish\b/);
  assert.match(styles, /\.first-toast-actions\b/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(feedback, /"公开这个公式"/);
  assert.match(feedback, /"✅ 已公开"/);
  assert.doesNotMatch(feedback, /first-toast-community-link/);
  assert.doesNotMatch(feedback, /查看广场/);
  assert.doesNotMatch(feedback, /社区现在可以投票/);
});

test("main game uses compact sticker and action-icon contracts", async () => {
  const [html, app, styles, iconStyles, effects] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/style.css", "utf8"),
    readFile("frontend/icon-system.css", "utf8"),
    readFile("frontend/effects.js", "utf8"),
  ]);

  assert.ok(html.indexOf("icon-system.js") < html.indexOf("combine-feedback.js"));
  assert.ok(html.indexOf("icon-system.js") < html.indexOf("app.js"));

  const actionIds = {
    "btn-recipebook": "recipes",
    "btn-score": "score",
    "first-wall": "wall",
    "btn-help": "help",
    "search": "search",
    "nick-modal-reroll": "sparkle",
    "nick-modal-confirm": "confirm",
    "recipebook-search": "search",
    "recipebook-export": "download",
    "score-panel-close": "close",
    "recipebook-close": "close",
  };
  for (const [id, icon] of Object.entries(actionIds)) {
    assert.match(
      html,
      new RegExp(`<[^>]+id="${id}"[^>]+data-action-icon="${icon}"[^>]*>`),
      `${id} should declare the ${icon} action icon`,
    );
  }

  for (const match of html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, tag, attrs, contents] = match;
    if (!/data-action-icon=/.test(attrs)) continue;
    const visibleText = contents.replace(/<[^>]*>/g, "").trim();
    assert.ok(
      visibleText || /\baria-label=/.test(attrs),
      `${tag} action must retain visible text or an aria-label`,
    );
    assert.doesNotMatch(
      visibleText,
      /^(?:📖|✨|🗑️|📺|❓|🔍|🎲|✅|⬇️|✕|×)/u,
      `${tag} action should not begin with naked Emoji`,
    );
  }

  const readyAt = app.indexOf("await window.ICON_SYSTEM.ready");
  const loadAt = app.indexOf("await loadElements()");
  const hydrateAt = app.indexOf("window.ICON_SYSTEM.hydrateActions(document)");
  assert.ok(readyAt >= 0 && readyAt < loadAt && loadAt < hydrateAt);

  assert.match(app, /function makeElementChip\(info,/);
  assert.match(app, /function onPointerDown\(e, el, info, source\)/);
  assert.match(app, /function setDragTarget\(record, active\)/);
  assert.match(app, /EFFECTS\?\.setCombineTarget\?\.\(record\.el, active\)/);
  assert.match(app, /function spawnOnCanvas\(info, x, y\)/);
  assert.match(app, /function makeInteractiveRecipeChip\(info,/);
  assert.match(
    app,
    /function rememberRecipe\(leftInfo, rightInfo, resultInfo, meta = \{\}\)/,
  );
  assert.match(app, /function recordScoreEvent\(info, gained, depth, tier\)/);
  assert.match(app, /icon:\s*info\.icon/);
  assert.match(app, /elementInfoFor\(ev\.result, ev\)/);
  assert.match(app, /elementInfoFor\(r\.result, r\)/);
  assert.match(
    app,
    /const previousResultInfo = state\.elements\[resp\.result\].*?icon:\s*resp\.icon \?\? previousResultInfo\.icon/s,
  );
  assert.match(app, /onCombineResult\?\.\(newRec\.el, resultInfo, tier,/);
  assert.match(app, /EFFECTS\?\.beginCombine\?\.\(\s*workspace, src\.el, dst\.el, x, y/s);
  assert.match(
    app,
    /combineEffect\?\.finish\?\.\(\{\s*depth:\s*resp\.depth,\s*discovered:\s*isNewToPlayer,?\s*\}\)/s,
  );
  assert.doesNotMatch(app, /combineEffect\?\.finish\?\.\(tier\)/);
  assert.match(effects, /firstToast\(info,/);
  assert.match(effects, /EFFECTS\.beginCombine = function/);
  assert.match(effects, /EFFECTS\.flyScore = function/);
  assert.match(effects, /prefers-reduced-motion:\s*reduce/);
  assert.match(effects, /renderToast\(document, el, \{\s*\.\.\.info,/);
  assert.doesNotMatch(
    effects,
    /URA_POOL|URA_EMOJI|MutationObserver|paintElement|scanAndPaint|reapplyUra|new WeakMap\(\)/,
  );
  assert.doesNotMatch(app, /reapplyUra/);
  assert.doesNotMatch(styles, /\.ura-(?:emoji|name|visual)/);
  for (const palette of [
    "nature", "product", "office", "studio", "people", "place",
  ]) {
    assert.match(
      iconStyles,
      new RegExp(`body\\.ura-on \\.palette-${palette} \\.element-icon-base`),
    );
  }
  assert.doesNotMatch(effects, /element-icon-base[^]*?src/);

  assert.match(styles, /\.element-list\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /--element-icon-sidebar:\s*27px/);
  assert.match(styles, /--element-icon-canvas:\s*30px/);
  assert.match(styles, /--action-icon-size:\s*16px/);
  assert.match(styles, /--action-icon-well:\s*25px/);
});

test("phone layout keeps the workspace and element collection in vertical flow", async () => {
  const [html, css] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/style.css", "utf8"),
  ]);

  assert.match(html, /class="guidance-formula"/);
  assert.match(html, /id="advanced-guidance"[\s\S]*class="hint-line desktop-only-help">👆 <b>单击<\/b>/);
  assert.match(html, /id="search"[^>]+aria-label="搜索已发现元素"/);
  assert.match(html, /class="topbar-controls">[\s\S]*id="nick-display"[\s\S]*class="topbar-actions"/);
  assert.match(html, /id="btn-help"[^>]*>[\s\S]*class="action-slot"[^>]*data-icon-action="help"[\s\S]*class="action-label">帮助<\/span>/);
  assert.doesNotMatch(html, /id="btn-help"[^>]*data-icon-action=/);
  assert.match(css, /\.mobile-only-help\s*\{\s*display:\s*none/);
  assert.match(
    css,
    /\.guidance-formula\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*nowrap/s,
  );
  assert.match(
    css,
    /\.guidance-board\s*\{[^}]*opacity:\s*\.4[^}]*pointer-events:\s*none/s,
  );
  assert.doesNotMatch(
    css.match(/\.guidance-board\s*\{[^}]*\}/s)?.[0] || "",
    /backdrop-filter|filter:/,
  );
  assert.match(
    css,
    /\.guidance-icon\s*\{[^}]*align-self:\s*center[^}]*align-items:\s*center[^}]*justify-content:\s*center/s,
  );
  assert.match(
    css,
    /\.guidance-icon\s*>\s*\.action-icon\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s,
  );
  assert.match(
    css,
    /\.guidance-icon\s*>\s*\.action-icon\s+img\s*\{[^}]*width:\s*34px[^}]*height:\s*34px/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*780px\)[\s\S]*\.guidance-icon\s*>\s*\.action-icon\s+img\s*\{[^}]*width:\s*26px[^}]*height:\s*26px/s,
  );
  assert.match(css, /@media\s*\(max-width:\s*780px\)/);
  assert.match(css, /\.topbar\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.topbar\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.topbar-controls\s*\{[^}]*display:\s*contents/s);
  assert.match(css, /\.topbar-actions\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.topbar-actions\s+\.btn-ghost\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.topbar-actions\s+\.btn-ghost\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.topbar-actions\s+\.action-label\s*\{[^}]*position:\s*static[^}]*width:\s*auto/s);
  assert.match(css, /#btn-score\s+\.action-slot\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.boss-banner-inline\.show\s*\{[^}]*display:\s*none/s);
  assert.match(css, /body\.ura-on\s+\.topbar-actions\s+\.action-icon\s+img\s*\{[^}]*filter:\s*brightness\(0\)\s+invert\(1\)/s);
  assert.match(css, /\.layout\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.workspace\s*\{[^}]*flex:\s*none[^}]*min-height:/s);
  assert.match(css, /\.sidebar\s*\{[^}]*width:\s*100%[^}]*border-left:\s*0/s);
  assert.match(css, /\.nick-chip\s*\{[^}]*max-width:\s*none[^}]*white-space:\s*normal/s);
  assert.match(css, /\.desktop-only-help\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.mobile-only-help\s*\{[^}]*display:\s*block/s);
});

test("phone CSS protects dynamic viewport, safe areas, scrolling, and touch gestures", async () => {
  const css = await readFile("frontend/style.css", "utf8");

  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.element-list\s*\{[^}]*max-height:\s*min\([^;]*dvh[^}]*overflow-y:\s*scroll/s);
  assert.match(css, /\.element\s*\{[^}]*touch-action:\s*none/s);
  assert.match(css, /body\.drag-active\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.score-panel\s*\{[^}]*max-height:\s*calc\(100dvh/s);
  assert.match(css, /\.recipebook\s*\{[^}]*height:\s*calc\(100dvh/s);
  assert.match(css, /\.nick-modal-card\s*\{[^}]*max-height:\s*calc\(100dvh/s);
});

test("phone element collection shows a scrollable three-by-three grid", async () => {
  const css = await readFile("frontend/style.css", "utf8");

  assert.match(css, /\.element-list\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /grid-auto-rows:\s*minmax\(48px,\s*auto\)/);
  assert.match(css, /\.element-list\s*\{[^}]*\n\s*height:\s*190px/s);
  assert.match(css, /\.element-list\s*\{[^}]*min-height:\s*190px[^}]*overflow-y:\s*scroll/s);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /\.element-list\s+\.element\s*\{[^}]*width:\s*100%[^}]*white-space:\s*normal/s);
});

test("phone guidance stays static and expands the workspace in normal page flow", async () => {
  const css = await readFile("frontend/style.css", "utf8");

  assert.match(css, /\.workspace\s*\{[^}]*height:\s*auto[^}]*min-height:\s*300px/s);
  assert.match(css, /\.hint\s*\{[^}]*position:\s*relative[^}]*height:\s*auto/s);
  assert.match(css, /\.hint\s*\{[^}]*overflow:\s*visible/s);
  assert.doesNotMatch(css, /\.hint\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.sidebar\s*\{[^}]*min-height:\s*0/s);
});
