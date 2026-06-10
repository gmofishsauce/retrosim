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

// KNOWN BUG (fable-review.md C4): attachments bind pins to lanes but never
// union lanes that share a pin, so a wire on U1.A0 plus a bus whose bit 0 is
// snapped to A0 yields TWO nets, both listing U1.A0. FR-034b: everything
// transitively connected through pins and junctions is ONE net. Fix by unioning
// all lanes attached to the same pin key in buildNets. Remove the `todo`
// option once fixed.
test(
  "a wire and a group-snapped bus sharing a pin form one net (FR-034b)",
  { todo: "known bug — see fable-review.md C4" },
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
