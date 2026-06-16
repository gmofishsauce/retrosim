import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  insertBend,
  branchWire,
  branchAtPathPoint,
  moveVertex,
  vertexWorld,
  getVertex,
} from "./design.js";

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
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  return { d, w };
}

test("branchWire inserts a junction node mid-segment", () => {
  const { d, w } = setup();
  const j = branchWire(d, w, 0, 25, 26);
  assert.equal(j.kind, "junction");
  assert.deepEqual(vertexWorld(d, j), { x: 25, y: 26 });
  assert.equal(w.path.length, 3);
  assert.equal(w.path[1].t, "node");
  assert.equal(w.path[1].v, j.id);
});

test("a branch wire shares the junction vertex (fan-out)", () => {
  const { d, w } = setup();
  const j = branchWire(d, w, 0, 25, 26);
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );
  assert.equal(w2.path[0].v, j.id); // same junction as host
  assert.equal(d.wires.length, 2);
});

test("moveVertex repositions a junction and carries every conductor (FR-032a)", () => {
  const { d, w } = setup();
  const j = branchWire(d, w, 0, 25, 26);
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );
  moveVertex(d, j.id, 30, 31);
  // The host's interior junction node and the branch's endpoint node both read
  // the new position from the single shared vertex.
  assert.deepEqual(vertexWorld(d, getVertex(d, w.path[1].v)), { x: 30, y: 31 });
  assert.deepEqual(vertexWorld(d, getVertex(d, w2.path[0].v)), { x: 30, y: 31 });
});

test("moveVertex refuses a pin vertex (derived position)", () => {
  const { d, w } = setup();
  const pinVertexId = w.path[0].v; // U1./Y0 pin vertex
  assert.throws(() => moveVertex(d, pinVertexId, 5, 5), /cannot move a pin/);
});

test("branchAtPathPoint promotes an interior bend to a junction", () => {
  const { d, w } = setup();
  insertBend(w, 0, 30, 28); // path: node, bend(30,28), node
  const j = branchAtPathPoint(d, w, 1);
  assert.equal(j.kind, "junction");
  assert.deepEqual(vertexWorld(d, j), { x: 30, y: 28 });
  assert.equal(w.path[1].t, "node");
  assert.equal(w.path[1].v, j.id);
  assert.equal(w.path.length, 3);
});

test("branchAtPathPoint reuses an existing junction", () => {
  const { d, w } = setup();
  const j = branchWire(d, w, 0, 25, 26);
  const again = branchAtPathPoint(d, w, 1);
  assert.equal(again.id, j.id);
  assert.equal(d.vertices.filter((v) => v.kind === "junction").length, 1);
});

test("branchAtPathPoint rejects an endpoint (pin) node", () => {
  const { d, w } = setup();
  assert.throws(() => branchAtPathPoint(d, w, 0));
});
