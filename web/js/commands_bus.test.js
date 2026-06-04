import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign } from "./model/design.js";
import { buildNets } from "./model/netlist.js";
import { createStore } from "./store.js";
import {
  addBusCmd,
  setBusWidthCmd,
  deleteBusCmd,
  snapBusGroupCmd,
  breakoutBitCmd,
  setBusBitNamesCmd,
  placeComponent,
} from "./commands.js";

function newStore() {
  return createStore({ design: createDesign("t") });
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
