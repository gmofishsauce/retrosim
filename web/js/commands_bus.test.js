import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign } from "./model/design.js";
import { buildNets } from "./model/netlist.js";
import { createStore } from "./store.js";
import { describeEndpoint } from "./chrome/properties.js";
import {
  addBusCmd,
  setBusWidthCmd,
  deleteBusCmd,
  snapBusGroupCmd,
  breakoutBitCmd,
  setBusBitNamesCmd,
  setBusNameCmd,
  placeComponent,
  addWireCmd,
} from "./commands.js";

function newStore() {
  return createStore({ design: createDesign("t"), project: { dir: "/proj", name: "proj" } });
}

const free = (x, y) => ({ kind: "free", x, y });

// A 74138-shaped type with a 3-bit pin group "A".
function type74138Grp() {
  return {
    name: "74138",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "A1", side: "left", position: 3, direction: "in" },
      { name: "A2", side: "left", position: 4, direction: "in" },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
  };
}

test("addBusCmd creates a bus with width and empty connection metadata", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 8));
  assert.equal(store.design.buses.length, 1);
  const b = store.design.buses[0];
  assert.equal(b.width, 8);
  assert.equal(b.path.length, 2);
  assert.deepEqual(b.groupConnections, []);
  assert.equal(b.bitNames, null);

  store.undo();
  assert.equal(store.design.buses.length, 0);
  store.redo();
  assert.equal(store.design.buses.length, 1);
});

test("setBusWidthCmd changes width and undo restores it", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 8));
  const id = store.design.buses[0].id;

  store.dispatch(setBusWidthCmd(id, 4));
  assert.equal(store.design.buses[0].width, 4);

  store.undo();
  assert.equal(store.design.buses[0].width, 8);
});

test("setBusWidthCmd drops bit names that no longer match the width", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 4));
  const id = store.design.buses[0].id;
  store.design.buses[0].bitNames = ["C", "V", "N", "Z"];

  store.dispatch(setBusWidthCmd(id, 8));
  assert.equal(store.design.buses[0].bitNames, null);

  store.undo();
  assert.deepEqual(store.design.buses[0].bitNames, ["C", "V", "N", "Z"]);
});

test("deleteBusCmd removes the bus and undo restores it", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 8));
  const id = store.design.buses[0].id;

  store.dispatch(deleteBusCmd(id));
  assert.equal(store.design.buses.length, 0);

  store.undo();
  assert.equal(store.design.buses.length, 1);
  assert.equal(store.design.buses[0].id, id);
});

test("snapBusGroupCmd adds a group connection (+bit names); undo/redo restore", () => {
  const store = newStore();
  store.dispatch(placeComponent(type74138Grp(), 10, 20, 0)); // U1
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 3));
  const bus = store.design.buses[0];

  store.dispatch(snapBusGroupCmd(bus.id, bus.path[1].v, "U1", "A"));
  assert.equal(bus.groupConnections.length, 1);
  assert.deepEqual(bus.bitNames, ["A0", "A1", "A2"]);

  store.undo();
  assert.equal(bus.groupConnections.length, 0);
  assert.equal(bus.bitNames, null);

  store.redo();
  assert.equal(store.design.buses[0].groupConnections.length, 1);
});

test("addBusCmd T-joins an unequal-width bus with an alignment offset (FR-039b)", () => {
  const store = newStore();
  store.dispatch(placeComponent(type74138Grp(), 40, 20, 0)); // U1 (3-bit group A)
  store.dispatch(addBusCmd(free(0, 0), free(20, 0), 4)); // wide bus, width 4
  const wideId = store.design.buses[0].id;

  // Branch a width-3 bus onto the wide bus (segment 0), its far end snapped to
  // U1.A, aligned so narrow bit 0 ↦ wide bit 1 (offset 1).
  store.dispatch(
    addBusCmd(
      { kind: "branch", wireId: wideId, segIndex: 0, x: 8, y: 0 },
      free(8, 10),
      3,
      [{ end: "b", refdes: "U1", group: "A" }],
      [],
      1,
    ),
  );
  const narrow = store.design.buses[1];
  assert.equal(narrow.width, 3);
  const j = store.design.vertices.find((v) => v.kind === "junction");
  assert.equal(j.offset, 1); // recorded on the junction

  const nets = buildNets(store.design);
  const byPin = Object.fromEntries(
    nets.filter((n) => n.pins.length).map((n) => [n.pins[0], n]),
  );
  const prov = (pin) =>
    byPin[pin].provenance.map((p) => `${p.bus}:${p.bit}`).sort();
  assert.deepEqual(prov("U1.A0"), [`${narrow.id}:0`, `${wideId}:1`].sort());
  assert.deepEqual(prov("U1.A2"), [`${narrow.id}:2`, `${wideId}:3`].sort());

  store.undo(); // snapshot restore removes the narrow bus and its junction
  assert.equal(store.design.buses.length, 1);
  assert.equal(store.design.vertices.some((v) => v.kind === "junction"), false);
});

