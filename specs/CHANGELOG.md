# Changelog: TTL Circuit Design Editor

Chronological index of change requests. **History and rationale only** — this
file is *not* needed to determine current behavior. `requirements.md` and
`design.md` are the single source of truth for the system's intended state and
are always kept current.

Each entry records what was requested, when, why, and which requirement IDs and
design sections it touched. Newest entries at the top.

## Format

```
## YYYY-MM-DD — Short title
What: one-line description of the change requested.
Why: rationale (optional if obvious).
Touches: FR-0xx, FR-0yy; design §6.x, §8
```

---

## 2026-07-03 — M5 landed: runtime ROM loading (--rom)
What: runtime.c/h — rt_mem gains refdes/rom_file, loses rom/rom_len (interface change: pre-M5 programs regenerate once); mem_load_all in rt_init resolves each ROM (--rom REFDES=FILE override, else recorded path, else basename in cwd; every failure exits 2 with the FR-117b messages), rom_read_file parses per FR-114e (.bin raw, .hex whitespace-separated byte tokens), mem_reset seeds from the loaded bytes. cgen.js: generateC(design) — refdes + content-file path baked, no bytes, no generate-time warning; cgen tests updated. parity.js: romArgsFs passes --rom overrides on both legs (JS engine keeps loadRomContentsFs). app.js needed no change — the §6.17 loadRomContents preload was discovered never wired in (latent all-U-ROM bug in app-generated programs, mooted by FR-117b); design §6.17 corrected. Verified: one binary served the original and a swapped rom-demo.hex via --rom; error paths and basename fallback exercised; full suite green.
Why: implement FR-117b per the M5 scope; the discrepancy fix keeps design §6.17 truthful to the code.
Touches: FR-117b; design §6.17 (M5 milestone, chrome wiring); web/cgen/runtime.{c,h}, web/js/engine/cgen.js, web/js/engine/cgen.test.js, web/tools/parity.js; docs/user.md (verification waived by user)

## 2026-07-03 — M5 scoped: runtime ROM loading (--rom) specified
What: Specs only (implementation follows). New FR-117b: the generated program reads each ROM's contents at startup — generator bakes refdes + content-file path instead of bytes (supersedes FR-116a's bake-the-bytes clause); source priority --rom REFDES=FILE (repeatable) else baked path as recorded else basename in cwd; every load failure exits 2 (unresolvable baked path names the refdes and describes --rom); format/packing per FR-114e. FR-116a edited in place (self-contained to compile; content file needed at run time). OQ-012 marked RESOLVED (nothing remains open). design §6.17: generateC(design) signature, built-ins/memory bullet, chrome wiring (loadRomContents preload dropped), dependencies, new M5 milestone (rt_mem gains refdes/rom_file, loses rom/rom_len — interface change, pre-M5 programs regenerate once; mem_load_all in rt_init; parity uses --rom).
Why: change request — swap a ROM backing file without rebuilding generated simulators; resolves OQ-012's last sub-question.
Touches: FR-117b (new), FR-116a, OQ-012; design §6.17 (generator, chrome wiring, dependencies, M5 milestone)

