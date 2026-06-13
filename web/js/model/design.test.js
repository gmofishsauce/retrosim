import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addSubunitPackage,
  addBus,
  addWire,
  pinWorldPos,
  matchingGroups,
  snapBusGroup,
  setBusBitNames,
  breakoutBit,
  getVertex,
  refreshInstance,
  rigidWiring,
  shiftWiring,
} from "./design.js";

// A representative component type (stub-shaped, see server stubComponents).
function type74138() {
  return {
    name: "74138",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "/Y0", side: "right", position: 2, direction: "out" },
    ],
  };
}

test("rigidWiring returns interior bends only when all pins move (FR-018c)", () => {
  const d = createDesign("t");
  addInstance(d, type74138(), 0, 0, 0); // U1
  addInstance(d, type74138(), 10, 0, 0); // U2
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
    [{ x: 5, y: 3 }],
  );

  // both endpoints' components move -> the bend is interior
  const both = rigidWiring(d, new Set(["U1", "U2"]));
  assert.deepEqual(both.bends, [{ wireId: w.id, index: 1 }]);
  assert.deepEqual(both.vertices, []); // endpoints are pins, not carried

  // one endpoint stationary -> boundary network, nothing carried (stretches)
  assert.deepEqual(rigidWiring(d, new Set(["U1"])), { bends: [], vertices: [] });
});

test("rigidWiring carries a free (dangling) vertex; shiftWiring offsets it (FR-018c)", () => {
  const d = createDesign("t");
  addInstance(d, type74138(), 0, 0, 0); // U1
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "free", x: 8, y: 4 },
    [{ x: 6, y: 2 }],
  );
  const freeId = w.path[2].v;

  const refs = rigidWiring(d, new Set(["U1"]));
  assert.deepEqual(refs.bends, [{ wireId: w.id, index: 1 }]);
  assert.deepEqual(refs.vertices, [freeId]);

  shiftWiring(d, refs, 2, 3);
  assert.deepEqual(w.path[1], { t: "bend", x: 8, y: 5 });
  const free = getVertex(d, freeId);
  assert.deepEqual({ x: free.x, y: free.y }, { x: 10, y: 7 });
});

test("createDesign produces an empty design with the given name", () => {
  const d = createDesign("unnamed schematic 2026-06-02 10:00");
  assert.equal(d.name, "unnamed schematic 2026-06-02 10:00");
  assert.deepEqual(d.components, []);
  assert.deepEqual(d.wires, []);
  assert.deepEqual(d.buses, []);
  assert.deepEqual(d.vertices, []);
});

test("addInstance assigns sequential refdes from U1", () => {
  const d = createDesign("t");
  const u1 = addInstance(d, type74138(), 0, 0, 0);
  const u2 = addInstance(d, type74138(), 5, 0, 0);
  assert.equal(u1.refdes, "U1");
  assert.equal(u2.refdes, "U2");
  assert.equal(d.components.length, 2);
});

