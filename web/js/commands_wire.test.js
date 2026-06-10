import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, getVertex, moveBend } from "./model/design.js";
import { createStore } from "./store.js";
import {
  placeComponent,
  deleteComponent,
  addWireCmd,
  deleteWireCmd,
  insertBendCmd,
  moveBendCmd,
  deleteBendCmd,
} from "./commands.js";

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "/Y0", side: "right", position: 2, direction: "out" },
    ],
  };
}

// Build a store with three placed components U1..U3.
function newStore() {
  const store = createStore({ design: createDesign("t") });
  store.dispatch(placeComponent(ty(), 10, 20, 0));
  store.dispatch(placeComponent(ty(), 40, 20, 0));
  store.dispatch(placeComponent(ty(), 70, 20, 0));
  return store;
}

const pin = (refdes, p) => ({ kind: "pin", refdes, pin: p });

test("addWireCmd adds a wire; undo removes; redo restores", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
  assert.equal(store.design.wires.length, 1);

  store.undo();
  assert.equal(store.design.wires.length, 0);
  assert.equal(store.design.vertices.length, 0);

  store.redo();
  assert.equal(store.design.wires.length, 1);
});

test("addWireCmd with a branch endpoint creates a junction; undo reverts it", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
  const w1 = store.design.wires[0];

  store.dispatch(
    addWireCmd(
      { kind: "branch", wireId: w1.id, segIndex: 0, x: 25, y: 26 },
      pin("U3", "A0"),
    ),
  );
  assert.equal(store.design.wires.length, 2);
  assert.equal(w1.path.length, 3); // junction inserted into host
  assert.equal(store.design.vertices.some((v) => v.kind === "junction"), true);

  store.undo();
  assert.equal(store.design.wires.length, 1);
  assert.equal(store.design.wires[0].path.length, 2);
  assert.equal(store.design.vertices.some((v) => v.kind === "junction"), false);
});

test("deleteWireCmd removes a wire and undo restores it with vertices", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
  const wid = store.design.wires[0].id;

  store.dispatch(deleteWireCmd(wid));
  assert.equal(store.design.wires.length, 0);
  assert.equal(store.design.vertices.length, 0);

  store.undo();
  assert.equal(store.design.wires.length, 1);
  assert.equal(store.design.vertices.length, 2);
});

test("deleteComponent frees pins, keeps a dangling wire, and undo restores", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));

  store.dispatch(deleteComponent("U2"));
  assert.equal(store.design.components.length, 2);
  assert.equal(store.design.wires.length, 1); // dangling, not pruned
  assert.equal(store.design.vertices.some((v) => v.kind === "free"), true);

  store.undo();
  assert.equal(store.design.components.length, 3);
  assert.equal(store.design.vertices.some((v) => v.kind === "free"), false);
  assert.equal(store.design.vertices.filter((v) => v.kind === "pin").length, 2);
});

test("insertBendCmd / moveBendCmd are reversible", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
  const wid = store.design.wires[0].id;

  store.dispatch(insertBendCmd(wid, 0, 25, 26));
  assert.equal(store.design.wires[0].path.length, 3);
  assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 25, y: 26 });

  store.dispatch(moveBendCmd(wid, 1, 28, 30));
  assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 28, y: 30 });

  store.undo(); // undo move
  assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 25, y: 26 });
  store.undo(); // undo insert
  assert.equal(store.design.wires[0].path.length, 2);
});

// KNOWN BUG (fable-review.md C2): during a bend drag, interaction.js moves the
// bend live for preview, then dispatches moveBendCmd with the FINAL coordinates.
// moveBendCmd captures "old" on first apply — by then the bend is already at the
// final position, so undo restores the final position (a no-op). This test
// simulates the gesture exactly as interaction.js performs it (no rewind).
// Fix either by capturing/passing the pre-drag position into moveBendCmd, or by
// rewinding the live preview in interaction.js before dispatch (the component
// drag branch already does this — if you choose that fix, add the rewind to the
// simulated gesture below). Remove the `todo` option once fixed.
test(
  "undo of a live-previewed bend drag restores the pre-drag position (FR-024/FR-032)",
  { todo: "known bug — see fable-review.md C2" },
  () => {
    const store = newStore();
    store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
    const wid = store.design.wires[0].id;
    store.dispatch(insertBendCmd(wid, 0, 25, 26)); // bend at (25,26)

    // The drag gesture: live preview mutates the path directly...
    const w = store.design.wires[0];
    moveBend(w, 1, 28, 30);
    // ...then mouseup dispatches the command with the final coordinates.
    store.dispatch(moveBendCmd(wid, 1, 28, 30));
    assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 28, y: 30 });

    store.undo(); // must restore the pre-drag position, not the final one
    assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 25, y: 26 });
  },
);

test("deleteBendCmd removes a bend and undo restores it (FR-033)", () => {
  const store = newStore();
  store.dispatch(addWireCmd(pin("U1", "/Y0"), pin("U2", "A0")));
  const wid = store.design.wires[0].id;
  store.dispatch(insertBendCmd(wid, 0, 25, 26));
  assert.equal(store.design.wires[0].path.length, 3);

  store.dispatch(deleteBendCmd(wid, 1));
  assert.equal(store.design.wires[0].path.length, 2);

  store.undo(); // undo delete -> bend back at index 1
  assert.equal(store.design.wires[0].path.length, 3);
  assert.deepEqual(store.design.wires[0].path[1], { t: "bend", x: 25, y: 26 });
});
