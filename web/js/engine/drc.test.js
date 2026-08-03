import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  addBus,
  branchWire,
  breakoutBit,
} from "../model/design.js";
import { BUILTINS } from "../builtins.js";
import { runDesignRuleCheck, applyWaivers } from "./drc.js";

const PULLUP = BUILTINS.find((b) => b.name === "pullup");
const PULLDOWN = BUILTINS.find((b) => b.name === "pulldown");
const PORT = BUILTINS.find((b) => b.name === "port");
const PORTN = BUILTINS.find((b) => b.name === "portN");

// A minimal two-pin part: one input, one plain output.
function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [
      { name: "A", side: "left", position: 2, direction: "in" },
      { name: "Y", side: "right", position: 2, direction: "out" },
    ],
  };
}

// driver(dir) is a one-pin part whose single pin D has the given direction, so a
// net can be built from any combination of R1's table.
function driver(dir) {
  return {
    name: `D-${dir}`,
    width: 4,
    height: 4,
    pins: [{ name: "D", side: "right", position: 1, direction: dir }],
  };
}

// tie wires the named pins of successive instances into one net (each wire shares
// the previous pin's vertex, which is what makes them one net).
function tie(d, ...pins) {
  for (let i = 1; i < pins.length; i++) addWire(d, pins[i - 1], pins[i]);
}

const P = (refdes, pin) => ({ kind: "pin", refdes, pin });

// r1net builds a design of one net joining one one-pin driver per direction.
async function r1net(...dirs) {
  const d = createDesign("t");
  const pins = dirs.map((dir, i) => {
    addInstance(d, driver(dir), 10 + 20 * i, 20, 0);
    return P(`U${i + 1}`, "D");
  });
  tie(d, ...pins);
  const res = await runDesignRuleCheck(d);
  return res.findings.filter((f) => f.rule === "R1");
}

test("an empty design yields no findings, not an error (§6.21)", async () => {
  const res = await runDesignRuleCheck(createDesign("empty"));
  assert.deepEqual(res.findings, []);
  assert.deepEqual(res.warnings, []);
});

test("a design with every pin driven and loaded is clean", async () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  addWire(d, { kind: "pin", refdes: "U1", pin: "Y" }, { kind: "pin", refdes: "U2", pin: "A" });
  addWire(d, { kind: "pin", refdes: "U2", pin: "Y" }, { kind: "pin", refdes: "U1", pin: "A" });

  const res = await runDesignRuleCheck(d);
  assert.deepEqual(res.findings, []);
  assert.deepEqual(res.warnings, []);
});

test("R1 fires on every fighting row of the combination table (FR-124a)", async () => {
  for (const pair of [
    ["out", "out"],
    ["out", "tristate"],
    ["out", "bidir"],
  ]) {
    const found = await r1net(...pair);
    assert.equal(found.length, 1, `${pair.join("+")} should fight`);
    assert.equal(found[0].severity, "error");
    assert.deepEqual(found[0].refs, ["U1.D", "U2.D"]);
  }
});

test("R1 is silent on every non-fighting row, bidir+bidir included (FR-124a)", async () => {
  for (const pair of [
    ["tristate", "tristate"],
    ["tristate", "bidir"],
    ["bidir", "bidir"],
  ]) {
    assert.deepEqual(await r1net(...pair), [], `${pair.join("+")} is normal`);
  }
});

test("three plain outputs on one net are ONE finding naming all three (§6.21)", async () => {
  const found = await r1net("out", "out", "out");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].refs, ["U1.D", "U2.D", "U3.D"]);
  assert.match(found[0].message, /U1\.D \(out\) vs U2\.D \(out\) vs U3\.D \(out\)/);
});

