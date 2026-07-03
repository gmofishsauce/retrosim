// parity.js — fast-vs-slow engine parity harness (FR-107, design §6.17 M2).
//
// For each design+`.tv` pair under examples/, run the SAME reconciled vector
// rows through both engines and require identical results:
//   slow (JS): runVectors (§6.16), rendered into the FR-118 transcript format
//   fast (C):  generateC → cc → feed rows on stdin → read stdout transcript
// A per-row / summary line-diff is the FR-107 check. Designs the generator
// refuses (sub-design scope, FR-116) are reported as skips.
//
// A second, free-run leg (FR-117a, design §6.17 M4) checks every
// examples/*.json design the generator accepts, `.tv` or not: the slow
// simulator runs free (time-driven built-ins) for 8 × clockPeriod unit steps
// — 8 cycles clears the default 3-cycle reset window (FR-071b) — its
// observable columns are rendered as the FR-117a "LABEL=v" dump, and the
// compiled program's `--cycles 8` stdout is line-diffed against it.
//
// Run explicitly:  node web/tools/parity.js
// Exits 0 iff every processed check matched.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { deserializeDesign } from "../js/model/persist.js";
import { generateC } from "../js/engine/cgen.js";
import { parseRomBytes } from "../js/engine/memory.js";
import { buildSimulation } from "../js/engine/sim.js";
import {
  deriveColumns,
  deserializeVectors,
  reconcileVectors,
  runVectors,
} from "../js/engine/vectors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "..", "examples");
const RT_DIR = join(HERE, "..", "cgen");

// renderExpected renders a runVectors result into the exact stdout transcript
// the generated program prints (runtime.c score_row + summary, FR-118), so the
// two engines can be line-diffed. Actuals ('0'/'1'/'U'/'Z') are identical on
// both sides (vectors.js actualSymbol == runtime.c valchar).
function renderExpected(result, outputs) {
  const lines = [];
  result.rows.forEach((r, i) => {
    if (r.pass) {
      lines.push(`row ${i + 1}: pass`);
    } else {
      let s = `row ${i + 1}: FAIL`;
      r.cells.forEach((c, j) => {
        if (!c.pass) s += ` ${outputs[j].label}=${c.actual}`;
      });
      lines.push(s);
    }
  });
  lines.push(`passed ${result.passed} of ${result.total} rows`);
  return lines.join("\n");
}

