import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign } from "./model/design.js";
import { createStore } from "./store.js";
import { addBusCmd, setBusWidthCmd, deleteBusCmd } from "./commands.js";

function newStore() {
  return createStore({ design: createDesign("t") });
}

const free = (x, y) => ({ kind: "free", x, y });

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
