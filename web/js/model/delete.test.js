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
  deleteSegment,
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

// Two vertically-aligned left-side input pins, so a wire tying them is straight.
function tyTie() {
  return {
    name: "TIE",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "A1", side: "left", position: 4, direction: "in" },
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

test("a junction demoted to a collinear bend is pruned, not left as a 0° bend (FR-033c/FR-033d)", () => {
  const d = createDesign("t");
  addInstance(d, tyTie(), 10, 20, 0); // U1, two vertically-aligned left pins
  addInstance(d, ty(), 40, 20, 0); // U2, far end of the branch
  const u1 = d.components.find((c) => c.refdes === "U1");
  const p0 = pinWorldPos(u1, "A0");
  const p1 = pinWorldPos(u1, "A1");
  assert.equal(p0.x, p1.x); // straight vertical tie between the two inputs

  // The input-tie wire, with a junction midway that a branch taps.
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "A0" },
    { kind: "pin", refdes: "U1", pin: "A1" },
  );
  const mid = { x: p0.x, y: (p0.y + p1.y) / 2 };
  const j = branchWire(d, w, 0, mid.x, mid.y); // collinear with both pins
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );

  deleteSegment(d, w2.id, 0); // delete the branch stub, as in the bug report
  assert.equal(getVertex(d, j.id), null); // junction demoted away
  assert.equal(d.wires.length, 1); // the tie wire survives (pin-anchored)
  assert.equal(w.path.length, 2); // the 0° bend was pruned (FR-033c)
  assert.equal(w.path.every((p) => p.t === "node"), true);
});

test("a junction dropping to degree 2 merges its two conductors, dropping the dot (§3.3 G2/FR-034c)", () => {
  const d = createDesign("t");
  addInstance(d, tyTie(), 10, 20, 0); // U1, pins A0/A1
  // A through-connection drawn as one wire from A0 out to a free point, plus a
  // second wire from A1 ending on a junction tapped into it — a real T (degree 3).
  const wA = addWire(d, { kind: "pin", refdes: "U1", pin: "A0" }, { kind: "free", x: 30, y: 30 });
  const j = branchWire(d, wA, 0, 20, 22); // junction interior to wA
  const wB = addWire(d, { kind: "vertex", id: j.id }, { kind: "pin", refdes: "U1", pin: "A1" });
  assert.equal(getVertex(d, j.id).kind, "junction"); // degree 3 so far

  // Delete the stub segment (junction → the free/dangling end), as in the bug.
  // wA is now [A0, j, free]; segment 1 is j→free. That drops wA to [A0, j],
  // leaving j the endpoint of two conductors (wA, wB): degree 2, no branch.
  deleteSegment(d, wA.id, 1);

  assert.equal(getVertex(d, j.id), null); // junction merged away — no lingering dot
  assert.equal(d.vertices.some((v) => v.kind === "junction"), false);
  assert.equal(d.wires.length, 1); // wA + wB merged into one continuous wire
  const w = d.wires[0];
  const ends = [w.path[0], w.path[w.path.length - 1]].map((p) => getVertex(d, p.v));
  assert.deepEqual(
    ends.map((v) => v.kind).sort(),
    ["pin", "pin"],
  );
  assert.deepEqual(ends.map((v) => v.pin).sort(), ["A0", "A1"]);
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

// Regression for fable-review.md C1: a snap-connected bus keeps free-kind
// endpoint vertices (the attachment lives in bus.groupConnections), but a group
// connection means the endpoint IS connected (FR-041a/FR-042), so the global
// FR-030 sweep must not prune it.
test(
  "cleanup keeps a snap-connected bus when an unrelated wire is deleted (FR-030/FR-041a)",
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

// --- FR-018a group-connection removal: deleting a component drops every bus
// group connection bound to it, so no stale record can later re-bind when the
// refdes number is reused. ---

function tyG() {
  return {
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
  };
}

test("deleteInstance drops the deleted component's group connections; the bus and the other end's stay (FR-018a)", () => {
  const d = createDesign("t");
  addInstance(d, tyG(), 10, 20, 0); // U1
  addInstance(d, tyG(), 40, 20, 0); // U2
  const bus = addBus(d, { kind: "free", x: 0, y: 22 }, { kind: "free", x: 34, y: 22 }, 3);
  snapBusGroup(d, bus.id, bus.path[0].v, "U1", "A");
  snapBusGroup(d, bus.id, bus.path[1].v, "U2", "A");

  deleteInstance(d, "U1");

  assert.equal(d.buses.length, 1); // still snapped to U2 (FR-041a)
  assert.deepEqual(
    d.buses[0].groupConnections.map((gc) => gc.instance),
    ["U2"],
  );
});

test("deleteInstance prunes a bus snapped only to it, like a wire (FR-018a/FR-030)", () => {
  const d = createDesign("t");
  addInstance(d, tyG(), 10, 20, 0); // U1
  const bus = addBus(d, { kind: "free", x: 0, y: 22 }, { kind: "free", x: 10, y: 22 }, 3);
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A");

  deleteInstance(d, "U1");

  assert.equal(d.buses.length, 0); // fully disconnected after the gc drop
});

// --- FR-011c: a deleted designator is never reused, even when it was the
// highest number in its series. ---

test("placing after deleting the highest-numbered component skips its number (FR-011c)", () => {
  const d = setup(); // U1..U3, counter U:4
  deleteInstance(d, "U3");
  const inst = addInstance(d, ty(), 100, 20, 0);
  assert.equal(inst.refdes, "U4"); // not U3
  assert.equal(d.refCounters.U, 5);
});
