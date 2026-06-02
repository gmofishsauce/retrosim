import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  pinWorldPos,
  addWire,
  branchWire,
  cleanup,
  deleteWire,
  deleteInstance,
  getVertex,
} from "./design.js";

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

function setup() {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0); // U1
  addInstance(d, ty(), 40, 20, 0); // U2
  addInstance(d, ty(), 70, 20, 0); // U3
  return d;
}

test("deleteWire removes the wire and GCs its orphaned pin vertices", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  deleteWire(d, w.id);
  assert.equal(d.wires.length, 0);
  assert.equal(d.vertices.length, 0);
});

test("deleting a branch reverts an interior junction to a bend (G2)", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w, 0, 25, 26); // J interior of w
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  deleteWire(d, w2.id);
  assert.equal(getVertex(d, j.id), null); // junction removed
  assert.equal(w.path.length, 3);
  assert.deepEqual(w.path[1], { t: "bend", x: 25, y: 26 }); // reverted to bend
});

test("deleting the host demotes a junction to a free (dangling) endpoint", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w, 0, 25, 26);
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  deleteWire(d, w.id);
  assert.equal(d.wires.length, 1); // w2 remains
  const jv = getVertex(d, j.id);
  assert.equal(jv.kind, "free"); // demoted, dangling (FR-029)
  assert.deepEqual({ x: jv.x, y: jv.y }, { x: 25, y: 26 });
});

test("cleanup prunes a wire with both endpoints free (FR-030)", () => {
  const d = setup();
  addWire(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 5, y: 5 });
  cleanup(d);
  assert.equal(d.wires.length, 0);
  assert.equal(d.vertices.length, 0);
});

test("deleteInstance frees its pins; a half-connected wire stays (FR-018a/029)", () => {
  const d = setup();
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const oldPos = pinWorldPos(d.components[1], "A0"); // U2.A0 world pos

  deleteInstance(d, "U2");
  assert.equal(d.components.length, 2); // U1, U3
  assert.equal(d.wires.length, 1); // wire kept, now dangling at the U2 end
  const ends = w.path.map((p) => getVertex(d, p.v));
  const freeEnd = ends.find((v) => v.kind === "free");
  assert.ok(freeEnd);
  assert.deepEqual({ x: freeEnd.x, y: freeEnd.y }, oldPos);
});

test("deleteInstance prunes a wire whose both ends were on it (FR-030)", () => {
  const d = setup();
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U1", pin: "A0" },
  );
  deleteInstance(d, "U1");
  assert.equal(d.components.length, 2);
  assert.equal(d.wires.length, 0);
  assert.equal(d.vertices.length, 0);
});
