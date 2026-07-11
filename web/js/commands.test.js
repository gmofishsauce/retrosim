import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, addWire, branchWire, getVertex } from "./model/design.js";
import { rotateOffset } from "./geometry.js";
import { createStore } from "./store.js";
import {
  placeComponent,
  moveComponent,
  rotateComponent,
  rotateSelectionCmd,
  deleteComponent,
  setOverrideCmd,
  setPortPropsCmd,
  setNoteTextCmd,
  setLabelCmd,
  refreshTypesCmd,
  composite,
  translateWiring,
  pasteFragmentCmd,
} from "./commands.js";
import { extractFragment } from "./model/clipboard.js";

function ty(name = "74138") {
  return { name, width: 6, height: 12, pins: [] };
}

function tyNote() {
  return { name: "note", builtin: true, renderType: "note", width: 4, height: 2, pins: [] };
}

function ty7400() {
  return {
    id: "type-7400", // distinct from name, as in production YAML (FR-066e)
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

test("composite applies all in order and reverts as one undo step (FR-016a)", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty("A"), 0, 0, 0)); // U1
  store.dispatch(placeComponent(ty("B"), 1, 1, 0)); // U2

  store.dispatch(composite([moveComponent("U1", 10, 10), moveComponent("U2", 20, 20)]));
  assert.deepEqual({ x: find(store.design, "U1").x, y: find(store.design, "U1").y }, { x: 10, y: 10 });
  assert.deepEqual({ x: find(store.design, "U2").x, y: find(store.design, "U2").y }, { x: 20, y: 20 });

  store.undo(); // single step reverts both
  assert.deepEqual({ x: find(store.design, "U1").x, y: find(store.design, "U1").y }, { x: 0, y: 0 });
  assert.deepEqual({ x: find(store.design, "U2").x, y: find(store.design, "U2").y }, { x: 1, y: 1 });
});

