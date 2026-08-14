import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applySaveExt,
  tvPathFor,
  nextSymbol,
  galPartYaml,
  galPartFromType,
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

// --- galPartFromType: the Edit GAL part load-back (FR-066f) ---

// The GAL22V10 skeleton as galPartYaml emits it: 12 left inputs (DIP 1-11, 13)
// then 10 right OLMCs (DIP 14-23). fullPart/typeFor are inverses by construction,
// so a mismatch between them is what a broken round trip looks like.
const IN_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];
const OLMC_NUMBERS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

function fullPart(over = {}) {
  return {
    partnumber: "PC-DECODE-A",
    description: "program-counter address decode",
    inputs: IN_NUMBERS.map((number, i) => ({
      name: i === 0 ? "CLK" : "I" + number,
      pos: i + 1,
      number,
      ...(i === 0 ? { clock: true } : {}),
    })),
    olmcs: OLMC_NUMBERS.map((number, i) => ({
      name: "IO" + number,
      pos: i + 1,
      number,
      kind: "comb",
    })),
    groups: [],
    behavior: "",
    ...over,
  };
}

// typeFor builds the ComponentType the server returns for galPartYaml(fields):
// the same 22 pins, the derived outline, and the id/clock rules galPartYaml uses.
function typeFor(fields) {
  const reg = fields.olmcs.some((o) => o.kind === "reg");
  const t = {
    id: fields.id ?? "type-" + fields.partnumber,
    name: "22V10",
    renderType: "unit",
    width: 8,
    height: 14,
    gal: "GAL22V10",
    partnumber: fields.partnumber,
    pins: [
      ...fields.inputs.map((p) => ({
        name: p.name, side: "left", position: p.pos, direction: "in", number: p.number,
      })),
      ...fields.olmcs.map((o) => ({
        name: o.name,
        side: "right",
        position: o.pos,
        direction: o.name === "NC" ? "in" : o.kind === "in" ? "in" : "out",
        number: o.number,
      })),
    ],
  };
  if (fields.description) t.description = fields.description;
  if (reg) t.clock = fields.inputs[0].name;
  if (fields.behavior) t.behavior = fields.behavior;
  if (fields.groups.length) {
    const labelOf = new Map([...fields.inputs, ...fields.olmcs].map((p) => [p.number, p.name]));
    t.pinGroups = fields.groups.map((g) => ({ name: g.name, pins: g.members.map((n) => labelOf.get(n)) }));
  }
  return t;
}

// The strongest statement of the round trip (FR-066f): a definition loaded back
// into the dialog and saved unedited must re-serialize to byte-identical YAML.
test("galPartFromType round-trips a part to byte-identical YAML (FR-066f)", () => {
  const fields = fullPart({
    olmcs: OLMC_NUMBERS.map((number, i) => ({
      name: i === 0 ? "NC" : "IO" + number,
      pos: i + 1,
      number,
      kind: i === 1 ? "reg" : i === 2 ? "in" : "comb",
    })),
    groups: [{ name: "ADDR", members: [2, 3, 4] }],
    behavior: "IO15.R = I2 * /I3\nIO16 = I4\n",
  });
  const yaml = galPartYaml(fields);
  const back = galPartFromType(typeFor(fields));
  assert.equal(back.refuse, undefined);
  assert.equal(back.partnumber, "PC-DECODE-A");
  assert.equal(back.description, "program-counter address decode");
  assert.deepEqual(back.groups, [{ name: "ADDR", members: [2, 3, 4] }]);
  assert.equal(back.olmcs[0].name, "NC"); // the reserved no-connect label survives
  assert.equal(back.olmcs[1].kind, "reg"); // recovered from the .R equation
  assert.equal(back.olmcs[2].kind, "in"); // recovered from the pin direction
  assert.equal(galPartYaml({ ...back, id: back.id }), yaml);
});

// Renaming the part number must not move the definition: the id is immutable and
// is what the update addresses and placed instances record (FR-066e/FR-066f).
test("galPartFromType carries the id so a renamed part keeps its file (FR-066f)", () => {
  const fields = fullPart();
  const type = typeFor(fields);
  const back = galPartFromType(type);
  const renamed = galPartYaml({ ...back, partnumber: "PC-DECODE-B" });
  assert.match(renamed, /id: "type-PC-DECODE-A"/);
  assert.match(renamed, /partnumber: "PC-DECODE-B"/);
});

