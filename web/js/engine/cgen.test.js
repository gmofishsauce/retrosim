import { test } from "node:test";
import assert from "node:assert/strict";

import { generateC } from "./cgen.js";
import { BUILTINS } from "../builtins.js";

// --- design fixtures (literal model shapes per §7.1a/§7.2), mirroring
// vectors.test.js ---

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

// TBUF: tristate buffer (Y.T = A, enabled by E) — exercises .E lowering.
const TBUF = {
  name: "TBUFX",
  renderType: "unit",
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "E", side: "left", position: 2, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "tristate" },
  ],
  behavior: "Y.T = A\nY.E = E\n",
};

// NOBEHAVE: a type with no behavior block (FR-080).
const NOBEHAVE = {
  name: "NBX",
  renderType: "unit",
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "out" },
  ],
};

function inverterDesign() {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"));
  place(d, "U1", NOT);
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["U1", "A"]);
  connect(d, ["U1", "Y"], ["A-2", "IN"]);
  return d;
}

test("generateC: inverter emits nets, tables, columns, and lowered logic", () => {
  const { code, warnings } = generateC(inverterDesign());
  assert.equal(warnings.length, 0);
  assert.match(code, /const int gen_net_count = 2;/);
  // Switch table with baked level, indexed by the input column.
  assert.match(code, /rt_switch gen_switches\[\] = \{\n  \{ \d+, RT_0, \d+ \}, \/\* A-1 \*\//);
  // Input column: baked (refdes,pin) identity alongside the label (M2).
  assert.match(code, /\{ RT_COL_SWITCH, 0, "A-1", "A-1", "OUT", 0 \}/);
  assert.match(code, /const int gen_incol_count = 1;/);
  // Output column carries its (refdes,pin) identity too.
  assert.match(code, /\{ \d+, "A-2", "A-2", "IN" \}/);
  assert.match(code, /const int gen_outcol_count = 1;/);
  // Lowered Y = /A: a negated literal and a contribution for U1.Y.
  assert.match(code, /rt_not\(curr\[\d+\]\)/);
  assert.match(code, /rt_contrib\(\d+, v, 0, \d+\); *\n *\}/);
  // No clocks: combinational.
  assert.match(code, /const int gen_clock_count = 0;/);
});

test("generateC: declared-active-low output gets the polarity flip", () => {
  const LOWNOT = {
    ...NOT,
    pins: [
      { name: "A", side: "left", position: 1, direction: "in" },
      { name: "/Y", side: "right", position: 1, direction: "out" },
    ],
    behavior: "/Y = A\n",
  };
  const d = mkDesign();
  place(d, "U1", LOWNOT);
  const { code } = generateC(d);
  assert.match(code, /v = rt_not\(v\); \/\* declared active-low \*\//);
});

test("generateC: .T output lowers the enable to the Z/U/value branch", () => {
  const d = mkDesign();
  place(d, "U1", TBUF);
  const { code } = generateC(d);
  assert.match(code, /rt_val e = rt_buf\(RT_Z\)[^;]*; \/\* \.E \*\//);
  assert.match(code, /if \(e == RT_0\) v = RT_Z;/);
  assert.match(code, /else if \(e == RT_U\) v = RT_U;/);
});

test("generateC: behavior-less type drives U and warns once (FR-080)", () => {
  const d = mkDesign();
  place(d, "U1", NOBEHAVE);
  place(d, "U2", NOBEHAVE);
  const { code, warnings } = generateC(d);
  assert.equal(warnings.filter((w) => w.includes("no behavior")).length, 1);
  assert.match(code, /rt_contrib\(-1, RT_U, 0, \d+\); \/\* U1\.Y \*\//);
  assert.match(code, /rt_contrib\(-1, RT_U, 0, \d+\); \/\* U2\.Y \*\//);
});

test("generateC: pulls, unwired probes, and empty tables", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("pullup"));
  place(d, "A-2", builtin("indicator"));
  connect(d, ["A-1", "OUT"], ["A-2", "IN"]);
  const { code } = generateC(d);
  assert.match(code, /const rt_pull gen_pulls\[\] = \{\n  \{ 0, RT_1, 0 \},/);
  assert.match(code, /const int gen_pull_count = 1;/);
  // No switches: dummy entry, count 0.
  assert.match(code, /rt_switch gen_switches\[\] = \{ \{ -1, RT_0, 0 \} \}; \/\* none \*\//);
  assert.match(code, /const int gen_switch_count = 0;/);
});

test("generateC: refuses registered outputs until M3", () => {
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
  const d = mkDesign();
  place(d, "U1", DFF);
  assert.throws(() => generateC(d), /registered \(\.R\) outputs are not yet supported/);
});

test("generateC: refuses memory devices and sub-design instances", () => {
  const d = mkDesign();
  place(d, "U1", { name: "ROMX", renderType: "unit", pins: [], mem: { kind: "rom" } });
  assert.throws(() => generateC(d), /memory devices are not yet supported/);

  const d2 = mkDesign();
  place(d2, "X1", { name: "sub", renderType: "unit", pins: [] }, { childPath: "/tmp/child.json" });
  assert.throws(() => generateC(d2), /sub-design instances are not supported/);
});

test("generateC: behavior parse error propagates as a throw", () => {
  const BAD = { ...NOT, name: "BADX", behavior: "Y = %\n" };
  const d = mkDesign();
  place(d, "U1", BAD);
  assert.throws(() => generateC(d), /BADX: behavior/);
});
