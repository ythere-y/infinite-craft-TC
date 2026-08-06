(() => {
  "use strict";

  const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
  const INVALID = "\u65e0\u6548";
  const MAX_DECIMAL_PLACES = 6;
  const MAX_EXPONENT = 1_000;
  const DECIMAL_PLACES_ERROR = "\u98ce\u683c\u6982\u7387\u7684\u5c0f\u6570\u4f4d\u6570\u4e0d\u80fd\u8d85\u8fc7 6";
  const RANGE_ERROR = "\u98ce\u683c\u6982\u7387\u5fc5\u987b\u5728 0 \u5230 100 \u4e4b\u95f4";
  const VALUE_ERROR = "\u98ce\u683c\u6982\u7387\u5fc5\u987b\u662f\u6709\u6548\u6570\u5b57";

  function parse(value) {
    const match = DECIMAL.exec(String(value).trim());
    if (!match) return null;

    const exponent = Number(match[5] || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXPONENT) {
      return null;
    }

    const integer = match[2] || "0";
    const fraction = match[3] ?? match[4] ?? "";
    let coefficient = BigInt(`${integer}${fraction}`);
    if (match[1] === "-") coefficient = -coefficient;
    let scale = fraction.length - exponent;
    if (scale > MAX_DECIMAL_PLACES) return {error: DECIMAL_PLACES_ERROR};
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

  function validate(values) {
    const decimals = values.map(parse);
    const invalid = decimals.find((decimal) => decimal === null || decimal.error);
    if (invalid !== undefined) {
      if (invalid !== null && invalid.error) {
        return {error: invalid.error};
      }
      return {error: VALUE_ERROR};
    }
    const outOfRange = decimals.some((decimal) => (
      decimal.coefficient < 0n ||
      decimal.coefficient > 100n * (10n ** BigInt(decimal.scale))
    ));
    if (outOfRange) {
      return {error: RANGE_ERROR};
    }
    return {decimals};
  }

  function summarize(values) {
    const validation = validate(values);
    if (validation.error) {
      return {total: INVALID, valid: false, error: validation.error};
    }
    const {decimals} = validation;
    const scale = Math.max(0, ...decimals.map((decimal) => decimal.scale));
    const total = decimals.reduce(
      (sum, decimal) => sum + decimal.coefficient * (10n ** BigInt(scale - decimal.scale)),
      0n,
    );
    const shown = format(total, scale);
    return {total: shown, valid: shown === "100"};
  }

  function summarizeStyles(styles) {
    const validation = validate(styles.map((style) => style.probability));
    if (validation.error) {
      return {total: INVALID, valid: false, error: validation.error};
    }
    return summarize(
      styles
        .filter((style) => style.enabled)
        .map((style) => style.probability),
    );
  }

  globalThis.PromptDecimal = Object.freeze({summarize, summarizeStyles});
})();
