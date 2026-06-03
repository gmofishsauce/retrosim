import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addBus,
  pinWorldPos,
  matchingGroups,
  snapBusGroup,
  setBusBitNames,
  breakoutBit,
  getVertex,
} from "./design.js";

// A representative component type (stub-shaped, see server stubComponents).
function type74138() {
  return {
    name: "74138",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in", width: 1 },
      { name: "/Y0", side: "right", position: 2, direction: "out", width: 1 },
      { name: "GND", side: "bottom", position: 3, direction: "in", width: 1 },
      { name: "Vcc", side: "top", position: 3, direction: "in", width: 1 },
    ],
  };
}

test("createDesign produces an empty design with the given name", () => {
  const d = createDesign("unnamed schematic 2026-06-02 10:00");
  assert.equal(d.name, "unnamed schematic 2026-06-02 10:00");
  assert.deepEqual(d.components, []);
  assert.deepEqual(d.wires, []);
  assert.deepEqual(d.buses, []);
  assert.deepEqual(d.vertices, []);
});

test("addInstance assigns sequential refdes from U1", () => {
  const d = createDesign("t");
  const u1 = addInstance(d, type74138(), 0, 0, 0);
  const u2 = addInstance(d, type74138(), 5, 0, 0);
  assert.equal(u1.refdes, "U1");
  assert.equal(u2.refdes, "U2");
  assert.equal(d.components.length, 2);
});

test("addInstance increments past gaps (FR-011)", () => {
  const d = createDesign("t");
  // Simulate a prior delete leaving U1 and U3.
  d.components.push({ refdes: "U1" }, { refdes: "U3" });
  const next = addInstance(d, type74138(), 0, 0, 0);
  assert.equal(next.refdes, "U4");
});

test("addInstance records type name, position, rotation, empty overrides", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 90);
  assert.equal(inst.type, "74138");
  assert.equal(inst.x, 10);
  assert.equal(inst.y, 20);
  assert.equal(inst.rotation, 90);
  assert.deepEqual(inst.overrides, {});
});

test("addInstance copies type data (mutating the source does not affect it)", () => {
  const d = createDesign("t");
  const src = type74138();
  const inst = addInstance(d, src, 0, 0, 0);
  src.pins[0].name = "MUTATED";
  assert.equal(inst.typeData.pins[0].name, "A0");
});

test("pinWorldPos applies side/position offset at rotation 0", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 0);
  assert.deepEqual(pinWorldPos(inst, "A0"), { x: 10, y: 22 }); // left,pos2 -> (0,2)
  assert.deepEqual(pinWorldPos(inst, "/Y0"), { x: 16, y: 22 }); // right,pos2 -> (6,2)
  assert.deepEqual(pinWorldPos(inst, "GND"), { x: 13, y: 32 }); // bottom,pos3 -> (3,12)
});

test("pinWorldPos applies rotation (§6.7)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 90);
  // A0 offset (0,2) rotated 90 -> (-2,0) -> world (8,20)
  assert.deepEqual(pinWorldPos(inst, "A0"), { x: 8, y: 20 });
});

test("pinWorldPos throws for an unknown pin", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 0, 0, 0);
  assert.throws(() => pinWorldPos(inst, "NOPE"));
});

// --- matchingGroups (FR-041) ---

// A type with two equal-width groups (A, B) and one wider group (Y).
function typeALU() {
  return {
    name: "ALU",
    width: 8,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in", width: 1 },
      { name: "A1", side: "left", position: 3, direction: "in", width: 1 },
      { name: "B0", side: "left", position: 5, direction: "in", width: 1 },
      { name: "B1", side: "left", position: 6, direction: "in", width: 1 },
      { name: "Y", side: "right", position: 3, direction: "out", width: 4 },
    ],
    pinGroups: [
      { name: "A", pins: ["A0", "A1"] },
      { name: "B", pins: ["B0", "B1"] },
      { name: "Y", pins: ["Y"] },
    ],
  };
}

