import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compileBehavior,
  evalTerm,
  evalSum,
  evalCombinational,
  evalOutput,
  updateRegisters,
  V0,
  V1,
  VU,
  VZ,
} from "./galasm.js";

// ty builds a minimal typeData with the given pins and behavior text. An
// optional `gal` device name selects strict validation (FR-079b).
function ty(pins, behavior, gal) {
  return {
    name: "TT",
    pins: pins.map(([name, direction]) => ({ name, direction })),
    behavior,
    ...(gal ? { gal } : {}),
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
    ["Y.CLK = A\n", ".CLK for Y before its output equation"],
    ["Y.CLK = A\nY = B\n", ".CLK for Y before its output equation"],
    ["Q.T = A\nQ.CLK = B\n", ".CLK on Q requires a registered (.R) output"],
    ["Q.R = A\nQ.CLK = A + B\n", ".CLK for Q takes exactly one product term"],
    ["Q.R = A\nQ.CLK = B\nQ.CLK = A\n", "two .CLK equations for Q"],
    ["Q.R = A\n/Q.ARST = B\n", ".ARST left-hand side for Q may not be negated"],
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

test("XOR operator :+: compiles to xor groups; plain output has empty xor (FR-079a)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["C", "in"],
        ["S", "out"],
        ["Y", "out"],
      ],
      "S = A * B :+: C\nY = A * B\n",
    ),
  );
  const [s, y] = c.outputs;
  // S = (A*B) XOR (C): terms is the first SOP group, xor holds the rest.
  assert.deepEqual(s.terms, [[lit("A"), lit("B")]]);
  assert.deepEqual(s.xor, [[[lit("C")]]]);
  // A plain output carries an empty xor list.
  assert.deepEqual(y.xor, []);
});

test("XOR evaluation: truth table and U pessimism (no controlling value) (FR-079a)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["Y", "out"],
      ],
      "Y = A :+: B\n",
    ),
  );
  const [out] = c.outputs;
  const at = (A, B) => evalCombinational(out, nets({ A, B }));
  assert.equal(at(V0, V0), V0);
  assert.equal(at(V1, V0), V1);
  assert.equal(at(V0, V1), V1);
  assert.equal(at(V1, V1), V0);
  // XOR has no controlling value: any U operand yields U.
  assert.equal(at(VU, V0), VU);
  assert.equal(at(V1, VU), VU);
  // Through evalOutput (xorLow identity here): same results.
  assert.equal(evalOutput(out, nets({ A: V1, B: V0 }), null), V1);
});

test("adder sum bit: chained XOR S = A :+: B :+: CIN (FR-079a, 74HC283)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["CIN", "in"],
        ["S", "out"],
      ],
      "S = A :+: B :+: CIN\n",
    ),
  );
  const [s] = c.outputs;
  assert.equal(s.xor.length, 2);
  const sum = (A, B, CIN) => evalCombinational(s, nets({ A, B, CIN }));
  assert.equal(sum(V0, V0, V0), V0);
  assert.equal(sum(V1, V0, V0), V1);
  assert.equal(sum(V1, V1, V0), V0);
  assert.equal(sum(V1, V1, V1), V1);
});

test("XOR in a registered D input latches the XOR (FR-079a)", () => {
  const c = compileBehavior(
    ty(
      [
        ["A", "in"],
        ["B", "in"],
        ["Q", "out"],
      ],
      "Q.R = A :+: B\n",
    ),
  );
  const registers = new Map([["Q", VU]]);
  updateRegisters(c, nets({ A: V1, B: V0 }), registers, true);
  assert.equal(registers.get("Q"), V1);
  updateRegisters(c, nets({ A: V1, B: V1 }), registers, true);
  assert.equal(registers.get("Q"), V0);
});

test("XOR rejected on AR/SP and .E (FR-079a single-term constructs)", () => {
  const pins = [
    ["A", "in"],
    ["B", "in"],
    ["Q", "tristate"],
  ];
  for (const [behavior, sub] of [
    ["Q.R = A\nAR = A :+: B\n", "AR may not use XOR"],
    ["Q.R = A\nSP = A :+: B\n", "SP may not use XOR"],
    ["Q.T = A\nQ.E = A :+: B\n", "may not use XOR"],
    ["Y = A : B\n", "illegal character"],
  ]) {
    assert.throws(
      () => compileBehavior(ty([...pins, ["Y", "out"]], behavior)),
      (e) => e.message.includes(sub),
      `behavior ${JSON.stringify(behavior)}: expected ${JSON.stringify(sub)}`,
    );
  }
});

