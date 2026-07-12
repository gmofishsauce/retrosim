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

// Test stores carry a current project so the no-project lock (FR-121c) does
// not refuse dispatches; the lock itself is tested explicitly below.
const TEST_PROJECT = { dir: "/proj", name: "proj", manifestFile: "", mainDesign: "" };

function newStore() {
  return createStore({ design: { v: 0 }, project: TEST_PROJECT });
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

test("replaceDesign swaps the design and resets history/selection/dirty", () => {
  const store = newStore();
  store.dispatch(addCmd(1));
  store.setSelection([{ kind: "component", refdes: "U1" }]);
  assert.equal(store.state.dirty, true);
  assert.equal(store.canUndo(), true);

  const fresh = { v: 0, name: "loaded" };
  store.replaceDesign(fresh, { savePath: "/tmp/x.json" });

  assert.equal(store.design, fresh);
  assert.equal(store.state.designName, "loaded");
  assert.equal(store.state.savePath, "/tmp/x.json");
  assert.deepEqual(store.state.selection, []);
  assert.equal(store.state.dirty, false);
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
});

test("toggleSelection adds, removes, and mixes kinds (FR-016a)", () => {
  const store = newStore();
  const u1 = { kind: "component", refdes: "U1" };
  const w7 = { kind: "wire", id: 7 };

  store.toggleSelection(u1);
  assert.equal(store.isSelected(u1), true);

  store.toggleSelection(w7);
  assert.deepEqual(store.state.selection, [u1, w7]);

  store.toggleSelection(u1);
  assert.equal(store.isSelected(u1), false);
  assert.deepEqual(store.state.selection, [w7]);
});

test("markSaved records the path and clears dirty", () => {
  const store = newStore();
  store.dispatch(addCmd(1));
  store.markSaved("/tmp/y.json");
  assert.equal(store.state.savePath, "/tmp/y.json");
  assert.equal(store.state.dirty, false);
});

test("markSaved adopts the saved file's base name (FR-047a)", () => {
  const store = createStore({
    design: { v: 0, name: "old" },
    designName: "old",
    project: TEST_PROJECT,
  });
  store.dispatch(addCmd(1));
  store.markSaved("/designs/alu.json", "alu");
  assert.equal(store.state.savePath, "/designs/alu.json");
  assert.equal(store.state.designName, "alu");
  assert.equal(store.design.name, "alu");
  assert.equal(store.state.dirty, false);
  // Without a name, the existing name is untouched.
  store.dispatch(addCmd(1));
  store.markSaved("/designs/alu.json");
  assert.equal(store.state.designName, "alu");
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

test("dispatch/undo/redo are refused while simulating (FR-087)", () => {
  const blocked = [];
  const store = createStore({
    design: { v: 0 },
    project: TEST_PROJECT,
    onBlocked: (m) => blocked.push(m),
  });
  store.dispatch(addCmd(5));

  store.setSimulating(true);
  store.dispatch(addCmd(1));
  store.undo();
  store.redo();
  assert.equal(store.design.v, 5); // nothing mutated
  assert.equal(blocked.length, 3); // each refusal reported

  store.setSimulating(false);
  store.undo();
  assert.equal(store.design.v, 0); // editable again
});

test("dispatch/undo/redo are refused while no project is current (FR-121c)", () => {
  const blocked = [];
  const store = createStore({ design: { v: 0 }, onBlocked: (m) => blocked.push(m) });
  assert.equal(store.state.project, null);

  store.dispatch(addCmd(1));
  store.undo();
  store.redo();
  assert.equal(store.design.v, 0); // nothing mutated
  assert.equal(blocked.length, 3); // each refusal reported
  assert.match(blocked[0], /no project/);
  assert.equal(store.isReadonly(), false); // the sim/vector locks are separate

  store.setProject(TEST_PROJECT);
  store.dispatch(addCmd(2));
  assert.equal(store.design.v, 2); // editable once a project is current
});

test("setProject records the project and notifies", () => {
  const store = createStore({ design: { v: 0 } });
  let calls = 0;
  store.subscribe(() => calls++);
  store.setProject(TEST_PROJECT);
  assert.equal(store.state.project, TEST_PROJECT);
  assert.equal(calls, 1);
});

test("sim view is retained at stop and cleared on the next modification (FR-085)", () => {
  const store = newStore();
  const view = { valueOfPin: () => 0 };

  store.setSimulating(true);
  store.setSim(view);
  store.setSimulating(false); // stop: view deliberately retained
  assert.equal(store.state.sim, view);

  store.dispatch(addCmd(1)); // first design modification clears it
  assert.equal(store.state.sim, null);
});