test("matchingGroups returns groups whose summed pin width equals the bus width", () => {
  const t = typeALU();
  assert.deepEqual(
    matchingGroups(t, 2).map((g) => g.name),
    ["A", "B"],
  );
  assert.deepEqual(
    matchingGroups(t, 4).map((g) => g.name),
    ["Y"], // a single 4-bit pin sums to 4
  );
});

test("matchingGroups returns [] when no group matches or none are declared", () => {
  assert.deepEqual(matchingGroups(typeALU(), 3), []);
  assert.deepEqual(matchingGroups({ pins: [] }, 2), []);
});

test("matchingGroups throws if a group names an unknown pin", () => {
  const t = { pins: [], pinGroups: [{ name: "A", pins: ["A0"] }] };
  assert.throws(() => matchingGroups(t, 1));
});

// --- snapBusGroup / setBusBitNames (FR-042/FR-037b) ---

// A 74138-shaped type with a 3-bit single-bit-pin group "A".
function type74138Grp() {
  return {
    name: "74138",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in", width: 1 },
      { name: "A1", side: "left", position: 3, direction: "in", width: 1 },
      { name: "A2", side: "left", position: 4, direction: "in", width: 1 },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
  };
}

const freeBus = (d, width) =>
  addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, width);

test("snapBusGroup records a group connection and adopts bit names (FR-042/037b)", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0); // U1
  const bus = freeBus(d, 3);
  const vid = bus.path[1].v;
  snapBusGroup(d, bus.id, vid, "U1", "A");
  assert.deepEqual(bus.groupConnections, [
    { vertex: vid, instance: "U1", group: "A", bitMap: ["A0", "A1", "A2"] },
  ]);
  assert.deepEqual(bus.bitNames, ["A0", "A1", "A2"]);
});

test("snapBusGroup does not overwrite existing bit names", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0);
  const bus = freeBus(d, 3);
  bus.bitNames = ["X0", "X1", "X2"];
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A");
  assert.deepEqual(bus.bitNames, ["X0", "X1", "X2"]);
});

test("snapBusGroup expands a multi-bit group pin across bus bits (FR-042)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0); // Y is a 4-bit pin
  const bus = freeBus(d, 4);
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "Y");
  assert.deepEqual(bus.groupConnections[0].bitMap, ["Y", "Y", "Y", "Y"]);
});

test("snapBusGroup throws on a group/bus width mismatch", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0);
  const bus = freeBus(d, 2);
  assert.throws(() => snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A"));
});

test("setBusBitNames sets and clears names with a length check (FR-037b)", () => {
  const d = createDesign("t");
  const bus = freeBus(d, 2);
  setBusBitNames(d, bus.id, ["C", "V"]);
  assert.deepEqual(bus.bitNames, ["C", "V"]);
  setBusBitNames(d, bus.id, null);
  assert.equal(bus.bitNames, null);
  assert.throws(() => setBusBitNames(d, bus.id, ["only-one"]));
});

// --- breakoutBit (FR-043a) ---

test("breakoutBit taps one bus bit and starts a single-bit wire (FR-043a)", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 40, 20, 0); // U1 (has pin A0)
  const bus = freeBus(d, 4);
  const wire = breakoutBit(d, bus.id, 0, 4, 0, 2, {
    kind: "pin",
    refdes: "U1",
    pin: "A0",
  });

  // a junction with bit==2 was inserted as an interior node of the bus path
  const jNode = bus.path.find(
    (p) => p.t === "node" && getVertex(d, p.v).kind === "junction",
  );
  const j = getVertex(d, jNode.v);
  assert.equal(j.bit, 2);
  // the new single-bit wire runs from that junction to the pin
  assert.equal(d.wires.length, 1);
  assert.equal(wire.path[0].v, j.id);
});

test("breakoutBit rejects an out-of-range bit", () => {
  const d = createDesign("t");
  const bus = freeBus(d, 4);
  assert.throws(() =>
    breakoutBit(d, bus.id, 0, 4, 0, 4, { kind: "free", x: 1, y: 1 }),
  );
});
