import { test } from "node:test";
import assert from "node:assert/strict";

import { planBusEndpoint } from "./interaction.js";

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

// A minimal design carrying one instance U1 of `type` (group acceptance is now
// design-aware, FR-041c) plus any pre-existing buses.
const designWith = (type, buses = []) => ({
  components: [{ refdes: "U1", typeData: type }],
  buses,
});

test("planBusEndpoint auto-snaps a component on a single accepting group (FR-041a)", () => {
  const t = { kind: "component", refdes: "U1", type: typeA, x: 5, y: 6 };
  const { spec, snap } = planBusEndpoint(designWith(typeA), t, 3);
  assert.deepEqual(spec, { kind: "free", x: 5, y: 6 });
  assert.deepEqual(snap, { refdes: "U1", group: "A" });
});

test("planBusEndpoint auto-snaps a narrower bus to a wider single group (FR-041c)", () => {
  const t = { kind: "component", refdes: "U1", type: typeA, x: 0, y: 0 };
  // a 2-bit bus fits the 3-pin group A (pack-low block A0,A1)
  const { snap } = planBusEndpoint(designWith(typeA), t, 2);
  assert.deepEqual(snap, { refdes: "U1", group: "A" });
});

test("planBusEndpoint leaves the end free when no group accepts (FR-043)", () => {
  const t = { kind: "component", refdes: "U1", type: typeA, x: 5, y: 6 };
  const { spec, snap } = planBusEndpoint(designWith(typeA), t, 8);
  assert.deepEqual(spec, { kind: "free", x: 5, y: 6 });
  assert.equal(snap, null);
});

test("planBusEndpoint defers ≥2 accepting groups to the caller (no auto-snap, FR-041b)", () => {
  const t = { kind: "component", refdes: "U1", type: typeAB, x: 0, y: 0 };
  const plan = planBusEndpoint(designWith(typeAB), t, 2);
  assert.equal(plan.snap, null); // caller opens the disambiguation dialog
  assert.deepEqual(
    plan.groups.map((g) => g.name),
    ["A", "B"],
  );
});

test("planBusEndpoint passes non-component targets through unchanged", () => {
  const t = { kind: "branch", wireId: "b1", segIndex: 0, x: 1, y: 2, busWidth: 3 };
  const { spec, snap } = planBusEndpoint(designWith(typeA), t, 3);
  assert.equal(spec, t);
  assert.equal(snap, null);
});

test("planBusEndpoint snaps a proximity group target at the apex (FR-042a)", () => {
  // A "group" target (chosen by cursor proximity) snaps directly to that group,
  // with the endpoint placed at the supplied apex and no disambiguation deferred.
  const plan = planBusEndpoint(
    designWith(typeA),
    { kind: "group", refdes: "A-1", group: "P", x: -2, y: 4.5, busWidth: 8 },
    8,
  );
  assert.deepEqual(plan.snap, { refdes: "A-1", group: "P" });
  assert.deepEqual(plan.spec, { kind: "free", x: -2, y: 4.5 });
  assert.deepEqual(plan.groups, []);
});
