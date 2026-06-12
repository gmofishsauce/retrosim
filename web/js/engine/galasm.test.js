import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compileBehavior,
  evalTerm,
  evalSum,
  evalOutput,
  updateRegisters,
  V0,
  V1,
  VU,
  VZ,
} from "./galasm.js";

// ty builds a minimal typeData with the given pins and behavior text.
function ty(pins, behavior) {
  return {
    name: "TT",
    pins: pins.map(([name, direction]) => ({ name, direction })),
    behavior,
  };
}

const lit = (signal, low = false) => ({ signal, low });

test("compileBehavior returns null when the type has no behavior block (FR-080)", () => {
  assert.equal(compileBehavior(ty([["A", "in"]], undefined)), null);
  assert.equal(compileBehavior(ty([["A", "in"]], "")), null);
});

test("74138-style plain output: physical-level polarity, comments, multi-term AND", () => {
  const c = compileBehavior(
    ty(
      [
        ["A0", "in"],
        ["/E1", "in"],
        ["E3", "in"],
        ["/Y0", "out"],
      ],
      "; header comment\n/Y0 = /E1 * E3 * /A0  ; trailing comment\n",
    ),
  );
  assert.equal(c.outputs.length, 1);
  const out = c.outputs[0];
  assert.equal(out.signal, "Y0");
  assert.equal(out.pin, "/Y0"); // YAML pin name retained for driver mapping
  assert.equal(out.kind, "plain");
  assert.equal(out.lhsLow, true); // /Y0 = term drives the pin LOW when true
  assert.equal(out.enable, null);
  // /E1 → E1 reads LOW; E3 → reads HIGH; /A0 → reads LOW.
  assert.deepEqual(out.terms, [[lit("E1", true), lit("E3"), lit("A0", true)]]);
  assert.equal(c.ar, null);
  assert.equal(c.sp, null);
});

test("sum of products: + separates terms, * binds within a term; multi-line equations", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["C", "in"],
        ["Y", "out"],
      ],
      "Y =   A * /B\n  + /A *  C\n",
    ),
  );
  assert.deepEqual(c.outputs[0].terms, [
    [lit("A"), lit("B", true)],
    [lit("A", true), lit("C")],
  ]);
});

test("alternate operator spellings & # ! parse identically (manual §2)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["Y", "out"],
      ],
      "Y = A & !B # !A & B\n",
    ),
  );
  assert.deepEqual(c.outputs[0].terms, [
    [lit("A"), lit("B", true)],
    [lit("A", true), lit("B")],
  ]);
});

test("74245-style .T with single-term .E enable (bidir pins)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A0", "bidir"],
        ["B0", "bidir"],
        ["/OE", "in"],
        ["DIR", "in"],
      ],
      "B0.T = A0\nB0.E = /OE * DIR\nA0.T = B0\nA0.E = /OE * /DIR\n",
    ),
  );
  assert.equal(c.outputs.length, 2);
  assert.equal(c.outputs[0].kind, "T");
  assert.deepEqual(c.outputs[0].enable, [lit("OE", true), lit("DIR")]);
  assert.deepEqual(c.outputs[1].enable, [lit("OE", true), lit("DIR", true)]);
});

test("74574-style registered outputs: .R with .E; tristate LHS allowed", () => {
  const c = compileBehavior(
    ty(
      [
        ["D0", "in"],
        ["Q0", "tristate"],
        ["/OE", "in"],
      ],
      "Q0.R = D0\nQ0.E = /OE\n",
    ),
  );
  const out = c.outputs[0];
  assert.equal(out.kind, "R");
  assert.equal(out.lhsLow, false);
  assert.deepEqual(out.terms, [[lit("D0")]]);
  assert.deepEqual(out.enable, [lit("OE", true)]);
});

test("AR and SP: single term, recorded separately (manual §3.6)", () => {
  const c = compileBehavior(
    ty(
      [
        ["D", "in"],
        ["RST", "in"],
        ["PRE", "in"],
        ["Q", "out"],
      ],
      "Q.R = D\nAR = RST\nSP = PRE * /RST\n",
    ),
  );
  assert.deepEqual(c.ar, [lit("RST")]);
  assert.deepEqual(c.sp, [lit("PRE"), lit("RST", true)]);
});

