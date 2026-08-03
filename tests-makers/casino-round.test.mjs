import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadCasinoRound() {
  const source = await readFile("frontend/casino-round.js", "utf8").catch(() => "");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.ok(
    context.window.CASINO_ROUND,
    "casino round engine should load into the browser global",
  );
  return context.window.CASINO_ROUND;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("a casino round starts empty and doubles from a fixed 100 point base", async () => {
  const round = await loadCasinoRound();
  let state = round.createRound(100);
  assert.deepEqual(plain(state), { baseScore: 100, pot: 0, chips: 0 });

  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(plain(state), { baseScore: 100, pot: 100, chips: 1 });

  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(plain(state), { baseScore: 100, pot: 200, chips: 2 });

  state = round.applyRoundEvent(state, "success");
  assert.deepEqual(plain(state), { baseScore: 100, pot: 400, chips: 3 });
});

test("harvest and failure both return to an empty round", async () => {
  const round = await loadCasinoRound();
  const active = { baseScore: 100, pot: 800, chips: 4 };

  assert.deepEqual(plain(round.applyRoundEvent(active, "harvest")), {
    baseScore: 100,
    pot: 0,
    chips: 0,
  });
  assert.deepEqual(plain(round.applyRoundEvent(active, "failure")), {
    baseScore: 100,
    pot: 0,
    chips: 0,
  });
});

test("unlimited chip offsets rise while harvest stagger stays bounded", async () => {
  const round = await loadCasinoRound();
  assert.equal(round.chipOffset(0), 0);
  assert.equal(round.chipOffset(25), 175);

  const sequence = plain(round.createHarvestSequence(100));
  assert.equal(sequence.length, 100);
  assert.equal(sequence[0].chipIndex, 99);
  assert.ok(sequence.at(-1).delay <= 720);
});
