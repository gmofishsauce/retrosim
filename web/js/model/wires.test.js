import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  pinWorldPos,
  addWire,
  vertexWorld,
  getVertex,
  setWireEndpoint,
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

// A wire from a pin to a dangling free end, for the pick-up-again tests (FR-027f).
function withFreeEnd(d) {
  return addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 30, y: 26 },
  );
}

test("setWireEndpoint repositions a free end (FR-027f)", () => {
  const d = setup();
  const w = withFreeEnd(d);
  setWireEndpoint(d, w.id, 1, { kind: "free", x: 33, y: 28 });
  const vEnd = getVertex(d, w.path[1].v);
  assert.equal(vEnd.kind, "free");
  assert.deepEqual(vertexWorld(d, vEnd), { x: 33, y: 28 });
  assert.equal(d.vertices.length, 2); // unchanged
});

test("setWireEndpoint reconnects a free end to a pin and prunes the free vertex (FR-027f)", () => {
  const d = setup();
  const w = withFreeEnd(d);
  const freeId = w.path[1].v;
  setWireEndpoint(d, w.id, 1, { kind: "pin", refdes: "U2", pin: "A0" });
  const vEnd = getVertex(d, w.path[1].v);
  assert.equal(vEnd.kind, "pin");
  assert.equal(vEnd.ref, "U2");
  assert.equal(vEnd.pin, "A0");
  assert.equal(getVertex(d, freeId), null); // orphaned free vertex removed (FR-030)
});

test("setWireEndpoint reuses an existing pin vertex when reconnecting (fan-out)", () => {
  const d = setup();
  addWire(d, { kind: "pin", refdes: "U3", pin: "A0" }, { kind: "pin", refdes: "U2", pin: "A0" });
  const before = d.vertices.length;
  const u2a0 = d.vertices.find((v) => v.ref === "U2" && v.pin === "A0");
  const w = withFreeEnd(d); // adds U1./Y0 (persists) + a free vertex (pruned on reconnect)
  setWireEndpoint(d, w.id, 1, { kind: "pin", refdes: "U2", pin: "A0" });
  // Net effect vs `before`: +1 for the kept U1./Y0 vertex; the free vertex is
  // pruned and the existing U2.A0 vertex is reused (not duplicated).
  assert.equal(d.vertices.length, before + 1);
  assert.equal(w.path[1].v, u2a0.id);
});

test("setWireEndpoint rejects moving a non-free (pin) endpoint (FR-027f)", () => {
  const d = setup();
  const w = withFreeEnd(d);
  assert.throws(() => setWireEndpoint(d, w.id, 0, { kind: "free", x: 5, y: 5 }), /free/);
});

test("setWireEndpoint rejects a non-endpoint index", () => {
  const d = setup();
  const w = withFreeEnd(d);
  assert.throws(() => setWireEndpoint(d, w.id, 5, { kind: "free", x: 5, y: 5 }), /endpoint/);
});