// The trap (§6.21): the pull built-ins declare `direction: "out"`, so a rule that
// trusted pin direction would report an output fight on every pulled-up net —
// the most common idiom in these circuits. This test exists to fail loudly if a
// future change makes a rule trust `direction` again.
test("R1 does not fight a pull-up, which declares direction:out (§6.21)", async () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, PULLUP, 40, 20, 0); // A-1
  tie(d, P("U1", "Y"), P("A-1", "OUT"));

  const res = await runDesignRuleCheck(d);
  assert.deepEqual(res.findings.filter((f) => f.rule === "R1"), []);
});

test("R1 does not fight a port, at either width (FR-124, FR-071e)", async () => {
  for (const portType of [PORT, PORTN]) {
    const d = createDesign("t");
    addInstance(d, ty(), 10, 20, 0); // U1
    addInstance(d, portType, 40, 20, 0); // A-1
    tie(d, P("U1", "Y"), P("A-1", portType === PORT ? "P" : "P0"));

    const res = await runDesignRuleCheck(d);
    assert.deepEqual(res.findings.filter((f) => f.rule === "R1"), [], portType.renderType);
  }
});

// A tri-state buffer whose enable is one literal. `oe` names the enable pin, so
// two variants can differ in polarity while both compiling to a single-literal
// .E term.
function buf(name, oe = "/OE", behavior = `Q.T = D\nQ.E = ${oe}\n`) {
  return {
    name,
    width: 6,
    height: 8,
    pins: [
      { name: "D", side: "left", position: 1, direction: "in" },
      { name: "Q", side: "right", position: 2, direction: "tristate" },
      { name: oe, side: "top", position: 1, direction: "in" },
      { name: "CS", side: "top", position: 2, direction: "in" },
    ],
    behavior,
  };
}

const r2of = (res) => res.findings.filter((f) => f.rule === "R2");

test("R2 fires for two .T drivers sharing an enable net and polarity (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, buf("B1"), 10, 20, 0); // U1
  addInstance(d, buf("B1"), 40, 20, 0); // U2
  tie(d, P("U1", "Q"), P("U2", "Q"));
  tie(d, P("U1", "/OE"), P("U2", "/OE"));

  const found = r2of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "error");
  assert.deepEqual(found[0].refs, ["U1.Q", "U2.Q"]);
});

// The trap (§6.21): the enable literal names a pin on the instance's own type,
// so two instances of one part have textually identical enables. Comparing
// signal names instead of resolved nets would flag a '245 pair sharing /OE while
// driving different buses — correct design.
test("R2 does not fire when identical enable NAMES resolve to different nets", async () => {
  const d = createDesign("t");
  addInstance(d, buf("B1"), 10, 20, 0); // U1
  addInstance(d, buf("B1"), 40, 20, 0); // U2
  addInstance(d, driver("out"), 10, 60, 0); // U3
  addInstance(d, driver("out"), 40, 60, 0); // U4
  tie(d, P("U1", "Q"), P("U2", "Q"));
  tie(d, P("U3", "D"), P("U1", "/OE")); // two separate enable nets
  tie(d, P("U4", "D"), P("U2", "/OE"));

  assert.deepEqual(r2of(await runDesignRuleCheck(d)), []);
});

test("R2 does not fire when the enable polarity differs (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, buf("B1", "/OE"), 10, 20, 0); // U1: enabled by OE low
  addInstance(d, buf("B2", "OE"), 40, 20, 0); // U2: enabled by OE high
  tie(d, P("U1", "Q"), P("U2", "Q"));
  tie(d, P("U1", "/OE"), P("U2", "OE")); // one enable net, opposite senses

  assert.deepEqual(r2of(await runDesignRuleCheck(d)), []);
});

test("R2 does not compare multi-literal enable terms, identical or not (FR-124a)", async () => {
  const d = createDesign("t");
  const two = buf("B3", "/OE", "Q.T = D\nQ.E = /OE * CS\n");
  addInstance(d, two, 10, 20, 0); // U1
  addInstance(d, two, 40, 20, 0); // U2
  tie(d, P("U1", "Q"), P("U2", "Q"));
  tie(d, P("U1", "/OE"), P("U2", "/OE"));
  tie(d, P("U1", "CS"), P("U2", "CS"));

  assert.deepEqual(r2of(await runDesignRuleCheck(d)), []);
});

