import { test } from "node:test";
import assert from "node:assert/strict";

import { generateC } from "./cgen.js";
import { BUILTINS, portNFields } from "../builtins.js";
import { flatten } from "../model/subdesign.js";

// --- design fixtures (literal model shapes per §7.1a/§7.2), mirroring
// vectors.test.js ---

function mkDesign() {
  return { name: "t", components: [], wires: [], buses: [], vertices: [], nets: [], seq: 0 };
}

const builtin = (name) => BUILTINS.find((b) => b.name === name);
const portNType = (width) => ({ ...builtin("portN"), ...portNFields(width) });

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
  // Input column: baked (refdes,pin) identity alongside the label (M2), then the
  // active-low flag (M9, FR-115p) — 0 here, the switch's label being its refdes.
  assert.match(code, /\{ RT_COL_SWITCH, 0, "A-1", "A-1", "OUT", 0, 0 \}/);
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

test("generateC: a clock-source port lowers to RT_COL_PORT_CLOCK, not a clock (FR-094f)", () => {
  // A registered part clocked through a marked port (the notL4C381 shape).
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
  place(d, "A-1", builtin("port"), { label: "CLK", isClock: true });
  place(d, "A-2", builtin("port"), { label: "D" });
  place(d, "A-3", builtin("port"), { label: "Q" });
  connect(d, ["A-1", "P"], ["U1", "CP"]);
  connect(d, ["A-2", "P"], ["U1", "D"]);
  connect(d, ["U1", "Q"], ["A-3", "P"]);

  const { code } = generateC(d);
  // The marked port is a clock COLUMN carrying its own (refdes,pin) identity,
  // and it drives a net — it is not indexed into gen_clocks.
  assert.match(code, /\{ RT_COL_PORT_CLOCK, \d+, "CLK", "A-1", "P", \d+, 0 \}/);
  // The unmarked data port stays an ordinary port column.
  assert.match(code, /\{ RT_COL_PORT, \d+, "D", "A-2", "P", \d+, 0 \}/);
  assert.match(code, /const int gen_clockport_count = 1;/);
  // Crucially NOT a synthesized generator: no free-running waveform for it, so
  // --cycles mode and clock_period stay as they are without a clock placed.
  assert.match(code, /const int gen_clock_count = 0;/);
});

test("generateC: an unmarked clock port is an ordinary port column (FR-094f)", () => {
  const d = mkDesign();
  place(d, "U1", NOT);
  place(d, "A-1", builtin("port"), { label: "CLK" }); // named CLK, not marked
  place(d, "A-2", builtin("port"), { label: "Y" });
  connect(d, ["A-1", "P"], ["U1", "A"]);
  connect(d, ["U1", "Y"], ["A-2", "P"]);
  const { code } = generateC(d);
  assert.match(code, /\{ RT_COL_PORT, \d+, "CLK", "A-1", "P", \d+, 0 \}/);
  assert.doesNotMatch(code, /RT_COL_PORT_CLOCK,/);
  assert.match(code, /const int gen_clockport_count = 0;/);
});

test("generateC: bakes the active-low stamp as rt_incol.active_low (FR-115p, M9)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("switch"), { label: "/RESET" }); // active low: leading /
  place(d, "A-2", builtin("switch"), { label: "DATA" }); // plain
  place(d, "A-3", portNType(2), { label: "CS/" }); // active low: trailing /
  place(d, "U1", NOT);
  place(d, "U2", NOT);
  connect(d, ["A-3", "P0"], ["U1", "A"]);
  connect(d, ["A-3", "P1"], ["U2", "A"]);

  const { code } = generateC(d);
  assert.match(code, /\{ RT_COL_SWITCH, \d+, "\/RESET", "A-1", "OUT", 0, 1 \}/);
  assert.match(code, /\{ RT_COL_SWITCH, \d+, "DATA", "A-2", "OUT", 0, 0 \}/);
  // Every bit of the port is flagged, though each per-bit label ("CS/0") is not
  // itself active-low — the stamp comes from the instance's base label, which is
  // exactly why the flag is baked instead of recovered from the label (M9).
  assert.match(code, /\{ RT_COL_PORT, \d+, "CS\/0", "A-3", "P0", \d+, 1 \}/);
  assert.match(code, /\{ RT_COL_PORT, \d+, "CS\/1", "A-3", "P1", \d+, 1 \}/);
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
  // The enable pin is unwired, but it still has a net of its own (FR-081a), so
  // the enable reads curr[] rather than the literal RT_Z the old no-net path gave.
  assert.match(code, /rt_val e = rt_buf\(curr\[\d+\]\)[^;]*; \/\* \.E \*\//);
  assert.match(code, /if \(e == RT_0\) v = RT_Z;/);
  assert.match(code, /else if \(e == RT_U\) v = RT_U;/);
});

