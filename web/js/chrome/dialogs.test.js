import { test } from "node:test";
import assert from "node:assert/strict";

import { galPartYaml, pinGroupGeometryError } from "./dialogs.js";

// A 22V10-shaped pin set: left inputs at pos 1..3, right OLMCs at pos 1..2.
const geoPins = [
  { number: 2, label: "D0", side: "left", pos: 1 },
  { number: 3, label: "D1", side: "left", pos: 2 },
  { number: 4, label: "D2", side: "left", pos: 3 },
  { number: 14, label: "Q0", side: "right", pos: 1 },
  { number: 15, label: "Q1", side: "right", pos: 2 },
];

test("pinGroupGeometryError accepts a same-side contiguous group (FR-063a)", () => {
  assert.equal(pinGroupGeometryError(geoPins, [2, 3, 4]), null);
});

test("pinGroupGeometryError rejects a group spanning two sides (FR-063a)", () => {
  assert.match(pinGroupGeometryError(geoPins, [2, 14]), /same side/);
});

test("pinGroupGeometryError rejects a non-contiguous group (FR-063a)", () => {
  // D0(pos1) and D2(pos3) with non-member D1(pos2) between them.
  assert.match(pinGroupGeometryError(geoPins, [2, 4]), /contiguous/);
});

// A small authored part: two left inputs renamed D0/D1, two OLMC outputs Q0/Q1.
function part(groups) {
  return {
    partnumber: "GRP-TEST",
    inputs: [
      { name: "CLK", pos: 1, number: 1 },
      { name: "D0", pos: 2, number: 2 },
      { name: "D1", pos: 3, number: 3 },
    ],
    olmcs: [
      { name: "Q0", pos: 1, number: 14, kind: "comb" },
      { name: "Q1", pos: 2, number: 15, kind: "comb" },
    ],
    groups,
    behavior: "",
  };
}

test("galPartYaml emits no groups block when there are none (FR-066d)", () => {
  assert.ok(!galPartYaml(part([])).includes("groups:"));
});

test("galPartYaml emits group members resolved to current labels (FR-066d)", () => {
  // Members stored by skeleton DIP number, given out of layout order.
  const yaml = galPartYaml(part([{ name: "D", members: [3, 2] }]));
  assert.match(yaml, /groups:/);
  // Resolved to labels and ordered by pin layout (number 2 before 3), not input order.
  assert.match(yaml, /\{ name: "D", pins: \["D0", "D1"\] \}/);
});

test("galPartYaml orders members by physical pin layout, inputs before OLMCs (FR-066d)", () => {
  const yaml = galPartYaml(part([{ name: "ALL", members: [15, 2, 14] }]));
  assert.match(yaml, /\{ name: "ALL", pins: \["D0", "Q0", "Q1"\] \}/);
});
