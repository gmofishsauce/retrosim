import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  addBus,
} from "./design.js";
import { serializeDesign, deserializeDesign, migrate } from "./persist.js";

function ty() {
  return {
    name: "T",
    width: 6,
    height: 12,
    pins: [
      { name: "A0", side: "left", position: 2, direction: "in" },
      { name: "/Y0", side: "right", position: 2, direction: "out" },
    ],
  };
}

function sampleDesign() {
  const d = createDesign("my schematic");
  addInstance(d, ty(), 10, 20, 0);
  addInstance(d, ty(), 40, 20, 0);
  addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
  );
  addBus(d, { kind: "free", x: 0, y: 0 }, { kind: "free", x: 10, y: 0 }, 8);
  return d;
}

test("serializeDesign emits the documented shape with derived nets", () => {
  const out = serializeDesign(sampleDesign());
  assert.equal(out.formatVersion, 3);
  assert.equal(out.name, "my schematic");
  assert.ok(Array.isArray(out.components));
  assert.ok(Array.isArray(out.wires));
  assert.ok(Array.isArray(out.buses));
  assert.ok(Array.isArray(out.vertices));
  assert.ok(Array.isArray(out.nets)); // derived (FR-059a)
  assert.equal(out.nets.length, 1); // the U1./Y0 - U2.A0 net
});

test("serialize -> JSON -> deserialize round-trips the collections", () => {
  const d = sampleDesign();
  const json = JSON.parse(JSON.stringify(serializeDesign(d)));
  const d2 = deserializeDesign(json);

  assert.equal(d2.name, d.name);
  assert.deepEqual(d2.components, d.components);
  assert.deepEqual(d2.wires, d.wires);
  assert.deepEqual(d2.buses, d.buses);
  assert.deepEqual(d2.vertices, d.vertices);
});

test("deserializeDesign rebuilds id counters past the loaded ids", () => {
  const d = sampleDesign();
  const json = JSON.parse(JSON.stringify(serializeDesign(d)));
  const d2 = deserializeDesign(json);

  assert.equal(d2.nextWireId, d.nextWireId);
  assert.equal(d2.nextBusId, d.nextBusId);
  assert.equal(d2.nextVertexId, d.nextVertexId);

  // A new wire gets a fresh, non-colliding id.
  const w = addWire(
    d2,
    { kind: "free", x: 1, y: 1 },
    { kind: "free", x: 2, y: 2 },
  );
  assert.equal(
    d2.wires.filter((x) => x.id === w.id).length,
    1,
  );
});

test("deserializeDesign tolerates a minimal/empty document", () => {
  const d = deserializeDesign({ formatVersion: 1, name: "empty" });
  assert.equal(d.name, "empty");
  assert.deepEqual(d.components, []);
  assert.equal(d.nextVertexId, 1);
});

// --- format-version migration (§7.4). The chain is empty while only version 1
// exists, so these exercise it with injected migrations and target version. ---

test("migrate upgrades an older file through the whole migration chain", () => {
  const migrations = {
    1: (o) => ({ ...o, addedInV2: true }),
    2: (o) => ({ ...o, addedInV3: true }),
  };
  const out = migrate({ formatVersion: 1, name: "old" }, { target: 3, migrations });
  assert.equal(out.formatVersion, 3); // stamped up to the target
  assert.equal(out.addedInV2, true);
  assert.equal(out.addedInV3, true);
  assert.equal(out.name, "old"); // untouched fields carry through
});

test("migrate treats a missing formatVersion as version 1", () => {
  const migrations = { 1: (o) => ({ ...o, migrated: true }) };
  const out = migrate({ name: "legacy" }, { target: 2, migrations });
  assert.equal(out.formatVersion, 2);
  assert.equal(out.migrated, true);
});

test("migrate rejects a file when an upgrade step is missing", () => {
  assert.throws(
    () => migrate({ formatVersion: 1, name: "x" }, { target: 2, migrations: {} }),
    /no migration from save-format version 1 to 2/,
  );
});

