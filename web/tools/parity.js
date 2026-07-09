// parity.js — fast-vs-slow engine parity harness (FR-107, design §6.17 M2).
//
// For each design+`.tv` pair under examples/, run the SAME reconciled vector
// rows through both engines and require identical results:
//   slow (JS): runVectors (§6.16), rendered into the FR-118 transcript format
//   fast (C):  generateC → cc → feed rows on stdin → read stdout transcript
// A per-row / summary line-diff is the FR-107 check. Both engines run the
// FLATTENED design (FR-116 hierarchy; columns derive from the root); a design
// that fails to flatten or generate is reported as a skip.
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
import { flatten } from "../js/model/subdesign.js";
import { generateC } from "../js/engine/cgen.js";
import { parseRomBytes } from "../js/engine/memory.js";
import { buildSimulation, ramFileBody } from "../js/engine/sim.js";
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

// romArgsFs builds the --rom REFDES=FILE arguments pointing the compiled
// program at the same content files the JS engine loads (FR-117b). The
// program could resolve its baked path itself, but parity always passes
// explicit overrides — machine-independent, and it exercises the --rom
// path. Candidates as in loadRomContentsFs; an unresolvable file passes no
// override (the program falls back to its baked path).
function romArgsFs(design, dir) {
  const args = [];
  for (const inst of design.components ?? []) {
    const mem = inst.typeData?.mem;
    if (!mem || mem.kind !== "rom" || !mem.romFile) continue;
    for (const p of [mem.romFile, join(dir, basename(mem.romFile))]) {
      try {
        readFileSync(p); // existence probe
        args.push("--rom", `${inst.refdes}=${p}`);
        break;
      } catch {
        /* try next candidate */
      }
    }
  }
  return args;
}

// loadChildFs reads a child/peer sheet from disk for flatten (FR-102/FR-103);
// the Node analogue of the browser's /design/load reader.
const loadChildFs = async (p) => JSON.parse(readFileSync(p, "utf8"));

async function checkPair(jsonPath, tvPath) {
  const name = basename(jsonPath, ".json");
  const design = deserializeDesign(JSON.parse(readFileSync(jsonPath, "utf8")));

  // Flatten sub-designs/peer sheets for both engines (FR-116 hierarchy);
  // columns still derive from the root design (root-for-columns split).
  let flat, gen;
  try {
    flat = await flatten(design, loadChildFs, { rootPath: jsonPath });
    gen = generateC(flat, { columnsFrom: design });
  } catch (e) {
    return { name, status: "skip", detail: e.message };
  }
  const romContent = loadRomContentsFs(flat, dirname(jsonPath));

  const columns = deriveColumns(design);
  const fileDoc = deserializeVectors(JSON.parse(readFileSync(tvPath, "utf8")));
  const { rows } = reconcileVectors(fileDoc, columns);

  const expected = renderExpected(
    runVectors(flat, { inputs: columns.inputs, outputs: columns.outputs, rows }, { romContent }),
    columns.outputs,
  );
  const stdin = rows.map((r) => `${r.in.join(" ")} | ${r.out.join(" ")}`).join("\n") + "\n";
  const actual = runFast(gen.code, stdin, romArgsFs(flat, dirname(jsonPath)));

  if (actual === expected) return { name, status: "ok", detail: `${rows.length} rows` };
  return { name, status: "diff", detail: diff(expected, actual) };
}

// Free-run cycle count: past the reset built-in's default 3-cycle window
// (FR-071b), so post-reset behavior is exercised too.
const FREE_CYCLES = 8;

