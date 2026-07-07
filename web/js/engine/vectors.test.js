import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveColumns,
  runVectors,
  captureRow,
  captureVectors,
  validateVectors,
  serializeVectors,
  deserializeVectors,
  reconcileVectors,
  migrate,
  emptyRow,
  hasClockGenerators,
  FORMAT_VERSION,
} from "./vectors.js";
import { BUILTINS, portNFields } from "../builtins.js";
import { createDesign, addInstance, addWire } from "../model/design.js";
import { flatten, addSubDesignInstance, designInterface } from "../model/subdesign.js";

const PORT = BUILTINS.find((b) => b.name === "port");
const PORTN = BUILTINS.find((b) => b.name === "portN");
const portNType = (width) => ({ ...PORTN, ...portNFields(width) });
const wire = (d, a, p, b, q) =>
  addWire(d, { kind: "pin", refdes: a, pin: p }, { kind: "pin", refdes: b, pin: q });

// --- design fixtures (literal model shapes per §7.1a/§7.2), mirroring sim.test.js ---

function mkDesign() {
  return { name: "t", components: [], wires: [], buses: [], vertices: [], nets: [], seq: 0 };
}

const builtin = (name) => BUILTINS.find((b) => b.name === name);

function place(d, refdes, type, extra = {}) {
  d.components.push({
    refdes,
    type: type.id ?? type.name,
    x: 0,
    y: 0,
    rotation: 0,
    typeData: structuredClone(type),
    overrides: {},
    ...extra,
  });
}

function connect(d, [refA, pinA], [refB, pinB]) {
  const va = { id: `v${++d.seq}`, kind: "pin", ref: refA, pin: pinA, x: 0, y: 0 };
  const vb = { id: `v${++d.seq}`, kind: "pin", ref: refB, pin: pinB, x: 0, y: 0 };
  d.vertices.push(va, vb);
  const id = `w${++d.seq}`;
  d.wires.push({ id, path: [{ t: "node", v: va.id }, { t: "node", v: vb.id }] });
  return id;
}

// NOT: one inverter as a unit-rendered type (Y = /A).
const NOT = {
  name: "NOTX",
  renderType: "unit",
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "out" },
  ],
  behavior: "Y = /A\n",
};

// buffer: one input switch wired straight to one indicator.
function bufferDesign() {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"));
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);
  return d;
}

// inverter: switch → NOT → indicator.
function inverterDesign() {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"));
  place(d, "U1", NOT);
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["U1", "A"]);
  connect(d, ["U1", "Y"], ["A-2", "IN"]);
  return d;
}

// tgate circuit: data switch → tgate A, enable switch → tgate EN, indicator on B.
function tgateVectorDesign() {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"), { label: "D" }); // data
  place(d, "A-2", builtin("switch"), { label: "EN" }); // enable
  place(d, "A-3", builtin("tgate"));
  place(d, "A-4", builtin("indicator"), { label: "Q" });
  connect(d, ["A-1", "OUT"], ["A-3", "A"]);
  connect(d, ["A-2", "OUT"], ["A-3", "EN"]);
  connect(d, ["A-3", "B"], ["A-4", "IN"]);
  return d;
}

