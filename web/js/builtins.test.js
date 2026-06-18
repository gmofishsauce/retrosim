import { test } from "node:test";
import assert from "node:assert/strict";

import { BUILTINS, BEHAVIORS } from "./builtins.js";
import { matchingGroups } from "./model/design.js";

function find(name) {
  const t = BUILTINS.find((b) => b.name === name);
  assert.ok(t, `built-in ${name} is registered`);
  return t;
}

// The 8-wide built-ins (FR-071d/FR-071e) each expose eight left-edge bit pins in
// one pin group, so an 8-bit bus snap-connects to all of them at once and nothing
// narrower matches.
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
    // Exactly one width-8 group matches an 8-bit bus; a 4-bit bus matches none.
    assert.deepEqual(
      matchingGroups(t, 8).map((g) => g.name),
      [prefix],
    );
    assert.deepEqual(matchingGroups(t, 4), []);
  }
});

// Both are passive: a grouped bus terminal (port8) and a display-only indicator
// (indicator8) drive nothing (FR-071d/e).
test("8-wide built-ins drive nothing", () => {
  assert.deepEqual(BEHAVIORS.indicator8({}), []);
  assert.deepEqual(BEHAVIORS.port8({}), []);
});
