// Numeric property values: text ↔ number (FR-020b). The properties panel
// (§6.11) edits propagation delays and declared properties through a text field
// rather than an `<input type="number">`, because a rate below 1 is most
// naturally written as a fraction — a clock at one cycle every three seconds is
// "1/3" Hz, not "0.333" (FR-071a). Both directions live here, pure and DOM-free,
// so they are unit-testable and so the panel has exactly one definition of what
// a property value may look like.

// FRACTION_LIMIT is the largest denominator `formatQuantity` will recognize when
// it turns a stored number back into a fraction. It bounds the search, and it is
// also a statement of intent: fractions are for human-scale ratios like 1/3 or
// 2/7, not for reconstructing an arbitrary float as a ratio of big integers.
const FRACTION_LIMIT = 64;

// DECIMAL_DIGITS is how many decimal places a value may use and still be shown
// as a decimal. A value that survives this rounding unchanged *is* that decimal,
// so showing it as a fraction would only surprise (a 2.5 ns delay reads better
// than "5/2"); anything else falls through to the fraction search below.
const DECIMAL_DIGITS = 4;

// parseQuantity reads a property value as the user typed it and returns the
// number, or null when the text is not a value at all — the panel restores the
// previous display on null rather than guessing. Accepted: a decimal number
// (`2`, `0.5`, `-3`, `1e-3`), or a fraction `a/b` of two decimal numbers
// (`1/3`, `2/7`, `-1/2`). Whitespace around the text and around the slash is
// ignored, so "1 / 3" works. A zero denominator is rejected rather than
// returning Infinity: it is a typo, not a value.
export function parseQuantity(text) {
  const s = String(text ?? "").trim();
  if (s === "") return null;
  const slash = s.indexOf("/");
  if (slash < 0) return decimal(s);
  const num = decimal(s.slice(0, slash).trim());
  const den = decimal(s.slice(slash + 1).trim());
  if (num === null || den === null || den === 0) return null;
  return num / den;
}

// decimal parses one plain decimal number STRICTLY: unlike parseFloat, which
// stops at the first character it cannot use and so reads "1abc" as 1, this
// requires the whole string to be the number. A property field that silently
// accepted half of what was typed would be worse than rejecting it.
function decimal(s) {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// formatQuantity renders a stored number for the field:
//   • an integer, or a value that is already a short decimal, as that decimal —
//     `2`, `0.5`, `0.25`, `0.1`;
//   • otherwise, when the value is a simple ratio, as that fraction — `1/3`,
//     `2/7`, the form the user typed it in;
//   • otherwise JavaScript's own rendering, which is the shortest string that
//     reads back as the same double.
// Every branch **round-trips exactly**: `parseQuantity(formatQuantity(n)) === n`
// for any finite n. That is the whole contract, and it is worth stating as an
// absolute because the near miss is harmful rather than merely untidy — an
// earlier draft rounded the last branch to DECIMAL_DIGITS for looks, which
// renders 1e-6 as "0". A field that displays a positive value as zero invites the
// user to commit that zero by doing nothing but leaving the field, and for a
// clock speed zero is exactly the value that stops the run dead (FR-071a). A long
// exact decimal is worse-looking and right; a short wrong one is neither.
export function formatQuantity(n) {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);

  // Already a short decimal? Then it is one — say so rather than as a ratio.
  if (Number(n.toFixed(DECIMAL_DIGITS)) === n) return String(n);

  return asFraction(n) ?? String(n);
}

// asFraction finds the smallest denominator up to FRACTION_LIMIT that reproduces
// `n` exactly in floating point, and returns "p/q"; null when none does. The
// exactness test is deliberately `p / q === n` rather than a tolerance: the
// point is to name the value the field will parse back to, and only a quotient
// that round-trips bit for bit does that. 1/3 qualifies because the double
// nearest 1/3 is exactly what `1 / 3` evaluates to.
function asFraction(n) {
  const sign = n < 0 ? "-" : "";
  const x = Math.abs(n);
  for (let q = 2; q <= FRACTION_LIMIT; q++) {
    const p = Math.round(x * q);
    if (p !== 0 && p / q === x) return `${sign}${p}/${q}`;
  }
  return null;
}
