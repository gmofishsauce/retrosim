// Unit tests for the GAL equation term table (§6.11/§11.1, FR-066g).

import test from "node:test";
import assert from "node:assert/strict";

import {
  behaviorToTable,
  tableToBehavior,
  tableIssues,
  cycleCell,
  newOutput,
  normalizeRows,
  signalOf,
} from "./galeq.js";

// The GAL22V10 skeleton the dialog presents: 12 fixed inputs (DIP 1–11, 13) and
// 10 OLMC pins (14–23). `over` renames or re-roles individual pins by number.
function pins(over = {}) {
  const list = [
    { number: 1, name: "CLK", dir: "in", reg: false },
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map((n) => ({ number: n, name: "I" + n, dir: "in", reg: false })),
    ...[14, 15, 16, 17, 18, 19, 20, 21, 22, 23].map((n) => ({
      number: n,
      name: "IO" + n,
      dir: "out",
      reg: false,
    })),
  ];
  return list.map((p) => ({ ...p, ...(over[p.number] ?? {}) }));
}

const roundTrip = (text, p = pins()) => {
  const r = behaviorToTable(text, p);
  assert.equal(r.refuse, undefined, `unexpected refusal: ${r.refuse}`);
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

test("a registered OLMC heads .R, and the continuation aligns under it (FR-066g)", () => {
  const p = pins({ 14: { reg: true } });
  const table = { 14: { mode: "eq", note: "", rows: [{ 2: "1" }, { 3: "1" }] } };
  assert.equal(tableToBehavior(table, p), "IO14.R = I2\n       + I3\n");
});

test("an NC output writes nothing, and an OLMC set to input writes nothing (FR-062f)", () => {
  const p = pins({ 14: { name: "NC", dir: "in" }, 15: { dir: "in" } });
  const table = {
    14: { mode: "eq", note: "", rows: [{ 2: "1" }] },
    15: { mode: "eq", note: "", rows: [{ 2: "1" }] },
  };
  // 15's rows are kept (they come back if it is made an output again) but unwritten.
  assert.equal(tableToBehavior(table, p), "");
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
  assert.equal(r.refuse, undefined);
  assert.equal(r.table[14].mode, "const0");
  assert.equal(tableToBehavior(r.table, pins()), "IO14 = GND\n");
});

test("a literal repeated in the same polarity collapses onto its one cell", () => {
  assert.equal(roundTrip("IO14 = I2 * I2 * I3\n"), "IO14 = I2 * I3\n");
});

test("a registered equation round-trips with its .R (FR-066g)", () => {
  const p = pins({ 14: { reg: true } });
  assert.equal(roundTrip("IO14.R = I2 * I3\n", p), "IO14.R = I2 * I3\n");
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

// --- what the table declines to hold (FR-066f) ---

test("refuses the equation forms the table does not author (FR-066g)", () => {
  const p = pins({ 14: { reg: true } });
  assert.match(behaviorToTable("IO14.R = I2\nIO14.E = I3\n", p).refuse, /\.E/);
  assert.match(behaviorToTable("AR = I2\n", p).refuse, /AR/);
  assert.match(behaviorToTable("SP = I2\n", p).refuse, /SP/);
  assert.match(behaviorToTable("IO14 = I2 :+: I3\n", pins()).refuse, /XOR/);
  assert.match(behaviorToTable("IO14.T = I2\n", pins()).refuse, /\.T/);
  assert.match(behaviorToTable("IO14.L = I2\n", pins()).refuse, /\.L/);
});

test("refuses an LHS negation its pin label does not carry (FR-066g)", () => {
  // examples/cpu/components/type-22V738.yaml: pin labeled OUTCMB, equation
  // !OUTCMB = … . Loading it under the label rule and saving would invert the
  // output, so the dialog declines rather than damaging it.
  const p = pins({ 14: { name: "OUTCMB" } });
  const r = behaviorToTable("!OUTCMB = I2 * I3\n", p);
  assert.match(r.refuse, /labeled "OUTCMB"/);
  assert.match(r.refuse, /"\/OUTCMB"/); // says exactly how to fix it

  // The mirror case: a /-labeled pin whose equation is written active high.
  const p2 = pins({ 14: { name: "/ENF" } });
  assert.match(behaviorToTable("ENF = I2\n", p2).refuse, /labeled "\/ENF"/);
});

test("refuses self-feedback, which has no cell (FR-066g)", () => {
  assert.match(behaviorToTable("IO14 = I2 * IO14\n", pins()).refuse, /reads itself back/);
});

test("refuses an always-false term alongside other terms (FR-066g)", () => {
  const r = behaviorToTable("IO14 = I2 * !I2 + I3\n", pins());
  assert.match(r.refuse, /both ways/);
  assert.match(r.refuse, /always 0/);
});

test("refuses an equation naming a pin the part does not have", () => {
  assert.match(behaviorToTable("IO14 = NOSUCH\n", pins()).refuse, /unknown signal NOSUCH/);
  assert.match(behaviorToTable("NOSUCH = I2\n", pins()).refuse, /not a pin of this part/);
});

test("refuses an equation headed by an input pin", () => {
  assert.match(behaviorToTable("I2 = I3\n", pins()).refuse, /not an output pin/);
});

test("refuses two equations for one output", () => {
  assert.match(behaviorToTable("IO14 = I2\nIO14 = I3\n", pins()).refuse, /two equations/);
});

test("an empty behavior block loads as an empty table", () => {
  assert.deepEqual(behaviorToTable("", pins()).table, {});
  assert.deepEqual(behaviorToTable("\n  \n", pins()).table, {});
});

// --- the clock rule (FR-066g) ---

test("pin 1 may head a literal until an output is registered (FR-066g)", () => {
  const table = { 14: { mode: "eq", note: "", rows: [{ 1: "1", 2: "1" }] } };
  // No registered output: pin 1 is an ordinary input and the term is legal.
  assert.equal(tableIssues(table, pins()), null);
  assert.equal(tableToBehavior(table, pins()), "IO14 = CLK * I2\n");

  // Register any output and the same term names the device's clock.
  const p = pins({ 15: { reg: true } });
  const issue = tableIssues(table, p);
  assert.match(issue, /CLK \(pin 1\)/);
  assert.match(issue, /IO14/);
});

test("the clock rule ignores a constant output's kept rows (FR-066g)", () => {
  const table = { 14: { mode: "const0", note: "", rows: [{ 1: "1" }] } };
  assert.equal(tableIssues(table, pins({ 15: { reg: true } })), null);
});