// checkFree runs the free-run leg (FR-117a) on one design: the slow simulator
// stepped FREE_CYCLES × clockPeriod units with its time-driven built-ins,
// rendered as the "LABEL=v" observable dump, vs the program's --cycles output.
async function checkFree(jsonPath) {
  const name = basename(jsonPath, ".json");
  const design = deserializeDesign(JSON.parse(readFileSync(jsonPath, "utf8")));

  let flat, gen;
  try {
    flat = await flatten(design, loadChildFs, { rootPath: jsonPath });
    gen = generateC(flat, { columnsFrom: design });
  } catch (e) {
    return { name, status: "skip", detail: e.message };
  }
  const romContent = loadRomContentsFs(flat, dirname(jsonPath));

  // clockPeriod (FR-071b): the lone clock's effective period when the design
  // has exactly one clock generator, else the 100 ns default (sim.js §6.13).
  // From the FLAT design — the runtime's clock_period reads gen_clocks, which
  // includes flattened child clocks.
  const clocks = (flat.components ?? []).filter((c) => c.typeData?.renderType === "clock");
  const period =
    clocks.length === 1
      ? clocks[0].overrides?.props?.period ??
        clocks[0].typeData?.properties?.find((p) => p.name === "period")?.default ??
        100
      : 100;

  const sim = buildSimulation(flat, { onMessage: () => {}, romContent });
  for (let i = 0; i < FREE_CYCLES * period; i++) sim.step();

  // Render the observable dump exactly as runtime.c rt_run_free prints it:
  // input columns then output columns, LABEL=v. The value codes are identical
  // on both sides (V0/V1/VU/VZ == RT_0/RT_1/RT_U/RT_Z == 0..3).
  const SYM = ["0", "1", "U", "Z"];
  const cols = deriveColumns(design);
  const expected = [...cols.inputs, ...cols.outputs]
    .map((c) => `${c.label}=${SYM[sim.valueOfPin(c.refdes, c.pin)]}`)
    .join("\n");
  const actual = runFast(gen.code, "", [
    ...romArgsFs(design, dirname(jsonPath)),
    "--cycles",
    String(FREE_CYCLES),
  ]);

  if (actual === expected) return { name, status: "ok", detail: `free run, ${FREE_CYCLES} cycles` };
  return { name, status: "diff", detail: diff(expected, actual) };
}

// clockPeriodOf mirrors runtime.c clock_period / checkFree: the lone clock's
// effective period when the design has exactly one clock generator, else 100 ns.
function clockPeriodOf(flat) {
  const clocks = (flat.components ?? []).filter((c) => c.typeData?.renderType === "clock");
  if (clocks.length !== 1) return 100;
  return (
    clocks[0].overrides?.props?.period ??
    clocks[0].typeData?.properties?.find((p) => p.name === "period")?.default ??
    100
  );
}

// persistentRamMems returns the flat design's persistent-RAM mem blocks (FR-117c:
// kind ram with a save file), each with its baked save-file path.
function persistentRamMems(flat) {
  return (flat.components ?? [])
    .map((c) => c.typeData?.mem)
    .filter((m) => m && m.kind === "ram" && m.ramFile);
}

// f0Bytes builds a deterministic non-trivial initial save-file image for one RAM
// (capacity locations, B=ceil(width/8) little-endian bytes each): location k
// holds k, so both engines get identical prepared contents to load.
function f0Bytes(m) {
  const B = Math.ceil(m.dataWidth / 8);
  const cap = 2 ** m.addressBits;
  const bytes = new Uint8Array(cap * B);
  for (let k = 0; k < cap; k++) {
    for (let b = 0; b < B; b++) bytes[k * B + b] = (k >>> (b * 8)) & 0xff;
  }
  return bytes;
}

