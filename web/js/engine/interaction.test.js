import { test } from "node:test";
import assert from "node:assert/strict";

import { planBusEndpoint, probeClaimsClick, probeTarget } from "./interaction.js";

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

// --- probe target resolution (FR-087c) ---

// A design with a component whose pin sits at a known point, a wire, a bus, and
// a junction, so the hit precedence can be exercised point by point. Geometry
// mirrors what hittest.js expects: pin positions come from the instance's own
// pin layout, conductors from vertex-referencing paths.
function probeDesign() {
  const type = {
    width: 4,
    height: 4,
    pins: [
      { name: "A", side: "left", position: 1, direction: "in" },
      { name: "Y", side: "right", position: 1, direction: "out" },
    ],
  };
  const vertices = [
    { id: "vw1", kind: "free", x: 20, y: 0 },
    { id: "vw2", kind: "free", x: 26, y: 0 },
    { id: "vj", kind: "junction", x: 23, y: 0 },
    { id: "vb1", kind: "free", x: 20, y: 10 },
    { id: "vb2", kind: "free", x: 26, y: 10 },
  ];
  return {
    components: [
      { refdes: "U1", type: "T", typeData: type, x: 0, y: 0, rotation: 0 },
    ],
    wires: [
      {
        id: "w1",
        path: [
          { t: "node", v: "vw1" },
          { t: "node", v: "vj" },
          { t: "node", v: "vw2" },
        ],
      },
    ],
    buses: [
      {
        id: "b1",
        width: 4,
        path: [{ t: "node", v: "vb1" }, { t: "node", v: "vb2" }],
      },
    ],
    vertices,
  };
}

const TOLS = { pin: 0.7, seg: 0.5 };

test("probeTarget: a wire resolves to its lane-bearing wire descriptor (FR-087c)", () => {
  const t = probeTarget(probeDesign(), { x: 21, y: 0 }, TOLS);
  assert.deepEqual(t, { kind: "wire", id: "w1" });
});

test("probeTarget: a bus carries its width so every bit can be read (FR-087c)", () => {
  const t = probeTarget(probeDesign(), { x: 22, y: 10 }, TOLS);
  assert.deepEqual(t, { kind: "bus", id: "b1", width: 4 });
});

test("probeTarget: a junction reads as the conductor it ties (FR-087c)", () => {
  // The junction sits mid-wire; it must resolve to that wire, not to nothing.
  const t = probeTarget(probeDesign(), { x: 23, y: 0 }, TOLS);
  assert.deepEqual(t, { kind: "wire", id: "w1" });
});

test("probeTarget: a component body resolves to the instance (FR-087c)", () => {
  const t = probeTarget(probeDesign(), { x: 2, y: 2 }, TOLS);
  assert.deepEqual(t, { kind: "component", refdes: "U1" });
});

test("probeTarget: a pin outranks the body it sits on (FR-087c precedence)", () => {
  const d = probeDesign();
  // Probe exactly at pin A's own position: the pin, not the component, wins.
  const t = probeTarget(d, { x: 0, y: 1 }, TOLS);
  assert.equal(t.kind, "pin");
  assert.equal(t.refdes, "U1");
});

test("probeTarget: empty canvas resolves to null, which clears the probe (FR-087c)", () => {
  assert.equal(probeTarget(probeDesign(), { x: 100, y: 100 }, TOLS), null);
});

// --- probe click routing (FR-087c availability) ---
// The probe is offered exactly while values are live: a running simulation OR a
// held vector run (FR-115l). A hold is NOT a locked state since FR-115h, so the
// routing must not be nested inside the read-only lock — the regression that put
// the component's property sheet on screen instead of a reading.
test("probeClaimsClick: a probe click under a HELD vector run is a reading (FR-087c/FR-115l)", () => {
  assert.equal(
    probeClaimsClick({ tool: "probe", simulating: false, vectorHold: true }),
    true,
  );
});

test("probeClaimsClick: a probe click during a running simulation is a reading (FR-087c)", () => {
  assert.equal(
    probeClaimsClick({ tool: "probe", simulating: true, vectorHold: false }),
    true,
  );
});

test("probeClaimsClick: no live values, or another tool, is not a probe click (FR-087c)", () => {
  assert.equal(probeClaimsClick({ tool: "probe", simulating: false, vectorHold: false }), false);
  assert.equal(probeClaimsClick({ tool: "select", simulating: true, vectorHold: false }), false);
  assert.equal(probeClaimsClick({ tool: "select", simulating: false, vectorHold: true }), false);
});
