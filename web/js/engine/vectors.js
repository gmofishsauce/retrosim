// Test vectors (§6.16, FR-115): a DOM-free runner and file model for an authored
// table of input patterns + expected outputs, scored against the slow simulator.
// A combinational design (no clock generator) evaluates each row independently
// (FR-115c): drive the inputs, settle to quiescence (FR-085), compare outputs.
// A sequential design (≥1 clock generator) runs its rows IN ORDER on a single
// simulation instance (FR-115e): state persists row to row, each clock generator
// is a 0/1/C input column (C = one positive pulse, PLD/JEDEC style), and an
// implicit power-on preamble asserts the reset built-ins before row 1.
//
// Shapes used throughout:
//   column  { refdes, pin, label, kind? }  — one bound connection point; kind
//           "clock" marks a clock column (live-only, never persisted)
//   doc     { inputs: column[], outputs: column[], io: column[], rows: row[] }
//   row     { in: ("0"|"1"|"C")[], io: ("0"|"1"|"H"|"L"|"X")[], out: ("H"|"L"|"X")[] }
//           aligned to inputs / io / outputs (io is the bidirectional group, FR-115i)
// The `.tv` file (§7.7) is a doc plus a `formatVersion`.

import { buildSimulation, SETTLE_BOUND } from "./sim.js";
import { V0, V1 } from "./galasm.js";
import { effectivePortDir } from "../model/subdesign.js";

// FORMAT_VERSION is the `.tv` file format this client writes and understands
// (§7.7); mirror persist.js — bump it and add a MIGRATIONS step on any change.
// v2 marks the sequential "C" input symbol (FR-115e); v3 adds the bidirectional
// (io) column array and per-row io cells (FR-115i).
export const FORMAT_VERSION = 3;

// MIGRATIONS upgrades a parsed `.tv` object across a single format version:
// MIGRATIONS[n] takes a version-n object to version-(n+1) (mirrors
// model/persist.js §7.4). v1→v2 is the identity: the shape did not change, the
// bump only marks that files may now contain "C" input cells (FR-115e). v2→v3
// seeds the io column array and per-row io cells empty (FR-115i) — a pre-v3 file
// has no bidirectional columns, so this is the identity on its data.
const MIGRATIONS = {
  1: (o) => o,
  2: (o) => ({
    ...o,
    io: o.io ?? [],
    rows: (o.rows ?? []).map((r) => ({ ...r, io: r.io ?? [] })),
  }),
};

// migrate normalizes a parsed `.tv` object to the current format version. A file
// with no `formatVersion` is treated as the oldest understood version (1); an
// older file is upgraded step by step; a file already at — or beyond — the target
// is returned unchanged (newer files load best-effort). `target`/`migrations` are
// injectable so the chain is testable before a real second version exists.
export function migrate(obj, { target = FORMAT_VERSION, migrations = MIGRATIONS } = {}) {
  let v = obj.formatVersion ?? 1;
  while (v < target) {
    const step = migrations[v];
    if (!step) {
      throw new Error(`cannot load test vectors: no migration from version ${v} to ${v + 1}`);
    }
    obj = { ...step(obj), formatVersion: v + 1 };
    v += 1;
  }
  return obj;
}

// hasClockGenerators reports whether the design contains at least one clock
// generator built-in (FR-071) — the condition that makes it sequential (FR-086)
// and selects the ordered, scripted-clock run path (FR-115e), the clock columns
// in deriveColumns, and the dialog's sequential-mode notice. A design scan
// (renderType === "clock", the same identification buildSimulation uses) rather
// than buildSimulation(...).hasClocks(), which would compile every behavior
// just to answer a yes/no question.
export function hasClockGenerators(design) {
  return (design.components ?? []).some((c) => c.typeData?.renderType === "clock");
}

// LATCH_SUFFIX_RE matches a `.L` transparent-latch output suffix (FR-079d) in a
// comment-stripped behavior line — `.L` not followed by another name character
// (so it is the suffix, not a longer token).
const LATCH_SUFFIX_RE = /\.L(?![A-Za-z0-9])/;

