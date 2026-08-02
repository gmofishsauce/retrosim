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
  cloneRow,
  bitGroups,
  groupRole,
  groupDigits,
  groupToHex,
  groupFromHex,
  groupActualHex,
  clockSources,
  isStateful,
  isActiveLowName,
  FORMAT_VERSION,
} from "./vectors.js";
import { V0, V1 } from "./galasm.js";
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
  assert.deepEqual(captureRow(d, cols, ["1"]).out, ["X"]);
});

test("captureRow: inverter captures the settled golden outputs as H/L", () => {
  const d = inverterDesign();
  const cols = deriveColumns(d);
  assert.deepEqual(captureRow(d, cols, ["0"]).out, ["H"]); // /0 = 1
  assert.deepEqual(captureRow(d, cols, ["1"]).out, ["L"]); // /1 = 0
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

test("validateVectors: io cells accept 0/1/H/L/X and check arity (FR-115i)", () => {
  const cols = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [],
    io: [{ refdes: "A-2", pin: "P", label: "BUS" }],
  };
  const ok = validateVectors({
    ...cols,
    rows: [{ in: ["0"], out: [], io: ["H"] }, { in: ["1"], out: [], io: ["0"] }],
  });
  assert.equal(ok.ok, true);

  const bad = validateVectors({
    ...cols,
    rows: [
      { in: ["0"], out: [], io: ["C"] }, // C is not legal in an io cell
      { in: ["0"], out: [], io: ["H", "L"] }, // wrong io arity
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("io")));
});

test("serialize / deserialize round-trips a doc and stamps the format version", () => {
  const doc = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }],
    io: [],
    rows: [{ in: ["0"], io: [], out: ["L"] }, { in: ["1"], io: [], out: ["H"] }],
  };
  const file = serializeVectors(doc);
  assert.equal(file.formatVersion, FORMAT_VERSION);
  const back = deserializeVectors(file);
  assert.deepEqual(back, doc);
});

test("migrate: a versionless file upgrades v1→v2 (identity), then v2→v3 (adds io)", () => {
  const obj = { inputs: [], outputs: [], rows: [{ in: ["0"], out: ["L"] }] };
  // The v1→v2 step is the identity apart from the stamped formatVersion — the
  // shape is unchanged, v2 only marks the sequential "C" symbol (FR-115e/§7.7).
  assert.deepEqual(migrate(obj, { target: 2 }), { ...obj, formatVersion: 2 });
  // v2→v3 seeds the io column array and per-row io cells empty (FR-115i/§7.7).
  const v3 = migrate(obj); // default target = current (3)
  assert.equal(v3.formatVersion, FORMAT_VERSION);
  assert.deepEqual(v3.io, []);
  assert.deepEqual(v3.rows[0].io, []);
  // A run-through deserialize still yields a usable doc.
  assert.equal(deserializeVectors(obj).rows.length, 1);
  // An unknown future-version step throws a legible error.
  assert.throws(
    () => migrate({ formatVersion: 3 }, { target: 4, migrations: {} }),
    /no migration from version 3 to 4/,
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

test("io columns: serialize/deserialize/reconcile carry io and default missing cells to X (FR-115i)", () => {
  const doc = {
    inputs: [],
    outputs: [],
    io: [{ refdes: "A-5", pin: "P", label: "BUS" }],
    rows: [{ in: [], io: ["1"], out: [] }, { in: [], io: ["H"], out: [] }],
  };
  const file = serializeVectors(doc);
  assert.equal(file.formatVersion, 3);
  assert.deepEqual(file.io, [{ refdes: "A-5", pin: "P", label: "BUS" }]);
  assert.deepEqual(file.rows[1].io, ["H"]);

  const fileDoc = deserializeVectors(file);
  // Design still has BUS plus a new io column DAT the file lacks.
  const columns = {
    inputs: [],
    outputs: [],
    io: [
      { refdes: "A-5", pin: "P", label: "BUS" },
      { refdes: "A-6", pin: "P", label: "DAT" },
    ],
  };
  const { rows, warnings } = reconcileVectors(fileDoc, columns);
  assert.deepEqual(rows[0].io, ["1", "X"]); // BUS carried over, DAT defaults X
  assert.deepEqual(rows[1].io, ["H", "X"]);
  assert.ok(warnings.some((w) => w.includes("DAT"))); // design io column absent from file
});

test("migrate: a v1 file gains an empty io array and per-row io cells (FR-115i)", () => {
  const back = deserializeVectors({
    formatVersion: 1,
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }],
    rows: [{ in: ["0"], out: ["L"] }],
  });
  assert.deepEqual(back.io, []);
  assert.deepEqual(back.rows[0].io, []);
});

test("emptyRow sizes to the columns with default 0 inputs and X outputs", () => {
  const cols = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }, { refdes: "A-2", pin: "OUT", label: "B" }],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
  };
  assert.deepEqual(emptyRow(cols), { in: ["0", "0"], io: [], out: ["X"] });
});

test("emptyRow: an io column defaults its cell to X (FR-115i)", () => {
  const cols = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [],
    io: [{ refdes: "A-5", pin: "P", label: "BUS" }],
  };
  assert.deepEqual(emptyRow(cols), { in: ["0"], io: ["X"], out: [] });
});

