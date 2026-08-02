import { test } from "node:test";
import assert from "node:assert/strict";

import { layout, dragTo, DOCK_MIN, DOCK_DEFAULT } from "./dock.js";

// The pure geometry of the docked panel area's divider (§6.16a, FR-115n/FR-123).
// DOM-free by design: the strip, the grip, the drag, and the canvas refit are
// §11.2 manual items.
//
// ONE fraction, shared by every tab (FR-123): the two-fraction stacking
// arithmetic these tests used to cover — a console divider trading area with the
// test-vector panel above it — is gone with the stacking layout itself. Note what
// is NOT a parameter of either function: which tab is frontmost. Nothing here can
// tie a height to a tab, which is precisely FR-123's "switching tabs never
// resizes the area".

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("layout with the default gives the area a third and the canvas the rest (FR-115n)", () => {
  near(layout(DOCK_DEFAULT, true), 1 / 3, "area");
  near(1 - layout(DOCK_DEFAULT, true), 2 / 3, "canvas host");
});

test("layout is zero while no tab is open — the area is absent (FR-123)", () => {
  assert.equal(layout(DOCK_DEFAULT, false), 0);
  assert.equal(layout(0.9, false), 0);
});

test("layout keeps both regions above the floor for ANY stored fraction (FR-115n)", () => {
  // Total over any input, so no caller has to pre-validate — including a
  // remembered 0.99 that a later window resize re-clamps.
  for (const f of [0.99, 1, 2, 0.5, 0.1, 0.01, 0, -1, DOCK_DEFAULT]) {
    const a = layout(f, true);
    assert.ok(a >= DOCK_MIN - 1e-12, `area ${a} for ${f}`);
    assert.ok(1 - a >= DOCK_MIN - 1e-12, `canvas host ${1 - a} for ${f}`);
  }
  assert.equal(layout(0.99, true), 1 - DOCK_MIN);
  assert.equal(layout(0.01, true), DOCK_MIN);
});

test("dragTo moves the area and the schematic absorbs it (FR-115n)", () => {
  near(dragTo(DOCK_DEFAULT, true, 0.5), 0.5, "area");
  near(1 - layout(dragTo(DOCK_DEFAULT, true, 0.5), true), 0.5, "canvas host");
});

test("dragTo pins at either floor rather than overshooting or inverting (FR-115n)", () => {
  near(dragTo(DOCK_DEFAULT, true, 2), 1 - DOCK_MIN, "at the schematic's floor");
  near(dragTo(DOCK_DEFAULT, true, -1), DOCK_MIN, "at the area's own floor");
  // Neither region can be dragged away entirely: the area disappears only when
  // its last tab is closed (FR-123).
  assert.ok(dragTo(DOCK_DEFAULT, true, 5) < 1);
  assert.ok(dragTo(DOCK_DEFAULT, true, -5) > 0);
});

test("dragTo with no tab open is the identity (FR-115n)", () => {
  // There is no grip to grab; the guard lives in the geometry, not only the DOM.
  assert.equal(dragTo(DOCK_DEFAULT, false, 0.5), DOCK_DEFAULT);
  assert.equal(dragTo(0.42, false, 0.9), 0.42);
});

test("the geometry is pixel-free, so it is identical at any area height", () => {
  // The window-resize property (FR-115n): a fraction in, a fraction out —
  // nothing in layout/dragTo can see a height, so a resize preserves the
  // proportion the user chose and the dock needs no resize listener.
  for (const want of [0.15, 0.4, 0.75]) {
    assert.equal(dragTo(0.42, true, want), dragTo(0.42, true, want));
    assert.equal(layout(want, true), layout(want, true));
  }
});