test("per-output .CLK: independent clock domains (FR-079a, 74HC74-style)", () => {
  const c = compileBehavior(
    ty(
      [
        ["D1", "in"],
        ["CP1", "in"],
        ["Q1", "out"],
        ["D2", "in"],
        ["CP2", "in"],
        ["Q2", "out"],
      ],
      "Q1.R = D1\nQ1.CLK = CP1\nQ2.R = D2\nQ2.CLK = CP2\n",
    ),
  );
  const [q1, q2] = c.outputs;
  assert.deepEqual(q1.clk, [lit("CP1")]);
  assert.deepEqual(q2.clk, [lit("CP2")]);

  const registers = new Map([["Q1", VU], ["Q2", VU]]);
  const clockPrev = new Map();
  const step = (m) => updateRegisters(c, nets(m), registers, false, clockPrev);

  step({ D1: V1, D2: V0, CP1: V0, CP2: V0 });
  assert.equal(registers.get("Q1"), VU); // no edge yet
  // Rising CP1 only: Q1 latches D1=1; Q2's domain untouched.
  step({ D1: V1, D2: V0, CP1: V1, CP2: V0 });
  assert.equal(registers.get("Q1"), V1);
  assert.equal(registers.get("Q2"), VU);
  // Rising CP2 only (CP1 held high → no new edge): Q2 latches D2=0; Q1 holds.
  step({ D1: V0, D2: V0, CP1: V1, CP2: V1 });
  assert.equal(registers.get("Q1"), V1);
  assert.equal(registers.get("Q2"), V0);
});

test("per-output .ARST/.APRST: async reset/preset, reset dominates (FR-079a)", () => {
  const c = compileBehavior(
    ty(
      [
        ["D", "in"],
        ["CP", "in"],
        ["CLR", "in"],
        ["PRE", "in"],
        ["Q", "out"],
      ],
      "Q.R = D\nQ.CLK = CP\nQ.ARST = CLR\nQ.APRST = PRE\n",
    ),
  );
  const registers = new Map([["Q", VU]]);
  const clockPrev = new Map();
  const step = (m) => updateRegisters(c, nets(m), registers, false, clockPrev);

  step({ D: V1, CP: V0, CLR: V0, PRE: V0 });
  // Async preset with no clock edge.
  step({ D: V0, CP: V0, CLR: V0, PRE: V1 });
  assert.equal(registers.get("Q"), V1);
  // Reset and preset both asserted: reset wins.
  step({ D: V0, CP: V0, CLR: V1, PRE: V1 });
  assert.equal(registers.get("Q"), V0);
  // Rising edge latches D with both async controls released.
  step({ D: V1, CP: V1, CLR: V0, PRE: V0 });
  assert.equal(registers.get("Q"), V1);
});

test("strict GAL22V10 accepts ordinary SOP and is identical to extended (FR-079b)", () => {
  const pins = [["A", "in"], ["B", "in"], ["Y", "out"]];
  const behavior = "Y = A * /B + /A * B\n";
  const strict = compileBehavior(ty(pins, behavior, "GAL22V10"));
  const extended = compileBehavior(ty(pins, behavior));
  // The gate never alters the compiled form.
  assert.deepEqual(strict.outputs, extended.outputs);
});

test("strict validation rejects extended-only and out-of-capacity constructs (FR-079b)", () => {
  const io = [["A", "in"], ["B", "in"], ["CP", "in"], ["Y", "out"], ["Q", "tristate"]];
  const bad = [
    // XOR is extended-only on every device.
    [io, "Y = A :+: B\n", "GAL22V10", "no XOR operator"],
    // AR/SP only on the 22V10.
    [io, "Q.R = A\nAR = B\n", "GAL16V8", "no AR/SP"],
    // Per-output .CLK only on the 20RA10.
    [io, "Q.R = A\nQ.CLK = CP\n", "GAL22V10", "no per-output .CLK"],
    // 16V8 forbids .E on a registered output.
    [io, "Q.R = A\nQ.E = B\n", "GAL16V8", "does not allow .E on the registered output"],
    // 20RA10 registered output requires a .CLK.
    [io, "Q.R = A\n", "GAL20RA10", "requires a .CLK equation"],
  ];
  for (const [pins, behavior, gal, sub] of bad) {
    assert.throws(
      () => compileBehavior(ty(pins, behavior, gal)),
      (e) => e.message.includes(sub),
      `${gal} ${JSON.stringify(behavior)}: expected ${JSON.stringify(sub)}`,
    );
  }
});

test("strict over-capacity product-term count is rejected, counted as written (FR-079b)", () => {
  // Nine single-literal terms on a GAL16V8 output (max 8 terms).
  const ins = Array.from({ length: 9 }, (_, i) => [`I${i}`, "in"]);
  const behavior = "Y = " + ins.map(([n]) => n).join(" + ") + "\n";
  assert.throws(
    () => compileBehavior(ty([...ins, ["Y", "out"]], behavior, "GAL16V8")),
    /product terms exceed GAL16V8's 8-term capacity/,
  );
  // The same equation is fine in extended mode (no capacity limit).
  assert.ok(compileBehavior(ty([...ins, ["Y", "out"]], behavior)));
});

