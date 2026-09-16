// check-cpu.mjs — end-to-end regression check for the examples/cpu RiSC-16 CPU.
//
// Loads core.json exactly as the editor does (deserialize + flatten + the slow
// simulator), runs a test program out of an injected ROM image, and asserts the
// architectural result of every one of the eight instructions: the address it
// was fetched from, the opcode the decoder saw, how many clocks it took, and
// the value the ALU produced.  Also checks both branch directions, the sw -> lw
// memory round trip, jalr's register-sourced jump, and that the cycle counter
// never repeats a 0 after reset (i.e. that the instruction at address 0 runs
// exactly once).
//
// This is not part of runtests.sh: that script covers the editor/server/
// simulator, and this covers an example design.  Run it by hand after changing
// the decoder equations in components/*.yaml or the wiring in core.json:
//
//     node examples/cpu/check-cpu.mjs
//
// It exits nonzero on any failure.  The ROM image is injected, so the design's
// own cpurom.bin is neither read nor written.
//
// NOTE the design must be SAVED from the editor first: core.json embeds a
// typeData copy of each GAL (FR-057), so an equation edit does not reach this
// check until File > Refresh Types and a save.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { deserializeDesign } from "../../web/js/model/persist.js";
import { flatten } from "../../web/js/model/subdesign.js";
import { buildSimulation } from "../../web/js/engine/sim.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = join(HERE, "core.json");

// Cycle counts are the microcode's, not the ISA's: cycle 0 fetches, cycle 1
// does PC+1 and pre-loads R[rB], and cycles 2..T execute (design notes are in
// the behavior block of components/type-INS-DCD.yaml).
const NAMES = { 0: "add", 1: "addi", 2: "nand", 3: "lui", 4: "sw", 5: "lw", 6: "beq", 7: "jalr" };

//   0: lui  r1, 1      r1 = 1<<6      = 0x0040
//   1: addi r2, r1, 1  r2 = 0x40+1    = 0x0041
//   2: add  r3, r1, r2 r3 = 0x40+0x41 = 0x0081
//   3: nand r4, r1, r1 r4 = ~0x0040   = 0xffbf
//   4: sw   r3, r1, 0  Mem[0x40] = 0x0081
//   5: lw   r5, r1, 0  r5 = Mem[0x40] = 0x0081
//   6: beq  r3, r5, 1  equal, so address 7 is skipped
//   7: lui  r1, 0      must NOT execute
//   8: jalr r6, r2     r6 = PC+1 = 0x0009, then PC := r2 = 0x0041
//  41: add  r7, r6, r6  r7 = 9+9 = 0x0012 -- proves the link value reached r6
const PROG = { 0: 0x6401, 1: 0x2881, 2: 0x0c82, 3: 0x5081, 4: 0x8c80, 5: 0xb480,
               6: 0xce81, 7: 0x6400, 8: 0xf900, 0x41: 0x1f06 };
const BEQ_NOT_TAKEN = 0xcc81; // beq r3, r1, 1 -- 0x0081 != 0x0040

async function run(prog, maxClocks) {
  const design = deserializeDesign(JSON.parse(readFileSync(PATH, "utf8")));
  const flat = await flatten(design, async (p) => JSON.parse(readFileSync(p, "utf8")), { rootPath: PATH });

  const bytes = new Uint8Array(512);
  for (const [addr, w] of Object.entries(prog)) {
    bytes[2 * addr] = w & 0xff;
    bytes[2 * addr + 1] = w >> 8;
  }
  const romContent = new Map();
  for (const inst of flat.components ?? [])
    if (inst.typeData?.mem?.kind === "rom") romContent.set(inst.typeData.mem.romFile, bytes);

  const sim = buildSimulation(flat, { onMessage: () => {}, romContent });
  const v = (r, p) => sim.valueOfPin(r, p);
  // word() returns null if any bit is U/Z, so "not yet defined" stays visible
  // rather than silently reading as 0.
  const word = (refdes, prefix, n) => {
    let out = 0;
    for (let i = n - 1; i >= 0; i--) {
      const b = v(refdes, prefix + i);
      if (b > 1) return null;
      if (b === 1) out |= 1 << i;
    }
    return out;
  };
  const pair = (hi, lo) => {
    const h = word(hi, "Q", 8), l = word(lo, "Q", 8);
    return h === null || l === null ? null : (h << 8) | l;
  };

  // Sample at each rising clock edge: that is the state the hardware latches.
  const rows = [];
  let prev = 0;
  for (let t = 0; t < 8000 && rows.length < maxClocks; t++) {
    if (prev === 0 && v("A-3", "OUT") === 1) {
      rows.push({
        pc: word("X3/U4", "A", 16),          // ROM address = the PC
        ir: pair("X3/U5", "X3/U6"),          // instruction register
        f: pair("X1/U2", "X1/U24"),          // ALU F (result) register
        ld: v("U6", "/LD") === 0,            // fetch strobe
        rst: v("A-11", "R") === 1,
        cy: ["QA", "QB", "QC", "QD"].some((p) => v("U7", p) > 1)
          ? null
          : ["QA", "QB", "QC", "QD"].reduce((a, p, i) => a | (v("U7", p) === 1 ? 1 << i : 0), 0),
      });
    }
    prev = v("A-3", "OUT");
    sim.step();
  }
  return rows;
}

