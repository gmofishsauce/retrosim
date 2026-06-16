import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  branchWire,
  pinVisualPos,
  PIN_RADIUS,
} from "../model/design.js";
import { hitComponent, hitPin, hitJunction, hitBend, marqueeHits, PIN_HIT_TOL } from "./hittest.js";

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [{ name: "A0", side: "left", position: 2, direction: "in" }],
  };
}

// marqueeFixture: U1 bbox [0,6]x[0,12], U2 bbox [20,26]x[0,12], and a wire whose
// world path runs (5,5) -> (7,5) -> (9,9).
function marqueeFixture() {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 0); // U1
  addInstance(d, ty(), 20, 0, 0); // U2
  const w = addWire(d, { kind: "free", x: 5, y: 5 }, { kind: "free", x: 9, y: 9 }, [
    { x: 7, y: 5 },
  ]);
  return { d, wireId: w.id };
}
const refSet = (hits) => hits.map((h) => h.refdes ?? h.id).sort();

test("marqueeHits window selects only fully-enclosed objects (FR-016b)", () => {
  const { d, wireId } = marqueeFixture();
  // rect encloses U1 and the whole wire, but not U2
  const hits = marqueeHits(d, { x: -1, y: -1 }, { x: 10, y: 13 }, "window");
  assert.deepEqual(refSet(hits), ["U1", wireId].sort());
});

test("marqueeHits window excludes a partially-covered wire (FR-016b)", () => {
  const { d } = marqueeFixture();
  // rect covers U1 exactly and only part of the wire ((9,9) is outside)
  const hits = marqueeHits(d, { x: 0, y: 0 }, { x: 6, y: 12 }, "window");
  assert.deepEqual(refSet(hits), ["U1"]);
});

test("marqueeHits crossing selects every touched object (FR-016b)", () => {
  const { d, wireId } = marqueeFixture();
  // rect overlaps U1, U2, and the first wire segment
  const hits = marqueeHits(d, { x: 4, y: 4 }, { x: 30, y: 13 }, "crossing");
  assert.deepEqual(refSet(hits), ["U1", "U2", wireId].sort());
});

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

// junctionFixture: a wire (0,0)->(10,0) with a branch tapped at (5,0), creating
// a junction node there (FR-032a / FR-034b).
function junctionFixture() {
  const d = createDesign("t");
  const w = addWire(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 10, y: 0 });
  const j = branchWire(d, w, 0, 5, 0);
  return { d, wireId: w.id, vertexId: j.id };
}

test("hitJunction picks up a junction node (FR-032a)", () => {
  const { d, wireId, vertexId } = junctionFixture();
  const hit = hitJunction(d, { x: 5, y: 0 }, 0.5);
  assert.ok(hit);
  assert.equal(hit.wire.id, wireId);
  assert.equal(hit.vertexId, vertexId);
});

test("hitJunction misses away from the junction and at an endpoint", () => {
  const { d } = junctionFixture();
  assert.equal(hitJunction(d, { x: 7, y: 0 }, 0.5), null);
  assert.equal(hitJunction(d, { x: 0, y: 0 }, 0.5), null); // free endpoint, not a junction
});

test("hitBend does not match a junction node (the old immovability bug)", () => {
  const { d } = junctionFixture();
  // hitBend only matches `bend` path points; a junction is a `node`, so the
  // bend hit-test returns null — which is exactly why junctions had been
  // undraggable before hitJunction was added.
  assert.equal(hitBend(d, { x: 5, y: 0 }, 0.5), null);
});
