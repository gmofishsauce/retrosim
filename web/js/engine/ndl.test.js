// NDL exporter tests (§6.18, FR-119a): pinouts with physical power/NC pins and
// the active-low rename, invented numbers for numberless types, subunit stem
// collapse, the port connector, power rail wiring, driver-first star
// statements, virtual-builtin comments, and determinism.

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateNDL } from "./ndl.js";

// --- fixture ---------------------------------------------------------------

const TY_7400 = {
  id: "type-7400",
  name: "7400",
  renderType: "subunit",
  pins: [
    { name: "1A", direction: "in", number: 1 },
    { name: "1B", direction: "in", number: 2 },
    { name: "1Y", direction: "out", number: 3 },
    { name: "2A", direction: "in", number: 4 },
    { name: "2B", direction: "in", number: 5 },
    { name: "2Y", direction: "out", number: 6 },
  ],
  physical: {
    package: "DIP-14",
    pincount: 14,
    power: [
      { name: "VCC", number: 14 },
      { name: "GND", number: 7 },
    ],
  },
};

const TY_74XX = {
  id: "type-74XX",
  name: "74XX",
  renderType: "unit",
  pins: [
    { name: "/MR", direction: "in", number: 1 },
    { name: "D0", direction: "in", number: 2 },
    { name: "Q0", direction: "out", number: 4 },
  ],
  physical: {
    package: "DIP-6",
    pincount: 6,
    power: [
      { name: "VCC", number: 6 },
      { name: "GND", number: 3 },
    ],
    nc: [5],
  },
};

// A generated memory device: no numbers, no physical block (FR-062e absent).
const TY_ROM = {
  id: "type-R2X2",
  name: "R2X2",
  renderType: "unit",
  pins: [
    { name: "A0", direction: "in" },
    { name: "D0", direction: "tristate" },
  ],
};

const TY_PORT = {
  name: "port",
  renderType: "port",
  pins: [{ name: "P", direction: "bidir" }],
};
const TY_CLOCK = {
  name: "clock",
  renderType: "clock",
  pins: [{ name: "OUT", direction: "out" }],
};
const TY_TGATE = {
  id: "type-tgate",
  name: "tgate",
  renderType: "tgate",
  pins: [
    { name: "A", direction: "bidir" },
    { name: "B", direction: "bidir" },
    { name: "EN", direction: "in" },
  ],
};

function fixture() {
  const pinV = (id, ref, pin) => ({ id, kind: "pin", ref, pin, x: 0, y: 0 });
  return {
    components: [
      { refdes: "U1A", type: "type-7400", typeData: TY_7400 },
      { refdes: "U1B", type: "type-7400", typeData: TY_7400 },
      { refdes: "U2", type: "type-74XX", typeData: TY_74XX },
      { refdes: "U3", type: "type-R2X2", typeData: TY_ROM },
      { refdes: "A-1", type: "type-port", label: "OUT", typeData: TY_PORT },
      { refdes: "A-2", type: "type-clock", label: null, typeData: TY_CLOCK },
    ],
    wires: [
      { id: "w1", path: [{ t: "node", v: "v1" }, { t: "node", v: "v2" }] },
      { id: "w2", path: [{ t: "node", v: "v3" }, { t: "node", v: "v4" }] },
      { id: "w3", path: [{ t: "node", v: "v5" }, { t: "node", v: "v6" }] },
      { id: "w4", path: [{ t: "node", v: "v7" }, { t: "node", v: "v8" }] },
    ],
    buses: [],
    vertices: [
      pinV("v1", "U1A", "1Y"),
      pinV("v2", "U2", "D0"),
      pinV("v3", "U2", "Q0"),
      { id: "v4", kind: "connector", ref: "A-1", pin: "P", x: 0, y: 0 },
      pinV("v5", "U1A", "1A"),
      pinV("v6", "A-2", "OUT"),
      pinV("v7", "U1B", "2A"),
      pinV("v8", "U1A", "1B"),
    ],
  };
}

const gen = () => generateNDL(fixture(), { name: "demo rig" });

// --- tests -------------------------------------------------------------------

