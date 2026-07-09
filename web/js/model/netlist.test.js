import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  addBus,
  branchWire,
} from "./design.js";
import { buildNets } from "./netlist.js";
import { BUILTINS } from "../builtins.js";

const PORT = BUILTINS.find((b) => b.name === "port");

// A type with a 3-bit pin group "A", used by the bus tests below.
function tyA() {
  return {
    name: "TA",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "A1", side: "left", position: 3, direction: "in" },
      { name: "A2", side: "left", position: 4, direction: "in" },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
  };
}

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "/Y0", side: "right", position: 2, direction: "out" },
    ],
  };
}

function setup(n = 3) {
  const d = createDesign("t");
  for (let i = 0; i < n; i++) addInstance(d, ty(), 10 + 30 * i, 20, 0);
  return d;
}

const sorted = (a) => [...a].sort();

test("two wires joined at a junction form one net with all pins", () => {
  const d = setup(3);
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w1, 0, 25, 26);
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(sorted(nets[0].pins), ["U1./Y0", "U2.A0", "U3.A0"]);
  assert.deepEqual(sorted(nets[0].members), sorted([w1.id, w2.id]));
});

test("fan-out (one pin, two wires) is one net", () => {
  const d = setup(3);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(sorted(nets[0].pins), ["U1./Y0", "U2.A0", "U3.A0"]);
});

test("unconnected wires form separate nets", () => {
  const d = setup(3);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addWire(
    d,
    { kind: "pin", refdes: "U3", pin: "/Y0" },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );
  assert.equal(buildNets(d).length, 2);
});

test("a half-dangling wire still forms a net for its one pin (FR-029)", () => {
  const d = setup(1);
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 30, y: 30 },
  );
  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].pins, ["U1./Y0"]);
  assert.deepEqual(nets[0].members, [w.id]);
});

test("net membership is id-based and stable under an instance move", () => {
  const d = setup(3);
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w1, 0, 25, 26);
  addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const before = buildNets(d);
  d.components[0].x += 100; // move U1 far away
  const after = buildNets(d);
  assert.deepEqual(
    after.map((n) => sorted(n.pins)),
    before.map((n) => sorted(n.pins)),
  );
});

// --- Bus bit-lane nets (FR-037a/FR-060a) ---
// The snapBusGroup/breakoutBit ops are later steps, so these tests construct the
// bus metadata (groupConnections, vertex.bit, bitNames) by hand.

test("a width-3 group-snapped bus yields 3 nets, one pin each, with provenance", () => {
  const d = createDesign("t");
  addInstance(d, tyA(), 10, 20, 0);
  const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, 3);
  bus.groupConnections.push({
    vertex: bus.path[1].v,
    instance: "U1",
    group: "A",
    bitMap: ["A0", "A1", "A2"],
  });

  const nets = buildNets(d);
  assert.equal(nets.length, 3);
  const byPin = Object.fromEntries(nets.map((n) => [n.pins[0], n]));
  assert.deepEqual(byPin["U1.A0"].provenance, [{ bus: bus.id, bit: 0 }]);
  assert.deepEqual(byPin["U1.A2"].provenance, [{ bus: bus.id, bit: 2 }]);
  for (const n of nets) assert.deepEqual(n.members, [bus.id]);
});

test("bus bit names (FR-037b) become the net name", () => {
  const d = createDesign("t");
  addInstance(d, tyA(), 10, 20, 0);
  const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, 3);
  bus.bitNames = ["D0", "D1", "D2"];
  bus.groupConnections.push({
    vertex: bus.path[1].v,
    instance: "U1",
    group: "A",
    bitMap: ["A0", "A1", "A2"],
  });

  const nets = buildNets(d);
  const byPin = Object.fromEntries(nets.map((n) => [n.pins[0], n]));
  assert.equal(byPin["U1.A0"].name, "D0");
  assert.equal(byPin["U1.A2"].name, "D2");
});

test("a breakout wire taps exactly one bus bit (FR-043a)", () => {
  const d = createDesign("t");
  addInstance(d, tyA(), 10, 20, 0);
  const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 8, y: 0 }, 4);
  const j = branchWire(d, bus, 0, 4, 0); // junction on the bus
  j.bit = 2; // tap bit 2
  const w = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U1", pin: "A0" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].pins, ["U1.A0"]);
  assert.deepEqual(sorted(nets[0].members), sorted([bus.id, w.id]));
  assert.deepEqual(nets[0].provenance, [{ bus: bus.id, bit: 2 }]);
});

// Regression for fable-review.md C4: all lanes attached to the same pin key
// must be unioned — FR-034b says everything transitively connected through
// pins and junctions is ONE net, so a wire on U1.A0 plus a bus whose bit 0 is
// snapped to A0 is one net, not two nets both listing U1.A0.
test(
  "a wire and a group-snapped bus sharing a pin form one net (FR-034b)",
  () => {
    const d = createDesign("t");
    addInstance(d, tyA(), 10, 20, 0); // U1
    const bus = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, 3);
    bus.groupConnections.push({
      vertex: bus.path[1].v,
      instance: "U1",
      group: "A",
      bitMap: ["A0", "A1", "A2"],
    });
    const w = addWire(
      d,
      { kind: "pin", refdes: "U1", pin: "A0" },
      { kind: "free", x: -5, y: 22 },
    );

    const nets = buildNets(d);
    const withA0 = nets.filter((n) => n.pins.includes("U1.A0"));
    assert.equal(withA0.length, 1); // exactly one net carries U1.A0
    assert.deepEqual(sorted(withA0[0].members), sorted([bus.id, w.id]));
    assert.deepEqual(withA0[0].provenance, [{ bus: bus.id, bit: 0 }]);
    assert.equal(nets.length, 3); // bits 1 and 2 remain separate nets
  },
);