test("deriveColumns: switches → inputs, indicators → outputs, indicator8 expands to 8 bits", () => {
  const d = mkDesign();
  place(d, "A-2", builtin("switch"), { label: "B" });
  place(d, "A-10", builtin("switch")); // numeric-aware order: A-2 before A-10
  place(d, "A-3", builtin("indicator"), { label: "Q" });
  place(d, "A-4", builtin("indicator8"), { label: "BUS" });
  const { inputs, outputs } = deriveColumns(d);

  assert.deepEqual(inputs.map((c) => c.refdes), ["A-2", "A-10"]);
  assert.equal(inputs[0].label, "B"); // explicit label
  assert.equal(inputs[1].label, "A-10"); // falls back to refdes
  assert.ok(inputs.every((c) => c.pin === "OUT"));

  // one 1-wide (IN) + eight from the indicator8 (D0..D7).
  assert.equal(outputs.length, 9);
  const bus = outputs.filter((c) => c.refdes === "A-4");
  assert.deepEqual(bus.map((c) => c.pin), ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
  assert.equal(bus[0].label, "BUS.D0");
});

test("deriveColumns: switch elements contribute no vector columns (FR-115b/FR-083a)", () => {
  const d = tgateVectorDesign();
  const { inputs, outputs } = deriveColumns(d);
  assert.deepEqual(inputs.map((c) => c.refdes), ["A-1", "A-2"]); // the two switches
  assert.deepEqual(outputs.map((c) => c.refdes), ["A-4"]); // the indicator
  // The transmission gate A-3 yields no column of either kind.
  assert.ok(![...inputs, ...outputs].some((c) => c.refdes === "A-3"));
});

test("runVectors: a transmission-gate circuit scores per FR-115c", () => {
  const d = tgateVectorDesign();
  const cols = deriveColumns(d);
  // Input order follows deriveColumns (A-1 data, A-2 enable).
  const rows = [
    { in: ["1", "1"], out: ["H"] }, // closed, data 1 → B=1 → H passes
    { in: ["0", "1"], out: ["L"] }, // closed, data 0 → B=0 → L passes
    { in: ["1", "0"], out: ["H"] }, // open → B isolated (Z) → captures X, H fails
  ];
  const res = runVectors(d, { ...cols, rows });
  assert.equal(res.total, 3);
  assert.equal(res.passed, 2);
  assert.equal(res.rows[0].pass, true);
  assert.equal(res.rows[1].pass, true);
  assert.equal(res.rows[2].pass, false);
});

test("runVectors: buffer scores H/L matches and reports mismatches with the actual value", () => {
  const d = bufferDesign();
  const cols = deriveColumns(d);
  const rows = [
    { in: ["0"], out: ["L"] }, // 0 in → 0 out → L passes
    { in: ["1"], out: ["H"] }, // 1 in → 1 out → H passes
    { in: ["1"], out: ["L"] }, // 1 in → 1 out, expected L → fails, actual 1
  ];
  const res = runVectors(d, { ...cols, rows });
  assert.equal(res.total, 3);
  assert.equal(res.passed, 2);
  assert.equal(res.rows[0].pass, true);
  assert.equal(res.rows[2].pass, false);
  assert.equal(res.rows[2].cells[0].actual, "1");
  assert.equal(res.rows[2].cells[0].expected, "L");
});

test("runVectors: X output cell always passes", () => {
  const d = bufferDesign();
  const cols = deriveColumns(d);
  const res = runVectors(d, { ...cols, rows: [{ in: ["1"], out: ["X"] }, { in: ["0"], out: ["X"] }] });
  assert.equal(res.passed, 2);
});

test("runVectors: an unconnected indicator reads Z and never matches H/L; captures as X", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"));
  place(d, "A-2", builtin("indicator")); // IN left floating
  const cols = deriveColumns(d);
  const res = runVectors(d, { ...cols, rows: [{ in: ["1"], out: ["H"] }] });
  assert.equal(res.rows[0].cells[0].pass, false);
  assert.equal(res.rows[0].cells[0].actual, "Z");
  assert.deepEqual(captureRow(d, cols, ["1"]), ["X"]);
});

test("captureRow: inverter captures the settled golden outputs as H/L", () => {
  const d = inverterDesign();
  const cols = deriveColumns(d);
  assert.deepEqual(captureRow(d, cols, ["0"]), ["H"]); // /0 = 1
  assert.deepEqual(captureRow(d, cols, ["1"]), ["L"]); // /1 = 0
});

test("runVectors does not mutate the live design", () => {
  const d = bufferDesign();
  const before = JSON.stringify(d);
  const cols = deriveColumns(d);
  runVectors(d, { ...cols, rows: [{ in: ["1"], out: ["H"] }, { in: ["0"], out: ["L"] }] });
  assert.equal(JSON.stringify(d), before); // clone isolation
  assert.equal(d.components.find((c) => c.refdes === "A-1").switchState, undefined);
});

