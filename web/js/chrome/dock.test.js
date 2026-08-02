import { test } from "node:test";
import assert from "node:assert/strict";

import { layout, dragTo, DOCK_MIN, DOCK_DEFAULT } from "./dock.js";

// The pure geometry of the docked-panel dividers (§6.16a, FR-115n). DOM-free by
// design: the grips, the drag, and the canvas refit are §11.2 manual items.

const both = { vec: true, console: true };
const vecOnly = { vec: true, console: false };
const conOnly = { vec: false, console: true };
const defaults = () => ({ vec: DOCK_DEFAULT, console: DOCK_DEFAULT });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("layout with the defaults reproduces today's thirds (FR-115n)", () => {
  const f = layout(defaults(), vecOnly);
  near(f.vec, 1 / 3, "vec");
  assert.equal(f.console, 0);
  const b = layout(defaults(), both);
  near(b.vec, 1 / 3, "vec");
  near(b.console, 1 / 3, "console");
  near(1 - b.vec - b.console, 1 / 3, "canvas host");
});

test("layout gives a closed panel zero and clamps one open panel to [MIN, 1-MIN]", () => {
  assert.deepEqual(layout(defaults(), { vec: false, console: false }), { vec: 0, console: 0 });
  assert.equal(layout({ vec: 0.9, console: 0.5 }, vecOnly).console, 0);
  assert.equal(layout({ vec: 0.99, console: 0.5 }, vecOnly).vec, 1 - DOCK_MIN);
  assert.equal(layout({ vec: 0.01, console: 0.5 }, vecOnly).vec, DOCK_MIN);
  assert.equal(layout({ vec: 0.5, console: 0.99 }, conOnly).console, 1 - DOCK_MIN);
  assert.equal(layout({ vec: 0.5, console: 0.99 }, conOnly).vec, 0);
});

test("layout leaves all three regions >= MIN for ANY stored fractions (FR-115n floors)", () => {
  // Total over any input, so no caller has to pre-validate — including two
  // remembered 0.8s, where the vec panel is clamped first and the console yields.
  const cases = [
    { vec: 0.8, console: 0.8 },
    { vec: 0.95, console: 0.95 },
    { vec: 0, console: 0 },
    { vec: -1, console: 2 },
    { vec: 1 / 3, console: 1 / 3 },
  ];
  for (const f of cases) {
    const a = layout(f, both);
    assert.ok(a.vec >= DOCK_MIN - 1e-12, `vec ${a.vec} for ${JSON.stringify(f)}`);
    assert.ok(a.console >= DOCK_MIN - 1e-12, `console ${a.console} for ${JSON.stringify(f)}`);
    assert.ok(1 - a.vec - a.console >= DOCK_MIN - 1e-12, `canvas for ${JSON.stringify(f)}`);
  }
});

test("dragTo('vec') moves the schematic and leaves the console alone (FR-115n)", () => {
  const f = dragTo(defaults(), both, "vec", 0.5);
  near(f.vec, 0.5, "vec");
  near(f.console, 1 / 3, "console untouched");
  // The schematic absorbed it: 1 - 0.5 - 1/3.
  const a = layout(f, both);
  near(1 - a.vec - a.console, 1 - 0.5 - 1 / 3, "canvas host");
});

test("dragTo('console') with both open holds vec+console constant (FR-115n)", () => {
  const before = layout(defaults(), both);
  const f = dragTo(defaults(), both, "console", 0.5);
  const after = layout(f, both);
  near(after.console, 0.5, "console");
  near(after.vec, 2 / 3 - 0.5, "vec yielded");
  near(after.vec + after.console, before.vec + before.console, "sum held");
  near(1 - after.vec - after.console, 1 - before.vec - before.console, "schematic did not move");
});

test("dragTo('console') with the vec panel closed trades with the schematic", () => {
  const f = dragTo(defaults(), conOnly, "console", 0.5);
  near(f.console, 0.5, "console");
  const a = layout(f, conOnly);
  assert.equal(a.vec, 0);
  near(1 - a.console, 0.5, "canvas host");
});

test("dragTo pins at a floor rather than overshooting or inverting (FR-115n)", () => {
  // Past the schematic's floor: vec stops at 1 - MIN - console.
  near(dragTo(defaults(), both, "vec", 2).vec, 1 - DOCK_MIN - 1 / 3, "vec at the schematic floor");
  near(dragTo(defaults(), both, "vec", -1).vec, DOCK_MIN, "vec at its own floor");
  // Past the vec panel's floor: the console stops at total - MIN, and the vec
  // panel lands exactly on MIN — never negative, never past it.
  const f = dragTo(defaults(), both, "console", 5);
  near(f.console, 2 / 3 - DOCK_MIN, "console at the vec floor");
  near(f.vec, DOCK_MIN, "vec pinned at MIN, not inverted");
  near(dragTo(defaults(), both, "console", -5).console, DOCK_MIN, "console at its own floor");
  // A single open panel cannot squeeze the schematic out either.
  near(dragTo(defaults(), vecOnly, "vec", 2).vec, 1 - DOCK_MIN, "vec alone at the schematic floor");
});

test("dragTo on a closed panel's key is the identity (FR-115n)", () => {
  assert.deepEqual(dragTo(defaults(), vecOnly, "console", 0.5), defaults());
  assert.deepEqual(dragTo(defaults(), conOnly, "vec", 0.5), defaults());
  assert.deepEqual(dragTo(defaults(), { vec: false, console: false }, "vec", 0.5), defaults());
});

test("the geometry is pixel-free, so it is identical at any area height", () => {
  // The window-resize property (FR-115n): fractions in, fractions out — nothing
  // in layout/dragTo can see a height, so a resize preserves the proportion and
  // the dock needs no resize listener.
  const f = { vec: 0.42, console: 0.21 };
  for (const want of [0.15, 0.4, 0.75]) {
    const a = dragTo(f, both, "vec", want);
    const b = dragTo(f, both, "vec", want);
    assert.deepEqual(a, b);
  }
});
