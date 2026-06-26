import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveColumns,
  runVectors,
  captureRow,
  validateVectors,
  serializeVectors,
  deserializeVectors,
  reconcileVectors,
  migrate,
  emptyRow,
  FORMAT_VERSION,
} from "./vectors.js";
import { BUILTINS } from "../builtins.js";

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

test("migrate: a versionless file is treated as v1 (already at target, returned as-is)", () => {
  const obj = { inputs: [], outputs: [], rows: [{ in: ["0"], out: ["L"] }] };
  // At the current target there is nothing to upgrade, so migrate returns the
  // object unchanged (serializeVectors is what stamps formatVersion on write).
  assert.deepEqual(migrate(obj), obj);
  // A run-through deserialize still yields a usable doc.
  assert.equal(deserializeVectors(obj).rows.length, 1);
  // An unknown future-version step throws a legible error.
  assert.throws(
    () => migrate({ formatVersion: 1 }, { target: 2, migrations: {} }),
    /no migration from version 1 to 2/,
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