test("validateVectors: flags bad symbols and wrong arity", () => {
  const cols = { inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }], outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }] };
  const ok = validateVectors({ ...cols, rows: [{ in: ["0"], out: ["H"] }] });
  assert.equal(ok.ok, true);

  const bad = validateVectors({
    ...cols,
    rows: [
      { in: ["2"], out: ["H"] }, // 2 is not a legal input symbol
      { in: ["0", "1"], out: ["Q"] }, // wrong input arity + bad output symbol
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 2);
});

test("serialize / deserialize round-trips a doc and stamps the format version", () => {
  const doc = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }],
    rows: [{ in: ["0"], out: ["L"] }, { in: ["1"], out: ["H"] }],
  };
  const file = serializeVectors(doc);
  assert.equal(file.formatVersion, FORMAT_VERSION);
  const back = deserializeVectors(file);
  assert.deepEqual(back, doc);
});

test("migrate: a versionless file is treated as v1 and upgraded (identity) to v2", () => {
  const obj = { inputs: [], outputs: [], rows: [{ in: ["0"], out: ["L"] }] };
  // The v1→v2 step is the identity apart from the stamped formatVersion — the
  // shape is unchanged, v2 only marks the sequential "C" symbol (FR-115e/§7.7).
  assert.deepEqual(migrate(obj), { ...obj, formatVersion: 2 });
  // A run-through deserialize still yields a usable doc.
  assert.equal(deserializeVectors(obj).rows.length, 1);
  // An unknown future-version step throws a legible error.
  assert.throws(
    () => migrate({ formatVersion: 2 }, { target: 3, migrations: {} }),
    /no migration from version 2 to 3/,
  );
});

test("reconcileVectors: aligns file rows to current columns and warns on column drift", () => {
  // File has input A-1 and an output A-9 the design no longer has; the design has
  // a new output A-2 the file lacks.
  const fileDoc = deserializeVectors({
    formatVersion: 1,
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-9", pin: "IN", label: "old" }],
    rows: [{ in: ["1"], out: ["H"] }],
  });
  const columns = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }],
  };
  const { rows, warnings } = reconcileVectors(fileDoc, columns);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].in, ["1"]); // matching input carried over
  assert.deepEqual(rows[0].out, ["X"]); // unmatched output defaults to don't-test
  assert.ok(warnings.some((w) => w.includes("A-9"))); // file column absent from design
  assert.ok(warnings.some((w) => w.includes("A-2"))); // design column absent from file
});

test("emptyRow sizes to the columns with default 0 inputs and X outputs", () => {
  const cols = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }, { refdes: "A-2", pin: "OUT", label: "B" }],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
  };
  assert.deepEqual(emptyRow(cols), { in: ["0", "0"], out: ["X"] });
});

// BIDIR: a unit with one bidirectional pin, so a port on its net derives bidir.
const BIDIR = {
  name: "BID",
  renderType: "unit",
  pins: [{ name: "IO", side: "right", position: 1, direction: "bidir" }],
};

test("ports: a 1-wide in/out pair runs end to end (FR-115f)", () => {
  const d = createDesign("t");
  const u = addInstance(d, NOT, 10, 10, 0);
  const pin = addInstance(d, PORT, 0, 0, 0);
  pin.label = "IN";
  const pout = addInstance(d, PORT, 0, 20, 0);
  pout.label = "OUT";
  wire(d, pin.refdes, "P", u.refdes, "A");
  wire(d, u.refdes, "Y", pout.refdes, "P");

  const cols = deriveColumns(d);
  assert.deepEqual(cols.inputs.map((c) => [c.refdes, c.pin]), [[pin.refdes, "P"]]);
  assert.deepEqual(cols.outputs.map((c) => [c.refdes, c.pin]), [[pout.refdes, "P"]]);

  // Drive the input port via stimulus; read the output port off its own net.
  const res = runVectors(d, {
    ...cols,
    rows: [{ in: ["1"], out: ["L"] }, { in: ["0"], out: ["H"] }],
  });
  assert.equal(res.passed, 2);
});