// behaviorHasLatch reports whether a behavior block declares a `.L` output — a
// cheap per-line scan that strips GALasm ';' comments first, avoiding a full
// compile.
function behaviorHasLatch(behavior) {
  if (!behavior) return false;
  for (let line of behavior.split("\n")) {
    const semi = line.indexOf(";");
    if (semi >= 0) line = line.slice(0, semi);
    if (LATCH_SUFFIX_RE.test(line)) return true;
  }
  return false;
}

// isStateful reports whether the design carries state that must survive from one
// vector row to the next, selecting the ordered/persistent run path (FR-115e) in
// runVectors/captureVectors — so a latch's hold spans rows even in a clock-less
// design. True when the design has a clock generator OR any in-use type whose
// behavior declares a transparent latch (a `.L` output, FR-079d). A pure,
// DOM-free design scan — deliberately not buildSimulation(...).hasClocks(),
// which would compile every behavior. hasClockGenerators still gates the
// clock-specific machinery (the C-pulse columns and the scripted-clock preamble).
export function isStateful(design) {
  if (hasClockGenerators(design)) return true;
  return (design.components ?? []).some((c) => behaviorHasLatch(c.typeData?.behavior));
}

// refdesCompare orders columns by reference designator (numeric-aware, e.g. A-2
// before A-10), then by pin (so D0..D7 of an 8-wide indicator stay in order).
function refdesCompare(a, b) {
  return (
    a.refdes.localeCompare(b.refdes, undefined, { numeric: true }) ||
    a.pin.localeCompare(b.pin, undefined, { numeric: true })
  );
}

// deriveColumns reads a design's bound I/O for the vector table (FR-115b): one
// input column per input switch (its OUT pin), one output column per indicator
// bit — a 1-wide indicator contributes its IN pin, an 8-wide contributes D0..D7.
// Ports (FR-094 / multi-bit portN) are unioned in by effective direction
// (FR-115f): an `in` port becomes an input column, an `out` port an output
// column, each identified by the port's own (refdes, pin) — "P" for a 1-wide
// port, "P"i for a portN bit (N columns, one per bit). A bidir port (no
// override) becomes a bidirectional `io` column (FR-115i): a per-row drive-or-
// observe column, one per bit of a portN. Columns are sorted by refdes/pin for
// a stable table layout, within each of the three groups.
export function deriveColumns(design) {
  const inputs = [];
  const outputs = [];
  const io = [];
  const warnings = [];
  for (const c of design.components ?? []) {
    const rt = c.typeData?.renderType;
    const label = c.label ?? c.refdes;
    if (rt === "switch") {
      inputs.push({ refdes: c.refdes, pin: "OUT", label });
    } else if (rt === "clock") {
      // A clock generator is a scripted input column in a sequential vector set
      // (FR-115e): cells 0/1/C. kind is live-only (dialog options, C validation);
      // it is stripped on save and re-derived on load (§7.7).
      inputs.push({ refdes: c.refdes, pin: "OUT", label, kind: "clock" });
    } else if (rt === "indicator") {
      outputs.push({ refdes: c.refdes, pin: "IN", label });
    } else if (rt === "indicator8") {
      for (let i = 0; i < 8; i++) {
        outputs.push({ refdes: c.refdes, pin: `D${i}`, label: `${label}.D${i}` });
      }
    } else if (rt === "port" || rt === "portN") {
      const dir = effectivePortDir(design, c.refdes);
      // in → input, out → output, bidir → io (a three-state bus column, FR-115i).
      const bucket = dir === "out" ? outputs : dir === "bidir" ? io : inputs;
      const isIo = dir === "bidir";
      if (rt === "portN") {
        const n = (c.typeData.pins ?? []).length;
        for (let i = 0; i < n; i++) {
          bucket.push({ refdes: c.refdes, pin: `P${i}`, label: `${label}${i}`, ...(isIo && { io: true }) });
        }
      } else {
        bucket.push({ refdes: c.refdes, pin: "P", label, ...(isIo && { io: true }) });
      }
    }
  }
  inputs.sort(refdesCompare);
  outputs.sort(refdesCompare);
  io.sort(refdesCompare);
  return { inputs, outputs, io, warnings };
}

