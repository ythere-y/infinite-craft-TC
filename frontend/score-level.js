(function (root) {
  "use strict";

  var BASE_STAR_COST = 300;
  var STAR_COST_STEP = 20;
  var MAX_LEVEL_UNITS = 65_535;

  function normalizeScore(value) {
    var score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(score)));
  }

  function levelThreshold(value) {
    var units = Math.max(0, Math.trunc(Number(value) || 0));
    return units * BASE_STAR_COST
      + (STAR_COST_STEP * units * (units - 1)) / 2;
  }

  var MAX_LEVEL_SCORE = levelThreshold(MAX_LEVEL_UNITS - 1);

  function levelUnits(score) {
    var low = 0;
    var high = 1;
    while (levelThreshold(high) <= score) high *= 2;
    while (low + 1 < high) {
      var middle = Math.floor((low + high) / 2);
      if (levelThreshold(middle) <= score) low = middle;
      else high = middle;
    }
    return low;
  }

  function rankFor(value) {
    var displayScore = Math.min(normalizeScore(value), MAX_LEVEL_SCORE);
    var earnedUnits = levelUnits(displayScore);
    var displayUnits = Math.min(MAX_LEVEL_UNITS, earnedUnits + 1);
    var remaining = displayUnits;
    var crowns = Math.floor(remaining / 64);
    remaining %= 64;
    var suns = Math.floor(remaining / 16);
    remaining %= 16;
    var moons = Math.floor(remaining / 4);
    var stars = remaining % 4;
    var icons = "👑".repeat(crowns)
      + "🌞".repeat(suns) + "🌙".repeat(moons) + "🌟".repeat(stars);
    var floor = levelThreshold(earnedUnits);
    var ceiling = levelThreshold(earnedUnits + 1);
    var labels = [
      crowns ? crowns + "个皇冠" : "",
      suns ? suns + "个太阳" : "",
      moons ? moons + "个月亮" : "",
      stars ? stars + "颗星星" : "",
    ].filter(Boolean);
    return {
      level_units: displayUnits,
      crowns: crowns,
      suns: suns,
      moons: moons,
      stars: stars,
      icons: icons,
      aria_label: labels.join("、") || "尚未获得星星",
      progress: displayUnits === MAX_LEVEL_UNITS
        ? 1
        : (displayScore - floor) / Math.max(1, ceiling - floor),
    };
  }

  function transitionSteps(beforeUnits, afterUnits) {
    var steps = [];
    for (var units = beforeUnits + 1; units <= afterUnits; units += 1) {
      steps.push({ type: "gain", icon: "🌟" });
      if (units % 4 === 0) steps.push({ type: "merge", from: "🌟", to: "🌙" });
      if (units % 16 === 0) steps.push({ type: "merge", from: "🌙", to: "🌞" });
      if (units % 64 === 0) steps.push({ type: "merge", from: "🌞", to: "👑" });
    }
    return steps;
  }

  root.SCORE_LEVEL = Object.freeze({
    BASE_STAR_COST: BASE_STAR_COST,
    STAR_COST_STEP: STAR_COST_STEP,
    MAX_LEVEL_SCORE: MAX_LEVEL_SCORE,
    normalizeScore: normalizeScore,
    levelThreshold: levelThreshold,
    rankFor: rankFor,
    transitionSteps: transitionSteps,
  });
})(typeof window !== "undefined" ? window : this);