// --- inactive-level input defaults (FR-115p) ---

test("isActiveLowName: a leading or trailing slash, and nothing else (FR-115p)", () => {
  for (const n of ["/R", "CS/", "/BOTH/", "/"]) assert.equal(isActiveLowName(n), true, n);
  for (const n of ["A/B", "AB", "", undefined, null]) assert.equal(isActiveLowName(n), false, String(n));
});

test("deriveColumns stamps activeLow on input columns from the instance's own label (FR-115p)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"), { label: "/RESET" });
  place(d, "A-2", builtin("switch"), { label: "DATA" });
  place(d, "A-3", builtin("indicator"), { label: "/Q" }); // an output: never stamped
  const byRef = Object.fromEntries(deriveColumns(d).inputs.map((c) => [c.refdes, c]));
  assert.equal(byRef["A-1"].activeLow, true);
  assert.equal(byRef["A-2"].activeLow, undefined);
  assert.equal(deriveColumns(d).outputs[0].activeLow, undefined);
});

test("deriveColumns stamps every bit of an active-low portN, whose per-bit labels test false (FR-115p)", () => {
  const d = createDesign("t");
  const p = addInstance(d, portNType(8), 0, 0, 0);
  p.label = "CS/";
  const u = addInstance(d, NOT, 10, 0, 0);
  for (let i = 0; i < 8; i++) wire(d, p.refdes, `P${i}`, u.refdes, "A"); // drives loads → input port
  const cols = deriveColumns(d);
  assert.equal(cols.inputs.length, 8);
  assert.deepEqual(cols.inputs.map((c) => c.activeLow), new Array(8).fill(true));
  // The point: each per-bit label on its own is not active-low. The stamp comes
  // from the instance's base label, which is the only place the slash survives.
  assert.deepEqual(cols.inputs.map((c) => c.label), ["CS/0", "CS/1", "CS/2", "CS/3", "CS/4", "CS/5", "CS/6", "CS/7"]);
  assert.ok(cols.inputs.every((c) => !isActiveLowName(c.label)));
});

test("emptyRow: an active-low input defaults 1, a clock still C even when active-low (FR-115p)", () => {
  const cols = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "/RESET", activeLow: true },
      { refdes: "A-2", pin: "OUT", label: "DATA" },
      { refdes: "A-3", pin: "OUT", label: "/CLK", kind: "clock", activeLow: true },
    ],
    outputs: [{ refdes: "A-4", pin: "IN", label: "/Q" }],
    io: [{ refdes: "A-5", pin: "P", label: "/BUS" }],
  };
  assert.deepEqual(emptyRow(cols), { in: ["1", "0", "C"], io: ["X"], out: ["X"] });
});

test("reconcileVectors: a column the file omits comes in at its inactive level (FR-115p)", () => {
  // The file predates the /RESET switch and authored a deliberate 0 into /CS.
  const fileDoc = deserializeVectors({
    formatVersion: 3,
    inputs: [{ refdes: "A-2", pin: "OUT", label: "/CS" }],
    outputs: [],
    rows: [{ in: ["0"], io: [], out: [] }],
  });
  const columns = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "/RESET", activeLow: true },
      { refdes: "A-2", pin: "OUT", label: "/CS", activeLow: true },
      { refdes: "A-3", pin: "OUT", label: "DATA" },
      { refdes: "A-4", pin: "OUT", label: "CLK", kind: "clock" },
    ],
    outputs: [{ refdes: "A-5", pin: "IN", label: "Q" }],
  };
  const { rows } = reconcileVectors(fileDoc, columns);
  // Manufactured cells: 1 (active-low), 0 (plain), C (clock), X (output). The
  // cell the file records — a 0 in an active-low column — is taken verbatim.
  assert.deepEqual(rows[0].in, ["1", "0", "0", "C"]);
  assert.deepEqual(rows[0].out, ["X"]);
  // Cell for cell, a manufactured row is what emptyRow would have produced.
  assert.deepEqual(emptyRow(columns).in, ["1", "1", "0", "C"]);
});

test("serializeVectors drops activeLow, so the .tv shape and formatVersion are unchanged (FR-115p/§7.7)", () => {
  const cols = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "/RESET", activeLow: true }],
    outputs: [],
    io: [],
  };
  const out = serializeVectors({ ...cols, rows: [emptyRow(cols)] });
  assert.deepEqual(Object.keys(out.inputs[0]).sort(), ["label", "pin", "refdes"]);
  assert.equal(out.formatVersion, FORMAT_VERSION);
});

test("cloneRow copies every cell of a row, io included (FR-115j)", () => {
  const row = { in: ["0", "1", "C"], io: ["0", "H"], out: ["H", "L", "X"] };
  assert.deepEqual(cloneRow(row), row);
});

test("cloneRow is an independent copy — editing the copy leaves the original (FR-115j)", () => {
  const row = { in: ["0"], io: ["X"], out: ["H"] };
  const copy = cloneRow(row);
  copy.in[0] = "1";
  copy.io[0] = "L";
  copy.out[0] = "L";
  assert.deepEqual(row, { in: ["0"], io: ["X"], out: ["H"] });
});