// refuseHiddenClocks throws when a flattened design (FR-102/FR-103, §6.14)
// carries a clock generator inside a sub-design or peer sheet — its refdes is
// hierarchical. Scripted-clock vector runs (FR-115e) drive clocks through
// top-sheet columns only; a hidden clock would silently float U, so refuse
// instead (FR-115e deferred scope).
function refuseHiddenClocks(design) {
  const hidden = (design.components ?? []).find(
    (c) => c.typeData?.renderType === "clock" && c.refdes.includes("/"),
  );
  if (hidden) {
    throw new Error(
      `clock generator ${hidden.refdes} is inside a sub-design or peer sheet; ` +
        `test vectors support clocks on the top sheet only`,
    );
  }
}

// actualSymbol maps a settled four-state net value to its display symbol.
function actualSymbol(v) {
  return v === V1 ? "1" : v === V0 ? "0" : v === 2 ? "U" : "Z";
}

// captureSymbol maps a settled output to an expected-cell symbol: a definite 1/0
// becomes H/L; a U or Z (an indeterminate output) becomes X (no assertion).
function captureSymbol(v) {
  return v === V1 ? "H" : v === V0 ? "L" : "X";
}

// captureIoSymbol captures a bidirectional (io) cell (FR-115i): a drive cell
// ("0"/"1") is the author's stimulus and is preserved as-is; a release cell
// ("H"/"L"/"X") is filled from the settled net value (1→H, 0→L, U/Z→X).
function captureIoSymbol(sym, v) {
  return sym === "0" || sym === "1" ? sym : captureSymbol(v);
}

// driveIoCells appends stimulus entries for a row's bidirectional (io) cells
// (FR-115i): a "0"/"1" cell forces its net to that value; an "H"/"L"/"X" cell
// releases the net (contributes nothing), so the design drives it alone.
function driveIoCells(stimulus, io, rowIo = []) {
  io.forEach((col, j) => {
    const sym = rowIo[j];
    if (sym === "0" || sym === "1") {
      stimulus.push({ refdes: col.refdes, pin: col.pin, value: sym === "1" ? V1 : V0 });
    }
  });
}

// simulateRow runs one independent combinational case: a throwaway clone of the
// design driven with the row's input switch states, settled to quiescence exactly
// as the live combinational simulator does (FR-085/FR-115c). Returns the built
// simulation so the caller can read output pins. Never mutates `design`.
function simulateRow(design, inputs, io, row, romContent) {
  const clone = structuredClone(design);
  const byRefdes = new Map(clone.components.map((c) => [c.refdes, c]));
  // A switch input is set via its per-instance state; a port input is driven by
  // external stimulus on its own net (FR-115f) — no placed component. A bidir io
  // drive cell forces its net too (FR-115i); a release cell adds no stimulus.
  const stimulus = [];
  inputs.forEach((col, j) => {
    const inst = byRefdes.get(col.refdes);
    if (!inst) return;
    const rt = inst.typeData?.renderType;
    if (rt === "port" || rt === "portN") {
      stimulus.push({ refdes: col.refdes, pin: col.pin, value: row.in[j] === "1" ? V1 : V0 });
    } else {
      inst.switchState = row.in[j] === "1" ? "1" : "0";
    }
  });
  driveIoCells(stimulus, io, row.io);
  const sim = buildSimulation(clone, { romContent, stimulus });
  for (let i = 0; i < SETTLE_BOUND; i++) {
    sim.step();
    if (!sim.lastStepChanged()) break;
  }
  return sim;
}

// settleSim drives the settle loop: step() until quiescent or the FR-085 bound.
// The same loop serves the combinational per-row settle and every phase of a
// sequential run (FR-115e).
function settleSim(sim) {
  for (let i = 0; i < SETTLE_BOUND; i++) {
    sim.step();
    if (!sim.lastStepChanged()) break;
  }
}

