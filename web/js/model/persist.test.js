import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  addBus,
} from "./design.js";
import { serializeDesign, deserializeDesign } from "./persist.js";

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

function sampleDesign() {
  const d = createDesign("my schematic");
  addInstance(d, ty(), 10, 20, 0);
  addInstance(d, ty(), 40, 20, 0);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 10, y: 0 }, 8);
  return d;
}

test("serializeDesign emits the documented shape with derived nets", () => {
  const out = serializeDesign(sampleDesign());
  assert.equal(out.formatVersion, 1);
  assert.equal(out.name, "my schematic");
  assert.ok(Array.isArray(out.components));
  assert.ok(Array.isArray(out.wires));
  assert.ok(Array.isArray(out.buses));
  assert.ok(Array.isArray(out.vertices));
  assert.ok(Array.isArray(out.nets)); // derived (FR-059a)
  assert.equal(out.nets.length, 1); // the U1./Y0 - U2.A0 net
});

test("serialize -> JSON -> deserialize round-trips the collections", () => {
  const d = sampleDesign();
  const json = JSON.parse(JSON.stringify(serializeDesign(d)));
  const d2 = deserializeDesign(json);

  assert.equal(d2.name, d.name);
  assert.deepEqual(d2.components, d.components);
  assert.deepEqual(d2.wires, d.wires);
  assert.deepEqual(d2.buses, d.buses);
  assert.deepEqual(d2.vertices, d.vertices);
});

test("deserializeDesign rebuilds id counters past the loaded ids", () => {
  const d = sampleDesign();
  const json = JSON.parse(JSON.stringify(serializeDesign(d)));
  const d2 = deserializeDesign(json);

  assert.equal(d2.nextWireId, d.nextWireId);
  assert.equal(d2.nextBusId, d.nextBusId);
  assert.equal(d2.nextVertexId, d.nextVertexId);

  // A new wire gets a fresh, non-colliding id.
  const w = addWire(
    d2,
    { kind: "free", x: 1, y: 1 },
    { kind: "free", x: 2, y: 2 },
  );
  assert.equal(
    d2.wires.filter((x) => x.id === w.id).length,
    1,
  );
});

test("deserializeDesign tolerates a minimal/empty document", () => {
  const d = deserializeDesign({ formatVersion: 1, name: "empty" });
  assert.equal(d.name, "empty");
  assert.deepEqual(d.components, []);
  assert.equal(d.nextVertexId, 1);
});
