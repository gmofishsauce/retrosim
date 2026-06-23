import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addSubunitPackage,
  addBus,
  addWire,
  pinWorldPos,
  groupFreeBlock,
  groupsAcceptingBus,
  snapBusGroup,
  setBusBitNames,
  breakoutBit,
  getVertex,
  refreshInstance,
  rigidWiring,
  shiftWiring,
  busGroupBrace,
  BUS_BRACE_DEPTH,
  typeIdentity,
  noteSize,
} from "./design.js";

// A text-note built-in type (FR-071f): pinless, auto-sized.
function typeNote() {
  return { name: "note", builtin: true, renderType: "note", width: 4, height: 2, pins: [] };
}

// A representative component type (stub-shaped, see server stubComponents).
function type74138() {
  return {
    id: "type-74138",
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

test("rigidWiring carries a group-snapped bus endpoint with its component (FR-018c/FR-042)", () => {
  const d = createDesign("t");
  // A small 2-bit group so the bus can snap to all of it.
  const ty = {
    name: "grp",
    width: 4,
    height: 6,
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1"] }],
  };
  addInstance(d, ty, 0, 0, 0); // U1
  addInstance(d, ty, 20, 0, 0); // U2
  const bus = addBus(d, { kind: "free", x: 1, y: 1 }, { kind: "free", x: 19, y: 1 }, 2);
  const aEnd = bus.path[0].v;
  const bEnd = bus.path[bus.path.length - 1].v;
  snapBusGroup(d, bus.id, aEnd, "U1", "A");
  snapBusGroup(d, bus.id, bEnd, "U2", "A");

  // Move U1 only: its snapped endpoint follows (boundary bus stretches), the U2
  // endpoint stays — previously neither moved and the bus was left behind.
  const refs = rigidWiring(d, new Set(["U1"]));
  assert.ok(refs.vertices.includes(aEnd));
  assert.ok(!refs.vertices.includes(bEnd));
  shiftWiring(d, refs, 5, 0);
  assert.equal(getVertex(d, aEnd).x, 6);
  assert.equal(getVertex(d, bEnd).x, 19); // untouched

  // Move both: both snapped endpoints are carried (rigid translate).
  const both = rigidWiring(d, new Set(["U1", "U2"]));
  assert.ok(both.vertices.includes(aEnd));
  assert.ok(both.vertices.includes(bEnd));
});

test("busGroupBrace tips touch the outer pins; apex juts outward (FR-042a)", () => {
  const ty = {
    name: "p8",
    width: 3,
    height: 9,
    pins: Array.from({ length: 8 }, (_, i) => ({
      name: "P" + i,
      side: "left",
      position: i + 1,
      direction: "bidir",
    })),
    pinGroups: [{ name: "P", pins: Array.from({ length: 8 }, (_, i) => "P" + i) }],
  };
  const d = createDesign("t");
  const inst = addInstance(d, ty, 0, 0, 0);
  const br = busGroupBrace(inst, inst.typeData.pinGroups[0].pins);

  assert.deepEqual(br.out, { x: -1, y: 0 }); // left side, no rotation
  // tips at the outermost pins (P0 at y=1, P7 at y=8); order along the span is
  // immaterial to the brace
  assert.deepEqual(
    [br.a, br.b].map((p) => Math.round(p.y)).sort((x, y) => x - y),
    [1, 8],
  );
  // apex on a grid point: the floor(8/2)=4th pin's row (y=4), BUS_BRACE_DEPTH left
  // of the pins' grid line (x=0). Even pin count -> halves are slightly asymmetric.
  assert.deepEqual(br.apex, { x: -BUS_BRACE_DEPTH, y: 4 });
  assert.equal(Number.isInteger(br.apex.x) && Number.isInteger(br.apex.y), true);
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

// A GAL part is keyed by its immutable id, divorced from the device family and
// the part-number display name (FR-066e).
function galPart(partnumber) {
  return {
    id: "type-" + partnumber,
    name: "22V10",
    gal: "GAL22V10",
    partnumber,
    width: 6,
    height: 12,
    pins: [{ name: "I0", side: "left", position: 2, direction: "in" }],
  };
}

test("typeIdentity is the type id, divorced from the display name (FR-066e)", () => {
  assert.equal(typeIdentity(type74138()), "type-74138");
  assert.equal(typeIdentity(galPart("PC-DECODE-A")), "type-PC-DECODE-A");
});

test("addInstance records a GAL instance's type as its id (§7.2)", () => {
  const d = createDesign("t");
  const a = addInstance(d, galPart("PC-DECODE-A"), 0, 0, 0);
  const b = addInstance(d, galPart("PC-DECODE-B"), 5, 0, 0);
  assert.equal(a.type, "type-PC-DECODE-A");
  assert.equal(b.type, "type-PC-DECODE-B");
  // The part-number display name and device family are still reachable.
  assert.equal(a.typeData.partnumber, "PC-DECODE-A");
  assert.equal(a.typeData.name, "22V10");
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

test("addInstance records type id, position, rotation, empty overrides", () => {
  const d = createDesign("t");
  const inst = addInstance(d, type74138(), 10, 20, 90);
  assert.equal(inst.type, "type-74138");
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

// matchingGroups / groupBitWidth: the old exact-width group match, superseded in
// app code by the design-aware groupsAcceptingBus (FR-041c) but kept here as a
// reference check on the width arithmetic.
function groupBitWidth(type, group) {
  for (const name of group.pins) {
    if (!type.pins.some((p) => p.name === name)) {
      throw new Error(`group ${group.name}: unknown pin ${name}`);
    }
  }
  return group.pins.length;
}
function matchingGroups(type, busWidth) {
  return (type.pinGroups ?? []).filter((g) => groupBitWidth(type, g) === busWidth);
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

test("snapBusGroup claims the pack-low free block for a narrower bus (FR-041c)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0); // Y is a 4-pin group
  const bus = freeBus(d, 2);
  snapBusGroup(d, bus.id, bus.path[1].v, "U1", "Y");
  assert.deepEqual(bus.groupConnections[0].bitMap, ["Y0", "Y1"]);
  assert.deepEqual(bus.bitNames, ["Y0", "Y1"]);
});

test("two narrower buses pack into disjoint blocks of one group (FR-041c)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0);
  const b1 = freeBus(d, 2);
  snapBusGroup(d, b1.id, b1.path[1].v, "U1", "Y");
  const b2 = freeBus(d, 2);
  snapBusGroup(d, b2.id, b2.path[1].v, "U1", "Y");
  assert.deepEqual(b1.groupConnections[0].bitMap, ["Y0", "Y1"]);
  assert.deepEqual(b2.groupConnections[0].bitMap, ["Y2", "Y3"]);
});

test("snapBusGroup throws when no free block of the bus width remains (FR-041c/043)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0);
  const b1 = freeBus(d, 2);
  snapBusGroup(d, b1.id, b1.path[1].v, "U1", "Y"); // claims Y0,Y1
  const b2 = freeBus(d, 4); // needs 4 contiguous free; only Y2,Y3 remain
  assert.throws(() => snapBusGroup(d, b2.id, b2.path[1].v, "U1", "Y"));
});

test("groupFreeBlock: pack-low, whole run for width=null, null when full (FR-041c)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0);
  const g = d.components[0].typeData.pinGroups.find((x) => x.name === "Y");
  assert.deepEqual(groupFreeBlock(d, "U1", g, 2), ["Y0", "Y1"]);
  assert.deepEqual(groupFreeBlock(d, "U1", g, null), ["Y0", "Y1", "Y2", "Y3"]);
  const b = freeBus(d, 2);
  snapBusGroup(d, b.id, b.path[1].v, "U1", "Y"); // claims Y0,Y1
  assert.deepEqual(groupFreeBlock(d, "U1", g, 2), ["Y2", "Y3"]);
  assert.equal(groupFreeBlock(d, "U1", g, 4), null);
  assert.deepEqual(groupFreeBlock(d, "U1", g, null), ["Y2", "Y3"]);
});

test("groupsAcceptingBus lists fitting groups with their pack-low blocks (FR-041)", () => {
  const d = createDesign("t");
  addInstance(d, typeALU(), 10, 20, 0);
  assert.deepEqual(
    groupsAcceptingBus(d, d.components[0], 2).map((x) => [x.group.name, x.block]),
    [
      ["A", ["A0", "A1"]],
      ["B", ["B0", "B1"]],
      ["Y", ["Y0", "Y1"]],
    ],
  );
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

test("breakoutBit threads route bends into the wire path (FR-043b)", () => {
  const d = createDesign("t");
  addInstance(d, type74138Grp(), 40, 20, 0); // U1 (has pin A0)
  const bus = freeBus(d, 4);
  const bends = [
    { x: 6, y: 8 },
    { x: 6, y: 10 },
  ];
  const wire = breakoutBit(
    d,
    bus.id,
    0,
    4,
    0,
    1,
    { kind: "pin", refdes: "U1", pin: "A0" },
    bends,
  );

  // path is junction-node, the two bends in order, then the pin node
  assert.equal(wire.path.length, 4);
  assert.deepEqual(
    wire.path.slice(1, 3).map((p) => ({ t: p.t, x: p.x, y: p.y })),
    bends.map((p) => ({ t: "bend", ...p })),
  );
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

// A text note (FR-071f) is keyed from the internal N-<n> series — neither a U-
// nor an A-number — and starts with empty text. Placing other built-ins/ICs
// alongside it does not perturb that numbering.
test("addInstance keys a note from the N-series with empty text (FR-071f/FR-011a)", () => {
  const d = createDesign("t");
  addInstance(d, type74138(), 0, 0, 0); // U1
  const n1 = addInstance(d, typeNote(), 2, 2, 0);
  const n2 = addInstance(d, typeNote(), 4, 4, 0);
  assert.equal(n1.refdes, "N-1");
  assert.equal(n2.refdes, "N-2");
  assert.equal(n1.text, "");
  // The note consumes no U- or A-number: the next IC is still U2.
  assert.equal(addInstance(d, type74138(), 6, 6, 0).refdes, "U2");
});

// noteSize auto-sizes to whole grid units (FR-071f): the empty-note minimum, and
// growth driven by the longest line (width) and line count (height).
test("noteSize returns the minimum for empty text and grows with content (FR-071f)", () => {
  const min = noteSize("");
  assert.deepEqual(min, { width: 4, height: 2 });
  // A single short line stays at the minimum; both dims are whole integers.
  const oneLine = noteSize("hi");
  assert.ok(Number.isInteger(oneLine.width) && Number.isInteger(oneLine.height));
  // More lines make it taller; a long line makes it wider than the minimum.
  assert.ok(noteSize("a\nb\nc\nd").height > min.height);
  assert.ok(noteSize("a very long single line of note text").width > min.width);
});
