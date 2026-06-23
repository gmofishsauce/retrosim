import { test } from "node:test";
import assert from "node:assert/strict";

import { BUILTINS, BEHAVIORS, INTERACTIONS, memDeviceType } from "./builtins.js";

function find(name) {
  const t = BUILTINS.find((b) => b.name === name);
  assert.ok(t, `built-in ${name} is registered`);
  return t;
}

// The 8-wide built-ins (FR-071d/FR-071e) each expose eight left-edge bit pins in
// one pin group, so an 8-bit bus snap-connects to all of them at once (and, per
// FR-041c, a narrower bus may take a free sub-block of the group).
test("8-wide built-ins expose eight grouped bits for an 8-bit bus snap (FR-071d/e)", () => {
  for (const { name, prefix, dir } of [
    { name: "indicator8", prefix: "D", dir: "in" },
    { name: "port8", prefix: "P", dir: "bidir" },
  ]) {
    const t = find(name);
    assert.equal(t.width, 3);
    assert.equal(t.height, 9);
    assert.equal(t.pins.length, 8);
    assert.deepEqual(
      t.pins.map((p) => p.name),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => prefix + i),
    );
    assert.ok(t.pins.every((p) => p.side === "left" && p.direction === dir));
    // Pins sit at grid rows 1..8 (3×9 footprint, 1-unit top/bottom margin).
    assert.deepEqual(
      t.pins.map((p) => p.position),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    // Exactly one pin group, named `prefix`, holding all eight bits.
    assert.deepEqual(
      t.pinGroups.map((g) => g.name),
      [prefix],
    );
    assert.equal(t.pinGroups[0].pins.length, 8);
  }
});

// Both are passive: a grouped bus terminal (port8) and a display-only indicator
// (indicator8) drive nothing (FR-071d/e).
test("8-wide built-ins drive nothing", () => {
  // BEHAVIORS is keyed by type id (FR-066e), e.g. "type-indicator8".
  assert.deepEqual(BEHAVIORS["type-indicator8"]({}), []);
  assert.deepEqual(BEHAVIORS["type-port8"]({}), []);
});

// --- memDeviceType (FR-114c) ---

test("memDeviceType builds a RAM pinout: ADDR left, DATA right, CE//OE//WE/ (FR-114c)", () => {
  const t = memDeviceType({ name: "PROGRAM_RAM", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  // Not a built-in: U-series refdes + default labelled-rectangle render.
  assert.ok(!t.builtin);
  // The free-form name is the display name and derives the library id (FR-066e).
  assert.equal(t.id, "type-PROGRAM_RAM");
  assert.equal(t.name, "PROGRAM_RAM");
  const byName = Object.fromEntries(t.pins.map((p) => [p.name, p]));
  // 8 address inputs on the left at positions 1..8.
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(byName[`A${i}`], { name: `A${i}`, side: "left", position: i + 1, direction: "in" });
  }
  // Controls follow the address run on the left, in order CE/, OE/, WE/.
  assert.deepEqual(byName["CE/"], { name: "CE/", side: "left", position: 9, direction: "in" });
  assert.deepEqual(byName["OE/"], { name: "OE/", side: "left", position: 10, direction: "in" });
  assert.deepEqual(byName["WE/"], { name: "WE/", side: "left", position: 11, direction: "in" });
  // 8 bidirectional data pins on the right at positions 1..8.
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(byName[`D${i}`], { name: `D${i}`, side: "right", position: i + 1, direction: "bidir" });
  }
  // Snap groups.
  assert.deepEqual(t.pinGroups, [
    { name: "ADDR", pins: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"] },
    { name: "DATA", pins: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"] },
  ]);
  // Outline: width floors at 4; height fits the taller (left) edge + margin.
  assert.equal(t.width, 4);
  assert.equal(t.height, 11 + 2);
});

test("memDeviceType ROM has no WE/ and tristate data pins (FR-114c)", () => {
  const t = memDeviceType({ name: "FONT_ROM", kind: "rom", addressBits: 4, dataWidth: 16, locations: 16, romFile: "/r/x.bin" });
  assert.equal(t.id, "type-FONT_ROM");
  assert.ok(!t.pins.some((p) => p.name === "WE/"));
  assert.ok(t.pins.filter((p) => p.name.startsWith("D")).every((p) => p.direction === "tristate"));
  // ROM data is the taller edge here (16 vs 4 addr + 2 ctrl = 6).
  assert.equal(t.height, 16 + 2);
  // The chosen content file is carried on the type for the deferred behavior.
  assert.equal(t.mem.romFile, "/r/x.bin");
  assert.equal(t.mem.kind, "rom");
});

test("memDeviceType id follows the name, not the pinout (FR-114c/FR-066e)", () => {
  // Same pinout, different names → distinct ids (two distinct types).
  const a = memDeviceType({ name: "RAM_A", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  const b = memDeviceType({ name: "RAM_B", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  assert.notEqual(a.id, b.id);
  // Same name → same id, so the caller's library collision check catches a dup.
  const c = memDeviceType({ name: "RAM_A", kind: "ram", addressBits: 4, dataWidth: 16, locations: 16 });
  assert.equal(a.id, c.id);
});

// The text note (FR-071f) is a pure annotation: a built-in with no pins, no
// pin groups, no properties, and no behavior or interaction entry.
test("text note is a pinless, behaviorless built-in (FR-071f)", () => {
  const t = find("note");
  assert.equal(t.builtin, true);
  assert.equal(t.renderType, "note");
  assert.deepEqual(t.pins, []);
  assert.ok(!t.pinGroups);
  assert.ok(!t.properties);
  // No simulation behavior and no interactive handler — sim.js skips it.
  // (registries are keyed by type id, FR-066e.)
  assert.ok(!("type-note" in BEHAVIORS));
  assert.ok(!("type-note" in INTERACTIONS));
});