test("strict GAL20RA10 accepts per-output .CLK/.ARST; rejects AR (FR-079b)", () => {
  const pins = [["D", "in"], ["CP", "in"], ["CLR", "in"], ["Q", "out"]];
  assert.ok(compileBehavior(ty(pins, "Q.R = D\nQ.CLK = CP\nQ.ARST = CLR\n", "GAL20RA10")));
  assert.throws(
    () => compileBehavior(ty(pins, "Q.R = D\nQ.CLK = CP\nAR = CLR\n", "GAL20RA10")),
    /no AR\/SP/,
  );
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

// tyI builds a typeData with buried internal nodes (FR-079c) and a clock.
function tyI(pins, internal, behavior) {
  return {
    name: "TT",
    clock: "CP",
    internal,
    pins: pins.map(([name, direction]) => ({ name, direction })),
    behavior,
  };
}

test("buried internal node compiles as a pinless .R output (FR-079c)", () => {
  const c = compileBehavior(
    tyI(
      [
        ["DS", "in"],
        ["CP", "in"],
        ["Q1", "out"],
      ],
      ["Q0"],
      "Q0.R = DS\nQ1.R = Q0\n",
    ),
  );
  const q0 = c.outputs.find((o) => o.signal === "Q0");
  const q1 = c.outputs.find((o) => o.signal === "Q1");
  assert.equal(q0.kind, "R");
  assert.equal(q0.pin, null); // buried: drives no pin
  assert.equal(q1.pin, "Q1"); // exposed
  // Q1's D input reads the buried node Q0 as an ordinary literal.
  assert.deepEqual(q1.terms, [[lit("Q0")]]);
});

test("a declared internal node needs exactly one .R equation (FR-079c)", () => {
  const pins = [["DS", "in"], ["CP", "in"], ["Q1", "out"]];
  // Missing definition.
  assert.throws(
    () => compileBehavior(tyI(pins, ["Q0"], "Q1.R = DS\n")),
    /internal node Q0 has no \.R equation/,
  );
  // Defined, but not registered.
  assert.throws(
    () => compileBehavior(tyI([...pins, ["X", "in"]], ["Q0"], "Q0 = X\nQ1.R = Q0\n")),
    /internal node Q0 must be defined by a registered \(\.R\) equation/,
  );
});

test("an internal node may not collide with a pin or a reserved word (FR-079c)", () => {
  assert.throws(
    () => compileBehavior(tyI([["DS", "in"], ["CP", "in"], ["Q1", "out"]], ["Q1"], "Q1.R = DS\n")),
    /internal node Q1 collides/,
  );
  assert.throws(
    () => compileBehavior(tyI([["DS", "in"], ["CP", "in"], ["Q1", "out"]], ["AR"], "Q1.R = DS\n")),
    /internal node name AR is reserved/,
  );
});

test("74165 buried-node behavior block compiles (FR-079c)", () => {
  const pins = [
    ["/PL", "in"], ["CP", "in"], ["/CE", "in"], ["DS", "in"],
    ["D0", "in"], ["D1", "in"], ["D2", "in"], ["D3", "in"],
    ["D4", "in"], ["D5", "in"], ["D6", "in"], ["D7", "in"],
    ["Q7", "out"], ["Q7N", "out"],
  ];
  const behavior =
    "SR0.R = /PL*D0 + PL*/CE*DS + PL*CE*SR0\n" +
    "SR1.R = /PL*D1 + PL*/CE*SR0 + PL*CE*SR1\n" +
    "SR2.R = /PL*D2 + PL*/CE*SR1 + PL*CE*SR2\n" +
    "SR3.R = /PL*D3 + PL*/CE*SR2 + PL*CE*SR3\n" +
    "SR4.R = /PL*D4 + PL*/CE*SR3 + PL*CE*SR4\n" +
    "SR5.R = /PL*D5 + PL*/CE*SR4 + PL*CE*SR5\n" +
    "SR6.R = /PL*D6 + PL*/CE*SR5 + PL*CE*SR6\n" +
    "Q7.R  = /PL*D7 + PL*/CE*SR6 + PL*CE*Q7\n" +
    "Q7N = /Q7\n";
  const c = compileBehavior(tyI(pins, ["SR0", "SR1", "SR2", "SR3", "SR4", "SR5", "SR6"], behavior));
  // Eight registers (seven buried + Q7) plus the combinational complement.
  assert.equal(c.outputs.filter((o) => o.kind === "R").length, 8);
  assert.equal(c.outputs.filter((o) => o.kind === "R" && o.pin === null).length, 7);
  const q7n = c.outputs.find((o) => o.signal === "Q7N");
  assert.equal(q7n.kind, "plain");
  assert.deepEqual(q7n.terms, [[lit("Q7", true)]]); // Q7N = /Q7
});
