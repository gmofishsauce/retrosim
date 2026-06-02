import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, pinWorldPos } from "./design.js";

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
