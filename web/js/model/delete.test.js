import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  pinWorldPos,
  addWire,
  addBus,
  branchWire,
  cleanup,
  deleteWire,
  deleteInstance,
  snapBusGroup,
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

// KNOWN BUG (fable-review.md C1): a snap-connected bus keeps free-kind endpoint
// vertices (the attachment lives only in bus.groupConnections), so the global
// FR-030 sweep run by any unrelated deletion wrongly prunes it. A group
// connection means the endpoint IS connected (FR-041a/FR-042). Remove the
// `todo` option once cleanup() treats group-connected endpoints as connected.
test(
  "cleanup keeps a snap-connected bus when an unrelated wire is deleted (FR-030/FR-041a)",
  { todo: "known bug — see fable-review.md C1" },
  () => {
    const d = createDesign("t");
    addInstance(
      d,
      {
        name: "TA",
        width: 6,
        height: 12,
        pins: [
          { name: "A0", side: "left", position: 2, direction: "in" },
          { name: "A1", side: "left", position: 3, direction: "in" },
          { name: "A2", side: "left", position: 4, direction: "in" },
          { name: "/Y0", side: "right", position: 2, direction: "out" },
        ],
        pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
      },
      10,
      20,
      0,
    ); // U1

    // A bus snapped to U1's group A: both endpoint vertices are kind "free";
    // the connection is recorded in groupConnections (FR-042).
    const bus = addBus(
      d,
      { kind: "free", x: 0, y: 22 },
      { kind: "free", x: 10, y: 22 },
      3,
    );
    snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A");

    // Delete an unrelated wire elsewhere; deleteWire runs the global cleanup.
    const w = addWire(
      d,
      { kind: "pin", refdes: "U1", pin: "/Y0" },
      { kind: "free", x: 30, y: 22 },
    );
    deleteWire(d, w.id);

    assert.equal(d.buses.length, 1); // the snapped bus must survive
    assert.equal(d.buses[0].groupConnections.length, 1);
  },
);

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