test("migrate leaves a current-or-newer file unchanged (forward-compat)", () => {
  // Default target is FORMAT_VERSION (3): a current file is a no-op.
  assert.equal(migrate({ formatVersion: 3, name: "x" }).formatVersion, 3);
  // A newer-than-understood file passes through untouched (the load flow warns).
  assert.equal(migrate({ formatVersion: 99, name: "y" }).formatVersion, 99);
});

// The real 1→2 step (FR-066e) re-keys each instance's `type` to the type id,
// derived from its own typeData, and stamps typeData.id. Sub-designs are left
// alone, and the refdes (identity) is untouched.
test("migrate 1→2 re-keys instance type to the type id", () => {
  const out = migrate({
    formatVersion: 1,
    name: "old",
    components: [
      { refdes: "U1", type: "74138", typeData: { name: "74138" } },
      { refdes: "A-1", type: "indicator", typeData: { name: "indicator" } },
      { refdes: "U2", type: "22V574", typeData: { name: "22V10", partnumber: "22V574" } },
      { refdes: "X1", type: "child", kind: "subdesign", childPath: "c.json" },
    ],
  });
  assert.equal(out.formatVersion, 3); // the chain continues through 2→3
  const [ic, ind, gal, sub] = out.components;
  assert.equal(ic.type, "type-74138");
  assert.equal(ic.typeData.id, "type-74138");
  assert.equal(ic.refdes, "U1"); // identity untouched
  assert.equal(ind.type, "type-indicator");
  assert.equal(gal.type, "type-22V574"); // GAL keys by part number
  assert.equal(sub.type, "child"); // sub-design path-derived type unchanged
});

// --- FR-121g data-path conversion (§6.19): absolute in memory, relative on
// disk iff inside the project. ---

import { relativizeDataPaths, absolutizeDataPaths, relPath, resolveRel } from "./persist.js";

// A minimal serialized-design shape carrying one mem component.
function memDesign(mem) {
  return {
    components: [
      { refdes: "U1", typeData: { name: "RAM1", mem } },
      { refdes: "U2", typeData: { name: "7400" } }, // non-mem: untouched
    ],
  };
}

test("relativizeDataPaths makes in-project absolute mem paths design-dir-relative", () => {
  const live = memDesign({ kind: "ram", romFile: "/proj/rom.hex", ramFile: "/proj/ram.bin" });
  const out = relativizeDataPaths(live, "/proj", "/proj");
  const mem = out.components[0].typeData.mem;
  assert.equal(mem.romFile, "rom.hex");
  assert.equal(mem.ramFile, "ram.bin");
});

test("relativizeDataPaths leaves outside-project paths absolute (FR-121d)", () => {
  const out = relativizeDataPaths(
    memDesign({ kind: "rom", romFile: "/elsewhere/rom.bin" }),
    "/proj",
    "/proj",
  );
  assert.equal(out.components[0].typeData.mem.romFile, "/elsewhere/rom.bin");
});

test("relativizeDataPaths is copy-on-write: the live objects are untouched", () => {
  const liveComp = { refdes: "U1", typeData: { mem: { romFile: "/proj/rom.hex" } } };
  const serialized = { components: [liveComp] };
  const out = relativizeDataPaths(serialized, "/proj", "/proj");
  assert.equal(liveComp.typeData.mem.romFile, "/proj/rom.hex"); // live model keeps absolute
  assert.equal(out.components[0].typeData.mem.romFile, "rom.hex");
  assert.notEqual(out.components[0], liveComp);
});

test("relativizeDataPaths ignores already-relative and empty paths", () => {
  const out = relativizeDataPaths(
    memDesign({ kind: "ram", romFile: "rom.hex", ramFile: "" }),
    "/proj",
    "/proj",
  );
  assert.equal(out.components[0].typeData.mem.romFile, "rom.hex");
  assert.equal(out.components[0].typeData.mem.ramFile, "");
});