test("galPartFromType refuses a device the dialog does not present (FR-066f)", () => {
  const t = typeFor(fullPart());
  t.gal = "GAL16V8";
  assert.match(galPartFromType(t).refuse, /GAL22V10/);
  assert.match(galPartFromType({ ...t, gal: undefined }).refuse, /not a GAL part/);
});

test("galPartFromType refuses an off-skeleton pinout (FR-066f)", () => {
  const short = typeFor(fullPart());
  short.pins = short.pins.slice(0, 20);
  assert.match(galPartFromType(short).refuse, /skeleton has 22/);

  const moved = typeFor(fullPart());
  moved.pins[0] = { ...moved.pins[0], side: "right" };
  assert.match(galPartFromType(moved).refuse, /not where the skeleton puts it/);

  const unnumbered = typeFor(fullPart());
  delete unnumbered.pins[3].number;
  assert.match(galPartFromType(unnumbered).refuse, /no pin number/);
});

// The refusal that matters most: content the dialog would silently drop when it
// rewrites the file whole.
test("galPartFromType refuses content it does not model (FR-066f)", () => {
  const withDelays = { ...typeFor(fullPart()), delays: { tpd: 10 } };
  assert.match(galPartFromType(withDelays).refuse, /delays/);

  const withInternal = { ...typeFor(fullPart()), internal: ["Q0"] };
  assert.match(galPartFromType(withInternal).refuse, /internal/);

  const withPinDesc = typeFor(fullPart());
  withPinDesc.pins[2] = { ...withPinDesc.pins[2], desc: "address bit 3" };
  assert.match(galPartFromType(withPinDesc).refuse, /per-pin data/);

  const outlined = { ...typeFor(fullPart()), width: 10 };
  assert.match(galPartFromType(outlined).refuse, /custom outline/);
});

// The clock line is derived (galPartYaml emits it iff an OLMC is registered,
// naming pin 1), so one that disagrees would be silently rewritten.
test("galPartFromType refuses a clock declaration it would rewrite (FR-066f)", () => {
  const stray = { ...typeFor(fullPart()), clock: "CLK" }; // no registered output
  assert.match(galPartFromType(stray).refuse, /no registered output/);

  const regFields = fullPart({ behavior: "IO14.R = I2\n" });
  regFields.olmcs[0].kind = "reg";
  const wrongPin = { ...typeFor(regFields), clock: "I5" };
  assert.match(galPartFromType(wrongPin).refuse, /clock: CLK/);
});

test("galPartFromType refuses a pin group naming an unknown pin (FR-066f)", () => {
  const t = typeFor(fullPart());
  t.pinGroups = [{ name: "ADDR", pins: ["I2", "NOSUCH"] }];
  assert.match(galPartFromType(t).refuse, /NOSUCH/);
});

// --- applySaveExt (save-dialog extension coercion) ---

test("applySaveExt appends the default extension to a bare name", () => {
  assert.equal(applySaveExt("design", "json"), "design.json");
  assert.equal(applySaveExt("RAM1K", "bin", ["bin", "hex"]), "RAM1K.bin");
});

test("applySaveExt honors an already-acceptable extension without doubling (FR-114g)", () => {
  // The reported bug: "RAM1K.hex" must not become "RAM1K.hex.bin".
  assert.equal(applySaveExt("RAM1K.hex", "bin", ["bin", "hex"]), "RAM1K.hex");
  assert.equal(applySaveExt("RAM1K.bin", "bin", ["bin", "hex"]), "RAM1K.bin");
  assert.equal(applySaveExt("RAM1K.HEX", "bin", ["bin", "hex"]), "RAM1K.HEX"); // case-insensitive
});

test("applySaveExt with a non-acceptable extension appends the default", () => {
  assert.equal(applySaveExt("RAM1K.txt", "bin", ["bin", "hex"]), "RAM1K.txt.bin");
  // Single-extension pickers (the default) still coerce a foreign extension.
  assert.equal(applySaveExt("gen.c", "json"), "gen.c.json");
});

test("applySaveExt leaves an empty name unchanged", () => {
  assert.equal(applySaveExt("", "bin", ["bin", "hex"]), "");
});

test("applySaveExt with a null saveExt appends nothing (§6.19 project prompt)", () => {
  assert.equal(applySaveExt("myproject", null), "myproject");
  assert.equal(applySaveExt("my.project", null), "my.project");
});

// --- nextSymbol (the cycling cell buttons' whole rule, FR-115o) ---

