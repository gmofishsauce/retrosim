// parity.js — fast-vs-slow engine parity harness (FR-107, design §6.17 M2).
//
// For each design+`.tv` pair under examples/, run the SAME reconciled vector
// rows through both engines and require identical results:
//   slow (JS): runVectors (§6.16), rendered into the FR-118 transcript format
//   fast (C):  generateC → cc → feed rows on stdin → read stdout transcript
// A per-row / summary line-diff is the FR-107 check. Designs the generator
// refuses (memory/sub-design/.R — M3+ scope) are reported as skips.
//
// Run explicitly:  node web/tools/parity.js
// Exits 0 iff every processed pair matched.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { deserializeDesign } from "../js/model/persist.js";
import { generateC } from "../js/engine/cgen.js";
import { parseRomBytes } from "../js/engine/memory.js";
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
// temp dir, feeds `stdin`, and returns the program's stdout transcript.
function runFast(code, stdin) {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  try {
    writeFileSync(join(dir, "design.c"), code);
    copyFileSync(join(RT_DIR, "runtime.c"), join(dir, "runtime.c"));
    copyFileSync(join(RT_DIR, "runtime.h"), join(dir, "runtime.h"));
    const cc = spawnSync("cc", ["design.c", "runtime.c", "-o", "sim"], { cwd: dir, encoding: "utf8" });
    if (cc.status !== 0) throw new Error(`cc failed:\n${cc.stderr}`);
    const run = spawnSync(join(dir, "sim"), [], { input: stdin, encoding: "utf8" });
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

let failed = 0;
for (const p of pairs) {
  const r = checkPair(p.json, p.tv);
  if (r.status === "ok") console.log(`OK   ${r.name} (${r.detail})`);
  else if (r.status === "skip") console.log(`SKIP ${r.name}: ${r.detail}`);
  else {
    failed++;
    console.log(`DIFF ${r.name}:\n${r.detail}`);
  }
}
console.log(`\n${pairs.length} pairs, ${failed} mismatched`);
process.exit(failed ? 1 : 0);