test("translateWiring shifts bends/vertices and reverts on undo (FR-018c)", () => {
  const store = createStore({ design: createDesign("t") });
  const tp = {
    name: "x", width: 6, height: 12,
    pins: [{ name: "Y", side: "right", position: 2, direction: "out" }],
  };
  addInstance(store.design, tp, 0, 0, 0); // U1
  const w = addWire(
    store.design,
    { kind: "pin", refdes: "U1", pin: "Y" },
    { kind: "free", x: 8, y: 4 },
    [{ x: 6, y: 2 }],
  );
  const freeId = w.path[2].v;
  const refs = { bends: [{ wireId: w.id, index: 1 }], vertices: [freeId] };
  const free = () => ({ x: getVertex(store.design, freeId).x, y: getVertex(store.design, freeId).y });

  store.dispatch(translateWiring(refs, 3, 5));
  assert.deepEqual(w.path[1], { t: "bend", x: 9, y: 7 });
  assert.deepEqual(free(), { x: 11, y: 9 });

  store.undo();
  assert.deepEqual(w.path[1], { t: "bend", x: 6, y: 2 });
  assert.deepEqual(free(), { x: 8, y: 4 });
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

// tyPins: one left input (A0) and one right output (/Y0), for wiring tests.
function tyPins() {
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

// turn rotates a point about pivot by delta, matching rotateSelectionCmd.
function turn(p, pivot, delta) {
  const r = rotateOffset(p.x - pivot.x, p.y - pivot.y, delta);
  return { x: pivot.x + r.x, y: pivot.y + r.y };
}

test("rotateSelectionCmd: a lone component rotates in place about its origin (FR-019)", () => {
  const store = newStore();
  store.dispatch(placeComponent(tyPins(), 10, 20, 0)); // U1
  store.dispatch(rotateSelectionCmd(["U1"], 90));
  const u1 = find(store.design, "U1");
  // Pivot is the origin, so origin is unchanged and only rotation advances —
  // exactly the prior single-component behavior.
  assert.deepEqual({ x: u1.x, y: u1.y, rotation: u1.rotation }, { x: 10, y: 20, rotation: 90 });
});

test("rotateSelectionCmd: a lone component carries its interior junction (FR-019/FR-032a)", () => {
  const store = newStore();
  store.dispatch(placeComponent(tyPins(), 10, 20, 0)); // U1: /Y0 (16,22), A0 (10,22)
  // A self-contained wire on U1 with a junction at (13,22).
  const w = addWire(
    store.design,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U1", pin: "A0" },
  );
  const j = branchWire(store.design, w, 0, 13, 22);
  store.dispatch(rotateSelectionCmd(["U1"], 90));
  // The junction rotates about U1's origin (10,20): R90(3,2) -> (-2,3) -> (8,23).
  assert.deepEqual({ x: j.x, y: j.y }, turn({ x: 13, y: 22 }, { x: 10, y: 20 }, 90));
  assert.deepEqual({ x: j.x, y: j.y }, { x: 8, y: 23 });
});

test("rotateSelectionCmd: multi-select rotates rigidly about the group center; undo/redo restore (FR-019)", () => {
  const store = newStore();
  store.dispatch(placeComponent(tyPins(), 10, 20, 0)); // U1
  store.dispatch(placeComponent(tyPins(), 40, 20, 0)); // U2
  const w = addWire(
    store.design,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const j = branchWire(store.design, w, 0, 25, 22); // junction between them
  // Combined bbox x[10,46] y[20,32] -> center (28,26).
  const pivot = { x: 28, y: 26 };
  const before = {
    u1: { ...find(store.design, "U1") },
    u2: { ...find(store.design, "U2") },
    j: { x: j.x, y: j.y },
    junctionNode: store.design.wires[0].path[1].v, // junction node in the host path
  };
  assert.equal(before.junctionNode, j.id);

  store.dispatch(rotateSelectionCmd(["U1", "U2"], 90));

  const u1 = find(store.design, "U1");
  assert.deepEqual(
    { x: u1.x, y: u1.y },
    turn({ x: before.u1.x, y: before.u1.y }, pivot, 90),
  );
  assert.equal(u1.rotation, 90);
  assert.deepEqual({ x: j.x, y: j.y }, turn(before.j, pivot, 90));
  // Connectivity is untouched: the host path still references the same junction.
  assert.equal(store.design.wires[0].path[1].v, before.junctionNode);

  store.undo();
  assert.deepEqual({ x: find(store.design, "U1").x, y: find(store.design, "U1").y }, {
    x: before.u1.x,
    y: before.u1.y,
  });
  assert.equal(find(store.design, "U1").rotation, 0);
  assert.deepEqual({ x: j.x, y: j.y }, before.j);

  store.redo();
  assert.deepEqual({ x: j.x, y: j.y }, turn(before.j, pivot, 90));
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

  store.dispatch(setOverrideCmd("U1", "delays", "tpd", 12));
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);

  store.undo(); // back to no override
  assert.equal(find(store.design, "U1").overrides.delays, undefined);

  store.redo();
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);

  // Clearing the override removes the delays map again.
  store.dispatch(setOverrideCmd("U1", "delays", "tpd", null));
  assert.equal(find(store.design, "U1").overrides.delays, undefined);
  store.undo(); // undo clear -> override back
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);
});

test("setPortPropsCmd patches a port label; undo restores prior values (FR-094)", () => {
  const store = newStore();
  const port = { name: "port", builtin: true, renderType: "port", width: 2, height: 2, pins: [] };
  store.dispatch(placeComponent(port, 0, 0, 0)); // A-1
  const p = find(store.design, "A-1");
  // A 1-wide port defaults its label to the refdes and carries no width (FR-094).
  assert.equal(p.label, "A-1");
  assert.equal(p.width, undefined);

  store.dispatch(setPortPropsCmd("A-1", { label: "CLK" }));
  assert.equal(find(store.design, "A-1").label, "CLK");

  store.undo();
  assert.equal(find(store.design, "A-1").label, "A-1");

  store.redo();
  assert.equal(find(store.design, "A-1").label, "CLK");
});

test("setPortPropsCmd sets, updates, and clears an off-sheet target; undo restores (FR-101/FR-101b)", () => {
  const store = newStore();
  const port = { name: "port", builtin: true, renderType: "port", width: 2, height: 2, pins: [] };
  store.dispatch(placeComponent(port, 0, 0, 0)); // A-1
  assert.equal(find(store.design, "A-1").target, undefined);

  // Set a target (the properties panel's non-empty target-file commit).
  store.dispatch(setPortPropsCmd("A-1", { target: { file: "alu.json", label: "CLK" } }));
  assert.deepEqual(find(store.design, "A-1").target, { file: "alu.json", label: "CLK" });

  // Update just the label (panel re-commits file + new label).
  store.dispatch(setPortPropsCmd("A-1", { target: { file: "alu.json", label: "EN" } }));
  assert.deepEqual(find(store.design, "A-1").target, { file: "alu.json", label: "EN" });

  // Clear it (empty target-file commit → target null).
  store.dispatch(setPortPropsCmd("A-1", { target: null }));
  assert.equal(find(store.design, "A-1").target, null);

  // Undo walks the whole chain back to no-target.
  store.undo(); // un-clear
  assert.deepEqual(find(store.design, "A-1").target, { file: "alu.json", label: "EN" });
  store.undo(); // un-update
  assert.deepEqual(find(store.design, "A-1").target, { file: "alu.json", label: "CLK" });
  store.undo(); // un-set
  assert.equal(find(store.design, "A-1").target, undefined);
});

test("setOverrideCmd handles the props group independently of delays (FR-020b)", () => {
  const store = newStore();
  const t = ty();
  t.delays = { tpd: 7 };
  t.properties = [{ name: "period", unit: "ns", default: 100 }];
  store.dispatch(placeComponent(t, 0, 0, 0)); // U1

  store.dispatch(setOverrideCmd("U1", "props", "period", 200));
  assert.equal(find(store.design, "U1").overrides.props.period, 200);
  assert.equal(find(store.design, "U1").overrides.delays, undefined);

  store.undo();
  assert.equal(find(store.design, "U1").overrides.props, undefined);
  store.redo();
  assert.equal(find(store.design, "U1").overrides.props.period, 200);

  // Clearing props leaves a delays override untouched.
  store.dispatch(setOverrideCmd("U1", "delays", "tpd", 12));
  store.dispatch(setOverrideCmd("U1", "props", "period", null));
  assert.equal(find(store.design, "U1").overrides.props, undefined);
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);
});

