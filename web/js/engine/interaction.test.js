import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bodySnapTarget,
  editableGalType,
  planBusEndpoint,
  probeClaimsClick,
  probeTarget,
  viewableNotesSubject,
} from "./interaction.js";
import { busGroupBrace } from "../model/design.js";

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

// --- body-click snap resolution (FR-041a, resolved at the placing click) ---

// A placed instance of `type` on the grid, with its group's pins down one side so
// busGroupBrace (which bodySnapTarget calls) has the geometry it expects.
const placed = (type, refdes = "U1") => ({
  refdes,
  x: 10,
  y: 10,
  rotation: 0,
  typeData: {
    width: 6,
    height: 6,
    ...type,
    pins: type.pins.map((p, i) => ({ ...p, side: "right", position: i + 1 })),
  },
});

test("bodySnapTarget resolves a single accepting group to a group target (FR-041a)", () => {
  const inst = placed(typeA);
  const t = bodySnapTarget({ components: [inst], buses: [] }, inst, 3);
  assert.equal(t.kind, "group"); // the same shape the proximity path yields
  assert.equal(t.refdes, "U1");
  assert.equal(t.group, "A");
  // Placed at the brace apex, not at wherever the body was clicked.
  const { apex } = busGroupBrace(inst, ["A0", "A1", "A2"]);
  assert.deepEqual({ x: t.x, y: t.y }, { x: apex.x, y: apex.y });
});

test("bodySnapTarget adopts the claimed block's width for a fresh bus (FR-042c)", () => {
  const inst = placed(typeA);
  const d = { components: [inst], buses: [] };
  // width == null is the first endpoint of a bus with no committed width: the
  // whole free run is claimed and the bus takes its size, exactly as a proximity
  // snap does — not the default width the body click used to fall back to.
  assert.equal(bodySnapTarget(d, inst, null).busWidth, 3);
  // A committed width claims a pack-low sub-block of that size (FR-041c).
  assert.equal(bodySnapTarget(d, inst, 2).busWidth, 2);
});

test("bodySnapTarget declines zero and ≥2 accepting groups (FR-043/FR-041b)", () => {
  const one = placed(typeA);
  assert.equal(bodySnapTarget({ components: [one], buses: [] }, one, 8), null); // none fits
  const two = placed(typeAB);
  // Two candidates: the user has not chosen, so there is nothing truthful to
  // preview and the disambiguation stays at commit.
  assert.equal(bodySnapTarget({ components: [two], buses: [] }, two, 2), null);
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

// --- "Edit part definition…" eligibility on a placed instance (FR-033b/FR-066f) ---

// A library holding one project-local GAL part, one shared GAL part, and one
// ordinary 74-series part; findType resolves by type id as interaction.js does.
const galLib = [
  { id: "type-22V-DCD", gal: "GAL22V10", projectLocal: true },
  { id: "type-22V574", gal: "GAL22V10" }, // shared library: no projectLocal
  { id: "type-7400" },
];
const findIn = (lib) => (id) => lib.find((t) => t.id === id) ?? undefined;
const instOf = (id) => ({ refdes: "U1", typeData: { id } });

test("editableGalType offers a project-local GAL part's definition (FR-033b)", () => {
  const t = editableGalType(instOf("type-22V-DCD"), findIn(galLib));
  assert.equal(t, galLib[0]);
});

test("editableGalType declines a shared-library GAL part (FR-006b/FR-121i)", () => {
  assert.equal(editableGalType(instOf("type-22V574"), findIn(galLib)), null);
});

test("editableGalType declines a non-GAL part", () => {
  assert.equal(editableGalType(instOf("type-7400"), findIn(galLib)), null);
});

test("editableGalType declines a type absent from the loaded library (FR-033b)", () => {
  // A design opened outside the project that defines its parts: the instance
  // carries typeData, but there is no library definition to edit.
  assert.equal(editableGalType(instOf("type-elsewhere"), findIn(galLib)), null);
});

test("editableGalType resolves through the library, not the instance's copy (FR-057)", () => {
  // The instance carries a pre-edit snapshot; the dialog must open on the
  // library's current definition, which is what an earlier edit replaced.
  const inst = { refdes: "U1", typeData: { id: "type-22V-DCD", partnumber: "OLD" } };
  const edited = { id: "type-22V-DCD", gal: "GAL22V10", projectLocal: true, partnumber: "NEW" };
  assert.equal(editableGalType(inst, findIn([edited])), edited);
});

test("editableGalType declines an instance with no type data", () => {
  assert.equal(editableGalType(undefined, findIn(galLib)), null);
  assert.equal(editableGalType({ refdes: "U1" }, findIn(galLib)), null);
});

// --- "View notes" eligibility on a placed instance (FR-033b/FR-125b) ---

test("viewableNotesSubject offers a project-local GAL part's notes", () => {
  const lib = [{ id: "type-22V-DCD", gal: "GAL22V10", projectLocal: true, partnumber: "ADDRDEC" }];
  assert.deepEqual(viewableNotesSubject(instOf("type-22V-DCD"), findIn(lib)), {
    kind: "type",
    refdes: "U1",
    name: "ADDRDEC",
    typeId: "type-22V-DCD",
  });
});

test("viewableNotesSubject offers a SHARED-library GAL part too (wider than edit)", () => {
  // The deliberate difference from editableGalType: reading a definition is
  // harmless where rewriting one in place is not (FR-125b).
  assert.equal(editableGalType(instOf("type-22V574"), findIn(galLib)), null);
  assert.equal(viewableNotesSubject(instOf("type-22V574"), findIn(galLib))?.kind, "type");
});

test("viewableNotesSubject declines a non-GAL part and an unknown type", () => {
  assert.equal(viewableNotesSubject(instOf("type-7400"), findIn(galLib)), null);
  assert.equal(viewableNotesSubject(instOf("type-elsewhere"), findIn(galLib)), null);
  assert.equal(viewableNotesSubject(undefined, findIn(galLib)), null);
  assert.equal(viewableNotesSubject({ refdes: "U1" }, findIn(galLib)), null);
});

test("viewableNotesSubject names a GAL with no partnumber by its library id", () => {
  const lib = [{ id: "type-nameless", gal: "GAL22V10" }];
  assert.equal(viewableNotesSubject(instOf("type-nameless"), findIn(lib)).name, "type-nameless");
});

test("viewableNotesSubject offers a sub-design instance, named by its file", () => {
  // The child is a path, not a type (FR-098): the subject carries the path and
  // the caller reads the file, since notes live in the child, not in the parent.
  const inst = { refdes: "X2", kind: "subdesign", childPath: "/proj/sheets/alu.dsn" };
  assert.deepEqual(viewableNotesSubject(inst, findIn(galLib)), {
    kind: "child",
    refdes: "X2",
    name: "alu.dsn",
    path: "/proj/sheets/alu.dsn",
  });
});

test("viewableNotesSubject declines a sub-design instance with no child path", () => {
  assert.equal(viewableNotesSubject({ refdes: "X2", kind: "subdesign" }, findIn(galLib)), null);
});
