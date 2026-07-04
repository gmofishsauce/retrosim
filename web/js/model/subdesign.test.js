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
  flatten,
  wouldCycle,
} from "./subdesign.js";
import { buildNets } from "./netlist.js";
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

test("resolveSubDesigns reports an interface change against the stored record (FR-099c)", async () => {
  const child = childWithPorts(); // CLK, D, Q
  const parent = createDesign("top");
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface: designInterface(child), childName: "c" },
    0,
    0,
  );
  // Same interface → no change reported.
  let res = await resolveSubDesigns(parent, async () => child);
  assert.deepEqual(res.changed, []);
  // Child gains a port → the instance is reported and the record refreshed.
  const extra = addInstance(child, PORT, 0, 40, 0);
  extra.label = "EN";
  res = await resolveSubDesigns(parent, async () => child);
  assert.deepEqual(res.changed, [x1.refdes]);
  assert.ok(x1.iface.some((s) => s.label === "EN"));
  // Re-resolving against the refreshed record is quiet again.
  res = await resolveSubDesigns(parent, async () => child);
  assert.deepEqual(res.changed, []);
});

test("a pre-FR-099c instance (no iface record) gains it silently on resolve", async () => {
  const child = childWithPorts();
  const parent = createDesign("top");
  const x1 = addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface: designInterface(child), childName: "c" },
    0,
    0,
  );
  delete x1.iface; // as loaded from an old file
  const res = await resolveSubDesigns(parent, async () => child);
  assert.deepEqual(res.changed, []); // unknown baseline: no reroute trigger
  assert.deepEqual(x1.iface, designInterface(child)); // record written for next save
});

