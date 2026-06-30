import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, addWire, pinWorldPos } from "./design.js";
import {
  designInterface,
  synthTypeForInterface,
  addSubDesignInstance,
  resolveSubDesigns,
  portDirection,
  effectivePortDir,
} from "./subdesign.js";
import { serializeDesign, deserializeDesign } from "./persist.js";
import { BUILTINS, portNFields } from "../builtins.js";

const PORT = BUILTINS.find((b) => b.name === "port");
const SWITCH = BUILTINS.find((b) => b.name === "switch");

// A child with a multi-bit portN (label "b", given width) whose P pins are
// bus-snapped to a component's bit pins of direction `srcDir`. Built as plain
// save-shape data because a portN joins a net through a bus group-snap (not a
// drawn wire). Used to exercise the interface derivation (FR-071e/FR-095/FR-094c).
function childWithPortN(width, srcDir) {
  const bits = (p) => Array.from({ length: width }, (_, i) => p + i);
  return {
    name: "wide",
    components: [
      {
        refdes: "U2",
        typeData: {
          renderType: "unit",
          pins: bits("S").map((name) => ({ name, side: "right", direction: srcDir })),
        },
      },
      { refdes: "A-4", label: "b", width, typeData: { renderType: "portN", ...portNFields(width) } },
    ],
    buses: [
      {
        id: "b1",
        width,
        path: [{ t: "node", v: "v7" }, { t: "node", v: "v8" }],
        groupConnections: [
          { vertex: "v7", instance: "U2", group: "S", bitMap: bits("S") },
          { vertex: "v8", instance: "A-4", group: "P", bitMap: bits("P") },
        ],
      },
    ],
    wires: [],
    vertices: [{ id: "v7", kind: "free", x: 0, y: 0 }, { id: "v8", kind: "free", x: 1, y: 0 }],
  };
}

// A child design with three ports. Direction is derived from wiring (FR-094c):
// Q is driven by a switch output → "out"; CLK and D stay unwired → "in".
function childWithPorts() {
  const d = createDesign("counter");
  const byLabel = {};
  for (const label of ["CLK", "Q", "D"]) {
    const p = addInstance(d, PORT, 0, 0, 0);
    p.label = label;
    byLabel[label] = p;
  }
  const sw = addInstance(d, SWITCH, 0, 0, 0);
  addWire(
    d,
    { kind: "pin", refdes: sw.refdes, pin: "OUT" },
    { kind: "pin", refdes: byLabel.Q.refdes, pin: "P" },
  );
  return d;
}

// A unit type exposing one bidirectional pin, so a port wired to it derives
// "bidir" (FR-094c) — the only case the FR-094d override applies to.
const BIDIR = {
  name: "BID",
  renderType: "unit",
  pins: [{ name: "IO", side: "right", position: 1, direction: "bidir" }],
};

test("effectivePortDir applies the override only when derived is bidir (FR-094d)", () => {
  const d = createDesign("t");
  const u = addInstance(d, BIDIR, 10, 10, 0);
  const p = addInstance(d, PORT, 0, 0, 0);
  p.label = "BUS";
  addWire(
    d,
    { kind: "pin", refdes: u.refdes, pin: "IO" },
    { kind: "pin", refdes: p.refdes, pin: "P" },
  );

  assert.equal(portDirection(d, p.refdes), "bidir");
  assert.equal(effectivePortDir(d, p.refdes), "bidir"); // no override yet
  p.dirOverride = "out";
  assert.equal(effectivePortDir(d, p.refdes), "out"); // bidir → override wins

  // A definite (driven) derivation ignores any override.
  const sw = addInstance(d, SWITCH, 0, 0, 0);
  const q = addInstance(d, PORT, 0, 20, 0);
  q.label = "Q";
  addWire(
    d,
    { kind: "pin", refdes: sw.refdes, pin: "OUT" },
    { kind: "pin", refdes: q.refdes, pin: "P" },
  );
  q.dirOverride = "in";
  assert.equal(portDirection(d, q.refdes), "out");
  assert.equal(effectivePortDir(d, q.refdes), "out"); // override ignored for definite
});

test("designInterface applies a bidir port's override (FR-094d)", () => {
  const child = childWithPortN(8, "bidir");
  child.components.find((c) => c.refdes === "A-4").dirOverride = "out";
  assert.deepEqual(designInterface(child), [{ label: "b", dir: "out", width: 8 }]);
});

test("designInterface lists distinct ports, sorted by label (FR-095)", () => {
  const iface = designInterface(childWithPorts());
  assert.deepEqual(iface, [
    { label: "CLK", dir: "in", width: 1 },
    { label: "D", dir: "in", width: 1 },
    { label: "Q", dir: "out", width: 1 },
  ]);
});