// effectiveProp resolves an instance's named numeric property — the declared
// default overridden per-instance (FR-020b) — mirroring sim.js effectiveProps.
function effectiveProp(inst, name) {
  const decl = (inst.typeData.properties ?? []).find((p) => p.name === name);
  return inst.overrides?.props?.[name] ?? decl?.default;
}

// runSequentialPass executes a sequential vector run (FR-115e) on one clone of
// the design: power-on preamble, then each row in order — apply inputs, settle,
// pulse the row's C clocks, settle — calling onRow(sim, rowIndex) at each row's
// sample point. State persists across rows; the live design is never mutated.
function runSequentialPass(design, inputs, io, rows, romContent, onRow) {
  const clone = structuredClone(design);
  const byRefdes = new Map(clone.components.map((c) => [c.refdes, c]));
  const clocks = clone.components.filter((c) => c.typeData?.renderType === "clock");
  const resets = clone.components.filter((c) => c.typeData?.renderType === "reset");
  // scriptedClocks suppresses the clock/reset simTime behaviors (§6.13); this
  // pass owns their nets through the stimulus list.
  const sim = buildSimulation(clone, { romContent, stimulus: [], scriptedClocks: true });

  // resetEntries drives every reset built-in for the given number of completed
  // preamble pulses: asserted (R=1, /R=0) until its own `cycles` worth of pulses
  // have elapsed (FR-071b analogue), released (R=0, /R=1) after. Infinity ⇒ all
  // released (the per-row state).
  const resetEntries = (pulsesDone) =>
    resets.flatMap((r) => {
      const active = pulsesDone < (effectiveProp(r, "cycles") ?? 3);
      return [
        { refdes: r.refdes, pin: "R", value: active ? V1 : V0 },
        { refdes: r.refdes, pin: "/R", value: active ? V0 : V1 },
      ];
    });
  const clockLevels = (level) =>
    clocks.map((c) => ({ refdes: c.refdes, pin: "OUT", value: level }));

  // Power-on preamble (FR-115e): with every reset asserted, apply max(cycles)
  // scripted pulses; each reset releases on the low phase after its own count
  // (mirroring FR-071b's "half a period after its last rising edge"). A clocked
  // design with no reset built-in has no preamble.
  const maxCycles = resets.length
    ? Math.max(...resets.map((r) => effectiveProp(r, "cycles") ?? 3))
    : 0;
  if (maxCycles > 0) {
    sim.setStimulus([...clockLevels(V0), ...resetEntries(0)]);
    settleSim(sim);
    for (let k = 0; k < maxCycles; k++) {
      sim.setStimulus([...clockLevels(V1), ...resetEntries(k)]);
      settleSim(sim);
      sim.setStimulus([...clockLevels(V0), ...resetEntries(k + 1)]);
      settleSim(sim);
    }
  }

  rows.forEach((row, ri) => {
    // Build the row's stimulus: resets released; each clock at its cell's level
    // (a C cell rests low and is pulsed below); ports per their cell; io drive
    // cells force their nets (FR-115i); switches set on the clone's instances
    // (behaviors read switchState live each step).
    const base = resetEntries(Infinity);
    const pulseClocks = new Set(); // refdes of clocks with a C cell this row
    inputs.forEach((col, j) => {
      const sym = row.in[j];
      const inst = byRefdes.get(col.refdes);
      if (!inst) return;
      const rt = inst.typeData?.renderType;
      if (rt === "clock") {
        base.push({ refdes: col.refdes, pin: "OUT", value: sym === "1" ? V1 : V0 });
        if (sym === "C") pulseClocks.add(col.refdes);
      } else if (rt === "port" || rt === "portN") {
        base.push({ refdes: col.refdes, pin: col.pin, value: sym === "1" ? V1 : V0 });
      } else {
        inst.switchState = sym === "1" ? "1" : "0";
      }
    });
    driveIoCells(base, io, row.io);
    sim.setStimulus(base);
    settleSim(sim);
    if (pulseClocks.size) {
      // One shared positive pulse for every C clock in the row (FR-115e):
      // high, settle, low, settle — outputs are sampled after the pulse.
      const high = base.map((s) =>
        pulseClocks.has(s.refdes) && s.pin === "OUT" ? { ...s, value: V1 } : s,
      );
      sim.setStimulus(high);
      settleSim(sim);
      sim.setStimulus(base);
      settleSim(sim);
    }
    onRow(sim, ri);
  });
}

