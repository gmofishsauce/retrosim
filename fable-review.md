# Code Review: sim — TTL Circuit Design Editor

Reviewer: Claude (Fable), 2026-06-09.
Scope: full repo review of `sim/` (Go server in `srv/`, SPA in `web/`) against
`specs/requirements.md` and `specs/design.md`, with attention to refactoring
opportunities accumulated over the changelog's UI rework history.

Verification: `go test ./...` and `go vet` pass; all 119 JS tests pass
(`node --test`). The four critical findings below were each confirmed by
execution — all four reproduce. **Regression tests for all four are now checked
in**, marked `{ todo: "known bug — see fable-review.md C# }` so the suite stays
green until each fix lands (remove the `todo` option when fixing):

- C1 → `web/js/model/delete.test.js` ("cleanup keeps a snap-connected bus…")
- C2 → `web/js/commands_wire.test.js` ("undo of a live-previewed bend drag…")
- C3 → `web/js/commands.test.js` ("undo place after undoing a snapshot delete…")
- C4 → `web/js/model/netlist.test.js` ("a wire and a group-snapped bus sharing a pin…")

## Summary

This is an unusually well-organized codebase: the vertex/bit-lane connectivity
model is implemented faithfully to §7.1a/§6.6, the Go server is small and
correct, comments cite FR numbers throughout (the traceability is the best I've
seen in a project this size), and test coverage of the model layer is real.
**Verdict: request changes.** There are four confirmed correctness bugs — two
of them undo-integrity bugs in the command layer, one a data-loss bug in
`cleanup()`, one a netlist-correctness bug — plus a cluster of spec/code
divergences that the project's own CLAUDE.md says must be flagged rather than
left silent. None are architectural; all are fixable in place.

---

## Critical issues

### C1. `cleanup()` deletes snap-connected buses (data loss)

`web/js/model/design.js` — `cleanup()` (the FR-030 sweep) removes any conductor
whose two endpoint vertices are both `kind === "free"`. But a bus snap-connected
to a pin group (FR-041a/FR-042) keeps **free** endpoint vertices — the
connection is recorded only in `bus.groupConnections`
(`planBusEndpoint` in `interaction.js` returns `{kind:"free"}` for a component
target, and `snapBusGroup` never touches the vertex). Since `deleteWire`,
`deleteBus`, and `deleteInstance` all run the **global** sweep, deleting any
unrelated wire anywhere in the design silently deletes every bus that is
group-connected at both ends.

Confirmed: place a component, snap a 3-bit bus to its `A` group, add and then
delete an unrelated wire → the bus is gone.

**Fix options** (pick one):
- Treat an endpoint with a `groupConnection` referencing that vertex as
  "connected" in the sweep (smallest change: `cleanup` checks
  `bus.groupConnections.some(gc => gc.vertex === endpointId)`).
- Or give snapped endpoints a distinct vertex kind (cleaner long-term: the
  save format then also says explicitly that the endpoint is attached, rather
  than implying it via a parallel collection).

Note the same question applies to FR-030's meaning on save/load: a bus with two
free ends but a group connection must round-trip.

### C2. Undo of a bend drag is a no-op

`web/js/engine/interaction.js`, `mouseup` handler, `drag.type === "bend"`
branch (~line 542). During the drag, `moveBend` mutates the path live for
preview. On mouseup the code reads the bend's **final** position and dispatches
`moveBendCmd(wireId, bendIndex, fx, fy)`. `moveBendCmd` captures `old` from the
current path on first `apply` — which is already the final position. Undo
therefore "restores" the final position. Confirmed by execution.

The comment on line 547 ("the command captures old via a rewind") describes the
**component**-drag branch, which correctly rewinds `inst.x/y` to `drag.origX/Y`
before dispatching. The bend branch never stored the original position.

**Fix:** record `origX/origY` in the drag state when the bend drag starts (in
`mousedown`), rewind the bend to it before dispatching — exactly mirroring the
component branch. (Or pass the old position into `moveBendCmd` explicitly.)

### C3. `placeComponent` undo breaks after any snapshot-command undo

`web/js/commands.js`. `placeComponent.revert` removes the created instance by
**object identity** (`design.components.indexOf(inst)`), and redo re-pushes the
captured objects. But every snapshot-based command (`deleteComponent`,
`addWireCmd`, `deleteWireCmd`, `addBusCmd`, …) restores collections via
`structuredClone`, replacing every object in `design.components` with a clone.
Sequence confirmed by execution:

    place U1 → delete U1 → undo (restores a *clone* of U1) → undo (place.revert
    finds nothing to remove) ⇒ U1 is still on the canvas with an empty undo stack.