test("absolutizeDataPaths resolves relative mem paths against the design dir", () => {
  const d = memDesign({ kind: "ram", romFile: "rom.hex", ramFile: "sub/../ram.bin" });
  absolutizeDataPaths(d, "/proj");
  assert.equal(d.components[0].typeData.mem.romFile, "/proj/rom.hex");
  assert.equal(d.components[0].typeData.mem.ramFile, "/proj/ram.bin");
});

test("absolutizeDataPaths leaves absolute paths as-is (legacy in-project too)", () => {
  const d = memDesign({ kind: "rom", romFile: "/proj/rom.hex" });
  absolutizeDataPaths(d, "/proj");
  assert.equal(d.components[0].typeData.mem.romFile, "/proj/rom.hex");
});

test("data paths round-trip: relativize then absolutize is identity", () => {
  const abs = { kind: "ram", romFile: "/proj/data/rom.hex", ramFile: "/other/ram.bin" };
  const out = relativizeDataPaths(memDesign({ ...abs }), "/proj", "/proj");
  absolutizeDataPaths(out, "/proj");
  assert.deepEqual(out.components[0].typeData.mem, abs);
});

test("a legacy absolute in-project path comes back relative after one save cycle (FR-121g)", () => {
  // Load: absolute in-project path is kept (absolutize is a no-op on it).
  const loaded = memDesign({ kind: "rom", romFile: "/proj/rom.hex" });
  absolutizeDataPaths(loaded, "/proj");
  // Next save: relativization is unconditional, so it becomes relative.
  const saved = relativizeDataPaths(loaded, "/proj", "/proj");
  assert.equal(saved.components[0].typeData.mem.romFile, "rom.hex");
});

test("relPath/resolveRel handle nested and sibling directories", () => {
  assert.equal(relPath("/proj", "/proj/data/rom.hex"), "data/rom.hex");
  assert.equal(relPath("/proj/designs", "/proj/lib/c.json"), "../lib/c.json");
  assert.equal(resolveRel("/proj/designs", "../lib/c.json"), "/proj/lib/c.json");
});

// --- load-time referential-integrity repair (§7.4, FR-060d): unresolvable
// elements are dropped with one onWarn message each, and the rest loads. ---

// corruptible returns a serialized sampleDesign ready to mutate: components
// U1/U2, one wire U1./Y0 - U2.A0 (two pin vertices), one 8-bit bus between
// two free vertices.
function corruptible() {
  return JSON.parse(JSON.stringify(serializeDesign(sampleDesign())));
}

function loadCollecting(obj) {
  const warns = [];
  const d = deserializeDesign(obj, { onWarn: (m) => warns.push(m) });
  return { d, warns };
}

test("repair: a clean design loads with no warnings", () => {
  const { d, warns } = loadCollecting(corruptible());
  assert.deepEqual(warns, []);
  assert.equal(d.wires.length, 1);
  assert.equal(d.buses.length, 1);
});

test("repair: a pin vertex on a missing component drops with its wire", () => {
  const obj = corruptible();
  obj.components = obj.components.filter((c) => c.refdes !== "U2");
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 2); // the vertex, then the wire referencing it
  assert.match(warns[0], /missing component U2/);
  assert.match(warns[1], /^dropped wire /);
  assert.equal(d.wires.length, 0);
  assert.ok(!d.vertices.some((v) => v.ref === "U2"));
  assert.equal(d.buses.length, 1); // untouched
});

test("repair: a pin vertex naming a nonexistent pin drops with its wire", () => {
  const obj = corruptible();
  const v = obj.vertices.find((x) => x.kind === "pin" && x.ref === "U2");
  v.pin = "NOPE";
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 2);
  assert.match(warns[0], /missing pin U2\.NOPE/);
  assert.equal(d.wires.length, 0);
});

test("repair: a conductor with a short path is dropped whole", () => {
  const obj = corruptible();
  obj.wires[0].path = obj.wires[0].path.slice(0, 1);
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /at least 2 points/);
  assert.equal(d.wires.length, 0);
  assert.equal(d.vertices.length, obj.vertices.length); // vertices retained
});