// scoreOutputs compares each output column's settled net value against the
// row's expected symbols (FR-115c matching, shared by both run modes).
function scoreOutputs(sim, outputs, rowOut) {
  const cells = outputs.map((col, j) => {
    const v = sim.valueOfPin(col.refdes, col.pin);
    const expected = rowOut[j] ?? "X";
    const pass =
      expected === "X" ||
      (expected === "H" && v === V1) ||
      (expected === "L" && v === V0);
    return { expected, actual: actualSymbol(v), pass };
  });
  return { cells, pass: cells.every((c) => c.pass) };
}

// scoreIo evaluates a row's bidirectional (io) cells (FR-115i): a drive cell
// ("0"/"1") is stimulus, reported as { drive } and never failed; a release cell
// ("H"/"L"/"X") is read from its net and scored exactly like an output.
function scoreIo(sim, io, rowIo = []) {
  return io.map((col, j) => {
    const sym = rowIo[j] ?? "X";
    if (sym === "0" || sym === "1") return { drive: sym };
    const v = sim.valueOfPin(col.refdes, col.pin);
    const pass = sym === "X" || (sym === "H" && v === V1) || (sym === "L" && v === V0);
    return { expected: sym, actual: actualSymbol(v), pass };
  });
}

// scoreRow combines output and io scoring for one settled row; the row passes
// when every output cell and every io release cell passes (io drive cells are
// stimulus, not assertions). Returns { cells, io, pass }.
function scoreRow(sim, outputs, io, row) {
  const { cells } = scoreOutputs(sim, outputs, row.out);
  const ioCells = scoreIo(sim, io, row.io);
  const pass =
    cells.every((c) => c.pass) && ioCells.every((c) => c.drive !== undefined || c.pass);
  return { cells, io: ioCells, pass };
}

// runVectors scores a vector set (FR-115d): combinational designs evaluate each
// row independently (FR-115c); a design with a clock generator runs its rows in
// order with scripted clocks and the power-on preamble (FR-115e). Returns
// { rows: [{ cells: [{ expected, actual, pass }], pass }], passed, total }.
// `romContent` (FR-114e) is the Map from loadRomContents; null/omitted for designs
// with no ROM. The live design is never mutated, dirtied, or undone (FR-115c).
export function runVectors(design, { inputs, outputs, io = [], rows }, { romContent = null } = {}) {
  refuseHiddenClocks(design);
  let results;
  if (isStateful(design)) {
    results = new Array(rows.length);
    runSequentialPass(design, inputs, io, rows, romContent, (sim, ri) => {
      results[ri] = scoreRow(sim, outputs, io, rows[ri]);
    });
  } else {
    results = rows.map((row) => {
      const sim = simulateRow(design, inputs, io, row, romContent);
      return scoreRow(sim, outputs, io, row);
    });
  }
  return {
    rows: results,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
  };
}

// captureRow runs one independent combinational row and returns the settled
// outputs and io cells as expected symbols (FR-115b): { out, io }. A U/Z value
// captures as X; an io drive cell (0/1) is preserved as-authored (FR-115i).
export function captureRow(design, { inputs, outputs, io = [] }, rowIn, { romContent = null, rowIo = [] } = {}) {
  const sim = simulateRow(design, inputs, io, { in: rowIn, io: rowIo }, romContent);
  return {
    out: outputs.map((col) => captureSymbol(sim.valueOfPin(col.refdes, col.pin))),
    io: io.map((col, j) => captureIoSymbol(rowIo[j], sim.valueOfPin(col.refdes, col.pin))),
  };
}