test("a driver with no compiled behavior takes no part in R2 and silences no one", async () => {
  const d = createDesign("t");
  addInstance(d, buf("B1"), 10, 20, 0); // U1
  addInstance(d, buf("B1"), 40, 20, 0); // U2
  addInstance(d, driver("tristate"), 70, 20, 0); // U3: no behavior block
  tie(d, P("U1", "Q"), P("U2", "Q"), P("U3", "D"));
  tie(d, P("U1", "/OE"), P("U2", "/OE"));

  const found = r2of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].refs, ["U1.Q", "U2.Q"]); // U3 neither reported nor a silencer
});

const r3of = (res) => res.findings.filter((f) => f.rule === "R3");

test("R3 reports an input on a real but undrivable net (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("in"), 10, 20, 0); // U1
  addInstance(d, driver("in"), 40, 20, 0); // U2
  tie(d, P("U1", "D"), P("U2", "D"));

  const found = r3of(await runDesignRuleCheck(d));
  assert.equal(found.length, 2); // one per pin
  assert.equal(found[0].severity, "warning");
  assert.deepEqual(
    found.map((f) => f.refs),
    [["U1.D"], ["U2.D"]],
  );
});

// The second source (§6.6): buildNets emits only nets with a connected pin, so a
// pin touching no conductor at all appears in no net and must be found by
// subtraction. Same finding class — a spare gate's inputs are undriven inputs.
test("R3 reports an input touching no conductor at all (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1, wholly unwired

  const found = r3of(await runDesignRuleCheck(d));
  assert.deepEqual(
    found.map((f) => f.refs),
    [["U1.A"]], // the output pin Y is not an R3 finding
  );
});

test("a net driven only by a pull-up is driven (§6.21)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("in"), 10, 20, 0); // U1
  addInstance(d, PULLUP, 40, 20, 0); // A-1
  tie(d, P("U1", "D"), P("A-1", "OUT"));

  assert.deepEqual(r3of(await runDesignRuleCheck(d)), []);
});

test("a net reaching a port is driven (FR-124)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("in"), 10, 20, 0); // U1
  addInstance(d, PORT, 40, 20, 0); // A-1
  tie(d, P("U1", "D"), P("A-1", "P"));

  assert.deepEqual(r3of(await runDesignRuleCheck(d)), []);
});

// A part with an n-bit pin group, so a bus can snap to it.
function busPart(name, dir, n = 4) {
  const names = Array.from({ length: n }, (_, i) => `Q${i}`);
  return {
    name,
    width: 6,
    height: n + 2,
    pins: names.map((pin, i) => ({ name: pin, side: "right", position: i + 1, direction: dir })),
    pinGroups: [{ name: "Q", pins: names }],
  };
}

const snap = (bus, vertex, instance, n = 4) =>
  bus.groupConnections.push({
    vertex,
    instance,
    group: "Q",
    bitMap: Array.from({ length: n }, (_, i) => `Q${i}`),
  });

const r4of = (res) => res.findings.filter((f) => f.rule === "R4");

test("R4 fires on a 1-bit tri-state-only net with no pull (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("tristate"), 10, 20, 0); // U1
  addInstance(d, driver("in"), 40, 20, 0); // U2
  tie(d, P("U1", "D"), P("U2", "D"));

  const found = r4of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  assert.deepEqual(found[0].refs, ["U1.D", "U2.D"]); // the net's PIN SET, not a name
});

