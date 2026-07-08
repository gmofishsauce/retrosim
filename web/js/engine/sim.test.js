import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSimulation, ramFileBody } from "./sim.js";
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

test("subunit package groups under a hierarchical prefix (FR-102/§6.14)", () => {
  // A flattened child's siblings carry prefixed refdes (X1/U1A, X1/U1B); the
  // package key is the full prefixed stem, so they still evaluate together.
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
      refdes: "X1/U1" + letter,
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
  connect(d, ["A-1", "OUT"], ["X1/U1A", "1A"]);
  connect(d, ["A-2", "OUT"], ["X1/U1A", "1B"]);
  connect(d, ["X1/U1A", "1Y"], ["X1/U1B", "2A"]);
  connect(d, ["X1/U1A", "1Y"], ["X1/U1B", "2B"]);
  connect(d, ["X1/U1B", "2Y"], ["A-3", "IN"]); // 2Y needs a net to be observable

  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("X1/U1A", "1Y"), V0); // NAND(1,1) = 0
  assert.equal(sim.valueOfPin("X1/U1B", "2Y"), V1); // one entity: B sees A's output
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

// wire a RAM/ROM for a read of address 0 (CE/=0, OE/=0, WE/=1 for RAM), with D0
// observable through a NOT gate; returns the design.
function memReadAtZero(type) {
  const d = mkDesign();
  place(d, "U1", type);
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
  if (type.mem.kind === "ram") {
    place(d, "O1", CONST1); // WE/=1 (reading)
    connect(d, ["O1", "Y"], ["U1", "WE/"]);
  }
  return d;
}

test("a load-on-start RAM is seeded from ramContent and reads the saved word (FR-114g)", () => {
  const type = RAM4();
  type.mem.ramFile = "/x/save.bin";
  type.mem.ramLoad = true;
  const d = memReadAtZero(type);
  // loc0 = low nibble of 0x05 = 0b0101 → D0=1.
  const ramContent = new Map([["/x/save.bin", Uint8Array.from([0x05])]]);
  const sim = buildSimulation(d, { ramContent });
  settle(sim);
  assert.equal(sim.valueOfPin("U1", "D0"), V1);
});

test("a RAM with load-on-start off ignores ramContent and reads U (FR-114g)", () => {
  const type = RAM4();
  type.mem.ramFile = "/x/save.bin";
  type.mem.ramLoad = false; // no load on start
  const d = memReadAtZero(type);
  const ramContent = new Map([["/x/save.bin", Uint8Array.from([0x05])]]);
  const sim = buildSimulation(d, { ramContent });
  settle(sim);
  assert.equal(sim.valueOfPin("U1", "D0"), VU); // powers up all-U
});

test("persistentRams lists only RAMs with a save file, with a wired dumpBytes (FR-114g)", () => {
  const d = mkDesign();
  const saved = RAM4();
  saved.mem.ramFile = "/x/save.bin";
  place(d, "U1", saved);
  place(d, "U2", RAM4()); // no ramFile → excluded
  place(d, "U3", ROM4()); // a ROM (has romFile) → excluded
  const sim = buildSimulation(d);
  const rams = sim.persistentRams();
  assert.deepEqual(rams.map((r) => r.refdes), ["U1"]);
  assert.equal(rams[0].ramFile, "/x/save.bin");
  // dumpBytes is wired: full device image (4 locations × 1 byte), unwritten = 0.
  assert.deepEqual([...rams[0].dumpBytes()], [0, 0, 0, 0]);
});

test("ramFileBody formats .hex as hex tokens and .bin as raw bytes (FR-114g)", () => {
  const bytes = Uint8Array.from([0x00, 0x0a, 0xff]);
  assert.equal(ramFileBody("/x/s.hex", bytes), "00 0a ff");
  assert.equal(ramFileBody("/x/s.HEX", bytes), "00 0a ff"); // case-insensitive
  assert.equal(ramFileBody("/x/s.bin", bytes), bytes); // raw Uint8Array passthrough
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

test("scriptedClocks suppresses clock/reset behaviors; setStimulus drives their nets (FR-115e)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("clock"));
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);
  const sim = buildSimulation(d, { scriptedClocks: true });
  settle(sim);
  // The clock's simTime square wave is suppressed: its net has no driver.
  assert.equal(sim.valueOfPin("A-1", "OUT"), VZ);
  // The caller owns the net through the (replaceable) stimulus list.
  sim.setStimulus([{ refdes: "A-1", pin: "OUT", value: V1 }]);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "OUT"), V1);
  sim.setStimulus([{ refdes: "A-1", pin: "OUT", value: V0 }]);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "OUT"), V0);
});

