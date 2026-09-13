// Unit tests for GAL definition errors (§6.14/§11.1, FR-066i–FR-066m).

import test from "node:test";
import assert from "node:assert/strict";

import {
  galDefinitionErrors,
  designDefinitionErrors,
  definitionErrorsMessage,
  hasEquations,
} from "./galerrors.js";

// A GAL22V10-shaped part: CLK and eleven inputs, ten OLMC outputs. `over` sets
// top-level fields; `pinOver` merges into pins by name.
function gal(over = {}, pinOver = {}) {
  const pins = [
    { name: "CLK", direction: "in" },
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map((n) => ({ name: "I" + n, direction: "in" })),
    ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((n) => ({ name: "IO" + n, direction: "out" })),
  ].map((p) => ({ ...p, ...(pinOver[p.name] ?? {}) }));
  return { id: "type-T", name: "22V10", gal: "GAL22V10", partnumber: "T", pins, ...over };
}

const allReg = Object.fromEntries([14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((n) => ["IO" + n, { olmc: "reg" }]));

test("a non-GAL type has no definition errors", () => {
  assert.deepEqual(galDefinitionErrors({ name: "7400", pins: [], behavior: "garbage =" }), []);
  assert.deepEqual(galDefinitionErrors(null), []);
});

// The reported bug: a part blocked out with registered outputs and a clock and
// no logic yet is a perfectly good part (FR-066i/FR-066j).
test("registered outputs, a clock, and no equations is not an error (FR-066j)", () => {
  assert.deepEqual(galDefinitionErrors(gal({ clock: "CLK" }, allReg)), []);
  assert.deepEqual(galDefinitionErrors(gal({ clock: "CLK" })), []); // clock with nothing registered
});

test("missing equations are not errors; only conflicts are (FR-066j)", () => {
  const t = gal({ clock: "CLK", behavior: "IO14.R = I2\n" }, allReg);
  assert.deepEqual(galDefinitionErrors(t), []);
});

test("a behavior of nothing but comments is no behavior, not a compile error", () => {
  assert.equal(hasEquations("; to do\n  ; later\n"), false);
  assert.equal(hasEquations("IO14 = I2 ; on\n"), true);
  assert.deepEqual(galDefinitionErrors(gal({ behavior: "; to do\n" })), []);
});

test("load errors from the server come first (FR-066j)", () => {
  const errs = galDefinitionErrors(gal({ loadErrors: ["clock names unknown pin \"CP\""], behavior: "IO14 = NOSUCH\n" }));
  assert.equal(errs.length, 2);
  assert.match(errs[0], /unknown pin "CP"/);
  assert.match(errs[1], /^behavior: .*NOSUCH/); // compile error, part name stripped
});

test("a declared type and its equation that disagree are one error each way (FR-066i)", () => {
  const regComb = galDefinitionErrors(gal({ clock: "CLK", behavior: "IO14 = I2\n" }, { IO14: { olmc: "reg" } }));
  assert.equal(regComb.length, 1);
  assert.match(regComb[0], /IO14 is declared a registered output/);

  const combReg = galDefinitionErrors(gal({ clock: "CLK", behavior: "IO14.R = I2\n" }, { IO14: { olmc: "comb" } }));
  assert.equal(combReg.length, 1);
  assert.match(combReg[0], /IO14 is declared a combinational output/);
});

test("a registered declaration or .R equation with no clock is an error (FR-066i)", () => {
  const declared = galDefinitionErrors(gal({}, { IO14: { olmc: "reg" }, IO15: { olmc: "reg" } }));
  assert.equal(declared.length, 1);
  assert.match(declared[0], /IO14, IO15 are declared registered but the part has no clock/);

  const written = galDefinitionErrors(gal({ behavior: "IO14.R = I2\n" }));
  assert.ok(written.some((e) => /declares no clock/.test(e)));
});

test("an equation for an input-configured pin is an error (FR-066i)", () => {
  const errs = galDefinitionErrors(gal({ behavior: "IO14 = I2\n" }, { IO14: { direction: "in" } }));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /IO14/);
});

test("the clock pin used in an equation is an error (FR-066g)", () => {
  const errs = galDefinitionErrors(gal({ clock: "CLK", behavior: "IO14 = CLK * I2\n" }));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /clock pin CLK may not appear in an equation \(used by IO14\)/);
  // Without a clock, pin 1 is an ordinary input.
  assert.deepEqual(galDefinitionErrors(gal({ behavior: "IO14 = CLK * I2\n" })), []);
});

test("without olmc keys the type is inferred, so no disagreement can arise (FR-066i)", () => {
  assert.deepEqual(galDefinitionErrors(gal({ clock: "CLK", behavior: "IO14.R = I2\nIO15 = I3\n" })), []);
});

// Content the dialog cannot edit is not a fault in the part: the shared 22V574's
// shape (.E, AR, SP) is error-free (FR-066j).
test("a 22V574-shaped part with .E, AR and SP has no errors", () => {
  const t = gal(
    { clock: "CLK", behavior: "IO14.R = I2 * I3\n     + !I2 * IO14\nIO14.E = I4\nAR = I5\nSP = I6\n" },
    { IO14: { direction: "tristate" } },
  );
  assert.deepEqual(galDefinitionErrors(t), []);
});

test("results are memoized per type-data object", () => {
  const t = gal({ behavior: "IO14 = NOSUCH\n" });
  assert.equal(galDefinitionErrors(t), galDefinitionErrors(t));
});

// --- the design-level refusal (FR-066m) ---

test("designDefinitionErrors names root parts, sub-design instances, and peer sheets", () => {
  const bad = gal({ loadErrors: ["broken"] });
  const good = gal();
  const root = {
    components: [
      { refdes: "U6", typeData: bad },
      { refdes: "U7", typeData: good },
      { refdes: "X1", kind: "subdesign", label: "ALU" },
      { refdes: "X2", kind: "subdesign" },
    ],
  };
  const flat = {
    components: [
      { refdes: "U6", typeData: bad },
      { refdes: "U7", typeData: good },
      { refdes: "U8", label: "DECODE", typeData: bad },
      { refdes: "X1/U2", typeData: bad },
      { refdes: "X1/X3/U1", typeData: bad }, // two levels down: still X1
      { refdes: "X2/U2", typeData: good },
      { refdes: "peer/U1", typeData: bad },
      { refdes: "S1", typeData: { renderType: "switch" } },
    ],
  };
  assert.deepEqual(designDefinitionErrors(flat, root), { parts: ["U6", "DECODE"], subs: ["ALU"], sheets: ["peer"] });
});

test("definitionErrorsMessage words one cause as a sentence and several as a list (FR-066m)", () => {
  const none = { parts: [], subs: [], sheets: [] };
  assert.equal(definitionErrorsMessage("The design cannot be run", none), null);
  assert.equal(
    definitionErrorsMessage("The design cannot be run", { ...none, parts: ["U6"] }),
    "The design cannot be run because the definition of U6 contains errors",
  );
  assert.equal(
    definitionErrorsMessage("The design cannot be run", { ...none, subs: ["X1"] }),
    "The design cannot be run because sub-design X1 contains errors",
  );
  assert.equal(
    definitionErrorsMessage("C code cannot be generated", { parts: ["U6", "U9"], subs: ["X1"], sheets: [] }),
    "C code cannot be generated because:\n  • the definitions of U6, U9 contain errors\n  • sub-design X1 contains errors",
  );
});