test("a bus↔bus full junction aligns lanes by index (FR-039a)", () => {
  const d = createDesign("t");
  addInstance(d, tyA(), 10, 20, 0);
  addInstance(d, tyA(), 80, 20, 0);
  const b1 = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, 2);
  b1.groupConnections.push({
    vertex: b1.path[0].v,
    instance: "U1",
    group: "A",
    bitMap: ["A0", "A1"],
  });
  const j = branchWire(d, b1, 0, 4, 0); // full join (no bit)
  const b2 = addBus(d, { kind: "vertex", id: j.id }, { kind: "free", x: 8, y: 0 }, 2);
  b2.groupConnections.push({
    vertex: b2.path[1].v,
    instance: "U2",
    group: "A",
    bitMap: ["A0", "A1"],
  });

  const nets = buildNets(d);
  assert.equal(nets.length, 2);
  const byBit0 = nets.find((n) => n.pins.includes("U1.A0"));
  assert.deepEqual(sorted(byBit0.pins), ["U1.A0", "U2.A0"]);
  assert.deepEqual(sorted(byBit0.members), sorted([b1.id, b2.id]));
});

test("an unequal-width bus join aligns by the offset k: narrow i ↔ wide k+i (FR-039b)", () => {
  const d = createDesign("t");
  addInstance(d, tyA(), 10, 20, 0); // U1 (3-bit group A)
  // A width-4 wide bus group-snapped to a wider type would need a 4-pin group;
  // here we only need the lane alignment, so drive pins off the width-2 narrow bus.
  const wide = addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 8, y: 0 }, 4);
  const j = branchWire(d, wide, 0, 4, 0); // T-junction on the wide bus
  j.offset = 2; // narrow bit 0 ↦ wide bit 2, narrow bit 1 ↦ wide bit 3
  const narrow = addBus(d, { kind: "vertex", id: j.id }, { kind: "free", x: 4, y: 8 }, 2);
  narrow.groupConnections.push({
    vertex: narrow.path[1].v,
    instance: "U1",
    group: "A",
    bitMap: ["A0", "A1"],
  });

  const nets = buildNets(d);
  // wide lanes 2,3 join narrow 0,1 (which carry U1.A0/A1); wide lanes 0,1 have no
  // pins, so only the two pin-bearing nets are returned (§6.6).
  const byPin = Object.fromEntries(nets.map((n) => [n.pins[0], n]));
  assert.deepEqual(sorted(byPin["U1.A0"].members), sorted([wide.id, narrow.id]));
  assert.deepEqual(sorted(byPin["U1.A1"].members), sorted([wide.id, narrow.id]));
  // Provenance shows both bus lanes on the shared net (narrow bit 0 + wide bit 2).
  assert.deepEqual(
    sorted(byPin["U1.A0"].provenance.map((p) => `${p.bus}:${p.bit}`)),
    sorted([`${narrow.id}:0`, `${wide.id}:2`]),
  );
  assert.equal(nets.length, 2);
});

test("same-label ports join their nets across the sheet (FR-094a)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  const p1 = addInstance(d, PORT, 0, 0, 0); // A-1
  const p2 = addInstance(d, PORT, 0, 10, 0); // A-2
  p1.label = "CLK";
  p2.label = "CLK";
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: p1.refdes, pin: "P" },
  );
  const w2 = addWire(
    d,
    { kind: "pin", refdes: "U2", pin: "A0" },
    { kind: "pin", refdes: p2.refdes, pin: "P" },
  );

  // The port connection points are connector vertices, not pin vertices.
  assert.equal(d.vertices.filter((v) => v.kind === "connector").length, 2);

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  // FR-094e: the port connectors' own pins are net members too.
  assert.deepEqual(sorted(nets[0].pins), [
    `${p1.refdes}.P`,
    `${p2.refdes}.P`,
    "U1./Y0",
    "U2.A0",
  ]);
  assert.deepEqual(sorted(nets[0].members), sorted([w1.id, w2.id]));
  assert.equal(nets[0].name, "CLK"); // the label names the net
});

test("a port pin is a queryable net member (FR-094e)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  const p = addInstance(d, PORT, 0, 0, 0); // A-1
  p.label = "SIG";
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "A0" },
    { kind: "pin", refdes: p.refdes, pin: "P" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(sorted(nets[0].pins), [`${p.refdes}.P`, "U1.A0"]);
});

test("differently-labeled ports stay separate nets", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  const p1 = addInstance(d, PORT, 0, 0, 0);
  const p2 = addInstance(d, PORT, 0, 10, 0);
  p1.label = "CLK";
  p2.label = "RST";
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: p1.refdes, pin: "P" },
  );
  addWire(
    d,
    { kind: "pin", refdes: "U2", pin: "A0" },
    { kind: "pin", refdes: p2.refdes, pin: "P" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 2);
});
