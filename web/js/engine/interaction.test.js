import { test } from "node:test";
import assert from "node:assert/strict";

import {
  planBusEndpoint,
  resolveDragTarget,
  movedPastThreshold,
  DRAG_PX,
} from "./interaction.js";

// A type with a single 3-bit group "A".
const typeA = {
  pins: [
    { name: "A0" },
    { name: "A1" },
    { name: "A2" },
  ],
  pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
};

// A type with two equal-width (2-bit) groups, A and B.
const typeAB = {
  pins: [
    { name: "A0" },
    { name: "A1" },
    { name: "B0" },
    { name: "B1" },
  ],
  pinGroups: [
    { name: "A", pins: ["A0", "A1"] },
    { name: "B", pins: ["B0", "B1"] },
  ],
};

test("planBusEndpoint auto-snaps a component on a single width match (FR-041a)", () => {
  const t = { kind: "component", refdes: "U1", type: typeA, x: 5, y: 6 };
  const { spec, snap } = planBusEndpoint(t, 3);
  assert.deepEqual(spec, { kind: "free", x: 5, y: 6 });
  assert.deepEqual(snap, { refdes: "U1", group: "A" });
});

test("planBusEndpoint leaves the end free when no group matches (FR-043)", () => {
  const t = { kind: "component", refdes: "U1", type: typeA, x: 5, y: 6 };
  const { spec, snap } = planBusEndpoint(t, 8);
  assert.deepEqual(spec, { kind: "free", x: 5, y: 6 });
  assert.equal(snap, null);
});

test("planBusEndpoint defers ≥2 matches to the caller (no auto-snap, FR-041b)", () => {
  const t = { kind: "component", refdes: "U1", type: typeAB, x: 0, y: 0 };
  const plan = planBusEndpoint(t, 2);
  assert.equal(plan.snap, null); // caller opens the disambiguation dialog
  assert.deepEqual(
    plan.groups.map((g) => g.name),
    ["A", "B"],
  );
});

test("planBusEndpoint passes non-component targets through unchanged", () => {
  const t = { kind: "branch", wireId: "b1", segIndex: 0, x: 1, y: 2, busWidth: 3 };
  const { spec, snap } = planBusEndpoint(t, 3);
  assert.equal(spec, t);
  assert.equal(snap, null);
});

const pinSrc = { kind: "pin", refdes: "U1", pin: "Y" };

test("resolveDragTarget connects a pin source to a different pin (FR-027d)", () => {
  const target = { kind: "pin", refdes: "U2", pin: "A" };
  assert.deepEqual(resolveDragTarget(pinSrc, target), { action: "connect" });
});

test("resolveDragTarget connects a pin source to a wire-segment branch (FR-027d)", () => {
  const target = { kind: "branch", wireId: "w1", segIndex: 0, x: 3, y: 4 };
  assert.deepEqual(resolveDragTarget(pinSrc, target), { action: "connect" });
});

test("resolveDragTarget drops a dangling end on empty canvas (FR-027d/FR-029)", () => {
  assert.deepEqual(resolveDragTarget(pinSrc, null), { action: "dangling" });
});

test("resolveDragTarget cancels when released on the source pin (FR-027d)", () => {
  const target = { kind: "pin", refdes: "U1", pin: "Y" };
  assert.deepEqual(resolveDragTarget(pinSrc, target), { action: "cancel" });
});

test("resolveDragTarget cancels for a non-pin source (drag-to-connect is pins-only)", () => {
  const branchSrc = { kind: "branch", wireId: "w1", segIndex: 0, x: 0, y: 0 };
  assert.deepEqual(resolveDragTarget(branchSrc, null), { action: "cancel" });
});

test("movedPastThreshold distinguishes a drag from a click at DRAG_PX (FR-027d)", () => {
  const o = { x: 100, y: 100 };
  assert.equal(movedPastThreshold(o, { x: 100, y: 100 }), false); // no move = click
  assert.equal(movedPastThreshold(o, { x: 100 + DRAG_PX, y: 100 }), false); // exactly at slop
  assert.equal(movedPastThreshold(o, { x: 100 + DRAG_PX + 1, y: 100 }), true); // past slop = drag
});