test("R4 is silent when the net is pulled up (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("tristate"), 10, 20, 0); // U1
  addInstance(d, driver("in"), 40, 20, 0); // U2
  addInstance(d, PULLUP, 70, 20, 0); // A-1
  tie(d, P("U1", "D"), P("U2", "D"), P("A-1", "OUT"));

  assert.deepEqual(r4of(await runDesignRuleCheck(d)), []);
});

test("R4 is silent on bus lanes: a floating multi-bit bus is normal (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, busPart("BT", "tristate"), 10, 20, 0); // U1
  addInstance(d, busPart("BI", "in"), 60, 20, 0); // U2
  const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 40, y: 0 }, 4);
  snap(bus, bus.path[0].v, "U1");
  snap(bus, bus.path[1].v, "U2");

  assert.deepEqual(r4of(await runDesignRuleCheck(d)), []);
});

// The distinction between NET width and CONDUCTOR width (§6.21): the broken-out
// lane reaches its pin over a wire, so its net is ["wire:w1","bus:b1:2"] — one
// bit, and checked, even though the bus it was tapped from is four.
test("R4 fires on a single lane broken out of a bus (FR-043a)", async () => {
  const d = createDesign("t");
  addInstance(d, busPart("BT", "tristate"), 10, 20, 0); // U1 drives the bus
  addInstance(d, driver("in"), 60, 60, 0); // U2 takes one lane
  const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 40, y: 0 }, 4);
  snap(bus, bus.path[0].v, "U1");
  breakoutBit(d, bus.id, 0, 20, 0, 2, P("U2", "D"));

  const found = r4of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1); // the tapped lane only; the other three are bus-only
  assert.deepEqual(found[0].refs, ["U1.Q2", "U2.D"]);
});

const r5of = (res) => res.findings.filter((f) => f.rule === "R5");

test("R5 reports a pull-up and a pull-down on one net (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("in"), 10, 20, 0); // U1
  addInstance(d, PULLUP, 40, 20, 0); // A-1
  addInstance(d, PULLDOWN, 70, 20, 0); // A-2
  tie(d, P("U1", "D"), P("A-1", "OUT"), P("A-2", "OUT"));

  const found = r5of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  assert.deepEqual(found[0].refs, ["A-1", "A-2"]); // the instances, not their pins
});

test("R5 is silent when the pulls agree", async () => {
  const d = createDesign("t");
  addInstance(d, driver("in"), 10, 20, 0); // U1
  addInstance(d, PULLUP, 40, 20, 0); // A-1
  addInstance(d, PULLUP, 70, 20, 0); // A-2
  tie(d, P("U1", "D"), P("A-1", "OUT"), P("A-2", "OUT"));

  assert.deepEqual(r5of(await runDesignRuleCheck(d)), []);
});

// One unit of a subunit package (FR-013a). The DRC reads only refdes and
// typeData, so a unit can be placed directly rather than through
// addSubunitPackage, which would drag in symbol geometry the rules never touch.
function addUnit(d, refdes, type, x, y) {
  const inst = { refdes, type: type.name, x, y, rotation: 0, typeData: structuredClone(type) };
  d.components.push(inst);
  return inst;
}

// One 7400 gate: two inputs, one output.
const gate = () => ({
  name: "7400",
  renderType: "subunit",
  width: 6,
  height: 6,
  pins: [
    { name: "A", side: "left", position: 1, direction: "in" },
    { name: "B", side: "left", position: 2, direction: "in" },
    { name: "Y", side: "right", position: 1, direction: "out" },
  ],
});

function quadNand(d) {
  for (const letter of ["A", "B", "C", "D"]) {
    addUnit(d, `U1${letter}`, gate(), 10, 20 + 10 * letter.charCodeAt(0));
  }
}

const r6of = (res) => res.findings.filter((f) => f.rule === "R6");

test("R6 is silent for the spare gates when one gate of the package is used (FR-124a)", async () => {
  const d = createDesign("t");
  quadNand(d);
  tie(d, P("U1A", "Y"), P("U1B", "A")); // one output connected silences the package

  assert.deepEqual(r6of(await runDesignRuleCheck(d)), []);
});

