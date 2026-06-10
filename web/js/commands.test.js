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

function ty7400() {
  return {
    name: "7400",
    renderType: "subunit",
    numUnits: 2,
    renderAs: "nand",
    pins: [
      { name: "1A", side: "left", unit: "A", direction: "in" },
      { name: "1B", side: "left", unit: "A", direction: "in" },
      { name: "1Y", side: "right", unit: "A", direction: "out" },
      { name: "2A", side: "left", unit: "B", direction: "in" },
      { name: "2B", side: "left", unit: "B", direction: "in" },
      { name: "2Y", side: "right", unit: "B", direction: "out" },
    ],
  };
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

test("placeComponent drops a whole subunit package as one undo step (FR-013a)", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty7400(), 4, 5, 0));
  assert.deepEqual(
    store.design.components.map((c) => c.refdes),
    ["U1A", "U1B"],
  );

  store.undo();
  assert.equal(store.design.components.length, 0);

  store.redo();
  assert.deepEqual(
    store.design.components.map((c) => c.refdes),
    ["U1A", "U1B"],
  );
});

test("deleteComponent on a subunit removes the whole package; undo restores it (FR-018b)", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty7400(), 4, 5, 0));
  store.dispatch(deleteComponent("U1A"));
  assert.equal(store.design.components.length, 0);

  store.undo();
  assert.deepEqual(
    store.design.components.map((c) => c.refdes),
    ["U1A", "U1B"],
  );
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

// Regression for fable-review.md C3: snapshot-based commands (e.g.
// deleteComponent) restore design.components via structuredClone, replacing
// every object with a clone, so placeComponent.revert must remove by refdes,
// never by captured object reference.
test(
  "undo place after undoing a snapshot delete leaves an empty design (FR-024)",
  () => {
    const store = newStore();
    store.dispatch(placeComponent(ty(), 4, 5, 0)); // U1
    store.dispatch(deleteComponent("U1")); // snapshot-based command
    assert.equal(store.design.components.length, 0);

    store.undo(); // undo delete → U1 restored (as a clone)
    assert.equal(store.design.components.length, 1);

    store.undo(); // undo place → design must be empty again
    assert.equal(store.design.components.length, 0);
    assert.equal(store.canUndo(), false);
  },
);

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