test("cloneRow: a row missing its io array clones to an empty one (FR-115j)", () => {
  assert.deepEqual(cloneRow({ in: ["1"], out: ["X"] }), { in: ["1"], io: [], out: ["X"] });
});

// --- bit groups and hexadecimal cells (FR-115k) ---

// bits builds the column run a width-w multi-bit instance contributes.
const bits = (refdes, base, w, pin = "P") =>
  Array.from({ length: w }, (_, i) => ({ refdes, pin: `${pin}${i}`, label: `${base}${i}`, base, bit: i }));

test("bitGroups collects a multi-bit run and skips single-bit columns (FR-115k)", () => {
  const cols = [
    { refdes: "A-6", pin: "OUT", label: "S" }, // a switch: no bit marker
    ...bits("A-24", "Ain-low", 8),
    { refdes: "A-7", pin: "P", label: "ENA" }, // a 1-wide port
  ];
  assert.deepEqual(bitGroups(cols), [{ refdes: "A-24", base: "Ain-low", start: 1, width: 8 }]);
});

test("bitGroups keeps adjacent groups apart and ignores a width-1 instance (FR-115k)", () => {
  const cols = [...bits("A-1", "Out0-7", 8), ...bits("A-2", "Out8-15", 8), ...bits("A-3", "solo", 1)];
  assert.deepEqual(bitGroups(cols), [
    { refdes: "A-1", base: "Out0-7", start: 0, width: 8 },
    { refdes: "A-2", base: "Out8-15", start: 8, width: 8 },
  ]);
});