// runFast generates <design>.c, compiles it against the runtime pair in a
// temp dir, runs it with `args` feeding `stdin`, and returns its stdout.
function runFast(code, stdin, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  try {
    writeFileSync(join(dir, "design.c"), code);
    copyFileSync(join(RT_DIR, "runtime.c"), join(dir, "runtime.c"));
    copyFileSync(join(RT_DIR, "runtime.h"), join(dir, "runtime.h"));
    const cc = spawnSync("cc", ["design.c", "runtime.c", "-o", "sim"], { cwd: dir, encoding: "utf8" });
    if (cc.status !== 0) throw new Error(`cc failed:\n${cc.stderr}`);
    const run = spawnSync(join(dir, "sim"), args, { input: stdin, encoding: "utf8" });
    if (run.stderr) process.stderr.write(run.stderr); // FR-108 conflict reports
    return run.stdout.trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// loadRomContentsFs is the Node analogue of sim.js loadRomContents (FR-114e):
// it reads each ROM's content file from disk (the browser loader's fetch is
// unavailable here). A romFile is tried as given, then by basename in the
// design's own directory, so an example stays testable regardless of the
// absolute path baked in its type. A missing/unreadable file is skipped (that
// ROM reads U on both engines, so parity still holds).
function loadRomContentsFs(design, dir) {
  const content = new Map();
  for (const inst of design.components ?? []) {
    const mem = inst.typeData?.mem;
    if (!mem || mem.kind !== "rom" || !mem.romFile || content.has(mem.romFile)) continue;
    const lower = mem.romFile.toLowerCase();
    const format = lower.endsWith(".bin") ? "bin" : lower.endsWith(".hex") ? "hex" : null;
    if (!format) continue;
    for (const p of [mem.romFile, join(dir, basename(mem.romFile))]) {
      try {
        content.set(mem.romFile, parseRomBytes(readFileSync(p), format));
        break;
      } catch {
        /* try next candidate */
      }
    }
  }
  return content;
}

function checkPair(jsonPath, tvPath) {
  const name = basename(jsonPath, ".json");
  const design = deserializeDesign(JSON.parse(readFileSync(jsonPath, "utf8")));
  const romContent = loadRomContentsFs(design, dirname(jsonPath));

  let gen;
  try {
    gen = generateC(design, { romContent });
  } catch (e) {
    return { name, status: "skip", detail: e.message };
  }

  const columns = deriveColumns(design);
  const fileDoc = deserializeVectors(JSON.parse(readFileSync(tvPath, "utf8")));
  const { rows } = reconcileVectors(fileDoc, columns);

  const expected = renderExpected(
    runVectors(design, { inputs: columns.inputs, outputs: columns.outputs, rows }, { romContent }),
    columns.outputs,
  );
  const stdin = rows.map((r) => `${r.in.join(" ")} | ${r.out.join(" ")}`).join("\n") + "\n";
  const actual = runFast(gen.code, stdin);

  if (actual === expected) return { name, status: "ok", detail: `${rows.length} rows` };
  return { name, status: "diff", detail: diff(expected, actual) };
}

// Free-run cycle count: past the reset built-in's default 3-cycle window
// (FR-071b), so post-reset behavior is exercised too.
const FREE_CYCLES = 8;

// checkFree runs the free-run leg (FR-117a) on one design: the slow simulator
// stepped FREE_CYCLES × clockPeriod units with its time-driven built-ins,
// rendered as the "LABEL=v" observable dump, vs the program's --cycles output.
function checkFree(jsonPath) {
  const name = basename(jsonPath, ".json");
  const design = deserializeDesign(JSON.parse(readFileSync(jsonPath, "utf8")));
  const romContent = loadRomContentsFs(design, dirname(jsonPath));

  let gen;
  try {
    gen = generateC(design, { romContent });
  } catch (e) {
    return { name, status: "skip", detail: e.message };
  }

  // clockPeriod (FR-071b): the lone clock's effective period when the design
  // has exactly one clock generator, else the 100 ns default (sim.js §6.13).
  const clocks = (design.components ?? []).filter((c) => c.typeData?.renderType === "clock");
  const period =
    clocks.length === 1
      ? clocks[0].overrides?.props?.period ??
        clocks[0].typeData?.properties?.find((p) => p.name === "period")?.default ??
        100
      : 100;

  const sim = buildSimulation(design, { onMessage: () => {}, romContent });
  for (let i = 0; i < FREE_CYCLES * period; i++) sim.step();

  // Render the observable dump exactly as runtime.c rt_run_free prints it:
  // input columns then output columns, LABEL=v. The value codes are identical
  // on both sides (V0/V1/VU/VZ == RT_0/RT_1/RT_U/RT_Z == 0..3).
  const SYM = ["0", "1", "U", "Z"];
  const cols = deriveColumns(design);
  const expected = [...cols.inputs, ...cols.outputs]
    .map((c) => `${c.label}=${SYM[sim.valueOfPin(c.refdes, c.pin)]}`)
    .join("\n");
  const actual = runFast(gen.code, "", ["--cycles", String(FREE_CYCLES)]);

  if (actual === expected) return { name, status: "ok", detail: `free run, ${FREE_CYCLES} cycles` };
  return { name, status: "diff", detail: diff(expected, actual) };
}

function diff(expected, actual) {
  const e = expected.split("\n");
  const a = actual.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] !== a[i]) out.push(`  slow: ${e[i] ?? "<none>"}\n  fast: ${a[i] ?? "<none>"}`);
  }
  return out.join("\n");
}

const pairs = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".tv"))
  .map((tv) => ({ tv: join(EXAMPLES, tv), json: join(EXAMPLES, tv.slice(0, -3) + ".json") }))
  .filter((p) => {
    try {
      readFileSync(p.json);
      return true;
    } catch {
      return false;
    }
  });

const designs = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(EXAMPLES, f));

let failed = 0;
function report(r) {
  if (r.status === "ok") console.log(`OK   ${r.name} (${r.detail})`);
  else if (r.status === "skip") console.log(`SKIP ${r.name}: ${r.detail}`);
  else {
    failed++;
    console.log(`DIFF ${r.name}:\n${r.detail}`);
  }
}

for (const p of pairs) report(checkPair(p.json, p.tv));
for (const d of designs) report(checkFree(d));
console.log(`\n${pairs.length + designs.length} checks, ${failed} mismatched`);
process.exit(failed ? 1 : 0);
