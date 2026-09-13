// Unit tests for the GAL equation term table (§6.11/§11.1, FR-066g).

import test from "node:test";
import assert from "node:assert/strict";

import {
  behaviorToTable,
  tableToBehavior,
  hasContent,
  cycleCell,
  newOutput,
  normalizeRows,
  signalOf,
} from "./galeq.js";

// The GAL22V10 skeleton the dialog presents: 12 fixed inputs (DIP 1–11, 13) and
// 10 OLMC pins (14–23). `over` renames or re-roles individual pins by number.
function pins(over = {}) {
  const list = [
    { number: 1, name: "CLK", dir: "in", olmc: false },
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map((n) => ({ number: n, name: "I" + n, dir: "in", olmc: false })),
    ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((n) => ({
      number: n,
      name: "IO" + n,
      dir: "out",
      olmc: true,
    })),
  ];
  return list.map((p) => ({ ...p, ...(over[p.number] ?? {}) }));
}

const roundTrip = (text, p = pins()) => {
  const r = behaviorToTable(text, p);
  assert.deepEqual(r.kept, [], "nothing should have been kept as written");
  return tableToBehavior(r.table, p);
};

// --- the cell cycle and the row model ---

test("a cell cycles X → 1 → 0 → X, absence being the X state (FR-066g)", () => {
  assert.equal(cycleCell(undefined), "1");
  assert.equal(cycleCell("X"), "1");
  assert.equal(cycleCell("1"), "0");
  assert.equal(cycleCell("0"), undefined);
});

test("normalizeRows leaves an emptied output one row to click into (FR-066g)", () => {
  const rec = newOutput();
  rec.rows = [];
  assert.deepEqual(normalizeRows(rec).rows, [{}]);
});

test("signalOf strips the label's polarity slash (§7.6)", () => {
  assert.equal(signalOf("/ENF"), "ENF");
  assert.equal(signalOf("S0"), "S0");
});

// --- emission (FR-066g) ---

test("tableToBehavior writes one AND term per line, OR'd by leading + ", () => {
  const table = {
    14: { mode: "eq", note: "", rows: [{ 2: "1", 3: "0" }, { 4: "1" }] },
  };
  assert.equal(tableToBehavior(table, pins()), "IO14 = I2 * !I3\n     + I4\n");
});

test("an all-X row is empty, not the always-true empty product (FR-066g)", () => {
  // The rule that makes an added row safe: every row is born all-X, and reading
  // one as VCC would silently drive its output true.
  const table = { 14: { mode: "eq", note: "", rows: [{ 2: "1" }, {}] } };
  assert.equal(tableToBehavior(table, pins()), "IO14 = I2\n");
});

test("an output whose rows are all empty emits no equation at all (FR-066g)", () => {
  const table = { 14: { mode: "eq", note: "", rows: [{}, {}] } };
  assert.equal(tableToBehavior(table, pins()), "");
});

test("the constant modes write = GND and = VCC (FR-066g)", () => {
  const table = {
    14: { mode: "const0", note: "", rows: [{}] },
    15: { mode: "const1", note: "", rows: [{}] },
  };
  assert.equal(tableToBehavior(table, pins()), "IO14 = GND\nIO15 = VCC\n");
});

test("outputs are written in pin order, whatever order the table holds them", () => {
  const table = {
    23: { mode: "eq", note: "", rows: [{ 2: "1" }] },
    14: { mode: "eq", note: "", rows: [{ 3: "1" }] },
  };
  assert.equal(tableToBehavior(table, pins()), "IO14 = I3\nIO23 = I2\n");
});

test("polarity comes from the pin label: /ENF heads /ENF =, its literals read ENF (FR-066g)", () => {
  const p = pins({ 20: { name: "/ENF" }, 14: { name: "/BEN" } });
  const table = {
    20: { mode: "eq", note: "", rows: [{ 2: "1" }] },
    14: { mode: "eq", note: "", rows: [{ 20: "0" }] },
  };
  assert.equal(tableToBehavior(table, p), "/BEN = !ENF\n/ENF = I2\n");
});

test("a registered output heads .R, and the continuation aligns under it (FR-066g)", () => {
  const table = { 14: { mode: "eq", reg: true, note: "", rows: [{ 2: "1" }, { 3: "1" }] } };
  assert.equal(tableToBehavior(table, pins()), "IO14.R = I2\n       + I3\n");
});

