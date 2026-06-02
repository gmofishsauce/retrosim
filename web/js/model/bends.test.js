import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  insertBend,
  moveBend,
  deleteBend,
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

function wireSetup() {
  const d = createDesign("t");
  addInstance(d, ty(), 10, 20, 0);
  addInstance(d, ty(), 40, 20, 0);
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  return { d, w };
}

test("insertBend splits a segment, adding an interior bend", () => {
  const { w } = wireSetup();
  const idx = insertBend(w, 0, 25, 26); // split the only segment
  assert.equal(idx, 1);
  assert.equal(w.path.length, 3);
  assert.deepEqual(w.path[1], { t: "bend", x: 25, y: 26 });
  // Endpoints remain nodes.
  assert.equal(w.path[0].t, "node");
  assert.equal(w.path[2].t, "node");
});

test("insertBend into the second segment keeps order", () => {
  const { w } = wireSetup();
  insertBend(w, 0, 25, 26); // path: node, bend(25,26), node
  insertBend(w, 1, 30, 28); // split segment between bend and end
  assert.equal(w.path.length, 4);
  assert.deepEqual(w.path[1], { t: "bend", x: 25, y: 26 });
  assert.deepEqual(w.path[2], { t: "bend", x: 30, y: 28 });
});

test("insertBend rejects an out-of-range segment", () => {
  const { w } = wireSetup();
  assert.throws(() => insertBend(w, 5, 0, 0));
});

test("moveBend updates a bend coordinate", () => {
  const { w } = wireSetup();
  insertBend(w, 0, 25, 26);
  moveBend(w, 1, 27, 30);
  assert.deepEqual(w.path[1], { t: "bend", x: 27, y: 30 });
});

test("moveBend rejects a node (endpoint) index", () => {
  const { w } = wireSetup();
  assert.throws(() => moveBend(w, 0, 1, 1));
});

test("deleteBend removes a bend and merges the segments", () => {
  const { w } = wireSetup();
  insertBend(w, 0, 25, 26);
  assert.equal(w.path.length, 3);
  deleteBend(w, 1);
  assert.equal(w.path.length, 2);
  assert.equal(w.path[0].t, "node");
  assert.equal(w.path[1].t, "node");
});

test("deleteBend rejects a node (endpoint) index", () => {
  const { w } = wireSetup();
  assert.throws(() => deleteBend(w, 0));
});