test("VCC/GND constants: empty product / empty sum (manual §3.7)", () => {
  const pins = [["Y", "out"], ["Z", "out"]];
  const c = compileBehavior(ty(pins, "Y = VCC\nZ = GND\n"));
  assert.deepEqual(c.outputs[0].terms, [[]]); // always true
  assert.deepEqual(c.outputs[1].terms, []); // always false
});

test("validation errors (language rules)", () => {
  const pins = [
    ["A", "in"],
    ["B", "in"],
    ["Y", "out"],
    ["Q", "tristate"],
  ];
  const bad = [
    ["Y = X\n", "unknown signal X"],
    ["X = A\n", "unknown signal X"],
    ["A = B\n", "not an output-capable pin"],
    ["Y = A\nY = B\n", "two output equations for Y"],
    ["Y.E = A\n", ".E for Y before its output equation"],
    ["Y = A\nY.E = B\n", ".E on plain output Y"],
    ["Q.T = A\nQ.E = A\nQ.E = B\n", "two .E equations for Q"],
    ["Q.T = A\n/Q.E = B\n", ".E left-hand side for Q may not be negated"],
    ["Q.T = A\nQ.E = A + B\n", ".E for Q takes exactly one product term"],
    ["Y.X = A\n", "unknown suffix .X"],
    ["Y.CLK = A\n", "unknown suffix .CLK"],
    ["AR = A + B\n", "AR takes exactly one product term"],
    ["Y.R = A\nAR = A\nAR = B\n", "AR defined twice"],
    ["/AR = A\n", "AR may not be negated"],
    ["Y = AR\n", "AR may not be used on a right-hand side"],
    ["Y = /VCC\n", "/VCC is not allowed"],
    ["Y = VCC * A\n", "VCC may not be combined with operators"],
    ["Y = A * GND\n", "GND may not be combined with operators"],
    ["Y A\n", "expected = after Y"],
    ["; only comments\n", "no equations found"],
    ["Y = A @ B\n", "illegal character"],
    ["Y = ABCDEFGHI\n", "longer than 8 characters"],
  ];
  for (const [behavior, wantSub] of bad) {
    assert.throws(
      () => compileBehavior(ty(pins, behavior)),
      (e) => e.message.includes(wantSub),
      `behavior ${JSON.stringify(behavior)}: expected error containing ${JSON.stringify(wantSub)}`,
    );
  }
});

test("reserved pin names are rejected (manual §2)", () => {
  assert.throws(
    () => compileBehavior(ty([["AR", "in"], ["Y", "out"]], "Y = VCC\n")),
    /pin name AR is reserved/,
  );
});

// nets(map) builds a readNet over a plain object of signal → value.
const nets = (m) => (signal) => m[signal];

test("selective pessimism: 0 AND x = 0, 1 OR x = 1, other U combinations U (FR-077)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["Y", "out"],
      ],
      "Y = A * B + B\n",
    ),
  );
  const [out] = c.outputs;
  // 0 AND U = 0: B=0 decides the product despite A=U.
  assert.equal(evalTerm(out.terms[0], nets({ A: VU, B: V0 })), V0);
  // 1 OR U = 1: term2 (B=1) decides the sum despite term1 being U.
  assert.equal(evalSum(out.terms, nets({ A: VU, B: V1 })), V1);
  // 1 AND U = U; 0 OR U = U (A=0 forces term1 to 0, B=U leaves term2 U).
  assert.equal(evalTerm(out.terms[0], nets({ A: VU, B: V1 })), VU);
  assert.equal(evalSum(out.terms, nets({ A: V0, B: VU })), VU);
  // Z reads as U (FR-077): B=Z makes both terms U, so the sum is U.
  assert.equal(evalOutput(out, nets({ A: V1, B: VZ }), null), VU);
  // No U anywhere: ordinary logic.
  assert.equal(evalOutput(out, nets({ A: V1, B: V1 }), null), V1);
  assert.equal(evalOutput(out, nets({ A: V0, B: V0 }), null), V0);
});