The same hazard exists for redo: re-pushing the stale captured objects can
diverge from cloned state.

**Fix:** make commands reference model objects only by id, never by captured
reference — `placeComponent` should capture the assigned refdes list on first
apply and revert by `refdes` lookup (and redo by re-inserting clones or
re-running `addInstance` with a pinned refdes). Worth adopting as a stated
invariant for all commands: *a command may hold ids and value snapshots, never
live object references* (see R2 below).

### C4. `buildNets` does not merge nets through a shared pin (FR-034b)

`web/js/model/netlist.js`. Pins are handled as *attachments* to lanes, but
attachments never union the lanes they share. A wire ending on pin `U1.A0` and
a bus group-snapped so that bit 0 ↦ `A0` produce **two** nets, each listing
`U1.A0`. FR-034b says everything transitively connected *through pins* and
junctions is one net. Confirmed by execution (pin appears in 2 nets).

This matters most for exactly the workflow the specs feature: bus to a group
plus a discrete wire to one pin of that group (or two buses snapped to
overlapping groups).

**Fix:** after collecting `attachments`, union all lanes that attach to the
same pin key:

```js
const lanesByPin = new Map();
for (const { lane, pin } of attachments) {
  if (lanesByPin.has(pin)) uf.union(lanesByPin.get(pin), lane);
  else lanesByPin.set(pin, lane);
}
```

(Then a regression: width-3 bus snapped to group A + wire on A0 ⇒ exactly one
net contains `U1.A0`, and the wire and bus lane 0 are co-members.)

---

## Warnings

### W1. Bus bend editing and select-mode bus interaction are missing (FR-039)

FR-039 requires bend-point editing and branching on buses to follow the wire
model (FR-031–FR-033). Currently:

