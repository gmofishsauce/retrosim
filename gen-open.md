# Fast (Generated C) Simulator — Open Questions

Working notes for the fast-engine design discussion. **Status 2026-07-02: the
design round is complete** — everything below except the two items under *Still
open* was settled with the stakeholder and promoted into the specs (FR-116,
FR-116a, FR-117, FR-118; design.md §6.17). This file remains as a scratchpad /
history; the specs are the source of truth.

## Settled — promoted to the specs

- **Output mechanism (OQ-011) — RESOLVED (FR-118).** stdout carries a
  machine-diffable vector transcript (per-row pass/fail, actuals on failure,
  summary); stderr carries FR-108 bus-conflict reports. Observable set = the
  test-vector column set (indicators, ports, switches, clocks — FR-115b/FR-115f).
  VCD survives as a planned `--vcd` flag (M4), not the primary mechanism;
  user-tagged nets not adopted.

- **Deliverable / "generate" UX — RESOLVED (FR-116).** Emit source only, via
  Simulate ▸ Generate C… and the server file-save dialog: the generated
  `<design>.c` plus verbatim copies of `runtime.c`/`runtime.h` are written to the
  chosen directory, which then compiles with plain `cc <design>.c runtime.c`.
  **Two-file delivery** (stakeholder-chosen over a single concatenated file): the
  runtime stays a permanent, human-readable, documented pair. No tool ever
  invokes a compiler; the user compiles by hand.

- **Runtime-library vs generated-code split — CONFIRMED (FR-116a).** Fixed
  hand-written runtime pair (`runtime.h` documented API + `runtime.c`
  implementation, checked in under `web/cgen/`, served as static assets) holding
  all re-expressed slow-sim semantics; the generated file is only tables +
  lowered GALasm expressions. Runtime owns `main()` and control flow; generated
  code implements a small `gen_` interface (design §6.17).

- **Four-state C encoding — RESOLVED.** Enum/byte per net, numerically identical
  to `V0/V1/VU/VZ`. Bit-packing deferred as a later optimization.

- **Batch stimulus + run-control (first mode) — RESOLVED (FR-117).** `.tv`-mirroring
  vector execution: column tables baked at generate time (they derive from the
  design), rows as plain whitespace text on stdin (`0`/`1`/`C` | `H`/`L`/`X`);
  combinational rows independent, sequential rows ordered with reset preamble and
  shared `C` pulses, same 10,000-unit settle bound; terminate on input
  exhaustion, exit status = pass/fail. The C program never parses `.tv` JSON.

- **Built-ins in C — RESOLVED (FR-116a).** Clock/reset/switch/pulls/memory
  behaviors live in the runtime, driven from generated instance tables; scripted
  clocks in vector mode per FR-115e. ROM contents baked into the emitted source
  at generate time (from the same files FR-114e loads); RAM starts U.

- **Semantic parity — strategy adopted (design §11.1).** Golden corpus of
  design+`.tv` pairs run through both engines; a Node harness (M2) generates,
  compiles with `cc`, and diffs the C transcript against `runVectors`. The
  generator reuses the one GALasm compiler and netlist builder (FR-109), so the
  drift surface is the runtime's re-expressed resolution rules — exactly what
  the corpus exercises.

- **Hierarchy / multi-sheet — EXCLUDED from v1 (FR-116).** The generator refuses
  designs containing sub-design instances or off-sheet connectors; fast-engine
  flattening is a later change (the slow sim's own FR-102/FR-103 flattening is
  also not yet implemented).

- **Sequencing — ADOPTED (design §6.17 milestones).** M1 runtime + minimal
  combinational generator → M2 `.tv` stimulus + parity harness → M3 sequential +
  memory → M4 free-run + VCD. As argued below: generator first, `.tv` stimulus
  immediately after, memory-as-stimulus later.

## Still open

- **Parity-harness location (M2).** The harness shells out to `cc`, so it should
  not sit in the compiler-free `node:test` sweep under `web/js/`. Candidate: a
  separate `test/parity/` or `tools/` tree, run explicitly. Deliberately
  deferred to M2 (design §12).

- **`tv2txt` must reconcile, and the program must expose column identities
  (M2; noted in design §6.17 M2).** First real M1 use (74381, 2026-07-02)
  showed a naive `.tv`-rows dump (`jq`) fails whenever the file asserts only a
  subset of the design's derived columns: the program's stdin rows are
  positional against the full baked column set (FR-117), so the arity check
  rejects the row. The panel never hits this because it reconciles by
  `(refdes,pin)` on load (FR-115a). So the M2 converter reconciles like
  `reconcileVectors` — `X` for unasserted design columns, warnings for file
  columns the program lacks — and, so it can work from the emitted `.c` alone,
  the generator bakes each column's `(refdes,pin)` identity alongside its
  display label (today only port columns carry it), with a tooling-readable
  column dump (parse the tables, or a runtime `--columns` mode — pick at M2).

- **Memory-as-stimulus free-run mode (OQ-012, M4+).** Run-length/termination
  flags for the free-running mode (`--cycles N`, settle-and-stop), and whether a
  later version re-adds runtime-read memory contents so a program can be swapped
  without regenerating (v1 bakes contents into the source, FR-116a).

## Sequencing — where does test-vector (`.tv`) stimulus fit?

*(Historical argument, 2026-07-02 — now adopted; kept for rationale.)*

Question raised 2026-07-02: should the **fast-C stimulus** (feeding a `.tv` file
into the generated C as inputs + golden, `vec-open.md` #4) be built before or
after the code generator itself?

**It cannot come first.** "Fast-C stimulus" is really the *ABI of the generated
program* — how a caller forces a value onto a net and reads one back. That ABI
is an *output* of the generator's design, not an independent artifact, and it
depends on three questions settled above: the output mechanism (OQ-011), the
observable/drivable point set (OQ-011), and batch run-control / termination.
Building the harness against an interface that does not exist yet is backwards.
So: **generator first, stimulus after.**

**But `.tv`-driven verification should be the generator's *first* milestone** —
ahead of the file-backed-memory / run-a-CPU direction OQ-012 leans toward —
because:

1. It is the cheapest possible **FR-107 parity harness**: run the same `.tv`
   through the slow sim and the generated C and diff the results. That is
   exactly the "golden corpus diffed through both engines" the parity strategy
   calls for, and parity is the single biggest correctness risk of a second
   engine.
2. The infrastructure already exists — the `.tv` format, input/output columns,
   and golden capture (FR-115); the slow sim's per-pin external **stimulus** hook
   (`setStimulus`, FR-115f) and ports-as-net-members (FR-094e). The generated C
   only needs the analogous *force-net* / *read-net* entry points over the same
   probe set (indicators + ports, the same OQ-011 observable set), onto which the
   `.tv` columns map directly.
3. It is small and bounded (a few combinational rows or a short clocked sequence)
   versus booting a CPU program — a far better bring-up target.

Net: fast-C stimulus lands right after a minimal generator, not before it and
not deferred behind the memory-as-stimulus CPU work. Memory-as-stimulus (OQ-012)
remains the complementary route for driving a whole running program later.