test("74163 regression: a held clear/load rescues all-U registers (FR-077)", () => {
  // The QA (LSB) equation from srv/components/74163.yaml: every product term
  // carries CLR, and the count/hold terms carry registered feedback. Under
  // strict pessimism 0 AND U = U kept the register U forever; selective
  // pessimism lets the held clear (or load) decide.
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["/CLR", "in"],
        ["/LOAD", "in"],
        ["ENP", "in"],
        ["ENT", "in"],
        ["QA", "out"],
      ],
      "QA.R = CLR * /LOAD * A + CLR * LOAD * ENP * ENT * /QA" +
        " + CLR * LOAD * /ENP * QA + CLR * LOAD * /ENT * QA\n",
    ),
  );
  // Held synchronous clear (pin /CLR LOW): every term is 0 despite QA = U.
  const registers = new Map([["QA", VU]]);
  const clearing = nets({ CLR: V0, LOAD: V1, ENP: V1, ENT: V1, A: VU, QA: VU });
  updateRegisters(c, clearing, registers, true);
  assert.equal(registers.get("QA"), V0);
  // Held synchronous load (pin /LOAD LOW) of a 1 from all-U likewise.
  registers.set("QA", VU);
  const loading = nets({ CLR: V1, LOAD: V0, ENP: VU, ENT: VU, A: V1, QA: VU });
  updateRegisters(c, loading, registers, true);
  assert.equal(registers.get("QA"), V1);
  // Counting from a defined state still works: QA toggles 0 -> 1.
  const counting = nets({ CLR: V1, LOAD: V1, ENP: V1, ENT: V1, A: V0, QA: V0 });
  updateRegisters(c, counting, registers, true);
  assert.equal(registers.get("QA"), V1);
});

test("74138 row check: physical-level output polarity (FR-079)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A0", "in"],
        ["/E1", "in"],
        ["E3", "in"],
        ["/Y0", "out"],
        ["/Y1", "out"],
      ],
      "/Y0 = /E1 * E3 * /A0\n/Y1 = /E1 * E3 * A0\n",
    ),
  );
  const [y0, y1] = c.outputs;
  // Enabled (pin /E1 LOW, E3 HIGH), address 0: Y0 LOW, Y1 HIGH.
  const enabled0 = nets({ E1: V0, E3: V1, A0: V0 });
  assert.equal(evalOutput(y0, enabled0, null), V0);
  assert.equal(evalOutput(y1, enabled0, null), V1);
  // Disabled (pin /E1 HIGH): both outputs HIGH (the function table's
  // disabled rows fall out of the same equations).
  const disabled = nets({ E1: V1, E3: V1, A0: V0 });
  assert.equal(evalOutput(y0, disabled, null), V1);
  assert.equal(evalOutput(y1, disabled, null), V1);
});

test("VCC/GND outputs honor LHS polarity", () => {
  const c = compileBehavior(
    ty(
      [
        ["Y", "out"],
        ["/W", "out"],
        ["Z", "out"],
      ],
      "Y = VCC\n/W = VCC\nZ = GND\n",
    ),
  );
  const r = nets({});
  assert.equal(evalOutput(c.outputs[0], r, null), V1); // Y = VCC → high
  assert.equal(evalOutput(c.outputs[1], r, null), V0); // /W = VCC → low
  assert.equal(evalOutput(c.outputs[2], r, null), V0); // Z = GND → low
});

test(".T enable gating: false → Z, U → U, true → driven (FR-079)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["/OE", "in"],
        ["B", "tristate"],
      ],
      "B.T = A\nB.E = /OE\n",
    ),
  );
  const [out] = c.outputs;
  assert.equal(evalOutput(out, nets({ A: V1, OE: V1 }), null), VZ); // disabled
  assert.equal(evalOutput(out, nets({ A: V1, OE: VU }), null), VU); // uncertain enable
  assert.equal(evalOutput(out, nets({ A: V1, OE: V0 }), null), V1); // driven
  assert.equal(evalOutput(out, nets({ A: V0, OE: V0 }), null), V0);
});