- `interaction.js` select-mode `mousedown` on a bus segment sets `drag = null`
  ("bus bend editing is wired up with the context-menu slice" — that slice
  landed, but bend editing didn't);
- `insertBendCmd` / `moveBendCmd` / `deleteBendCmd` search only `design.wires`,
  so they throw on a bus id;
- `hitBend` iterates only `design.wires`.

Worse, a bus **can** acquire a bend the user cannot touch: `cleanup()` demotes
an interior bus junction with refcount 1 to a `bend` path point. That bend is
then invisible to `hitBend` and undeletable. Either implement bus bends (see
R1, which makes this nearly free) or amend the spec; CLAUDE.md says specs win.

### W2. FR-031 says *click* inserts a bend; the code requires a *drag*

`interaction.js` (~line 369): a plain click on a wire segment **selects** the
wire; a bend is inserted only when the mouse moves (`drag.tempIndex`). The
design's own FSM table (§6.9: "SELECT | click wire/bus segment | InsertBend")
matches FR-031, not the code. The implemented behavior is arguably better UX
(selection is needed for delete/properties), but per the project's rules this
is a discrepancy to resolve explicitly — most likely by reworking FR-031 to
"press-and-drag on a segment inserts and places a bend; a plain click selects."

### W3. Open does not warn about unsaved changes (FR-049a)

`web/js/chrome/fileops.js`: `newDesign()` guards on `store.state.dirty`;
`open()` does not — Open silently discards edits. FR-049a names both New and
Open. Also, design §6.10 specifies a `beforeunload` handler warning on tab
close; none exists (`grep beforeunload` → nothing). Both are small additions.

### W4. `store.dispatch` does not contain command failures

Design §6.6 error handling: "invalid ops throw and are caught by the Store,
which leaves state unchanged and surfaces a non-fatal toast." `store.js`
`dispatch()` has no try/catch: a throwing `apply` propagates to the event
handler, and a *partially applied* mutation would be neither on the undo stack
nor rolled back. Snapshot commands already capture pre-state before mutating,
so a `try { apply } catch { restore-if-possible; rethrow/toast }` is feasible;
at minimum, catch and surface rather than letting handlers die mid-gesture.

### W5. Degenerate self-wire

Wire tool (or select-mode pin hotspot): clicking the same pin for source and
destination creates a wire whose path is two nodes referencing the **same
vertex** — invisible, undeletable by hit-testing (zero-length segment is
clickable at the pin only), and it inflates that pin's net membership. Guard in
`interaction.js` (ignore destination === source) or in `addWire`.

### W6. Loaded designs are not version-checked or validated

`persist.js` `deserializeDesign` ignores `formatVersion` (design §7.4: warn when
newer than understood) and trusts every collection. A truncated or
hand-edited file (the server only checks `json.Valid`) produces `undefined`
lookups deep in render/hit-test. A cheap structural sanity pass on load (paths
length ≥ 2, endpoint vertices exist) plus the version warning would make load
failures legible.

### W7. YAML validation gaps (server)

`srv/server/yamlparse.go`:
- **Duplicate pin names** are accepted silently (`pinNames` map just
  overwrites); the client's `pinWorldPos` will then always find the first,
  and saved endpoint references (`U3.A0`) become ambiguous. Reject duplicates.
- An explicit `outline:` smaller than the largest pin `pos` is accepted —
  pins land outside the body. Validate `pos` fits within the stated outline.
- Duplicate group names are also accepted.

### W8. Netlist bus↔bus join silently tolerates unequal widths

`netlist.js` step 3 unions `Math.min(w1, w2)` lanes. §6.6 specifies
`assert width(B1)==width(B2)` (FR-039a guarantees it at edit time — but a
loaded file may violate it, e.g. after `setBusWidth` on a joined bus, which
nothing re-checks). Silent partial union hides the inconsistency from the very
downstream tools the netlist exists for. Surface it (warn/collect an
inconsistency list) rather than minimizing. Note `setBusWidthCmd` on a bus with
existing `groupConnections` or junctions is likewise unvalidated.

---

## Refactoring opportunities

The changelog shows ~15 significant UI reworks since the original design; the
code has held up well, but the seams show in a few places.

### R1. Unify wire/bus "conductor" handling (root cause of W1)

Wires and buses share path shape, vertices, bends, branching, and rendering,
but the code is forked: `hitSegment`/`hitBusSegment`, `findWire` (wires only),
bend commands (wires only), `deleteWire`/`deleteBus`, parallel branches in
`interaction.js`. Ids already carry the discriminator (`w12` / `b3`). A single
`findConductor(design, id)` plus bend/branch commands that accept either would
collapse the duplication and make FR-039 (bus bends) fall out for free, instead
of being a parallel feature to build and keep in sync. `hitBend` should iterate
`allConductors(design)` (a helper that already exists in `design.js` but is
private).

### R2. Command-layer invariant: ids and value snapshots only

C3 is a symptom of mixing two revert disciplines: incremental commands holding
object references, and snapshot commands rebuilding objects by clone. Either
(a) adopt and document the invariant that commands store **ids + plain data**
(then fix `placeComponent`), or (b) make all structural commands snapshot-based
(simpler, slightly heavier — snapshots are already `structuredClone`s of the
whole connectivity set, so the cost argument is mostly gone). Today's hybrid is
the worst of both: it looks cheap but is only correct until the stacks
interleave.

### R3. `interaction.js` (637 lines) — make the tool FSM explicit

The design (§6.9) specifies a state table; the code is a nested if-chain inside
one `mousedown` listener plus shared mutable locals (`wireSource`, `drag`,
`pan`). It works, but every changelog entry that touched interaction enlarged
the same function. Splitting per-tool handlers (`select`, `wire`, `bus`,
`place`) behind a small dispatcher — each owning its transient state — would
match the documented FSM and make the next gesture (bus bends, multi-select
someday) additive instead of interleaved.

### R4. Built-in objects: registry knows data, canvas knows drawing

Each new built-in (FR-068…071) added a `renderType` string in `builtins.js`
**and** a hand-wired branch in `canvas.js`'s `drawComponent` if-chain. Let each
registry entry carry its own `draw(ctx, inst, vp, selected)` (the line-art
helpers like `strokePaths` can move or be imported), and `drawComponent`
dispatches on a lookup. Adding the next built-in then touches one file.
Relatedly: the built-in `renderType` values (`indicator`, `pullup`, `pulldown`,
`clock`) are outside the documented `unit|subunit` enum of §7.1/`types.go` —
worth a sentence in design.md §7.1 since these values are persisted in saves
via `typeData`.

### R5. Small DRY items

- `pathPointWorld` is duplicated verbatim in `canvas.js` and `hittest.js` —
  move to `model/design.js` next to `vertexWorld`.
- `toast()` is duplicated in `interaction.js` and `fileops.js` (different
  timeouts); `el()`/`button()` helpers are re-implemented in `dialogs.js`,
  `properties.js`, `toolbar.js`. One tiny `chrome/dom.js` would cover all.
- The four dialogs in `dialogs.js` each rebuild the same
  overlay/Escape/promise scaffolding (~25 lines each); extract a
  `modal(title, buildBody) → Promise` helper.
- Palette construction lives in `app.js`, but the design file plan (§9) and
  §6.11 say `js/chrome/palette.js`. Either extract it (it's a self-contained
  ~40 lines) or amend §9. The plan also omits `commands.js`,
  `model/persist.js`, `chrome/fileops.js`, which exist — §9 deserves one
  refresh pass.

### R6. Performance notes (not urgent at current scale)

- `cleanup()` calls `vertexRefCount` (O(conductors × path)) per vertex inside
  a fixed-point loop — roughly O(V·W·P) per iteration. Fine today; at the
  NFR-005 target (200 components / 600 segments) a one-pass refcount map per
  iteration would be safer.
- `design.vertices` / `components` lookups are linear `find()`s everywhere;
  §7.5 calls for a non-persisted id-keyed map. Worth doing when (not before)
  profiling says so — the seam (`getVertex`) is already in one place.

---

## Nits

- `design.js` `matchingGroups` comment: "Zero matches → nearest-pin fallback
  (FR-043)" — stale; FR-043 now says leave unconnected (changelog 2026-06-04).
- `interaction.js` keyboard `+`/`-` bus-width handler comment: "Stopgap …
  until the right-click context menu" — the menu shipped; either keep the
  shortcut deliberately (drop the comment) or remove it.
- `types.go` package comment: "the MD parser" — stale term, renamed to YAML.
- Palette sort `Number(name.slice(2))` → `NaN` for any future non-`74xx` type
  name; NaN-compare makes the order arbitrary. Cheap guard now beats a
  mystery later.
- `app.js` catch-all error blames "Cannot reach server" even when the failure
  is a chrome init bug after a successful fetch.
- `window.confirm` for FR-018b/New vs. the styled DOM modals everywhere else —
  inconsistent, and confirm() blocks the event loop. Fine for now; note it.
- `dialogs.js` `joinPath` hardcodes `/` — wrong on Windows (OQ-006 says the
  server should handle all three OSes; the client should too, or the server
  should do the joining).
- Save As writes the file under the new name but `design.name` (inside the
  JSON) keeps the old design name — harmless now, but downstream tools reading
  `name` may be confused. Consider syncing on first save/Save As.
- `interaction.js` hover tracking runs on `window` mousemove with
  canvas-relative math, so a cursor over the palette can still set hover on a
  component whose world coords happen to coincide. Cosmetic.
- Good: the Go server's atomic save (temp + fsync + rename), the loopback-bind
  refusal, error envelope consistency, and `Cache-Control: no-store` rationale
  comments are all exactly right.

## Questions

1. **FR-031 (W2):** is drag-to-insert the intended behavior (update spec), or
   should a plain click insert a bend (update code)? The current select-on-click
   feels right, but the spec and the design FSM both say otherwise.
2. **Snapped-bus endpoints (C1):** when fixing, do you prefer keeping
   `groupConnections` as the sole record of attachment, or introducing a vertex
   kind for snapped endpoints? The second is a save-format decision (OQ-007
   territory), so worth deciding deliberately before more saves exist.
3. **Regression tests:** RESOLVED — converted into permanent `todo`-marked
   tests in the four suites listed at the top of this review (stakeholder
   approved). Remove each test's `todo` option when its bug is fixed.

screen response from model, captured by user after the reviewer
added four tests to the test suite:

Design choices worth knowing:

  - Each test asserts the spec-correct behavior (not the buggy behavior), so
  they currently fail — but each is marked { todo: "known bug — see
  fable-review.md C#" }. Node's test runner reports todo failures without
  failing the run, so the suite stays green: 123 tests, 119 pass, 0 fail, 4
  todo, exit code 0. When you fix a bug, delete its todo option and the test
  becomes a hard guard.
  - Each test carries a comment explaining the bug mechanism and the suggested
  fix direction, referencing fable-review.md.
  - One caveat on C2: it simulates the gesture as interaction.js performs it
  today (live moveBend preview, then dispatch with final coords). If you fix it
  by rewinding in interaction.js rather than by fixing moveBendCmd's
  old-position capture, the simulated gesture in the test needs the matching
  rewind added — the comment in the test spells this out.

  I also updated fable-review.md to point at the checked-in tests and mark
  question 3 resolved. The matching tests style their fixtures after the
  existing suites (same ty()/tyA() shapes, same hand-built groupConnections
  convention used by the neighboring netlist tests).
