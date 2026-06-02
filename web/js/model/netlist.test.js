import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  branchWire,
} from "./design.js";
import { buildNets } from "./netlist.js";

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

function setup(n = 3) {
  const d = createDesign("t");
  for (let i = 0; i < n; i++) addInstance(d, ty(), 10 + 30 * i, 20, 0);
  return d;
}

const sorted = (a) => [...a].sort();

test("two wires joined at a junction form one net with all pins", () => {
  const d = setup(3);
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w1, 0, 25, 26);
  const w2 = addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(sorted(nets[0].pins), ["U1./Y0", "U2.A0", "U3.A0"]);
  assert.deepEqual(sorted(nets[0].members), sorted([w1.id, w2.id]));
});

test("fan-out (one pin, two wires) is one net", () => {
  const d = setup(3);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(sorted(nets[0].pins), ["U1./Y0", "U2.A0", "U3.A0"]);
});

test("unconnected wires form separate nets", () => {
  const d = setup(3);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addWire(
    d,
    { kind: "pin", refdes: "U3", pin: "/Y0" },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );
  assert.equal(buildNets(d).length, 2);
});

test("a half-dangling wire still forms a net for its one pin (FR-029)", () => {
  const d = setup(1);
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 30, y: 30 },
  );
  const nets = buildNets(d);
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].pins, ["U1./Y0"]);
  assert.deepEqual(nets[0].members, [w.id]);
});

test("net membership is id-based and stable under an instance move", () => {
  const d = setup(3);
  const w1 = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(d, w1, 0, 25, 26);
  addWire(
    d,
    { kind: "vertex", id: j.id },
    { kind: "pin", refdes: "U3", pin: "A0" },
  );

  const before = buildNets(d);
  d.components[0].x += 100; // move U1 far away
  const after = buildNets(d);
  assert.deepEqual(
    after.map((n) => sorted(n.pins)),
    before.map((n) => sorted(n.pins)),
  );
});
