import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSimulation } from "./sim.js";
import { V0, V1, VU, VZ } from "./galasm.js";
import { BUILTINS, memDeviceType } from "../builtins.js";

// --- design fixtures (literal model shapes per §7.1a/§7.2) ---

function mkDesign() {
  return { components: [], wires: [], buses: [], vertices: [], nets: [], seq: 0 };
}

function place(d, refdes, type, overrides = {}) {
  d.components.push({
    refdes,
    // An instance records its type's id (FR-066e); ad-hoc galasm fixtures here
    // carry no id and fall back to name (typeIdentity), while built-ins use id.
    type: type.id ?? type.name,
    x: 0,
    y: 0,
    rotation: 0,
    typeData: structuredClone(type),
    overrides,
  });
}

// connect wires pin A to pin B through two pin vertices and one wire.
function connect(d, [refA, pinA], [refB, pinB]) {
  const va = { id: `v${++d.seq}`, kind: "pin", ref: refA, pin: pinA, x: 0, y: 0 };
  const vb = { id: `v${++d.seq}`, kind: "pin", ref: refB, pin: pinB, x: 0, y: 0 };
  d.vertices.push(va, vb);
  const id = `w${++d.seq}`;
  d.wires.push({ id, path: [{ t: "node", v: va.id }, { t: "node", v: vb.id }] });
  return id;
}

const builtin = (name) => BUILTINS.find((b) => b.name === name);

// NOT: one inverter as a unit-rendered type.
const NOT = {
  name: "NOTX",
  renderType: "unit",
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "out" },
  ],
  behavior: "Y = /A\n",
};

// CONST1 / CONST0: always-driving constant outputs.
const CONST1 = {
  name: "ONE",
  renderType: "unit",
  pins: [{ name: "Y", side: "right", position: 1, direction: "out" }],
  behavior: "Y = VCC\n",
};
const CONST0 = {
  name: "ZERO",
  renderType: "unit",
  pins: [{ name: "Y", side: "right", position: 1, direction: "out" }],
  behavior: "Y = GND\n",
};

// DFF: registered output with declared clock and async reset input.
const DFF = {
  name: "DFFX",
  renderType: "unit",
  clock: "CP",
  pins: [
    { name: "D", side: "left", position: 1, direction: "in" },
    { name: "CP", side: "left", position: 2, direction: "in" },
    { name: "Q", side: "right", position: 1, direction: "out" },
  ],
  behavior: "Q.R = D\n",
};

// stepUntilSettled steps until a step changes nothing; returns steps taken.
function settle(sim, bound = 100) {
  for (let i = 1; i <= bound; i++) {
    sim.step();
    if (!sim.lastStepChanged()) return i;
  }
  throw new Error("did not settle");
}

test("unit delay: an N-inverter chain ripples one level per step (FR-078)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "U1", NOT);
  place(d, "U2", NOT);
  place(d, "U3", NOT);
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["U1", "A"]);
  connect(d, ["U1", "Y"], ["U2", "A"]);
  connect(d, ["U2", "Y"], ["U3", "A"]);
  connect(d, ["U3", "Y"], ["A-2", "IN"]); // a pin only joins a net when wired

  const sim = buildSimulation(d);
  // t0: everything Z (uninitialized).
  assert.equal(sim.valueOfPin("U1", "A"), VZ);

  sim.step(); // step 1: pull-up resolves; inverters read Z → U
  assert.equal(sim.valueOfPin("U1", "A"), V1);
  assert.equal(sim.valueOfPin("U1", "Y"), VU);

  sim.step(); // step 2: U1 saw 1 → drives 0
  assert.equal(sim.valueOfPin("U1", "Y"), V0);
  assert.equal(sim.valueOfPin("U2", "Y"), VU);

  sim.step(); // step 3: U2 saw 0 → drives 1
  assert.equal(sim.valueOfPin("U2", "Y"), V1);

  sim.step(); // step 4: U3 saw 1 → drives 0
  assert.equal(sim.valueOfPin("U3", "Y"), V0);

  sim.step(); // step 5: nothing changes — settled
  assert.equal(sim.lastStepChanged(), false);
  assert.equal(sim.hasClocks(), false);
});

test("bus conflict: 0-vs-1 strong drivers → U, flagged conductors, one report (FR-082)", () => {
  const d = mkDesign();
  place(d, "U1", CONST1);
  place(d, "U2", CONST0);
  const wid = connect(d, ["U1", "Y"], ["U2", "Y"]);

  const messages = [];
  const sim = buildSimulation(d, { onMessage: (m) => messages.push(m) });
  sim.step();
  assert.equal(sim.valueOfPin("U1", "Y"), VU);
  assert.ok(sim.conflictedConductors().has(wid));
  sim.step();
  sim.step();
  // Reported once on onset, not every step.
  const conflicts = messages.filter((m) => m.includes("bus conflict"));
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0], /U[12]\.Y vs U[12]\.Y/);
});

