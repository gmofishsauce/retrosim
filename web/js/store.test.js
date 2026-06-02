import { test } from "node:test";
import assert from "node:assert/strict";

import { createStore, UNDO_CAP } from "./store.js";

// A trivial reversible command over a design with a numeric field `v`.
function addCmd(delta) {
  return {
    label: "add",
    apply: (d) => {
      d.v += delta;
    },
    revert: (d) => {
      d.v -= delta;
    },
  };
}

function newStore() {
  return createStore({ design: { v: 0 } });
}

test("dispatch applies the command, marks dirty, and notifies", () => {
  const store = newStore();
  let calls = 0;
  store.subscribe(() => calls++);

  store.dispatch(addCmd(5));

  assert.equal(store.design.v, 5);
  assert.equal(store.state.dirty, true);
  assert.equal(calls, 1);
  assert.equal(store.canUndo(), true);
});

test("undo reverts and redo re-applies", () => {
  const store = newStore();
  store.dispatch(addCmd(3));

  store.undo();
  assert.equal(store.design.v, 0);
  assert.equal(store.canRedo(), true);

  store.redo();
  assert.equal(store.design.v, 3);
  assert.equal(store.canRedo(), false);
});

test("a fresh dispatch clears the redo stack", () => {
  const store = newStore();
  store.dispatch(addCmd(1));
  store.undo();
  assert.equal(store.redoDepth(), 1);

  store.dispatch(addCmd(2));
  assert.equal(store.redoDepth(), 0);
  assert.equal(store.design.v, 2);
});

test("undo stack is capped at UNDO_CAP (NFR-006)", () => {
  assert.ok(UNDO_CAP >= 50);
  const store = newStore();
  for (let i = 0; i < UNDO_CAP + 5; i++) store.dispatch(addCmd(1));
  assert.equal(store.undoDepth(), UNDO_CAP);
});

test("undo on an empty stack is a no-op", () => {
  const store = newStore();
  assert.doesNotThrow(() => store.undo());
  assert.equal(store.design.v, 0);
});

test("markSaved clears the dirty flag", () => {
  const store = newStore();
  store.dispatch(addCmd(1));
  assert.equal(store.state.dirty, true);
  store.markSaved();
  assert.equal(store.state.dirty, false);
});

test("subscribe returns an unsubscribe function", () => {
  const store = newStore();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.dispatch(addCmd(1));
  off();
  store.dispatch(addCmd(1));
  assert.equal(calls, 1);
});