test("repair: a conductor path node naming a missing vertex is dropped whole", () => {
  const obj = corruptible();
  obj.wires[0].path[1] = { t: "node", v: "v999" };
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /missing vertex v999/);
  assert.equal(d.wires.length, 0);
});

test("repair: a group connection naming a missing instance drops; the bus remains", () => {
  const obj = corruptible();
  const bus = obj.buses[0];
  bus.groupConnections = [
    { vertex: bus.path[0].v, instance: "U9", group: "G", bitMap: ["A0"] },
  ];
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /missing component U9/);
  assert.equal(d.buses.length, 1);
  assert.deepEqual(d.buses[0].groupConnections, []);
});

test("repair: a group connection naming a missing vertex drops", () => {
  const obj = corruptible();
  obj.buses[0].groupConnections = [
    { vertex: "v999", instance: "U1", group: "G", bitMap: ["A0"] },
  ];
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /missing vertex v999/);
  assert.deepEqual(d.buses[0].groupConnections, []);
});

test("repair: a group connection with a stale bitMap pin drops (the U28 case)", () => {
  const obj = corruptible();
  const bus = obj.buses[0];
  bus.groupConnections = [
    { vertex: bus.path[0].v, instance: "U1", group: "B", bitMap: ["A0", "B4"] },
  ];
  const { d, warns } = loadCollecting(obj);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /missing pin U1\.B4/);
  assert.equal(d.buses.length, 1); // the bus itself survives
  assert.deepEqual(d.buses[0].groupConnections, []);
});

// --- FR-011c: high-water refdes counters (save format v3, §7.4). ---

test("migrate 2→3 initializes refCounters from the file's current maxima", () => {
  const out = migrate({
    formatVersion: 2,
    name: "old",
    components: [
      { refdes: "U5A", type: "t" },
      { refdes: "U3", type: "t" },
      { refdes: "A-7", type: "t" },
      { refdes: "X2", type: "t", kind: "subdesign" },
    ],
  });
  assert.equal(out.formatVersion, 3);
  assert.deepEqual(out.refCounters, { U: 6, A: 8, N: 1, X: 3 }); // U5A counts as 5
});

test("serialize→deserialize round-trips refCounters, clamping a lagging value up", () => {
  const d = sampleDesign(); // U1, U2 placed → counter U:3
  assert.equal(d.refCounters.U, 3);
  d.refCounters.U = 40; // deletions may leave the counter far past the max
  const json = JSON.parse(JSON.stringify(serializeDesign(d)));
  assert.equal(json.refCounters.U, 40);
  const d2 = deserializeDesign(json);
  assert.equal(d2.refCounters.U, 40); // high-water survives the round trip

  json.refCounters.U = 1; // hand-edited lagging counter
  const d3 = deserializeDesign(json);
  assert.equal(d3.refCounters.U, 3); // clamped to 1 + current max (FR-011c)
});

// --- Primary clock persistence (FR-076b) ---

function tyClock() {
  return { id: "type-clock", name: "clock", builtin: true, renderType: "clock", width: 4, height: 4, pins: [] };
}

test("primaryClock round-trips through serialize/deserialize (FR-076b)", () => {
  const d = createDesign("t");
  addInstance(d, tyClock(), 0, 0, 0); // A-1
  d.primaryClock = "A-1";
  const obj = serializeDesign(d);
  assert.equal(obj.primaryClock, "A-1");
  const back = deserializeDesign(structuredClone(obj));
  assert.equal(back.primaryClock, "A-1");
});

test("absent primaryClock stays absent; a dangling one is dropped with a warning (FR-076b)", () => {
  const d = createDesign("t");
  const obj = serializeDesign(d);
  assert.ok(!("primaryClock" in obj));
  assert.equal(deserializeDesign(structuredClone(obj)).primaryClock, undefined);

  const bad = { ...serializeDesign(d), primaryClock: "A-9" };
  const warns = [];
  const back = deserializeDesign(structuredClone(bad), { onWarn: (m) => warns.push(m) });
  assert.equal(back.primaryClock, undefined);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /primary clock A-9/);
});
