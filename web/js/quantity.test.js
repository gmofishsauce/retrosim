import { test } from "node:test";
import assert from "node:assert/strict";

import { parseQuantity, formatQuantity } from "./quantity.js";

// Plain decimals are what every property took before fractions existed, so they
// keep working exactly as they did (FR-020b).
test("parseQuantity reads plain decimals", () => {
  assert.equal(parseQuantity("2"), 2);
  assert.equal(parseQuantity("100"), 100);
  assert.equal(parseQuantity("0.5"), 0.5);
  assert.equal(parseQuantity(".5"), 0.5);
  assert.equal(parseQuantity("2."), 2);
  assert.equal(parseQuantity("-3"), -3);
  assert.equal(parseQuantity("+4"), 4);
  assert.equal(parseQuantity("1e-3"), 0.001);
  assert.equal(parseQuantity("  7  "), 7); // surrounding whitespace ignored
});

// Fractions are the point of the exercise (FR-071a): a clock at one cycle every
// three seconds is 1/3 Hz, and typing that is exact where 0.333 is not.
test("parseQuantity reads fractions", () => {
  assert.equal(parseQuantity("1/2"), 0.5);
  assert.equal(parseQuantity("1/3"), 1 / 3);
  assert.equal(parseQuantity("1/10"), 0.1);
  assert.equal(parseQuantity("2/7"), 2 / 7);
  assert.equal(parseQuantity("-1/2"), -0.5);
  assert.equal(parseQuantity("1 / 3"), 1 / 3); // whitespace around the slash
  assert.equal(parseQuantity("0.5/2"), 0.25); // a decimal either side is fine
});

// Rejection returns null so the panel can restore the previous display instead
// of storing a guess. The strictness matters most for the parseFloat trap:
// "1abc" is a typo, and reading it as 1 would silently accept half the input.
test("parseQuantity rejects what is not a value", () => {
  for (const bad of ["", "   ", "abc", "1abc", "1/", "/3", "1/0", "1/2/3", "--1", "1,5", "/"]) {
    assert.equal(parseQuantity(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseQuantity(null), null);
  assert.equal(parseQuantity(undefined), null);
});

// A value that is already a short decimal stays one: a 2.5 ns delay reads better
// than "5/2", and someone who typed 0.5 should not watch it turn into 1/2.
test("formatQuantity keeps integers and short decimals as decimals", () => {
  assert.equal(formatQuantity(2), "2");
  assert.equal(formatQuantity(100), "100");
  assert.equal(formatQuantity(0), "0");
  assert.equal(formatQuantity(-3), "-3");
  assert.equal(formatQuantity(0.5), "0.5");
  assert.equal(formatQuantity(0.25), "0.25");
  assert.equal(formatQuantity(0.1), "0.1");
  assert.equal(formatQuantity(2.5), "2.5");
});

// A ratio with no short decimal comes back as the fraction it was typed as —
// the round trip the user actually sees when the panel re-renders after an edit.
test("formatQuantity names a repeating ratio as its fraction", () => {
  assert.equal(formatQuantity(1 / 3), "1/3");
  assert.equal(formatQuantity(2 / 3), "2/3");
  assert.equal(formatQuantity(1 / 6), "1/6");
  assert.equal(formatQuantity(1 / 7), "1/7");
  assert.equal(formatQuantity(2 / 7), "2/7");
  assert.equal(formatQuantity(1 / 9), "1/9");
  assert.equal(formatQuantity(-1 / 3), "-1/3");
});

// The round trip is the contract: whatever the field shows must parse back to
// the number it was showing. Covers every speed the request named (1/2 … 1/10).
test("format → parse round-trips exactly", () => {
  const values = [
    1, 2, 100, 0.5, 0.25, 0.1, 2.5, 0.001,
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => 1 / d),
    2 / 3, 3 / 7, 5 / 6,
  ];
  for (const v of values) {
    assert.equal(parseQuantity(formatQuantity(v)), v, `${v} → ${formatQuantity(v)}`);
  }
});

// Nothing describable as a simple ratio falls back to the exact decimal rather
// than inventing a ratio of large integers -- or, worse, rounding to something
// that is not the value.
test("formatQuantity falls back to an exact decimal", () => {
  assert.equal(formatQuantity(Math.PI), "3.141592653589793");
  assert.equal(formatQuantity(1 / 1000), "0.001"); // short decimal, not 1/1000
  assert.equal(formatQuantity(NaN), "");
  assert.equal(formatQuantity(Infinity), "");
});

// A small positive value must never render as "0": the field would then be
// showing zero, and leaving it would commit zero -- the one value that stops a
// clock dead (FR-071a). The property minimums themselves are such values.
test("formatQuantity never renders a non-zero value as zero", () => {
  for (const v of [1e-6, 1e-9, 0.001, 0.00012345, -1e-6]) {
    const t = formatQuantity(v);
    assert.notEqual(Number(parseQuantity(t)), 0, `${v} rendered as ${t}`);
    assert.equal(parseQuantity(t), v, `${v} round-trips`);
  }
});

// The round trip is absolute, not a property of the tidy cases: whatever
// formatQuantity emits parses back to exactly the number it was given.
test("format → parse round-trips for awkward values too", () => {
  for (const v of [Math.PI, Math.E, 1e-6, 1e21, 1 / 3 + 1e-12, 123.456789]) {
    assert.equal(parseQuantity(formatQuantity(v)), v, String(v));
  }
});
