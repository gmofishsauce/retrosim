import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  pinWorldPos,
  addWire,
  vertexWorld,
  getVertex,
} from "./design.js";

// Type with one input (left) and one output (right) pin.
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

function setup() {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  addInstance(d, ty(), 70, 20, 0); // U3
  return d;
}

test("addWire between two pins creates a wire and two pin vertices", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );

  assert.equal(d.wires.length, 1);
  assert.equal(d.vertices.length, 2);
  assert.equal(w.path.length, 2);
  assert.equal(w.path[0].t, "node");
  assert.equal(w.path[1].t, "node");

  const v0 = getVertex(d, w.path[0].v);
  assert.equal(v0.kind, "pin");
  assert.equal(v0.ref, "U1");
  assert.equal(v0.pin, "/Y0");
});

test("a pin vertex is reused for fan-out (one pin, two wires)", () => {
  const d = setup();
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const w2 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  assert.equal(d.wires.length, 2);
  assert.equal(d.vertices.length, 3); // U1./Y0 shared, U2.A0, U3.A0
  assert.equal(w1.path[0].v, w2.path[0].v); // same source vertex id
});

test("a free endpoint creates a free vertex at the given coordinate", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 30, y: 26 },
  );
  const vEnd = getVertex(d, w.path[1].v);
  assert.equal(vEnd.kind, "free");
  assert.deepEqual(vertexWorld(d, vEnd), { x: 30, y: 26 });
});

test("vertexWorld derives a pin vertex position and tracks instance moves", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 30, y: 26 },
  );
  const vPin = getVertex(d, w.path[0].v);
  assert.deepEqual(vertexWorld(d, vPin), pinWorldPos(d.components[0], "/Y0"));

  d.components[0].x += 5; // move U1
  assert.deepEqual(vertexWorld(d, vPin), pinWorldPos(d.components[0], "/Y0"));
});