test("refreshTypesCmd refreshes all instances, reports, and undoes exactly (FR-088)", () => {
  const store = newStore();
  const t = ty();
  t.delays = { tpd: 7 };
  store.dispatch(placeComponent(t, 0, 0, 0)); // U1
  store.dispatch(placeComponent(t, 10, 0, 0)); // U2
  store.dispatch(setOverrideCmd("U1", "delays", "tpd", 12));

  // The "edited library": behavior added, the tpd delay renamed.
  const edited = ty();
  edited.behavior = "Y = VCC\n";
  edited.delays = { tpd_a: 9 };

  const reports = [];
  store.dispatch(refreshTypesCmd([edited], (m) => reports.push(m)));

  assert.equal(find(store.design, "U1").typeData.behavior, "Y = VCC\n");
  assert.equal(find(store.design, "U2").typeData.behavior, "Y = VCC\n");
  // U1's tpd override no longer matches a declared delay → dropped.
  assert.equal(find(store.design, "U1").overrides.delays, undefined);
  assert.equal(reports.some((m) => m.includes("refreshed 2")), true);

  store.undo(); // exact restore: old typeData and the override are back
  assert.equal(find(store.design, "U1").typeData.behavior, undefined);
  assert.equal(find(store.design, "U1").overrides.delays.tpd, 12);

  store.redo();
  assert.equal(find(store.design, "U2").typeData.behavior, "Y = VCC\n");
  assert.equal(find(store.design, "U1").overrides.delays, undefined);
});

test("refreshTypesCmd matches subunit packages by library id (FR-088)", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty7400(), 0, 0, 0)); // U1A, U1B

  const edited = ty7400();
  edited.behavior = "1Y = /(1A*1B)\n";

  const reports = [];
  store.dispatch(refreshTypesCmd([edited], (m) => reports.push(m)));

  assert.equal(find(store.design, "U1A").typeData.behavior, "1Y = /(1A*1B)\n");
  assert.equal(find(store.design, "U1B").typeData.behavior, "1Y = /(1A*1B)\n");
  assert.equal(reports.some((m) => m.includes("refreshed 2")), true);
});

