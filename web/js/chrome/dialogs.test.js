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

// --- part notes (FR-125a): a block scalar, distinct from `description` ---

test("galPartYaml emits notes as a literal block scalar (FR-125a)", () => {
  const yaml = galPartYaml({ ...part([]), notes: "why this is here\nand what is next" });
  assert.match(yaml, /notes: \|2\n  why this is here\n  and what is next\n/);
});

test("galPartYaml states the block indentation explicitly (FR-125a)", () => {
  // With a bare `|`, YAML infers the block indent from the first non-empty line,
  // so notes whose first line is itself indented would make every later line read
  // as less-indented and the file would fail to parse — the app writing a part it
  // cannot load. The explicit `2` makes leading space content.
  const yaml = galPartYaml({ ...part([]), notes: "    pasted, already indented\nplain line" });
  assert.match(yaml, /notes: \|2\n      pasted, already indented\n  plain line\n/);
});

test("galPartYaml writes blank notes lines truly empty, not as stray spaces", () => {
  const yaml = galPartYaml({ ...part([]), notes: "first\n\nthird" });
  assert.match(yaml, /notes: \|2\n  first\n\n  third\n/);
});

test("galPartYaml omits notes entirely when there are none (FR-125a)", () => {
  assert.ok(!galPartYaml(part([])).includes("notes:"));
  assert.ok(!galPartYaml({ ...part([]), notes: "" }).includes("notes:"));
  assert.ok(!galPartYaml({ ...part([]), notes: "   \n\n " }).includes("notes:"));
});

test("galPartYaml keeps notes and description separate fields (FR-125a)", () => {
  // The whole point of the split: a one-line label the tooltip shows, and prose
  // it does not. They must never be merged into one key.
  const yaml = galPartYaml({
    ...part([]),
    description: "decoder for PC/PRAM",
    notes: "the long story",
  });
  assert.match(yaml, /^description: "decoder for PC\/PRAM"$/m);
  assert.match(yaml, /^notes: \|2$/m);
});

test("galPartYaml puts notes last so the scanned fields stay at the top (FR-125a)", () => {
  const yaml = galPartYaml({ ...part([]), notes: "prose", behavior: "Q0 = D0\n" });
  assert.ok(yaml.indexOf("notes:") > yaml.indexOf("behavior:"));
  assert.ok(yaml.indexOf("notes:") > yaml.indexOf("pins:"));
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
    clock: false,
    groups: [],
    behavior: "",
    ...over,
  };
}

// typeFor builds the ComponentType the server returns for galPartYaml(fields):
// the same 22 pins with their declared olmc types (FR-066i), the outline, and
// the id and clock galPartYaml writes.
function typeFor(fields) {
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
      ...fields.olmcs.map((o) => {
        const pin = {
          name: o.name,
          side: "right",
          position: o.pos,
          direction: o.name === "NC" || o.kind === "in" ? "in" : "out",
          number: o.number,
        };
        if (pin.direction === "out") pin.olmc = o.kind;
        return pin;
      }),
    ],
  };
  if (fields.description) t.description = fields.description;
  if (fields.clock) t.clock = fields.inputs[0].name;
  if (fields.behavior) t.behavior = fields.behavior;
  if (fields.groups.length) {
    const labelOf = new Map([...fields.inputs, ...fields.olmcs].map((p) => [p.number, p.name]));
    t.pinGroups = fields.groups.map((g) => ({ name: g.name, pins: g.members.map((n) => labelOf.get(n)) }));
  }
  return t;
}

const allReg = () =>
  OLMC_NUMBERS.map((number, i) => ({ name: "IO" + number, pos: i + 1, number, kind: "reg" }));

test("galPartYaml writes each output's declared type and the clock explicitly (FR-066i)", () => {
  const fields = fullPart({ clock: true });
  fields.olmcs[0].kind = "reg";
  fields.olmcs[1].kind = "in";
  fields.olmcs[2].name = "NC";
  const yaml = galPartYaml(fields);
  assert.match(yaml, /^clock: "CLK"$/m);
  assert.match(yaml, /\{ name: "IO14", side: right, pos: 1, dir: out, olmc: reg, number: 14 \}/);
  assert.match(yaml, /\{ name: "IO15", side: right, pos: 2, dir: in, number: 15 \}/);
  assert.match(yaml, /\{ name: "NC", side: right, pos: 3, dir: in, number: 16 \}/);
  assert.match(yaml, /\{ name: "IO17", side: right, pos: 4, dir: out, olmc: comb, number: 17 \}/);
  // No clock box, no clock: line — whatever the outputs are.
  assert.doesNotMatch(galPartYaml({ ...fields, clock: false }), /^clock:/m);
});

