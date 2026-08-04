(() => {
  "use strict";

  const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
  const INVALID = "\u65e0\u6548";
  const MAX_DECIMAL_PLACES = 1_000;

  function parse(value) {
    const match = DECIMAL.exec(String(value).trim());
    if (!match) return null;

    const exponent = Number(match[5] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_PLACES) {
      return null;
    }

    const integer = match[2] || "0";
    const fraction = match[3] ?? match[4] ?? "";
    let coefficient = BigInt(`${integer}${fraction}`);
    if (match[1] === "-") coefficient = -coefficient;
    let scale = fraction.length - exponent;
    if (scale > MAX_DECIMAL_PLACES) return null;
    if (scale < 0) {
      coefficient *= 10n ** BigInt(-scale);
      scale = 0;
    }
    return {coefficient, scale};
  }

  function format(coefficient, scale) {
    const negative = coefficient < 0n;
    let digits = (negative ? -coefficient : coefficient).toString();
    if (scale === 0) return `${negative ? "-" : ""}${digits}`;
    if (digits.length <= scale) digits = `${"0".repeat(scale + 1 - digits.length)}${digits}`;
    const integer = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, "");
    return `${negative ? "-" : ""}${fraction ? `${integer}.${fraction}` : integer}`;
  }

  function summarize(values) {
    const decimals = values.map(parse);
    if (decimals.some((decimal) => decimal === null)) {
      return {total: INVALID, valid: false};
    }
    const scale = Math.max(0, ...decimals.map((decimal) => decimal.scale));
    const total = decimals.reduce(
      (sum, decimal) => sum + decimal.coefficient * (10n ** BigInt(scale - decimal.scale)),
      0n,
    );
    const shown = format(total, scale);
    return {total: shown, valid: shown === "100"};
  }

  globalThis.PromptDecimal = Object.freeze({summarize});
})();
