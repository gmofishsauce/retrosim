import { test } from "node:test";
import assert from "node:assert/strict";

import { gateInputCount, pinSlot, symbolFootprint, pinSlotOffset } from "./symbols.js";

function nandUnit() {
  return {
    renderAs: "nand",
    pins: [
      { name: "1A", side: "left", direction: "in" },
      { name: "1B", side: "left", direction: "in" },
      { name: "1Y", side: "right", direction: "out" },
    ],
  };
}

function mux4Unit() {
  return {
    renderAs: "mux4",
    pins: [
      { name: "I0", side: "left", direction: "in" },
      { name: "I1", side: "left", direction: "in" },
      { name: "I2", side: "left", direction: "in" },
      { name: "I3", side: "left", direction: "in" },
      { name: "S0", side: "top", direction: "in" },
      { name: "S1", side: "top", direction: "in" },
      { name: "Y", side: "right", direction: "out" },
    ],
  };
}

test("gateInputCount counts left inputs only (data, not selects)", () => {
  assert.equal(gateInputCount(nandUnit()), 2);
  assert.equal(gateInputCount(mux4Unit()), 4);
});

test("pinSlot assigns role + list-order slot per role", () => {
  const u = mux4Unit();
  assert.deepEqual(pinSlot(u, u.pins[0]), { role: "in", slot: 0 });
  assert.deepEqual(pinSlot(u, u.pins[3]), { role: "in", slot: 3 });
  assert.deepEqual(pinSlot(u, u.pins[4]), { role: "sel", slot: 0 });
  assert.deepEqual(pinSlot(u, u.pins[5]), { role: "sel", slot: 1 });
  assert.deepEqual(pinSlot(u, u.pins[6]), { role: "out", slot: 0 });
});

test("gate footprint includes an extra column for the inversion bubble", () => {
  assert.deepEqual(symbolFootprint("and", 2), { width: 4, height: 4 });
  assert.deepEqual(symbolFootprint("nand", 2), { width: 5, height: 4 });
  assert.deepEqual(symbolFootprint("not", 1), { width: 4, height: 2 });
});

test("mux footprint: width = selects+1, height = data+1", () => {
  assert.deepEqual(symbolFootprint("mux2", 2), { width: 2, height: 3 });
  assert.deepEqual(symbolFootprint("mux4", 4), { width: 3, height: 5 });
  assert.deepEqual(symbolFootprint("mux8", 8), { width: 4, height: 9 });
});

test("gate pin offsets are integer and place output centered between inputs", () => {
  assert.deepEqual(pinSlotOffset("nand", 2, "in", 0), { x: 0, y: 1 });
  assert.deepEqual(pinSlotOffset("nand", 2, "in", 1), { x: 0, y: 3 });
  assert.deepEqual(pinSlotOffset("nand", 2, "out", 0), { x: 5, y: 2 });
  assert.deepEqual(pinSlotOffset("and", 2, "out", 0), { x: 4, y: 2 });
});

test("mux pin offsets: data on left, selects on top row, output on right", () => {
  assert.deepEqual(pinSlotOffset("mux4", 4, "in", 0), { x: 0, y: 1 });
  assert.deepEqual(pinSlotOffset("mux4", 4, "in", 3), { x: 0, y: 4 });
  assert.deepEqual(pinSlotOffset("mux4", 4, "sel", 0), { x: 1, y: 0 });
  assert.deepEqual(pinSlotOffset("mux4", 4, "sel", 1), { x: 2, y: 0 });
  assert.deepEqual(pinSlotOffset("mux4", 4, "out", 0), { x: 3, y: 3 });
});

test("all pin offsets land on integer grid intersections (FR-021)", () => {
  for (const [renderAs, nIn] of [["nand", 4], ["mux8", 8], ["mux2", 2]]) {
    for (const role of ["in", "out", "sel"]) {
      for (let s = 0; s < nIn; s++) {
        const o = pinSlotOffset(renderAs, nIn, role, s);
        assert.ok(Number.isInteger(o.x) && Number.isInteger(o.y), `${renderAs} ${role} ${s}`);
      }
    }
  }
});