// The reported bug (FR-066i): "reg out" outputs and a clock with no equations
// yet were lost on save, and the part then refused to reopen.
test("a part with registered outputs, a clock, and no logic round-trips exactly (FR-066i)", () => {
  const fields = fullPart({ clock: true, olmcs: allReg() });
  const yaml = galPartYaml(fields);
  const back = galPartFromType(typeFor(fields));
  assert.equal(back.clock, true);
  assert.deepEqual(back.olmcs.map((o) => o.kind), Array(10).fill("reg"));
  assert.deepEqual(back.loadNotes, []);
  assert.equal(galPartYaml(back), yaml);
});

// The strongest statement of the round trip (FR-066f): a definition loaded back
// into the dialog and saved unedited must re-serialize to byte-identical YAML.
test("galPartFromType round-trips a part to byte-identical YAML (FR-066f)", () => {
  const fields = fullPart({
    clock: true,
    olmcs: OLMC_NUMBERS.map((number, i) => ({
      name: i === 0 ? "NC" : "IO" + number,
      pos: i + 1,
      number,
      kind: i === 1 ? "reg" : i === 2 ? "in" : "comb",
    })),
    groups: [{ name: "ADDR", members: [2, 3, 4] }],
    // Already in the equation table's normal form (FR-066g): the load-back
    // parses the block into the table and re-emits it, so only a normalized
    // block can be byte-identical after the round trip.
    behavior: "IO15.R = I2 * !I3\nIO17 = I4\n",
  });
  const yaml = galPartYaml(fields);
  const back = galPartFromType(typeFor(fields));
  assert.equal(back.partnumber, "PC-DECODE-A");
  assert.equal(back.description, "program-counter address decode");
  assert.deepEqual(back.groups, [{ name: "ADDR", members: [2, 3, 4] }]);
  assert.equal(back.olmcs[0].name, "NC"); // the reserved no-connect label survives
  assert.equal(back.olmcs[1].kind, "reg"); // from the olmc key
  assert.equal(back.olmcs[2].kind, "in"); // from the pin direction
  assert.deepEqual(back.loadNotes, []);
  assert.equal(galPartYaml(back), yaml);
});

// Renaming the part number must not move the definition: the id is immutable and
// is what the update addresses and placed instances record (FR-066e/FR-066f).
test("galPartFromType carries the id so a renamed part keeps its file (FR-066f)", () => {
  const back = galPartFromType(typeFor(fullPart()));
  const renamed = galPartYaml({ ...back, partnumber: "PC-DECODE-B" });
  assert.match(renamed, /id: "type-PC-DECODE-A"/);
  assert.match(renamed, /partnumber: "PC-DECODE-B"/);
});

// A part written before FR-066i has no olmc keys: its declared types are
// inferred from .R, including on an active-low (slash-labeled) output.
test("galPartFromType infers a type without olmc keys from its .R equations (FR-066i)", () => {
  const fields = fullPart({ clock: true, behavior: "IO14.R = I2\n/LD.R = I3\n" });
  fields.olmcs[1].name = "/LD";
  const t = typeFor(fields);
  for (const p of t.pins) delete p.olmc;
  const back = galPartFromType(t);
  assert.equal(back.olmcs[0].kind, "reg");
  assert.equal(back.olmcs[1].kind, "reg");
  assert.equal(back.olmcs[2].kind, "comb");
});

