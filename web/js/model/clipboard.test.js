import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createDesign,
  addInstance,
  addWire,
  addBus,
  snapBusGroup,
  getVertex,
} from "./design.js";
import { extractFragment, interiorConductors, pasteFragment } from "./clipboard.js";

function ty() {
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

function grpTy() {
  return {
    name: "grp",
    width: 4,
    height: 6,
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "A1", side: "left", position: 2, direction: "in" },
    ],
    pinGroups: [{ name: "A", pins: ["A0", "A1"] }],
  };
}

test("copy two wired components and paste with fresh refdes/ids, offset (FR-111/112)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 0); // U1
  addInstance(d, ty(), 10, 0, 0); // U2
  const w = addWire(
    d,
    { kind: "pin", refdes: "U1", pin: "/Y0" },
    { kind: "pin", refdes: "U2", pin: "A0" },
    [{ x: 5, y: 3 }],
  );

  const frag = extractFragment(d, ["U1", "U2"]);
  assert.equal(frag.components.length, 2);
  assert.equal(frag.wires.length, 1);

  const created = pasteFragment(d, frag, 100, 100);
  assert.deepEqual(
    created.components.map((c) => c.refdes),
    ["U3", "U4"],
  );

  const u3 = d.components.find((c) => c.refdes === "U3");
  assert.deepEqual({ x: u3.x, y: u3.y }, { x: 100, y: 100 });

  const nw = created.wires[0];
  assert.notEqual(nw.id, w.id);
  // source/destination pin vertices re-anchored to the pasted components
  assert.equal(getVertex(d, nw.path[0].v).ref, "U3");
  assert.equal(getVertex(d, nw.path[nw.path.length - 1].v).ref, "U4");
  // bend translated by the paste offset
  assert.deepEqual(nw.path[1], { t: "bend", x: 105, y: 103 });

  assert.equal(d.components.length, 4);
  assert.equal(d.wires.length, 2);
});

test("a conductor touching a non-copied component is excluded (FR-111/FR-018c)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 0); // U1
  addInstance(d, ty(), 10, 0, 0); // U2
  addInstance(d, ty(), 20, 0, 0); // U3
  addWire(d, { kind: "pin", refdes: "U1", pin: "/Y0" }, { kind: "pin", refdes: "U2", pin: "A0" });
  addWire(d, { kind: "pin", refdes: "U2", pin: "/Y0" }, { kind: "pin", refdes: "U3", pin: "A0" });

  const { wires } = interiorConductors(d, new Set(["U1", "U2"]));
  assert.equal(wires.length, 1); // only the U1↔U2 wire; U2↔U3 reaches outside

  const frag = extractFragment(d, ["U1", "U2"]);
  assert.equal(frag.wires.length, 1);
});

test("copying any subunit copies the whole package; paste takes one new U-number (FR-018b/FR-011)", () => {
  const d = createDesign("t");
  const sub = (refdes) => ({
    refdes,
    type: "7400",
    x: 0,
    y: 0,
    rotation: 0,
    typeData: { renderType: "subunit", pins: [] },
    overrides: {},
  });
  d.components.push(sub("U5A"), sub("U5B"));

  const frag = extractFragment(d, ["U5A"]); // select one subunit
  assert.deepEqual(
    frag.components.map((c) => c.refdes),
    ["U5A", "U5B"],
  );

  const created = pasteFragment(d, frag, 0, 0);
  assert.deepEqual(
    created.components.map((c) => c.refdes),
    ["U6A", "U6B"],
  );
});

test("a group-snapped bus is carried, with instance/vertex remapped (FR-112/FR-042)", () => {
  const d = createDesign("t");
  addInstance(d, grpTy(), 0, 0, 0); // U1
  addInstance(d, grpTy(), 20, 0, 0); // U2
  const bus = addBus(d, { kind: "free", x: 1, y: 1 }, { kind: "free", x: 19, y: 1 }, 2);
  snapBusGroup(d, bus.id, bus.path[0].v, "U1", "A");
  snapBusGroup(d, bus.id, bus.path[bus.path.length - 1].v, "U2", "A");

  const frag = extractFragment(d, ["U1", "U2"]);
  assert.equal(frag.buses.length, 1);

  const created = pasteFragment(d, frag, 50, 0);
  const nb = created.buses[0];
  assert.deepEqual(
    nb.groupConnections.map((gc) => gc.instance).sort(),
    ["U3", "U4"],
  );
  for (const gc of nb.groupConnections) assert.ok(getVertex(d, gc.vertex));
  assert.deepEqual(nb.bitNames, ["A0", "A1"]);
});

test("pasted port re-anchors a default label but keeps a custom one (FR-112)", () => {
  const portTy = {
    name: "port",
    builtin: true,
    renderType: "port",
    width: 2,
    height: 2,
    pins: [{ name: "P", side: "right", position: 1, direction: "in" }],
  };

  const d = createDesign("t");
  addInstance(d, portTy, 0, 0, 0); // A-1, label defaults to "A-1"
  const defaulted = pasteFragment(d, extractFragment(d, ["A-1"]), 5, 5);
  assert.equal(defaulted.components[0].refdes, "A-2");
  assert.equal(defaulted.components[0].label, "A-2");

  const d2 = createDesign("t");
  const p = addInstance(d2, portTy, 0, 0, 0); // A-1
  p.label = "CLK";
  const custom = pasteFragment(d2, extractFragment(d2, ["A-1"]), 5, 5);
  assert.equal(custom.components[0].refdes, "A-2");
  assert.equal(custom.components[0].label, "CLK");
});

