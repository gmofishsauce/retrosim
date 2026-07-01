# Test Vectors — open / deferred items

Status as of 2026-07-01. Tracks what is **not** yet done in the test-vector
feature (FR-115). For intended behavior see `specs/requirements.md` §3.19a and
`specs/design.md` §6.16 / §7.7.

## Shipped

- Simulate ▸ Test Vectors… modal table editor; columns auto-derived from the
  design's input switches (0/1) and indicators (H/L/X; 8-wide → 8 bit columns).
- Run with per-cell pass/fail + "N of M rows passed"; Capture golden outputs;
  Load/Save a `.tv` JSON sibling file.
- Pure runner/format in `web/js/engine/vectors.js`. Runs on a throwaway clone —
  never mutates/dirties/undoes the design.
- ~~Clocked-design guard (FR-115g, 2026-07-01)~~ — superseded the same day by
  sequential support; the guard is removed.
- **Sequential test vectors (FR-115e, 2026-07-01).** A clocked design's rows run
  in order on one simulation instance (state persists); each clock generator is
  a 0/1/C input column (PLD/JEDEC style, C = one positive pulse, the new-row
  default); every phase settles to quiescence (FR-085 bound); an implicit
  power-on preamble asserts reset built-ins for their own `cycles` of scripted
  pulses before row 1. Engine: `buildSimulation` `scriptedClocks` +
  `setStimulus`. `.tv` bumps to formatVersion 2 (identity migration). Was
  item #1 below.

## Deferred (intentional, recorded in specs)

1. ~~**Sequential / clocked designs — FR-115e.**~~ **Done 2026-07-01** — see
   Shipped above. Decisions taken: explicit 0/1/C clock column (JEDEC style),
   settle-to-quiescence phases (not a fixed step count per row), reset via an
   implicit power-on preamble (stakeholder-chosen over scripted reset columns).

2. ~~**No guard against running vectors on a clocked design.**~~ **Done
   2026-07-01 (FR-115g)**, then superseded the same day by sequential
   vectors (#1); the guard is removed.

3. ~~**Binding only to switches + indicators, not ports (FR-094).**~~ **Done
   2026-06-30 (FR-115f)** — ports bind as columns by effective direction,
   identified by the port's own (refdes, pin); bidir ports are skipped with a
   warning unless a direction override is set (FR-094d).

4. **Fast (generated C) simulator — OQ-011 / OQ-012.** The `.tv` format was
   designed so the same file can later feed the C engine as stimulus + golden,
   but nothing connects them yet. Open: result emission (VCD vs transcript), and
   running the `.tv` through generated C.

5. **Input don't-cares / vector expansion.** Input cells are `0`/`1` (plus `C`
   in a clock column, FR-115e); a switch or port can only drive 0 or 1
   (FR-071c). No `X` don't-care on inputs, so no automatic expansion of one
   row into the 2^k combinations it covers.

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
- **Fixed columns.** Columns are every switch, clock, directional port, and
  indicator bit, ordered by refdes — no subset selection, manual reordering,
  or hiding.
- **No keyboard accelerator.** The Test Vectors… item has no shortcut
  (FR-004b was not extended).
- **Results are not persisted** (by design, FR-115d) — the `.tv` file stores
  only inputs and expected outputs; pass/fail is presentational.
- **Dialog UI is not unit-tested.** The pure runner/format is covered
  (`vectors.test.js`); the DOM dialog is not, consistent with the repo's
  convention for hand-built dialogs.

## Suggested next steps (rough order)

1. ~~Add the clocked-design guard (#2)~~ — done 2026-07-01 (FR-115g, since removed).
2. ~~Sequential vectors (#1, FR-115e)~~ — done 2026-07-01.
3. Whole-bus hex output cells (#6) and `Z`/`U` assertions (#7) — quality-of-life.
4. Port binding (#3) — done 2026-06-30 (FR-115f); fast-engine stimulus (#4) remains.
