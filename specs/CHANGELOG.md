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
