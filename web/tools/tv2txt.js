// tv2txt — convert a .tv test-vector file (FR-115a) into the plain-text row
// stream a generated fast-engine program reads on stdin (FR-117), reconciling
// the file's (refdes,pin) columns to the program's baked column order.
//
// Usage:  node tv2txt.js <program> <file.tv>
//         node tv2txt.js ./sim design.tv | ./sim
//
// It runs `<program> --columns` to learn the baked column set (so it needs no
// design file), then reuses deserializeVectors + reconcileVectors (§6.16, the
// same alignment the panel does on load) to emit rows positional against that
// set — inputs default 0 (clock columns C), outputs X (design §6.17 M2).
// Reconciliation warnings go to stderr; the rows go to stdout.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { deserializeVectors, reconcileVectors } from "../js/engine/vectors.js";

function die(msg) {
  process.stderr.write(`tv2txt: ${msg}\n`);
  process.exit(2);
}

const [program, tvPath] = process.argv.slice(2);
if (!program || !tvPath) die("usage: node tv2txt.js <program> <file.tv>");

// Column set from the program itself: one line per column,
// "DIR KIND REFDES PIN LABEL..." (LABEL is the remainder, may contain spaces).
const dump = spawnSync(program, ["--columns"], { encoding: "utf8" });
if (dump.error) die(`cannot run ${program}: ${dump.error.message}`);
if (dump.status !== 0) die(`${program} --columns exited ${dump.status}`);

const columns = { inputs: [], outputs: [] };
for (const line of dump.stdout.split("\n")) {
  if (!line.trim()) continue;
  const t = line.split(/\s+/);
  const [dir, kind, refdes, pin] = t;
  const label = t.slice(4).join(" ");
  const col = { refdes, pin, label };
  if (dir === "IN") {
    if (kind === "CLOCK") col.kind = "clock"; // clock default is C, not 0
    columns.inputs.push(col);
  } else if (dir === "OUT") {
    columns.outputs.push(col);
  } else {
    die(`unrecognized --columns line: ${line}`);
  }
}

const fileDoc = deserializeVectors(JSON.parse(readFileSync(tvPath, "utf8")));
const { rows, warnings } = reconcileVectors(fileDoc, columns);
for (const w of warnings) process.stderr.write(`tv2txt: warning: ${w}\n`);

let out = "";
for (const r of rows) out += `${r.in.join(" ")} | ${r.out.join(" ")}\n`;
process.stdout.write(out);