## 2026-07-03 — parity.js free-run leg
What: parity.js additionally checks FR-117a for every examples/*.json design the generator accepts (with or without a .tv): slow simulator run free for 8 × clockPeriod unit steps (FR-071b single-clock rule), observable columns rendered as the FR-117a LABEL=v dump, line-diffed against the compiled program's --cycles 8 stdout.
Why: the M4 free-run verification was a throwaway script; this makes it a regression check.
Touches: design §6.17 (M4 milestone); web/tools/parity.js

## 2026-07-03 — M4 landed: free-run --cycles and --vcd, completing M4
What: runtime.c only, per the M4 design (no generator change). Free run (FR-117a): a sim_time counter (incremented in rt_step, mirroring sim.js simTime), a freerun branch in drive_builtins computing the clock's FR-084 square wave from period_ns and the reset's FR-071b window from cycles × clockPeriod, rt_run_free (N × clockPeriod bare steps, then the LABEL=v observable dump), and --cycles N flag parsing (positive-int validated, stdin untouched). VCD (FR-118): --vcd FILE in both modes — $timescale 1ns header, one scalar per observable column, #0 power-up $dumpvars, change-only records sampled by rt_step every unit step, 0/1/U/Z → 0/1/x/z. Free run parity-checked against the slow simulator run free on examples/counter and examples/simple174; full suite green. docs/user.md §"Generating a standalone C simulator" updated (verification waived by user) — including stale M2/M3 limits text (tv2txt/--columns; only sub-designs refused now).
Why: M4 implementation per design §6.17 milestones; completes the generator milestone plan M1–M4.
Touches: FR-117a, FR-118; design §6.17 (M4 milestone); docs/user.md

## 2026-07-03 — M4 scoped: free-run --cycles and --vcd specified
What: Specs only (implementation follows). New FR-117a: free-running batch mode — `--cycles N`, time-driven clock/reset built-ins mirroring the slow simulator's simTime evaluation (FR-084/FR-071b), run N × clockPeriod unit steps, final LABEL=v observable dump on stdout. FR-118 edited in place: `--vcd <file>` specified — both batch modes, $timescale 1ns, one signal per observable column, per-step value changes, 0/1/U/Z → 0/1/x/z. FR-110/FR-117/OQ-012 cross-references updated; design §6.17 M4 milestone expanded (runtime-only change; gen tables already bake period_ns/cycles).
Why: M4 scoping per design §6.17 milestones; resolves OQ-012's open run-length/termination flags (runtime-read memory contents stay open).
Touches: FR-117a (new), FR-118, FR-110, FR-117, OQ-012; design §6.17 (M4 milestone)

## 2026-07-03 — M3 step 3: memory (RAM/ROM), completing M3
What: The memory core (memory.js) is re-expressed in runtime.c (mem_decode/mem_write_all/mem_drive_all/mem_reset), runtime-owned and driven from a generated gen_mems[] table (const wiring + baked ROM bytes; per-instance store lives in the runtime). RAM WE/-edge writes latch in the step's latch phase, data drive in the contribution phase; RAM powers up U, ROM seeds from baked contents (FR-116a). cgen.js emits gen_mems and bakes ROM from the romContent map; only sub-design instances remain refused. parity.js gained fs-based ROM loading (loadRomContentsFs) for both engines. New parity pairs examples/rom-demo (ROM + rom-demo.hex) and examples/ram-demo (1-bit RAM + tri-state data buffer + dummy clock); parity clean fast-vs-slow. M3 complete.
Why: M3 final step per design §6.17 milestones — the fast engine now covers memory.
Touches: FR-114d, FR-116a; design §6.17 (M3 milestone, M2 parity harness)

## 2026-07-03 — M3 step 2: per-output .CLK with async .ARST/.APRST
What: cgen.js now lowers per-output-clocked .R outputs (FR-079a) alongside the global-clock family in one part — each self-clocked output edge-detects its own .CLK against a per-output prevClk and applies async .APRST (preset) then .ARST (reset, wins); global AR/SP restricted to the global-clock register indices. Refusal narrowed to memory only (step 3). Runtime unchanged. New sequential parity pair examples/2-bit-SR (7474 dual D-FF); parity clean fast-vs-slow.
Why: M3 second step per design §6.17 milestones — independent clock domains and async set/reset.
Touches: FR-079a; design §6.17 (M3 milestone)

## 2026-07-03 — M3 step 1: registered (.R) outputs on the global clock
What: cgen.js now lowers global-clock .R registered outputs (incl. global AR/SP) instead of refusing them — per-instance reg_<refdes>[] state, rising-edge latch in gen_latch mirroring sim.js updateRegisters, drive reads back the register. Runtime unchanged (sequential vector path already existed). Refusal narrowed to per-output .CLK/.ARST/.APRST (step 2) and memory (step 3). New sequential parity pair examples/simple174 (74174); parity clean fast-vs-slow.
Why: M3 first step per design §6.17 milestones — sequential support, smallest slice first.
Touches: FR-079; design §6.17 (M3 milestone)

## 2026-07-03 — M2: fast-vs-slow parity harness (FR-107 check)
What: Added web/tools/parity.js — for each examples/ design+.tv pair it loads the design (deserializeDesign), reconciles the .tv to deriveColumns, runs runVectors (JS) and generateC+cc (C) on the same reconciled rows, and diffs the compiled program's stdout transcript against the JS result rendered into the identical FR-118 format. Generator refusals (memory/sub-design/.R, M3+) report as skips; exits nonzero on any diff. Resolves the §12 harness-location open item (web/tools/parity.js).
Touches: design §6.17 (M2), §9 file manifest, §12 (open item resolved)

## 2026-07-03 — M2: tv2txt (.tv → generated-program stdin rows)
What: Added web/tools/tv2txt.js — `node tv2txt.js <program> <file.tv>` reads the program's baked column set via `--columns`, reuses deserializeVectors + reconcileVectors (§6.16) to align the file's (refdes,pin) columns to the program's positional row order (inputs default 0/clock C, outputs X; warnings for one-sided columns), and writes plain-text rows to stdout so `tv2txt … | ./sim` runs the vectors. Establishes web/tools/ as the fast-engine dev-tooling home.
Touches: design §6.17 (M2), §9 file manifest, §12 (harness-location open item)

## 2026-07-03 — M2: settle column-identity encoding and readout mechanism
What: Resolved the two M2 sub-decisions the design left open: each column's (refdes,pin) identity rides as extra refdes/pin string fields on rt_incol/rt_outcol (not a parallel table), and tooling reads the baked column set via a runtime --columns dump mode (no .c parsing). Unblocks tv2txt.
Touches: design §6.17 (M2 milestone)

## 2026-07-02 — Fix paste refdes remap for sub-design and note series
What: Copy/paste of a sub-design IC threw "cannot remap reference designator X1" — the clipboard's X series regex expected a hyphenated `X-<n>` while sub-design instances are `X<n>` (FR-098a); also added the missing `N-<n>` note series so pasting a selection containing a text note no longer throws. Corrected design.md's stray `X-<n>` prose to match FR-098a and the code.
Touches: FR-098a; design §6.14, §6.15

## 2026-07-02 — M2 note: tv2txt must reconcile; generator to bake column identities
What: Captured the 74381-run lesson — a naive positional .tv dump fails when the file asserts a column subset; the M2 tv2txt converter must reconcile by (refdes,pin) like the panel, and the generator will bake each column's (refdes,pin) identity into the emitted .c with a tooling-readable dump.
Touches: design §6.17 (M2 milestone); gen-open.md (Still open)

## 2026-07-02 — Verbatim-text save endpoint for C-generator delivery
What: Added `POST /api/v1/file/save` ({path, content} → atomicWrite, no JSON interpretation) and corrected design §6.17 to use it for the three generated files.
Why: Implementation revealed §6.17's plan to reuse `/design/save` was wrong — that endpoint requires a valid-JSON body (json.Indent), so C source cannot ride it.
Touches: design §6.4, §6.17 (corrected)

## 2026-07-02 — Fast (generated C) simulator: design settled
What: Specified the code generator's deliverable and I/O, resolving OQ-011 and the `gen-open.md` open items: Simulate ▸ Generate C… writes `<design>.c` plus a fixed, human-readable, documented `runtime.h`/`runtime.c` pair (two-file delivery, plain `cc` compile, no tool-invoked compilation); `.tv`-mirroring vector rows on stdin as the first batch mode; stdout transcript + stderr conflict reports (VCD as a later `--vcd` flag); byte-per-net four-state encoding; hierarchy refused in v1; ROM contents baked at generate time.
Why: `.tv`-driven execution is the cheapest FR-107 parity harness (generator first, stimulus immediately after — see gen-open.md sequencing); a hand-written runtime keeps the re-expressed slow-sim semantics in one auditable, documentable place.
Touches: FR-110, FR-116, FR-116a, FR-117, FR-118 (new); OQ-011 (resolved), OQ-012 (updated); design §6.17 (new), §8, §9, §10, §11.1, §12

## 2026-07-02 — Fast-engine sequencing: `.tv` as the first batch stimulus mode (advice)
What: Recorded the recommended ordering for the not-yet-written fast (generated-C) simulator. Fast-C stimulus cannot precede the generator (it is the generated program's force/read ABI, gated on OQ-011 and batch run-control), but `.tv`-driven verification should be the generator's first batch milestone — ahead of the memory-as-stimulus/CPU direction — because diffing one `.tv` through both engines is the cheapest FR-107 parity harness and reuses existing infra (FR-115/FR-115f/FR-094e). Advisory only; no behavior or code change.
Touches: OQ-012 (inline update); gen-open.md (new "Sequencing" section). No FR/design changes.

## 2026-07-02 — Test-vector editor: modal dialog → docked bottom panel
What: The Test Vectors editor moves from a `.dialog-overlay` modal to a modeless panel docked in the bottom third of the canvas area, so the schematic stays visible and navigable (pan/zoom) while authoring vectors. The Simulate ▸ Test Vectors item toggles it open/closed. While the panel is open the design is read-only, generalizing the FR-087 simulation lock to `simulating || vectorPanelOpen` (new `store.isReadonly()`): canvas mutations and design-modifying commands are disabled and the interactive Run button is disabled (panel ↔ live-sim mutual exclusion), but Select, pan, zoom, and Fit remain. The canvas keeps its viewport and aspect ratio — only its visible extent shrinks (ResizeObserver refit, no rescale). Runner/format/`.tv` unchanged; columns are a stable snapshot since the design can't change while open.
Why: The modal covered the schematic the user needs to see (to correlate columns with switches/indicators/ports and sanity-check Capture).
Touches: FR-115b (reworked modal→panel), FR-115h (added — read-only lock, mutual exclusion), FR-004a (Simulate item toggles panel); design §6.16 (panel, chrome wiring, read-only lock, dependencies).

## 2026-07-01 — Sequential test vectors (FR-115e implemented)
What: Test vectors now cover clocked designs. A sequential vector set's rows run in order on a single simulation instance (state persists row to row) and the run owns the clock deterministically: clock/reset time-based behaviors are suppressed (buildSimulation scriptedClocks) and the runner drives their nets as scripted stimulus (setStimulus). Each clock generator contributes a 0/1/C input column in the classic PLD/JEDEC style (C = one positive pulse, the new-row default); each row settles to quiescence per phase (FR-085 bound). Before row 1 an implicit power-on preamble asserts every reset built-in for its own `cycles` worth of scripted pulses (stakeholder-chosen over scripted reset columns). Capture runs the same ordered pass. Combinational designs keep FR-115c unchanged; `.tv` bumps to formatVersion 2 (identity migration — shape unchanged, marks the C symbol). The FR-115g guard is removed (superseded).
Why: FR-115e was the recorded deferred direction; refined here to settle-phases instead of a fixed step count per row (fixed counts are fragile against logic depth) and to a power-on preamble for reset (matches the interactive simulator's power-on feel, keeps tables small).
Touches: FR-115e (reworked from deferred stub), FR-115/FR-115a/FR-115b/FR-115c (scope/columns cross-refs), FR-115g (superseded); design §6.13 (scriptedClocks, setStimulus), §6.16 (sequential runner, captureVectors, dialog), §7.7 (v2, C symbol), traceability table.

## 2026-07-01 — Clocked-design guard in the Test Vectors dialog (FR-115g)
What: The test-vector table editor now detects a design containing a clock generator and disables Run and Capture with a persistent notice; row editing, Load, and Save stay available.
Why: Test vectors are combinational-only (FR-115) — a clocked design never quiesces, so each row burned the full 10,000-unit settle bound and produced meaningless results with no warning. Cheap footgun guard until sequential vectors (FR-115e) land, at which point it is superseded.
Touches: FR-115g (new); design §6.16 (hasClockGenerators, dialog guard), traceability table.

## 2026-06-30 — Test vectors bind to ports by the port's own identity (FR-115f)
What: Test vectors can now drive/observe a design's ports (FR-094/portN FR-071e), not just switches/indicators — the unit under test is always the design shown in the editor. A port column is identified by the port's OWN (refdes,pin) — (refdes,"P") for a 1-wide port, (refdes,"P"i) for a portN bit — the natural, stable identity an author writes by hand, so a .tv reconciles by (refdes,pin) and no helper components are synthesized. Ports bind by effective direction (FR-094c/FR-094d): in→input column, out→output column, bidir→skipped with a warning. portN expands uniformly into N one-bit columns. The runner drives input ports via the new simulator stimulus (FR-094e/§6.13) and reads output ports directly off their nets; port columns union with any switch/indicator columns.
Why: An earlier wrapper scheme keyed columns by synthesized helper instances, which didn't match a hand-authored .tv (it keys by the port) and produced a flood of reconcile warnings. Binding by the port's own identity is what users expect and what existing .tv files use.
Touches: FR-115f (new), FR-115/FR-115b/FR-115c (cross-ref); design §6.16 (deriveColumns ports, simulateRow stimulus/direct read — no wrapper), §7.7 (port columns).

## 2026-06-30 — Port pins are net members; slow simulator gains external stimulus (FR-094e)
What: A port's connection point now participates in the netlist as a member of the net it taps, so the net is observable and drivable by the port's (refdes,pin) — (refdes,"P") for 1-wide, (refdes,"P"i) for portN bits (portN bits were already members via their bus snap; 1-wide ports were not). buildNets step 6 attaches each connector's own pin to its lane (the label still names the net). buildSimulation(design,{stimulus}) accepts a {refdes,pin,value} list applied as strong drivers each step, forcing those nets with no placed component. Together these make a port a first-class probe/stimulus point.
Why: The enabling mechanism for FR-115f port binding — read an output port directly, force an input port — reusing the existing driver path instead of synthesizing components or inventing a force-net-by-id API.
Touches: FR-094e (new); design §6.6 (netlist step 6), §6.13 (buildSimulation stimulus); OQ-012 (slow-engine stimulus note).

## 2026-06-30 — Manual direction override for bidir ports (FR-094d)
What: A port whose derived direction (FR-094c) is bidir may carry an optional in/out override; effective direction = override when set and derived is bidir, else the derived value. Definite in/out stay fully derived/read-only (FR-094c's anti-staleness guarantee preserved); the override self-heals if the net later leaves bidir. Applies to portN (aggregated) too. The effective direction feeds the embedded-IC layout (FR-099), test-vector binding (FR-115f), and the save format (which also persists the override itself). Properties panel shows an editable selector only for a derived-bidir port.
Why: The derivation conservatively reports bidir for a three-state output acting as a switchable driver (e.g. a 74381 F bus feeding a mux); the wiring genuinely can't distinguish that from a true bidirectional bus, so a designer hint is warranted exactly there.
Touches: FR-094d (new), FR-094c/FR-060b/FR-071e/FR-095/FR-099 (cross-ref); design §6.14 (effectivePortDir, properties panel, designInterface), §7.2 (dirOverride field).

## 2026-06-28 — Segment-granular wire/bus selection and single-leg delete (FR-033d)
What: A plain click on a wire/bus segment now selects just that segment (KiCad-style), highlighted on canvas, instead of the whole conductor (FR-031 reworked). A new deleteSegment op (FR-033d) deletes the selected leg via Delete or a "Delete segment" context-menu item: it cuts the path at that edge, promotes a cut bend to a dangling free endpoint, drops a degenerate half, and runs cleanup — interior cut → two dangling wires, end cut → one shorter wire plus an unconnected endpoint. Generic over wires and buses (parts inherit width/bitNames; groupConnections follow their endpoint). Whole-conductor delete stays available via "Delete wire/bus" and rubber-band select. Drag-to-insert-bend (FR-031) and rotate/move (components-only) are unchanged.
Why: Familiar KiCad selection feel and the ability to delete a single leg without redrawing the whole wire.
Touches: FR-031 (reworked), FR-033d (new); FR-033b (context menu), FR-020d (properties), FR-016b (marquee scope); design §6.6 (deleteSegment), §6.9 (segment select/delete FSM), §6.11 (context menu).

## 2026-06-28 — Beginning/completing a wire/bus on a dangling end joins them into one (FR-034c)
What: Beginning or terminating a new wire (or bus) on an existing dangling endpoint used to create a junction (black connection dot) because the start/completion paths only saw the host segment and treated the click as a branch. Now danglingEndAt detects a free, non-snapped end of the same conductor type (same width for buses) on both the start and completion paths and returns a vertex source/target, and joinFreeEnd splices the two conductors into one continuous conductor — the shared point becomes a bend (pruned if collinear, FR-033c), no junction, no dangling mark. Width-mismatched bus joins are rejected (FR-039a); a wire on a dangling bus end still taps a bit (FR-043b). Scoped to the add commands, not global cleanup.
Why: A dangling-end termination should merge wires, not stamp a connection dot.
Touches: FR-034c (new); FR-027e (completion targets); design §6.6 (danglingEndAt/joinFreeEnd), §6.9 (join-on-dangling-end).

## 2026-06-28 — Fit to Screen command in the View menu (FR-022a)
What: Added a View-menu "Fit to Screen" command that sets zoom and pan together so the whole design (components, wires, buses) fits the canvas with a small margin, centered; clamped to the zoom range and a no-op on an empty design. No keyboard accelerator (per user). Available while simulating, like the other zoom items.
Touches: FR-022a (new); FR-004a, FR-004b (View menu listing / accelerators); design §6.11.

## 2026-06-27 — A multi-bit interface is a pin group, not a "wide" pin (FR-095/FR-099, OQ-010b)
What: An embedded sub-design exposed a portN as a single pin carrying a width=8 attribute, which the bus tool (group-based snap) could not connect to. Resolved on the principle that a pin is always one bit — bit-width belongs to buses and pin groups, never a pin. synthTypeForInterface now expands a width-N interface signal into N one-bit pins (<label>0..<label>(N-1)) plus a pinGroups entry named <label>, so a matching bus snaps via the ordinary group machinery (FR-041/FR-042). Pins no longer carry a width attribute. The 1-wide port is now strictly one bit: its per-port width field and the properties-panel width control are removed (the long-standing "fat pin" confusion). OQ-010(b) resolved (was "single wide pin"); the 1-wide-port width field is superseded.
Why: The wide port rendered as an unconnectable single pin in IC form; the root cause was treating a pin as having width.
Touches: FR-094, FR-094a, FR-095, FR-099, FR-071e; OQ-010; design §6.14 (port built-in, interface resolution, sub-design instance), §7.2 fields table

## 2026-06-27 — Multi-bit port (portN) replaces fixed 8-wide port8 (FR-071e)
What: The fixed 8-wide port (port8) is generalized to a variable-width multi-bit port (portN): dropping its palette tile opens a modal to choose a bit width 2–16 (default 8), fixed for the life of the instance (not editable afterward, no properties width control). Its pins/group/footprint (P0..P(N-1) in group P, 3×(N+1)) are generated for the chosen width. Crucially it is promoted to a real interface element: it now contributes one width-N pin to the design's external interface (FR-095) with a direction derived from its wiring (FR-094c), aggregated across its bit nets — fixing the bug where an 8-wide port rendered nothing when its design was embedded. Clean break: the old type-port8 id is no longer recognized. Same-label per-bit joining (FR-094a) and off-sheet links (FR-101) stay deferred for portN (its pins join nets through drawn buses/wires, not connector vertices).
Why: An 8-wide port placed in a child design vanished when the child was embedded, because designInterface only admitted renderType "port"; promoting it (and making width user-chosen) makes wide buses usable across the hierarchy.
Touches: FR-071e; FR-095, FR-094c (clarified for multi-bit); design §3.18 built-ins list, §6.8 render branch, §6.14 (port built-in, interface resolution)

## 2026-06-27 — Port direction derived from wiring (FR-094c)
What: A port's direction is no longer a hand-set in/out/bidir field; it is derived live from the port's net — bidir if the net touches any bidir/tristate pin (RAM/ROM data), else output if driven by a plain output pin, else input (also when unconnected). The properties panel shows it read-only. designInterface derives it via a new portDirection() helper, so an embedded sub-design's IC lays inputs on the left and outputs on the right correctly without the user having to mark each output port. The save format stores the derived value (written at save). Netlist/sim are unaffected (ports join nets by label; direction only drove IC layout + display).
Why: User embedded a sub-design whose output ports were left at the default "in" and so rendered on the wrong (left) side; direction should track the wiring.
Touches: FR-094, FR-094c (new), FR-095, FR-099, FR-060b; design §6.14, §7.2.

## 2026-06-27 — Sub-design child path: absolute in memory, relative on disk (FR-097b/FR-098/FR-100a)
What: Adding a sub-component no longer requires saving the parent first. A sub-design instance now holds its child reference as an absolute path in memory; fileops relativizes it to the parent's save dir on save and absolutizes it on load. Embedding places the instance immediately like any other component, with no save prompt. As an interim (phase 1), descending into a sub-design of an unsaved parent still prompts to save the parent (so Back can return to it via its file); a later change may retain an unsaved parent in memory so even descent needs no save. Also fixes a latent bug where Save As into a different folder left the stored relative path pointing at the old location.
Why: The save dialog appearing on embed (to compute the relative path) was confusing; the relative path is only needed on disk, not to place the instance.
Touches: FR-097b, FR-098, FR-100a (FR-047/FR-057/FR-060b context); design §6.14, §7.4.

## 2026-06-27 — Confirm before overwriting an existing design file (FR-049b)
What: A save prompt (first save or Save As) that targets a path already naming an existing file now asks the user to confirm the overwrite, and aborts the save if declined. Implemented in the save-mode file dialog. Subsequent saves of the same design to its own file (FR-048) are unaffected — they skip the dialog and still overwrite silently.
Why: User twice clobbered an existing design file by saving a new design over it with no warning.
Touches: FR-049b (new; FR-047/FR-048/FR-049); design §rendering FR-049b.

## 2026-06-27 — Wire/bus endpoint sheet: a junction reads as connected (FR-020d)
What: In the read-only wire/bus property sheet, a plain junction endpoint (FR-034) now reads "junction (x, y)" instead of "unconnected (x, y)". A junction always ties two or more conductors, so labeling it unconnected was wrong and misleading; only a genuinely dangling free end (FR-029) still reads "unconnected (x, y)".
Why: User reported a connected junction (a dot where two wires meet) being shown as not connected.
Touches: FR-020d; design §properties (describeEndpoint).

## 2026-06-27 — Palette half heading bars (FR-006a)
What: Each half of the tool palette gets a small fixed (non-scrolling) heading bar above its tiles, in the tile-label font: "TTL Components" (upper) and "Built-In Components" (lower). Each half is restructured into a flex column of heading + scrolling tile grid.
Why: Label the two regions so their distinction is obvious.
Touches: FR-006a; design §rendering FR-006a, §palette component.

## 2026-06-27 — Zoom-based label culling (FR-012a)
What: As a component symbol shrinks on screen, its labels are progressively dropped so fixed-size text doesn't bury a small symbol: below a first threshold pin name labels disappear, below a second the type display-name line disappears too, leaving only the U-number (re-centered). Gated on apparent on-screen symbol size — min footprint dimension × pixels-per-grid-unit — not raw zoom, so a physically larger part keeps its labels to a lower zoom than a small one. Subunits gate only the pin-label step; built-ins are unaffected. Chosen with the user over text-measurement and raw-zoom-factor alternatives.
Why: At small on-screen sizes the fixed-pixel pin/type text overwhelmed the scaled symbol into a mess of squiggles.
Touches: FR-012a (new; FR-012/FR-015); design §rendering FR-012a.

## 2026-06-27 — Right-click recenter arms a pending zoom anchor (FR-023b)
What: After a right-click recenter, a zoom (FR-022) begun before moving the mouse now anchors at the canvas center instead of the stale cursor position, so the recentered point stays fixed under the zoom. A browser cannot warp the OS cursor the way KiCad does, so a pending zoom anchor at canvas center is armed on recenter and cleared on the next pointer movement.
Why: Previously the recentered point drifted on the first zoom because wheel zoom anchored on the off-center cursor.
Touches: FR-023b (FR-022); design §interaction state table.

## 2026-06-26 — Test vectors, combinational v1 (FR-115)
What: A new **test-vector** feature — an authored table of input patterns + expected outputs, run against the slow simulator with pass/fail scoring. v1 is combinational-only: inputs drive the design's input-switch built-ins (FR-071c), outputs check its indicators (FR-068/FR-071d). Reached from a new **Simulate ▸ Test Vectors…** menu (FR-004a); a large modal table editor (columns auto-derived from the design) with **+Row**, **Run**, **Capture** (fill expected from a sim run), and **Load/Save** of a `.tv` JSON sibling file via the existing server file browser (FR-053). The run executes on a throwaway clone of the design — never mutating, dirtying, or undoing it — settling each row independently like the live combinational simulator (FR-085). Decided with the user: bind to switches/indicators (not ports) for v1; capture-expected included; sibling-file storage; large modal surface. Sequential vectors with a vector-owned deterministic clock are recorded as the forward direction (FR-115e) but not built. This revives the separate-test-vector-format idea OQ-012 had set aside; OQ-012 updated to note vectors (block I/O verification) and memory-as-stimulus (program driving) now coexist.
Why: Automate verification of combinational logic instead of manually toggling switches and eyeballing indicators.
Touches: FR-115/115a–e (new), FR-004a (Simulate menu), OQ-012 (revised); design §6.16, §7.7, traceability.

## 2026-06-26 — Rename the New-GAL / New-MEM palette buttons (FR-066c/FR-114)
What: The upper-palette action tiles now read **NEW GAL** and **NEW MEM** (were "+ GAL" and "MEM"), at the same small font the part tiles ("74163") use. A new `.galdlg-newtile` CSS rule lets the two-word label wrap to two lines so it fits the fixed 48px tile without enlarging the font.
Why: Clearer that the buttons author a new part/device, not place an existing one.
Touches: FR-066c, FR-114 (button labels); design §6.11.

## 2026-06-25 — Persist generated memory devices to the component library (FR-114f)
What: Memory devices created via the MEM button are now written to srv/components as .yaml artifacts and registered live, exactly like authored GAL parts (FR-007a) — resolving the last deferred memory-device aspect (FR-114b/OQ-013). The device YAML carries its explicit pinout (pins + ADDR/DATA groups) plus a `mem:` block {kind, addressBits, dataWidth, locations, romFile?}; the server parses it generically and serves it from /components, so on reload the device reappears in the palette, places, and simulates (the built-in behavior binds from the serializable `mem` data, not session-only code). Creation only — the server unconditionally refuses to overwrite an existing id or file (409, surfaced inline); a full in-app editing interface is deferred. Scope decided with the user: MEM only (GAL already persisted); full serialized-type YAML (explicit pins) rather than a minimal mem block.
Server: ComponentType gains a Mem field; yamlparse parses the `mem` block; Create accepts a part carrying either a partnumber (GAL) or a mem block. Client: new memDeviceYaml serializer; onNewMemDevice now POSTs via createComponent instead of the in-session registry.
Touches: FR-007a (mem devices + never-overwrite), FR-114b (persistence implemented), FR-114c (server-side dup reject), FR-114f (new), OQ-013 (resolved); design §6.4, §6.11, §7.1, §7.6, traceability.

## 2026-06-25 — Remove bend points that don't bend (FR-033c)
What: Non-bending (collinear) bend points are no longer created or kept by editing actions. On completing a new wire or bus, the committed path is pruned of any interior bend collinear-and-between its neighbours (covers straight-line waypoints and collinear routed corners) — part of the single creation command. On ending a drag of an existing bend, a now-collinear bend is deleted rather than moved. On ending a drag begun on a straight segment, a released-collinear point creates no bend. Applies to wires and buses alike; only these new actions, no retroactive sweep. Implemented via new pure helpers geometry.js isRedundantBend/pruneCollinearBends (cross-product within 1e-9 + bounding-box containment); model addWire/addBus untouched. Decisions (with the user): apply to both wires and buses; suppress the straight segment-drag bend; new actions only.
Touches: FR-033c (new); design §6.7, §6.9.

## 2026-06-25 — Menu keyboard accelerators + visible hints (FR-004b)
What: Standard accelerators added to the menus where they make sense, shown right-aligned in each menu row. New bindings: File Open Ctrl/Cmd+O, Save Ctrl/Cmd+S, Save As Shift+Ctrl/Cmd+S; View Zoom In Ctrl/Cmd+=/+, Zoom Out Ctrl/Cmd+-. Existing Edit shortcuts (Undo/Redo/Copy/Paste) now also display their hints. New gets none (Ctrl/Cmd+N is browser-reserved and uninterceptable) and Refresh Types none. The new File/View keys live in interaction.js's global keydown handler (initInteraction now receives fileops); Save and zoom stay live while simulating, Open is gated by the lock. Hints are platform-appropriate (⌘/⇧ on macOS, Ctrl+/Shift+ elsewhere). Decision (with the user): leave New unbound rather than advertise a key the browser won't deliver.
Touches: FR-004b (new); design §6.11.

## 2026-06-25 — Properties panel: synthetic endpoint sheet for a selected wire/bus (FR-020d)
What: Selecting a single wire or bus now shows a read-only property sheet naming the conductor's two endpoints, generated dynamically each selection (designator labels can change, FR-011b). A component-pin endpoint reads "<designator> <pin>"; a bus-breakout tap reads "<group>[<bit>]" (snapped pin-group name + tapped bit, else the bus id); a group-snapped bus endpoint reads "<designator> <group>"; anything else (dangling free end, plain junction) reads "unconnected (x, y)". Decisions (with the user): bus identity = snapped group name + index; other endpoints shown by coordinates; bus→group endpoints as designator + group name.
Touches: FR-020d (new); design §6.11.

## 2026-06-23 — Memory device generator: ROM content loading (.bin/.hex, FR-114e)
What: ROMs now load their content at Run. Format is chosen by required extension — .bin (raw bytes) or .hex (whitespace-separated hex byte tokens) — bytes pack little-endian into dataWidth-bit locations (width 4 = low nibble), file byte 0 = location 0. Content is read from the server each Run (only the path is saved), so editing the file and re-running reloads it; a missing/wrong-type/malformed file is reported and that ROM reads U. Server: ListDir gained an extension filter and a new GET /romfile endpoint (ReadFileBytes, 64 MiB cap); the ROM picker filters to .bin/.hex. Client: memory.js parseHexBytes/parseRomBytes + core.loadBytes; createSim.run() is now async (loadRomContents) with a starting-flag guard; buildSimulation takes a romContent map; validateMemSpec rejects a non-.bin/.hex ROM file. Decisions (with the user): require the extension (no content sniffing), little-endian packing, load at Run from the server.
Touches: FR-114b (narrowed to persistence), FR-114d (ROM reads content), FR-114e (new), FR-053 (ext filter), OQ-013 (narrowed); design §6.4, §6.11, §6.13, traceability.

## 2026-06-23 — Memory device generator: RAM/ROM simulation behavior (FR-114d)
What: Implemented the built-in RAM/ROM behavior so placed memory devices simulate. New engine/memory.js createMemoryCore holds the per-device store + read/write/output-enable logic over four-state values; sim.js routes a memory type (typeData.mem) to a new kind:"memory" entity that reads input nets (the first built-in to do so) — writes latch on the WE/ rising edge in the register pre-phase, the contribution phase drives D0..D(w-1) per the enable logic. Settled semantics: RAM powers up all-U (unwritten reads U); reads/enables follow inputs by one unit (FR-078); Z reads as U; uncertain controls drive pessimistic U; undecodable address reads U and drops a write; while WE/ low the outputs are disabled (Z). ROM never writes and (no content loaded yet) reads U everywhere. ROM content-file loading and cross-session persistence remain deferred (FR-114b/OQ-013).
Touches: FR-114b (behavior no longer deferred), FR-114d (implemented), OQ-013 (narrowed); design §6.11, §6.13, traceability.

## 2026-06-23 — Memory device generator: name field + duplicate-name rejection
What: Added a required free-form Name field to the New memory device dialog; it sets the type's display name and derives its library id (type-<name>), so two devices with different names are distinct types. The field is pre-seeded with a size-based suggestion (e.g. "RAM 256×8") that auto-tracks class/size/width until the user edits it. memDeviceType now takes the name (id/name no longer derived from kind/size). On Create, a name whose derived id collides with any existing type (loaded part, GAL part, built-in, or earlier memory device) is rejected inline (the in-session analogue of the server's FR-007a duplicate-id 409), replacing the previous "identical pinout reuses the id" behavior.
Touches: FR-114, FR-114a, FR-114c; design §6.11.

## 2026-06-23 — Memory device generator: generate the placeable type (pinout)
What: Made the New memory device dialog's Create real — `memDeviceType(spec)` (builtins.js) synthesizes the IC-style ComponentType per FR-114c (A0..A(n-1)+CE//OE/[/WE/] left, D0..D(w-1) right, ADDR/DATA snap groups, bidir data for RAM / tristate for ROM, U-series refdes), and app.js registers it live in the upper palette via addCreatedPart (dedupe by derived id). In-session only: no behavior yet (placed device is behavior-less, drives U), no ROM-content read, no cross-session metatype persistence (placed instances still round-trip via embedded typeData). Fixed partOrder so memory devices (free-form names) sort into the trailing upper-region group instead of NaN.
Touches: FR-114b (narrowed to in-session/no-behavior), FR-114c (implemented); design §6.11, traceability.

## 2026-06-23 — Memory device generator: pinout and core RAM/ROM behavior
What: Nailed down the generated-device pinout and the core read/write behavior (spec only; the generator still stubs Create). Common pins: n address inputs A0..A(n-1) as a snap group ADDR, w data pins D0..D(w-1) as group DATA, active-low CE/ and OE/. RAM adds active-low WE/ and has bidirectional data; ROM data is tristate output. Layout (user choice): all inputs on the left (address then CE/,OE/,WE/), data on the right. Behavior: CE/=1 → data Z; read when CE/=0 & OE/=0 (RAM also WE/=1); RAM write latches on WE/ rising edge with address held stable while WE/ low and data forced Z while WE/ low; unwritten RAM reads U. ROM file format, RAM power-up init + exact unit-delay edge semantics, and persistence remain deferred.
Touches: FR-114b (narrowed), FR-114c, FR-114d (new), OQ-013 (narrowed); design §6.11, traceability.

## 2026-06-23 — Memory device generator: New memory device dialog (RAM/ROM)
What: First chunk of a memory-device generator, modeled on the GAL generator. A new upper-palette "MEM" action tile opens a New memory device dialog with a RAM/ROM radio (default RAM, re-initializes the dialog on change), a size control entered as address bits n (→ 2ⁿ locations, 1≤n≤24), a data-width select {4,8,16,32} (default 8), and — ROM only — a content-file picker reusing the server-side file browser (FR-053). Pinouts, built-in behaviors, ROM file format, and persistence are deferred (FR-114b/OQ-013); for now Create validates+gathers the spec and is wired to a submit stub (toast only — no component created yet). The address-bits-vs-capacity input, the server-side file picker, and the stub-Create scope were chosen with the user.
Touches: FR-114, FR-114a, FR-114b (new), OQ-013 (new); design §6.11, traceability.

## 2026-06-23 — Clarify FR-083: a strong U suppresses weak drivers (net resolution)
What: Tightened FR-083 (and the §6.13 net-resolution description) to state explicitly that "enabled strong driver" means any strong driver contributing a non-Z value (0, 1, or U) — so a strong U (e.g. an uncertain tristate enable) suppresses pull-ups/pull-downs and forces the net to U, and weak drivers decide only when every strong driver is Z. Documentation of the existing resolveNet behavior; no code change. Prompted by fast/C-generator planning (FR-107/FR-108) needing the strength-tier semantics pinned down. Net values remain four (FR-077); strength is a driver attribute, not a fifth value.
Touches: FR-083; design §6.13.

## 2026-06-23 — Tap a bus bit by terminating a wire on it (reverse breakout)
What: Drawing a wire from a pin and clicking onto a bus now pops the same bit-choice dialog as starting a breakout from the bus, and creates the single-bit breakout connection — previously the terminating click landed on no target and was swallowed as a waypoint. The committed wire follows the route already drawn (a breakout *started* on a bus still commits straight). breakoutBit/breakoutBitCmd gained an optional bends arg; breakoutBitCmd resolves a branch far-endpoint via resolveSpec.
Touches: FR-043b (new); design §6.9 (breakout, WIRE state table), traceability.

## 2026-06-23 — Keep the source group's bus brace shown while dragging
What: Fixed a bug where a bus started on a pin-group snap lost its source brace as soon as the cursor dragged out of that group's snap range (the brace only reappeared once the bus was committed). The in-progress source group's brace now stays drawn for the whole drag, alongside any prospective destination brace.
Touches: FR-042b; design §6.9.

## 2026-06-22 — Divorce internal identity from display names (type id + editable designator label)
What: Introduced an immutable, library-unique type `id` (e.g. `type-74138`, `type-22V574`) as the sole library key — for the palette, placed instances' `type`, the behavior cache, and Refresh Types — divorced from the now free-form, editable display name (`type` for 74-series, `partnumber` for GAL). The palette tile shows the full display name as button text (no more "74" stripping or GAL family label), at a font small enough for five characters; the tooltip is retained. For instances, the existing `refdes` (U/A/N/X) stays the immutable internal identity (foreign key for vertices/group-snaps/selection/persistence); a new optional, free-form `label` carries the *displayed* designator, defaulting to the `refdes` and user-editable in the properties panel with no uniqueness/format checks. Save format bumped 1→2 with a pure textual migration re-keying each instance's `type` to the type id (`type := "type-"+(partnumber||name)`); the `label` is lazy (needs no migration). YAML gains an `id` key (optional, derived when absent); all 25 library files set it explicitly.
Why: Requested — allow flexible labeling of parts and instances without the labels being load-bearing identifiers.
Touches: FR-005, FR-005b, FR-011, FR-011a, FR-011b (new), FR-012, FR-020a, FR-057, FR-066b, FR-066e (new), FR-007a, FR-088, FR-112; design §6.2, §6.3, §6.4, §6.6, §6.11, §6.14, §7.1, §7.1a, §7.2, §7.4, §7.6.

## 2026-06-22 — Note editing via DOM textarea overlay
What: Replaced the note's canvas keystroke-capture text entry with a real DOM <textarea> overlaid over the note while editing, giving native caret/selection/clipboard. The canvas hides the note while editing; on commit (Enter/Escape/blur/tool-switch) the textarea value writes back via setNoteText. Overlay is drawn unrotated regardless of note rotation (deferred). Resolves OQ-011.
Touches: design §6.8 (drawNote skips edited note), §6.9 (textarea overlay), §6.11, OQ-011 (resolved).

## 2026-06-22 — Note outline only when selected
What: A text note (FR-071f) now draws its blue dotted outline box only while selected or editing; at rest only the text shows.
Touches: FR-071f, FR-012 (§3.4a); design §2.1 built-ins list, §6.8 (`drawNote`), §6.11.

## 2026-06-22 — Text note built-in
What: Added a built-in text note object: a `NOTE` palette tile placing a blue-dotted box that holds free-form, multi-line text. It is a pure annotation — no pins, no netlist/sim participation, no designator or type label. Text entry begins on placement and re-opens on double-click; Enter commits, Shift+Enter inserts a newline. The box auto-sizes (whole grid units) to its text. Selectable/movable/deletable/rotatable like other objects; rotation turns the box and its text together (text reads at the rotated angle). Per-instance `text` round-trips with the design.
Why: Requested feature — annotate schematics with explanatory text.
Touches: FR-071f (new, §3.4a); FR-011a/FR-012/FR-020/FR-067a (note carve-outs); design §2.1 built-ins list, §6.8 (`drawNote`), §6.9 (note text-entry mode), §6.11 (`note` entry + `inst.text`).

## 2026-06-21 — Copy and paste
What: Added Copy (Edit menu / Ctrl-Cmd+C) and Paste (Edit menu / Ctrl-Cmd+V). Copy captures the selected components plus the wiring interior to the selection (the FR-018c rule) into a session clipboard; whole subunit packages copy together. Paste instantiates the fragment with fresh U-/A-/X- refdes and fresh vertex/wire/bus ids, preserving interior connectivity, overrides, and switch state, and places it at the cursor via a floating ghost dropped on click (Esc cancels). One undoable action; pasted objects become the selection.
Why: Requested feature; the new Edit menu (FR-004a) was built to host it.
Touches: FR-111/FR-112/FR-113 (new, §3.5a), FR-004a (Edit menu gains Copy/Paste); design §6.15 (new), §6.11/§6.9/§6.10 references, file plan, traceability.

## 2026-06-21 — Flat toolbar replaced by a combined menu/tool bar
What: Replaced the row-of-buttons toolbar with a single bar carrying File/Edit/View pull-down menus on the left (File: New, Open, Save, Save As, Refresh Types; Edit: Undo, Redo; View: Zoom In, Zoom Out) and the modal tool buttons Select/Wire/Bus plus Run/Stop on the right. Modal tools and Run stay buttons (they need an always-visible active/running state); everything else moved into menus.
Why: The growing command set no longer fit as a row of buttons; menus make room for upcoming commands (e.g. Edit Copy/Paste). Spec-only slice; code change follows.
Touches: FR-004a (new), FR-026 (reworked), FR-076/FR-088 (toolbar→bar wording); design §6.11

## 2026-06-20 — Fast (generated C) simulator brought into scope
What: Specified the fast engine as a JavaScript, in-browser code generator that emits a standalone C simulator, reusing the slow simulator's GALasm compiler and netlist builder (DRY). Recorded four-state and tristate-conflict parity with the slow sim, and the deliberate deviation from sim-vision.md's standalone-Go server-side transpiler. Output format and batch stimulus (the latter via planned file-backed memory components) left as open questions.
Why: Design discussion settled the implementation language/location and the DRY reuse decision; capturing it as requirements before any code.
Touches: §1, §3.23 (new: FR-106–FR-110), §7 Constraints, OQ-011, OQ-012; design §6.13 (slow-sim modules reused) — design.md fast-sim section deferred.

## 2026-06-20 — Narrow bus may connect to a free sub-block of a wider pin group
What: A bus narrower than a pin group connects when the group has a contiguous run of unconnected pins ≥ the bus width, claiming the lowest such block (pack-low). E.g. two 4-bit buses share one 8-pin group; an 8-bit bus is refused once any pin is taken. Brace now spans the claimed block, not the whole group.
Why: Allow multiple narrower buses to share a wide pin group (e.g. an 8-pin group) without forcing exact-width matching.
Touches: FR-041 (reworked), FR-041a/b (reworked), FR-041c (new), FR-042/FR-042a/FR-042b/FR-042c (amended), FR-043 (amended); design §6.8, §6.9, §7 (Bus/GroupConnection)

## 2026-06-19 — First-click bus width adapts to nearby pin group
What: Before a bus's first endpoint is placed (no committed width), group-proximity feedback/snap now matches a group of any width and the bus adopts that group's width; strict width-matching resumes for the second endpoint.
Why: A bus started near a non-default-width group (e.g. a 4-wide 74157 group) showed no snap feedback because the first endpoint probed only at the default width (8).
Touches: FR-042c (new); design §6.9

## 2026-06-19 — Require pin groups to be same-side and contiguous
What: Made the long-standing implicit pin-group geometry assumption a hard rule:
every group's member pins must share one side and be contiguous on it (no
non-member pin between them) — the bus-snap curly brace (FR-042a) assumes the
members are colinear on one edge. The server now rejects a violating component at
load, and the New GAL part pin-groups sub-dialog refuses such a selection. Two
shipped parts whose symbols interleaved two same-side buses — 74157 (I0/I1) and
74283 (A/B) — were re-laid-out so each bus is contiguous on the symbol (`pos`),
keeping `number` at the true (interleaved) DIP pinout. Audit confirmed all other
groups already comply; no group was ever multi-side.
Why: an interleaved group draws a brace that spans the other bus's pins and makes
proximity targeting ambiguous; codifying the rule keeps every group's snap UI
correct and catches bad hand-authored or dialog-authored groups.
Touches: FR-063a (new); FR-066d (amended); design §6.3 (parser group validation),
§6.11 (pin-groups sub-dialog); components 74157.yaml, 74283.yaml (pin pos relayout)

## 2026-06-19 — Define pin groups in the New GAL part dialog
What: Added pin-group authoring to the New GAL part dialog (FR-066c). A "Pin
groups…" button opens a modal sub-dialog that lists the part's existing groups
(each removable) and defines one more from a name plus a checkbox subset of the
part's pins; a part may have several groups. Member order follows the pins'
physical layout order (the bus bit order). Membership is tracked by skeleton pin
(stable DIP number), not the label, so renaming a pin afterward doesn't break a
group; galPartYaml resolves members to current labels and emits a `groups:` block.
Groups don't affect the strict behavior validation.
Why: A multi-bit bus can only snap-connect to a declared pin group (FR-041/FR-063);
without this, an authored GAL part had no bus interface short of hand-editing YAML.
Touches: FR-066d (new); FR-066c (amended); design §6.11 (pin-groups sub-dialog)

## 2026-06-19 — Locked waypoints while drawing wires & buses (KiCad-style)
What: While a wire or bus is in progress, a single click on bare canvas now locks
an intermediate waypoint instead of being ignored (wires) or ending the conductor
(buses). The auto-router re-initializes from each waypoint, so the committed
conductor is the concatenation of independently-routed legs; the waypoints become
ordinary, draggable bend points on commit. Backspace removes the last waypoint;
Esc cancels the whole conductor. A conductor now completes only on a real target
(pin, wire/bus segment, or — for buses — a pin group / component body); a bus can
no longer be terminated at a free point in empty space by clicking (it may still
start free). UI-only: commands, model, and save format are unchanged.
Why: Let the user steer the router with locked corners without giving up
auto-routing, matching KiCad's interactive wiring.
Touches: FR-027e (new), FR-027a (amended); design §6.9 (FSM rows, route preview,
`wireWaypoints`/`legBends`)

## 2026-06-19 — Draw the 8-wide port as eight pin-aligned pentagons
What: Change the placed (canvas) rendering of the built-in 8-wide port / off-sheet
connector from four stacked pentagons to eight narrow pentagons, one roughly
aligned with each of the eight left-edge bit pins. The palette icon (PORT8_ICON)
is left unchanged, so the placed object and the icon no longer match exactly.
Why: Eight pentagons read as one-per-bit, matching the eight connection points.
Touches: FR-071e (amended); design §6.11 (drawPort8)

## 2026-06-19 — Draw the 1-wide port / off-sheet connector as a pentagon
What: Render the built-in single port / off-sheet connector on the canvas as a
pentagon "flag" (apex pointing off-sheet at the front, connection pin on the flat
back edge facing into the sheet) instead of a box. The apex↔pin relationship is
preserved under rotation; the label stays upright. The palette icon (PORT_ICON) is
flipped to match (apex away from the connection point).
Why: A pentagon reads as an interface/off-sheet flag and matches the 8-wide port
(FR-071e); the box did not convey signal-leaves-the-sheet directionality.
Touches: FR-094b (new); design §6.14 (drawPort pentagon)

## 2026-06-19 — In-app "New GAL part" authoring (22V10) with per-part number
What: Add a GAL-part authoring path so a 22V10 can be specified in-app instead of
hand-editing YAML, strictly enough to later burn with real GALasm. A "New GAL part"
dialog presents the fixed 24-pin GAL22V10 skeleton and collects only the per-part
data (part number, description, pin labels, per-OLMC direction, behavior), runs the
existing strict validator (`galasm.js validateStrict`) live, and on OK POSTs the
authored YAML to a new create endpoint that writes it into the library and serves it
live. GAL parts are keyed by a new unique `partnumber` (distinct from the device
family `type`); tiles read the family ("22V10") and the tooltip leads with the part
number so many same-family parts stay distinguishable on hover. A placed GAL
instance records its part number as its instance type identity (saved value, sim
behavior-cache key, Refresh Types match, on-canvas chip label), so same-family
instances stay distinct everywhere.
Why: A 22V10 is programmable — its logic is user-authored, not transcribed from a
datasheet — so it needs an authoring UI and a unique identity per programmed part.
Touches: FR-005b, FR-007a, FR-066b, FR-066c (new); FR-007, FR-088 (amended);
design §6.2/§6.4 (create endpoint), §6.11 (palette + New GAL part dialog), §6.13
(validator reuse), §7.1 (`partnumber`), §7.2 (instance `type` = library identity),
§7.3 (YAML writer table)

## 2026-06-18 — Group-snap bus connection rendered as a curly brace
What: Replaced the interim blue-diamond connected mark with a large curly brace
enclosing the connected pin group: tips touch the group's outermost pins and the
two halves (upper/lower cubic splines) meet just outside the group in a point (the
apex), where the bus terminates. The apex is grid-aligned — anchored on the
group's middle pin (floor(n/2)) with an integer outward depth, so it lands on a
grid intersection even for an even pin count (the halves are then slightly
asymmetric). On connect, the bus endpoint is placed at the apex (geometry only —
connectivity unchanged). Group targeting is now by proximity (FR-042b): the brace
previews live whenever the bus tool's cursor nears a width-matching group's pins —
no click on the part body required — choosing the nearest group when several
match, and a click anywhere the brace shows starts/ends the bus there. Every
connected bus is always drawn with its brace; dangling free ends keep the red
square.
Why: a clear, schematic-style indication that a bus is connected to a group, far
more legible than a small mark hidden under the body, and easier to target.
Touches: FR-042, FR-042a, FR-042b (new); design §6.8, §6.9

## 2026-06-18 — Fix group-snapped bus: connected indicator + follow on move
What: A bus snap-connected to a component's pin group (FR-042) is a `free` vertex
that the model treats as connected, but two paths misrepresented it: (A) the
renderer drew the red "dangling" square on it (hidden under the component body, so
it looked connected until the component was moved), and (B) moving/rotating the
component left the snapped endpoint behind, detaching the bus visually. Fixes:
drawVertices now draws a positive connected marker (not the dangling square) for a
group-snapped free vertex, and vertex marks are drawn after components so a body
can't hide them; rigidWiring now counts a group-snapped bus endpoint as a
connection to its component, so the endpoint follows the move/rotate (rigidly when
interior, stretching when a boundary bus). Both bugs were pre-existing for any
group-snapped bus; the large 8-wide port just made them obvious.
Why: a connected bus was indistinguishable from a disconnected one and broke on
move.
Touches: FR-018, FR-018c, FR-042; design §6.8

## 2026-06-18 — Add 8-wide indicator and 8-wide port built-ins
What: Added two built-in objects, each 3×9 with eight left-edge pins forming one
pin group so an 8-bit bus snap-connects to all bits at once. (1) `indicator8` —
an 8-wide state indicator drawn as an LED bar-graph (eight stripes, each lit from
its bit's live value with the 1-wide indicator's white/black/gray mapping);
display-only, pins D0–D7, group "D", tooltip "state indicator (8-wide)".
(2) `port8` — an 8-wide port / off-sheet connector drawn as a short stacked column
of pentagons; pins P0–P7, group "P", tooltip "port / off-sheet connector (8 wide)".
For now port8 is a grouped bus terminal only — it drives nothing and does not yet
do same-label net joining (FR-094a) or off-sheet cross-file links (FR-101); those
off-sheet semantics are deferred.
Why: let an 8-bit bus terminate at a labeled off-sheet point and be monitored as a
bar-graph, both via a single bus snap.
Touches: FR-071d, FR-071e (new); design §6.8, §6.11

## 2026-06-18 — Save-format versioning & migration scaffolding
What: Formalized save-file versioning. The `formatVersion` field (already written
as `1`) now anchors a migration framework in `persist.js`: a `MIGRATIONS` chain
plus a `migrate()` step, called from `deserializeDesign`, that upgrades an older
file forward to the current version on load (absent version = oldest), rejects a
load when a required upgrade step is missing, and passes a newer file through for
the existing forward-compat warning. The chain is empty while only version 1
exists; `FORMAT_VERSION` stays 1. Added unit tests exercising the chain via
injected migrations.
Why: prepare the compatibility path now so future save-format changes — adding
information as the product evolves — can load older designs without breaking them.
Touches: FR-060c (new); design §7.4, §7.2

## 2026-06-17 — Clear selection and message tray on Run/Stop
What: Starting a simulation now clears the current selection (it is locked during
a run anyway) and clears the status-bar message tray before the run's own
start-up reports are posted; stopping a simulation clears the message tray again
(dropping any leftover run-time message, e.g. the selection-lock notice).
Why: a stale editing-time message or a stuck selection highlight carrying into or
out of a run is confusing.
Touches: FR-076, FR-087; design §6.13

## 2026-06-17 — Lock editor selection while the simulator runs
What: While a simulation runs, the editor's selection is now locked along with
the rest of editing. A click that would select a wire, bus, or non-interactive
component instead posts "Editor is locked while the simulator is running" to the
status bar and changes nothing; bare-canvas clicks (and their marquee) are
ignored silently. Clicks on interactive built-ins (the input switch, FR-087a/b)
still apply their input action. Previously selection stayed available during a
run.
Why: selecting/retargeting/clearing objects during a run served no purpose once
all editing was locked, and was confusing.
Touches: FR-087, FR-087b; design §6.9

## 2026-06-17 — Input switch: two states, indicator-style bubble
What: Redesigned the input-switch built-in. It now has only two states, 1 and 0
(the undefined ? / U state is removed; default is now 0). It is drawn like the
state indicator — a round value bubble (white 1 / black 0) — with a small arrow
off the bubble toward the output pin, instead of the hard-to-read rotary dial
with tiny 1/0/? marks. Clicking it during a run toggles 0↔1; the properties
panel offers a 1/0 selector. A legacy "U" in an old saved design reads as 0.
Why: the dial marks were too small to read and the U state added little value.
Touches: FR-071c, FR-087a, FR-020c; design §2.1, §6.9, §6.11, §6.13, §7.2

## 2026-06-17 — Fix never-clearing canvas bottom strip
What: The renderer sized its device-pixel backing store only on `window` resize
(and once at init, before the status bar populated its trays), so a layout
change that shrank the canvas without a window resize left the backing store
stale; the per-frame `clearRect` then cleared only the live (smaller)
`clientHeight`, leaving an uncleared bottom strip that accumulated drag-image
fragments. Fix: keep the backing store in sync via a `ResizeObserver` on the
canvas, and clear the whole backing store in device pixels each frame.
Why: visible garbage strip above the status bar.
Touches: design §6.8

## 2026-06-17 — GALasm dialect: device-named strict vs. extended
What: Added an optional `gal: <device>` YAML key (one of GALasm's four device
names: GAL16V8/GAL20V8/GAL22V10/GAL20RA10). Naming a device selects *strict*
simulation — the slow simulator accepts only that device's GALasm language
subset and physical capacity and refuses to run otherwise (a pure accept/reject
preflight gate that never changes simulation results). Omitting it (the default
for the non-GAL 74-series library) selects the *extended* dialect: the union of
the four GAL device dialects with capacity limits lifted, plus an XOR operator
and the GAL20RA10 per-output `.CLK`/`.ARST`/`.APRST` clock/reset/preset suffixes.
Extended reaches parts flat SOP could not — the 74HC283 adder (XOR) and the
dual-clock 74HC74/192/193/595 (per-output clocks). Documented that complementary
outputs (74HC151/175/165) need no language change (name the inverted pin without
a leading `/` and derive it), and that async load of *variable* data (74HC165)
remains outside even the extended dialect.
Why: Several `moar-parts` components could not be modeled (notes/missed-components.md).
Discussion rejected a full Verilog parser (disproportionate; stakeholder dislikes
it) and a bare strict/extended boolean (can't name which device); a device-named
knob makes strict a real fit-checker and gives extended a principled definition
grounded in real GALasm. Specs-only; implementation to follow.
Touches: FR-062d, FR-066a (new), FR-079a (new), FR-079b (new), glossary; design
§6.3, §6.13, §7.6, §8.

## 2026-06-16 — Rotate the selection as a rigid group
What: Rotate (R) now turns the whole selection as one rigid body about a single
grid-snapped pivot — every selected component plus the bends/junctions interior
to the selection (FR-018c) rotate together, preserving the sub-circuit's shape.
Pivot: a single component's own origin (unchanged in-place rotation); otherwise
the grid-snapped center of the selected components' bounding box. Replaces the
old "each component about its own center", which left interior junctions/bends
behind and tore multi-component sub-circuits apart on rotation.
Why: Reported bug — junctions did not rotate with the parts. User chose the
rigid-group model.
Touches: FR-019 (reworked), FR-016a; design §6.9 (FSM), §6.10 (rotateSelectionCmd).

## 2026-06-16 — Junction points are draggable
What: A wire/bus junction (branch dot) can now be dragged to a new grid
intersection like a bend point, moving the shared vertex so every conductor at
the junction follows. Previously junctions were immovable: the bend hit-test
only matched `bend` path points and ignored `junction` nodes, so a click never
picked one up.
Why: Reported bug — junctions could not be repositioned, with no spec covering
the case.
Touches: FR-032a (new); design §6.9, §7.1a (moveVertex/moveVertexCmd).

## 2026-06-16 — Routed wires must not overlap existing wires
What: The Manhattan route proposal must avoid lying collinearly on top of
existing wires/buses; crossings (sharing a single grid point) stay legal. The
router gains an occupied-edge set from existing conductors and refuses to
traverse an already-occupied unit edge. More routes will fall back to the
straight rat's-nest line as a result.
Why: A wire resting directly on another wire is visually and electrically
ambiguous — too obvious to have been written down originally. Reported as the
top complaint about the editor.
Scope: auto-routing at draw time only. Enforcing the invariant on manual bend
drags (FR-031/FR-032) and component moves (FR-018) is a deferred follow-up.
Touches: FR-027c, FR-027d (new); design §6.9a.

## 2026-06-15 — Hierarchical sub-designs, ports, and off-sheet connectors
What: Added the ability to embed a separately-saved design into a higher-level
design. A single built-in **port** primitive declares a design's external
interface (label/direction/width) and, with an off-sheet target, acts as an
off-sheet connector. A single **ADD** palette entry embeds a child design as a
sub-design instance (X-series refdes, multiple instances, live relative-path
reference — no copied type data), rendered cosmetically as an IC rectangle or a
connector strip. Navigation descends into a child / follows a connector via the
Open flow (save-or-lose) with a back-stack. The slow simulator flattens
sub-designs (hierarchical refdes) and unions off-sheet nets by label across peer
sheets, with cycle detection. Spec only; implementation pending.
Why: Stakeholder feature request to reuse designs hierarchically and split
circuits across sheets; the vertex model had reserved a `connector` kind for it.
Touches: FR-094–FR-103 (new §3.22), FR-060b (new), FR-057 (supersession note),
§5 data table, OQ-010 (new), glossary; design §6.14 (new), §7.1a, §7.2, §6.6,
§8, §9, §10.

## 2026-06-14 — Palette tile tooltip shows the description
What: A palette tile's tooltip now includes the component's one-line description
(FR-104) alongside the full type name, as "<name>: <description>", so hovering a
tile previews what the part does before placing it. Parts with no description
keep the plain full-name tooltip.
Touches: FR-005a (new); design §2.1, §10, §11.2.

## 2026-06-13 — Component documentation fields and panel section
What: Component YAML may carry optional documentation (one-line description,
datasheet vendor/title/rev/url, and per-pin role text). The server parses and
copies these onto the type; the properties panel shows them in a read-only
Documentation section when a component is selected (description and datasheet
link, plus a collapsible pin-role list). Documentation is presentation-only and
never affects geometry or simulation.
Why: A part's human-readable identity (what it does, its datasheet, what each
pin means) lived only in YAML header comments that nothing parsed or displayed.
Touches: FR-104 (new), FR-105 (new); design §6.3, §6.11, §7.1, §7.6, §10, §11.1,
§11.2. Also updates the make-yaml-from-datasheet skill and backfills the nine
existing component YAMLs.

## 2026-06-14 — Zoom-independent pick tolerance for wires/buses/bends
What: Wire/bus segment and bend pick tolerances are now constants in screen
pixels (≈6 px segments, ≈8 px bends), converted to world units at the current
zoom in `interaction.js`, replacing the fixed ~0.4/0.5 grid-unit tolerances.
Why: A world-unit tolerance made the catch band a ~3 px target at default zoom
and a sub-pixel target when zoomed out, so selecting wires and starting a
bend-drag were finicky and inconsistent depending on zoom. A pixel-constant band
stays a comfortable, predictable size at every zoom. The pin hot region
(FR-013d) is unchanged — its size is tied to the grid pin pitch, not the cursor.
Touches: design §6.9 (hit-testing tolerance).

## 2026-06-13 — Combinational sims run continuously; general interactive-input mechanism
What: Combinational designs (no clock) no longer auto-terminate after settling.
They run live until Stop (FR-076): step to quiescence, then idle (no CPU) until
an interactive input perturbs them, then re-settle. The 10,000-unit bound is now
a per-settling-episode oscillation guard (report once + idle, not terminate).
Introduced a general interactive-input mechanism (FR-087b): a built-in may
register an `INTERACTIONS` handler; a sim-time click on it applies the handler
live (`store.applyLive`, non-undoable) and wakes the simulator via the store's
live-input channel (`subscribeLive`). The switch's click-to-cycle (FR-087a) is
now the first instance of this mechanism rather than a special case.
Why: The old single-cycle/auto-terminate model gave interactive inputs no window
to act in a combinational circuit, making the switch useless there. The
mechanism is generalized so future manual-input components need no scheduler or
FSM changes.
Touches: FR-085 (rework), FR-087a (rework), FR-087b (new); design §6.9, §6.10,
§6.11, §6.13, traceability.

## 2026-06-13 — Input switch built-in (interactive logic source)
What: New built-in object — a rotary input switch with a right-edge output and
three positions 1 / 0 / ? (U), drawn as a dial. It strong-drives its output to
its position's value. Position is persisted per-instance state (`switchState`,
default U), set in the properties panel while editing and by clicking the dial
while a simulation runs (cyclic ? → 1 → 0 → ?).
Why: Provide a user-controllable logic input source. Editing-time setting (via
the property sheet) keeps it usable for combinational designs, which auto-settle
and so offer no live-click window; the dial click serves live sequential runs.
Touches: FR-071c (new), FR-087a (new), FR-020c (new), FR-067a, FR-057/§5 table;
design §6.8, §6.9, §6.11, §6.12, §6.13, §7.2, traceability.

## 2026-06-13 — KiCad-style canvas interaction: rubber-band select + right-click recenter
What: Left-drag on bare canvas no longer pans; it draws a rubber-band selection
rectangle (FR-016b). Horizontal drag direction sets the mode: drag right = window
(only fully-enclosed objects); drag left = crossing (anything the rectangle
touches). Plain rubber-band replaces the selection; Shift adds. Selection updates
live during the drag; Esc cancels and restores the prior selection. Right-clicking
bare canvas recenters the view on the cursor (FR-023b); right-click on an object
still opens its context menu (FR-033b). Middle-drag and Space+left-drag panning
remain.
Why: Match KiCad's selection/positioning model.
Touches: FR-016b (new), FR-023b (new); FR-016a, FR-023a (reworked), FR-033b
(updated); design §8 states + transition table, §6.8 renderer (`setMarquee`),
§6.x hit-testing (`marqueeHits`), toolbar note.

## 2026-06-13 — Group move carries interior wiring (FR-018c)
What: When components are dragged together, wiring whose every pin endpoint is on
a component in the moving set translates rigidly with them — bend points and
junction/free vertices shift by the same offset — instead of stretching. Wires to
unselected components still stretch (FR-018). Implemented with a new
`TranslateWiring` command folded into the group-move composite (one undo).
Why: Moving a wired sub-circuit left bends and black-dot junctions behind,
distorting the wiring.
Touches: FR-018c (new); FR-016a, FR-018; design §8 transition table, §6.10
commands (`TranslateWiring`).

## 2026-06-13 — Multiple selection via shift-click
What: The selection becomes a set of objects. Shift-clicking a component, wire,
or bus toggles its membership; a plain click still replaces the selection and a
click on empty canvas clears it. Delete, drag-move, and rotate act on the whole
selection (mixed kinds allowed; a group move moves only components — selected
wires/buses are not moved, though endpoints on moved components follow their pins). Properties panel is blank unless exactly
one component is selected. Reverses the prior "multi-select out of scope".
Group operations apply/revert as a single Ctrl-Z via a new `composite` command.
Why: Standard editor interaction; lets the user act on several objects at once.
Touches: FR-016a (new); FR-016/017/018a/019/020a; requirements §3.x out-of-scope;
design §6.10 state shape + composite command, §8 transition table, out-of-scope list.

## 2026-06-13 — Project renamed wut4-editor → retrosim
What: Repo extracted from the wut4 monorepo and renamed "retrosim". Replaced
"wut4-editor"/"wut4" everywhere: Go module path → github.com/gmofishsauce/retrosim/sim/srv,
cmd/wut4-editor → cmd/retrosim, default designs folder → ~/Documents/retrosim,
localStorage backup key → retrosim.backup, temp prefix → .retrosim-*.tmp, plus
window title, log prefixes, and the server-unreachable message.
Why: Project rename after monorepo extraction.
Touches: FR-050; design §4.2, §6.1, §6.x (paths/storage), §9, §10 (test plan)

## 2026-06-12 — Saving under a new file name renames the design
What: A save whose chosen file name differs from the design's name renames the
design to the file's base name (sans .json): toolbar label, the name written
inside the file, and future save prompts all follow; subsequent saves still go
to the recorded path without prompting.
Why: Changing the proposed name in the first-save dialog left the toolbar
showing the stale default name and wrote that stale name inside the file.
Touches: FR-047a (new); design §2.1, §6.10, §6.11, §10, §11.1

## 2026-06-12 — Default save location moves to the user's Documents folder
What: Designs default to `wut4-editor` inside the user's documents directory
(macOS/Linux ~/Documents/wut4-editor, Windows %USERPROFILE%\Documents\
wut4-editor), created if absent; `AppDataDir` becomes `DesignsDir`.
Why: Storing designs in hidden platform app-data folders was a stakeholder
misunderstanding — designs are user documents. Resolves OQ-006.
Touches: FR-050 (reworked), OQ-006 (resolved); design §2.1, §6.5, §11.1

## 2026-06-12 — Server connection resilience: heartbeat reconnect + local backup
What: Client polls GET /api/v1/ping (~3 s); a status-bar connection tray shows
connected/disconnected. On server loss, editing continues and the message tray
warns: work is safe in the tab, do not reload, restart the server at the same
address/port. On reconnect (the server is stateless; saves carry the whole
design) a dirty design auto-saves to its known path, else the Save dialog
opens. A debounced localStorage snapshot of unsaved work (cleared on save) is
offered for recovery at next startup, covering reload/tab-close/browser-crash.
Why: If the server dies mid-session the browser cannot write the local file
system; without recovery the user's work is lost.
Touches: FR-089–FR-093 (new, §3.21); design §6.4, §6.11, §6.12, §6.12a (new),
§9, §10, §11.1

## 2026-06-12 — Power-on reset built-in; selective pessimism replaces strict-U
What: New "power-on reset" built-in (FR-071b): R/active-low /R outputs
asserted for the first `cycles` clock cycles of a run (property, default 3;
cycle = the single clock instance's effective period, else 100 ns). FR-077
reworked from strict pessimism to selective pessimism (0 AND x = 0,
1 OR x = 1; other U combinations still U; Z still reads as U).
Why: A placed 74163 never counted: registers power up U (FR-079) and strict-U
made registered feedback un-initializable — 0 AND U = U, so even a held
synchronous clear/load reloaded U forever. Selective pessimism lets a proper
reset initialize sequential logic (uninitialized paths still show U); the
reset built-in supplies that pulse without hand-wiring one.
Touches: FR-071b (new), FR-077 (reworked), FR-067a; design §2.1, §6.11,
§6.13, §8, §10, §11.1

## 2026-06-12 — Manhattan route proposal for wire/bus drawing
What: While drawing a wire/bus, the rubber-band preview shows a proposed
Manhattan route (A* around component outlines, pin-escape in the pin's facing
direction, few-corner preference) instead of a straight line; the committed
path follows the proposal, its corners becoming ordinary editable bend points.
Best-effort: straight-line preview and two-point commit remain as the fallback
when no route is found. Breakout taps (FR-043a) are excluded and keep the
straight preview and commit.
Why: A straight rat's-nest wire from a component's output back to its own
input runs under the body, where it cannot be grabbed for manual rerouting.
Touches: FR-027, FR-027a (reworked), FR-027c (new); design §2.1, §6.8, §6.9,
§6.9a (new), §9, §10, §11.1

## 2026-06-11 — "Refresh Types" action: re-copy library type data into instances
What: A toolbar Refresh action re-copies type data from the loaded component
library into placed instances (one undoable command), preserving refdes,
position, rotation, wiring, and overrides (dropping override keys the new
definition no longer declares). Structurally incompatible instances (changed
rendertype, or a wired pin no longer present — for subunits, in the same unit)
are skipped and reported via the message tray. Server restart + page reload
are still needed first (FR-007).
Why: Instances carry placement-time copies of type data (FR-057); while
iterating YAML behavior blocks during simulator bring-up, stale copies made
edited behaviors unreachable without delete-and-re-place ("no behavior" on a
7404 whose YAML clearly had one).
Touches: FR-088 (new, §3.20); design §6.6, §6.10, §6.11, §10, §11
- web/js/model/design.js, commands.js, chrome/toolbar.js

## 2026-06-11 — Wire cursor recentered: diagonal line + center dot
What: The wire cursor is now a diagonal line centered on the pointer,
interrupted by a small open dot at the midpoint; the hotspot is the image
center. The toolbar Wire button shows the same icon (FR-025).
Why: Stakeholder testing showed the tip-at-origin design (previous entry)
reads as a 2-grid-square "jump" the moment a rubber band anchors: the whole
glyph hangs below-right of the true active point. A symmetric glyph with a
center hotspot keeps the visible aim point and the active point coincident,
including under cursor scaling. Supersedes the previous entry's design.
Touches: FR-025 (rework); design §6.9
- web/js/engine/interaction.js (WIRE_CURSOR), chrome/toolbar.js (WIRE_ICON)

## 2026-06-11 — Wire-cursor hotspot anchored at the image origin
What: The wire cursor's line tip is now drawn at the SVG's (0,0) corner with
hotspot `0 0` (was: tip at (5,5), hotspot `5 5`). The origin is invariant
under cursor scaling (HiDPI / macOS pointer size) and is also the universal
hotspot fallback, so the visible tip is now the click point in every case;
previously the declared hotspot could drift from the drawn tip.
Why: Stakeholder report — wiring "feel" was off; the hotspot did not sit where
the cursor image appears to point.
Touches: design §6.9 (wire-mode cursor)
- web/js/engine/interaction.js (WIRE_CURSOR)

## 2026-06-11 — Wires draw to the bubble center; larger pin hot region
What: Wires/buses (and the rubber-band preview) are now *drawn* attaching at
the pin's visual attachment point — the bubble center for bubbled pins, the
on-grid connection point for subunit pins — instead of the bubble's body-edge
tangent point. Rendering only: the grid point stays the electrical and
persisted coordinate. The wire hot region (cursor change + click start/end)
grows from a 0.5-grid-unit circle on the grid point to a 0.7-grid-unit circle
on the visual attachment point, with nearest-pin-wins hit testing (required:
adjacent pins are 1 unit apart, and hitPin was first-match).
Why: Stakeholder UX request — the tangent-point attachment is unintuitive
under the mouse; a larger target eases wiring.
Touches: FR-013 (rework), FR-013d (new), FR-027b; design §6.8, §6.9
- web/js/model/design.js (pinVisualPos), engine/hittest.js, canvas.js,
  interaction.js

## 2026-06-11 — Slow (debug) simulator specified
What: Specified the in-browser interpretive simulator (sim-vision.md): unit-delay
timing (1 unit = 1 simulated ns, double-buffered), four-state values (0/1/U/Z,
strict-U pessimism), client-side GALasm compilation/evaluation of YAML behavior
blocks (.T/.R/.E, AR/SP, polarity XOR), all-drivers net resolution with weak
pull-up/pull-down, bus conflicts shown as red nets + message-tray reports,
Run/Stop toolbar button driving the "simulating" state tray, design read-only
while running, combinational designs auto-terminate on settling (10,000-unit
bound), sequential designs pace at period × speed simulated ns per real second.
New YAML key `clock:` names the pin that clocks .R outputs (FR-062d). The fast
C-generating engine remains out of scope.
Why: First step of the simulation phase; design settled with the stakeholder
(unit delay was the stakeholder's call over zero-delay/event-driven).
Touches: FR-062d, FR-075–FR-087 (new, §3.19); FR-067a, FR-068 (rework);
overview §1, constraints §7, glossary; design §6.3, §6.8, §6.9, §6.10, §6.11,
§6.13 (new), §7.1, §7.6, §8, §9, §10, §11
- new files (planned): web/js/engine/galasm.js, web/js/engine/sim.js

## 2026-06-11 — Built-in behaviors and settable properties (pre-simulator)
What: Groundwork for the planned client-side interpretive simulator. Component
types may declare named numeric properties (name/unit/default); per-instance
values are edited in the existing properties panel and persisted as overrides
under `overrides.props`. Each built-in registers a behavior — a client-JS
function in a `BEHAVIORS` registry keyed by type name (never serialized; call
interface deferred to the simulator design). The clock declares `period`
(simulated ns, default 100) and `speed` (perceived Hz, default 1): the simulator
will advance period × speed simulated ns per real second.
Why: The simulator needs parameterizable built-ins (e.g. clock rate) before it
can be designed and built.
Touches: FR-020b/FR-067a/FR-071a (new); design §6.11, §7.1, §7.2, §10
- changes web/js/builtins.js, properties.js, model/design.js, commands.js

## 2026-06-11 — Status bar with state and message trays
What: A full-width status bar docked at the bottom of the window, built from
drop-shadowed trays: a state tray at the lower-left corner showing the program
state ("editing" until the simulator exists) and a message tray filling the
rest, showing the most recent posted message.
Touches: FR-072/FR-073/FR-074 (new, §3.18); design §6.11, §9, §10
- new file web/js/chrome/statusbar.js

## 2026-06-10 — galasmManual.txt §5: language vs. physical-capacity rule
What: Behavior blocks adopt the GALasm language but not the GAL22V10's
physical capacity (pin count, OLMC count, per-pin product-term limits) —
stated explicitly in §5, established with the 74245's sixteen tristate
outputs. The bidirectional .T/.E idiom is recorded in the
make-yaml-from-datasheet skill.
Touches: specs/galasmManual.txt §5

## 2026-06-10 — §7.6 behavior example fixed: invalid GALasm parentheses
What: The example behavior block used `/Y0 = /(/E1 * ...)` — parenthesized
negation, which is not in the GALasm grammar (sum-of-products only, per the
parser-verified galasmManual.txt). Replaced with the valid physical-level
form used by srv/components/74138.yaml, with a comment naming the convention.
Touches: design §7.6

## 2026-06-10 — galasmManual.txt rewritten as an authoritative GALasm reference
What: Replaced the partial GALasm notes with a complete, 22V10-centric
reference derived by reading the actual GALasm 2.1 parser (daveho/GALasm,
src/galasm.c), cross-checked against the original GALer HTML docs and the
shipped example .pld files. Covers file structure, lexical rules, the
declaration/use polarity XOR rule, output kinds (.T/.R/.E), per-pin
product-term capacity, AR/SP, VCC/GND constants, and an error-condition
appendix. Project convention recorded: GAL type is always GAL22V10.
Why: the behavior blocks in component YAMLs must be valid GALasm for the
eventual simulator; the old notes were partial and non-authoritative.
Touches: specs/galasmManual.txt (referenced by design §7.6 authoring and the
make-yaml-from-datasheet skill)

## 2026-06-10 — FR-031 reworked: click selects, drag inserts a bend
What: A plain click on a wire/bus segment now (per spec) selects it; a
press-and-drag beginning on a segment inserts a bend at the nearest grid point
and drags it until release. Supersedes the original "click inserts a bend".
Why: matches the long-standing implementation (fable-review.md W2/Q1);
selection-on-click is needed for delete/properties. Spec-only change.
Touches: FR-031; design §2.1, §6.9 (FSM table), §7.3

## 2026-06-10 — Code-review fixes (fable-review.md C1–C4, W1, W3–W8)
What: Fixed four confirmed bugs — cleanup() no longer prunes group-snap-connected
buses (C1); bend-drag undo restores the pre-drag position (C2); placeComponent
reverts by refdes, never by object reference (C3); buildNets unions all lanes
sharing a pin (C4). Warnings: bus bend editing enabled via id-based conductor
lookup (W1/FR-039); Open guards unsaved changes + beforeunload handler added
(W3/FR-049a); store.dispatch contains command failures (W4); degenerate
same-vertex wires rejected (W5); load warns on newer formatVersion and
structurally validates the file (W6); YAML parser rejects duplicate pin/group
names and pins outside an explicit outline (W7); netlist warns on unequal-width
bus joins instead of silently minimizing (W8).
Why: full-repo code review (fable-review.md); regression tests were checked in
ahead of the fixes and their `todo` markers are now removed.
Touches: FR-024, FR-030, FR-032, FR-034b, FR-039, FR-039a, FR-041a, FR-049a;
design §3.3 G2, §6.3, §6.6, §6.9, §6.10, §7.3, §7.4

## 2026-06-09 — Three more built-ins: pull-up, pull-down, clock
What: Added three built-in objects below the palette divider. Pull-up (2×2, bottom
pin) drawn as a two-headed up-arrow; pull-down (2×2, top pin) as an upside-down T;
clock (3×2, right pin) as a "CLK" box. Tooltips: "pull up", "pull down", "clock".
Touches: FR-069/FR-070/FR-071 (new); design §6.6, §6.8, §6.11
- registry entries in js/builtins.js; render branches in canvas.js

## 2026-06-09 — Palette built-in objects region; state indicator
What: Split the palette 50/50 with a midpoint divider — upper region keeps the
74-series tiles, lower region holds client-defined built-in objects (icon+tooltip
tiles), each region scrolling independently. Built-ins are placed like components
but get an A-1, A-2, … designator series. First built-in: a state indicator (2×2,
one bottom-center input pin) drawn as a bubble showing wire state (gray ? / white
1 / black 0); only the ? state exists until the simulator does.
Touches: FR-006a (new), FR-011a (new), FR-067/FR-068 (new); design §6.6, §6.8,
§6.11; requirements §3.2/§3.3/§3.4a
- new file js/builtins.js

## 2026-06-09 — Palette as a 3D tile grid, abbreviated part-number labels
What: Replaced the labeled horizontal-bar palette buttons with fixed-size raised
(drop-shadow) tiles in a 3-column grid, sorted ascending by part number. Tile
labels drop the leading "74" (e.g. "138", "00") with the full name in a tooltip;
the panel shrinks to tightly fit the grid. An armed click-to-place tile shows a
pressed-in look.
Touches: FR-005, FR-006 (rework), FR-009a (new); design §6.11
- requirements §3.2/§3.3

## 2026-06-09 — Wire-cursor hotspot at line's upper-left endpoint
What: Moved the wire cursor's hotspot from the icon center to the upper-left
endpoint of the diagonal line (its bounding-box upper-left corner).
Touches: FR-025; design §6.11

## 2026-06-08 — Start wires from pins in select mode; wire-cursor icon
What: A component pin is now a wire hotspot in select-tool mode: hovering a pin
shows the wire cursor and clicking a pin starts a wire from it (auto-arming the
Wire tool, one-shot back to select), so wiring no longer requires selecting the
Wire tool first. The wire cursor is a short diagonal line (lower-right→upper-left)
inline SVG; the Wire toolbar button now shows that icon instead of the word
"Wire".
Why: Manually switching to the Wire tool for every wire is tedious; pins are the
natural place to begin a wire.
Touches: FR-025, FR-027b (new); design §6.9, §6.11

## 2026-06-08 — Subunit pins: ticks on hover/select instead of resting bubbles
What: Subunit (gate/mux) pins no longer draw a resting connection bubble; the
circle is now reserved exclusively for logic negation. A pin's connection point
is instead marked with a short perpendicular tick, shown only when the subunit is
hovered or selected. Inverting outputs are exempt (their negation bubble is the
mark). Rectangle `unit` components keep their FR-013 bubble. Adds transient
`hover` state to the store.
Why: Pin bubbles were visually identical to negation bubbles, so positive-true
gate inputs/outputs read as inverted (e.g. NAND looked like its inputs were
negated; an OR looked like a NOR).
Touches: FR-013, FR-013b, FR-013c (new); design §6.8, §6.8a, §6.10

## 2026-06-05 — Subunit rendering fixes (bubbles, OR inputs, label placement)
What: Three rendering bugs in subunit symbols: (1) pin name labels were anchored
to the pin point/bubble, so for stubbed pins they landed on the stub — now they
hang from the body outline (`pinLabelEdge`); (2) inverting gates (7404, 7400)
drew both an inversion bubble and a common connection bubble — now the inversion
bubble is the sole bubble (`pinHasOwnBubble`); (3) OR-family gates (7432) left
their inputs floating off the concave back — now each input has a short stub to
the back curve.
Why: Bug fixes to the subunit feature; symbols looked wrong.
Touches: FR-013a, FR-013b, FR-015; design §6.8, §6.8a.

## 2026-06-05 — 74153 reverts to unit rendering (shared selects can't be subunits)
What: Changed `srv/components/74153.yaml` from `rendertype: subunit` (dual mux4)
to a single `unit` rectangle. The dual 4-to-1 mux shares its A/B select lines
across both halves, so it cannot be split into independently-wired mux subunits.
Why: Bug — subunit rendering duplicated the shared selects; KiCAD renders the
'153 as one symbol for the same reason. Data-only; FR-062c already allows both.
Touches: none (component library data only).

## 2026-06-05 — Subunit rendering (multi-unit packages drawn as schematic symbols)
What: Packages that contain independent functional units (e.g. 7400 = quad NAND)
declare `rendertype: subunit` + `numunits` + `renderas` and per-pin `unit` (in
place of `pos`); they drop as N sibling instances sharing one U-number (refdes
`U5A`…), each drawn as a traditional schematic symbol (gates, mux trapezoid) and
independently movable/rotatable. Deleting any subunit deletes the whole package
after a confirmation dialog. A new `web/js/engine/symbols.js` owns symbol geometry.
Why: Match conventional digital-schematic rendering, omitted from the original spec.
Touches: FR-011, FR-013a, FR-013b, FR-014a, FR-018b, FR-062c;
design §6.3, §6.6, §6.7, §6.8, §6.8a, §7.1, §7.6, §8

## 2026-06-04 — Static assets served with Cache-Control: no-store
What: The static SPA handler now sets `Cache-Control: no-store`, so a normal
browser reload always loads edited assets (no hard-refresh / DevTools toggle).
Why: Stale-cache confusion during development of a localhost-only tool.
Touches: design §6.4

## 2026-06-04 — Properties panel for per-instance delay overrides
What: Add a docked right-edge properties panel (FR-020a): shows the selected
instance's type data read-only and lets the user override propagation delays for
that instance only. Adds the model `setOverride` + `setOverrideCmd` (previously
referenced in the design but unimplemented) and a notifying `store.setSelection`.
Why: Implements the long-deferred FR-020a.
Touches: FR-020a; design §6.9, §6.10, §6.11

## 2026-06-04 — Right-click context menu (incl. delete actions)
What: Add a right-click context menu: delete bend point (FR-033), set bus width
(FR-038), edit bus bit names (FR-037b), and delete the wire/bus/component under
the cursor (FR-033a/FR-018a, new FR-033b).
Why: Implements the long-specified context menu; delete was keyboard-only.
Touches: FR-033b (new); FR-033/037b/038/033a/018a; design §6.11

## 2026-06-04 — Unmatched bus drop is left unconnected (was nearest-pin)
What: When a bus endpoint is dropped on a component and no pin group matches its
width, the endpoint is left unconnected instead of attaching to the nearest pin.
Why: Stakeholder reversed the earlier nearest-pin rule — guessing a single pin is
worse than connecting nothing. (Code already behaved this way.)
Touches: FR-043; design §6.9, §A3

## 2026-06-04 — Draw pins as connection bubbles instead of stubs
What: Each pin is drawn as a small circle (bubble) just outside the body, tangent
to the outline edge and anchored on the pin's grid point, rather than a stub bar;
the bubble is the wire-connection target. Sized to not overlap adjacent pins and
to lie fully within the pin hit tolerance.
Why: Easier, clearer connection targets; cleaner symbols.
Touches: FR-013, FR-020; design §6.8

## 2026-06-04 — Raise default zoom to 1.6×
What: Initial viewport opens at zoom 1.6 (was 1.0) for easier clicking and less
label/pin-name crowding.
Why: UX — pins were small and labels collided at the old default.
Touches: design §A5

## 2026-06-04 — Pan by left-drag on empty canvas
What: Allow panning by left-dragging on bare canvas (press begins off any
object); middle-drag and Space+left-drag remain available.
Why: Space+left-drag is awkward for some users.
Touches: FR-023a; design §6.11

## 2026-06-04 — Rubber-band preview while drawing a wire/bus
What: After the source click and before the destination click, draw a straight
rubber-band line from the source to the cursor (wire and bus tools).
Why: Drawing currently gives no visible feedback between the two clicks.
Touches: FR-027a; design §6.8, §6.9

## 2026-06-03 — Remove multi-bit pins; every pin is one bit
What: Removed the `Pin.width`/`bit-width` attribute. Every pin carries exactly
one bit; a parallel bus is modeled as a `PinGroup` of single-bit pins. Restated
pin-group bus matching as "member pin count == bus width" (was "Σ member pin
bit-widths == width") in FR-041 and design §2.1/§3.1/§6.3/§6.9/§7.1/§7.6/§8/§11.
Why: Physically every TTL pin is a single bit; multi-bit pins were a vestigial,
unused concept that contradicted the symbol model and the pin-group mechanism.
Touches: FR-041; requirements Pin entity; design §2.1, §3.1, §6.3, §6.9, §7.1
(Pin/PinGroup), §7.6, §8 (A3), §11, §12 (A3).

## 2026-06-03 — Rename parser source file `mdparse.go` → `yamlparse.go`
What: Renamed the planned Go parser source file from `mdparse.go` to
`yamlparse.go` everywhere it appears in the design (§5.2 diagram, §6.1/§6.2
dependencies, §6.3 heading, §9 file plan, §10 traceability, §11 test bullets).
Why: Match the YAML decision; the `md` name was a Markdown holdover. No code
exists yet, so this is a spec-only rename.
Touches: design §5.2, §6.1, §6.2, §6.3, §9, §10, §11.

## 2026-06-03 — Component files use `.yaml`; retire the "MD file" term
What: Component-definition files now use the `.yaml` extension (loader glob
`*.yaml`, sample files `74138.yaml` etc.). Renamed the entrenched "MD file"
terminology to "YAML file" throughout both specs (it originally meant Markdown,
which is no longer accurate); the glossary key is now "YAML file". Marked the
remaining MD-syntax gap (design §3.3 G1) RESOLVED.
Why: Follow-up to the YAML decision — the `.md` extension and "MD" name were
misleading now that content is YAML; `.yaml` gives correct editor/LLM handling.
Touches: FR-002, FR-007, FR-014, FR-020a, FR-057, FR-061–FR-066; requirements §3.17
heading, §5 data table, §8 MVP, glossary; design §2.1, §3.3 (G1), §5.2, §6.1,
§6.2, §6.3, §7.6, §9 (sample filenames), §11.

## 2026-06-03 — MD format finalized as YAML; package mechanism removed
What: Resolved the MD-file open question. The format is now YAML (binding spec in
design.md §7.6, replacing the non-binding strawman). Removed the package
mechanism entirely — the `package`/`pincount` keyword, the `DIP-16`/`DIP-24/0.6`
naming grammar, and the parametric outline/pin-number generator (`packages.go`).
Outlines are now stated as `outline: [w, h]` or derived from the author-placed
pins; physical pin `number` is author-stated optional footprint/BOM metadata.
Confirmed power and ground are not represented in the file, editor, or
simulation, so the pin-direction set is exactly {in, out, bidir, tristate}.
Why: Stakeholder decisions — YAML is reliably authorable by hand and by an LLM
transcribing datasheets (the `|` block scalar makes GALasm equations
ceremony-free); the package keyword caused confusion; power/ground have no role.
Closes OQ-001 and OQ-008.
Touches: FR-061, FR-062, FR-062a, FR-062b; design §6.3, §7.1, §7.6, §8, §9, §10,
§11, §12 (OQ-001, OQ-008); removed `packages.go` from the file plan; requirements
§5 data table, §7 assumptions, glossary.

## 2026-06-03 — Establish changelog process
What: Added this CHANGELOG and a header note to `requirements.md` and
`design.md` declaring them the single source of truth and this file a
history-only index. Added `sim/CLAUDE.md` documenting the change-tracking
workflow for future sessions.
Why: Set up a change-tracking process before a series of upcoming changes.
Touches: requirements.md (header), design.md (header), CLAUDE.md (new)
