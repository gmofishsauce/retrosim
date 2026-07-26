# Probe feature — parked discussion (2026-07-26)

Status: **parked, no specs or code changed.** The decision was to build the
prerequisite feature first — *run test vectors to a point and hold, for
debugging* (issue 1 below) — and return to the probe afterward. The questions
in "Decisions still open" are unanswered.

---

## Original request (verbatim)

> I need to add a feature to the Javascript (slow) simulator. Nothing like this
> feature will ever be in the fast (generated code) simulator. The feature is a
> sort of oscilloscope probe. It is enabled during a run of the simulator,
> either a free run or test vectors. The feature is enabled by a button labeled
> "probe" that becomes visible in the toolbar when the simulator is running.
> When enabled, the mouse cursor changes to a small arrow at upper left With a
> question mark at lower right. The cursor's hotspot must be accurately
> positioned at the point of the arrow at upper left. When a point on the
> schematic is clicked and probe mode is active, the properties panel is
> activated and displays the logical state of the clicked point which may be a
> wire or schematic object. In other words the feature allows display of the
> logical state of any visible points in the schematic while the simulator is
> running. Let's discuss any issues you see with this proposal before you edit
> the specifications.

---

## Analysis

Basis: FR-020a/c/d, FR-076/076a, FR-087/087a/087b, FR-115b–k in
`specs/requirements.md`; code in `web/js/engine/sim.js`,
`web/js/engine/interaction.js`, `web/js/chrome/properties.js`,
`web/js/chrome/dialogs.js`, `web/js/model/netlist.js`.

The feature fits the architecture well. Seven things need settling before the
specs are edited — three real problems, four decisions.

### Real problems

**1. "Or test vectors" doesn't currently exist as a thing you can click during.**

A vector run is not a run in the FR-076 sense. `dialogs.js:1864` calls
`runVectors(flat, doc, …)`, which builds a throwaway sim on a flattened copy,
executes every row synchronously to completion, and discards it. Nothing is
published to `store.setSim`, so the canvas never shows vector-run state at all —
indicators don't light, wires don't go red. There is no instant at which a probe
click could land, and no state left afterward to probe.

Making the probe work with test vectors therefore requires a second, larger
feature: something like *run to row N and hold* — the panel keeps its sim
instance alive, publishes its display view to the canvas, and stops on a chosen
row. That's arguably a great debugging feature (it would light up indicators
too), but it's a bigger change than the probe itself, and it interacts with
FR-115c's "throwaway copy, never mutates the live design" guarantee.

Recommendation at the time: spec the probe against the interactive run (FR-076)
first, and treat "hold at row N" as a separate companion FR.

**Decision taken: build the "run to row and hold" feature first.** The probe
work resumes after it.

**2. The properties panel is defined as a pure function of the selection, and
selection is locked and cleared during a run.**

FR-020a/c/d all key off the selection; FR-087 clears it on entering the run and
forbids changing it. So the probe can't reuse the selection — it needs its own
store field (`state.probe`) with an explicit precedence rule: while a probe
target is set, the panel renders the probe sheet *instead of* the selection
sheet. It also has to be wholly read-only (the selection sheets have editable
fields — designator label, bus name, port target — which FR-087 already
disables, but a probe sheet should not structurally offer them).

Also, FR-087 says a click on a wire/bus/non-interactive component posts "Editor
is locked while the simulator is running". In probe mode that must not fire —
the probe becomes a second exception to FR-087 alongside the interactive-input
exception of FR-087a/b.

**3. The simulator has no net-value query, only a pin-value query.**

`buildSimulation` exposes `valueOfPin(refdes, pin)` and
`conflictedConductors()`; that's all `store.setSim` publishes. Probing a wire or
a bus bit needs a new query. That's cheap — `netlist.js` already keys nets by
lane (`wire:<id>`, `bus:<id>:<bit>`) — so adding `valueOfLane(lane)` is a few
lines, additive to design §6.13. Noted so the design section is honest about the
new API rather than implying the value is already reachable.

### Decisions still open

**4. What does "the logical state of a clicked point" mean per target type?**

Proposed taxonomy, hit-tested in this priority order (reusing `hittest.js`'s
existing `hitPin` → `hitJunction` → `hitSegment`/`hitBusSegment` →
`hitComponent` order):