test("ports: a portN input expands to N columns and runs (FR-115f)", () => {
  const d = createDesign("t");
  const p = addInstance(d, portNType(2), 0, 0, 0);
  p.label = "B";
  const u0 = addInstance(d, NOT, 10, 0, 0);
  const u1 = addInstance(d, NOT, 10, 10, 0);
  const o0 = addInstance(d, PORT, 20, 0, 0);
  o0.label = "O0";
  const o1 = addInstance(d, PORT, 20, 10, 0);
  o1.label = "O1";
  wire(d, p.refdes, "P0", u0.refdes, "A");
  wire(d, p.refdes, "P1", u1.refdes, "A");
  wire(d, u0.refdes, "Y", o0.refdes, "P");
  wire(d, u1.refdes, "Y", o1.refdes, "P");

  const cols = deriveColumns(d);
  assert.deepEqual(cols.inputs.map((c) => c.pin), ["P0", "P1"]);
  assert.deepEqual(cols.inputs.map((c) => c.label), ["B0", "B1"]);
  assert.deepEqual(cols.outputs.map((c) => c.label), ["O0", "O1"]);

  // O0 = /P0 = /1 = 0 (L); O1 = /P1 = /0 = 1 (H).
  const res = runVectors(d, { ...cols, rows: [{ in: ["1", "0"], out: ["L", "H"] }] });
  assert.equal(res.passed, 1);
});

test("ports: a bidir port is skipped with a warning, bound when overridden (FR-115f)", () => {
  const d = createDesign("t");
  const u = addInstance(d, BIDIR, 10, 0, 0);
  const p = addInstance(d, PORT, 0, 0, 0);
  p.label = "BUS";
  wire(d, u.refdes, "IO", p.refdes, "P");

  let cols = deriveColumns(d);
  assert.equal(cols.inputs.length, 0);
  assert.equal(cols.outputs.length, 0);
  assert.ok(cols.warnings.some((w) => w.includes("BUS")));

  p.dirOverride = "out"; // opt the bidir port in as an output (FR-094d)
  cols = deriveColumns(d);
  assert.deepEqual(cols.outputs.map((c) => [c.refdes, c.pin]), [[p.refdes, "P"]]);
  assert.equal(cols.warnings.length, 0);
});

test("ports: port columns union with switch/indicator columns (FR-115b/FR-115f)", () => {
  const d = createDesign("t");
  const sw = addInstance(d, builtin("switch"), 0, 0, 0);
  const ind = addInstance(d, builtin("indicator"), 0, 10, 0);
  const u = addInstance(d, NOT, 10, 0, 0);
  const pin = addInstance(d, PORT, 0, 20, 0);
  pin.label = "PIN";
  const pout = addInstance(d, PORT, 0, 30, 0);
  pout.label = "POUT";
  wire(d, sw.refdes, "OUT", ind.refdes, "IN");
  wire(d, pin.refdes, "P", u.refdes, "A");
  wire(d, u.refdes, "Y", pout.refdes, "P");

  const cols = deriveColumns(d);
  assert.ok(cols.inputs.some((c) => c.pin === "OUT")); // switch
  assert.ok(cols.inputs.some((c) => c.pin === "P")); // input port
  assert.ok(cols.outputs.some((c) => c.pin === "IN")); // indicator
  assert.ok(cols.outputs.some((c) => c.pin === "P")); // output port
});

// --- clocked-design guard (FR-115g) ---

test("hasClockGenerators: false for a combinational design (FR-115g)", () => {
  assert.equal(hasClockGenerators(bufferDesign()), false);
  assert.equal(hasClockGenerators({ name: "empty" }), false); // no components at all
});

test("hasClockGenerators: true when a clock built-in is placed (FR-115g)", () => {
  const d = bufferDesign();
  place(d, "A-3", builtin("clock"));
  assert.equal(hasClockGenerators(d), true);
});

// --- sequential vectors (FR-115e) ---

// DFF: registered output with declared clock (mirrors sim.test.js).
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

