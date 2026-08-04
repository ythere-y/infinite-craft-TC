import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadOpeningAnimation() {
  const source = await readFile("frontend/opening-animation.js", "utf8")
    .catch(() => "");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.ok(
    context.window.OPENING_ANIMATION,
    "opening animation should expose its public API",
  );
  return context.window.OPENING_ANIMATION;
}

test("opening branch depends on the persisted nickname", async () => {
  const opening = await loadOpeningAnimation();

  assert.equal(opening.branchForNickname(""), "first-time");
  assert.equal(opening.branchForNickname("  "), "first-time");
  assert.equal(opening.branchForNickname("全力以赴的代码鹅"), "returning");
});

test("opening limits bound prefill, emission, and travel time", async () => {
  const opening = await loadOpeningAnimation();

  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.CONFIG)),
    {
      prefilledTokens: 18,
      prefilledFragments: 16,
      fragmentsPerEmission: 2,
      emissionIntervalMs: 720,
      tokenTravelMs: 13_200,
      maxTokens: 36,
      maxFragments: 48,
      pathSamples: 360,
    },
  );
});

test("every feeder path moves inward immediately", async () => {
  const opening = await loadOpeningAnimation();
  const definitions = [
    { phase: 0, turns: 2.3, startRadius: 485, endRadius: 36, wave: 22 },
    { phase: Math.PI, turns: 2.3, startRadius: 485, endRadius: 36, wave: -22 },
    { phase: Math.PI / 2, turns: 1.72, startRadius: 370, endRadius: 42, wave: 12 },
    { phase: Math.PI * 1.5, turns: 1.72, startRadius: 370, endRadius: 42, wave: -12 },
  ].map((definition) => ({
    centerX: 500,
    centerY: 296,
    verticalScale: 0.76,
    ...definition,
  }));

  for (const definition of definitions) {
    const points = opening.createSpiralPoints(definition, 220);
    const firstThirty = points.slice(0, 31);
    for (let index = 1; index < firstThirty.length; index += 1) {
      assert.ok(
        firstThirty[index].radius <= firstThirty[index - 1].radius,
        `path moved outward at sample ${index}`,
      );
    }
  }
});

test("returning identity makes continue the dominant action", async () => {
  const opening = await loadOpeningAnimation();
  const model = opening.identityModel("returning", "全力以赴的代码鹅");

  assert.equal(model.title, "欢迎回来");
  assert.equal(model.nickname, "全力以赴的代码鹅");
  assert.deepEqual(
    Array.from(model.actions, (action) => ({
      id: action.id,
      label: action.label,
      primary: action.primary,
    })),
    [
      { id: "continue", label: "继续使用", primary: true },
      { id: "change", label: "更改花名", primary: false },
    ],
  );
});

test("first-time identity cannot bypass name confirmation", async () => {
  const opening = await loadOpeningAnimation();
  const model = opening.identityModel("first-time", "");

  assert.equal(model.title, "请确认你的花名");
  assert.equal(model.actions.some((action) => action.id === "continue"), false);
  assert.equal(model.actions.some((action) => action.id === "cancel"), false);
  assert.equal(model.actions.some((action) => action.id === "confirm"), true);
});

test("center throw lands exactly on the feeder entry", async () => {
  const opening = await loadOpeningAnimation();
  const origin = { x: 500, y: 296 };
  const entry = { x: 946.25, y: 174.5 };

  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.parabolicPoint(origin, entry, 0, 118))),
    { x: 500, y: 296 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.parabolicPoint(origin, entry, 1, 118))),
    entry,
  );
  assert.ok(
    opening.parabolicPoint(origin, entry, 0.5, 118).y <
      (origin.y + entry.y) / 2,
    "throw should rise above its linear midpoint",
  );
});

test("track sampling advances inward from the feeder entry", async () => {
  const opening = await loadOpeningAnimation();
  const samples = [
    { x: 940, y: 280, radius: 440 },
    { x: 932, y: 274, radius: 432 },
    { x: 921, y: 266, radius: 421 },
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.motionSample(samples, 0, 13_200))),
    samples[0],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.motionSample(samples, 6_600, 13_200))),
    samples[1],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(opening.motionSample(samples, 13_200, 13_200))),
    samples[2],
  );
});

test("reduced motion and missing Anime use the static entry mode", async () => {
  const opening = await loadOpeningAnimation();

  assert.equal(
    opening.animationMode({ reducedMotion: false, hasDrawable: true }),
    "live",
  );
  assert.equal(
    opening.animationMode({ reducedMotion: true, hasDrawable: true }),
    "static",
  );
  assert.equal(
    opening.animationMode({ reducedMotion: false, hasDrawable: false }),
    "static",
  );
});