test("placeSubDesign embeds a child as an X-series instance; undo/redo round-trip", async () => {
  const { placeSubDesign } = await import("./commands.js");
  const store = newStore();
  const iface = [
    { label: "CLK", dir: "in", width: 1 },
    { label: "Q", dir: "out", width: 1 },
  ];
  store.dispatch(
    placeSubDesign(
      { childPath: "../lib/counter.json", render: "ic", iface, childName: "counter" },
      10,
      10,
    ),
  );
  const inst = store.design.components[0];
  assert.equal(inst.refdes, "X1");
  assert.equal(inst.kind, "subdesign");
  assert.equal(inst.childPath, "../lib/counter.json");
  assert.equal(inst.typeData.pins.length, 2);

  store.undo();
  assert.equal(store.design.components.length, 0);
  store.redo();
  assert.equal(store.design.components[0].refdes, "X1"); // same refdes on redo
});

test("pasteFragmentCmd places a fragment with fresh refdes; undo/redo are exact (FR-112)", () => {
  const store = newStore();
  addInstance(store.design, tyPins(), 0, 0, 0); // U1
  addInstance(store.design, tyPins(), 10, 0, 0); // U2
  addWire(
    store.design,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  const frag = extractFragment(store.design, ["U1", "U2"]);

  const cmd = pasteFragmentCmd(frag, 100, 100);
  store.dispatch(cmd);
  assert.deepEqual(cmd.created, ["U3", "U4"]); // exposed for selection
  assert.equal(store.design.components.length, 4);
  assert.equal(store.design.wires.length, 2);
  assert.deepEqual(
    { x: find(store.design, "U3").x, y: find(store.design, "U3").y },
    { x: 100, y: 100 },
  );

  store.undo(); // snapshot restore removes everything pasted
  assert.equal(store.design.components.length, 2);
  assert.equal(store.design.wires.length, 1);

  store.redo(); // deterministic: same designators and wire count
  assert.deepEqual(cmd.created, ["U3", "U4"]);
  assert.equal(store.design.components.length, 4);
  assert.equal(store.design.wires.length, 2);
});

// setNoteTextCmd (FR-071f) sets a note's text, recomputes its auto-sized
// footprint, and is one undoable action restoring the prior text and size.
test("setNoteTextCmd sets text, resizes, and undoes both (FR-071f)", () => {
  const store = newStore();
  store.dispatch(placeComponent(tyNote(), 3, 3, 0));
  const note = store.design.components.find((c) => c.refdes === "N-1");
  assert.equal(note.text, "");
  const { width: w0, height: h0 } = note.typeData;

  store.dispatch(setNoteTextCmd("N-1", "line one\nline two\nline three"));
  const edited = store.design.components.find((c) => c.refdes === "N-1");
  assert.equal(edited.text, "line one\nline two\nline three");
  assert.ok(edited.typeData.height > h0); // grew to fit three lines

  store.undo();
  const reverted = store.design.components.find((c) => c.refdes === "N-1");
  assert.equal(reverted.text, "");
  assert.equal(reverted.typeData.width, w0);
  assert.equal(reverted.typeData.height, h0);
});

// setLabelCmd sets the editable display designator (FR-011b) without touching the
// refdes identity; undo restores the prior label; a blank value clears it.
test("setLabelCmd edits the display label, leaving the refdes identity intact", () => {
  const store = newStore();
  store.dispatch(placeComponent(ty(), 0, 0, 0)); // U1, no label
  assert.equal(find(store.design, "U1").label, undefined);

  store.dispatch(setLabelCmd("U1", "FOO"));
  let u1 = find(store.design, "U1");
  assert.equal(u1.refdes, "U1"); // identity unchanged
  assert.equal(u1.label, "FOO");

  store.undo();
  assert.equal(find(store.design, "U1").label, undefined);

  store.redo();
  assert.equal(find(store.design, "U1").label, "FOO");

  // A blank value clears the label back to the default (absent).
  store.dispatch(setLabelCmd("U1", "   "));
  assert.equal(find(store.design, "U1").label, undefined);

  // Duplicates are allowed: a second instance may carry the same label.
  store.dispatch(placeComponent(ty(), 5, 0, 0)); // U2
  store.dispatch(setLabelCmd("U1", "DUP"));
  store.dispatch(setLabelCmd("U2", "DUP"));
  assert.equal(find(store.design, "U1").label, "DUP");
  assert.equal(find(store.design, "U2").label, "DUP");
});
