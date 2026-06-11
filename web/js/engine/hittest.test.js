import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, pinVisualPos, PIN_RADIUS } from "../model/design.js";
import { hitComponent, hitPin, PIN_HIT_TOL } from "./hittest.js";

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [{ name: "A0", side: "left", position: 2, direction: "in" }],
  };
}

test("hitComponent detects a point inside the (unrotated) outline", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // bbox x[10,16] y[20,32]
  assert.equal(hitComponent(d, { x: 12, y: 25 })?.refdes, "U1");
  assert.equal(hitComponent(d, { x: 5, y: 5 }), null);
});

test("hitComponent accounts for rotation (90 swaps the bbox)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 90); // bbox x[-12,0] y[0,6]
  assert.equal(hitComponent(d, { x: -5, y: 3 })?.refdes, "U1");
  assert.equal(hitComponent(d, { x: 3, y: 3 }), null);
});

test("hitComponent returns the topmost (last-added) overlapping instance", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 0); // U1
  addInstance(d, ty(), 0, 0, 0); // U2 overlaps U1
  assert.equal(hitComponent(d, { x: 2, y: 2 })?.refdes, "U2");
});

test("hitPin returns the pin within tolerance", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // A0 world (10,22)
  assert.deepEqual(hitPin(d, { x: 10.2, y: 22.1 }, 0.5), {
    refdes: "U1",
    pin: "A0",
  });
});

test("hitPin returns null when no pin is within tolerance", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0);
  assert.equal(hitPin(d, { x: 13, y: 25 }, 0.5), null);
  assert.equal(hitPin(d, { x: 10.6, y: 22 }, 0.5), null); // just outside tol
});

// ty2 has two adjacent left-side pins, one grid unit apart (FR-013).
function ty2() {
  return {
    name: "T2",
    width: 4,
    height: 4,
    pins: [
      { name: "A", side: "left", position: 1, direction: "in" },
      { name: "B", side: "left", position: 2, direction: "in" },
    ],
  };
}

test("pinVisualPos: one bubble radius outward of the grid point, rotation-aware (FR-013d)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, ty2(), 0, 0, 0);
  // Left-side pin at grid (0,1): outward is -x.
  assert.deepEqual(pinVisualPos(inst, "A"), { x: -PIN_RADIUS, y: 1 });
  inst.rotation = 90; // outward normal rotates with the pin
  const w = pinVisualPos(inst, "A");
  assert.equal(w.x, -1);
  assert.equal(w.y, -PIN_RADIUS);
});

test("hot region: PIN_HIT_TOL circle about the visual attachment point (FR-013d)", () => {
  const d = createDesign("t");
  addInstance(d, ty2(), 0, 0, 0); // A: grid (0,1), bubble center (-0.25, 1)
  // Just inside / just outside, measured from the bubble center.
  const cx = -PIN_RADIUS;
  assert.deepEqual(hitPin(d, { x: cx - PIN_HIT_TOL + 0.05, y: 1 }), { refdes: "U1", pin: "A" });
  assert.equal(hitPin(d, { x: cx - PIN_HIT_TOL - 0.05, y: 1 }), null);
  // The grid point itself stays well inside the region.
  assert.deepEqual(hitPin(d, { x: 0, y: 1 }), { refdes: "U1", pin: "A" });
});

test("nearest pin wins where adjacent hot regions overlap (FR-013d)", () => {
  const d = createDesign("t");
  addInstance(d, ty2(), 0, 0, 0); // A at y=1, B at y=2 — regions overlap (tol > 0.5)
  assert.deepEqual(hitPin(d, { x: -PIN_RADIUS, y: 1.4 }), { refdes: "U1", pin: "A" });
  assert.deepEqual(hitPin(d, { x: -PIN_RADIUS, y: 1.6 }), { refdes: "U1", pin: "B" });
});

test("subunit pins keep the on-grid connection point as the visual point (FR-013d/FR-013c)", () => {
  const inst = {
    refdes: "U2A",
    x: 0,
    y: 0,
    rotation: 0,
    typeData: {
      name: "G",
      renderType: "subunit",
      renderAs: "nand",
      unit: "A",
      pins: [
        { name: "1A", side: "left", unit: "A", direction: "in" },
        { name: "1B", side: "left", unit: "A", direction: "in" },
        { name: "1Y", side: "right", unit: "A", direction: "out" },
      ],
    },
    overrides: {},
  };
  const d = { components: [inst], wires: [], buses: [], vertices: [] };
  const w = pinVisualPos(inst, "1A");
  assert.ok(Number.isInteger(w.x) && Number.isInteger(w.y)); // no bubble offset
  assert.deepEqual(hitPin(d, w), { refdes: "U2A", pin: "1A" });
});
