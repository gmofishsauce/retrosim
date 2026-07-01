# Test vectors for port-boundary (sub-component) designs — analysis

Status: **analysis / proposal only — no spec or code changes made yet.** Captured
so we can resume the discussion later with full context.

## Motivating case

The user built a schematic similar to a 74381 4-bit ALU at
`/Users/jeff/Documents/retrosim/74381.json` and wants to drive it with the app's
test-vector feature (FR-115). A `.tv` file with the datasheet's truth-table
vectors was already authored at `/Users/jeff/Documents/retrosim/74381.tv`
(41 input rows across the 8 functions; expected `F0..F3` only — `/P`/`/G` omitted
per the user; `Cout` omitted because the datasheet truth table has no carry-out
column, only `Ḡ`/`P̄`).

The blocker: this design's entire interface is **ports** (off-sheet connectors),
not switch/indicator built-ins:

- Inputs: `S0 S1 S2` (function select), `Cin`, `A0..A3`, `B0..B3` — all `type-port`.
- Outputs: `F0..F3`, `Cout` — all `type-port`.
- The one indicator present (`A-2`, 8-wide) is wired to **echo the A and B
  operand buses** (D0..D3 = A0..A3, D4..D7 = B0..B3), not the ALU result.
- There are **no input switches at all**.

The user's view (agreed direction): the vector runner *should* be able to test a
sub-component design whose boundary is ports. This file proposes how.

## Root cause (why ports don't work today)

1. **`deriveColumns(design)`** in `web/js/engine/vectors.js` only emits columns
   for render types `switch` / `indicator` / `indicator8`. Ports are skipped, so
   the table has no input columns and only the indicator's 8 bits as outputs.

2. **A 1-wide port's pin `P` is not a net member.** Per FR-094a (and confirmed in
   `web/js/model/netlist.js` lines ~140–194), a `connector` vertex *names* its net
   (`net.name === port.label`) but is **not** listed among the net's component
   pins. Consequences:
   - Reading: `sim.valueOfPin(refdes, "P")` looks up `netOfPin.get("refdes.P")`,
     which is absent → returns `Z`. So output ports are unreadable by pin key.
   - Driving: `port()`'s behavior returns `[]` (a port "drives nothing on its own;
     it is a net-label node, not a source" — `builtins.js`), and there is no
     `refdes.P` key for a driver contribution to land on.

   The canonical handle on a 1-wide port's net is therefore the **net name**
   (= the port label), not a pin key.

## How the runner works today (relevant mechanics)

- `web/js/engine/vectors.js`:
  - `simulateRow(design, inputs, rowIn, romContent)` clones the design, sets
    `inst.switchState = "0"|"1"` on **every input column's instance** (by refdes),
    builds the sim, and settles to quiescence.
  - `runVectors(...)` reads each output via `sim.valueOfPin(col.refdes, col.pin)`
    and scores H/L/X.
  - `captureRow(...)` likewise.
  - Columns used at runtime come from `deriveColumns(design)` (the design is the
    source of truth); a loaded `.tv` file is *reconciled into* those columns by
    `(refdes,pin)` (`reconcileVectors`). Columns may carry extra non-persisted
    fields as long as `serializeVectors` projects to `{refdes,pin,label}`.

- `web/js/engine/sim.js` `buildSimulation`:
  - Builds `netOfPin: Map("refdes.pin" → netIndex)` from `buildNets`.
  - A `switch` built-in drives `OUT` from `inst.switchState`
    (`switch({state}) => [{pin:"OUT", value: state==="1"?V1:V0}]`).
  - The builtin driver loop calls `add("refdes.pin", value, weak, label)` which
    resolves the net via `netOfPin.get`.
  - `valueOfPin(refdes, pin)` = `netOfPin.get("refdes.pin")` → `curr[n]` or `Z`.