test(".R presents the register, not the sum; registers power up U (FR-079)", () => {
  const c = compileBehavior(
    ty(
      [
        ["D", "in"],
        ["Q", "out"],
        ["/QB", "out"],
      ],
      "Q.R = D\n/QB.R = D\n",
    ),
  );
  const registers = new Map([["Q", VU], ["QB", VU]]);
  const r = nets({ D: V1 });
  assert.equal(evalOutput(c.outputs[0], r, registers), VU); // powered up U
  registers.set("Q", V1);
  registers.set("QB", V1);
  assert.equal(evalOutput(c.outputs[0], r, registers), V1); // Q presents register
  assert.equal(evalOutput(c.outputs[1], r, registers), V0); // /QB inverts it
});

test("updateRegisters: latch on rising edge only; AR/SP semantics (FR-079)", () => {
  const c = compileBehavior(
    ty(
      [
        ["D", "in"],
        ["RST", "in"],
        ["PRE", "in"],
        ["Q", "out"],
      ],
      "Q.R = D\nAR = RST\nSP = PRE\n",
    ),
  );
  const registers = new Map([["Q", VU]]);

  // No edge: register unchanged regardless of D.
  updateRegisters(c, nets({ D: V1, RST: V0, PRE: V0 }), registers, false);
  assert.equal(registers.get("Q"), VU);

  // Rising edge: D latched.
  updateRegisters(c, nets({ D: V1, RST: V0, PRE: V0 }), registers, true);
  assert.equal(registers.get("Q"), V1);

  // Edge with D = U latches U.
  updateRegisters(c, nets({ D: VU, RST: V0, PRE: V0 }), registers, true);
  assert.equal(registers.get("Q"), VU);

  // SP true at an edge sets, overriding D.
  updateRegisters(c, nets({ D: V0, RST: V0, PRE: V1 }), registers, true);
  assert.equal(registers.get("Q"), V1);

  // AR is asynchronous: resets with no edge, and overrides an edge's latch.
  updateRegisters(c, nets({ D: V1, RST: V1, PRE: V0 }), registers, false);
  assert.equal(registers.get("Q"), V0);
  updateRegisters(c, nets({ D: V1, RST: V1, PRE: V0 }), registers, true);
  assert.equal(registers.get("Q"), V0);

  // AR = U forces registers U (pessimistic).
  updateRegisters(c, nets({ D: V1, RST: VU, PRE: V0 }), registers, false);
  assert.equal(registers.get("Q"), VU);
});

test("the real 74138 and 74574 behavior blocks compile", () => {
  // Abbreviated but structurally identical to srv/components/*.yaml.
  const c138 = compileBehavior(
    ty(
      [
        ["A0", "in"],
        ["A1", "in"],
        ["A2", "in"],
        ["/E1", "in"],
        ["/E2", "in"],
        ["E3", "in"],
        ["/Y0", "out"],
        ["/Y1", "out"],
      ],
      "/Y0 = /E1 * /E2 * E3 * /A2 * /A1 * /A0\n/Y1 = /E1 * /E2 * E3 * /A2 * /A1 *  A0\n",
    ),
  );
  assert.equal(c138.outputs.length, 2);
  assert.ok(c138.outputs.every((o) => o.kind === "plain" && o.lhsLow));

  const c574 = compileBehavior(
    ty(
      [
        ["D0", "in"],
        ["D1", "in"],
        ["Q0", "tristate"],
        ["Q1", "tristate"],
        ["CP", "in"],
        ["/OE", "in"],
      ],
      "Q0.R = D0\nQ0.E = /OE\nQ1.R = D1\nQ1.E = /OE\n",
    ),
  );
  assert.equal(c574.outputs.length, 2);
  assert.ok(c574.outputs.every((o) => o.kind === "R" && o.enable !== null));
});