test("weak drivers: pull-up resolves an undriven net, loses to strong, conflicts with pull-down (FR-083)", () => {
  // Pull-up alone.
  let d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);
  let sim = buildSimulation(d);
  sim.step();
  assert.equal(sim.valueOfPin("A-2", "IN"), V1);

  // Strong 0 overrides the pull-up silently.
  d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "U1", CONST0);
  connect(d, ["A-1", "OUT"], ["U1", "Y"]);
  const messages = [];
  sim = buildSimulation(d, { onMessage: (m) => messages.push(m) });
  sim.step();
  assert.equal(sim.valueOfPin("U1", "Y"), V0);
  assert.equal(messages.filter((m) => m.includes("conflict")).length, 0);

  // Pull-up + pull-down with no strong driver → conflict.
  d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "A-2", builtin("pulldown"));
  connect(d, ["A-1", "OUT"], ["A-2", "OUT"]);
  sim = buildSimulation(d, { onMessage: (m) => messages.push(m) });
  sim.step();
  assert.equal(sim.valueOfPin("A-1", "OUT"), VU);
  assert.equal(messages.filter((m) => m.includes("conflict")).length, 1);
});

test("clock waveform: low first half-period, rising edge at period/2 (FR-084)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("clock"), { props: { period: 4 } });
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);

  const sim = buildSimulation(d);
  // The clock evaluates waveform(simTime) into the *next* step's value
  // (unit delay), so the net at time t+1 shows waveform(t): 0 0 1 1 0 0 1 1 …
  const seen = [];
  for (let i = 0; i < 8; i++) {
    sim.step();
    seen.push(sim.valueOfPin("A-2", "IN"));
  }
  assert.deepEqual(seen, [V0, V0, V1, V1, V0, V0, V1, V1]);
  assert.equal(sim.hasClocks(), true);
  assert.equal(sim.unitsPerSecond(), 4 * 1); // period × speed (default speed 1)
});

test("power-on reset: asserted for cycles × clock period, then released (FR-071b)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("clock"), { props: { period: 4 } });
  place(d, "A-2", builtin("reset"), { props: { cycles: 1 } });
  place(d, "A-3", builtin("indicator"));
  place(d, "A-4", builtin("indicator"));
  connect(d, ["A-2", "R"], ["A-3", "IN"]);
  connect(d, ["A-2", "/R"], ["A-4", "IN"]);

  const sim = buildSimulation(d);
  // clockPeriod = 4 (the single clock's effective period), so the reset spans
  // simTime 0..3. Unit delay: the net at step t shows behave(t-1), so R
  // reads 1 at steps 1..4 and 0 from step 5; /R is the inverse throughout.
  const rst = [];
  const rstL = [];
  for (let i = 0; i < 6; i++) {
    sim.step();
    rst.push(sim.valueOfPin("A-3", "IN"));
    rstL.push(sim.valueOfPin("A-4", "IN"));
  }
  assert.deepEqual(rst, [V1, V1, V1, V1, V0, V0]);
  assert.deepEqual(rstL, [V0, V0, V0, V0, V1, V1]);
});

test("power-on reset: no clock placed → 100 ns default period (FR-071b)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("reset"), {}); // default cycles = 3 → 300 units
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "R"], ["A-2", "IN"]);

  const sim = buildSimulation(d);
  for (let i = 0; i < 20; i++) sim.step();
  assert.equal(sim.valueOfPin("A-2", "IN"), V1); // still held at step 20
});

test("registered output: latches D on the rising clock edge only (FR-079)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("clock"), { props: { period: 4 } });
  place(d, "A-2", builtin("pullup"));
  place(d, "A-3", builtin("indicator"));
  place(d, "U1", DFF);
  connect(d, ["A-1", "OUT"], ["U1", "CP"]);
  connect(d, ["A-2", "OUT"], ["U1", "D"]);
  connect(d, ["U1", "Q"], ["A-3", "IN"]); // Q must be wired to be observable

  const sim = buildSimulation(d);
  // Clock net: 0 0 1 1 0 0 1 1 (from the previous test). D net: 1 from step 1.
  // The first 0→1 of the clock net happens entering step 3; Q (register) is U
  // until then, and presents the latched 1 one unit after the edge.
  sim.step();
  sim.step();
  assert.equal(sim.valueOfPin("U1", "Q"), VU); // powered up U
  sim.step(); // clock net now 1; edge seen during the *next* step's latch phase
  sim.step();
  assert.equal(sim.valueOfPin("U1", "Q"), V1); // latched and presented
  // Stays 1 across the clock's low phase (no edge).
  sim.step();
  sim.step();
  assert.equal(sim.valueOfPin("U1", "Q"), V1);
});