test("nextSymbol advances and wraps within each column's symbol set (FR-115o)", () => {
  assert.deepEqual(["0", "1"].map((s) => nextSymbol(["0", "1"], s)), ["1", "0"]);
  const clock = ["0", "1", "C"];
  assert.deepEqual(clock.map((s) => nextSymbol(clock, s)), ["1", "C", "0"]);
  const out = ["H", "L", "X"];
  assert.deepEqual(out.map((s) => nextSymbol(out, s)), ["L", "X", "H"]);
});

test("nextSymbol normalizes an unrecognized symbol to the first option (FR-115o)", () => {
  // indexOf → -1, so the cycle lands on opts[0] rather than throwing: a cell
  // holding a symbol its column no longer offers is repaired by one click.
  assert.equal(nextSymbol(["0", "1"], "C"), "0");
  assert.equal(nextSymbol(["H", "L", "X"], undefined), "H");
});

// --- tvPathFor (the test-vector panel's document name, FR-115m) ---

test("tvPathFor binds the design's sibling .tv at the project root (FR-115m)", () => {
  assert.equal(
    tvPathFor({
      project: { dir: "/designs/wut4" },
      savePath: "/designs/wut4/cpu.json",
      designName: "cpu",
      dataDir: "/designs",
    }),
    "/designs/wut4/cpu.tv",
  );
});

test("tvPathFor falls back to the design's own directory with no project", () => {
  assert.equal(
    tvPathFor({ savePath: "/designs/wut4/alu.json", designName: "alu", dataDir: "/designs" }),
    "/designs/wut4/alu.tv",
  );
});

test("tvPathFor uses the design name and data root for a never-saved design", () => {
  assert.equal(
    tvPathFor({ designName: "untitled-2026", dataDir: "/designs" }),
    "/designs/untitled-2026.tv",
  );
  // No name at all still yields a usable document name.
  assert.equal(tvPathFor({ dataDir: "/designs" }), "/designs/vectors.tv");
});

test("tvPathFor replaces the design extension rather than appending (FR-115m)", () => {
  assert.equal(
    tvPathFor({ project: { dir: "/p" }, savePath: "/p/counter.json" }),
    "/p/counter.tv",
  );
  // A dotted base keeps everything but its last extension, like the save dialog.
  assert.equal(tvPathFor({ project: { dir: "/p" }, savePath: "/p/v1.2.json" }), "/p/v1.2.tv");
});

test("tvPathFor tolerates a trailing slash on the project directory", () => {
  assert.equal(
    tvPathFor({ project: { dir: "/designs/wut4/" }, savePath: "/designs/wut4/cpu.json" }),
    "/designs/wut4/cpu.tv",
  );
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

test("validateMemSpec accepts an optional RAM save file but checks its extension (FR-114g)", () => {
  assert.equal(validateMemSpec(memSpec({ kind: "ram", ramFile: "/s/x.bin", ramLoad: true })), null);
  assert.equal(validateMemSpec(memSpec({ kind: "ram", ramFile: "/s/x.HEX" })), null);
  assert.match(validateMemSpec(memSpec({ kind: "ram", ramFile: "/s/x.dat" })), /\.bin or \.hex/);
  // No save file at all is still valid — persistence is opt-in.
  assert.equal(validateMemSpec(memSpec({ kind: "ram" })), null);
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

test("memDeviceType and memDeviceYaml carry a RAM's persistent save file (FR-114g)", () => {
  const type = memDeviceType({
    name: "SCRATCH", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256,
    ramFile: "/s/scratch.bin", ramLoad: true,
  });
  assert.equal(type.mem.ramFile, "/s/scratch.bin");
  assert.equal(type.mem.ramLoad, true);
  const yaml = memDeviceYaml(type);
  assert.match(yaml, /^mem: \{ kind: ram, addressBits: 8, dataWidth: 8, locations: 256, ramFile: "\/s\/scratch.bin", ramLoad: true \}$/m);
  // A ROM's file field is never emitted for a RAM.
  assert.ok(!yaml.includes("romFile"));
});

test("memDeviceType omits ramFile fields for a RAM with no save file (FR-114g)", () => {
  const type = memDeviceType({ name: "PLAIN", kind: "ram", addressBits: 4, dataWidth: 4, locations: 16 });
  assert.ok(!("ramFile" in type.mem));
  assert.ok(!("ramLoad" in type.mem));
  assert.ok(!memDeviceYaml(type).includes("ramFile"));
});
