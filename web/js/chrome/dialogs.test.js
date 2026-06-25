import { test } from "node:test";
import assert from "node:assert/strict";

import {
  galPartYaml,
  memDeviceYaml,
  pinGroupGeometryError,
  validateMemSpec,
  MEM_MAX_ADDR_BITS,
} from "./dialogs.js";
import { memDeviceType } from "../builtins.js";

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

// --- validateMemSpec (FR-114a/FR-114c) ---

// A valid base spec; tests override one field at a time.
const memSpec = (over) => ({ name: "M1", kind: "ram", addressBits: 8, dataWidth: 8, ...over });

test("validateMemSpec accepts a valid RAM spec (FR-114a)", () => {
  assert.equal(validateMemSpec(memSpec()), null);
});

test("validateMemSpec accepts a valid ROM spec with a file (FR-114a)", () => {
  assert.equal(
    validateMemSpec(memSpec({ kind: "rom", addressBits: 16, dataWidth: 16, romFile: "/x/y.bin" })),
    null,
  );
});

test("validateMemSpec requires a name (FR-114c)", () => {
  assert.match(validateMemSpec(memSpec({ name: "" })), /name/);
  assert.match(validateMemSpec(memSpec({ name: "   " })), /name/);
});

test("validateMemSpec requires a content file for ROM (FR-114a)", () => {
  assert.match(validateMemSpec(memSpec({ kind: "rom" })), /file/);
  // ...but RAM needs none.
  assert.equal(validateMemSpec(memSpec({ kind: "ram" })), null);
});

test("validateMemSpec requires a .bin/.hex ROM file (FR-114e)", () => {
  assert.equal(validateMemSpec(memSpec({ kind: "rom", romFile: "/r/x.bin" })), null);
  assert.equal(validateMemSpec(memSpec({ kind: "rom", romFile: "/r/x.HEX" })), null);
  assert.match(validateMemSpec(memSpec({ kind: "rom", romFile: "/r/x.txt" })), /\.bin or \.hex/);
});

test("validateMemSpec rejects out-of-range address bits (FR-114a)", () => {
  assert.match(validateMemSpec(memSpec({ addressBits: 0 })), /positive/);
  assert.match(
    validateMemSpec(memSpec({ addressBits: MEM_MAX_ADDR_BITS + 1 })),
    new RegExp(String(MEM_MAX_ADDR_BITS)),
  );
  assert.match(validateMemSpec(memSpec({ addressBits: 4.5 })), /integer/);
});

test("validateMemSpec rejects a data width outside {4,8,16,32} (FR-114a)", () => {
  assert.match(validateMemSpec(memSpec({ dataWidth: 12 })), /width/);
  for (const w of [4, 8, 16, 32]) {
    assert.equal(validateMemSpec(memSpec({ dataWidth: w })), null);
  }
});

test("validateMemSpec rejects an unknown device class (FR-114a)", () => {
  assert.match(validateMemSpec(memSpec({ kind: "flash" })), /RAM or ROM/);
});

// --- memDeviceYaml (FR-114f) ---

test("memDeviceYaml emits the mem block, pinout, and groups for a RAM (FR-114f)", () => {
  const type = memDeviceType({
    name: "PROGRAM_RAM", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256,
  });
  const yaml = memDeviceYaml(type);
  assert.match(yaml, /^id: "type-PROGRAM_RAM"$/m);
  assert.match(yaml, /^type: "PROGRAM_RAM"$/m);
  assert.match(yaml, /^mem: \{ kind: ram, addressBits: 8, dataWidth: 8, locations: 256 \}$/m);
  // bidir data pin on a RAM, address pin, and the two snap groups.
  assert.match(yaml, /name: "A0", side: left, pos: 1, dir: in/);
  assert.match(yaml, /name: "D0", side: right, pos: 1, dir: bidir/);
  assert.match(yaml, /name: "ADDR", pins: \["A0"/);
  assert.match(yaml, /name: "DATA", pins: \["D0"/);
  assert.ok(!yaml.includes("romFile"));
});

test("memDeviceYaml includes romFile and tristate data pins for a ROM (FR-114f)", () => {
  const type = memDeviceType({
    name: "FONT_ROM", kind: "rom", addressBits: 4, dataWidth: 16, locations: 16,
    romFile: "/roms/font.bin",
  });
  const yaml = memDeviceYaml(type);
  assert.match(yaml, /^mem: \{ kind: rom, addressBits: 4, dataWidth: 16, locations: 16, romFile: "\/roms\/font.bin" \}$/m);
  assert.match(yaml, /name: "D0", side: right, pos: 1, dir: tristate/);
});