test("R6 fires ONCE for a package with no output connected anywhere (FR-124a)", async () => {
  const d = createDesign("t");
  quadNand(d);

  const found = r6of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "warning");
  assert.deepEqual(found[0].refs, ["U1A", "U1B", "U1C", "U1D"]);
});

// The vacuous-fire guard (§6.21): without the ≥1-output-capable-pin test, every
// all-input part — the magic UART, the indicators — is reported for having no
// outputs to connect.
test("R6 is silent for an all-input part with no outputs at all (§6.21)", async () => {
  const d = createDesign("t");
  addUnit(d, "U1", { name: "UART", width: 4, height: 6, pins: [
    { name: "CS/", side: "right", position: 1, direction: "in" },
    { name: "CLK", side: "right", position: 2, direction: "in" },
  ] }, 10, 20);

  assert.deepEqual(r6of(await runDesignRuleCheck(d)), []);
});

test("R6 is silent for a partially used counter (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, busPart("CTR", "out", 8), 10, 20, 0); // U1: Q0..Q7
  addInstance(d, driver("in"), 60, 20, 0); // U2
  tie(d, P("U1", "Q0"), P("U2", "D")); // Q1..Q7 left bare

  assert.deepEqual(r6of(await runDesignRuleCheck(d)), []);
});

test("R7 reports a free vertex a wire references, as conductorId:vertexId (§6.21)", async () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  const w = addWire(d, P("U1", "Y"), { kind: "free", x: 30, y: 24 });

  const found = (await runDesignRuleCheck(d)).findings.filter((f) => f.rule === "R7");
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info"); // FR-018a permits these deliberately
  assert.deepEqual(found[0].refs, [`${w.id}:${w.path[1].v}`]);
  assert.match(found[0].message, /at \(30, 24\)/);
});

const r8of = (res) => res.findings.filter((f) => f.rule === "R8");

test("R8 reports an instance with no pin on any net (FR-124a)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("out"), 10, 20, 0); // U1, placed and forgotten

  const found = r8of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
  assert.deepEqual(found[0].refs, ["U1"]);
});

test("R8 is silent for a spare unit of a package that IS used — R3 covers it", async () => {
  const d = createDesign("t");
  quadNand(d);
  tie(d, P("U1A", "Y"), P("U1B", "A")); // U1C and U1D are wholly unwired

  assert.deepEqual(r8of(await runDesignRuleCheck(d)), []);
});

test("R8 is silent for a text note, which has no pins (FR-071f)", async () => {
  const d = createDesign("t");
  addUnit(d, "N-1", { name: "note", renderType: "note", width: 8, height: 3, pins: [] }, 10, 20);

  assert.deepEqual(r8of(await runDesignRuleCheck(d)), []);
});

const r9of = (res) => res.findings.filter((f) => f.rule === "R9");

test("R9 reports a driven net with no input pin on it — a wire to nowhere", async () => {
  const d = createDesign("t");
  addInstance(d, driver("out"), 10, 20, 0); // U1
  addWire(d, P("U1", "D"), { kind: "free", x: 40, y: 20 });

  const found = r9of(await runDesignRuleCheck(d));
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
  assert.deepEqual(found[0].refs, ["U1.D"]);
});

test("R9 is silent when the net reaches a port — the parent sheet is the load", async () => {
  const d = createDesign("t");
  addInstance(d, driver("out"), 10, 20, 0); // U1
  addInstance(d, PORT, 40, 20, 0); // A-1
  tie(d, P("U1", "D"), P("A-1", "P"));

  assert.deepEqual(r9of(await runDesignRuleCheck(d)), []);
});