// SHIFT2: a two-stage shift register whose first stage SR0 is a buried internal
// node (FR-079c); DS shifts through SR0 into the exposed Q1, one stage per clock.
const SHIFT2 = {
  name: "SHIFT2",
  renderType: "unit",
  clock: "CP",
  internal: ["SR0"],
  pins: [
    { name: "DS", side: "left", position: 1, direction: "in" },
    { name: "CP", side: "left", position: 2, direction: "in" },
    { name: "Q1", side: "right", position: 1, direction: "out" },
  ],
  behavior: "SR0.R = DS\nQ1.R = SR0\n",
};

test("a buried internal node carries a shift stage: DS reaches Q1 after two clocks (FR-079c)", () => {
  const d = mkDesign();
  place(d, "U1", SHIFT2);
  // Wire DS, CP, Q1 to indicators so each is a net member (drivable/readable).
  place(d, "A-1", builtin("indicator"));
  place(d, "A-2", builtin("indicator"));
  place(d, "A-3", builtin("indicator"));
  connect(d, ["U1", "DS"], ["A-1", "IN"]);
  connect(d, ["U1", "CP"], ["A-2", "IN"]);
  connect(d, ["U1", "Q1"], ["A-3", "IN"]);

  const sim = buildSimulation(d);
  const pulse = (ds) => {
    sim.setStimulus([{ refdes: "U1", pin: "DS", value: ds }, { refdes: "U1", pin: "CP", value: V0 }]);
    sim.step(); sim.step(); sim.step();
    sim.setStimulus([{ refdes: "U1", pin: "DS", value: ds }, { refdes: "U1", pin: "CP", value: V1 }]);
    sim.step(); sim.step(); sim.step();
  };

  pulse(V1); // SR0 <- 1; Q1 <- old SR0 (U)
  assert.notEqual(sim.valueOfPin("U1", "Q1"), V1); // the 1 has not reached Q1 yet
  pulse(V0); // Q1 <- SR0 (=1); SR0 <- 0
  assert.equal(sim.valueOfPin("U1", "Q1"), V1); // it arrives one clock later
  pulse(V0); // Q1 <- SR0 (=0)
  assert.equal(sim.valueOfPin("U1", "Q1"), V0); // and shifts on through
});

// --- switch elements: transmission gates & relays (FR-071g/FR-071h/FR-083a) ---

// placeSwitch places an input switch already set to a given state, so it strong-
// drives that fixed level from step 1 (its behavior reads live inst.switchState,
// §6.13). Returns the instance so a test can toggle it mid-run.
function placeSwitch(d, refdes, state) {
  place(d, refdes, builtin("switch"));
  d.components.at(-1).switchState = state;
  return d.components.at(-1);
}

test("transmission gate: closed passes a driver across; open isolates the far side (FR-071g/FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  placeSwitch(d, "A-2", "1"); // data on A
  place(d, "A-3", builtin("indicator")); // probe on B
  const se = placeSwitch(d, "A-4", "1"); // enable
  connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d, ["A-1", "B"], ["A-3", "IN"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "B"), V1); // driver on A observed at B
  assert.equal(sim.valueOfPin("A-1", "A"), V1);

  se.switchState = "0"; // open
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V1); // still driven
  assert.equal(sim.valueOfPin("A-1", "B"), VZ); // far side isolated → Z
});

test("transmission gate: terminals are symmetric — a driver on B is seen at A (FR-071g)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  place(d, "A-2", builtin("indicator")); // probe A
  placeSwitch(d, "A-3", "1"); // data on B
  placeSwitch(d, "A-4", "1"); // enable
  connect(d, ["A-1", "A"], ["A-2", "IN"]);
  connect(d, ["A-1", "B"], ["A-3", "OUT"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V1);
});

test("transmission gate: releasing the driver leaves both sides Z — no charge latch (FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  place(d, "A-2", builtin("indicator")); // A
  place(d, "A-3", builtin("indicator")); // B
  place(d, "A-4", builtin("pullup")); // EN held closed (weak 1)
  connect(d, ["A-1", "A"], ["A-2", "IN"]);
  connect(d, ["A-1", "B"], ["A-3", "IN"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  const sim = buildSimulation(d, { stimulus: [{ refdes: "A-1", pin: "A", value: V1 }] });
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V1);
  assert.equal(sim.valueOfPin("A-1", "B"), V1); // carried across the closed gate

  sim.setStimulus([]); // release the driver
  sim.step();
  // The merged group is now undriven; a merge stores no charge, so BOTH sides
  // read Z — the back-to-back-driver model would latch B at 1 here (§8).
  assert.equal(sim.valueOfPin("A-1", "A"), VZ);
  assert.equal(sim.valueOfPin("A-1", "B"), VZ);
});