// dff design: switch → D, clock → CP, Q → indicator.
function dffDesign() {
  const d = mkDesign();
  place(d, "A-1", builtin("switch")); // D
  place(d, "A-2", builtin("clock"));
  place(d, "U1", DFF);
  place(d, "A-3", builtin("indicator")); // Q
  connect(d, ["A-1", "OUT"], ["U1", "D"]);
  connect(d, ["A-2", "OUT"], ["U1", "CP"]);
  connect(d, ["U1", "Q"], ["A-3", "IN"]);
  return d;
}

test("deriveColumns: a clock generator is a kind:'clock' input column; emptyRow defaults it C (FR-115e)", () => {
  const cols = deriveColumns(dffDesign());
  // Sorted by refdes: A-1 switch, then A-2 clock.
  assert.deepEqual(
    cols.inputs.map((c) => [c.refdes, c.pin, c.kind ?? null]),
    [["A-1", "OUT", null], ["A-2", "OUT", "clock"]],
  );
  const row = emptyRow(cols);
  assert.deepEqual(row.in, ["0", "C"]);
});

test("sequential run: rows persist register state; C pulses, 0 holds (FR-115e)", () => {
  const d = dffDesign();
  const cols = deriveColumns(d); // inputs: [D switch, clock]
  const rows = [
    { in: ["1", "C"], out: ["H"] }, // pulse latches D=1
    { in: ["0", "0"], out: ["H"] }, // clock held low: Q keeps its state
    { in: ["0", "C"], out: ["L"] }, // pulse latches D=0
  ];
  const res = runVectors(d, { ...cols, rows });
  assert.equal(res.passed, 3);
  assert.equal(res.total, 3);
});

test("sequential run: a 0→1 clock level change between rows is a rising edge (FR-115e)", () => {
  const d = dffDesign();
  const cols = deriveColumns(d);
  const rows = [
    { in: ["1", "0"], out: ["X"] }, // clock low, D staged high
    { in: ["1", "1"], out: ["H"] }, // level raised across rows: edge latches 1
    { in: ["0", "1"], out: ["H"] }, // clock still high: no edge, Q unchanged
  ];
  assert.equal(runVectors(d, { ...cols, rows }).passed, 3);
});

test("sequential run: power-on preamble latches reset-driven state before row 1 (FR-115e)", () => {
  // Reset R drives the DFF's D: during the asserted preamble the scripted
  // pulses latch 1; after release, the first row's pulse latches 0.
  const d = mkDesign();
  place(d, "A-1", builtin("reset"));
  place(d, "A-2", builtin("clock"));
  place(d, "U1", DFF);
  place(d, "A-3", builtin("indicator"));
  connect(d, ["A-1", "R"], ["U1", "D"]);
  connect(d, ["A-2", "OUT"], ["U1", "CP"]);
  connect(d, ["U1", "Q"], ["A-3", "IN"]);
  const cols = deriveColumns(d); // one input column: the clock
  const rows = [
    { in: ["0"], out: ["H"] }, // clock held: Q still carries the preamble's 1
    { in: ["C"], out: ["L"] }, // reset released: this pulse latches 0
  ];
  assert.equal(runVectors(d, { ...cols, rows }).passed, 2);
});

test("captureVectors: sequential capture records each row's settled outputs in order (FR-115e)", () => {
  const d = dffDesign();
  const cols = deriveColumns(d);
  const outs = captureVectors(d, cols, [["1", "C"], ["0", "0"], ["0", "C"]]);
  assert.deepEqual(outs, [["H"], ["H"], ["L"]]);
});

test("captureVectors: combinational designs capture rows independently", () => {
  const d = inverterDesign();
  const cols = deriveColumns(d);
  assert.deepEqual(captureVectors(d, cols, [["0"], ["1"]]), [["H"], ["L"]]);
});

test("sequential run does not mutate the live design (FR-115c isolation)", () => {
  const d = dffDesign();
  const before = JSON.stringify(d);
  const cols = deriveColumns(d);
  runVectors(d, { ...cols, rows: [{ in: ["1", "C"], out: ["H"] }] });
  assert.equal(JSON.stringify(d), before);
});

