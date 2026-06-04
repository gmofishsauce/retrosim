import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance } from "../model/design.js";
import { hitComponent, hitPin } from "./hittest.js";

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
