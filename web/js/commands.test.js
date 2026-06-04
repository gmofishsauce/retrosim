import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign } from "./model/design.js";
import { createStore } from "./store.js";
import {
  placeComponent,
  moveComponent,
  rotateComponent,
  deleteComponent,
  setOverrideCmd,
} from "./commands.js";

function ty(name = "74138") {
  return { name, width: 6, height: 12, pins: [] };
}

function newStore() {
  return createStore({ design: createDesign("t") });
}

function find(design, refdes) {
  return design.components.find((c) => c.refdes === refdes);
}

test("placeComponent adds an instance; undo removes; redo restores same refdes", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty(), 4, 5, 0));
  assert.equal(store.design.components.length, 1);
  assert.equal(store.design.components[0].refdes, "U1");

  store.undo();
  assert.equal(store.design.components.length, 0);

  store.redo();
  assert.equal(store.design.components.length, 1);
  assert.equal(store.design.components[0].refdes, "U1");
});

test("moveComponent updates position and undo restores it", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty(), 4, 5, 0));
  store.dispatch(moveComponent("U1", 20, 30));
  assert.deepEqual(
    { x: find(store.design, "U1").x, y: find(store.design, "U1").y },
    { x: 20, y: 30 },
  );

  store.undo();
  assert.deepEqual(
    { x: find(store.design, "U1").x, y: find(store.design, "U1").y },
    { x: 4, y: 5 },
  );
});

test("rotateComponent applies a delta modulo 360 and undo restores", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty(), 0, 0, 0));
  store.dispatch(rotateComponent("U1", 90));
  assert.equal(find(store.design, "U1").rotation, 90);

  store.dispatch(rotateComponent("U1", 90));
  assert.equal(find(store.design, "U1").rotation, 180);

  store.dispatch(rotateComponent("U1", -90));
  assert.equal(find(store.design, "U1").rotation, 90);

  store.undo();
  assert.equal(find(store.design, "U1").rotation, 180);
});

test("rotateComponent wraps below zero (0 - 90 -> 270)", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty(), 0, 0, 0));
  store.dispatch(rotateComponent("U1", -90));
  assert.equal(find(store.design, "U1").rotation, 270);
});

test("deleteComponent removes an instance; undo restores it at its index", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty("A"), 0, 0, 0)); // U1
  store.dispatch(placeComponent(ty("B"), 1, 1, 0)); // U2

  store.dispatch(deleteComponent("U1"));
  assert.equal(store.design.components.length, 1);
  assert.equal(store.design.components[0].refdes, "U2");

  store.undo();
  assert.equal(store.design.components.length, 2);
  assert.equal(store.design.components[0].refdes, "U1");
  assert.equal(store.design.components[1].refdes, "U2");
});

test("setOverrideCmd sets and clears a per-instance delay override; undo restores", () => {
  const store = newStore();
  const t = ty();
  t.delays = { tpd: 7 };
  store.dispatch(placeComponent(t, 0, 0, 0)); // U1

  store.dispatch(setOverrideCmd("U1", "tpd", 12));
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);

  store.undo(); // back to no override
  assert.equal(find(store.design, "U1").overrides.delays, undefined);

  store.redo();
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);

  // Clearing the override removes the delays map again.
  store.dispatch(setOverrideCmd("U1", "tpd", null));
  assert.equal(find(store.design, "U1").overrides.delays, undefined);
  store.undo(); // undo clear -> override back
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);
});