// A subunit package: quad 2-input NAND (two units shown).
function type7400() {
  return {
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

test("addSubunitPackage creates one instance per unit sharing a U-number (FR-013a)", () => {
  const d = createDesign("t");
  addInstance(d, type74138(), 0, 0, 0); // U1
  const units = addSubunitPackage(d, type7400(), 10, 10);
  assert.equal(units.length, 2);
  assert.deepEqual(units.map((u) => u.refdes), ["U2A", "U2B"]);
  assert.equal(d.components.length, 3);
  // each sibling carries only its own unit's pins and a symbol footprint.
  assert.deepEqual(units[0].typeData.pins.map((p) => p.name), ["1A", "1B", "1Y"]);
  assert.equal(units[0].typeData.width, 5); // nand: bodyW 4 + inversion column
  assert.equal(units[0].typeData.height, 4);
});

test("addSubunitPackage stacks units vertically so they don't overlap", () => {
  const d = createDesign("t");
  const [a, b] = addSubunitPackage(d, type7400(), 10, 10);
  assert.deepEqual({ x: a.x, y: a.y }, { x: 10, y: 10 });
  assert.equal(b.x, 10);
  assert.equal(b.y, 10 + a.typeData.height + 1);
});

test("subunit pin world positions come from symbol geometry (FR-014a)", () => {
  const d = createDesign("t");
  const [a] = addSubunitPackage(d, type7400(), 10, 10);
  // inputs on the left at rows 1 and 3; output centered on the right at row 2.
  assert.deepEqual(pinWorldPos(a, "1A"), { x: 10, y: 11 });
  assert.deepEqual(pinWorldPos(a, "1B"), { x: 10, y: 13 });
  assert.deepEqual(pinWorldPos(a, "1Y"), { x: 15, y: 12 });
});

test("a subunit U-number counts despite its letter suffix (FR-011)", () => {
  const d = createDesign("t");
  addSubunitPackage(d, type7400(), 0, 0); // U1A, U1B
  const next = addInstance(d, type74138(), 0, 0, 0);
  assert.equal(next.refdes, "U2");
});

test("addInstance increments past gaps (FR-011)", () => {
  const d = createDesign("t");
  // Simulate a prior delete leaving U1 and U3.
  d.components.push({ refdes: "U1" }, { refdes: "U3" });
  const next = addInstance(d, type74138(), 0, 0, 0);
  assert.equal(next.refdes, "U4");
});

test("addInstance records type name, position, rotation, empty overrides", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 90);
  assert.equal(inst.type, "74138");
  assert.equal(inst.x, 10);
  assert.equal(inst.y, 20);
  assert.equal(inst.rotation, 90);
  assert.deepEqual(inst.overrides, {});
});

test("addInstance copies type data (mutating the source does not affect it)", () => {
  const d = createDesign("t");
  const src = type74138();
  const inst = addInstance(d, src, 0, 0, 0);
  src.pins[0].name = "MUTATED";
  assert.equal(inst.typeData.pins[0].name, "A0");
});

test("pinWorldPos applies side/position offset at rotation 0", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 0);
  assert.deepEqual(pinWorldPos(inst, "A0"), { x: 10, y: 22 }); // left,pos2 -> (0,2)
  assert.deepEqual(pinWorldPos(inst, "/Y0"), { x: 16, y: 22 }); // right,pos2 -> (6,2)
});

test("pinWorldPos applies rotation (§6.7)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 90);
  // A0 offset (0,2) rotated 90 -> (-2,0) -> world (8,20)
  assert.deepEqual(pinWorldPos(inst, "A0"), { x: 8, y: 20 });
});

test("pinWorldPos throws for an unknown pin", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 0, 0, 0);
  assert.throws(() => pinWorldPos(inst, "NOPE"));
});

// --- matchingGroups (FR-041) ---

// A type with two equal-width groups (A, B) and one wider group (Y).
function typeALU() {
  return {
    name: "ALU",
    width: 8,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "A1", side: "left", position: 3, direction: "in" },
      { name: "B0", side: "left", position: 5, direction: "in" },
      { name: "B1", side: "left", position: 6, direction: "in" },
      { name: "Y0", side: "right", position: 3, direction: "out" },
      { name: "Y1", side: "right", position: 4, direction: "out" },
      { name: "Y2", side: "right", position: 5, direction: "out" },
      { name: "Y3", side: "right", position: 6, direction: "out" },
    ],
    pinGroups: [
      { name: "A", pins: ["A0", "A1"] },
      { name: "B", pins: ["B0", "B1"] },
      { name: "Y", pins: ["Y0", "Y1", "Y2", "Y3"] },
    ],
  };
}

test("matchingGroups returns groups whose member pin count equals the bus width", () => {
  const t = typeALU();
  assert.deepEqual(
    matchingGroups(t, 2).map((g) => g.name),
    ["A", "B"],
  );
  assert.deepEqual(
    matchingGroups(t, 4).map((g) => g.name),
    ["Y"], // the Y group has 4 single-bit pins
  );
});

