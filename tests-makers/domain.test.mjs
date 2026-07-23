import assert from "node:assert/strict";
import test from "node:test";

import {
  TIERS,
  rankFor,
  scoreFor,
  shouldExplode,
} from "../edge-functions/_lib/kpi.js";
import {
  generateNickname,
  nicknameStats,
} from "../edge-functions/_lib/nickname.js";
import { buildBounty } from "../edge-functions/_lib/bounty.js";
import { jsonResponse } from "../edge-functions/_lib/http.js";
import { ELEMENTS, STARTERS } from "../edge-functions/_generated/seed-data.js";

test("KPI domain matches existing tier boundaries and effects", () => {
  assert.equal(TIERS[0].floor, 0);
  assert.equal(rankFor(0).grade, "3-");
  assert.equal(rankFor(500).grade, "3.25");
  assert.equal(rankFor(8_000).grade, "瑞雪");
  assert.equal(rankFor(11_200).grade, "瑞雪🌛");
  assert.equal(rankFor(212_800).grade, "暴雪领主");
  assert.deepEqual(scoreFor("tencent", true), {
    delta: 80,
    reason: "tencent +30 / 首发 +50",
  });
  assert.equal(shouldExplode("easter_egg", "普通结果"), true);
  assert.equal(shouldExplode(null, "生产故障"), true);
});

test("nickname generator preserves the established display format", () => {
  const nickname = generateNickname({ random: () => 0 });
  assert.match(nickname, /^.{4}的.+鹅$/u);
  assert.ok(nicknameStats().effective_combo_space > 0);
});

test("bounty retains groups, starter discoveries and first metadata", () => {
  const bounty = buildBounty({
    elements: ELEMENTS,
    starters: STARTERS,
    firsts: [
      {
        result: "腾讯大厦",
        emoji: "🏢",
        discoverer: "测试鹅",
        ts: 1_700_000_000,
        seq: 1,
      },
    ],
  });

  assert.equal(bounty.tabs[0].key, "tencent");
  assert.ok(bounty.groups.some((group) => group.category === "boss"));
  const tencent = bounty.groups.find((group) => group.category === "tencent");
  assert.ok(tencent.items.find((item) => item.name === "企鹅").discovered);
  const buildings = bounty.groups.find((group) => group.category === "building");
  const tower = buildings.items.find((item) => item.name === "腾讯大厦");
  assert.equal(tower.discoverer, "测试鹅");
  assert.equal(tower.seq, 1);
});

test("JSON responses avoid unsupported Response.json static helper", async () => {
  const response = jsonResponse({ ok: true }, { status: 201 });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { ok: true });
});