test("serializeDesign persists the iface record (FR-099c)", () => {
  const parent = createDesign("top");
  const iface = designInterface(childWithPorts());
  addSubDesignInstance(
    parent,
    { childPath: "c.json", render: "ic", iface, childName: "c" },
    0,
    0,
  );
  const sd = serializeDesign(parent).components[0];
  assert.deepEqual(sd.iface, iface);
  assert.equal(sd.typeData, undefined); // still stripped (FR-098)
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

// --- flatten (FR-102/FR-102a/FR-103, §6.14) ---

// A one-input unit type, the sink inside flattened children.
const IN1 = {
  name: "IN1",
  renderType: "unit",
  pins: [{ name: "A", side: "left", position: 1, direction: "in" }],
};

// A child whose port CLK feeds a unit input — the minimal 1-wide stitch case.
function childClk() {
  const d = createDesign("clkchild");
  const p = addInstance(d, PORT, 0, 0, 0);
  p.label = "CLK";
  const u = addInstance(d, IN1, 5, 0, 0);
  addWire(
    d,
    { kind: "pin", refdes: p.refdes, pin: "P" },
    { kind: "pin", refdes: u.refdes, pin: "A" },
  );
  return d;
}

// A parent embedding `child` n times, each instance's CLK pin driven by its own
// switch. Returns the parent plus each instance's switch refdes.
function parentEmbedding(child, n) {
  const parent = createDesign("top");
  const iface = designInterface(child);
  const sws = [];
  for (let i = 0; i < n; i++) {
    const x = addSubDesignInstance(
      parent,
      { childPath: "/lib/c.json", render: "ic", iface, childName: "c" },
      10 + i * 10,
      10,
    );
    const sw = addInstance(parent, SWITCH, 0, i * 5, 0);
    addWire(
      parent,
      { kind: "pin", refdes: sw.refdes, pin: "OUT" },
      { kind: "pin", refdes: x.refdes, pin: "CLK" },
    );
    sws.push(sw.refdes);
  }
  return { parent, sws };
}

test("flatten is an identity pass without sub-designs or targets (NFR-005)", async () => {
  const d = childClk(); // has ports but no sub-designs and no targets
  assert.equal(await flatten(d, async () => assert.fail("no load expected")), d);
});

test("flatten stitches a 1-wide port and prefixes refdes/ids/labels (FR-102)", async () => {
  const child = childClk();
  const { parent, sws } = parentEmbedding(child, 1);
  const flat = await flatten(parent, async () => child);
  assert.ok(!flat.components.some((c) => c.kind === "subdesign")); // X1 replaced
  assert.ok(flat.components.some((c) => c.refdes === "X1/U1"));
  // Copied ids are prefixed, so parent and child conductors/vertices never collide.
  const ids = [...flat.wires, ...flat.buses, ...flat.vertices].map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  const nets = buildNets(flat);
  const net = nets.find((n) => n.pins.includes(`${sws[0]}.OUT`));
  assert.ok(net.pins.includes("X1/U1.A")); // parent switch reaches the child's gate
  assert.equal(net.name, "X1/CLK"); // hierarchical net name (FR-102)
});

test("flatten shares root component objects and never mutates the root (FR-087b/§6.14)", async () => {
  const child = childClk();
  const { parent, sws } = parentEmbedding(child, 1);
  const before = JSON.stringify(parent);
  const flat = await flatten(parent, async () => child);
  // The switch object is shared, so live interactive state (a click during a
  // run) reaches the running sim's retained instance.
  const sw = parent.components.find((c) => c.refdes === sws[0]);
  assert.ok(flat.components.includes(sw));
  // Run is read-only with respect to the design: the root is untouched.
  assert.equal(JSON.stringify(parent), before);
  assert.ok(parent.components.some((c) => c.kind === "subdesign"));
});

test("flatten keeps same-label ports in different instances apart (FR-102/FR-101a)", async () => {
  const child = childClk();
  const { parent, sws } = parentEmbedding(child, 2);
  const flat = await flatten(parent, async () => child);
  const nets = buildNets(flat);
  const net1 = nets.find((n) => n.pins.includes(`${sws[0]}.OUT`));
  const net2 = nets.find((n) => n.pins.includes(`${sws[1]}.OUT`));
  assert.ok(net1.pins.includes("X1/U1.A") && !net1.pins.includes("X2/U1.A"));
  assert.ok(net2.pins.includes("X2/U1.A") && !net2.pins.includes("X1/U1.A"));
});

test("flatten stitches a portN through a parent bus group snap (FR-102)", async () => {
  const child = childWithPortN(4, "out"); // portN "b" ← U2's S0..S3
  const parent = createDesign("top");
  const iface = designInterface(child);
  const x = addSubDesignInstance(
    parent,
    { childPath: "/lib/w.json", render: "ic", iface, childName: "w" },
    10,
    10,
  );
  const SINK = {
    name: "SINK",
    renderType: "unit",
    pins: [0, 1, 2, 3].map((i) => ({ name: `T${i}`, side: "left", position: i + 1, direction: "in" })),
    pinGroups: [{ name: "T", pins: ["T0", "T1", "T2", "T3"] }],
  };
  const u = addInstance(parent, SINK, 0, 0, 0);
  parent.vertices.push({ id: "pv1", kind: "free", x: 0, y: 0 }, { id: "pv2", kind: "free", x: 1, y: 0 });
  parent.buses.push({
    id: "pb1",
    width: 4,
    path: [{ t: "node", v: "pv1" }, { t: "node", v: "pv2" }],
    groupConnections: [
      { vertex: "pv1", instance: u.refdes, group: "T", bitMap: ["T0", "T1", "T2", "T3"] },
      { vertex: "pv2", instance: x.refdes, group: "b", bitMap: ["b0", "b1", "b2", "b3"] },
    ],
  });
  const flat = await flatten(parent, async () => child);
  const nets = buildNets(flat);
  for (let k = 0; k < 4; k++) {
    const net = nets.find((n) => n.pins.includes(`${u.refdes}.T${k}`));
    assert.ok(net.pins.includes(`X1/U2.S${k}`), `bit ${k} reaches the child source`);
    assert.ok(net.pins.includes(`X1/A-4.P${k}`), `bit ${k} lands on the child portN pin`);
  }
});

test("flatten recurses with accumulated prefixes (FR-102 nesting)", async () => {
  const gc = childClk(); // port CLK → U1.A
  const mid = createDesign("mid");
  const m = addInstance(mid, PORT, 0, 0, 0);
  m.label = "M";
  const xg = addSubDesignInstance(
    mid,
    { childPath: "/lib/gc.json", render: "ic", iface: designInterface(gc), childName: "gc" },
    10,
    0,
  );
  addWire(mid, { kind: "pin", refdes: m.refdes, pin: "P" }, { kind: "pin", refdes: xg.refdes, pin: "CLK" });
  const parent = createDesign("top");
  const xm = addSubDesignInstance(
    parent,
    { childPath: "/lib/mid.json", render: "ic", iface: designInterface(mid), childName: "mid" },
    10,
    10,
  );
  const sw = addInstance(parent, SWITCH, 0, 0, 0);
  addWire(parent, { kind: "pin", refdes: sw.refdes, pin: "OUT" }, { kind: "pin", refdes: xm.refdes, pin: "M" });
  const files = { "/lib/mid.json": mid, "/lib/gc.json": gc };
  const flat = await flatten(parent, async (p) => files[p]);
  assert.ok(flat.components.some((c) => c.refdes === "X1/X1/U1")); // two-level prefix
  const nets = buildNets(flat);
  const net = nets.find((n) => n.pins.includes(`${sw.refdes}.OUT`));
  assert.ok(net.pins.includes("X1/X1/U1.A")); // stitched through both levels
});

test("flatten refuses an embedding cycle (FR-102a)", async () => {
  const A = {
    name: "a",
    formatVersion: 2,
    components: [{ refdes: "X1", kind: "subdesign", type: "b", childPath: "b.json", x: 0, y: 0, rotation: 0 }],
    wires: [],
    buses: [],
    vertices: [],
  };
  const B = { ...structuredClone(A), name: "b" };
  B.components[0].childPath = "a.json";
  const files = { "/d/a.json": A, "/d/b.json": B };
  const load = async (p) => {
    if (!files[p]) throw new Error("missing " + p);
    return structuredClone(files[p]);
  };
  const root = deserializeDesign(structuredClone(A));
  await assert.rejects(flatten(root, load, { rootPath: "/d/a.json" }), /embedding cycle/);
});

test("flatten joins off-sheet peers by declared links; mutual peering legal (FR-103/FR-102a)", async () => {
  const root = createDesign("main");
  const tx = addInstance(root, PORT, 0, 0, 0);
  tx.label = "TX";
  tx.target = { file: "peer.json", label: "RX" };
  const sw = addInstance(root, SWITCH, 0, 5, 0);
  addWire(root, { kind: "pin", refdes: sw.refdes, pin: "OUT" }, { kind: "pin", refdes: tx.refdes, pin: "P" });

  const peer = createDesign("peer");
  const rx = addInstance(peer, PORT, 0, 0, 0);
  rx.label = "RX";
  rx.target = { file: "main.json", label: "TX" }; // mutual link back — must not recurse
  const u = addInstance(peer, IN1, 5, 0, 0);
  addWire(peer, { kind: "pin", refdes: rx.refdes, pin: "P" }, { kind: "pin", refdes: u.refdes, pin: "A" });

  let loads = 0;
  const flat = await flatten(
    root,
    async (p) => {
      loads++;
      assert.equal(p, "/d/peer.json");
      return peer;
    },
    { rootPath: "/d/main.json" },
  );
  assert.equal(loads, 1); // peer loaded once; the mutual link de-dups (FR-102a)
  assert.ok(flat.components.some((c) => c.refdes === "peer/U1")); // per-sheet tag (FR-103)
  const nets = buildNets(flat);
  const net = nets.find((n) => n.pins.includes(`${sw.refdes}.OUT`));
  assert.ok(net.pins.includes("peer/U1.A")); // one net across the sheets (FR-101a)
});

test("flatten reports a target whose peer lacks the labeled port (FR-103)", async () => {
  const root = createDesign("main");
  const tx = addInstance(root, PORT, 0, 0, 0);
  tx.label = "TX";
  tx.target = { file: "peer.json", label: "NOPE" };
  const peer = createDesign("peer"); // no ports at all
  await assert.rejects(
    flatten(root, async () => peer, { rootPath: "/d/main.json" }),
    /no port labeled NOPE/,
  );
});

test("wouldCycle walks transitive embeds (FR-097a/FR-102a)", async () => {
  const files = {
    "/d/b.json": { components: [{ kind: "subdesign", childPath: "c.json" }] },
    "/d/c.json": { components: [{ kind: "subdesign", childPath: "a.json" }] },
  };
  const load = async (p) => {
    if (!files[p]) throw new Error("missing " + p);
    return files[p];
  };
  assert.equal(await wouldCycle("/d/b.json", "/d/a.json", load), true); // b → c → a
  assert.equal(await wouldCycle("/d/b.json", "/d/z.json", load), false); // broken tail ≠ cycle
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
