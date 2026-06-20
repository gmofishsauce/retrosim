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
