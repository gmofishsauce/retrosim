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

test("setProbe records a probe target and notifies (FR-087c)", () => {
  const store = newStore();
  let notes = 0;
  store.subscribe(() => notes++);
  assert.equal(store.state.probe, null);

  store.setProbe({ kind: "wire", id: "w1" });
  assert.deepEqual(store.state.probe, { kind: "wire", id: "w1" });
  assert.equal(notes, 1); // the properties panel repaints off this

  store.setProbe(null); // a click on empty canvas
  assert.equal(store.state.probe, null);
});

test("a selection change clears the probe target (FR-087c)", () => {
  const store = newStore();
  store.setProbe({ kind: "wire", id: "w1" });
  // After a Stop, the first click that selects something must hand the
  // properties panel back from the frozen probe reading to that selection.
  store.setSelection([{ kind: "component", refdes: "U1" }]);
  assert.equal(store.state.probe, null);
});

test("the first design modification clears the probe with the sim view (FR-087c/FR-085)", () => {
  const store = newStore();
  store.setSimulating(true);
  store.setSim({ valueOfPin: () => 0 });
  store.setProbe({ kind: "pin", refdes: "U1", pin: "Y" });
  store.setSimulating(false); // stop: both deliberately retained
  assert.notEqual(store.state.probe, null);
  assert.notEqual(store.state.sim, null);

  store.dispatch(addCmd(1));
  assert.equal(store.state.sim, null);
  assert.equal(store.state.probe, null); // the values it was reading are gone
});

test("vectorHold marks a held vector run and notifies (FR-115l)", () => {
  const store = newStore();
  let notes = 0;
  store.subscribe(() => notes++);
  assert.equal(store.state.vectorHold, false);

  store.setVectorHold(true);
  assert.equal(store.state.vectorHold, true);
  assert.equal(notes, 1); // the toolbar's release-Stop and the tray depend on this

  store.setVectorHold(false);
  assert.equal(store.state.vectorHold, false);
});

test("vectorHold is independent of the panel lock and of simulating (FR-115l)", () => {
  const store = newStore();
  // A hold happens with the panel open and the interactive simulator stopped:
  // the two flags answer different questions, so neither implies the other.
  store.setVectorPanelOpen(true);
  store.setVectorHold(true);
  assert.equal(store.state.simulating, false);
  assert.equal(store.isReadonly(), true); // the FR-115h lock still applies
  store.setVectorHold(false);
  assert.equal(store.isReadonly(), true); // releasing the hold does not unlock
});

// --- atomic command failure (FR-024a): a throwing apply/revert restores the
// design's connectivity state; nothing moves on the undo/redo stacks. ---

function wiredStore(onError) {
  const design = {
    components: [],
    wires: [{ id: "w1" }],
    buses: [],
    vertices: [{ id: "v1" }],
    nextWireId: 2,
    nextBusId: 1,
    nextVertexId: 2,
  };
  return createStore({ design, project: TEST_PROJECT, onError });
}

test("a failing dispatch restores the design and records nothing (FR-024a)", () => {
  const errs = [];
  const store = wiredStore((e) => errs.push(e.message));
  store.dispatch({
    label: "boom",
    apply(d) {
      d.wires.length = 0; // partial mutation...
      d.vertices.push({ id: "v2" });
      d.nextVertexId = 3;
      throw new Error("boom"); // ...then failure
    },
    revert() {},
  });
  assert.deepEqual(errs, ["boom"]);
  assert.deepEqual(store.design.wires, [{ id: "w1" }]); // restored
  assert.deepEqual(store.design.vertices, [{ id: "v1" }]);
  assert.equal(store.design.nextVertexId, 2);
  assert.equal(store.canUndo(), false);
  assert.equal(store.state.dirty, false);
});

test("a throwing undo restores the design and leaves the stacks unmoved (FR-024a)", () => {
  const errs = [];
  const store = wiredStore((e) => errs.push(e.message));
  store.dispatch({
    label: "ok then bad revert",
    apply(d) {
      d.wires.push({ id: "w2" });
    },
    revert(d) {
      d.wires.length = 0; // partial mutation...
      throw new Error("bad revert"); // ...then failure
    },
  });
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.deepEqual(errs, ["bad revert"]);
  assert.deepEqual(store.design.wires, [{ id: "w1" }, { id: "w2" }]); // restored
  assert.equal(store.canUndo(), true); // still undoable (stack unmoved)
  assert.equal(store.canRedo(), false);
});

// --- Docked panel area: tab bookkeeping (§6.16a, FR-123) ---------------------
//
// The store owns which tabs are open, which is frontmost, where each sits in the
// strip, and which carries an unseen-content dot, so that "opening makes a tab
// frontmost" and "closing the frontmost tab selects the most recently used
// remaining one" are single rules in a single place rather than a handshake
// between the dock and two panel modules. These are pure state transitions —
// no DOM, no dock.