test("addBusCmd end-joins unequal-width buses as an offset junction, not a merge (FR-039b)", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 4)); // wide, width 4
  const wide = store.design.buses[0];
  const endV = wide.path[wide.path.length - 1].v; // dangling free end

  // A width-2 bus completed on the wide bus's dangling end, offset 2.
  store.dispatch(addBusCmd(free(10, 8), { kind: "vertex", id: endV }, 2, [], [], 2));
  assert.equal(store.design.buses.length, 2); // distinct conductors, not merged
  const j = store.design.vertices.find((v) => v.id === endV);
  assert.equal(j.kind, "junction"); // the free end was promoted
  assert.equal(j.offset, 2);

  // FR-020d: the join junction describes the *other* bus and its joined bit
  // range, not raw coordinates. Selecting the narrow (width-2) bus, its endpoint
  // reads the wide bus's aligned bits 2..3 (offset 2); selecting the wide bus, it
  // reads the whole narrow bus, bits 0..1.
  const narrow = store.design.buses[1];
  assert.equal(describeEndpoint(store.design, endV, narrow), `${wide.id}[2:3]`);
  assert.equal(describeEndpoint(store.design, endV, wide), `${narrow.id}[0:1]`);

  // FR-040a: an explicit bus name overrides the id fallback in the endpoint
  // description, for both directions of the join.
  store.dispatch(setBusNameCmd(wide.id, "data"));
  store.dispatch(setBusNameCmd(narrow.id, "input"));
  assert.equal(describeEndpoint(store.design, endV, narrow), "data[2:3]");
  assert.equal(describeEndpoint(store.design, endV, wide), "input[0:1]");
});

test("setBusNameCmd sets, clears, and undoes a bus name (FR-040a)", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 4));
  const bus = store.design.buses[0];
  assert.equal(bus.name, null); // unnamed by default

  store.dispatch(setBusNameCmd(bus.id, "  addr  ")); // trimmed on commit
  assert.equal(bus.name, "addr");

  store.dispatch(setBusNameCmd(bus.id, "")); // blank clears back to default
  assert.equal(bus.name, null);

  store.undo(); // restores "addr"
  assert.equal(store.design.buses[0].name, "addr");
  store.undo(); // restores unnamed
  assert.equal(store.design.buses[0].name, null);
  store.redo();
  assert.equal(store.design.buses[0].name, "addr");
});

test("breakoutBitCmd taps a bus bit onto a wire; undo restores connectivity", () => {
  const store = newStore();
  store.dispatch(placeComponent(type74138Grp(), 40, 20, 0)); // U1
  store.dispatch(addBusCmd(free(0, 0), free(20, 0), 4));
  const busId = store.design.buses[0].id;

  store.dispatch(
    breakoutBitCmd(busId, 0, 8, 0, 2, { kind: "pin", refdes: "U1", pin: "A0" }),
  );
  assert.equal(store.design.wires.length, 1);
  const nets = buildNets(store.design);
  assert.equal(nets.length, 1);
  assert.deepEqual(nets[0].provenance, [{ bus: busId, bit: 2 }]);

  store.undo();
  assert.equal(store.design.wires.length, 0);
  assert.equal(store.design.buses[0].path.length, 2); // junction removed
});

test("breakoutBitCmd resolves a branch far-endpoint and threads bends (FR-043b)", () => {
  const store = newStore();
  store.dispatch(placeComponent(type74138Grp(), 40, 20, 0)); // U1
  store.dispatch(addWireCmd({ kind: "pin", refdes: "U1", pin: "A0" }, free(30, 0))); // a host wire
  const hostId = store.design.wires[0].id;
  store.dispatch(addBusCmd(free(0, 0), free(20, 0), 4));
  const busId = store.design.buses[0].id;

  // Terminate a wire that started on the host wire onto the bus: the far endpoint
  // is a branch spec, resolved to a junction; the drawn route's bend is carried.
  store.dispatch(
    breakoutBitCmd(busId, 0, 8, 0, 1, { kind: "branch", wireId: hostId, segIndex: 0, x: 8, y: 0 }, [
      { x: 8, y: 4 },
    ]),
  );

  // a new breakout wire exists with the bend in its path, tied into bit 1's net
  const breakout = store.design.wires[store.design.wires.length - 1];
  assert.ok(breakout.path.some((p) => p.t === "bend" && p.x === 8 && p.y === 4));
  const nets = buildNets(store.design);
  const bitNet = nets.find((n) =>
    (n.provenance ?? []).some((pr) => pr.bus === busId && pr.bit === 1),
  );
  assert.ok(bitNet, "breakout joins bit 1's net");

  store.undo();
  assert.ok(!store.design.wires.some((w) => w.id === breakout.id));
});

test("addBusCmd snaps a component endpoint at creation; undo removes bus+snap", () => {
  const store = newStore();
  store.dispatch(placeComponent(type74138Grp(), 10, 20, 0)); // U1
  store.dispatch(
    addBusCmd(free(20, 0), free(10, 0), 3, [{ end: "b", refdes: "U1", group: "A" }]),
  );

  const bus = store.design.buses[0];
  assert.equal(bus.groupConnections.length, 1);
  assert.equal(bus.groupConnections[0].group, "A");
  assert.deepEqual(bus.bitNames, ["A0", "A1", "A2"]);
  // the group connection anchors to the bus's "b" endpoint vertex
  assert.equal(bus.groupConnections[0].vertex, bus.path[bus.path.length - 1].v);

  store.undo();
  assert.equal(store.design.buses.length, 0);
});

test("setBusBitNamesCmd sets names; undo/redo restore", () => {
  const store = newStore();
  store.dispatch(addBusCmd(free(0, 0), free(10, 0), 2));
  const id = store.design.buses[0].id;

  store.dispatch(setBusBitNamesCmd(id, ["C", "V"]));
  assert.deepEqual(store.design.buses[0].bitNames, ["C", "V"]);

  store.undo();
  assert.equal(store.design.buses[0].bitNames, null);
  store.redo();
  assert.deepEqual(store.design.buses[0].bitNames, ["C", "V"]);
});