test("R9 is silent on a bidir-only net, which loads itself (§6.21)", async () => {
  const d = createDesign("t");
  addInstance(d, driver("bidir"), 10, 20, 0); // U1
  addWire(d, P("U1", "D"), { kind: "free", x: 40, y: 20 });

  assert.deepEqual(r9of(await runDesignRuleCheck(d)), []);
});

// A design with one targeted port, plus an unrelated stray instance so the other
// rules can be shown to keep working when the probe misbehaves.
function targeted() {
  const d = createDesign("t");
  addInstance(d, driver("out"), 10, 20, 0); // U1
  const port = addInstance(d, PORT, 40, 20, 0); // A-1
  port.target = { file: "other.json", label: "X" };
  tie(d, P("U1", "D"), P("A-1", "P"));
  addInstance(d, driver("in"), 10, 60, 0); // U2: a stray, so R8 fires
  return d;
}

const r10of = (res) => res.findings.filter((f) => f.rule === "R10");

test("R10 reports a port target the probe says is missing (FR-124a)", async () => {
  const res = await runDesignRuleCheck(targeted(), { fileExists: () => false });
  const found = r10of(res);
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, "info");
  assert.deepEqual(found[0].refs, ["A-1"]);
});

test("R10 is silent when the probe says the target resolves", async () => {
  const res = await runDesignRuleCheck(targeted(), { fileExists: () => true });
  assert.deepEqual(r10of(res), []);
});

// An unanswerable probe must never become a finding (FR-124a).
test("R10 reports NOTHING when there is no probe at all (FR-124a)", async () => {
  const res = await runDesignRuleCheck(targeted(), { fileExists: null });
  assert.deepEqual(r10of(res), []);
  assert.deepEqual(res.warnings, []);
});

test("a throwing probe costs R10 only: nothing reported, one warning, nine rules intact", async () => {
  const res = await runDesignRuleCheck(targeted(), {
    fileExists: () => {
      throw new Error("server down");
    },
  });
  assert.deepEqual(r10of(res), []);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /R10: the file probe failed \(server down\)/);
  assert.ok(res.findings.some((f) => f.rule === "R8")); // the other rules still ran
});

test("a rejecting probe is handled like a throwing one (FR-089)", async () => {
  const res = await runDesignRuleCheck(targeted(), {
    fileExists: () => Promise.reject(new Error("timeout")),
  });
  assert.deepEqual(r10of(res), []);
  assert.equal(res.warnings.length, 1);
});

// A design carrying findings at all three severities: an output fight (error),
// an undriven input (warning), a dangling end and a stray (info).
function mixed() {
  const d = createDesign("t");
  addInstance(d, driver("out"), 10, 20, 0); // U1
  addInstance(d, driver("out"), 40, 20, 0); // U2
  addInstance(d, driver("in"), 10, 60, 0); // U3, stray
  tie(d, P("U1", "D"), P("U2", "D"));
  addWire(d, P("U1", "D"), { kind: "free", x: 70, y: 20 });
  return d;
}

const RANK = { error: 0, warning: 1, info: 2 };

test("two runs of one design produce byte-identical output (FR-124d)", async () => {
  const first = await runDesignRuleCheck(mixed());
  const second = await runDesignRuleCheck(mixed());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.findings.length >= 4);
});

// Every message carries its own rule id (FR-124c), so a line quoted or copied
// out of the report still says which of the ten rules produced it.
test("every finding's message ends with its rule id (FR-124c)", async () => {
  const { findings } = await runDesignRuleCheck(mixed(), { fileExists: () => false });
  assert.ok(findings.length >= 4);
  for (const found of findings) {
    assert.ok(
      found.message.endsWith(` (rule ${found.rule})`),
      `${found.rule}: ${found.message}`,
    );
  }
});