- `web/js/model/subdesign.js` `portDirection(design, portRefdes)` derives a port's
  direction from wiring (FR-094c): inspects the non-port pins on the port's net —
  any `bidir`/`tristate` pin → **`bidir`**; else any plain `out` driver → **`out`**;
  else **`in`** (also when unconnected). For a 1-wide port the net is found by
  **label** (`net.name === label`); a `portN` aggregates across its `P0..P(N-1)`
  bit nets (whose pins *are* net members).

- `web/js/builtins.js`:
  - `port()` → `[]` (drives nothing). `portN()` → `[]`.
  - Pull-ups/downs are **weak** drivers; their `OUT` pin has pin-direction `out`.

## Classification — the subtle part (validated against the real design)

A naive "in→input, out→output" split is wrong here. Traced wiring of `74381.json`:

- `S0/S1/S2` nets: only a `74138` input pin (`U14`, dir `in`) → `portDirection`
  = **in**. Correct (stimulate).
- `A0..A3`, `B0..B3` nets: only gate inputs + the indicator bit (all dir `in`) →
  **in**. Correct.
- **`F0..F3` nets: driven through `74244` tristate buffers** (`U10/U11/U13`, pins
  `tristate`). `portDirection` therefore returns **`bidir`**, NOT `out`. If we
  excluded bidir ports, we'd drop the actual ALU-result outputs.
- `Cout` net: driven by `U7.COUT` (dir `out`) → **out**. Correct (observe).

So the proposed mapping is:

| `portDirection` | vector column role |
|---|---|
| `in`  (no internal driver)        | **input** (driven `0`/`1`, pin `P`) |
| `out` (strong internal driver)    | **output** (expected `H`/`L`/`X`, pin `P`) |
| `bidir` (tristate/bidir driver)   | **output (observe)** — required for the `74244`-buffered `F0..F3` |

Notes / known edges:
- Driving a *true* bidirectional boundary (e.g., a shared data bus) is out of
  scope for v1 combinational vectors; bidir ports are observe-only.
- **Weak-pull edge:** an input port whose net carries only a weak pull-down/up
  would be classified `out` by `portDirection` (a pulldown's `OUT` pin is
  pin-direction `out`), and thus mis-bucketed as an output. None of this design's
  *input* ports are pulled (the pulls drive internal `74138`/`74244` nodes), so it
  doesn't bite here, but it's a general limitation of reusing `portDirection` and
  worth deciding on (e.g., treat weak-only nets as `in`).

## Proposed mechanism (minimal, 3 small edits) — NOT YET IMPLEMENTED

1. **`builtins.js` — `port()`**: drive pin `P` from `switchState` *only when the
   runner has set it*:
   ```js
   port({ state }) {
     if (state === undefined || state === null) return [];
     return [{ pin: "P", value: state === "1" ? V1 : V0 }];
   }
   ```
   `state` comes from `ctx.state = e.inst.switchState`. In normal/interactive
   simulation a port never has a `switchState`, so it still returns `[]` and the
   "net-label node, not a source" invariant holds. A port sources its net only for
   the duration of a vector run.

2. **`sim.js` — `buildSimulation`**: right after `netOfPin` is built, register a
   per-port alias so a 1-wide port's `P` resolves to its (label-named) net:
   ```js
   const netByName = new Map();
   nets.forEach((net, i) => { if (net.name != null) netByName.set(net.name, i); });
   for (const inst of design.components ?? []) {
     if (inst.typeData?.renderType === "port" && inst.label != null) {
       const i = netByName.get(inst.label);
       if (i !== undefined) netOfPin.set(`${inst.refdes}.P`, i);
     }
   }
   ```
   This makes BOTH the existing read path (`valueOfPin`) and the driver `add()`
   path work for ports transparently — so `simulateRow` / `runVectors` /
   `captureRow` need **no changes**.

3. **`vectors.js` — `deriveColumns`**: add a `port` branch using
   `portDirection(design, c.refdes)` per the classification table, emitting
   `{refdes: c.refdes, pin: "P", label}`. Dedupe by label (same-label ports share
   one net). Ensure `serializeVectors` projects columns to `{refdes,pin,label}` so
   no derived/runtime flags leak into the `.tv` file.