test("designInterface dedupes repeated labels (first wins)", () => {
  const d = childWithPorts();
  const extra = addInstance(d, PORT, 0, 0, 0);
  extra.label = "CLK"; // a second CLK port elsewhere on the sheet
  const iface = designInterface(d);
  assert.equal(iface.filter((p) => p.label === "CLK").length, 1);
  assert.equal(iface.find((p) => p.label === "CLK").dir, "in"); // unwired CLK → in
});

test("designInterface ignores unlabeled ports and non-ports", () => {
  const d = createDesign("c");
  addInstance(d, PORT, 0, 0, 0); // default label = its refdes, still counts
  const blank = addInstance(d, PORT, 0, 0, 0);
  blank.label = "";
  addInstance(d, BUILTINS.find((b) => b.name === "clock"), 0, 0, 0); // not a port
  const iface = designInterface(d);
  assert.equal(iface.length, 1); // only the first (default-labeled) port
});

// Regression (FR-071e): a multi-bit portN must reach the embedded interface — the
// bug that started this was a wide port rendering nothing when embedded because
// designInterface admitted only renderType "port".
test("designInterface includes a portN as one width-N signal (FR-071e/FR-095)", () => {
  const iface = designInterface(childWithPortN(8, "bidir"));
  assert.deepEqual(iface, [{ label: "b", dir: "bidir", width: 8 }]);
});

// A multi-bit signal expands into N one-bit pins plus a pin group, so a bus snaps
// via the ordinary group machinery — pins are always one bit (FR-095/FR-099).
test("synthTypeForInterface expands a portN into a one-bit pin group (FR-095/FR-099)", () => {
  const iface = designInterface(childWithPortN(8, "bidir"));
  const td = synthTypeForInterface(iface, "ic", "wide");
  // Eight one-bit pins b0..b7, all on the left (bidir), contiguous in bit order.
  assert.deepEqual(
    td.pins.map((p) => p.name),
    Array.from({ length: 8 }, (_, i) => "b" + i),
  );
  assert.ok(td.pins.every((p) => p.side === "left" && p.direction === "bidir"));
  assert.deepEqual(td.pins.map((p) => p.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  // No pin carries a width attribute (a pin is one bit).
  assert.ok(td.pins.every((p) => !("width" in p)));
  // A pin group named for the label lets a matching bus snap to it (FR-041/FR-042).
  assert.deepEqual(td.pinGroups, [
    { name: "b", pins: Array.from({ length: 8 }, (_, i) => "b" + i) },
  ]);
});

// portN direction aggregates across its bit nets (FR-094c): the bus source's pin
// direction propagates to the whole group, and the bit count tracks the chosen N.
test("portN direction is derived & aggregated across bits (FR-094c)", () => {
  assert.deepEqual(designInterface(childWithPortN(4, "out")), [{ label: "b", dir: "out", width: 4 }]);
  assert.deepEqual(designInterface(childWithPortN(4, "in")), [{ label: "b", dir: "in", width: 4 }]);
  // An output-driven portN's bits land on the right edge of the embedded IC (FR-099).
  const td = synthTypeForInterface(designInterface(childWithPortN(4, "out")), "ic", "wide");
  assert.ok(td.pins.every((p) => p.side === "right"));
  assert.equal(td.pins.length, 4);
});

// A 1-wide port stays a single one-bit pin with no group and no width (FR-094).
test("synthTypeForInterface keeps 1-wide ports as one-bit pins (FR-094)", () => {
  const td = synthTypeForInterface(designInterface(childWithPorts()), "ic", "counter");
  assert.ok(td.pins.every((p) => !("width" in p)));
  assert.equal(td.pinGroups, undefined); // no bus groups for plain ports
});

test("synthTypeForInterface ic puts inputs left, outputs right (FR-099)", () => {
  const iface = designInterface(childWithPorts());
  const td = synthTypeForInterface(iface, "ic", "counter");
  const byName = Object.fromEntries(td.pins.map((p) => [p.name, p]));
  assert.equal(byName.CLK.side, "left");
  assert.equal(byName.D.side, "left");
  assert.equal(byName.Q.side, "right");
  assert.equal(td.height, 3); // max(2 left, 1 right) + 1
  assert.equal(td.renderType, "unit"); // renders via the generic rectangle path
});

test("synthTypeForInterface connector ranks all pins on one edge", () => {
  const iface = designInterface(childWithPorts());
  const td = synthTypeForInterface(iface, "connector");
  assert.ok(td.pins.every((p) => p.side === "right"));
  assert.deepEqual(
    td.pins.map((p) => p.position),
    [1, 2, 3],
  );
  assert.equal(td.height, iface.length + 1);
});

test("addSubDesignInstance creates an X-series live reference (FR-098/098a)", () => {
  const parent = createDesign("top");
  addInstance(parent, PORT, 0, 0, 0); // an A-series port, to prove series are separate
  const iface = designInterface(childWithPorts());
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "../lib/counter.json", render: "ic", iface, childName: "counter" },
    10,
    10,
  );
  const x2 = addSubDesignInstance(
    parent,
    { childPath: "../lib/counter.json", render: "connector", iface, childName: "counter" },
    30,
    10,
  );
  assert.equal(x1.refdes, "X1");
  assert.equal(x2.refdes, "X2"); // same child embedded twice, independent instances
  assert.equal(x1.kind, "subdesign");
  assert.equal(x1.childPath, "../lib/counter.json");
  assert.equal(x1.render, "ic");
  assert.equal(x1.typeData.pins.length, 3);

  // The synthetic typeData makes the standard pin machinery work, so wiring to
  // the embedded block needs no special code.
  const p = pinWorldPos(x1, "Q");
  assert.equal(typeof p.x, "number");
  assert.equal(typeof p.y, "number");
});