// captureVectors fills the whole table's expected cells from the circuit's
// behavior (FR-115b): combinational designs capture each row independently;
// a sequential design runs the same ordered pass as runVectors — preamble,
// then each row's inputs and pulses — recording outputs in sequence (FR-115e).
// Returns { out, io }: one out-symbol array and one io-symbol array per row
// (io release cells filled from the settled net, drive cells preserved, FR-115i).
export function captureVectors(design, { inputs, outputs, io = [] }, rowsIn, { romContent = null, rowsIo = [] } = {}) {
  refuseHiddenClocks(design);
  if (!isStateful(design)) {
    const caps = rowsIn.map((rowIn, i) =>
      captureRow(design, { inputs, outputs, io }, rowIn, { romContent, rowIo: rowsIo[i] ?? [] }),
    );
    return { out: caps.map((c) => c.out), io: caps.map((c) => c.io) };
  }
  const rows = rowsIn.map((rowIn, i) => ({ in: rowIn, io: rowsIo[i] ?? [] }));
  const out = new Array(rows.length);
  const ioOut = new Array(rows.length);
  runSequentialPass(design, inputs, io, rows, romContent, (sim, ri) => {
    out[ri] = outputs.map((col) => captureSymbol(sim.valueOfPin(col.refdes, col.pin)));
    ioOut[ri] = io.map((col, j) => captureIoSymbol(rows[ri].io[j], sim.valueOfPin(col.refdes, col.pin)));
  });
  return { out, io: ioOut };
}