Net result: the already-authored `74381.tv` (bound to `pin:"P"`) runs as-is.
`portN` (multi-bit ports) is **deferred**: output reading would be cheap, but
per-bit input driving needs more than a single `switchState`; the 74381 doesn't
use portN.

Why the alias approach over alternatives: it is the least invasive — it reuses the
existing `valueOfPin` read and `add()` drive paths instead of introducing
net-name-addressed read/drive APIs and branching `simulateRow` by column kind.

## Proposed spec/process changes (repo rule: specs first, then CHANGELOG, then code)

- **New FR-115f** (extends FR-115b): the test-vector column derivation also treats
  a combinational sub-component design's **boundary ports** (FR-094) as I/O
  columns. A 1-wide port is classified by its wiring-derived direction (FR-094c):
  `in` → input column (driven `0`/`1`, pin `P`); `out` or `bidir` → output column
  (expected `H`/`L`/`X`, pin `P`) — `bidir` is observed, not driven, because a
  three-state boundary is ambiguous for a combinational vector and because
  tristate-buffered outputs (e.g., via a `74244`) classify as `bidir`. The runner
  stimulates an input port by driving its named net (the port sources its net only
  during a vector run; in normal simulation it remains a pure net-label node,
  FR-094a) and observes an output port by reading that net. Multi-bit ports
  (`portN`, FR-071e) are not yet covered. Columns remain ordered by refdes and
  bound by `(refdes,pin)` (FR-115a/FR-115b).
- **FR-115b**: add a one-line pointer to FR-115f.
- **design.md §6.16** (test vectors): note `deriveColumns` now also classifies
  `port` render types via `portDirection`; the `netOfPin` port→net alias in
  `buildSimulation`; and the `port()` behavior driving `P` from `switchState`.
- **design.md §7.7** (`.tv` file): port columns use pin `P`.
- **specs/CHANGELOG.md**: one line naming FR-115f / FR-115b and the touched design
  sections.
- **Tests**: extend `web/js/engine/vectors.test.js` (port input/output columns);
  add a small `sim.js` test for read/drive-through-port via the alias.

## Open questions to decide before implementing

1. **bidir ports → observed outputs** (proposed) vs exclude them. Excluding drops
   `F0..F3`, so the proposal treats bidir as observe-only output. Confirm.
2. **Weak-pull edge**: should an input port whose net has only weak pulls be
   forced to `in` (stimulable) rather than `out`? (Doesn't affect 74381, general
   robustness question.)
3. **portN** scope: defer (proposed), or include at least output-side reading now?
4. Whether to fold this into FR-115b vs a new FR-115f (proposed: new FR-115f).

## Side observation about `74381.json` (the user's schematic, not the feature)

While tracing, found that **no net is named `Cin`**, and `U7.CIN` (the adder's
carry-in) sits on a net named `1Y` driven by `U18A.1Y`. So the `Cin` port
(`A-15`, label `Cin`) may not actually be connected by label to the adder's
carry-in. Independent of this feature, but the arithmetic rows that depend on
`Cin` will misbehave until the schematic wiring is verified.

## Datasheet reference (already transcribed and arithmetic-verified)

74F381 page-3 Truth Table. Function select order is **S0 S1 S2**; `Cn` = carry-in;
`An`/`Bn` are single L/H meaning all 4 bits equal; outputs `F0..F3` (F0 = LSB),
plus `Ḡ`/`P̄` (omitted). Functions:

- `L L L` CLEAR → F=LLLL
- `H L L` B minus A
- `L H L` A minus B
- `H H L` A plus B
- `L L H` A ⊕ B
- `H L H` A + B (OR)
- `L H H` AB (AND)
- `H H H` PRESET → F=HHHH

Arithmetic rows use `Cn` (Cn=L = borrow/no-add; Cn=H = no-borrow/add-one);
logic rows have `Cn = X`. All 41 rows in `74381.tv` were cross-checked against
two's-complement arithmetic (A,B ∈ {0,15}).
