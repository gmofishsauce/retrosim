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
