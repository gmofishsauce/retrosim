// Test vectors (§6.16, FR-115): a DOM-free runner and file model for an authored
// table of input patterns + expected outputs, scored against the slow simulator.
// v1 is combinational-only (FR-115c): each row is independent — drive the input
// switches, settle to quiescence (FR-085), then compare the output indicators.
//
// Shapes used throughout:
//   column  { refdes, pin, label }              — one bound switch output / indicator bit
//   doc     { inputs: column[], outputs: column[], rows: row[] }
//   row     { in: ("0"|"1")[], out: ("H"|"L"|"X")[] }  aligned to inputs/outputs
// The `.tv` file (§7.7) is a doc plus a `formatVersion`.

import { buildSimulation, SETTLE_BOUND } from "./sim.js";
import { V0, V1 } from "./galasm.js";
import { effectivePortDir } from "../model/subdesign.js";

// FORMAT_VERSION is the `.tv` file format this client writes and understands
// (§7.7); mirror persist.js — bump it and add a MIGRATIONS step on any change.
export const FORMAT_VERSION = 1;

// MIGRATIONS upgrades a parsed `.tv` object across a single format version:
// MIGRATIONS[n] takes a version-n object to version-(n+1). Empty while only v1
// exists (mirrors model/persist.js §7.4).
const MIGRATIONS = {};

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
// override) cannot be a single column and is skipped with a non-fatal warning.
// Columns are sorted by refdes/pin for a stable table layout.
export function deriveColumns(design) {
  const inputs = [];
  const outputs = [];
  const warnings = [];
  for (const c of design.components ?? []) {
    const rt = c.typeData?.renderType;
    const label = c.label ?? c.refdes;
    if (rt === "switch") {
      inputs.push({ refdes: c.refdes, pin: "OUT", label });
    } else if (rt === "indicator") {
      outputs.push({ refdes: c.refdes, pin: "IN", label });
    } else if (rt === "indicator8") {
      for (let i = 0; i < 8; i++) {
        outputs.push({ refdes: c.refdes, pin: `D${i}`, label: `${label}.D${i}` });
      }
    } else if (rt === "port" || rt === "portN") {
      const dir = effectivePortDir(design, c.refdes);
      if (dir === "bidir") {
        warnings.push(
          `port ${label} (${c.refdes}) is bidirectional; set its direction ` +
            `override to bind it as a test-vector column`,
        );
        continue;
      }
      const bucket = dir === "out" ? outputs : inputs;
      if (rt === "portN") {
        const n = (c.typeData.pins ?? []).length;
        for (let i = 0; i < n; i++) {
          bucket.push({ refdes: c.refdes, pin: `P${i}`, label: `${label}${i}` });
        }
      } else {
        bucket.push({ refdes: c.refdes, pin: "P", label });
      }
    }
  }
  inputs.sort(refdesCompare);
  outputs.sort(refdesCompare);
  return { inputs, outputs, warnings };
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

// simulateRow runs one independent combinational case: a throwaway clone of the
// design driven with the row's input switch states, settled to quiescence exactly
// as the live combinational simulator does (FR-085/FR-115c). Returns the built
// simulation so the caller can read output pins. Never mutates `design`.
function simulateRow(design, inputs, rowIn, romContent) {
  const clone = structuredClone(design);
  const byRefdes = new Map(clone.components.map((c) => [c.refdes, c]));
  // A switch input is set via its per-instance state; a port input is driven by
  // external stimulus on its own net (FR-115f) — no placed component.
  const stimulus = [];
  inputs.forEach((col, j) => {
    const inst = byRefdes.get(col.refdes);
    if (!inst) return;
    const rt = inst.typeData?.renderType;
    if (rt === "port" || rt === "portN") {
      stimulus.push({ refdes: col.refdes, pin: col.pin, value: rowIn[j] === "1" ? V1 : V0 });
    } else {
      inst.switchState = rowIn[j] === "1" ? "1" : "0";
    }
  });
  const sim = buildSimulation(clone, { romContent, stimulus });
  for (let i = 0; i < SETTLE_BOUND; i++) {
    sim.step();
    if (!sim.lastStepChanged()) break;
  }
  return sim;
}

// runVectors evaluates every row independently and scores it (FR-115c/FR-115d).
// Returns { rows: [{ cells: [{ expected, actual, pass }], pass }], passed, total }.
// `romContent` (FR-114e) is the Map from loadRomContents; null/omitted for designs
// with no ROM. The live design is never mutated, dirtied, or undone (FR-115c).
export function runVectors(design, { inputs, outputs, rows }, { romContent = null } = {}) {
  const results = rows.map((row) => {
    const sim = simulateRow(design, inputs, row.in, romContent);
    const cells = outputs.map((col, j) => {
      const v = sim.valueOfPin(col.refdes, col.pin);
      const expected = row.out[j] ?? "X";
      const pass =
        expected === "X" ||
        (expected === "H" && v === V1) ||
        (expected === "L" && v === V0);
      return { expected, actual: actualSymbol(v), pass };
    });
    return { cells, pass: cells.every((c) => c.pass) };
  });
  return {
    rows: results,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
  };
}

// captureRow runs one row's inputs and returns the settled outputs as expected
// symbols (FR-115b): the golden-table authoring helper. A U/Z output captures as X.
export function captureRow(design, { inputs, outputs }, rowIn, { romContent = null } = {}) {
  const sim = simulateRow(design, inputs, rowIn, romContent);
  return outputs.map((col) => captureSymbol(sim.valueOfPin(col.refdes, col.pin)));
}

// validateVectors is a pure gate over a doc (FR-115b): every row must have one
// input cell per input column (symbol 0/1) and one output cell per output column
// (symbol H/L/X). Returns { ok, errors }.
export function validateVectors({ inputs, outputs, rows }) {
  const errors = [];
  rows.forEach((r, ri) => {
    if (r.in.length !== inputs.length) {
      errors.push(`row ${ri + 1}: expected ${inputs.length} input cells, got ${r.in.length}`);
    }
    if (r.out.length !== outputs.length) {
      errors.push(`row ${ri + 1}: expected ${outputs.length} output cells, got ${r.out.length}`);
    }
    r.in.forEach((s, ci) => {
      if (s !== "0" && s !== "1") errors.push(`row ${ri + 1} input ${ci + 1}: "${s}" must be 0 or 1`);
    });
    r.out.forEach((s, ci) => {
      if (s !== "H" && s !== "L" && s !== "X") {
        errors.push(`row ${ri + 1} output ${ci + 1}: "${s}" must be H, L, or X`);
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

const colKey = (c) => `${c.refdes}.${c.pin}`;

// serializeVectors returns the JSON-serializable `.tv` object (§7.7).
export function serializeVectors({ inputs, outputs, rows }) {
  return { formatVersion: FORMAT_VERSION, inputs, outputs, rows };
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
    rows: (o.rows ?? []).map((r) => ({ in: [...(r.in ?? [])], out: [...(r.out ?? [])] })),
  };
}

// reconcileVectors aligns a loaded file (fileDoc) to the design's current columns
// by (refdes,pin) (FR-115a): the returned rows follow `columns` order, pulling each
// cell from the file when that column still matches and defaulting otherwise ("0"
// for inputs, "X" for outputs). A column present in only one side is a non-fatal
// warning. Returns { rows, warnings }.
export function reconcileVectors(fileDoc, columns) {
  const warnings = [];
  const inIdx = new Map(fileDoc.inputs.map((c, i) => [colKey(c), i]));
  const outIdx = new Map(fileDoc.outputs.map((c, i) => [colKey(c), i]));
  const curIn = new Set(columns.inputs.map(colKey));
  const curOut = new Set(columns.outputs.map(colKey));

  for (const c of fileDoc.inputs) {
    if (!curIn.has(colKey(c))) warnings.push(`input ${c.label} (${colKey(c)}) is in the file but not the design`);
  }
  for (const c of fileDoc.outputs) {
    if (!curOut.has(colKey(c))) warnings.push(`output ${c.label} (${colKey(c)}) is in the file but not the design`);
  }
  for (const c of columns.inputs) {
    if (!inIdx.has(colKey(c))) warnings.push(`input ${c.label} (${colKey(c)}) is in the design but not the file`);
  }
  for (const c of columns.outputs) {
    if (!outIdx.has(colKey(c))) warnings.push(`output ${c.label} (${colKey(c)}) is in the design but not the file`);
  }

  const rows = fileDoc.rows.map((r) => ({
    in: columns.inputs.map((c) => {
      const i = inIdx.get(colKey(c));
      return i !== undefined ? (r.in[i] ?? "0") : "0";
    }),
    out: columns.outputs.map((c) => {
      const i = outIdx.get(colKey(c));
      return i !== undefined ? (r.out[i] ?? "X") : "X";
    }),
  }));
  return { rows, warnings };
}

// emptyRow returns a fresh row sized to the columns: inputs default 0, outputs X.
export function emptyRow(columns) {
  return {
    in: columns.inputs.map(() => "0"),
    out: columns.outputs.map(() => "X"),
  };
}