- **pin** → that pin's value, plus the pin name/role from type data
- **junction** → the net's value
- **wire segment** → the net's value (0/1/U/Z), flagged if conflicted (FR-082)
- **bus segment** → a per-bit table of all N bit values, plus a hex rendering
  (the FR-115k grouping precedent)
- **component body** → a table of every pin and its current value. The most
  oscilloscope-like reading of "the logical state of the object" and by far the
  most useful thing for a 74-series part — but confirm, in case something
  narrower was meant.
- **empty canvas** → clears the probe (or is a no-op — pick one; clearing
  recommended)

**UNANSWERED.**

**5. Live or frozen?**

"Oscilloscope probe" implies the display tracks the running circuit; proposal is
to update each step/settle, throttled to the render frame. Caveat: in a paced
sequential run the value changes far faster than the eye can follow, so a live
single value is a blur — the probe is genuinely useful when *paused* or
single-stepping (FR-076a), or on a settled combinational design (FR-085). If it
should be useful during a paced run it needs something scope-like: a short
recent-value history strip, or a "last changed at t=" readout. This shapes the
FR, so decide before writing it.

On Stop, freeze the last values displayed, matching FR-085's existing "last
values remain displayed until the design is next modified".

**UNANSWERED.**

**6. One probe or several?**

One target at a time (clicking elsewhere retargets) fits the single properties
panel and is the smaller feature. A multi-point watch list is a different UI.
Proposal: spec one, with the list as a possible additive extension later.

**UNANSWERED.**

**7. Probe vs. clicking an input switch.**

While probe mode is on, does a click on a switch toggle it (FR-087a) or probe
it? Both are defensible. Proposal: the probe wins — the mode and its cursor
promise "inspect, don't touch", and reading a switch's driven value is useful —
with toggling available by leaving probe mode. Needs confirmation, because it is
a deliberate carve-out of FR-087a/FR-087b.

**UNANSWERED.**

### Smaller notes

- **Button placement.** FR-004a enumerates the top bar's buttons exactly, so
  "probe appears in the toolbar" means amending that inventory. The pause/step
  cluster (FR-076a) is the precedent for a control that appears only while
  running. Open question: is Probe a *fourth modal tool* (mutually exclusive
  with Select, the only tool enabled during a run) or an independent toggle?
  Proposal: a mode that supplants Select and reverts to Select when turned off
  or when the run stops, plus `Esc` to exit it (FR-004c). **UNANSWERED.**
- **Cursor.** Not a problem — `WIRE_CURSOR` in `interaction.js:109` already
  ships an inline SVG data-URI cursor with an explicit hotspot, so the
  arrow-plus-question-mark uses the same mechanism. One caveat worth recording:
  FR-025 deliberately chose a *center* hotspot because macOS cursor scaling
  preserves the center, so a corner hotspot drifts from the glyph tip when the
  pointer is scaled. For an arrow whose tip is at upper-left that is the same
  tradeoff the system arrow makes, so it is probably fine — but it runs against
  FR-025's stated rationale.
- **Hierarchy.** A run simulates a *flattened* design. Probing an embedded
  sub-design IC can only show its interface pin values; its internals aren't on
  the sheet. State this rather than leave it implied.
- **Buried internal nodes.** FR-079c says buried registered nodes (e.g. the
  74HC165's seven hidden stages) "are not probeable by an indicator". Probing
  them would be genuinely valuable for debugging, but it contradicts the spirit
  of that FR and would need an edit to it. Proposal: leave them out of v1.
  **UNANSWERED.**
- **Non-goals to write in explicitly:** not in the fast engine (so FR-107 parity
  is untouched — the probe reads nothing the C engine must reproduce), not
  persisted, not undoable, doesn't mark the design modified, no effect on
  netlist or NDL export.
- **Docs.** `docs/user.md` gets updated only after manual verification, per
  CLAUDE.md.

---

## To resume

Answer items 4, 5, 6, 7 and the button-placement question, then write the FRs
(new FR under §3.19 near FR-087a/b, plus amendments to FR-004a, FR-020a, FR-087)
and the design sections (§6.9 interaction/cursor, §6.11 chrome, §6.13
`valueOfLane`), append the CHANGELOG line, then implement.