test("opening a tab appends it to the strip and makes it frontmost (FR-123)", () => {
  const store = newStore();
  assert.equal(store.state.dockActive, null); // a reload starts with no tab open
  assert.deepEqual(store.state.dockOrder, []);

  store.setVectorPanelOpen(true);
  assert.equal(store.state.vectorPanelOpen, true);
  assert.deepEqual(store.state.dockOrder, ["vec"]);
  assert.equal(store.state.dockActive, "vec");

  // Opening a second tab leaves the first in the strip and takes the front;
  // tabs appear in the order opened, newest at the right end.
  store.setConsolePanelOpen(true);
  assert.deepEqual(store.state.dockOrder, ["vec", "console"]);
  assert.equal(store.state.dockActive, "console");
  assert.equal(store.state.vectorPanelOpen, true); // still open, just hidden
});

test("closing the frontmost tab selects the most recently used remaining one (FR-123)", () => {
  const store = newStore();
  store.setVectorPanelOpen(true); // vec front
  store.setConsolePanelOpen(true); // console front
  store.setDockActive("vec"); // used: vec, then console
  store.setVectorPanelOpen(false);
  assert.equal(store.state.dockActive, "console");
  assert.deepEqual(store.state.dockOrder, ["console"]);
});

test("closing a background tab does not change the selection (FR-123)", () => {
  const store = newStore();
  store.setVectorPanelOpen(true);
  store.setConsolePanelOpen(true); // console is frontmost, vec is behind
  store.setVectorPanelOpen(false);
  assert.equal(store.state.dockActive, "console");
  assert.deepEqual(store.state.dockOrder, ["console"]);
});

test("closing the last tab leaves no selection and an empty strip (FR-123)", () => {
  const store = newStore();
  store.setConsolePanelOpen(true);
  store.setConsolePanelOpen(false);
  assert.equal(store.state.dockActive, null); // the area disappears entirely
  assert.deepEqual(store.state.dockOrder, []);
  assert.deepEqual(store.state.dockMru, []);
});

test("reopening a closed tab puts it at the right end of the strip (FR-123)", () => {
  const store = newStore();
  store.setVectorPanelOpen(true);
  store.setConsolePanelOpen(true);
  assert.deepEqual(store.state.dockOrder, ["vec", "console"]);
  store.setVectorPanelOpen(false);
  store.setVectorPanelOpen(true);
  assert.deepEqual(store.state.dockOrder, ["console", "vec"]);
  assert.equal(store.state.dockActive, "vec");
});

test("setDockActive selects an open tab and ignores a closed or unknown one (FR-123)", () => {
  const store = newStore();
  store.setVectorPanelOpen(true);
  store.setConsolePanelOpen(true);
  store.setDockActive("vec");
  assert.equal(store.state.dockActive, "vec");
  assert.deepEqual(store.state.dockMru, ["vec", "console"]);

  // A stray call cannot desync the strip: neither a closed tab nor a key with no
  // tab kind may take the front.
  store.setConsolePanelOpen(false);
  store.setDockActive("console");
  assert.equal(store.state.dockActive, "vec");
  store.setDockActive("drc");
  assert.equal(store.state.dockActive, "vec");
});

test("markDockUnread marks only an open, non-frontmost tab; selecting clears it (FR-123)", () => {
  const store = newStore();
  // Closed: nothing to mark — there is no tab in the strip to carry a dot.
  store.markDockUnread("console");
  assert.deepEqual(store.state.dockUnread, {});

  store.setConsolePanelOpen(true); // open AND frontmost
  store.markDockUnread("console");
  assert.deepEqual(store.state.dockUnread, {}, "the frontmost tab is never marked");

  store.setVectorPanelOpen(true); // vec takes the front, console goes behind
  store.markDockUnread("console");
  assert.equal(store.state.dockUnread.console, true);

  store.setDockActive("console"); // selecting clears the mark
  assert.deepEqual(store.state.dockUnread, {});
});

test("a tab's unread mark does not survive a close and reopen (FR-123)", () => {
  const store = newStore();
  store.setConsolePanelOpen(true);
  store.setVectorPanelOpen(true);
  store.markDockUnread("console");
  assert.equal(store.state.dockUnread.console, true);
  store.setConsolePanelOpen(false);
  assert.deepEqual(store.state.dockUnread, {});
  store.setConsolePanelOpen(true);
  assert.deepEqual(store.state.dockUnread, {}, "a tab arrives unmarked");
});

test("markDockUnread notifies once per burst, not once per call (FR-122/FR-123)", () => {
  // The Console calls this from every rAF frame that wrote bytes; the setter is
  // idempotent so a long run costs one notification, preserving FR-122's
  // non-blocking buffering.
  const store = newStore();
  store.setConsolePanelOpen(true);
  store.setVectorPanelOpen(true);
  let notes = 0;
  store.subscribe(() => notes++);
  store.markDockUnread("console");
  store.markDockUnread("console");
  store.markDockUnread("console");
  assert.equal(notes, 1);
});

test("the tab flags still drive the read-only lock, frontmost or not (FR-115h)", () => {
  const store = newStore();
  store.setVectorPanelOpen(true);
  store.setConsolePanelOpen(true); // the Console is now frontmost
  assert.equal(store.state.dockActive, "console");
  assert.equal(store.isReadonly(), true, "the vec TAB is open, so the design is locked");
  store.setVectorPanelOpen(false);
  assert.equal(store.isReadonly(), false);
  // The Console is modeless: its tab never locks the design.
  assert.equal(store.state.consolePanelOpen, true);
  assert.equal(store.isReadonly(), false);
});