test("matchingGroups returns [] when no group matches or none are declared", () => {
  assert.deepEqual(matchingGroups(typeALU(), 3), []);
  assert.deepEqual(matchingGroups({ pins: [] }, 2), []);
});

test("matchingGroups throws if a group names an unknown pin", () => {
  const t = { pins: [], pinGroups: [{ name: "A", pins: ["A0"] }] };
  assert.throws(() => matchingGroups(t, 1));
});

// --- snapBusGroup / setBusBitNames (FR-042/FR-037b) ---

// A 74138-shaped type with a 3-bit single-bit-pin group "A".
function type74138Grp() {
  return {
    name: "74138",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "A1", side: "left", position: 3, direction: "in" },
      { name: "A2", side: "left", position: 4, direction: "in" },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
  };
}

const freeBus = (d, width) =>
  addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 4, y: 0 }, width);

test("snapBusGroup records a group connection and adopts bit names (FR-042/037b)", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0); // U1
  const bus = freeBus(d, 3);
  const vid = bus.path[1].v;
  snapBusGroup(d, bus.id, vid, "U1", "A");
  assert.deepEqual(bus.groupConnections, [
    { vertex: vid, instance: "U1", group: "A", bitMap: ["A0", "A1", "A2"] },
  ]);
  assert.deepEqual(bus.bitNames, ["A0", "A1", "A2"]);
});

test("snapBusGroup does not overwrite existing bit names", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0);
  const bus = freeBus(d, 3);
  bus.bitNames = ["X0", "X1", "X2"];
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A");
  assert.deepEqual(bus.bitNames, ["X0", "X1", "X2"]);
});

test("snapBusGroup maps a 4-pin group across bus bits (FR-042)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0); // Y is a 4-pin group
  const bus = freeBus(d, 4);
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "Y");
  assert.deepEqual(bus.groupConnections[0].bitMap, ["Y0", "Y1", "Y2", "Y3"]);
});

test("snapBusGroup throws on a group/bus width mismatch", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 10, 20, 0);
  const bus = freeBus(d, 2);
  assert.throws(() => snapBusGroup(d, bus.id, bus.path[1].v, "U1", "A"));
});

test("setBusBitNames sets and clears names with a length check (FR-037b)", () => {
  const d = createDesign("t");
  const bus = freeBus(d, 2);
  setBusBitNames(d, bus.id, ["C", "V"]);
  assert.deepEqual(bus.bitNames, ["C", "V"]);
  setBusBitNames(d, bus.id, null);
  assert.equal(bus.bitNames, null);
  assert.throws(() => setBusBitNames(d, bus.id, ["only-one"]));
});

// --- breakoutBit (FR-043a) ---

test("breakoutBit taps one bus bit and starts a single-bit wire (FR-043a)", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 40, 20, 0); // U1 (has pin A0)
  const bus = freeBus(d, 4);
  const wire = breakoutBit(d, bus.id, 0, 4, 0, 2, {
    kind: "pin",
    refdes: "U1",
    pin: "A0",
  });

  // a junction with bit==2 was inserted as an interior node of the bus path
  const jNode = bus.path.find(
    (p) => p.t === "node" && getVertex(d, p.v).kind === "junction",
  );
  const j = getVertex(d, jNode.v);
  assert.equal(j.bit, 2);
  // the new single-bit wire runs from that junction to the pin
  assert.equal(d.wires.length, 1);
  assert.equal(wire.path[0].v, j.id);
});

test("breakoutBit rejects an out-of-range bit", () => {
  const d = createDesign("t");
  const bus = freeBus(d, 4);
  assert.throws(() =>
    breakoutBit(d, bus.id, 0, 4, 0, 4, { kind: "free", x: 1, y: 1 }),
  );
});

// --- refreshInstance (FR-088) ---

// refreshType returns an "edited" 74138: behavior added, a delay renamed, a
// property list introduced.
function refreshedType() {
  const t = type74138();
  t.behavior = "/Y0 = /A0\n";
  t.delays = { tpd_a: 9 };
  t.properties = [{ name: "period", unit: "ns", default: 100 }];
  return t;
}