test("behavior-less type drives U and is reported once (FR-080)", () => {
  const NOBEHAV = {
    name: "MYSTERY",
    renderType: "unit",
    pins: [
      { name: "A", side: "left", position: 1, direction: "in" },
      { name: "Y", side: "right", position: 1, direction: "out" },
    ],
  };
  const d = mkDesign();
  place(d, "U1", NOBEHAV);
  place(d, "U2", NOBEHAV);
  place(d, "A-1", builtin("pullup"));
  connect(d, ["U1", "Y"], ["A-1", "OUT"]);

  const messages = [];
  const sim = buildSimulation(d, { onMessage: (m) => messages.push(m) });
  sim.step();
  // The behavior-less strong U beats the weak pull-up.
  assert.equal(sim.valueOfPin("U1", "Y"), VU);
  assert.equal(messages.filter((m) => m.includes("no behavior")).length, 1); // once per type
});

test("preflight: .R without clock: refuses to start (FR-062d)", () => {
  const BADDFF = { ...structuredClone(DFF), clock: undefined };
  const d = mkDesign();
  place(d, "U1", BADDFF);
  assert.throws(() => buildSimulation(d), /uses \.R but the type declares no clock/);
});

test("preflight: behavior parse error refuses to start", () => {
  const BAD = {
    name: "BADX",
    renderType: "unit",
    pins: [{ name: "Y", side: "right", position: 1, direction: "out" }],
    behavior: "Y = NOSUCH\n",
  };
  const d = mkDesign();
  place(d, "U1", BAD);
  assert.throws(() => buildSimulation(d), /unknown signal NOSUCH/);
});

test("subunit package: siblings evaluate as one entity (§6.13)", () => {
  // A 7400-style dual NAND package: each sibling carries only its unit's pins,
  // but the shared behavior block names both units' pins.
  const PKG = {
    name: "NANDPKG",
    renderType: "subunit",
    numUnits: 2,
    renderAs: "nand",
    pins: [
      { name: "1A", side: "left", unit: "A", direction: "in" },
      { name: "1B", side: "left", unit: "A", direction: "in" },
      { name: "1Y", side: "right", unit: "A", direction: "out" },
      { name: "2A", side: "left", unit: "B", direction: "in" },
      { name: "2B", side: "left", unit: "B", direction: "in" },
      { name: "2Y", side: "right", unit: "B", direction: "out" },
    ],
    behavior: "1Y = /1A + /1B\n2Y = /2A + /2B\n",
  };
  const d = mkDesign();
  for (const letter of ["A", "B"]) {
    const td = structuredClone(PKG);
    td.pins = td.pins.filter((p) => p.unit === letter);
    td.unit = letter;
    d.components.push({
      refdes: "U1" + letter,
      type: PKG.name,
      x: 0,
      y: 0,
      rotation: 0,
      typeData: td,
      overrides: {},
    });
  }
  place(d, "A-1", builtin("pullup"));
  place(d, "A-2", builtin("pullup"));
  place(d, "A-3", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["U1A", "1A"]);
  connect(d, ["A-2", "OUT"], ["U1A", "1B"]);
  // Cross-unit wiring: gate A's output feeds both inputs of gate B.
  connect(d, ["U1A", "1Y"], ["U1B", "2A"]);
  connect(d, ["U1A", "1Y"], ["U1B", "2B"]);
  connect(d, ["U1B", "2Y"], ["A-3", "IN"]);

  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("U1A", "1Y"), V0); // NAND(1,1) = 0
  assert.equal(sim.valueOfPin("U1B", "2Y"), V1); // NAND(0,0) = 1
});

test("feedback loop settles to U (FR-077)", () => {
  // A ring oscillator cannot oscillate from a cold start: every net begins
  // Z/U, and an inverter of U is U even under selective pessimism (no
  // constant operand decides it) — the loop settles with the net at U rather
  // than toggling. (Real oscillation needs a definite initial value, which
  // only a clock or a reset path can inject, so the FR-085 settling bound is
  // defensive rather than load-bearing.)
  const d = mkDesign();
  place(d, "U1", NOT);
  connect(d, ["U1", "Y"], ["U1", "A"]); // feedback: Y → A
  const sim = buildSimulation(d);
  assert.ok(settle(sim) <= 3);
  assert.equal(sim.valueOfPin("U1", "Y"), VU);
});