test("validateVectors: C is legal only in a clock column (FR-115e)", () => {
  const cols = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "D" },
      { refdes: "A-2", pin: "OUT", label: "CLK", kind: "clock" },
    ],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
  };
  const ok = validateVectors({ ...cols, rows: [{ in: ["0", "C"], out: ["X"] }] });
  assert.equal(ok.ok, true);
  const bad = validateVectors({ ...cols, rows: [{ in: ["C", "1"], out: ["X"] }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors[0].includes("must be 0 or 1"));
});

test("serializeVectors: strips the live-only kind marker and stamps v2 (§7.7)", () => {
  const doc = {
    inputs: [{ refdes: "A-2", pin: "OUT", label: "CLK", kind: "clock" }],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
    rows: [{ in: ["C"], out: ["H"] }],
  };
  const file = serializeVectors(doc);
  assert.equal(file.formatVersion, FORMAT_VERSION);
  assert.deepEqual(file.inputs, [{ refdes: "A-2", pin: "OUT", label: "CLK" }]);
});

test("vector run over a flattened hierarchical design (FR-102/FR-115e hierarchy)", async () => {
  // Child: port IN → inverter → port OUT. Parent: switch → X1.IN, X1.OUT → indicator.
  const child = createDesign("inv");
  const pi = addInstance(child, PORT, 0, 0, 0);
  pi.label = "IN";
  const po = addInstance(child, PORT, 20, 0, 0);
  po.label = "OUT";
  const u = addInstance(child, NOT, 10, 0, 0);
  wire(child, pi.refdes, "P", u.refdes, "A");
  wire(child, u.refdes, "Y", po.refdes, "P");

  const parent = createDesign("top");
  const x = addSubDesignInstance(
    parent,
    { childPath: "/lib/inv.json", render: "ic", iface: designInterface(child), childName: "inv" },
    10,
    10,
  );
  const sw = addInstance(parent, builtin("switch"), 0, 0, 0);
  const ind = addInstance(parent, builtin("indicator"), 20, 0, 0);
  wire(parent, sw.refdes, "OUT", x.refdes, "IN");
  wire(parent, x.refdes, "OUT", ind.refdes, "IN");

  // Columns bind to the top sheet only (FR-115b): one switch in, one indicator out.
  const columns = deriveColumns(parent);
  assert.equal(columns.inputs.length, 1);
  assert.equal(columns.outputs.length, 1);

  const flat = await flatten(parent, async () => child);
  const res = runVectors(flat, {
    inputs: columns.inputs,
    outputs: columns.outputs,
    rows: [
      { in: ["0"], out: ["H"] }, // inverted through the child
      { in: ["1"], out: ["L"] },
    ],
  });
  assert.equal(res.passed, 2);
});

test("runVectors/captureVectors refuse a clock hidden in a child (FR-115e deferred scope)", () => {
  const d = mkDesign();
  place(d, "X1/A-1", builtin("clock")); // hierarchical refdes = flattened child clock
  assert.throws(
    () => runVectors(d, { inputs: [], outputs: [], rows: [] }),
    /top sheet only/,
  );
  assert.throws(() => captureVectors(d, { inputs: [], outputs: [] }, []), /top sheet only/);
});

test("reconcileVectors: a clock column absent from the file defaults its cells to C", () => {
  const fileDoc = deserializeVectors({
    formatVersion: 2,
    inputs: [{ refdes: "A-1", pin: "OUT", label: "D" }],
    outputs: [],
    rows: [{ in: ["1"], out: [] }],
  });
  const columns = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "D" },
      { refdes: "A-2", pin: "OUT", label: "CLK", kind: "clock" },
    ],
    outputs: [],
  };
  const { rows, warnings } = reconcileVectors(fileDoc, columns);
  assert.deepEqual(rows[0].in, ["1", "C"]);
  assert.equal(warnings.length, 1); // clock column in the design but not the file
});