test("refreshInstance replaces typeData, preserving identity and wiring (FR-088)", () => {
  const d = createDesign("t");
  const old = type74138();
  old.delays = { tpd: 7 };
  const inst = addInstance(d, old, 10, 20, 90);
  // Wire the output so the connected-pin check is exercised.
  d.vertices.push({ id: "v1", kind: "pin", ref: inst.refdes, pin: "/Y0", x: 0, y: 0 });
  inst.overrides = { delays: { tpd: 12 } };

  const r = refreshInstance(d, inst, refreshedType());
  assert.deepEqual(r, { ok: true });
  assert.equal(inst.typeData.behavior, "/Y0 = /A0\n"); // new data arrived
  assert.equal(inst.refdes, "U1");
  assert.equal(inst.x, 10);
  assert.equal(inst.rotation, 90);
  // The tpd override no longer matches any declared delay → dropped.
  assert.equal(inst.overrides.delays, undefined);
});

test("refreshInstance keeps overrides whose keys survive (FR-088)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, refreshedType(), 0, 0, 0);
  inst.overrides = { delays: { tpd_a: 11 }, props: { period: 200 } };
  assert.deepEqual(refreshInstance(d, inst, refreshedType()), { ok: true });
  assert.deepEqual(inst.overrides, { delays: { tpd_a: 11 }, props: { period: 200 } });
});

test("refreshInstance skips when a wired pin is gone; unwired pin changes are fine (FR-088)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 0, 0, 0);
  d.vertices.push({ id: "v1", kind: "pin", ref: inst.refdes, pin: "/Y0", x: 0, y: 0 });

  const renamed = refreshedType();
  renamed.pins = [
    { name: "A0", side: "left", position: 2, direction: "in" },
    { name: "/O0", side: "right", position: 2, direction: "out" }, // /Y0 renamed
  ];
  const before = inst.typeData;
  const r = refreshInstance(d, inst, renamed);
  assert.equal(r.skip.includes("/Y0"), true);
  assert.equal(inst.typeData, before); // untouched

  // Renaming the UNwired input is fine: only connected pins constrain.
  const renamedInput = refreshedType();
  renamedInput.pins = [
    { name: "B0", side: "left", position: 2, direction: "in" }, // A0 renamed
    { name: "/Y0", side: "right", position: 2, direction: "out" },
  ];
  assert.deepEqual(refreshInstance(d, inst, renamedInput), { ok: true });
});

test("refreshInstance skips on renderType change (FR-088)", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 0, 0, 0);
  const sub = { ...refreshedType(), renderType: "subunit", renderAs: "nand" };
  const r = refreshInstance(d, inst, sub);
  assert.equal(r.skip.includes("render type"), true);
});

test("refreshInstance rebuilds a subunit sibling's per-unit typeData (FR-088)", () => {
  const pkg = {
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
  const d = createDesign("t");
  const [a, b] = addSubunitPackage(d, pkg, 0, 0);
  d.vertices.push({ id: "v1", kind: "pin", ref: b.refdes, pin: "2Y", x: 0, y: 0 });

  const edited = structuredClone(pkg);
  edited.behavior = "1Y = /1A + /1B\n2Y = /2A + /2B\n";
  assert.deepEqual(refreshInstance(d, b, edited), { ok: true });
  // Sibling B keeps only unit B's pins, and the behavior arrived.
  assert.deepEqual(b.typeData.pins.map((p) => p.name), ["2A", "2B", "2Y"]);
  assert.equal(b.typeData.unit, "B");
  assert.ok(b.typeData.behavior.includes("2Y"));
  assert.ok(b.typeData.width > 0 && b.typeData.height > 0); // footprint rebuilt

  // A wired pin moved to a DIFFERENT unit is gone from this sibling → skip.
  const moved = structuredClone(edited);
  moved.pins.find((p) => p.name === "2Y").unit = "A";
  assert.equal(refreshInstance(d, b, moved).skip.includes("2Y"), true);
  void a;
});