test("generateC: behavior-less type drives U and warns once (FR-080)", () => {
  const d = mkDesign();
  place(d, "U1", NOBEHAVE);
  place(d, "U2", NOBEHAVE);
  const { code, warnings } = generateC(d);
  assert.equal(warnings.filter((w) => w.includes("no behavior")).length, 1);
  // Each unwired output drives its own single-node net (FR-081a), not net -1.
  assert.match(code, /rt_contrib\(\d+, RT_U, 0, \d+\); \/\* U1\.Y \*\//);
  assert.match(code, /rt_contrib\(\d+, RT_U, 0, \d+\); \/\* U2\.Y \*\//);
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

test("generateC: global-clock .R output emits register state and latch (M3 step 1)", () => {
  const d = mkDesign();
  place(d, "U1", DFF);
  const { code } = generateC(d);
  assert.match(code, /static rt_val reg_U1\[1\];/);
  assert.match(code, /static rt_val prevClk_U1;/);
  assert.match(code, /int grose = \(prevClk_U1 == RT_0 && gclk == RT_1\);/);
  assert.match(code, /reg_U1\[0\] = rt_buf/); // latches D on the rising edge
  assert.match(code, /v = reg_U1\[0\]; \/\* latched \*\//); // drive reads the register
});

// SHIFT2: first stage SR0 is a buried internal node (FR-079c); DS -> SR0 -> Q1.
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

test("generateC: buried internal node becomes a virtual net with register state (FR-079c)", () => {
  const d = mkDesign();
  place(d, "U1", SHIFT2);
  const { code } = generateC(d);
  // The buried node SR0 gets a virtual net even though no conductor exists — on
  // top of the three single-node nets the unwired DS/CP/Q1 pins get (FR-081a).
  assert.match(code, /const int gen_net_count = 4;/);
  // Two registers: the buried SR0 and the exposed Q1.
  assert.match(code, /static rt_val reg_U1\[2\];/);
  // The buried node lowers with its synthetic "#"-tagged key and drives its net.
  assert.match(code, /\/\* U1\.#SR0 \*\//);
  assert.match(code, /v = reg_U1\[0\]; \/\* latched \*\//);
  assert.match(code, /v = reg_U1\[1\]; \/\* latched \*\//);
});

test("generateC: per-output .CLK registered output latches on its own clock (M3 step 2)", () => {
  const CLKFF = { ...DFF, behavior: "Q.R = D\nQ.CLK = CP\n" };
  const d = mkDesign();
  place(d, "U1", CLKFF);
  const { code } = generateC(d);
  assert.match(code, /static rt_val prevClk_U1_0;/);
  assert.doesNotMatch(code, /static rt_val prevClk_U1;/); // no global clock for a self-clocked reg
  assert.match(code, /if \(prevClk_U1_0 == RT_0 && clk == RT_1\) reg_U1\[0\] = /);
  assert.match(code, /v = reg_U1\[0\]; \/\* latched \*\//);
});

test("generateC: async .APRST/.ARST lower to per-step preset/reset (M3 step 2)", () => {
  const AFF = {
    ...DFF,
    pins: [
      { name: "D", side: "left", position: 1, direction: "in" },
      { name: "CP", side: "left", position: 2, direction: "in" },
      { name: "/S", side: "left", position: 3, direction: "in" },
      { name: "/R", side: "left", position: 4, direction: "in" },
      { name: "Q", side: "right", position: 1, direction: "out" },
    ],
    behavior: "Q.R = D\nQ.CLK = CP\nQ.APRST = /S\nQ.ARST = /R\n",
  };
  const d = mkDesign();
  place(d, "U1", AFF);
  const { code } = generateC(d);
  assert.match(code, /if \(p != RT_0\) reg_U1\[0\] = \(p == RT_1\) \? RT_1 : RT_U; \} \/\* \.APRST \*\//);
  assert.match(code, /if \(a != RT_0\) reg_U1\[0\] = \(a == RT_1\) \? RT_0 : RT_U; \} \/\* \.ARST wins \*\//);
});

const ROM4x2 = {
  name: "ROM4x2",
  mem: { kind: "rom", addressBits: 2, dataWidth: 2, romFile: "r.hex" },
  pins: [
    { name: "A0", side: "left", position: 1, direction: "in" },
    { name: "A1", side: "left", position: 2, direction: "in" },
    { name: "CE/", side: "left", position: 3, direction: "in" },
    { name: "OE/", side: "left", position: 4, direction: "in" },
    { name: "D0", side: "right", position: 1, direction: "out" },
    { name: "D1", side: "right", position: 2, direction: "out" },
  ],
};

test("generateC: ROM device bakes refdes + content-file path, not bytes (M5, FR-117b)", () => {
  const d = mkDesign();
  place(d, "U1", ROM4x2);
  const { code } = generateC(d);
  assert.match(code, /\{ RT_MEM_ROM, 2, 2, mem_addr_U1, mem_data_U1, mem_dlbl_U1, [^,]+, [^,]+, -1, "U1", "r\.hex", 0, 0 \}/);
  assert.doesNotMatch(code, /mem_rom_U1/);
  assert.match(code, /const int gen_mem_count = 1;/);
});

test("generateC: RAM device emits a gen_mems entry with a WE/ net and no ROM (M3 step 3)", () => {
  const RAM = {
    name: "RAM4x1",
    mem: { kind: "ram", addressBits: 2, dataWidth: 1 },
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
      { name: "CE/", side: "left", position: 3, direction: "in" },
      { name: "OE/", side: "left", position: 4, direction: "in" },
      { name: "WE/", side: "left", position: 5, direction: "in" },
      { name: "D0", side: "right", position: 1, direction: "bidir" },
    ],
  };
  const d = mkDesign();
  place(d, "U1", RAM);
  const { code } = generateC(d);
  assert.match(code, /\{ RT_MEM_RAM, 2, 1, mem_addr_U1, mem_data_U1, mem_dlbl_U1, [^,]+, [^,]+, [^,]+, "U1", 0, 0, 0 \}/);
  assert.doesNotMatch(code, /mem_rom_U1/);
});

test("generateC: bakes a persistent RAM's save-file path and load-on-start flag (FR-114g/FR-117c)", () => {
  const RAM = {
    name: "RAM4x1S",
    mem: { kind: "ram", addressBits: 2, dataWidth: 1, ramFile: "/s/scratch.bin", ramLoad: true },
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
      { name: "CE/", side: "left", position: 3, direction: "in" },
      { name: "OE/", side: "left", position: 4, direction: "in" },
      { name: "WE/", side: "left", position: 5, direction: "in" },
      { name: "D0", side: "right", position: 1, direction: "bidir" },
    ],
  };
  const d = mkDesign();
  place(d, "U1", RAM);
  const { code } = generateC(d); // no longer refused
  assert.match(code, /\{ RT_MEM_RAM, 2, 1, [^}]+, "U1", 0, "\/s\/scratch\.bin", 1 \}/);
});

test("generateC: a RAM with a save file but load-on-start off bakes ram_load 0 (FR-117c)", () => {
  const RAM = {
    name: "RAM4x1SNoLoad",
    mem: { kind: "ram", addressBits: 2, dataWidth: 1, ramFile: "/s/scratch.bin", ramLoad: false },
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
      { name: "CE/", side: "left", position: 3, direction: "in" },
      { name: "OE/", side: "left", position: 4, direction: "in" },
      { name: "WE/", side: "left", position: 5, direction: "in" },
      { name: "D0", side: "right", position: 1, direction: "bidir" },
    ],
  };
  const d = mkDesign();
  place(d, "U1", RAM);
  const { code } = generateC(d);
  assert.match(code, /\{ RT_MEM_RAM, 2, 1, [^}]+, "U1", 0, "\/s\/scratch\.bin", 0 \}/);
});

test("generateC: a RAM with no save file still generates (FR-114g)", () => {
  const RAM = {
    name: "RAM4x1P",
    mem: { kind: "ram", addressBits: 2, dataWidth: 1 },
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
      { name: "CE/", side: "left", position: 3, direction: "in" },
      { name: "OE/", side: "left", position: 4, direction: "in" },
      { name: "WE/", side: "left", position: 5, direction: "in" },
      { name: "D0", side: "right", position: 1, direction: "bidir" },
    ],
  };
  const d = mkDesign();
  place(d, "U1", RAM);
  const { code } = generateC(d); // does not throw
  assert.match(code, /RT_MEM_RAM/);
});

test("generateC: ROM with no recorded content file bakes a NULL rom_file (M5)", () => {
  const NOFILE = { ...ROM4x2, name: "ROMNF", mem: { kind: "rom", addressBits: 2, dataWidth: 2 } };
  const d = mkDesign();
  place(d, "U1", NOFILE);
  const { code, warnings } = generateC(d);
  assert.equal(warnings.filter((w) => w.includes("ROM content")).length, 0);
  assert.match(code, /\{ RT_MEM_ROM, 2, 2, [^}]+, "U1", 0, 0, 0 \}/);
});

test("generateC: guards against an unflattened sub-design instance (FR-116)", () => {
  const d2 = mkDesign();
  place(d2, "X1", { name: "sub", renderType: "unit", pins: [] }, { childPath: "/tmp/child.json" });
  assert.throws(() => generateC(d2), /reached the generator unflattened/);
});

test("generateC: guards against an unflattened off-sheet connector (FR-116)", () => {
  const d = mkDesign();
  place(d, "A-1", builtin("port"), { label: "X", target: { file: "other.json", label: "X" } });
  assert.throws(() => generateC(d), /reached the generator unflattened/);
});

test("generateC: refuses a transmission gate — not supported by the fast simulator (FR-116/FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-3", builtin("tgate"));
  assert.throws(
    () => generateC(d),
    (e) => /A-3/.test(e.message) && /not supported by the fast simulator/.test(e.message),
  );
});