// Reset asserts /LD on every reset cycle to load the IR, so only fetches after
// reset releases delimit real instructions.
const fetchesOf = (rows) => rows.map((r, i) => ({ ...r, i })).filter((r) => r.ld && !r.rst);

const hex = (n) => (n === null ? "????" : n.toString(16).padStart(4, "0"));
let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + msg);
  if (!cond) failed = 1;
};

const rows = await run(PROG, 48);
const fetches = fetchesOf(rows);
const seen = [];
for (let k = 0; k + 1 < fetches.length; k++) {
  const start = fetches[k].i, end = fetches[k + 1].i;
  // The IR is loaded at the edge ending the fetch cycle, so read it one row on.
  seen.push({ pc: rows[start].pc, ir: rows[start + 1]?.ir, clocks: end - start, f: rows[end - 1].f });
}

console.log("\n  addr instr  clocks  F at end");
for (const s of seen)
  console.log(`  ${hex(s.pc)} ${(NAMES[(s.ir ?? 0) >> 13] ?? "?").padEnd(5)} ${String(s.clocks).padStart(4)}    ${hex(s.f)}`);
console.log();

const EXPECT = [
  { pc: 0, name: "lui", clocks: 4, f: 0x0040 },
  { pc: 1, name: "addi", clocks: 4, f: 0x0041 },
  { pc: 2, name: "add", clocks: 4, f: 0x0081 },
  { pc: 3, name: "nand", clocks: 5, f: 0xffbf },
  { pc: 4, name: "sw", clocks: 4, f: 0x0040 },   // F holds the store address
  { pc: 5, name: "lw", clocks: 5, f: 0x0081 },   // the word sw wrote, read back
  { pc: 6, name: "beq", clocks: 5, f: 0x0081 },
  { pc: 8, name: "jalr", clocks: 5, f: 0x0009 },   // fetched from 8: 7 was skipped;
                                                   // F holds the link value PC+1
  { pc: 0x41, name: "add", clocks: 4, f: 0x0012 }, // r6+r6 = 9+9: the link landed
];
EXPECT.forEach((w, k) => {
  const s = seen[k];
  ok(s?.pc === w.pc, `${w.name}: fetched from ${hex(w.pc)} (got ${hex(s?.pc)})`);
  ok(NAMES[(s?.ir ?? 0) >> 13] === w.name, `${w.name}: opcode decoded`);
  ok(s?.clocks === w.clocks, `${w.name}: ${w.clocks} clocks (got ${s?.clocks})`);
  ok(s?.f === w.f, `${w.name}: result ${hex(w.f)} (got ${hex(s?.f)})`);
});
ok(seen[6]?.pc === 6 && seen[7]?.pc === 8, "beq taken: address 7 skipped");
ok(rows[fetches[8]?.i]?.pc === 0x0041, `jalr: PC := 0041 (got ${hex(rows[fetches[8]?.i]?.pc)})`);

const afterReset = rows.slice(fetches[0].i);
ok(!afterReset.some((r, i) => i > 0 && r.cy === 0 && afterReset[i - 1].cy === 0),
   "cycle counter never repeats 0 (address 0 executes once)");

const rows2 = await run({ ...PROG, 6: BEQ_NOT_TAKEN }, 40);
const f2 = fetchesOf(rows2);
ok(rows2[f2[6]?.i]?.pc === 6 && rows2[f2[7]?.i]?.pc === 7,
   `beq not taken: falls through to 0007 (got ${hex(rows2[f2[7]?.i]?.pc)})`);

console.log(failed ? "\n  FAILURES\n" : "\n  all checks passed\n");
process.exit(failed);