test("findings sort by severity, then rule, then refs (FR-124d)", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  const keys = findings.map((f) => [RANK[f.severity], f.rule, f.refs.join(",")]);
  for (let i = 1; i < keys.length; i++) {
    assert.ok(
      String(keys[i - 1]) <= String(keys[i]) || keys[i - 1][0] < keys[i][0],
      `${keys[i - 1]} must not follow ${keys[i]}`,
    );
    assert.ok(keys[i - 1][0] <= keys[i][0], "severity is the primary key");
  }
  assert.equal(findings[0].severity, "error");
});

// A rule bug must not make the checker useless: ten independent rules are not an
// all-or-nothing pass (§6.21). The poisoned `target` getter stands in for one.
test("a rule that throws costs only its own findings, plus a warning naming it", async () => {
  const d = mixed();
  Object.defineProperty(d.components[0], "target", {
    get() {
      throw new Error("boom");
    },
  });

  const res = await runDesignRuleCheck(d, { fileExists: () => true });
  assert.deepEqual(r10of(res), []);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /R10: rule failed \(boom\)/);
  assert.ok(res.findings.some((f) => f.rule === "R1")); // every other rule survived
});

const waiver = (rule, refs, note) => ({ rule, refs, ...(note ? { note } : {}) });

test("a waiver matches by rule and ref SET, whatever order it was written in", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  const fight = findings.find((f) => f.rule === "R1");
  const { active, waived, unmatched } = applyWaivers(findings, [
    waiver("R1", [...fight.refs].reverse(), "deliberate, wired-or"),
  ]);

  assert.deepEqual(waived, [fight]);
  assert.equal(active.length, findings.length - 1);
  assert.deepEqual(unmatched, []);
});

test("a waiver matching nothing lands in `unmatched`, for the caller to drop", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  const dead = waiver("R1", ["U9.D", "U8.D"]);
  const { active, waived, unmatched } = applyWaivers(findings, [dead]);

  assert.deepEqual(active, findings);
  assert.deepEqual(waived, []);
  assert.deepEqual(unmatched, [dead]);
});

// The R1 fight and the R9 no-loads finding on this net share a pin set, so the
// rule id is the only thing telling their waivers apart: waiving one must leave
// the other in the work list.
test("a waiver is keyed by rule id as well as by refs", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  const fight = findings.find((f) => f.rule === "R1");
  const noLoads = findings.find((f) => f.rule === "R9");
  assert.deepEqual(fight.refs, noLoads.refs); // same objects, different defects

  const { active, waived } = applyWaivers(findings, [waiver("R1", fight.refs)]);
  assert.deepEqual(waived, [fight]);
  assert.ok(active.includes(noLoads));

  const none = applyWaivers(findings, [waiver("R5", fight.refs)]);
  assert.deepEqual(none.waived, []);
  assert.equal(none.unmatched.length, 1);
});

test("a malformed waiver matches nothing and does not throw (§6.21)", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  const junk = [{ refs: ["U1.D"] }, { rule: "R1" }, { rule: "R1", refs: "U1.D" }, null, 42];
  const { active, waived, unmatched } = applyWaivers(findings, junk);

  assert.deepEqual(active, findings);
  assert.deepEqual(waived, []);
  assert.deepEqual(unmatched, junk); // dropped by the ordinary unmatched path
});

test("applyWaivers tolerates a design with no waivers at all", async () => {
  const { findings } = await runDesignRuleCheck(mixed());
  assert.deepEqual(applyWaivers(findings), { active: findings, waived: [], unmatched: [] });
  assert.deepEqual(applyWaivers(findings, undefined).active, findings);
});

test("a buildNets warning is passed through to `warnings`, never swallowed (§6.21)", async () => {
  const d = createDesign("t");
  const wide = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 8, y: 0 }, 4);
  const j = branchWire(d, wide, 0, 4, 0);
  j.offset = 3; // a width-2 bus at offset 3 does not fit a width-4 bus
  addBus(d, { kind: "vertex", id: j.id }, { kind: "free", x: 4, y: 8 }, 2);

  const res = await runDesignRuleCheck(d);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /alignment offset 3/);
});