test("transmission gates chain: two closed gates join three nets; opening one splits them (FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate")); // G1
  place(d, "A-2", builtin("tgate")); // G2
  placeSwitch(d, "A-3", "1"); // driver on net1
  place(d, "A-4", builtin("indicator")); // probe on net3
  const e1 = placeSwitch(d, "A-5", "1"); // G1 enable
  placeSwitch(d, "A-6", "1"); // G2 enable
  connect(d, ["A-3", "OUT"], ["A-1", "A"]); // net1
  connect(d, ["A-1", "B"], ["A-2", "A"]); // net2
  connect(d, ["A-2", "B"], ["A-4", "IN"]); // net3
  connect(d, ["A-1", "EN"], ["A-5", "OUT"]);
  connect(d, ["A-2", "EN"], ["A-6", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  // Transitive join: the driver on net1 reaches net3 through two closed gates.
  assert.equal(sim.valueOfPin("A-1", "B"), V1); // net2
  assert.equal(sim.valueOfPin("A-2", "B"), V1); // net3

  e1.switchState = "0"; // open G1 → net1 splits off
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V1); // net1 still driven
  assert.equal(sim.valueOfPin("A-1", "B"), VZ); // net2 now isolated from the driver
  assert.equal(sim.valueOfPin("A-2", "B"), VZ); // net3 too
});

test("transmission gate: a weak pull crosses a closed contact but loses to a far strong 0 (FR-083)", () => {
  // Weak pull-up on A, strong 0 on B, gate closed → the strong driver wins.
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  place(d, "A-2", builtin("pullup")); // weak 1 on A
  placeSwitch(d, "A-3", "0"); // strong 0 on B
  place(d, "A-4", builtin("pullup")); // EN closed
  connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d, ["A-1", "B"], ["A-3", "OUT"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  let sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V0);
  assert.equal(sim.valueOfPin("A-1", "B"), V0);

  // With no strong driver, the weak pull decides the whole merged group.
  const d2 = mkDesign();
  place(d2, "A-1", builtin("tgate"));
  place(d2, "A-2", builtin("pullup")); // weak 1 on A
  place(d2, "A-3", builtin("indicator")); // B undriven
  place(d2, "A-4", builtin("pullup")); // EN closed
  connect(d2, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d2, ["A-1", "B"], ["A-3", "IN"]);
  connect(d2, ["A-1", "EN"], ["A-4", "OUT"]);
  sim = buildSimulation(d2);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), V1);
  assert.equal(sim.valueOfPin("A-1", "B"), V1); // weak pull seen across the contact
});

test("transmission gate: strong 0 vs strong 1 across a closed contact conflicts (FR-082/FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  placeSwitch(d, "A-2", "1"); // strong 1 on A
  placeSwitch(d, "A-3", "0"); // strong 0 on B
  place(d, "A-4", builtin("pullup")); // EN closed
  const wA = connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  const wB = connect(d, ["A-1", "B"], ["A-3", "OUT"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  const messages = [];
  const sim = buildSimulation(d, { onMessage: (m) => messages.push(m) });
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "A"), VU); // group value U
  assert.equal(sim.valueOfPin("A-1", "B"), VU);
  // Every member net's conductor is flagged (FR-082 across the merge).
  const flagged = sim.conflictedConductors();
  assert.ok(flagged.has(wA));
  assert.ok(flagged.has(wB));
  const conflicts = messages.filter((m) => m.includes("bus conflict"));
  assert.equal(conflicts.length, 1); // reported once
  assert.match(conflicts[0], /A-[23]\.OUT vs A-[23]\.OUT/); // two drivers named
});

test("transmission gate: EN reading U forces both terminal groups U (FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate")); // EN left unconnected → reads Z→U
  placeSwitch(d, "A-2", "1"); // strong 1 on A
  placeSwitch(d, "A-3", "1"); // strong 1 on B (agreeing)
  connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d, ["A-1", "B"], ["A-3", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  // Unknown contact position is conservative: both terminals U despite the
  // agreeing strong drivers.
  assert.equal(sim.valueOfPin("A-1", "A"), VU);
  assert.equal(sim.valueOfPin("A-1", "B"), VU);
});

