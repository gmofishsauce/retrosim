# Fast (Generated C) Simulator — Open Questions

Working notes capturing the design questions that remain after the decisions now
recorded in `specs/requirements.md` §3.23 (FR-106–FR-110). This file is a
scratchpad for discussion; the specs remain the source of truth. The two
questions already logged formally are repeated here for completeness (OQ-011,
OQ-012) alongside the ones not yet in the specs.

## Already logged in the specs

- **Output mechanism (OQ-011).** How the standalone C program reports results.
  Candidates: a four-state **VCD** dump (`0`/`1`/`x`/`z` map 1:1 onto our
  0/1/U/Z, viewable in gtkwave/Surfer); a **CLI textual transcript** of
  observable points; **bus-conflict reports to stderr** (FR-108). Also open: the
  **observable-point set** — indicators (FR-068/FR-071d) and ports (FR-094) are
  the natural probes, optionally plus user-tagged nets.

- **Batch stimulus (OQ-012).** Intended direction is to skip a separate
  test-vector format and drive designs (a CPU especially) from **file-backed
  memory components** — the program in ROM/RAM is the stimulus. Memory
  components don't exist yet; sub-questions: ROM-first vs ROM+RAM, contents-file
  format, async vs synchronous read, and runtime-read vs baked-in contents.
  Clock and power-on-reset stimulus already come from built-ins.

## Not yet logged — still to settle

- **Batch run-control.** FR-110 fixes the unit-delay timing model but leaves the
  standalone program's *run length and termination* open: how many simulated ns
  / clock cycles to run, and the stop condition (combinational → settle then
  stop, like the slow sim's settling episode; clocked → run N cycles). Likely
  command-line flags.

- **Deliverable / "generate" UX.** Does the browser action emit **C source only**
  (user compiles, possibly in a `cc` pipeline), or does the server/toolchain also
  compile and/or run it? And how is the `.c` delivered — browser download vs
  written through the existing server file API? Leaning: emit source first,
  compile/run later.

- **Runtime-library vs generated-code split.** Proposed: a fixed, hand-written C
  **runtime support library** (four-state type + ops, net resolution + conflict
  detection, register edge-latch, VCD writer, built-in clock/reset/indicator/
  pull/switch) shipped as static `.c/.h`, with the **generated** code being only
  the netlist: net table, per-net driver lists, per-instance `evaluate()` lowered
  from compiled GALasm, and the step loop. Keeps the generator small and the
  subtle semantics in one auditable place. Needs confirmation.

- **Four-state C encoding.** Enum/byte per net (simple, first cut) vs bit-packed
  word-parallel representation (faster, premature?). The "fast" win over the JS
  interpreter comes mostly from native code regardless; bit-packing is a later
  optimization.

- **Semantic-parity strategy.** The single biggest correctness concern: the JS
  slow sim and the generated C must agree bit-for-bit on the same design.
  Mitigation: a **golden test corpus** run through both engines, diffing
  VCD/transcript. Note that the GALasm compiler is *not* duplicated (FR-109
  reuses the one JS compiler), which removes the largest drift risk — but the C
  **runtime** re-expresses the four-state combination + net-resolution rules, so
  those still need parity testing against `sim.js`.

- **Extract net-resolution core from `sim.js`.** Net resolution + conflict logic
  currently lives in the browser-coupled `sim.js`. It is the authoritative
  reference for what the emitted C must compute; pulling its pure core into a
  shareable module would let the generator (and its parity tests) draw from one
  source. Small refactor, benefits both engines.

- **Built-ins in C.** Clock, power-on reset, indicator, pull-up/down, input
  switch have JS-only behavior (`builtins.js`/`sim.js`); the C runtime needs
  equivalents. This is an inherent, well-bounded non-DRY spot (JS behavior +
  C runtime), as memory will also be.

- **Hierarchy / multi-sheet.** Whether the generator flattens sub-design
  instances and unions off-sheet peer sheets before emitting C, matching the
  slow sim (FR-102/FR-103). Flattening helpers (`model/subdesign.js`) are
  reusable; not yet asserted as a fast-sim requirement.

## Sequencing — where does test-vector (`.tv`) stimulus fit?

Question raised 2026-07-02: should the **fast-C stimulus** (feeding a `.tv` file
into the generated C as inputs + golden, `vec-open.md` #4) be built before or
after the code generator itself?

**It cannot come first.** "Fast-C stimulus" is really the *ABI of the generated
program* — how a caller forces a value onto a net and reads one back. That ABI
is an *output* of the generator's design, not an independent artifact, and it
depends on three still-open questions above: the output mechanism (OQ-011), the
observable/drivable point set (OQ-011), and batch run-control / termination.
Building the harness against an interface that does not exist yet is backwards.
So: **generator first, stimulus after.**

**But `.tv`-driven verification should be the generator's *first* milestone** —
ahead of the file-backed-memory / run-a-CPU direction OQ-012 currently leans
toward — because:

1. It is the cheapest possible **FR-107 parity harness**: run the same `.tv`
   through the slow sim and the generated C and diff the results. That is
   exactly the "golden corpus diffed through both engines" the *Semantic-parity
   strategy* bullet calls for, and parity is the single biggest correctness risk
   of a second engine.
2. The infrastructure already exists — the `.tv` format, input/output columns,
   and golden capture (FR-115); the slow sim's per-pin external **stimulus** hook
   (`setStimulus`, FR-115f) and ports-as-net-members (FR-094e). The generated C
   only needs the analogous *force-net* / *read-net* entry points over the same
   probe set (indicators + ports, the same OQ-011 observable set), onto which the
   `.tv` columns map directly.
3. It is small and bounded (a few combinational rows or a short clocked sequence)
   versus booting a CPU program — a far better bring-up target.

**Recommended order.**

1. Settle the generator's I/O contract (OQ-011 output mechanism + a force/read
   stimulus ABI) with `.tv` as the motivating batch mode, plus a termination
   rule (combinational → settle-and-stop like the slow sim's settling episode;
   clocked → run N cycles).
2. Build a minimal generator that emits a compilable C program honoring that
   contract for a trivial design.
3. Wire `.tv` through it as stimulus + golden, and stand up the slow-vs-fast diff
   as the parity test. *This* is fast-C stimulus (`vec-open.md` #4) — cheap by
   this point.

Net: fast-C stimulus lands right after a minimal generator, not before it and
not deferred behind the memory-as-stimulus CPU work. Memory-as-stimulus (OQ-012)
remains the complementary route for driving a whole running program later.
