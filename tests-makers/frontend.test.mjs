import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectUnseenPrefix,
  mergeFirstItems,
} from "../frontend/wall/polling.js";

test("wall uses visibility-aware incremental polling instead of SSE", async () => {
  const source = await readFile("frontend/wall/wall.js", "utf8");

  assert.doesNotMatch(source, /new EventSource\s*\(/);
  assert.match(source, /offset=\$\{offset\}&limit=\$\{POLL_PAGE_SIZE\}/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pollNewFirsts/);
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
  const [html, app, styles, effects] = await Promise.all([
    readFile("frontend/index.html", "utf8"),
    readFile("frontend/app.js", "utf8"),
    readFile("frontend/style.css", "utf8"),
    readFile("frontend/effects.js", "utf8"),
  ]);

  assert.ok(html.indexOf("icon-system.js") < html.indexOf("combine-feedback.js"));
  assert.ok(html.indexOf("icon-system.js") < html.indexOf("app.js"));

  const actionIds = {
    "btn-recipebook": "recipes",
    "btn-score": "score",
    "btn-reset": "reset",
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
  const loadAt = app.indexOf("await Promise.all([loadElements(), loadTiers()])");
  const hydrateAt = app.indexOf("window.ICON_SYSTEM.hydrateActions(document)");
  assert.ok(readyAt >= 0 && readyAt < loadAt && loadAt < hydrateAt);

  assert.match(app, /function makeElementChip\(info,/);
  assert.match(app, /function spawnAtWorkspaceCenter\(info\)/);
  assert.match(app, /function onPointerDown\(e, el, info, source\)/);
  assert.match(app, /function spawnOnCanvas\(info, x, y\)/);
  assert.match(app, /function makeInteractiveRecipeChip\(info,/);
  assert.match(app, /function rememberRecipe\(leftInfo, rightInfo, resultInfo\)/);
  assert.match(app, /function recordScoreEvent\(info, gained, depth, tier\)/);
  assert.match(app, /icon:\s*info\.icon/);
  assert.match(app, /elementInfoFor\(ev\.result, ev\)/);
  assert.match(app, /elementInfoFor\(r\.result, r\)/);
  assert.match(
    app,
    /const previousResultInfo = state\.elements\[resp\.result\].*?icon:\s*resp\.icon \?\? previousResultInfo\.icon/s,
  );
  assert.match(app, /onCombineResult\?\.\(newRec\.el, resultInfo, tier,/);
  assert.match(effects, /firstToast\(info,/);
  assert.match(effects, /renderToast\(document, el, \{\s*\.\.\.info,/);
  assert.match(effects, /new WeakMap\(\)/);
  assert.match(effects, /ICON_SYSTEM\.renderElement\(document, el, payload\)/);
  assert.doesNotMatch(effects, /element-icon-base[^]*?src/);

  assert.match(styles, /\.element-list\s*\{[^}]*display:\s*grid;/s);
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /--element-icon-sidebar:\s*27px/);
  assert.match(styles, /--element-icon-canvas:\s*30px/);
  assert.match(styles, /--action-icon-size:\s*16px/);
  assert.match(styles, /--action-icon-well:\s*25px/);
});