test("unconnected pins read Z (treated as U by behaviors)", () => {
  const d = mkDesign();
  place(d, "U1", NOT); // input A unconnected
  const sim = buildSimulation(d);
  sim.step();
  assert.equal(sim.valueOfPin("U1", "A"), VZ); // not part of any net
  assert.equal(sim.valueOfPin("U1", "Y"), VZ); // output unconnected too
});

// --- generated memory devices (FR-114c/FR-114d) ---

const RAM4 = () => memDeviceType({ name: "TESTRAM", kind: "ram", addressBits: 2, dataWidth: 4, locations: 4 });

test("a deselected RAM (CE/ high) tristates its data bus (FR-114d)", () => {
  const d = mkDesign();
  place(d, "U1", RAM4());
  place(d, "U2", CONST1); // drives CE/ high → deselected
  place(d, "U3", NOT); // gives D0 an observable net
  connect(d, ["U2", "Y"], ["U1", "CE/"]);
  connect(d, ["U1", "D0"], ["U3", "A"]);

  const sim = buildSimulation(d);
  settle(sim);
  // Deselected → the memory drives nothing, so D0's net is high-impedance (Z),
  // not U — proving the memory entity path (a behavior-less type would instead
  // drive U on its non-input pins, FR-080).
  assert.equal(sim.valueOfPin("U1", "D0"), VZ);
});

test("a selected RAM read of an unwritten cell drives U (FR-114d)", () => {
  const d = mkDesign();
  place(d, "U1", RAM4());
  place(d, "Z1", CONST0); // CE/=0 selected
  place(d, "Z2", CONST0); // OE/=0 output enabled
  place(d, "O1", CONST1); // WE/=1 (reading, not writing)
  place(d, "Z3", CONST0); // A0=0
  place(d, "Z4", CONST0); // A1=0
  place(d, "U2", NOT); // observe D0
  connect(d, ["Z1", "Y"], ["U1", "CE/"]);
  connect(d, ["Z2", "Y"], ["U1", "OE/"]);
  connect(d, ["O1", "Y"], ["U1", "WE/"]);
  connect(d, ["Z3", "Y"], ["U1", "A0"]);
  connect(d, ["Z4", "Y"], ["U1", "A1"]);
  connect(d, ["U1", "D0"], ["U2", "A"]);

  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("U1", "D0"), VU); // address 0 unwritten → U
});

const ROM4 = () =>
  memDeviceType({ name: "TESTROM", kind: "rom", addressBits: 2, dataWidth: 4, locations: 4, romFile: "/x/y.bin" });

test("a ROM seeded with content drives the loaded word on read (FR-114e)", () => {
  const d = mkDesign();
  place(d, "U1", ROM4());
  place(d, "Z1", CONST0); // CE/=0 selected
  place(d, "Z2", CONST0); // OE/=0 output enabled
  place(d, "Z3", CONST0); // A0=0
  place(d, "Z4", CONST0); // A1=0
  place(d, "U2", NOT); // observe D0
  connect(d, ["Z1", "Y"], ["U1", "CE/"]);
  connect(d, ["Z2", "Y"], ["U1", "OE/"]);
  connect(d, ["Z3", "Y"], ["U1", "A0"]);
  connect(d, ["Z4", "Y"], ["U1", "A1"]);
  connect(d, ["U1", "D0"], ["U2", "A"]);

  // loc0 = low nibble of 0x05 = 0b0101 → D0=1, D1=0, D2=1, D3=0.
  const romContent = new Map([["/x/y.bin", Uint8Array.from([0x05])]]);
  const sim = buildSimulation(d, { romContent });
  settle(sim);
  assert.equal(sim.valueOfPin("U1", "D0"), V1);
});

test("external stimulus strong-drives a net by (refdes, pin) (FR-115f)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("port"));
  place(d, "U1", NOT);
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "P"], ["U1", "A"]); // port pin shares U1's input net
  connect(d, ["U1", "Y"], ["A-2", "IN"]); // observe U1.Y on a net

  const sim = buildSimulation(d, { stimulus: [{ refdes: "A-1", pin: "P", value: V1 }] });
  settle(sim);
  // The forced net reads back through the port's own pin and inverts at U1.
  assert.equal(sim.valueOfPin("A-1", "P"), V1);
  assert.equal(sim.valueOfPin("U1", "Y"), V0);
});
