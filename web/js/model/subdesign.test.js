import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesign, addInstance, addWire, pinWorldPos } from "./design.js";
import {
  designInterface,
  synthTypeForInterface,
  addSubDesignInstance,
  resolveSubDesigns,
} from "./subdesign.js";
import { serializeDesign, deserializeDesign } from "./persist.js";
import { BUILTINS } from "../builtins.js";

const PORT = BUILTINS.find((b) => b.name === "port");

// A child design with three ports: CLK (in), D (in), Q (out).
function childWithPorts() {
  const d = createDesign("counter");
  const ports = [
    ["CLK", "in"],
    ["Q", "out"],
    ["D", "in"],
  ];
  for (const [label, dir] of ports) {
    const p = addInstance(d, PORT, 0, 0, 0);
    p.label = label;
    p.portDir = dir;
  }
  return d;
}

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
  extra.portDir = "out";
  const iface = designInterface(d);
  assert.equal(iface.filter((p) => p.label === "CLK").length, 1);
  assert.equal(iface.find((p) => p.label === "CLK").dir, "in"); // first wins
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
