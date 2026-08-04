import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compileBountyContent,
  normalizePair,
} from "../scripts/bounty-content-lib.mjs";

const starters = [
  "水", "火", "风", "土", "企鹅", "人",
  "时间", "AI", "电脑", "手机", "网络",
];

function fixture() {
  return {
    catalog: {
      meta: { content_epoch: 2, version: "2.0.0" },
      tabs: [{ key: "tencent", label: "腾讯互联网", emoji: "🐧" }],
      groups: [{
        key: "qq_memory",
        category: "qq_memory",
        label: "QQ时代记忆",
        emoji: "💬",
        tab: "tencent",
        targets: ["QQ"],
      }],
      targets: {
        QQ: {
          emoji: "🐧",
          category: "qq_memory",
          aliases: [],
          canonical_recipe: {
            a: "企鹅",
            b: "聊天",
            chain: "qq_memory",
            comment: "企鹅遇上即时聊天，QQ上线。",
          },
        },
      },
      support_elements: {
        互联网: { emoji: "🌐", category: "internet" },
        聊天: { emoji: "💬", category: "social" },
      },
      support_recipes: {
        "电脑 + 网络": {
          result: "互联网", emoji: "🌐", chain: "internet",
        },
        "人 + 互联网": {
          result: "聊天", emoji: "💬", chain: "social",
        },
      },
      retired_pairs: [],
      retired_elements: [],
    },
    seedElements: {
      starters: starters.map((name) => ({
        id: name, name, emoji: "🧩", category: "classic",
      })),
      elements: Object.fromEntries(
        starters.map((name) => [
          name, { emoji: "🧩", category: "classic" },
        ]),
      ),
    },
    seedCombinations: { combinations: {} },
  };
}

test("catalog compiler normalizes pairs and proves strict reachability", () => {
  const compiled = compileBountyContent(fixture());
  assert.equal(normalizePair("网络", "电脑"), "电脑 + 网络");
  assert.equal(compiled.content_epoch, 2);
  assert.equal(compiled.depths.QQ, 3);
  assert.equal(compiled.combinations["企鹅 + 聊天"].result, "QQ");
  assert.match(compiled.catalog_digest, /^sha256:[a-f0-9]{64}$/u);
});

test("catalog compiler rejects duplicate groups, aliases, and pair results", () => {
  const input = fixture();
  input.catalog.targets.QQ.aliases = ["企鹅"];
  assert.throws(
    () => compileBountyContent(input),
    /alias.*collides.*element/iu,
  );
});

test("catalog compiler rejects input-only shortcuts and unreachable targets", () => {
  const input = fixture();
  delete input.catalog.support_recipes["人 + 互联网"];
  assert.throws(
    () => compileBountyContent(input),
    /unreachable.*聊天|QQ.*unreachable/iu,
  );
});