// The .R belongs to the output's equations, not to the pin: the OLMC type the
// user declares is a separate fact that may disagree (FR-066i).
test("reg comes from the output's own flag, never from the pin (FR-066i)", () => {
  const table = { 14: { mode: "const1", reg: true, note: "", rows: [{}] }, 15: { mode: "eq", reg: false, note: "", rows: [{ 2: "1" }] } };
  assert.equal(tableToBehavior(table, pins({ 15: { declReg: true } })), "IO14.R = VCC\nIO15 = I2\n");
});

test("an NC output writes nothing (FR-062f)", () => {
  const p = pins({ 14: { name: "NC", dir: "in" } });
  const table = { 14: { mode: "eq", note: "", rows: [{ 2: "1" }] } };
  assert.equal(tableToBehavior(table, p), "");
});

// What the dialog shows is what it saves (FR-066j): an OLMC switched to input
// while it holds equations still writes them, and the definition-error check
// reports the conflict. One with no content has nothing to write.
test("an OLMC set to input writes the equations it holds, and nothing otherwise (FR-066g)", () => {
  const p = pins({ 15: { dir: "in" }, 16: { dir: "in" } });
  const table = {
    15: { mode: "eq", note: "", rows: [{ 2: "1" }] },
    16: { mode: "eq", note: "", rows: [{}] },
  };
  assert.equal(tableToBehavior(table, p), "IO15 = I2\n");
  assert.equal(hasContent(table[15]), true);
  assert.equal(hasContent(table[16]), false);
  assert.equal(hasContent({ mode: "const0", rows: [{}] }), true);
});

test("a per-output note is written as a trailing comment on its first line (FR-066g)", () => {
  const table = { 14: { mode: "eq", note: "update PC when F is 1..4", rows: [{ 2: "1" }, { 3: "1" }] } };
  assert.equal(
    tableToBehavior(table, pins()),
    "IO14 = I2 ; update PC when F is 1..4\n     + I3\n",
  );
});

// --- parsing back (FR-066f/FR-066g) ---

test("behaviorToTable → tableToBehavior round-trips a sum of products", () => {
  const text = "IO14 = I2 * !I3\n     + !I4\nIO15 = I5\n";
  assert.equal(roundTrip(text), text);
});

test("parsing normalizes the / negation spelling and the layout (FR-066g)", () => {
  // The GALasm "/" spelling and free line layout of an existing file come back
  // in the dialog's one form; the logic is untouched.
  assert.equal(roundTrip("IO14 =  I2*/I3\n   +  I4*I5\n"), "IO14 = I2 * !I3\n     + I4 * I5\n");
});

test("a note survives text → table → text (FR-066g)", () => {
  assert.equal(roundTrip("IO14 = I2 ; always on\n"), "IO14 = I2 ; always on\n");
});

test("a comment standing above an equation joins that output's note (FR-066g)", () => {
  assert.equal(roundTrip("; decode\nIO14 = I2\n"), "IO14 = I2 ; decode\n");
});

test("= VCC and = GND load as the constant modes (FR-066g)", () => {
  const r = behaviorToTable("IO14 = GND\nIO15 = VCC\n", pins());
  assert.equal(r.table[14].mode, "const0");
  assert.equal(r.table[15].mode, "const1");
  assert.equal(tableToBehavior(r.table, pins()), "IO14 = GND\nIO15 = VCC\n");
});

test("a single always-false term is the hard-0 idiom and loads as always 0 (FR-066g)", () => {
  // examples/cpu/components/type-22V-DCD.yaml writes "S2 = F0 * !F0" for an
  // output deliberately held low; one cell cannot say it, the constant can.
  const r = behaviorToTable("IO14 = I2 * !I2\n", pins());
  assert.deepEqual(r.kept, []);
  assert.equal(r.table[14].mode, "const0");
  assert.equal(tableToBehavior(r.table, pins()), "IO14 = GND\n");
});

test("a literal repeated in the same polarity collapses onto its one cell", () => {
  assert.equal(roundTrip("IO14 = I2 * I2 * I3\n"), "IO14 = I2 * I3\n");
});

test("a registered equation round-trips with its .R, which sets the output's reg (FR-066g)", () => {
  assert.equal(roundTrip("IO14.R = I2 * I3\n"), "IO14.R = I2 * I3\n");
  assert.equal(behaviorToTable("IO14.R = I2\nIO15 = I3\n", pins()).table[14].reg, true);
  assert.equal(behaviorToTable("IO14.R = I2\nIO15 = I3\n", pins()).table[15].reg, false);
});

test("an active-low pin's equation round-trips from its label (FR-066g)", () => {
  const p = pins({ 20: { name: "/ENF" } });
  assert.equal(roundTrip("/ENF = I2 * !I3\n", p), "/ENF = I2 * !I3\n");
});

