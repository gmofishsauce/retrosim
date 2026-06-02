import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, addWire, insertBend } from "../model/design.js";
import { hitSegment } from "./hittest.js";

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in", width: 1 },
      { name: "/Y0", side: "right", position: 2, direction: "out", width: 1 },
    ],
  };
}

// U1./Y0 world = (16,22); U2.A0 world = (40,22): a horizontal wire at y=22.
function setup() {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  return { d, w };
}

test("hitSegment finds a wire near the click", () => {
  const { d, w } = setup();
  const hit = hitSegment(d, { x: 28, y: 22 }, 0.5);
  assert.equal(hit.wire.id, w.id);
  assert.equal(hit.segIndex, 0);
});

test("hitSegment honors tolerance", () => {
  const { d } = setup();
  assert.equal(hitSegment(d, { x: 28, y: 22.3 }, 0.5).segIndex, 0);
  assert.equal(hitSegment(d, { x: 28, y: 25 }, 0.5), null);
});

test("hitSegment returns the correct segment index after a bend", () => {
  const { d, w } = setup();
  insertBend(w, 0, 28, 30); // path: (16,22) -> bend(28,30) -> (40,22)
  // A point on the second segment, near the line from (28,30) to (40,22).
  const hit = hitSegment(d, { x: 34, y: 26 }, 0.6);
  assert.equal(hit.wire.id, w.id);
  assert.equal(hit.segIndex, 1);
});

test("hitSegment returns the nearest of multiple wires", () => {
  const { d } = setup();
  addInstance(d, ty(), 10, 40, 0); // U3 -> /Y0 world (16,42)
  addInstance(d, ty(), 40, 40, 0); // U4 -> A0 world (40,42)
  const w2 = addWire(
    d,
    { kind: "pin", refdes: "U3", pin: "/Y0" },
    { kind: "pin", refdes: "U4", pin: "A0" },
  ); // horizontal at y=42
  const hit = hitSegment(d, { x: 28, y: 41.8 }, 0.5);
  assert.equal(hit.wire.id, w2.id);
});

test("hitSegment returns null with no wires", () => {
  const d = createDesign("t");
  assert.equal(hitSegment(d, { x: 0, y: 0 }, 0.5), null);
});