test("serializeDesign strips a sub-design's synthetic typeData (FR-098)", () => {
  const parent = createDesign("top");
  parent.defaultRender = "connector";
  const iface = designInterface(childWithPorts());
  addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface, childName: "counter" },
    5,
    5,
  );
  const obj = serializeDesign(parent);
  const sd = obj.components[0];
  assert.equal(sd.kind, "subdesign");
  assert.equal(sd.childPath, "c.json");
  assert.equal(sd.render, "ic");
  assert.equal(sd.typeData, undefined); // live reference, not a copy
  assert.equal(sd.overrides, undefined);
  assert.equal(obj.defaultRender, "connector"); // FR-096 round-trips
});

test("load round-trip: a sub-design re-resolves its interface (FR-098 loading)", async () => {
  const child = childWithPorts(); // CLK, D, Q
  const parent = createDesign("top");
  const iface = designInterface(child);
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface, childName: "counter" },
    5,
    5,
  );
  addWire(parent, { kind: "pin", refdes: x1.refdes, pin: "Q" }, { kind: "free", x: 20, y: 5 });

  // Save → load: deserialize must not choke on the missing typeData (validateStructure
  // skips sub-designs), then resolveSubDesigns fills it from the child.
  const loaded = deserializeDesign(JSON.parse(JSON.stringify(serializeDesign(parent))));
  // typeData was stripped on save; deserialize installs a wiring-derived
  // placeholder (only the wired pin Q) so the design is renderable before resolve.
  const before = loaded.components[0];
  assert.ok(before.typeData.pins.some((p) => p.name === "Q"));
  assert.ok(!before.typeData.pins.some((p) => p.name === "CLK")); // unwired: not in placeholder
  pinWorldPos(before, "Q"); // renderable without a crash (recovery path)

  await resolveSubDesigns(loaded, async () => child);
  const sd = loaded.components[0];
  assert.equal(sd.broken, undefined);
  assert.ok(sd.typeData.pins.some((p) => p.name === "CLK")); // refined to the full interface
  const p = pinWorldPos(sd, "Q");
  assert.equal(typeof p.x, "number");
});

test("resolveSubDesigns marks a missing child broken with a placeholder (FR-099a)", async () => {
  const parent = createDesign("top");
  const iface = [{ label: "Q", dir: "out", width: 1 }];
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "missing.json", render: "ic", iface, childName: "gone" },
    0,
    0,
  );
  addWire(parent, { kind: "pin", refdes: x1.refdes, pin: "Q" }, { kind: "free", x: 9, y: 0 });
  const msgs = [];
  await resolveSubDesigns(
    parent,
    async () => {
      throw new Error("nope");
    },
    (m) => msgs.push(m),
  );
  assert.equal(x1.broken, true);
  assert.ok(x1.typeData.pins.some((p) => p.name === "Q")); // keeps the wired pin
  assert.ok(msgs.some((m) => m.includes("cannot load")));
});

test("resolveSubDesigns leaves a vanished interface pin dangling (FR-099b)", async () => {
  const parent = createDesign("top");
  const ifaceOld = [
    { label: "OLD", dir: "in", width: 1 },
    { label: "Q", dir: "out", width: 1 },
  ];
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface: ifaceOld, childName: "c" },
    0,
    0,
  );
  addWire(parent, { kind: "pin", refdes: x1.refdes, pin: "OLD" }, { kind: "free", x: 9, y: 0 });
  const childNow = { components: [{ type: "port", label: "Q", portDir: "out", width: 1 }] };
  const msgs = [];
  await resolveSubDesigns(parent, async () => childNow, (m) => msgs.push(m));
  assert.ok(parent.vertices.every((v) => !(v.ref === x1.refdes && v.pin === "OLD")));
  assert.ok(parent.vertices.some((v) => v.kind === "free")); // OLD endpoint now dangling
  assert.ok(msgs.some((m) => m.includes("dangling")));
});