test("generateC: refuses a relay — not supported by the fast simulator (FR-116/FR-083a)", () => {
  const d = mkDesign();
  place(d, "A-5", builtin("relay"));
  assert.throws(
    () => generateC(d),
    (e) => /A-5/.test(e.message) && /not supported by the fast simulator/.test(e.message),
  );
});

test("generateC: hierarchical design generates from the FlatDesign, columns from the root (FR-116)", async () => {
  // Child: port IN → inverter → port OUT (plus its own indicator, which must
  // NOT become a column). Parent: switch → X1.IN, X1.OUT → indicator.
  const child = mkDesign();
  place(child, "A-1", builtin("port"), { label: "IN" });
  place(child, "A-2", builtin("port"), { label: "OUT" });
  place(child, "A-3", builtin("indicator"), { label: "inner" });
  place(child, "U1", NOT);
  connect(child, ["A-1", "P"], ["U1", "A"]);
  connect(child, ["U1", "Y"], ["A-2", "P"]);
  connect(child, ["U1", "Y"], ["A-3", "IN"]);

  const parent = mkDesign();
  place(parent, "A-1", builtin("switch"));
  place(parent, "A-2", builtin("indicator"));
  const ifacePins = [
    { name: "IN", side: "left", position: 1, direction: "in" },
    { name: "OUT", side: "right", position: 1, direction: "out" },
  ];
  place(parent, "X1", { name: "inv", renderType: "unit", pins: ifacePins }, {
    kind: "subdesign",
    childPath: "/lib/inv.json",
  });
  connect(parent, ["A-1", "OUT"], ["X1", "IN"]);
  connect(parent, ["X1", "OUT"], ["A-2", "IN"]);

  const flat = await flatten(parent, async () => child);
  const { code, warnings } = generateC(flat, { columnsFrom: parent });
  assert.equal(warnings.length, 0);
  assert.match(code, /X1\/U1\.Y/); // child logic present, hierarchical label
  // Columns are the top sheet's only: 1 in (parent switch), 1 out (parent
  // indicator) — the child's indicator contributes no column.
  assert.match(code, /const int gen_incol_count = 1;/);
  assert.match(code, /const int gen_outcol_count = 1;/);
  assert.ok(!code.includes('"inner"'));
});

test("generateC: behavior parse error propagates as a throw", () => {
  const BAD = { ...NOT, name: "BADX", behavior: "Y = %\n" };
  const d = mkDesign();
  place(d, "U1", BAD);
  assert.throws(() => generateC(d), /BADX: behavior/);
});