test("galPartFromType opens any GAL part, noting what it changed (FR-066j)", () => {
  const other = typeFor(fullPart());
  other.gal = "GAL16V8";
  const back = galPartFromType(other);
  assert.ok(back.loadNotes.some((n) => /GAL16V8/.test(n)));
  assert.match(galPartYaml(back), /^gal: GAL22V10$/m);

  const loaded = { ...typeFor(fullPart()), loadErrors: ['clock names unknown pin "CP"'] };
  assert.ok(galPartFromType(loaded).loadNotes.some((n) => /the file as loaded: clock names unknown pin/.test(n)));

  const wrongClock = { ...typeFor(fullPart()), clock: "I5" };
  const wc = galPartFromType(wrongClock);
  assert.equal(wc.clock, false);
  assert.ok(wc.loadNotes.some((n) => /clock: I5 is not pin 1/.test(n)));
});

test("galPartFromType seats an off-skeleton pinout and keeps what has no slot (FR-066j)", () => {
  const short = typeFor(fullPart());
  short.pins = short.pins.slice(0, 20); // no pins 22, 23
  const s = galPartFromType(short);
  assert.equal(s.olmcs[8].name, "IO22"); // supplied from the skeleton
  assert.ok(s.loadNotes.some((n) => /no pin numbered 22/.test(n)));

  const moved = typeFor(fullPart());
  moved.pins[0] = { ...moved.pins[0], side: "right" };
  const m = galPartFromType(moved);
  assert.equal(m.inputs[0].name, "CLK");
  assert.ok(m.loadNotes.some((n) => /CLK \(1\) moved/.test(n)));

  const extra = typeFor(fullPart());
  extra.pins.push({ name: "SPARE", side: "left", position: 13, direction: "in" });
  const e = galPartFromType(extra);
  assert.ok(e.loadNotes.some((n) => /SPARE has no pin number; kept as written/.test(n)));
  assert.match(galPartYaml(e), /\{ name: "SPARE", side: left, pos: 13, dir: in \}/);
});

// Content the dialog does not model is written back, never dropped (FR-066j).
test("galPartFromType keeps content it does not model and galPartYaml writes it back (FR-066j)", () => {
  const t = {
    ...typeFor(fullPart()),
    delays: { tpd: 10 },
    internal: ["Q0"],
    width: 10,
    extra: { wip: { owner: "me" } },
  };
  t.pins[2] = { ...t.pins[2], desc: "address bit 3" };
  const back = galPartFromType(t);
  const yaml = galPartYaml(back);
  assert.match(yaml, /^delays: \{"tpd":10\}$/m);
  assert.match(yaml, /^internal: \["Q0"\]$/m);
  assert.match(yaml, /^wip: \{"owner":"me"\}$/m);
  assert.match(yaml, /^outline: \[10, 14\]$/m);
  assert.match(yaml, /name: "I3", side: left, pos: 3, dir: in, number: 3, desc: "address bit 3"/);
  assert.equal(back.loadNotes.length, 4); // delays, internal, wip, outline
});

test("galPartFromType drops a group member naming no pin, with a note (FR-066j)", () => {
  const t = typeFor(fullPart());
  t.pinGroups = [{ name: "ADDR", pins: ["I2", "NOSUCH"] }];
  const back = galPartFromType(t);
  assert.deepEqual(back.groups, [{ name: "ADDR", members: [2] }]);
  assert.ok(back.loadNotes.some((n) => /NOSUCH/.test(n)));
});

// What the table cannot hold is kept as written and written after it (FR-066g).
test("galPartFromType keeps equations the table cannot hold (FR-066g)", () => {
  const fields = fullPart({ behavior: "IO14.R = I2\nIO14.E = I3\n!IO15 = I4\n" });
  const back = galPartFromType(typeFor(fields));
  assert.deepEqual(back.keptEquations, ["IO14.E = I3", "!IO15 = I4"]);
  assert.equal(back.behavior, "IO14.R = I2\nIO14.E = I3\n!IO15 = I4\n");
  assert.equal(back.loadNotes.length, 2);
});

// What the dialog opens with is what an unedited Save would write: the loaded
// behavior comes back re-emitted from the table (FR-066g).
test("galPartFromType normalizes the behavior it loads (FR-066g)", () => {
  const fields = fullPart({ behavior: "IO14 =  I2*/I3\n  + I4 ; both ways\n" });
  const back = galPartFromType(typeFor(fields));
  assert.equal(back.behavior, "IO14 = I2 * !I3 ; both ways\n     + I4\n");
});

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
