# Test Vectors — open / deferred items

Status as of 2026-06-26. Tracks what is **not** yet done in the test-vector
feature (FR-115). For intended behavior see `specs/requirements.md` §3.19a and
`specs/design.md` §6.16 / §7.7.

## Shipped (v1, combinational)

- Simulate ▸ Test Vectors… modal table editor; columns auto-derived from the
  design's input switches (0/1) and indicators (H/L/X; 8-wide → 8 bit columns).
- Run with per-cell pass/fail + "N of M rows passed"; Capture golden outputs;
  Load/Save a `.tv` JSON sibling file.
- Pure runner/format in `web/js/engine/vectors.js` (11 unit tests). Runs on a
  throwaway clone — never mutates/dirties/undoes the design.

## Deferred (intentional, recorded in specs)

1. **Sequential / clocked designs — FR-115e.** The whole feature is
   combinational-only. The intended direction is recorded: a sequential vector
   set is a *time-ordered* sequence whose rows persist state, and the run *owns
   the clock deterministically* (replacing FR-084 wall-clock pacing). Not built.
   - Needs: row semantics (one row = one clock cycle? explicit clock column?),
     reset handling, and persisting state between rows (no per-row clone).

2. **No guard against running vectors on a clocked design.** Today the dialog
   opens for any design and `runVectors` settles each row independently. A design
   with a clock built-in never quiesces, so each row burns the full 10,000-step
   `SETTLE_BOUND` and yields meaningless results, with **no warning**. v1 relies
   on the user knowing it's combinational-only. Smallest fix: detect a clock
   generator (`buildSimulation(...).hasClocks()` or scan `renderType === "clock"`)
   and disable Run / show a notice. Worth doing before sequential lands.

3. **Binding only to switches + indicators, not ports (FR-094).** Chosen for v1.
   Ports (typed, named, directional external interface) are the natural binding
   surface for a reusable block and for the fast engine; not wired.

4. **Fast (generated C) simulator — OQ-011 / OQ-012.** The `.tv` format was
   designed so the same file can later feed the C engine as stimulus + golden,
   but nothing connects them yet. Open: result emission (VCD vs transcript), and
   running the `.tv` through generated C.

5. **Input don't-cares / vector expansion.** Input cells are strictly `0`/`1`
   (an input switch can only drive 0 or 1, FR-071c). No `X` on inputs, so no
   automatic expansion of one row into the 2^k combinations it covers.

6. **Multi-bit (hex) output entry.** An 8-wide indicator expands to eight per-bit
   `H/L/X` columns. There is no whole-bus hex/binary expected value (e.g. `A5`),
   which would be friendlier for wide datapaths.

7. **No `Z` / `U` assertions.** Expected output symbols are `H`/`L`/`X` only.
   You cannot assert "expect high-impedance" or "expect undefined"; a `U`/`Z`
   result simply fails any `H`/`L` and captures as `X`.

8. **Dedicated server route.** The `.tv` file rides the existing
   `/api/v1/design/{load,save}` endpoints (they neither interpret nor
   extension-check the body). A purpose-built `/api/v1/vector/{load,save}` was
   deferred as unnecessary for v1.

## Known limitations / smaller gaps (not yet specced)

- **Synchronous run, no cancel/progress.** `runVectors` runs all rows inline.
  Fine for modest tables; a very large set (many rows × near-bound settles)
  could briefly block the UI. No progress indicator and no way to cancel a run.
- **Capture is all-rows-only.** One Capture button fills every row's expected
  cells; there is no per-row capture.
- **Fixed columns.** Columns are every switch/indicator, ordered by refdes —
  no subset selection, manual reordering, or hiding.
- **No keyboard accelerator.** The Test Vectors… item has no shortcut
  (FR-004b was not extended).
- **Results are not persisted** (by design, FR-115d) — the `.tv` file stores
  only inputs and expected outputs; pass/fail is presentational.
- **Dialog UI is not unit-tested.** The pure runner/format is covered
  (`vectors.test.js`); the DOM dialog is not, consistent with the repo's
  convention for hand-built dialogs.

## Suggested next steps (rough order)

1. Add the clocked-design guard (#2) — cheap, prevents a confusing footgun.
2. Sequential vectors (#1, FR-115e) — the big one; decide row/clock semantics first.
3. Whole-bus hex output cells (#6) and `Z`/`U` assertions (#7) — quality-of-life.
4. Port binding (#3), then fast-engine stimulus (#4).