// validateVectors is a pure gate over a doc (FR-115b): every row must have one
// input cell per input column (symbol 0/1), one output cell per output column
// (symbol H/L/X), and one io cell per bidirectional column (symbol 0/1/H/L/X,
// FR-115i). Returns { ok, errors }.
export function validateVectors({ inputs, outputs, io = [], rows }) {
  const errors = [];
  rows.forEach((r, ri) => {
    if (r.in.length !== inputs.length) {
      errors.push(`row ${ri + 1}: expected ${inputs.length} input cells, got ${r.in.length}`);
    }
    if (r.out.length !== outputs.length) {
      errors.push(`row ${ri + 1}: expected ${outputs.length} output cells, got ${r.out.length}`);
    }
    const rowIo = r.io ?? [];
    if (io.length && rowIo.length !== io.length) {
      errors.push(`row ${ri + 1}: expected ${io.length} io cells, got ${rowIo.length}`);
    }
    r.in.forEach((s, ci) => {
      // "C" (one clock pulse, FR-115e) is legal only in a clock column.
      const clockCol = inputs[ci]?.kind === "clock";
      if (s !== "0" && s !== "1" && !(clockCol && s === "C")) {
        errors.push(
          `row ${ri + 1} input ${ci + 1}: "${s}" must be ${clockCol ? "0, 1, or C" : "0 or 1"}`,
        );
      }
    });
    r.out.forEach((s, ci) => {
      if (s !== "H" && s !== "L" && s !== "X") {
        errors.push(`row ${ri + 1} output ${ci + 1}: "${s}" must be H, L, or X`);
      }
    });
    rowIo.forEach((s, ci) => {
      // A bidir cell drives (0/1) or observes (H/L/X) — the union alphabet.
      if (!["0", "1", "H", "L", "X"].includes(s)) {
        errors.push(`row ${ri + 1} io ${ci + 1}: "${s}" must be 0, 1, H, L, or X`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

const colKey = (c) => `${c.refdes}.${c.pin}`;

// serializeVectors returns the JSON-serializable `.tv` object (§7.7). Column
// `kind` markers are live-only (re-derived from the design on load) and are
// stripped, so the file stays a pure (refdes, pin, label) record.
export function serializeVectors({ inputs, outputs, io = [], rows }) {
  const col = (c) => ({ refdes: c.refdes, pin: c.pin, label: c.label });
  return {
    formatVersion: FORMAT_VERSION,
    inputs: inputs.map(col),
    outputs: outputs.map(col),
    io: io.map(col),
    rows: rows.map((r) => ({ in: r.in, io: r.io ?? [], out: r.out })),
  };
}

// deserializeVectors migrates a parsed `.tv` object forward and normalizes it to a
// doc (column labels defaulted, rows shallow-copied). It does not yet bind to a
// design — call reconcileVectors to align it to the design's current columns.
export function deserializeVectors(obj) {
  const o = migrate(obj ?? {});
  const col = (c) => ({ refdes: c.refdes, pin: c.pin, label: c.label ?? c.refdes });
  return {
    inputs: (o.inputs ?? []).map(col),
    outputs: (o.outputs ?? []).map(col),
    io: (o.io ?? []).map(col),
    rows: (o.rows ?? []).map((r) => ({
      in: [...(r.in ?? [])],
      io: [...(r.io ?? [])],
      out: [...(r.out ?? [])],
    })),
  };
}

// reconcileVectors aligns a loaded file (fileDoc) to the design's current columns
// by (refdes,pin) (FR-115a): the returned rows follow `columns` order, pulling each
// cell from the file when that column still matches and defaulting otherwise ("0"
// for inputs, "X" for outputs and io, FR-115i). A column present in only one side
// is a non-fatal warning. Returns { rows, warnings }.
export function reconcileVectors(fileDoc, columns) {
  const warnings = [];
  const inIdx = new Map(fileDoc.inputs.map((c, i) => [colKey(c), i]));
  const outIdx = new Map(fileDoc.outputs.map((c, i) => [colKey(c), i]));
  const ioIdx = new Map((fileDoc.io ?? []).map((c, i) => [colKey(c), i]));
  const curIn = new Set(columns.inputs.map(colKey));
  const curOut = new Set(columns.outputs.map(colKey));
  const curIo = new Set((columns.io ?? []).map(colKey));

  for (const c of fileDoc.inputs) {
    if (!curIn.has(colKey(c))) warnings.push(`input ${c.label} (${colKey(c)}) is in the file but not the design`);
  }
  for (const c of fileDoc.outputs) {
    if (!curOut.has(colKey(c))) warnings.push(`output ${c.label} (${colKey(c)}) is in the file but not the design`);
  }
  for (const c of fileDoc.io ?? []) {
    if (!curIo.has(colKey(c))) warnings.push(`io ${c.label} (${colKey(c)}) is in the file but not the design`);
  }
  for (const c of columns.inputs) {
    if (!inIdx.has(colKey(c))) warnings.push(`input ${c.label} (${colKey(c)}) is in the design but not the file`);
  }
  for (const c of columns.outputs) {
    if (!outIdx.has(colKey(c))) warnings.push(`output ${c.label} (${colKey(c)}) is in the design but not the file`);
  }
  for (const c of columns.io ?? []) {
    if (!ioIdx.has(colKey(c))) warnings.push(`io ${c.label} (${colKey(c)}) is in the design but not the file`);
  }

  const rows = fileDoc.rows.map((r) => ({
    in: columns.inputs.map((c) => {
      const dflt = c.kind === "clock" ? "C" : "0"; // match emptyRow's defaults
      const i = inIdx.get(colKey(c));
      return i !== undefined ? (r.in[i] ?? dflt) : dflt;
    }),
    io: (columns.io ?? []).map((c) => {
      const i = ioIdx.get(colKey(c));
      return i !== undefined ? (r.io?.[i] ?? "X") : "X";
    }),
    out: columns.outputs.map((c) => {
      const i = outIdx.get(colKey(c));
      return i !== undefined ? (r.out[i] ?? "X") : "X";
    }),
  }));
  return { rows, warnings };
}

// emptyRow returns a fresh row sized to the columns: inputs default 0 — except a
// clock column, which defaults C so one new row is one clock cycle (FR-115e) —
// and outputs and io cells default X (FR-115i: X = release, don't-check).
export function emptyRow(columns) {
  return {
    in: columns.inputs.map((c) => (c.kind === "clock" ? "C" : "0")),
    io: (columns.io ?? []).map(() => "X"),
    out: columns.outputs.map(() => "X"),
  };
}