test("deriveColumns marks portN and indicator8 bits with base and bit (FR-115k)", () => {
  const d = createDesign("t");
  const p = addInstance(d, portNType(8), 0, 0, 0);
  p.label = "S0-2"; // a label ending in a digit: base must come from the instance
  const cols = deriveColumns(d);
  const all = [...cols.inputs, ...cols.io, ...cols.outputs].filter((c) => c.refdes === p.refdes);
  assert.equal(all.length, 8);
  assert.deepEqual(all.map((c) => c.base), new Array(8).fill("S0-2"));
  assert.deepEqual(all.map((c) => c.bit), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(all[0].label, "S0-20"); // per-bit label; no suffix rule could recover the base
  assert.deepEqual(bitGroups(all), [{ refdes: p.refdes, base: "S0-2", start: 0, width: 8 }]);
});

test("groupDigits is ceil(width/4) (FR-115k)", () => {
  assert.deepEqual([1, 4, 5, 6, 8, 16].map(groupDigits), [1, 1, 2, 2, 2, 4]);
});

test("hex round-trips an input group MSB-first (FR-115k)", () => {
  // 0xA5 = 1010_0101, bit 7 (the last cell) most significant.
  const cells = ["1", "0", "1", "0", "0", "1", "0", "1"];
  assert.deepEqual(groupToHex(cells, "in"), { role: null, text: "A5" });
  assert.deepEqual(groupFromHex("A5", { kind: "in", width: 8 }).cells, cells);
});

test("hex input accepts lower case and zero-extends short text (FR-115k)", () => {
  const { cells } = groupFromHex("5", { kind: "in", width: 8 });
  assert.deepEqual(groupToHex(cells, "in").text, "05");
  assert.deepEqual(groupFromHex("a5", { kind: "in", width: 8 }).cells, groupFromHex("A5", { kind: "in", width: 8 }).cells);
});

test("hex rejects a value too wide for the group instead of truncating (FR-115k)", () => {
  assert.match(groupFromHex("4F", { kind: "in", width: 6 }).error ?? "", /exceeds 6 bits/); // 0x4F > 63
  assert.deepEqual(groupFromHex("3F", { kind: "in", width: 6 }).cells, new Array(6).fill("1")); // 0x3F is exactly 6 bits
  assert.match(groupFromHex("A5F", { kind: "in", width: 8 }).error ?? "", /too many digits/);
  assert.match(groupFromHex("G0", { kind: "in", width: 8 }).error ?? "", /hex digits/);
  assert.match(groupFromHex("X0", { kind: "in", width: 8 }).error ?? "", /hex digits/); // X is not an input symbol
});

test("a partial top digit takes only its own bits (FR-115k)", () => {
  // width 6: digit 1 covers bits 4..5 only, so 0x2F = 10_1111.
  const { cells } = groupFromHex("2F", { kind: "in", width: 6 });
  assert.deepEqual(cells, ["1", "1", "1", "1", "0", "1"]);
  assert.equal(groupToHex(cells, "in").text, "2F");
});

test("an output group renders H/L as digits and an all-X digit as X (FR-115k)", () => {
  const cells = ["H", "L", "H", "L", "X", "X", "X", "X"];
  assert.deepEqual(groupToHex(cells, "out"), { role: null, text: "X5" });
  assert.deepEqual(groupFromHex("X5", { kind: "out", width: 8 }).cells, cells);
});

test("an output digit mixing X with H/L has no hex form (FR-115k)", () => {
  assert.equal(groupToHex(["H", "X", "L", "L", "L", "L", "L", "L"], "out"), null);
});

test("groupRole classifies a bidirectional group's row (FR-115k)", () => {
  assert.equal(groupRole(["0", "1", "1", "0"]), "drive");
  assert.equal(groupRole(["X", "X", "X", "X"]), "ignore");
  assert.equal(groupRole(["H", "L", "X", "H"]), "expect");
  assert.equal(groupRole(["0", "H", "X", "X"]), null); // mixed drive and release
});

test("an io group round-trips per role (FR-115k)", () => {
  const drive = groupFromHex("A5", { kind: "io", width: 8, role: "drive" }).cells;
  assert.deepEqual(drive, ["1", "0", "1", "0", "0", "1", "0", "1"]);
  assert.deepEqual(groupToHex(drive, "io"), { role: "drive", text: "A5" });

  const expect = groupFromHex("A5", { kind: "io", width: 8, role: "expect" }).cells;
  assert.deepEqual(expect, ["H", "L", "H", "L", "L", "H", "L", "H"]);
  assert.deepEqual(groupToHex(expect, "io"), { role: "expect", text: "A5" });

  const ignore = groupFromHex("", { kind: "io", width: 8, role: "ignore" }).cells;
  assert.deepEqual(ignore, new Array(8).fill("X"));
  assert.deepEqual(groupToHex(ignore, "io"), { role: "ignore", text: "" });
});

test("an all-X io group reads as ignore, or as expect when that role is held (FR-115k)", () => {
  const allX = new Array(8).fill("X");
  assert.deepEqual(groupToHex(allX, "io"), { role: "ignore", text: "" });
  assert.deepEqual(groupToHex(allX, "io", "expect"), { role: "expect", text: "XX" });
  // An override the cells cannot accept is ignored, not obeyed.
  assert.deepEqual(groupToHex(allX, "io", "drive"), { role: "ignore", text: "" });
  assert.deepEqual(groupToHex(["1", "0", "1", "0"], "io", "expect"), { role: "drive", text: "5" });
});

test("an io drive cell rejects X, an expect cell allows it (FR-115k)", () => {
  assert.match(groupFromHex("X5", { kind: "io", width: 8, role: "drive" }).error ?? "", /hex digits/);
  assert.deepEqual(groupFromHex("X5", { kind: "io", width: 8, role: "expect" }).cells.slice(4), ["X", "X", "X", "X"]);
});

test("an io row mixing drive and release cells has no hex form (FR-115k)", () => {
  assert.equal(groupToHex(["0", "1", "H", "X"], "io"), null);
});

test("groupActualHex shows an undetermined digit as ? (FR-115d/FR-115k)", () => {
  assert.equal(groupActualHex(["1", "0", "1", "0", "0", "1", "0", "1"]), "A5");
  assert.equal(groupActualHex(["1", "0", "1", "0", "0", "U", "0", "1"]), "?5");
  assert.equal(groupActualHex(["Z", "Z", "Z", "Z", "Z", "Z", "Z", "Z"]), "??");
});

test("group markers stay out of the saved file (FR-115k)", () => {
  const cols = bits("A-24", "Ain-low", 2);
  const saved = serializeVectors({ inputs: cols, outputs: [], io: [], rows: [{ in: ["0", "1"], io: [], out: [] }] });
  assert.deepEqual(saved.inputs, [
    { refdes: "A-24", pin: "P0", label: "Ain-low0" },
    { refdes: "A-24", pin: "P1", label: "Ain-low1" },
  ]);
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

test("ports: a bidir port becomes an io column, or a definite column when overridden (FR-115i/FR-094d)", () => {
  const d = createDesign("t");
  const u = addInstance(d, BIDIR, 10, 0, 0);
  const p = addInstance(d, PORT, 0, 0, 0);
  p.label = "BUS";
  wire(d, u.refdes, "IO", p.refdes, "P");

  let cols = deriveColumns(d);
  assert.equal(cols.inputs.length, 0);
  assert.equal(cols.outputs.length, 0);
  assert.deepEqual(cols.io.map((c) => [c.refdes, c.pin]), [[p.refdes, "P"]]);
  assert.equal(cols.warnings.length, 0);

  p.dirOverride = "out"; // pin the bidir port to a single-role output (FR-094d)
  cols = deriveColumns(d);
  assert.deepEqual(cols.outputs.map((c) => [c.refdes, c.pin]), [[p.refdes, "P"]]);
  assert.equal(cols.io.length, 0);
  assert.equal(cols.warnings.length, 0);
});

test("io columns: a drive cell forces the net, a release cell leaves it floating (FR-115i)", () => {
  const d = createDesign("t");
  const ind = addInstance(d, builtin("indicator"), 0, 0, 0);
  const p = addInstance(d, PORT, 10, 0, 0);
  p.label = "BUS";
  wire(d, p.refdes, "P", ind.refdes, "IN"); // port and indicator share one net

  // Hand-crafted io column: the runner treats whatever is in `io` as a
  // bidirectional bus column, driving 0/1 and releasing H/L/X (FR-115i).
  const cols = {
    inputs: [],
    outputs: [{ refdes: ind.refdes, pin: "IN", label: "Q" }],
    io: [{ refdes: p.refdes, pin: "P", label: "BUS" }],
  };
  const res = runVectors(d, {
    ...cols,
    rows: [
      { in: [], io: ["1"], out: ["H"] }, // drive bus high → indicator reads H
      { in: [], io: ["L"], out: ["X"] }, // release → nothing drives → net floats Z
    ],
  });
  assert.equal(res.rows[0].pass, true);
  assert.deepEqual(res.rows[0].io[0], { drive: "1" }); // drive cell: stimulus, not scored
  assert.equal(res.rows[1].pass, false); // io "L" fails: released net floats Z
  assert.equal(res.rows[1].io[0].pass, false);
  assert.equal(res.rows[1].io[0].actual, "Z");
});

test("io capture: release cells filled from the settled net, drive cells preserved (FR-115i)", () => {
  const d = createDesign("t");
  const sw = addInstance(d, builtin("switch"), 0, 0, 0);
  const p = addInstance(d, PORT, 10, 0, 0);
  p.label = "BUS";
  wire(d, sw.refdes, "OUT", p.refdes, "P"); // the switch drives the bus net

  const cols = {
    inputs: [{ refdes: sw.refdes, pin: "OUT", label: "SW" }],
    outputs: [],
    io: [{ refdes: p.refdes, pin: "P", label: "BUS" }],
  };
  const cap = captureVectors(d, cols, [["1"], ["0"], ["1"]], { rowsIo: [["H"], ["X"], ["0"]] });
  // row0 release H, net=1 → H; row1 release X, net=0 → L; row2 drive "0" preserved.
  assert.deepEqual(cap.io, [["H"], ["L"], ["0"]]);
  assert.deepEqual(cap.out, [[], [], []]);
});

// TRIB: a tristate buffer (Y = A while EN high, else high-Z). A port on Y's net
// genuinely DERIVES bidir (Y is a tristate pin), so deriveColumns bins it as io.
const TRIB = {
  name: "TRIB",
  renderType: "unit",
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "EN", side: "left", position: 2, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "tristate" },
  ],
  behavior: "Y.T = A\nY.E = EN\n",
};

test("io end-to-end: a real bidir port drives some cycles and observes others (FR-115i)", () => {
  const d = createDesign("t");
  const swA = addInstance(d, builtin("switch"), 0, 0, 0);
  swA.label = "DAT";
  const swE = addInstance(d, builtin("switch"), 0, 10, 0);
  swE.label = "OE";
  const u = addInstance(d, TRIB, 10, 0, 0);
  const ind = addInstance(d, builtin("indicator"), 20, 0, 0);
  ind.label = "OBS";
  const p = addInstance(d, PORT, 20, 10, 0);
  p.label = "BUS";
  wire(d, swA.refdes, "OUT", u.refdes, "A");
  wire(d, swE.refdes, "OUT", u.refdes, "EN");
  wire(d, u.refdes, "Y", ind.refdes, "IN"); // observer on the bus
  wire(d, u.refdes, "Y", p.refdes, "P"); // the bidir bus port

  const cols = deriveColumns(d);
  assert.deepEqual(cols.io.map((c) => c.label), ["BUS"]); // derived bidir → io
  assert.deepEqual(cols.outputs.map((c) => c.label), ["OBS"]);
  const iA = cols.inputs.findIndex((c) => c.refdes === swA.refdes);
  const iE = cols.inputs.findIndex((c) => c.refdes === swE.refdes);
  const mk = (a, oe, ioSym, outSym) => {
    const inArr = [];
    inArr[iA] = a;
    inArr[iE] = oe;
    return { in: inArr, io: [ioSym], out: [outSym] };
  };

  const res = runVectors(d, {
    ...cols,
    rows: [
      mk("1", "1", "H", "H"), // design drives 1; observe io H
      mk("0", "1", "L", "L"), // design drives 0; observe io L
      mk("0", "0", "1", "H"), // design released; harness drives 1 → observer H
      mk("0", "0", "0", "L"), // harness drives 0 → observer L
      mk("1", "1", "0", "X"), // design drives 1 AND harness drives 0 → conflict
    ],
  });
  assert.equal(res.passed, 5);
  assert.equal(res.rows[0].io[0].pass, true); // release cell scored
  assert.deepEqual(res.rows[2].io[0], { drive: "1" }); // drive cell not scored
  assert.equal(res.rows[2].cells[0].actual, "1"); // harness drove the bus into the observer
  assert.equal(res.rows[4].cells[0].actual, "U"); // contended drive → bus conflict (FR-082)
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

// --- scripted clock sources (FR-115e/FR-094f) ---

test("clockSources: empty for a combinational design", () => {
  assert.deepEqual(clockSources(bufferDesign()), []);
  assert.deepEqual(clockSources({ name: "empty" }), []); // no components at all
});

test("clockSources: a placed clock built-in, at its OUT pin", () => {
  const d = bufferDesign();
  place(d, "A-3", builtin("clock"));
  assert.deepEqual(clockSources(d), [{ refdes: "A-3", pin: "OUT" }]);
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

// --- clock-source ports (FR-094f) ---

// portClockedDff: the same DFF, but its clock arrives on a PORT rather than from
// a placed clock generator — the notL4C381 shape (a board clocked from outside).
// `marked` sets the FR-094f flag.
function portClockedDff({ marked = true } = {}) {
  const d = createDesign("t");
  const u = addInstance(d, DFF, 10, 10, 0);
  const clk = addInstance(d, PORT, 0, 0, 0);
  clk.label = "CLK";
  if (marked) clk.isClock = true;
  const dIn = addInstance(d, PORT, 0, 10, 0);
  dIn.label = "D";
  const q = addInstance(d, PORT, 20, 10, 0);
  q.label = "Q";
  wire(d, clk.refdes, "P", u.refdes, "CP");
  wire(d, dIn.refdes, "P", u.refdes, "D");
  wire(d, u.refdes, "Q", q.refdes, "P");
  return { d, clk, dIn, q, u };
}

test("clockSources: a marked port is a clock source at its P pin (FR-094f)", () => {
  const { d, clk } = portClockedDff();
  assert.deepEqual(clockSources(d), [{ refdes: clk.refdes, pin: "P" }]);
  // The same design unmarked has none — the label "CLK" means nothing.
  assert.deepEqual(clockSources(portClockedDff({ marked: false }).d), []);
});

test("deriveColumns: a marked port is a kind:'clock' column; emptyRow defaults it C (FR-094f)", () => {
  const { d, clk, dIn } = portClockedDff();
  const cols = deriveColumns(d);
  const byRef = Object.fromEntries(cols.inputs.map((c) => [c.refdes, c]));
  assert.equal(byRef[clk.refdes].kind, "clock");
  assert.equal(byRef[clk.refdes].pin, "P"); // its own identity, unchanged
  assert.equal(byRef[dIn.refdes].kind, undefined); // an ordinary input port
  assert.equal(cols.warnings.length, 0);
  // A new row defaults the clock cell C and the others 0 — same as a generator.
  const clkAt = cols.inputs.findIndex((c) => c.refdes === clk.refdes);
  assert.equal(emptyRow(cols).in[clkAt], "C");
});

test("serializeVectors: a marked port's kind is live-only, so the .tv is unchanged (FR-094f/§7.7)", () => {
  const { d, clk } = portClockedDff();
  const cols = deriveColumns(d);
  const out = serializeVectors({ ...cols, rows: [emptyRow(cols)] });
  const col = out.inputs.find((c) => c.refdes === clk.refdes);
  assert.deepEqual(Object.keys(col).sort(), ["label", "pin", "refdes"]); // no kind
  assert.equal(out.formatVersion, FORMAT_VERSION); // no bump
});

test("sequential run: a marked port clocks the register — C pulses, 0 holds (FR-094f)", () => {
  const { d, clk, dIn } = portClockedDff();
  const cols = deriveColumns(d);
  const at = (r) => cols.inputs.findIndex((c) => c.refdes === r);
  const row = (dv, cv, expect) => {
    const inSyms = new Array(cols.inputs.length).fill("0");
    inSyms[at(dIn.refdes)] = dv;
    inSyms[at(clk.refdes)] = cv;
    return { in: inSyms, out: [expect] };
  };
  const res = runVectors(d, {
    ...cols,
    rows: [
      row("1", "C", "H"), // pulse latches D=1
      row("0", "0", "H"), // clock held low: Q keeps its state across rows
      row("0", "C", "L"), // pulse latches D=0
    ],
  });
  assert.equal(res.passed, 3);
  assert.equal(res.total, 3);
});

test("sequential run: a 0→1 level change across rows is a real edge (FR-094f/FR-115e)", () => {
  // The level-cell idiom: no C anywhere, just a clock line walked low then high
  // between rows — an edge only because rows share one simulation instance.
  const { d, clk, dIn } = portClockedDff();
  const cols = deriveColumns(d);
  const at = (r) => cols.inputs.findIndex((c) => c.refdes === r);
  const row = (dv, cv, expect) => {
    const inSyms = new Array(cols.inputs.length).fill("0");
    inSyms[at(dIn.refdes)] = dv;
    inSyms[at(clk.refdes)] = cv;
    return { in: inSyms, out: [expect] };
  };
  const res = runVectors(d, {
    ...cols,
    rows: [
      row("1", "0", "X"), // set up D=1 with the clock low
      row("1", "1", "H"), // rising edge here: Q takes D
      row("0", "1", "H"), // no new edge (still high): Q holds
    ],
  });
  assert.equal(res.passed, 3);
});

test("without the mark the design is stateless and the register never clocks (FR-094f)", () => {
  // The regression this feature fixes: a clock arriving on an unmarked port
  // leaves the design combinational, so each row runs on a fresh simulation and
  // the register's prevClock goes U→1 — never the 0→1 its edge test needs.
  const { d, clk, dIn } = portClockedDff({ marked: false });
  assert.equal(isStateful(d), false);
  const cols = deriveColumns(d);
  assert.ok(cols.inputs.every((c) => c.kind === undefined)); // no clock column
  const at = (r) => cols.inputs.findIndex((c) => c.refdes === r);
  const row = (dv, cv) => {
    const inSyms = new Array(cols.inputs.length).fill("0");
    inSyms[at(dIn.refdes)] = dv;
    inSyms[at(clk.refdes)] = cv;
    return { in: inSyms, out: ["X"] };
  };
  const res = runVectors(d, { ...cols, rows: [row("1", "0"), row("1", "1")] });
  assert.equal(res.sim.valueOfPin("U1", "Q"), 2); // VU — never latched
});

test("isStateful: a marked port alone makes the design stateful (FR-094f)", () => {
  assert.equal(isStateful(portClockedDff().d), true);
});

test("deriveColumns: an unhonorable clock mark is ignored with a warning (FR-094f)", () => {
  // On a multi-bit port: a clock is one bit.
  const d1 = createDesign("t");
  const p = addInstance(d1, portNType(2), 0, 0, 0);
  p.label = "B";
  p.isClock = true;
  const u = addInstance(d1, NOT, 10, 0, 0);
  wire(d1, p.refdes, "P0", u.refdes, "A");
  const c1 = deriveColumns(d1);
  assert.equal(c1.warnings.length, 1);
  assert.match(c1.warnings[0], /multi-bit/);
  assert.ok(c1.inputs.every((c) => c.kind === undefined));
  assert.deepEqual(clockSources(d1), []);
  assert.equal(isStateful(d1), false);

  // On an output port: not an input column at all.
  const d2 = createDesign("t");
  const u2 = addInstance(d2, NOT, 10, 0, 0);
  const out = addInstance(d2, PORT, 20, 0, 0);
  out.label = "Y";
  out.isClock = true;
  wire(d2, u2.refdes, "Y", out.refdes, "P");
  const c2 = deriveColumns(d2);
  assert.equal(c2.warnings.length, 1);
  assert.match(c2.warnings[0], /not in/);
  assert.ok(c2.outputs.every((c) => c.kind === undefined));
  assert.deepEqual(clockSources(d2), []);
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

test("run through a selected row: only rows up to it run, and its sim is held (FR-115l)", () => {
  const d = dffDesign();
  const cols = deriveColumns(d); // inputs: [D switch, clock]
  const rows = [
    { in: ["1", "C"], out: ["H"] }, // pulse latches D=1
    { in: ["0", "C"], out: ["L"] }, // pulse latches D=0
    { in: ["1", "C"], out: ["H"] }, // pulse latches D=1 again
  ];
  const res = runVectors(d, { ...cols, rows }, { through: 1 });
  assert.equal(res.through, 1);
  assert.equal(res.total, 2); // rows 3.. were not run
  assert.equal(res.rows.length, 2);
  assert.equal(res.passed, 2);
  // The held sim carries row 2's state — Q latched low — not row 3's.
  assert.equal(res.sim.valueOfPin("U1", "Q"), V0);
});

test("run through: state is reached by replaying from row 1, not resumed (FR-115l)", () => {
  const d = dffDesign();
  const cols = deriveColumns(d);
  const rows = [
    { in: ["1", "C"], out: ["H"] },
    { in: ["0", "0"], out: ["H"] }, // clock low: Q holds the 1 from row 1
  ];
  // Running through row 2 twice yields the same state both times: each run
  // starts over at row 1 (preamble included), so no earlier hold leaks in.
  const a = runVectors(d, { ...cols, rows }, { through: 1 });
  const b = runVectors(d, { ...cols, rows }, { through: 1 });
  assert.equal(a.sim.valueOfPin("U1", "Q"), V1);
  assert.equal(b.sim.valueOfPin("U1", "Q"), V1);
});

test("run through: combinational rows stop at the hold point and hold that row (FR-115l)", () => {
  const d = bufferDesign();
  const cols = deriveColumns(d);
  const rows = [{ in: ["1"], out: ["H"] }, { in: ["0"], out: ["L"] }, { in: ["1"], out: ["H"] }];
  const res = runVectors(d, { ...cols, rows }, { through: 1 });
  assert.equal(res.total, 2);
  assert.equal(res.passed, 2);
  assert.equal(res.sim.valueOfPin("A-1", "OUT"), V0); // row 2's input switch state
});

test("run through: omitted/out-of-range `through` runs the whole table (FR-115l)", () => {
  const d = bufferDesign();
  const cols = deriveColumns(d);
  const rows = [{ in: ["1"], out: ["H"] }, { in: ["0"], out: ["L"] }];
  assert.equal(runVectors(d, { ...cols, rows }).through, 1); // omitted → last row
  assert.equal(runVectors(d, { ...cols, rows }, { through: 99 }).total, 2); // clamped up
  assert.equal(runVectors(d, { ...cols, rows }, { through: -5 }).total, 1); // clamped down
});

test("run through: a held sim does not mutate the live design (FR-115c/FR-115l)", () => {
  const d = dffDesign();
  const before = JSON.stringify(d);
  const cols = deriveColumns(d);
  const res = runVectors(
    d,
    { ...cols, rows: [{ in: ["1", "C"], out: ["H"] }, { in: ["0", "C"], out: ["L"] }] },
    { through: 0 },
  );
  assert.ok(res.sim); // retained for the held display
  assert.equal(JSON.stringify(d), before); // …and still no write-back
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
  assert.deepEqual(outs.out, [["H"], ["H"], ["L"]]);
});

test("captureVectors: combinational designs capture rows independently", () => {
  const d = inverterDesign();
  const cols = deriveColumns(d);
  assert.deepEqual(captureVectors(d, cols, [["0"], ["1"]]).out, [["H"], ["L"]]);
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

test("serializeVectors: strips the live-only kind marker and stamps v3 (§7.7)", () => {
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

// --- Live column reconciliation (§6.16, FR-115h) -----------------------------
//
// With the read-only lock removed (2026-08-02) the design can change while the
// test-vector panel is open, so the panel re-derives its columns and realigns
// its rows. It does that by reusing this pair — serializeVectors then
// reconcileVectors — with the LIVE TABLE playing the part of a loaded file and
// the design supplying the columns. These tests pin that usage, which is the
// reason removing the lock was cheap: no new alignment logic exists.

const liveTable = (columns, rows) =>
  deserializeVectors(serializeVectors({ ...columns, rows }));

test("live reconcile: an unchanged column set returns the rows untouched (FR-115h)", () => {
  // The no-op case matters most: a design edit that does not touch the bound I/O
  // must not disturb a single authored cell.
  const columns = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-2", pin: "IN", label: "Q" }],
    io: [],
  };
  const rows = [
    { in: ["1"], io: [], out: ["H"] },
    { in: ["0"], io: [], out: ["L"] },
  ];
  const { rows: out, warnings } = reconcileVectors(liveTable(columns, rows), columns);
  assert.deepEqual(out, rows);
  assert.deepEqual(warnings, []);
});

test("live reconcile: a gained column arrives at its default, others preserved (FR-115h)", () => {
  const before = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "A" }],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
    io: [],
  };
  const rows = [{ in: ["1"], io: [], out: ["H"] }];
  // The user drops in a second input switch, sorted between the two existing
  // columns, plus an io port.
  const after = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "A" },
      { refdes: "A-2", pin: "OUT", label: "B" },
    ],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
    io: [{ refdes: "A-4", pin: "P", label: "BUS" }],
  };
  const { rows: out, warnings } = reconcileVectors(liveTable(before, rows), after);
  assert.deepEqual(out[0].in, ["1", "0"]); // authored cell kept, new one defaulted
  assert.deepEqual(out[0].out, ["H"]); // untouched
  assert.deepEqual(out[0].io, ["X"]); // new io column defaults to release (FR-115i)
  assert.ok(warnings.some((w) => w.includes("A-2")));
  assert.ok(warnings.some((w) => w.includes("A-4")));
});

test("live reconcile: an active-low column gained defaults to its inactive level (FR-115p)", () => {
  // A gained input comes in at the level that leaves the circuit alone, which
  // for an active-low signal is 1 — the same rule emptyRow follows.
  const before = { inputs: [], outputs: [], io: [] };
  const after = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "RESET/", activeLow: true }],
    outputs: [],
    io: [],
  };
  const { rows } = reconcileVectors(liveTable(before, [{ in: [], io: [], out: [] }]), after);
  assert.deepEqual(rows[0].in, ["1"]);
});

test("live reconcile: a dropped column takes only its own cells (FR-115h)", () => {
  const before = {
    inputs: [
      { refdes: "A-1", pin: "OUT", label: "A" },
      { refdes: "A-2", pin: "OUT", label: "B" },
    ],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
    io: [],
  };
  const rows = [{ in: ["1", "0"], io: [], out: ["H"] }];
  // A-1 is deleted from the design; B and Q must keep their authored values.
  const after = {
    inputs: [{ refdes: "A-2", pin: "OUT", label: "B" }],
    outputs: [{ refdes: "A-3", pin: "IN", label: "Q" }],
    io: [],
  };
  const { rows: out, warnings } = reconcileVectors(liveTable(before, rows), after);
  assert.deepEqual(out[0].in, ["0"]);
  assert.deepEqual(out[0].out, ["H"]);
  assert.ok(warnings.some((w) => w.includes("A-1")));
});

test("live reconcile: a relabeled column keeps its cells — identity is (refdes,pin) (FR-115h)", () => {
  // Renaming a switch's display label (FR-011b) changes a heading, not a column:
  // the cells must survive, which is why the panel reconciles rather than rebuilds.
  const before = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "old name" }],
    outputs: [],
    io: [],
  };
  const rows = [{ in: ["1"], io: [], out: [] }, { in: ["0"], io: [], out: [] }];
  const after = {
    inputs: [{ refdes: "A-1", pin: "OUT", label: "new name" }],
    outputs: [],
    io: [],
  };
  const { rows: out, warnings } = reconcileVectors(liveTable(before, rows), after);
  assert.deepEqual(out, rows);
  assert.deepEqual(warnings, []);
});