// checkRamPersist is the persistent-RAM round-trip leg (FR-117c): seed each RAM's
// baked save file with a prepared image, run BOTH engines free for the same
// FREE_CYCLES, and require the file the fast program writes back to equal the
// slow simulator's final RAM dump (ramFileBody of core.dumpBytes). This covers
// the new fast-engine load-on-start (mem_load_all RAM branch) and write-on-exit
// (mem_save_all) against the slow engine's load/dump reference. Vector mode is
// NOT checked: a slow-engine test-vector run never persists (FR-114g), so free
// run is the only mode with a slow counterpart. The baked save-file path is a
// bare basename, so the program resolves it in its (temp) working directory.
async function checkRamPersist(jsonPath) {
  const name = basename(jsonPath, ".json");
  const design = deserializeDesign(JSON.parse(readFileSync(jsonPath, "utf8")));

  let flat, gen;
  try {
    flat = await flatten(design, loadChildFs, { rootPath: jsonPath });
    gen = generateC(flat, { columnsFrom: design });
  } catch (e) {
    return { name, status: "skip", detail: e.message };
  }
  const mems = persistentRamMems(flat);
  if (!mems.length) return { name, status: "skip", detail: "no persistent RAM" };
  const romContent = loadRomContentsFs(flat, dirname(jsonPath));
  const period = clockPeriodOf(flat);

  const dir = mkdtempSync(join(tmpdir(), "parity-ram-"));
  try {
    writeFileSync(join(dir, "design.c"), gen.code);
    copyFileSync(join(RT_DIR, "runtime.c"), join(dir, "runtime.c"));
    copyFileSync(join(RT_DIR, "runtime.h"), join(dir, "runtime.h"));

    // Seed each RAM's save file (F0) in the program's cwd, and hand the same
    // bytes to the slow engine via ramContent (keyed by the baked path).
    const ramContent = new Map();
    for (const m of mems) {
      const base = basename(m.ramFile);
      const format = base.toLowerCase().endsWith(".hex") ? "hex" : "bin";
      const body = ramFileBody(m.ramFile, f0Bytes(m)); // hex string | raw bytes
      writeFileSync(join(dir, base), body);
      ramContent.set(m.ramFile, parseRomBytes(readFileSync(join(dir, base)), format));
    }

    // Slow engine: step FREE_CYCLES × period, then the final dump per RAM is the
    // reference for what the fast program must have written.
    const sim = buildSimulation(flat, { onMessage: () => {}, romContent, ramContent });
    for (let i = 0; i < FREE_CYCLES * period; i++) sim.step();
    const expected = new Map(
      sim.persistentRams().map((r) => [basename(r.ramFile), ramFileBody(r.ramFile, r.dumpBytes())]),
    );

    // Fast engine: compile and run --cycles FREE_CYCLES; it loads each F0, runs,
    // and writes each save file back in place.
    const cc = spawnSync("cc", ["design.c", "runtime.c", "-o", "sim"], { cwd: dir, encoding: "utf8" });
    if (cc.status !== 0) throw new Error(`cc failed:\n${cc.stderr}`);
    const run = spawnSync(join(dir, "sim"), ["--cycles", String(FREE_CYCLES)], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`sim exited ${run.status}:\n${run.stderr}`);

    for (const m of mems) {
      const base = basename(m.ramFile);
      const format = base.toLowerCase().endsWith(".hex") ? "hex" : "bin";
      const want = expected.get(base);
      const got = format === "hex" ? readFileSync(join(dir, base), "utf8") : readFileSync(join(dir, base));
      const eq = format === "hex" ? got === want : Buffer.compare(got, Buffer.from(want)) === 0;
      if (!eq) {
        const show = (v) => (format === "hex" ? v : [...v].map((b) => b.toString(16).padStart(2, "0")).join(" "));
        return { name, status: "diff", detail: `  ${base}\n  slow: ${show(want)}\n  fast: ${show(got)}` };
      }
    }
    return { name, status: "ok", detail: `persist round-trip, ${FREE_CYCLES} cycles` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// hasPersistentRam scans a design file for a persistent RAM (FR-117c) — a light
// JSON probe, no deserialize — so those designs take the dedicated round-trip
// leg instead of the generic free-run leg (whose all-U run would also emit a
// misleading "cannot load" for the absent save file).
function hasPersistentRam(jsonPath) {
  try {
    const d = JSON.parse(readFileSync(jsonPath, "utf8"));
    return (d.components ?? []).some((c) => {
      const m = c.typeData?.mem;
      return m && m.kind === "ram" && m.ramFile;
    });
  } catch {
    return false;
  }
}

const allDesigns = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => join(EXAMPLES, f));
const persistDesigns = allDesigns.filter(hasPersistentRam);
const designs = allDesigns.filter((d) => !hasPersistentRam(d));

let failed = 0;
function report(r) {
  if (r.status === "ok") console.log(`OK   ${r.name} (${r.detail})`);
  else if (r.status === "skip") console.log(`SKIP ${r.name}: ${r.detail}`);
  else {
    failed++;
    console.log(`DIFF ${r.name}:\n${r.detail}`);
  }
}

for (const p of pairs) report(await checkPair(p.json, p.tv));
for (const d of designs) report(await checkFree(d));
for (const d of persistDesigns) report(await checkRamPersist(d));
console.log(`\n${pairs.length + designs.length + persistDesigns.length} checks, ${failed} mismatched`);
process.exit(failed ? 1 : 0);