// The model is keyed by DIP number, so a relabel carries every term (FR-066d's
// rule, applied to equations).
test("relabeling a pin between parse and emit moves its literals (FR-066g)", () => {
  const before = pins();
  const r = behaviorToTable("IO14 = I2 * !I3\n", before);
  const after = pins({ 2: { name: "F0" }, 3: { name: "F1" }, 14: { name: "S0" } });
  assert.equal(tableToBehavior(r.table, after), "S0 = F0 * !F1\n");
});

// --- what the table cannot hold is kept as written (FR-066g/FR-066j) ---

test("the equation forms the table does not author are kept verbatim, in order (FR-066g)", () => {
  const text = "IO14.R = I2\nIO14.E = I3\nAR = I4\nSP = I5\n";
  const r = behaviorToTable(text, pins({ 14: { dir: "out" } }));
  assert.equal(r.table[14].reg, true);
  assert.deepEqual(r.kept, ["IO14.E = I3", "AR = I4", "SP = I5"]);
  // Kept equations follow the table's, which keeps .E after its output.
  assert.equal(tableToBehavior(r.table, pins(), r.kept), text);
  for (const form of ["IO14 = I2 :+: I3", "IO14.T = I2", "IO14.L = I2", "IO14.G = I2"]) {
    assert.deepEqual(behaviorToTable(form + "\n", pins()).kept, [form]);
  }
});

test("an LHS negation its pin label does not carry is kept, not inverted (FR-066g)", () => {
  // examples/cpu/components/type-22V738.yaml: pin labeled OUTCMB, equation
  // !OUTCMB = … . Re-emitting it from the label would invert the output.
  const p = pins({ 14: { name: "OUTCMB" } });
  const r = behaviorToTable("!OUTCMB = I2 * I3\n", p);
  assert.deepEqual(r.table, {});
  assert.deepEqual(r.kept, ["!OUTCMB = I2 * I3"]);
  assert.deepEqual(behaviorToTable("ENF = I2\n", pins({ 14: { name: "/ENF" } })).kept, ["ENF = I2"]);
});

test("each equation the table cannot represent is kept on its own (FR-066g)", () => {
  const cases = [
    "IO14 = I2 * IO14", // self-feedback has no cell
    "IO14 = I2 * !I2 + I3", // always-false term alongside others
    "IO14 = NOSUCH", // unknown signal
    "NOSUCH = I2", // not a pin
    "I2 = I3", // a fixed input may head no equation
    "IO14 = I2 $ I3", // not an equation at all
  ];
  for (const text of cases) {
    const r = behaviorToTable(text + "\nIO15 = I4\n", pins());
    assert.deepEqual(r.kept, [text], text);
    assert.equal(tableToBehavior(r.table, pins()), "IO15 = I4\n", text);
  }
});

test("a second equation for an output already in the table is kept (FR-066g)", () => {
  const r = behaviorToTable("IO14 = I2\nIO14 = I3\n", pins());
  assert.deepEqual(r.kept, ["IO14 = I3"]);
  assert.equal(tableToBehavior(r.table, pins(), r.kept), "IO14 = I2\nIO14 = I3\n");
});

test("a kept equation carries its continuation lines and comments (FR-066g)", () => {
  const text = "; hold the register\nIO14.R = I2\n       + IO14 ; feedback\nIO15 = I3\n";
  const r = behaviorToTable(text, pins());
  assert.deepEqual(r.kept, ["; hold the register\nIO14.R = I2\n       + IO14 ; feedback"]);
  assert.equal(tableToBehavior(r.table, pins(), r.kept), "IO15 = I3\n; hold the register\nIO14.R = I2\n       + IO14 ; feedback\n");
});

test("a block of nothing but comments is kept (FR-066g)", () => {
  assert.deepEqual(behaviorToTable("; logic to come\n", pins()), { table: {}, kept: ["; logic to come"] });
});

test("an equation for an OLMC configured as an input is read into the table (FR-066g)", () => {
  const p = pins({ 15: { dir: "in" } });
  const r = behaviorToTable("IO15 = I2\n", p);
  assert.deepEqual(r.kept, []);
  assert.equal(tableToBehavior(r.table, p), "IO15 = I2\n");
});

test("an empty behavior block loads as an empty table", () => {
  assert.deepEqual(behaviorToTable("", pins()), { table: {}, kept: [] });
  assert.deepEqual(behaviorToTable("\n  \n", pins()), { table: {}, kept: [] });
});