test("pinouts: physical numbers, power and NC pins, active-low rename", () => {
  const { text } = gen();
  assert.match(text, /pinout 7400\n(.|\n)*? {2}pin 1 = 1A\n/);
  assert.match(text, /pinout 7400\n(.|\n)*? {2}pin 14 = VCC\n {2}pin 7 = GND\nend 7400/);
  assert.match(text, /pinout 74XX\n {2}pin 1 = MR'\n/);
  assert.match(text, / {2}pin 5 = NC\nend 74XX/);
});

test("numberless type gets invented numbers plus a warning", () => {
  const { text, warnings } = gen();
  assert.match(text, /pinout R2X2\n {2}# WARNING[^\n]*invented\n {2}pin 1 = A0\n {2}pin 2 = D0\nend R2X2/);
  assert.ok(warnings.some((w) => w.includes("R2X2") && w.includes("invented")));
});

test("packages: subunit siblings collapse to their stem", () => {
  const { text } = gen();
  assert.match(text, /\npackage 7400 U1\n/);
  assert.match(text, /\npackage 74XX U2\n/);
  assert.doesNotMatch(text, /U1A|U1B/);
});

test("ports become the connector package J1", () => {
  const { text } = gen();
  assert.match(text, /pinout demo_rig_IO\n {2}pin 1 = OUT\nend demo_rig_IO/);
  assert.match(text, /\npackage demo_rig_IO J1\n/);
  assert.match(text, / {2}U2\.Q0 -> J1\.OUT\n/); // driver-first star
});

test("power rails wired from FR-062e physical metadata", () => {
  const { text } = gen();
  assert.match(text, /pinout POWER\n {2}pin 1 = VCC\n {2}pin 2 = GND\nend POWER/);
  assert.match(text, /\npackage POWER PWR\n/);
  assert.match(text, / {2}PWR\.VCC -> U1\.VCC\n {2}PWR\.GND -> U1\.GND\n/);
  assert.match(text, / {2}PWR\.VCC -> U2\.VCC\n/);
  // U3 has no physical block: no rails for it.
  assert.doesNotMatch(text, /PWR\.\w+ -> U3\./);
});

test("net statements: driver-first star with subunit-stem references", () => {
  const { text } = gen();
  assert.match(text, / {2}U1\.1Y -> U2\.D0\n/);
  // U1B.2A—U1A.1B: both inputs, star from the naturally-first ref.
  assert.match(text, / {2}U1\.1B -> U1\.2A\n/);
});

test("virtual built-ins survive as comments, not hardware", () => {
  const { text } = gen();
  assert.doesNotMatch(text, /pinout clock|package [^\n]*A-2/);
  assert.match(text, / {2}# virtual: A-2 \(clock\) OUT -> U1\.1A\n/);
});

test("deterministic output", () => {
  assert.equal(gen().text, gen().text);
});

test("switch elements export as virtual comment lines, not hardware (FR-119a f)", () => {
  const pinV = (id, ref, pin) => ({ id, kind: "pin", ref, pin, x: 0, y: 0 });
  const d = {
    components: [
      { refdes: "U2", type: "type-74XX", typeData: TY_74XX },
      { refdes: "A-1", type: "type-tgate", typeData: TY_TGATE },
    ],
    wires: [{ id: "w1", path: [{ t: "node", v: "v1" }, { t: "node", v: "v2" }] }],
    buses: [],
    vertices: [pinV("v1", "U2", "Q0"), pinV("v2", "A-1", "A")],
  };
  const { text } = generateNDL(d, { name: "sw" });
  // The tgate's terminal net is named, and it never becomes a pinout/package.
  assert.match(text, / {2}# virtual: A-1 \(tgate\) A -> U2\.Q0\n/);
  assert.doesNotMatch(text, /pinout tgate|package [^\n]*A-1/);
});

test("subunit pinout unions pins across siblings' per-unit typeData", () => {
  // A saved design's subunit siblings each carry only their own unit's pins
  // (as nand.json does); the exported pinout must cover the whole package.
  const unitA = { ...TY_7400, pins: TY_7400.pins.slice(0, 3) };
  const unitB = { ...TY_7400, pins: TY_7400.pins.slice(3, 6) };
  const d = fixture();
  d.components = d.components.map((c) =>
    c.refdes === "U1A" ? { ...c, typeData: unitA }
    : c.refdes === "U1B" ? { ...c, typeData: unitB }
    : c,
  );
  const { text } = generateNDL(d, { name: "demo rig" });
  assert.match(text, /pinout 7400\n(.|\n)*? {2}pin 4 = 2A\n(.|\n)*? {2}pin 14 = VCC\n/);
  assert.match(text, / {2}pin 1 = 1A\n/);
});

test("unflattened sub-design is an internal error", () => {
  const d = fixture();
  d.components.push({ refdes: "X1", kind: "subdesign", childPath: "c.json" });
  assert.throws(() => generateNDL(d, { name: "x" }), /unflattened/);
});