test("pasteFragment does not mutate the source fragment (re-pasteable)", () => {
  const d = createDesign("t");
  addInstance(d, ty(), 0, 0, 0); // U1
  addInstance(d, ty(), 10, 0, 0); // U2
  const frag = extractFragment(d, ["U1", "U2"]);

  pasteFragment(d, frag, 10, 10); // U3, U4
  const second = pasteFragment(d, frag, 20, 20); // U5, U6
  assert.deepEqual(
    second.components.map((c) => c.refdes),
    ["U5", "U6"],
  );
  // the stored fragment is untouched: original designators and coordinates
  assert.deepEqual(
    frag.components.map((c) => c.refdes),
    ["U1", "U2"],
  );
  assert.equal(frag.components[0].x, 0);
});

// --- RAM save-file derivation on paste (FR-114h) ---

function ramTy(ramFile, ramLoad = true) {
  return {
    name: "RAM 256×8",
    width: 4,
    height: 8,
    pins: [
      { name: "A0", side: "left", position: 1, direction: "in" },
      { name: "D0", side: "right", position: 1, direction: "bidir" },
    ],
    mem: { kind: "ram", addressBits: 8, dataWidth: 8, locations: 256, ramFile, ramLoad },
  };
}

function ramFileOfRefdes(design, refdes) {
  return design.components.find((c) => c.refdes === refdes).typeData.mem.ramFile;
}

test("a pasted RAM gets its own save file, derived from its new refdes (FR-114h)", () => {
  const d = createDesign("t");
  addInstance(d, ramTy("/proj/regram.bin"), 0, 0, 0); // U1, itself derived at placement

  const res = pasteFragment(d, extractFragment(d, ["U1"]), 10, 10); // U2
  assert.equal(res.components[0].refdes, "U2");
  assert.equal(ramFileOfRefdes(d, "U2"), "/proj/regram-U2.bin");
  // the source is untouched, and load-on-start rides along
  assert.equal(ramFileOfRefdes(d, "U1"), "/proj/regram-U1.bin");
  assert.equal(d.components[1].typeData.mem.ramLoad, true);
  // the rewrite is reported to the caller
  assert.deepEqual(res.ramFiles, [
    { refdes: "U2", from: "/proj/regram-U1.bin", to: "/proj/regram-U2.bin" },
  ]);
});

test("a copy of a copy replaces the designator suffix instead of compounding (FR-114h)", () => {
  const d = createDesign("t");
  addInstance(d, ramTy("/proj/regram.bin"), 0, 0, 0); // U1
  pasteFragment(d, extractFragment(d, ["U1"]), 10, 10); // U2 → regram-U2.bin
  pasteFragment(d, extractFragment(d, ["U2"]), 20, 20); // U3, copied from U2

  assert.equal(ramFileOfRefdes(d, "U3"), "/proj/regram-U3.bin");
});

test("pasting several RAMs at once gives each a distinct save file (FR-114h)", () => {
  const d = createDesign("t");
  addInstance(d, ramTy("/proj/regram.bin"), 0, 0, 0); // U1
  addInstance(d, ramTy("/proj/regram.bin"), 10, 0, 0); // U2 — the parallel pair

  // Placement already gave U1/U2 their own files; the paste gives U3/U4 theirs.
  const res = pasteFragment(d, extractFragment(d, ["U1", "U2"]), 0, 20); // U3, U4
  assert.deepEqual(
    res.ramFiles.map((r) => r.to),
    ["/proj/regram-U3.bin", "/proj/regram-U4.bin"],
  );
});

test("a derived name already taken by another RAM takes a numeric suffix (FR-114h)", () => {
  const d = createDesign("t");
  addInstance(d, ramTy("/proj/regram.bin"), 0, 0, 0); // U1
  const squatter = addInstance(d, ramTy("/other.bin"), 10, 0, 0); // U2
  squatter.typeData.mem.ramFile = "/proj/regram-U3.bin"; // e.g. a hand-edited design

  const res = pasteFragment(d, extractFragment(d, ["U1"]), 0, 20); // U3
  assert.equal(res.ramFiles[0].to, "/proj/regram-U3-2.bin");
});

test("paste leaves a ROM's content file alone (FR-114h/FR-114e)", () => {
  const d = createDesign("t");
  const rom = ramTy(undefined);
  rom.mem = { kind: "rom", addressBits: 8, dataWidth: 8, locations: 256, romFile: "/proj/cpurom.bin" };
  addInstance(d, rom, 0, 0, 0); // U1

  const res = pasteFragment(d, extractFragment(d, ["U1"]), 10, 10); // U2
  assert.equal(d.components[1].typeData.mem.romFile, "/proj/cpurom.bin");
  assert.deepEqual(res.ramFiles, []);
});