test("transmission gate: a control change joins on the next step (one-unit delay, FR-078)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  placeSwitch(d, "A-2", "1"); // data on A
  place(d, "A-3", builtin("indicator")); // probe B
  const se = placeSwitch(d, "A-4", "0"); // enable, start open
  connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d, ["A-1", "B"], ["A-3", "IN"]);
  connect(d, ["A-1", "EN"], ["A-4", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "B"), VZ); // open: B isolated

  se.switchState = "1"; // close
  sim.step(); // EN net rises to 1 this step, but the contact read the old EN
  assert.equal(sim.valueOfPin("A-1", "EN"), V1); // control already high...
  assert.equal(sim.valueOfPin("A-1", "B"), VZ); // ...yet the contact has not closed
  sim.step(); // now the contact reads EN=1 and closes
  assert.equal(sim.valueOfPin("A-1", "B"), V1);
});

test("relay: the coil throws the changeover contact (COM–NC released, COM–NO energized) (FR-071h)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("relay"));
  placeSwitch(d, "A-2", "1"); // COM driver
  place(d, "A-3", builtin("indicator")); // NO probe
  place(d, "A-4", builtin("indicator")); // NC probe
  const sc = placeSwitch(d, "A-5", "0"); // coil, start released
  connect(d, ["A-1", "COM"], ["A-2", "OUT"]);
  connect(d, ["A-1", "NO"], ["A-3", "IN"]);
  connect(d, ["A-1", "NC"], ["A-4", "IN"]);
  connect(d, ["A-1", "COIL"], ["A-5", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "NC"), V1); // released: COM–NC joined
  assert.equal(sim.valueOfPin("A-1", "NO"), VZ); // NO isolated

  sc.switchState = "1"; // energize
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "NO"), V1); // energized: COM–NO joined
  assert.equal(sim.valueOfPin("A-1", "NC"), VZ); // NC isolated
});

test("relay: a coil reading U forces all three contact terminals U (FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("relay")); // COIL unconnected → U
  placeSwitch(d, "A-2", "1"); // COM driver
  place(d, "A-3", builtin("indicator")); // NO
  place(d, "A-4", builtin("indicator")); // NC
  connect(d, ["A-1", "COM"], ["A-2", "OUT"]);
  connect(d, ["A-1", "NO"], ["A-3", "IN"]);
  connect(d, ["A-1", "NC"], ["A-4", "IN"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "COM"), VU);
  assert.equal(sim.valueOfPin("A-1", "NO"), VU);
  assert.equal(sim.valueOfPin("A-1", "NC"), VU);
});

test("relay: an unwired throw gives an SPST contact (FR-071h)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("relay")); // NO left unwired
  placeSwitch(d, "A-2", "1"); // COM driver
  place(d, "A-3", builtin("indicator")); // NC probe
  const sc = placeSwitch(d, "A-4", "0"); // coil released
  connect(d, ["A-1", "COM"], ["A-2", "OUT"]);
  connect(d, ["A-1", "NC"], ["A-3", "IN"]);
  connect(d, ["A-1", "COIL"], ["A-4", "OUT"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "NC"), V1); // released: COM–NC closed

  sc.switchState = "1"; // energize → NC opens; the unwired NO simply never joins
  settle(sim);
  assert.equal(sim.valueOfPin("A-1", "COM"), V1); // COM still driven
  assert.equal(sim.valueOfPin("A-1", "NC"), VZ); // NC isolated
});

test("a design with no switch elements resolves per net (fast path unaffected) (FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);
  const sim = buildSimulation(d);
  settle(sim);
  assert.equal(sim.valueOfPin("A-2", "IN"), V1);
});

test("merge feedback settles rather than spinning (FR-085)", () => {
  // A gate whose enable depends on a net it merges. From a cold start every net
  // is U and merging cannot manufacture a definite level, so the loop settles
  // (at U) well within the settling bound rather than oscillating — the same
  // 4-state convergence as a plain inverter ring ("feedback loop settles to U").
  // See the note to the reviewer re: literally hitting the 10,000-unit bound.
  const d = mkDesign();
  place(d, "A-1", builtin("tgate"));
  place(d, "A-2", builtin("pullup")); // weak 1 on A
  place(d, "A-3", builtin("pulldown")); // weak 0 on B
  place(d, "U1", NOT); // EN = /B — control depends on the merged B net
  connect(d, ["A-1", "A"], ["A-2", "OUT"]);
  connect(d, ["A-1", "B"], ["A-3", "OUT"]);
  connect(d, ["A-1", "B"], ["U1", "A"]);
  connect(d, ["U1", "Y"], ["A-1", "EN"]);
  const sim = buildSimulation(d);
  assert.ok(settle(sim) <= 100); // converges; does not spin
});
