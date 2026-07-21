# Design: TTL Circuit Design Editor (Visual Editor + Local Server)

> Audience: a developer implementing this system with no access to the
> requirements interviews or to the architect. §2 restates the requirements of
> the **original editor-only phase**; the many features added since (status
> bar, resilience, the simulators, memory devices, test vectors, hierarchy,
> the fast C engine, export — roughly FR-072 onward) are **not** restated
> there — they are specified directly in §6/§7 and indexed in §10.
> `requirements.md` is the complete, current requirement index and remains
> the authoritative source if a conflict is found. (Re-scoped 2026-07-08;
> supersedes the claim that this document restates all requirements.)
>
> This document, together with `requirements.md`, is the single source of truth
> for the system's intended state and is kept current. `CHANGELOG.md` is a
> chronological index of change requests (history and rationale only) — it is
> not needed to determine current behavior.

---

## 1. Overview

We are building a **localhost-only** schematic-style editor for designing
digital circuits from classic TTL (74xx-series) components. It has two parts:

1. A **browser single-page application (SPA)** written in plain JavaScript (ES
   modules, no build step). It renders a grid-backed drawing canvas on which the
   user places rectangular IC components and wires/buses them together.
2. A small **Go HTTP server** bound to `127.0.0.1` that loads a library of
   component-definition files at startup, serves the SPA and its API, and
   reads/writes design files on the local filesystem.

Both simulation engines from the vision statement are **in scope and
implemented**: the slow (debug) simulator runs live in the browser (§6.13), and
the fast engine is a code generator emitting a standalone C simulator (§6.17).
The editor's saved files capture geometry **and** electrical connectivity, which
is what made those engines straightforward to add. (Updated 2026-07-08;
supersedes the original "simulation engine and transpiler out of scope for this
phase", which matched only the first editor-only phase.)

---

## 2. Requirements Summary

The analyst's IDs are preserved exactly (`FR-###`, `NFR-###`, `IR-###`,
`OQ-###`). Grouping follows the analyst's grouping. **Scope note (2026-07-08):**
this summary covers the original editor-phase requirements; FRs added later
(status bar, resilience, simulators, memory devices, test vectors, hierarchy,
fast engine, export — roughly FR-072 onward, plus later suffixed additions)
are not summarized here — see `requirements.md` for the full index and §6/§10
for their design. Entries below are corrected in place when their FRs are
reworked.

### 2.1 Functional Requirements

**Application Shell and Startup**
- **FR-001** — JS SPA served by a Go HTTP server bound exclusively to localhost.
- **FR-002** — On startup the server loads all component-definition (YAML) files
  from a configured component-library directory.
- **FR-003** — The SPA fetches the component library at startup and populates the
  palette *before* allowing canvas interaction.
- **FR-004** — App opens in **select-tool** mode with an empty, unsaved design
  named `unnamed schematic <datetime>` (local date/time).

**Component Palette**
- **FR-005** — One fixed-size palette tile per loaded component type, labeled
  with the type's full external **display name** (the unabbreviated type name;
  a GAL part's `partnumber`, FR-005b), which also leads the tooltip. (Reworked
  2026-06-22; supersedes the abbreviated leading-`74`-stripped tile label.)
- **FR-005a**: the tile tooltip also carries the type's one-line `description`
  (FR-104) when present, as `"<name>: <description>"`; a type with no description
  keeps the plain full-name tooltip.
- **FR-006** — Palette is a fixed-width grid of equal tiles (3/row), packed
  left→right, top→bottom: 74-series ascending by numeric part number, then the
  free-form-named parts (GAL parts, memory devices), ties by library id
  (reworked 2026-07-08; supersedes the flat list and the abbreviated-number
  ordering).
- **FR-006a** — Palette split 50/50 by a midpoint divider: upper region = 74-series
  tiles, lower region = built-in objects (FR-067) with icon+tooltip tiles; each
  region scrolls independently. Each half wraps a fixed (non-scrolling) heading
  bar ("TTL Components" / "Built-In Components", tile-label font) above its
  scrolling tile grid.
- **FR-007** — Library loaded once at startup; no live reload of YAML files.

**Component Placement**
- **FR-008** — Place by dragging a tile from the palette onto the canvas.
- **FR-009** — Place by clicking a tile, then clicking a canvas point.
- **FR-009a** — An armed click-to-place tile shows a pressed-in (inset) look.
- **FR-010** — Placement is **one-shot**: after placing, return to select mode.
- **FR-011** — On placement assign a `refdes` `U1, U2, …` (incremented from the
  highest existing U-designator). The `refdes` is the immutable internal identity
  (the foreign key for wiring/selection/persistence), auto-allocated, never edited.
- **FR-011a** — Built-in objects (FR-067) use a separate `A-1, A-2, …` refdes
  series so they don't consume IC U-numbers.
- **FR-011b** — A separate, free-form `label` (defaulting to the `refdes`) carries
  the *displayed* designator; it is user-editable with no uniqueness/format checks
  and does not affect identity (the `refdes` does, FR-011).
- **FR-012** — Each instance displays its designator label (e.g., `U3`) and type
  display name (e.g., `74138`) as canvas labels, **always rendered upright**
  regardless of rotation.
- **FR-012a** — Label text is fixed-pixel (`PIN_FONT`/`LABEL_FONT` in
  `canvas.js`) while the symbol scales with zoom, so on a small symbol the text
  crowds. `drawComponent` culls labels by apparent on-screen symbol size
  `symPx = min(td.width, td.height) · scaleFor(vp)`: below `LABEL_T1` it skips
  pin name labels, below `LABEL_T2` (< T1) it also skips the type display-name
  line and centers the lone designator. The designator (U-number) is always
  drawn. Subunits gate only on T1 (no type line); built-ins are unaffected (no
  pin labels, designator only). Thresholds are tuning constants.

**Component Appearance**
- **FR-013** — Each component is a rectangular outline with a short connection
  lead at each pin and pin name labels on the rectangle's sides. Each lead is a
  straight line segment from the pin's grid point on the outline edge, outward
  along the pin's side direction (rotation-aware), 0.5 grid units long. That grid
  point stays the connection coordinate. Leads are short enough that adjacent pins
  (1 grid unit apart) never crowd. Applies to every non-subunit component (built-in
  objects included; their body glyphs are unaffected). The wire attachment point
  and hot region are FR-013d.
- **FR-014** — Pin side (left/right/top/bottom) and position come from the YAML
  file; the editor never infers or rearranges pins.
- **FR-015** — Pin name labels always render upright regardless of rotation.

**Built-in Objects**
- **FR-067** — Editor-defined objects (not YAML), placed from the lower palette;
  once placed they are ordinary instances (select/move/rotate/delete/persist/wire),
  designated `A-1, A-2, …`.
- **FR-068** — State indicator: 2×2 footprint, one bottom-center input pin; a round
  bubble showing wire state — gray `?` (undriven/U/Z), white `1`, black `0`. Not
  independently stateful: during a run it displays its net's live simulated value,
  and after a run the last values persist until the design is next modified
  (FR-085). Same bubble for palette icon and placed object. (Reworked 2026-06-11;
  supersedes "displays `?` until the simulator exists".)
- **FR-069** — Pull-up: 2×2, one bottom-center pin; a two-headed up-arrow (two
  stacked up-chevrons + a vertical shaft from the pin to just below them). Tooltip
  "pull up".
- **FR-070** — Pull-down: 2×2, one top-center pin; an upside-down `T` (long stem
  + short bottom bar). Tooltip "pull down".
- **FR-071** — Clock: a box reading `CLK`, one right-center pin. Tooltip "clock".
- **FR-071b** — Power-on reset: a box reading `RST`, two right-edge pins (R
  active high, /R active low); drives reset for the first `cycles` clock
  cycles of a run (property, default 3). Tooltip "power-on reset".
- **FR-071c** — Input switch: 2×2, one right-center `out` pin; drawn like the
  state indicator (FR-068) — a round bubble showing its value (white bubble /
  black `1`, or black bubble / white `0`) — with a small arrow off the bubble
  toward the output pin marking it a source. Two states only, `1` and `0`. A
  strong driver of its value (FR-087a). State is persisted per-instance
  (`switchState`, default `0`), set via the properties panel while editing
  (FR-020c) or by clicking it while simulating, which toggles 0↔1 (FR-087a).
  Tooltip "input switch". (Reworked 2026-06-17; supersedes the 1/0/? rotary dial
  with a U state.)
- **FR-071f** — Text note: a `NOTE`-labeled palette tile; on the canvas, free-form
  text with a **blue-dotted outline box shown only when selected or editing** (at
  rest just the text). A **pure annotation** — no pins, not
  wired, absent from the netlist/sim, no behavior, no properties, and **no
  visible designator or type label** (exempt from FR-011a/FR-012; it carries an
  internal-only `N-<n>` `refdes` as its identity, FR-011, never drawn, and has no
  editable label, so the editor can still track it). The box **auto-sizes**
  to its text (whole grid units, small minimum). Text entry begins on placement
  and re-opens on double-click; **Enter** commits, **Shift+Enter** inserts a
  newline. Selectable/movable/deletable/**rotatable** like other objects (incl.
  multi-select); rotation turns the box **and its text** together (the text reads
  at the rotated angle — a deliberate exception to the upright-label rule of
  FR-012/FR-015/FR-020). Per-instance `text` (default empty) round-trips with the
  instance. (Added 2026-06-22.)
- **FR-071g** — Transmission gate: 2×2; contact terminals `A` (left-center) and
  `B` (right-center), active-high enable `EN` (top-center); the conventional
  two-opposing-triangles glyph. An ideal bidirectional switch: terminals are
  symmetric (no input/output side); closed (EN=1) joins the two terminal nets,
  open (EN=0) isolates them — semantics per FR-083a (net merging, U-control
  rule, one-unit control delay, no charge storage). Drives nothing, stores
  nothing, no properties, not interactive. Tooltip "transmission gate". (Added
  2026-07-07.)
- **FR-071h** — Relay (SPDT changeover): 4×4; `COIL` (top edge, an idealized
  one-pin logic-level coil — no second terminal, no analog) and right-edge
  contacts `NO` (top) / `COM` (middle) / `NC` (bottom). Released (COIL=0) joins
  COM–NC; energized (COIL=1) joins COM–NO; per FR-083a. No pick/drop delay
  (contacts follow the coil by the standard one unit; a delay property is a
  later additive change). SPST = leave a throw unwired. Drawn as a coil (top
  lead) + three contact terminals (COM common pole marked with a dot, plus NO
  and NC) with **no static contact arm** (it could not track the simulated
  state), the right-edge `NO`/`COM`/`NC` terminals labeled on the canvas so they
  are identifiable. Tooltip "relay (SPDT)". (Added 2026-07-07; COIL moved from
  the left edge to the top, footprint widened to 4×4, glyph reworked with
  contact labels, and the misleading static contact arm removed 2026-07-07.)

**Component Selection and Movement**
- **FR-016** — In select mode, click a component to select it.
- **FR-017** — Drag a selected component to a new position; it snaps to grid.
- **FR-018** — When a component moves, wire/bus segments connected to its pins
  **stretch** to follow (may cross other components; user re-routes later).
- **FR-018a** — In select mode, delete a selected component. Wires/buses
  connected to it remain, with formerly-connected endpoints left **dangling**
  (see FR-029, FR-030).

**Component Rotation**
- **FR-019** — Rotate the selection 90° CW or CCW as a **rigid body** about a
  single grid-snapped pivot: each selected component's origin, each interior
  bend/junction vertex (FR-018c), and each non-pin vertex of an explicitly
  selected conductor segment (FR-018d) maps `q → P + R(q − P)`, and each
  component's `rotation` is bumped by the delta — so pins, bends, and junctions
  all turn together and the sub-circuit keeps its shape. Pivot `P`: a single
  component's own origin (unchanged in-place rotation); otherwise the grid-snapped
  center of the selected components' combined bounding box. One reversible
  `rotateSelectionCmd` captures the prior origins/rotations and the moved vertex
  positions (interior + selected-segment, FR-018d) for undo. Supersedes per-component "about its own center", which
  tore multi-component sub-circuits apart.
- **FR-020** — Rotation repositions pin leads; all text labels stay upright.

**Per-Instance Type Overrides**
- **FR-020a** — View a selected instance's type data and override specific values
  (e.g., propagation delay) for that instance only. Overrides do not affect other
  instances or the YAML file; persisted per FR-058.

**Canvas and Grid**
- **FR-021** — Entire canvas backed by a uniform fine grid (~1–2 mm at default
  zoom). All components, pins, wire endpoints, and bend points lie on grid
  intersections.
- **FR-022** — Zoom in/out.
- **FR-023** — Pan.
- **FR-024** — Undo/redo for all design-modifying actions.

**Wire Drawing**
- **FR-025** — A Wire tool; while active the cursor gives clear wire-mode feedback.
- **FR-026** — Activate Wire tool via a toolbar button.
- **FR-027** — Click source pin, then destination pin → a wire following the
  proposed route (FR-027c) current at the destination click.
- **FR-027c** — The proposed route is a Manhattan path avoiding component
  bodies, escaping pins in their facing direction, preferring few corners;
  best-effort, degrading to the straight rat's-nest line when no route is
  found. On commit the route's corners become ordinary, editable bend points.
- **FR-028** — After placing a wire, return to select mode.
- **FR-029** — A wire/bus with exactly one connected endpoint is permitted.
- **FR-030** — A wire/bus with no connected endpoints is auto-removed.

**Wire Routing (Bend Points)**
- **FR-031** — In select mode, a plain click on a wire/bus segment selects **that
  segment** (a `{kind:"segment", id, segIndex}` ref, highlighted by `drawWires`/
  `drawBuses`, §6.8), not the whole conductor; a press-and-drag beginning on a
  segment instead inserts a bend point at the nearest grid intersection, splitting
  the segment in two, and drags it until release. Whole-conductor selection is via
  the rubber-band (FR-016b); single-leg delete is FR-033d.
- **FR-032** — Drag a bend point to any grid intersection (mouse held down); the
  two adjoining segments rubber-band continuously.
- **FR-032a** — Drag a junction point the same way. A junction is a shared
  `Vertex` (§7.1a) referenced by every conductor that meets there, so the drag
  targets the **vertex**, not a single path point: a `moveVertex` mutation
  rewrites the vertex's authoritative grid position and all referencing
  conductors' segments rubber-band together, keeping the branch connected (the
  net is unchanged — geometry only). The interaction layer hit-tests junction
  nodes alongside bends (§6.9) and commits via `moveVertexCmd`; the bend
  hit-test alone did not see junction nodes, which is why they had been
  immovable.
- **FR-033** — Right-click a bend point → "Delete bend point"; the two adjoining
  segments merge into one straight segment.
- **FR-033a** — In select mode, delete an entire wire or bus.
- **FR-033d** — Delete a single selected **segment** (FR-031): the Delete key on a
  `segment` selection, or the context menu's "Delete segment" (§6.11), dispatches
  `deleteSegmentCmd(id, segIndex)` → `deleteSegment` (§6.6), which cuts the path at
  that edge, promotes any cut bend to a `free`-vertex endpoint, drops a degenerate
  (<2-point) half, and runs `cleanup`. Generic over wire/bus (the two parts inherit
  width/bitNames; each `groupConnection` follows the part keeping its vertex). One
  undoable action.

**Wire Branching and Connectivity**
- **FR-034** — While the Wire tool is active, clicking an existing wire segment
  **starts a new branch** from that point (rather than inserting a bend point).
- **FR-034a** — A pin may have more than one wire (fan-out).
- **FR-034b** — A branch point is an **electrical junction**. All pins/wires
  transitively connected through pins and junctions form one **net**. The set of
  nets must be derivable from the saved design **without pixel geometry**.

**Bus Drawing**
- **FR-035** — A Bus tool, separate from the Wire tool.
- **FR-036** — Buses render as **thick blue** lines; wires as **thin black** lines.
- **FR-037** — Each bus shows a width annotation: a slash mark and a digit (bits).
- **FR-037a** — A width-N bus is **N independent single-bit nets**; bit *i* is a
  distinct net from bit *j*. FR-034b connectivity applies per bit.
- **FR-037b** — A bus may carry an optional per-bit **signal name** (e.g.,
  C/V/N/Z). On first snap-connect to a named pin group, the bus **adopts** the
  group's pin names in bit order; position (not name) determines connectivity.
- **FR-038** — Right-click a bus to set its width.
- **FR-039** — Bus drawing/bending/branching follow the wire interaction model
  (FR-026…FR-034).
- **FR-039a** — Joining two buses aligns bits by position: equal width → bit-for-bit;
  **unequal width** → only via the FR-039b offset alignment, rejected only when no
  alignment fits. (Reworked 2026-07-09; supersedes the blanket prohibition.)
- **FR-039b** — An unequal-width bus join (width *m* onto width *n*, *m* ≠ *n*; end-join
  FR-034c or T-junction FR-039/FR-034b) prompts for the alignment offset *k* — the
  wider bus's bit that maps to the narrower's bit 0 — with narrow bit *i* ↔ wide bit
  *k+i*. Only *k* ∈ 0…(*n*−*m*) are offered. The join is a **junction** carrying *k*
  (`vertex.offset`), not a seamless merge (unequal widths can't be one conductor).
  (Added 2026-07-09.)
- **FR-040** — After placing a bus, return to select mode.

**Bus-to-Component Snap Connection**
- **FR-041** — Dragging a bus endpoint onto a component determines which declared
  pin groups **accept** the bus: a group accepts a width-`w` bus when it has a
  contiguous run of ≥ `w` currently-unconnected pins (reworked 2026-06-20;
  supersedes "match = member pin count == width" — a narrower bus may now take a
  free sub-block of a wider group, FR-041c).
- **FR-041a** — Exactly **one** accepting group → snap-connect automatically.
- **FR-041b** — **More than one** accepting group → prompt the user to choose by
  name (may cancel). Supersedes the old "first declared on tie" guess.
- **FR-041c** — A narrower bus claims the **pack-low** block: the first `w` pins
  of the lowest free contiguous run; two buses may share one group's disjoint
  sub-blocks. (Added 2026-06-20; §6.9 `groupFreeBlock`.)
- **FR-042** — On connect (auto or chosen), connect each bit to the corresponding
  pin of the claimed block (FR-041c) in declared bit order (no per-pin wiring).
- **FR-043** — **No** accepting group → leave the endpoint **unconnected**.
  (Supersedes the earlier nearest-pin-attach rule.)
- **FR-043a** — The user can **break out** a single bit from a bus and route it as
  an ordinary single-bit wire; the wire joins that bus bit's net (FR-037a).

**File Operations — New**
- **FR-044** — Create a new empty design at any time **while a project is
  current**; the new design belongs to the current project. With no current
  project the action is unavailable (project-first startup, FR-121c).
  (Reworked 2026-07-12; supersedes the unconditional "at any time".)
- **FR-045** — A new design is named `unnamed schematic <datetime>`.

**File Operations — Save**
- **FR-046** — Save the current design.
- **FR-047** — On first save, prompt to confirm/change the filename (prefilled
  with the default name). The prompt is rooted at the current project root and
  effectively asks only for a **name**: the location is the project
  (FR-121c/FR-121e; project seeding added 2026-07-12).
- **FR-047a** — A save under a different file name renames the design to the
  file's base name: shown in the toolbar, written inside the file, and
  pre-filled by future prompts.
- **FR-048** — Subsequent saves overwrite without prompting.
- **FR-049** — Save As at any time, to a new name **within the current
  project**: a target outside the project directory is rejected (FR-121e;
  forking a whole project is Duplicate Project, FR-121f). (Confinement added
  2026-07-12.)
- **FR-049a** — Indicate unsaved changes; warn before discarding them (New/Open).
- **FR-049b** — A save prompt (FR-047/FR-049) that targets an existing file
  confirms the overwrite before writing and aborts if declined. Implemented in
  the save-mode file dialog (`openFileDialog`, dialogs.js): on OK it confirms
  when the chosen name matches a file in the current directory listing. The
  FR-048 same-file re-save skips the dialog, so it is unaffected.
- **FR-050** — Server stores designs in `retrosim` inside the user's
  documents directory by default (created if absent). This data directory is
  the default **home for project directories**: the New Project prompt seeds
  there (FR-121b; role added 2026-07-12). (Reworked 2026-06-12;
  supersedes the platform-standard application data directory.)
- **FR-051** — The file dialog lets the user choose a different save location.

**File Operations — Open**
- **FR-052** — Open an existing design via a file-navigation dialog. On load
  the design's containing folder becomes the **current project** (FR-121b;
  added 2026-07-12).
- **FR-053** — Server provides an endpoint to list directory contents so the
  browser can render a navigation dialog (no native file picker). Design
  listings exclude project manifests (`*-manifest.json`, FR-121a; exclusion
  added 2026-07-12).
- **FR-054** — If server-assisted navigation proves impractical, fall back to a
  list of recently opened designs.

**Design Save Format**
- **FR-055** — Designs saved as JSON.
- **FR-056** — JSON contains at minimum three collections: (a) component
  instances, (b) wire routes, (c) bus routes.
- **FR-057** — Each instance record includes: the type id (FR-066e), refdes,
  optional display label (FR-011b), canvas position, rotation, and a **full
  copy** of the type's data captured at **placement** (re-copied only by
  Refresh Types, FR-088; persisted verbatim at save).
- **FR-058** — Per-instance overrides stored alongside the copied type data.
- **FR-059** — Each wire record includes two endpoint references plus an ordered
  list of bend-point grid coordinates. An endpoint is one of: (a) a component pin
  (U-number + pin name), (b) a junction on another wire/bus, or (c) a free grid
  coordinate (dangling).
- **FR-059a** — Saved design represents electrical connectivity (the nets) in a
  form derivable without pixel geometry.
- **FR-060** — Each bus record includes the same endpoint/bend data as a wire,
  plus bus width (bits) and pin-group connection data for snap-connected ends.

**Component Definition (YAML File)**
- **FR-061** — Each TTL type is defined by a YAML file (`.yaml`), parsed by the
  server; the format is specified in §7.6.
- **FR-062** — The YAML file specifies: type name, outline dimensions, and per pin:
  name, side, and position along that side.
- **FR-062a** — The YAML file specifies each pin's electrical direction (at least:
  input, output, bidirectional, tristate-capable).
- **FR-062b** — Outline dimensions may be stated explicitly; if omitted, the
  server derives them from the author-placed pins. A pin may carry an optional
  physical pin number as footprint/BOM metadata only. (No package mechanism: the
  earlier declared-package idea was removed.)
- **FR-063** — The YAML file may declare named pin groups (ordered pins forming a
  bus) for snap-connection (FR-041…FR-043).
- **FR-064** — The YAML file may specify propagation-delay values.
- **FR-065** — Server exposes the parsed library to the SPA via an API endpoint.
- **FR-066** — The YAML format is designed so behavioral logic (GALasm) can be added
  without changing the editor or breaking the parser. The **editor** ignores
  behavioral content (preserving it on round-trip — see §7); the slow simulator
  evaluates it (§6.13, FR-079).

**Magic UART (§3.26)**

- **FR-122** — A built-in **magic UART** output component: eight data inputs
  D0–D7 (group DATA), an active-low chip select CS/, an active-low clock enable
  CE/, and a clock CLK; no outputs. On CLK's rising edge while CS/=0 and CE/=0 it
  latches D0–D7 and emits the byte as an ASCII character to the simulator's standard
  output (Console panel for the slow sim, real stdout for generated C). Output-only,
  heavily buffered, asynchronous with the sim; no receive path. A client-defined
  built-in (not a library YAML type), A-series refdes, no properties; behavior is a
  built-in (the output-device analogue of memory, FR-114d), not GALasm.
- **FR-122a** — Drawn as an IC-style box labeled "UART"; DATA pins on one edge,
  CS//CE//CLK on the other (trailing-slash active-low labels); lower palette region,
  tooltip "magic UART".
- **FR-122b** — Slow-sim behavior: unit-delay four-state; read previous-step nets
  (Z→U); emit on CLK 0→1 **only** when CS/ and CE/ are exactly 0 (uncertain ⇒ no
  emit — a side effect, unlike memory's pessimistic-U bus); data bits masked non-1→0
  (U→0, FR-114g); at most one byte per edge; register state transient.
- **FR-122c** — Optional **Console panel**: docked bottom panel toggled from View ▸
  Console; modeless (no read-only lock); monospace, sticky-tail autoscroll; byte
  rendering (printable + LF/TAB verbatim, CR ignored, else `\xNN`); interleaves all
  UARTs; Clear action; cleared at Run start; bounded retained history; open state +
  text are session-only (not saved).
- **FR-122d** — Fast (generated C) sim reproduces FR-122b bit-for-bit (FR-107),
  emitting each byte to real stdout in both batch modes, fully buffered; generator
  bakes a per-UART device table, runtime owns the latch/emit. Shares stdout with the
  free-run dump / vector transcript (dump trails UART output); parity accounts for it.

### 2.2 Non-Functional Requirements
- **NFR-001** — Server binds exclusively to `127.0.0.1`; no other interface.
- **NFR-002** — SPA functions in a single tab with no external (internet) network
  requests. (Localhost API calls per IR-001 are not "external".)
- **NFR-003** — Server in Go; SPA in JavaScript.
- **NFR-004** — Server API versioned/structured so new endpoints can be added
  without breaking existing clients.
- **NFR-005** — Canvas interactions (drag, rubber-band, pan, zoom) feel
  responsive; no perceptible lag for operations not needing a server round-trip.
- **NFR-006** — Undo/redo stack supports **≥50** discrete actions.

### 2.3 Integration Requirements
- **IR-001** — SPA ↔ server only via HTTP/REST over localhost.
- **IR-002** — No external third-party integrations this phase.

---

## 3. Requirements Issues

The requirements are unusually complete; the analyst pre-flagged most gaps as
`OQ-###`. Below are the issues that affect this design, each with the resolution
this document adopts. **None block implementation** except where noted in §12.

### 3.1 Ambiguities

- **A1 — Junction identity / net derivation (OQ-007, FR-034b, FR-059, FR-059a).**
  FR-059 lists "a junction on another wire or bus" as an endpoint kind but does
  not say *how* a junction is identified, while FR-059a forbids relying on pixel
  geometry to determine connectivity. **Resolution:** connectivity is modeled as a
  **graph of first-class `Vertex` objects** (§7.1a). A junction is a `Vertex` with
  a stable id; two wires connect by **referencing the same vertex id**, never by
  comparing coordinates. Net membership is the set of connected components over
  vertex ids (§6.6). The vertex carries the only copy of the junction's grid
  position, so a junction can never drift off the wires that meet at it. (This
  supersedes the earlier "junction endpoint stores a target wire id + render-only
  coordinate" scheme; see §8 and §12/OQ-007.)

- **A2 — Fan-out vs. two-endpoint wires (FR-034a vs FR-059).** A wire has exactly
  two endpoints, yet a pin may carry several wires and wires may branch.
  **Resolution (interpretation):** a wire is an ordered `path` whose **first and
  last points are its two endpoints**; both are `Vertex` references. Fan-out is
  achieved by **multiple wires referencing the same vertex** (a shared pin vertex
  or a shared junction vertex). A wire's `path` may *pass through* an interior
  junction vertex (a branch point), but that is not a third endpoint — the wire
  still has exactly two endpoints. This is consistent with FR-059.

- **A3 — "Matching pin group" for bus snap (FR-041).** *Previously* this design
  guessed "first group in file order" on a width tie. That guess is **withdrawn**:
  the stakeholder confirmed the behavior and it is now a requirement. Group width
  = **member pin count** (FR-041); **one** match → auto-connect (FR-041a);
  **≥2** matches → **disambiguation dialog** by group name (FR-041b); **0** matches
  → leave unconnected (FR-043). See §6.9/§6.11. (Extended 2026-06-20 by
  FR-041/FR-041c: "accepts" replaced the equal-width "matches" — a narrower bus
  may claim a contiguous free sub-block of a wider group, pack-low; §6.9
  carries the current semantics.)

- **A4 — Net storage vs derivation (FR-059a).** "Derivable" does not say whether
  to *store* nets. **Resolution:** the save file **includes** a `nets` array
  computed at save time as a convenience for downstream tools, but it is
  **regenerated on every save** and treated as derived/non-authoritative; the
  wires/buses/instances remain the source of truth.

- **A5 — Grid spacing & default zoom (OQ-004).** **Resolution:** one grid unit =
  a "~2 mm" cell; `PX_PER_UNIT_DEFAULT` is **8 device pixels per grid unit** at
  zoom 1, and the initial viewport opens at **zoom 1.6** (≈12.8 px/grid-unit) so
  pins are easy to click and labels stay legible; zoom range **0.25×–16.0×**
  (raised 2026-07-19 from 4.0× — 128 px/grid-unit at max, deep enough for
  pin-level inspection per the reworked FR-022). The wheel-zoom step is
  delta-proportional: `factor = exp(−deltaY × WHEEL_ZOOM_SENSITIVITY)` with
  `WHEEL_ZOOM_SENSITIVITY = 0.0008`, clamped per event to
  **[0.8, 1.25]** (supersedes the fixed 1.1× per event, which stacked into
  overshoot across macOS wheel-event bursts). These are constants (`GRID_MM`,
  `PX_PER_UNIT_DEFAULT`, `ZOOM_MIN`, `ZOOM_MAX`, `WHEEL_ZOOM_SENSITIVITY`,
  default viewport zoom) in one place so they are trivially tunable.

- **A6 — Bus-tool one-shot (OQ-005).** Assumed **yes**: the Bus tool returns to
  select mode after placing one bus, mirroring the Wire tool (FR-040 confirms).

- **A7 — Buses as N nets + breakout (FR-037a/b, FR-039a, FR-043a, FR-060a).** A bus
  is *width* independent signals, not one net. **Resolution:** the netlist treats
  each conductor as a **bit-lane** — a wire is 1 lane, a width-*w* bus is lanes
  `(busId, 0…w-1)` — and runs ordinary union-find over lanes (§6.6). A full
  bus↔bus junction unions lanes pairwise: equal-width buses align by index; an
  unequal-width join aligns the narrower bus's lanes to the wider's starting at the
  junction's alignment offset `k` (FR-039b), narrow bit *i* ↔ wide bit *k+i*; a
  **breakout** is a wire whose endpoint is a junction vertex on a bus carrying a
  **bit index**, unioning that one lane (FR-043a). Buses may carry
  per-bit names adopted from the snapped group (FR-037b); the saved `nets` carry
  per-bit **provenance** `{bus,bit,name?}` (FR-060a).

- **A8 — Startup design vs project-first startup (FR-004 vs FR-121c).**
  FR-004 (unchanged) says the app opens with an empty, unsaved design named
  `unnamed schematic <datetime>`; FR-121c says at startup no project is current,
  the canvas is "empty and inert", and a design always belongs to a project.
  **Resolution (stakeholder-confirmed 2026-07-12):** FR-004's default-named
  design remains in the store at startup as an **inert placeholder** — every
  editing and saving path is refused by the no-project lock (§6.10) and the
  chrome's no-project state (§6.11) — and it is replaced by a fresh design when
  a project becomes current (§6.19). FR-004 stays accurate (select mode, that
  name shown); FR-121c's "always belongs to a project" holds for every design
  that can actually be edited or saved.

- **A9 — Open Project with no main design: cancel semantics (FR-121b).**
  When the chosen project names no main design, the open-design dialog is
  presented rooted at the project; the requirement does not say what a cancel
  does. **Resolution (stakeholder-chosen 2026-07-12):** cancel cancels the
  **whole action** — no project change, no canvas change. Recorded consequence:
  a project directory containing **no designs** cannot be made current via Open
  Project (there is nothing to pick); New Project is the flow that
  creates-and-enters an empty project. **Duplicate Project differs by
  necessity** (§6.19): its copy has already happened when the picker appears,
  so a cancel there leaves the duplicate current with a fresh empty design.

- **A10 — Which navigations switch the current project (FR-121b vs
  FR-100/FR-101).** FR-121b names Open Project and plain File ▸ Open as
  project-switching, but is silent on descend/follow/back, which can reach a
  **legacy** outside-project child (FR-121d). **Resolution (interpretation):**
  the containing-folder rule is applied uniformly by the one shared load path
  (`fileops.loadIntoStore`, §6.19): any successfully loaded design whose folder
  differs from the current project's directory makes that folder current.
  Inside a conforming project every child/peer is in the same folder
  (FR-121d/FR-101), so the rule fires only on plain Open, Open Project, and
  legacy outside-project references — where switching is the only reading that
  keeps "the current design lies inside the current project" invariant.

- **A11 — FR-121b "rooted at the project" vs FR-052a remembered directory.**
  FR-121h keeps the remembered-directory rule for open-mode dialogs, yet
  FR-121b explicitly roots the no-main-design open-design picker at the project.
  **Resolution (interpretation):** the specific FR-121b picker is the more
  specific rule — it ignores the remembered directory for its **starting**
  location (an `ignoreLastDir` option on `openFileDialog`, §6.11) but still
  updates the remembered directory as the user navigates. All other open-mode
  dialogs keep FR-052a unchanged.

### 3.2 Contradictions

- **C1 — None material.** NFR-002 ("no external network requests") vs IR-001
  ("HTTP over localhost") is only apparent: "external" means the public internet;
  localhost API traffic is intended and allowed. Stated for the record.

- **C2 — FR-051 vs FR-121e (save location freedom vs project confinement).**
  FR-051 says the file dialog allows choosing a different save location;
  FR-121e rejects a design-save target outside the project. **Resolution:** not
  material — navigation stays free in every dialog; for a **design** save,
  confirming an outside-project location is rejected with a message and the
  dialog stays open (§6.11). FR-051 remains fully true within the project and
  for the data-file pickers (ROM content, RAM save — FR-121d exempts data
  files) and the New/Duplicate Project location prompts.

### 3.3 Gaps

- **G1 — Concrete YAML file syntax (OQ-001, FR-061) — RESOLVED.** Originally a
  gap deferred to a collaborative session; that session concluded and the syntax
  is now the **binding YAML format in §7.6**, decoded against the in-memory
  `ComponentType` model and parser contract (§7.1). No longer an open item
  (see §12, OQ-001).

- **G2 — Delete of a wire/bus that leaves another wire's junction dangling.**
  FR-033a deletes a wire; FR-034b says wires can branch through a shared junction
  vertex. **Resolution (under the vertex model, §7.1a):** when a wire/bus is
  deleted, each `junction` vertex it referenced has its reference count decremented.
  A junction vertex referenced by **exactly one** remaining wire is **demoted**: if
  it sits at that wire's path endpoint it becomes a **`free` vertex** (dangling, per
  FR-029); if it sits **interior** to the path it becomes an ordinary **bend** in
  place, after which the wire is re-pruned (`prunePath`) so a demoted bend that is
  now collinear with its neighbors is dropped rather than left as a 0° bend
  (FR-033c). One referenced by **zero** remaining wires is **deleted**. The FR-030
  sweep (a wire/bus all of whose
  endpoints are `free` and not group-snap-connected — see §7.3 Delete — is
  removed) then runs. There is no coordinate copying or
  target-id retargeting — demotion follows naturally from the shared vertex losing
  degree. Implied by FR-018a/FR-029/FR-030; made explicit here.

### 3.4 Untestable / Vague

- **U1 — NFR-005 "responsive / no perceptible lag."** Made testable by a concrete
  budget: interactive frames render in **≤16 ms** (≈60 fps) on the reference
  hardware for designs up to a stated size (see §11). Confirm the threshold/size
  in §12 if a different target is desired.

If, on implementation, any resolution above proves wrong, treat `requirements.md`
as authoritative and raise it — do not silently diverge.

---

## 4. Constraints and Assumptions

### 4.1 Constraints (hard)
- SPA in **plain JavaScript** — **no** TypeScript, JSX, WebAssembly, bundler, or
  any build step. Source is served as-is and loaded as native ES modules.
- Server in **Go**, using only the standard library where practical
  (`net/http`, `encoding/json`, `os`, `path/filepath`). No web framework needed.
- Server binds **only** to `127.0.0.1` (NFR-001). Single local user; **no**
  auth/TLS.
- Out of scope: **electrical-rule checking** (e.g., output-to-output conflicts,
  direction validation) as an *editing-time* check. Pin `direction` is captured
  (FR-062a) so ERC can be added later without a model change; the bus
  disambiguation dialog (FR-041b) does **not** filter candidates by direction
  (D2). (The simulator does detect bus conflicts at run time, FR-082.)
  (Updated 2026-07-08; supersedes the earlier bullet that also listed
  copy/paste, the simulation engine, and the transpiler as out of scope — all
  three are now implemented: §6.15, §6.13, §6.17.)
- Target browsers: modern desktop **Chrome/Firefox**. No mobile support.

### 4.2 Assumptions
- The Go module lives at repo-root `srv/` (its module path retains the
  historical name `github.com/gmofishsauce/retrosim/sim/srv`); the SPA lives at
  repo-root `web/`. (Paths updated 2026-07-08; the design began greenfield.)
- The user authors valid YAML files; the parser reports errors but need not repair
  them.
- Design files fit in memory; no streaming I/O for save/load.
- One server instance per user; no concurrent sessions.
- The user's local filesystem is trusted (single-user localhost tool), so the
  directory-listing endpoint does not sandbox paths beyond basic error handling.

---

## 5. Architecture

### 5.1 Components

```
┌──────────────────────────── Browser (SPA, plain ES modules) ────────────────────────────┐
│                                                                                          │
│  chrome/ (DOM)                         engine/ (Canvas 2D)            model/ + store      │
│  ┌────────────┐ ┌────────────┐         ┌───────────────┐             ┌──────────────┐     │
│  │ Toolbar    │ │ Palette    │         │ CanvasRenderer│  reads       │ Design model │     │
│  │ (tools)    │ │ (tiles)    │         │ (render loop) │◀────────────▶│ (instances,  │     │
│  └─────┬──────┘ └─────┬──────┘         └──────┬────────┘             │  wires,buses)│     │
│  ┌─────┴──────┐ ┌─────┴──────┐         ┌──────┴────────┐  mutate via  └──────┬───────┘     │
│  │ Dialogs    │ │ Properties │         │ Interaction   │  Commands           │             │
│  │(save/open) │ │ panel      │         │ (tool FSM,    │────────────▶┌──────┴───────┐     │
│  └─────┬──────┘ └─────┬──────┘         │  hit-testing) │             │ Store +      │     │
│        │              │                └──────┬────────┘             │ Undo/Redo    │     │
│        └──────────────┴───────── subscribe ───┴──── notify ─────────▶│ (Commands)   │     │
│                                                                       └──────┬───────┘     │
│                                            api.js (fetch) ───────────────────┘             │
└───────────────────────────────────────────────│─────────────────────────────────────────┘
                                                 │ HTTP/REST (localhost only)
┌────────────────────────────────────────────────┴─────────────────── Go server ───────────┐
│  api.go (router /api/v1/*)                                                                 │
│   ├─ GET  /components   ─▶ components.go  ─▶ yamlparse.go  (shared lib ∪ project/,FR-121i) │
│   ├─ POST /components   ─▶ components.go (create authored part → project/, FR-007a/121i)   │
│   ├─ GET  /files        ─▶ storage.go (list directory; ext filter, FR-114e; manifest      │
│   │                                    exclusion, FR-121a)                                 │
│   ├─ GET  /project/info ─▶ project.go (dir → manifest/name/main design, FR-121a)           │
│   ├─ POST /project/create   ─▶ project.go (mkdir + manifest, FR-121b)                      │
│   ├─ POST /project/duplicate ─▶ project.go (recursive copy + manifest rename, FR-121f)     │
│   ├─ GET  /romfile      ─▶ storage.go (read ROM .bin/.hex bytes, FR-114e)                  │
│   ├─ POST /ramfile      ─▶ storage.go (write RAM .bin/.hex bytes, FR-114g)                  │
│   ├─ GET  /design/load  ─▶ storage.go (read JSON)                                          │
│   ├─ POST /design/save  ─▶ storage.go (write JSON)                                         │
│   ├─ POST /file/save    ─▶ storage.go (write verbatim text, FR-116/FR-119)                 │
│   ├─ GET  /ping         ─▶ (heartbeat, FR-089)                                             │
│   └─ GET  /defaults     ─▶ paths.go    (default designs dir, FR-050)                       │
│  static file handler  ─▶ web/ (index.html + js/ + css/)                                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Control & data flow
1. **Startup:** server parses every YAML file in the component dir into
   `ComponentType` structs (FR-002), then serves. The SPA fetches
   `/api/v1/components` and `/api/v1/defaults`, builds the palette, and only then
   enables canvas interaction (FR-003) — a loading overlay covers the canvas until
   both fetches resolve.
2. **Editing:** all UI events feed the **Interaction** tool FSM, which never
   mutates the model directly — it constructs a **Command** and pushes it to the
   **Store**. The Store applies the command, records it on the undo stack, marks
   the design dirty, and notifies subscribers. The **CanvasRenderer** and chrome
   widgets re-render from the new state. This single mutation path is what makes
   undo/redo (FR-024, NFR-006) total and reliable.
3. **Persistence:** Save serializes the model to JSON and POSTs it to the server,
   which writes the file (FR-046…FR-051). Open lists directories via `/files`
   (FR-052/FR-053) and loads via `/design/load`.
4. **Projects (FR-121, §6.19):** at startup no project is current and the FR-004
   placeholder design is inert (§3.1 A8); the first effective action is New
   Project / Open Project / plain Open, each of which establishes the **current
   project** — a client-side store value naming the project directory. The
   current project then scopes every file flow (save confinement, embed
   boundary, dialog seeding). The server stays stateless: project-aware
   requests carry the directory as a parameter.

### 5.3 New vs modified vs unchanged
The design began **greenfield** (nothing predated it; section retained for the
record). Conventions
adopted: Go uses standard `gofmt`/`snake_case` files, exported `CamelCase`;
JavaScript uses `camelCase`, ES modules, one responsibility per file.

---

## 6. Detailed Design

> Coordinate conventions used throughout:
> - **World/grid coordinates** are integers in *grid units*; they are canonical
>   and are what gets saved. The origin is the design origin.
> - **Screen/pixel coordinates** derive from world coords via the **viewport**:
>   `screen = (world − pan) × scale`, where `scale = PX_PER_UNIT_DEFAULT × zoom`.
> - Snapping a screen point to the grid: `round(screen/scale + pan)`.

### 6.1 Go: `main` (package `main`, `srv/cmd/retrosim/main.go`)
- **Purpose:** entry point; parse flags, build dependencies, bind localhost.
- **Satisfies:** FR-001, NFR-001, NFR-003.
- **Interface (CLI flags):**
  - `--addr` (default `127.0.0.1:8137`) — **must** be a loopback host; reject any
    non-loopback host at startup with a fatal error.
  - `--components-dir` (default: `./components`) — YAML library directory.
  - `--data-dir` (default: the user's documents `retrosim` folder from
    `paths.go`, FR-050) — designs root.
  - `--web-dir` (default: `./web`) — static SPA assets.
- **Behavior:** load library (§6.2) → if zero components, log a warning but
  continue → construct `http.Server` with the router (§6.4) → `ListenAndServe`.
- **Error handling:** invalid/non-loopback `--addr` → exit non-zero with message.
  Missing `--components-dir` → warn, serve an empty palette. Port in use → exit
  non-zero. YAML parse errors → see §6.3 (server still starts).
- **Dependencies:** `components.go`, `api.go`, `paths.go`, std `net/http`, `flag`.

### 6.2 Go: component library loader (`srv/server/components.go`)
- **Purpose:** load and hold the parsed **shared** component library, and scan a
  project's local `components/` types on request; expose both as JSON.
- **Satisfies:** FR-002, FR-005, FR-007, FR-065, FR-121i.
- **Types:** see §7.1 (`ComponentType`, `Pin`, `PinGroup`).
- **Interface:**
  - `LoadLibrary(dir string) (*Library, error)` — read every `*.yaml` in `dir`
    (non-recursive), parse each (§6.3), collect into a `Library` keyed by type
    `id` (FR-066e). Used for the **shared** startup library, loaded **once**
    (FR-007), and — the same routine — for a project's `components/` scan
    (FR-121i), which is re-invoked per request since the server holds no project
    state (FR-121).
  - `ScanProjectComponents(projectDir string) ([]ComponentType, []string)` —
    when `<projectDir>/components/` exists, `LoadLibrary` it and return the parsed
    types plus any per-file warnings (missing dir → empty, no error, FR-121i);
    the API layer merges these over the shared library and posts warnings to the
    tray (FR-074).
  - `(*Library) List() []ComponentType` — stable, deterministic order (sorted by
    `id`) for the palette.
- **Behavior:** for each file, call `ParseComponent`. Duplicate `id`s →
  last-wins with a logged warning. The shared library is immutable after load; a
  project scan is recomputed each time (project-switch and Refresh Types,
  FR-121i). **Merge rule (FR-121i):** the API composes `shared ∪ project`; a
  project-local `id` that collides with a shared `id` is skipped and reported
  (in-app creates already refuse such a collision, FR-007a), so the shared part
  wins and shadowing cannot happen silently.
- **Error handling:** a single file's parse error does **not** abort startup or a
  project scan; the bad file is skipped and logged/reported (file + line +
  reason). `LoadLibrary` returns an error only on an unreadable directory; a
  **missing** project `components/` dir is not an error (FR-121i).
- **Dependencies:** `yamlparse.go`.

### 6.3 Go: YAML parser (`srv/server/yamlparse.go`)
- **Purpose:** convert one YAML file's bytes (YAML — §7.6) into a `ComponentType`.
- **Satisfies:** FR-061, FR-062, FR-062a, FR-062b, FR-062c, FR-062d, FR-062e, FR-063, FR-064, FR-066, FR-066a, FR-104.
- **Interface (the deferral boundary — now bound to the YAML format in §7.6):**
  - `ParseComponent(path string) (ComponentType, error)`
  - The returned `ComponentType` MUST be fully populated for the fields in §7.1.
  - Any **behavioral / GALasm** content MUST be captured verbatim into
    `ComponentType.Behavior` (a single string) and otherwise ignored (FR-066).
  - Unknown keys MUST be ignored (not error) so future additions don't break the
    parser (FR-066). With `gopkg.in/yaml.v3` this means **not** enabling
    `KnownFields(true)`.
- **Behavior:** decode the file with `gopkg.in/yaml.v3` (YAML 1.2 core schema, so
  single-letter scalars like `N`/`Y` stay strings) into an intermediate struct,
  then build and validate the `ComponentType`. The parser validates `type` present
  (a non-empty string, the display name) and resolves the library key `id`
  (FR-066e): the explicit `id:` if given, else derived as `type-` + (`partnumber`
  ‖ `type`) via `deriveComponentID`, so the format stays additive (FR-066) and a
  file without `id:` still loads. Then: every pin has a valid `side` ∈
  {left,right,top,bottom}, integer `pos ≥ 0`, `dir` ∈ {in,out,bidir,tristate};
  pin names are **unique** within the file (duplicates would make saved endpoint
  references like `U3.A0` ambiguous); group names are unique; every pin-group
  member names an existing pin; every pin-group is **geometrically coherent**
  (FR-063a) — all members share one `side`, and no non-member pin lies between
  them on that side (members form a contiguous run by `pos`); every pin `pos`
  fits within the resolved outline
  (left/right pins: `pos ≤ height`; top/bottom pins: `pos ≤ width` — only an
  explicit `outline:` can violate this). An optional `clock: <pin name>`
  (FR-062d) must name an existing pin with `dir: in`; whether the behavior block
  actually *requires* a clock (uses `.R`) is checked client-side at Run time
  (§6.13), since the server keeps the behavior opaque (FR-066). An optional
  `internal: [names…]` (FR-079c) is carried onto the `ComponentType` as a
  string list (`Internal []string` in `types.go`, `yaml:"internal"`), the same
  opaque-carry treatment as `clock:`/`gal:`: the server validates only that each
  name is a non-empty legal signal token, that the list has no duplicates, and
  that no name collides with a pin name (buried nodes and pins share one signal
  namespace); whether each declared node actually has a `.R` equation is checked
  client-side at Run (§6.13), since the behavior stays opaque (FR-066). An optional
  `gal: <device>` (FR-066a) must be one of `GAL16V8`/`GAL20V8`/`GAL22V10`/
  `GAL20RA10`; the server validates only the device **name** and carries it onto
  the `ComponentType` — the dialect it selects (strict vs extended) is enforced
  client-side by the simulator at Run (§6.13), since the behavior block is
  otherwise opaque (FR-066). Power and ground
  pins are **not represented** — there is no `pwr`/`power` direction and such
  pins are simply omitted from the file (and thus from the symbol and the
  simulation). An optional top-level `physical:` block (FR-062e) is carried
  verbatim onto the `ComponentType` (the same opaque-carry treatment as `mem:`)
  for netlist exporters only; when present the parser validates **physical
  completeness**: `pincount` is a positive integer; every signal pin carries a
  `number`; every `power[]` entry has a non-empty `name` and a `number`; the
  signal, power, and `nc` numbers are mutually distinct and together account
  for exactly 1..`pincount`; and no `power[].name` equals a `pins[].name`. A
  violation rejects the component (loader logs and skips, like every other
  validation failure). Nothing else reads the block — it never influences
  outline, pins, groups, or behavior.
- **Outline resolution (FR-062b) — at parse time, in this order:**
  1. if the file states an explicit `outline: [w, h]`, use it;
  2. else derive a default rectangle sized to fit the author-placed pins
     (`width`/`height` = max pin `pos` per side + margin).
  The result is **always concrete** `width`/`height` in the returned
  `ComponentType` (§7.1). After resolving, validate outline dims > 0. There is no
  package mechanism: physical packages, a package-name grammar, and a parametric
  outline/pin-number generator were considered and **removed** (see §8) — outlines
  come from pins (or `outline:`) and physical pin `number`s, if present at all,
  are author-stated optional metadata used by neither drawing nor simulation.
- **Subunit components (FR-062c):** `rendertype` defaults to `unit`; a `unit`
  component is parsed exactly as above. For `rendertype: subunit` the parser
  instead validates: `renderas` ∈ the symbol set (§6.8a); `numunits > 0`; every
  pin carries a non-empty `unit` (and `pos` is ignored, not required); the set of
  distinct `unit` letters equals `numunits`; and each unit holds exactly one
  output (`out`/`bidir`/`tristate`) plus an input count that satisfies `renderas`
  (`mux2`=2 data + 1 select, `mux4`=4+2, `mux8`=8+3 where selects are the `top`
  pins; `not`=1 input; other gates ≥ 1 input). Outline resolution is **skipped**
  for subunits (`width`/`height` left 0 — the symbol module §6.8a owns geometry on
  the client).
- **Documentation fields (FR-104):** the optional `description`, `datasheet`
  (vendor/title/rev/url), and per-pin `desc` keys are decoded and copied verbatim
  into the `ComponentType` (§7.1). They are presentation-only: the parser never
  lets them influence outline, pins, or any validated structure, and applies no
  validation of its own. Absent documentation is normal (FR-066).
- **Error handling:** return an `error` with file + human-readable reason (and
  YAML line where `yaml.v3` supplies one) on any decode or validation failure; the
  loader logs and skips (§6.2). Never panic.
- **Dependencies:** `gopkg.in/yaml.v3`; otherwise std lib.

### 6.4 Go: HTTP API (`srv/server/api.go`)
- **Purpose:** route and handle all REST endpoints; serve static SPA.
- **Satisfies:** FR-001, FR-003, FR-046–FR-053, FR-065, FR-089 (server side),
  NFR-004, IR-001.
- **Versioning (NFR-004):** all API routes are under `/api/v1/`. New capabilities
  (e.g., a future transpiler) get new paths or a new version prefix; existing
  routes never change shape.
- **Endpoints:**

  | Method & Path | Request | Success Response | Errors |
  |---|---|---|---|
  | `GET /api/v1/components?project=<d>` | optional `project` (abs project dir) | `{"components":[ComponentType,…],"warnings":[…]}` — shared library, unioned with the project's `components/` types when `project` is given (FR-121i); `warnings` carries per-file scan reports | 500 on internal error |
  | `POST /api/v1/components` | `{"yaml":"<authored YAML>","project":"<abs project dir>"}` | `{"component":ComponentType}` | 400 bad body / invalid YAML / missing `project`, 409 duplicate `id` or existing file in project `components/` **or** shared library (FR-066e/FR-007a/FR-121i), 500 write failure |
  | `GET /api/v1/defaults` | – | `{"dataDir":"<abs path>"}` | – |
  | `GET /api/v1/files?path=<p>&exts=<e>&manifests=<0\|1>` | query `path` (abs; empty = data dir), optional `exts` (csv, default `json`; the single value `-` lists **directories only**, §6.5), optional `manifests=1` to include `*-manifest.json` files (excluded from listings by default, FR-121a) | `{"path","parent","entries":[{"name","isDir"}]}` | 400 bad path, 404 missing, 403 not a dir |
  | `GET /api/v1/project/info?dir=<d>` | query `dir` (abs project directory) | `{"dir","name","manifestFile","mainDesign","warnings":[…]}` — `manifestFile`/`mainDesign` are `""` when absent; `name` falls back to the folder base name; `warnings` carries the extra-manifest, unparseable-manifest, and dangling-`mainDesign` reports (FR-121a) | 400 bad path, 404 missing, 403 not a dir |
  | `POST /api/v1/project/create` | `{"path":"<abs new project dir>"}` | the created project's info (shape above; fresh manifest, no main design) — FR-121b | 400 bad path / missing parent, 409 path already exists, 500 mkdir/write failure |
  | `POST /api/v1/project/duplicate` | `{"src":"<abs>","dst":"<abs new dir>"}` | the duplicate's info (shape above) — FR-121f | 400 bad paths, 404 `src` missing, 409 `dst` exists, 500 copy failure (partial destination left; the client reports it, FR-121f) |
  | `GET /api/v1/romfile?path=<p>` | query `path` (abs, `.bin`/`.hex`) | raw bytes (`application/octet-stream`), capped at `MaxRomBytes` 64 MiB | 400 bad/!bin·hex, 404 missing, 500 too large |
  | `POST /api/v1/ramfile?path=<p>` | query `path` (abs, `.bin`/`.hex`); raw request body = the file bytes the client formatted (FR-114g), capped at `MaxRomBytes` | `{"path":"<abs>"}` | 400 bad/!bin·hex, 413 too large, 500 write failure |
  | `GET /api/v1/design/load?path=<p>` | query `path` | `{"design":Design}` | 400, 404, 422 malformed JSON |
  | `POST /api/v1/design/save` | `{"path":"<abs>","design":Design}` | `{"path":"<abs>"}` | 400 bad body, 409/500 write failure |
  | `POST /api/v1/file/save` | `{"path":"<abs>","content":"<text>"}` | `{"path":"<abs>"}` | 400 bad body/path, 500 write failure |
  | `GET /api/v1/ping` | – | `{"ok":true}` | – (FR-089 heartbeat; no side effects) |

  Directory entries: subdirectories plus the files whose extension is in `exts`
  (default `.json`; the ROM picker passes `bin,hex`, FR-114e); the response
  includes `parent` so the dialog can offer "up". Files matching the project
  manifest pattern (`IsManifestName`, §6.5a) are filtered out by `handleFiles`
  unless the request carries `manifests=1` (the Open Project picker does,
  FR-121a/FR-121b) — the filter sits in the handler so `ListDir` stays generic.

  The **project endpoints** (FR-121 group) keep the server stateless: no
  open-project state is held; each request carries the project directory and
  delegates to `project.go` (§6.5a). `project/create` makes the directory and
  writes `<base>-manifest.json` (`{"formatVersion":1,"name":"<base>"}`);
  `project/duplicate` copies the source directory recursively, rewriting the
  recognized manifest under the destination's name (§6.5a).

  `POST /api/v1/file/save` writes **verbatim text** — the same absolute-path
  validation and `atomicWrite` as a design save, but no JSON interpretation or
  re-indenting. Added for the C generator's delivery (FR-116: `<design>.c` +
  `runtime.c`/`runtime.h`), which `/design/save` cannot carry: that endpoint
  requires a valid-JSON body (it `json.Indent`s it), fine for `.json`/`.tv` but
  a discovered flaw in §6.17's original "ride the design-save endpoint" plan
  (corrected 2026-07-02).
- **Behavior:** decode JSON, delegate to `storage.go`/`components.go`, encode
  JSON. All responses `Content-Type: application/json`. `GET /api/v1/components`
  returns the shared library, unioned with `ScanProjectComponents(project)` when a
  `project` query param is present (FR-121i, §6.2); its `warnings` carry per-file
  scan reports for the tray. `POST /api/v1/components`
  (FR-007a) parses the submitted YAML through the same `yamlparse.go` path as a
  startup load, requires an authored marker — a non-empty `partnumber` (a GAL part,
  FR-066b) **or** a `mem` block (a memory device, FR-114f) — an immutable
  library-unique `id` (FR-066e), **and** a `project` directory (FR-121i), then
  writes `<id>.yaml` into `<project>/components/` (created if absent; filename
  sanitized from the `id`; reject on `id` collision **or** an existing file of that
  name in **either** the project `components/` **or** the shared library → 409,
  never overwriting), and returns the parsed `ComponentType` so the client can add
  the tile live (the server keeps no per-project in-memory library — the client
  library is the merge, refreshed on project switch and Refresh Types, FR-121i).
  Static handler serves
  `web/` for any non-`/api/` path; unknown SPA routes fall back to `index.html`.
  Static responses carry `Cache-Control: no-store` so a plain browser reload
  always picks up edited SPA assets (localhost-only authoring tool served from the
  source tree — no hard-refresh / DevTools cache toggle needed).
- **Error handling:** consistent error envelope `{"error":"<message>"}` with the
  HTTP status above (`writeStorageError` gains `ErrProjectExists` → 409). No
  stack traces leak to the client; full detail is logged server-side.
- **Dependencies:** `storage.go`, `components.go`, `paths.go`, `project.go`.

### 6.5 Go: storage & paths (`srv/server/storage.go`, `srv/server/paths.go`)
- **Purpose:** filesystem I/O for designs; resolve the default designs dir.
- **Satisfies:** FR-050, FR-051, FR-052, FR-053, FR-055, OQ-006 (resolved).
- **Interface:**
  - `ListDir(path string, exts ...string) (DirListing, error)` — entries +
    parent (FR-053). The single ext value `"-"` is the explicit
    **directories-only** token (no file matches): the New/Duplicate Project
    location prompt uses it (§6.19). Manifest filtering is *not* done here — it
    lives in `handleFiles` (§6.4) so this stays a plain lister.
  - `LoadDesign(path string) (Design, error)` — read+unmarshal (FR-052, FR-055).
  - `SaveDesign(path string, d Design) error` — marshal (indented) + atomic write
    (write temp file in same dir, `fsync`, `rename`) to avoid truncating an
    existing design on failure (FR-046–FR-049).
  - `DesignsDir() (string, error)` — the default designs directory, creating it
    if absent (FR-050): `retrosim` inside the user's documents folder —
    macOS and Linux `~/Documents/retrosim`, Windows
    `%USERPROFILE%\Documents\retrosim` (error if `USERPROFILE` is unset).
    Implemented over `os.UserHomeDir` with per-GOOS handling. (Reworked
    2026-06-12; supersedes `AppDataDir` and its per-OS app-data locations —
    designs are user documents.)
- **Error handling:** wrap OS errors with the attempted path; map to the HTTP
  statuses in §6.4. Refuse to save with an empty/relative `path` (400).
- **Dependencies:** std `os`, `path/filepath`, `encoding/json`, `runtime`.

### 6.5a Go: projects (`srv/server/project.go`)
- **Purpose:** server side of the FR-121 project group: manifest discovery and
  tolerant parsing, project info resolution, project creation, and project
  duplication. Stateless — every function takes the project directory.
- **Satisfies:** FR-121, FR-121a, FR-121b (server side), FR-121f (server side),
  FR-053 (manifest exclusion helper).
- **Interface:**
  - `IsManifestName(name string) bool` — true when `name` ends in
    `-manifest.json`, case-insensitively (consistent with `ListDir`'s
    case-insensitive extension matching). Prefix-tolerant by construction
    (FR-121a): any prefix matches, so a folder renamed outside the app never
    orphans its manifest. Shared by `handleFiles`' listing filter (§6.4) and
    the functions below; mirrored by the client's `isManifestName` (§6.19).
  - `FindManifest(dir string) (file string, extras []string, err error)` —
    non-recursive scan of `dir` for matching filenames; matches are sorted by
    filename, the first is the recognized manifest, the rest are returned as
    `extras` for the FR-121a multiple-manifest report. `""` when none.
  - `ProjectInfo(dir string) (Info, error)` — `Info{Dir, Name, ManifestFile,
    MainDesign string; Warnings []string}` (JSON per §6.4). Stats `dir`
    (missing → 404 mapping, file → 403), runs `FindManifest`, and parses the
    recognized manifest **tolerantly**: decode into `map[string]any`, read
    `name`/`mainDesign` when they are strings, ignore everything else. `Name`
    falls back to `filepath.Base(dir)` when there is no manifest or no `name`
    (FR-121a). A manifest that exists but does not parse degrades to the
    fallback with a warning (never an error). A recorded `mainDesign` whose
    file no longer exists in `dir` is **cleared in the response** with a
    warning (FR-121a's dangling-main rule, checked in one place). `extras`
    become warnings too. The client posts every warning to the message tray
    (FR-074).
  - `CreateProject(path string) (Info, error)` — `path` absolute; the
    directory must **not** exist (`ErrProjectExists` → 409; the parent must
    exist, else 400 via `ErrInvalidPath` wrapping). `os.Mkdir`, then
    `atomicWrite` of `<base>-manifest.json` carrying
    `{"formatVersion":1,"name":"<base>"}` (FR-121a/FR-121b). Returns the new
    project's `Info`.
  - `DuplicateProject(src, dst string) (Info, error)` — `src` must be a
    directory (missing → 404), `dst` must not exist (`ErrProjectExists` →
    409). Creates `dst` and copies `src` **recursively**: every regular file
    byte-verbatim (`io.Copy`; symlinks followed as files — trusted local FS,
    §4.2), subdirectories preserved (`components/` etc. ride along, FR-121).
    The **recognized** manifest (`FindManifest` on `src`) is not copied
    verbatim: it is parsed tolerantly, its `name` set to
    `filepath.Base(dst)`, all other fields (including `mainDesign` and unknown
    keys) preserved, and written as `<base(dst)>-manifest.json` (FR-121f). An
    unparseable recognized manifest falls back to a fresh minimal manifest
    plus a warning in the returned `Info`. **Extra** manifests copy verbatim
    (already a reported anomaly, FR-121a). A mid-copy failure returns the
    error and leaves the partial destination — **no rollback**, per FR-121f;
    the client reports it for manual cleanup.
- **Error handling:** new sentinel `ErrProjectExists` mapped to 409 by
  `writeStorageError` (§6.4); everything else wraps the attempted path and maps
  through the existing table. All manifest-content problems are warnings, never
  failures — a project must stay usable with a broken manifest (FR-121a).
- **Dependencies:** std `os`, `io`, `path/filepath`, `encoding/json`, `sort`,
  `strings`; `storage.go` (`atomicWrite`).

### 6.6 JS: model & netlist (`web/js/model/design.js`, `web/js/model/netlist.js`)
- **Purpose:** the in-browser canonical design and the operations on it; net
  derivation.
- **Satisfies:** FR-011, FR-018, FR-030, FR-034a, FR-034b, FR-037a, FR-043a,
  FR-056–FR-060, FR-059a, FR-060a.
- **Data:** the `Design` object (§7.2), including its **`vertices`** collection
  (§7.1a), and pure helper functions. Mutations are performed **only** by Command
  objects (§6.10), but the low-level operations live here so they are
  unit-testable in isolation:
  - `addInstance(design, type, x, y, rotation) → instance` — assigns the
    `refdes` `U<n>` where `n = max(design.refCounters.U, 1 + max(existing numeric
    suffixes))`, then advances the counter past `n` (FR-011/FR-011c); the
    numeric-suffix scan ignores any trailing unit letter so `U5A` counts as 5.
    The same high-water rule governs every series — `A-<n>`/`N-<n>` here by
    renderType, `X<n>` in `addSubDesignInstance` (§6.14), and the paste remap
    (§6.15) — via one shared allocator (`allocRefNum(design, series)`), which
    also self-heals a hand-edited file whose counter lags the components
    (FR-011c load rule). `refCounters` lives on the design and is persisted
    (§7.2, format v3); it is **never wound back** — not by undo/redo, not by
    `snapshotConnectivity` reverts, not by the FR-024a failure restore (§6.10).
    The `refdes` is the instance's immutable internal identity — the foreign key
    used by vertices (`ref`, §7.1a), bus group-snaps, selection, and persistence
    — and is auto-allocated, never user-edited. The displayed designator is a
    separate, free-form `label` (FR-011b) defaulting to the `refdes`; it is not
    set here (left absent so it lazily falls back to `refdes` on draw) and is
    edited only via `setLabelCmd` (§6.10).
  - `addSubunitPackage(design, type, x, y) → instance[]` (FR-013a/FR-011) —
    allocates **one** U-number and creates `type.numUnits` sibling instances
    `U<n>A`, `U<n>B`, … Each sibling gets a per-unit `typeData` holding only that
    unit's pins (in list order) plus `renderAs`/`unit`, and `width`/`height` from
    the symbol footprint (§6.8a). The units are offset (stacked vertically by
    footprint height + 1) so they do not overlap on drop.
  - `refreshInstance(design, inst, libType) → {ok} | {skip: reason}` (FR-088) —
    replaces `inst.typeData` with a fresh copy of `libType` (for a subunit
    sibling, the per-unit filtered copy, reusing `addSubunitPackage`'s
    per-unit derivation), preserving refdes/position/rotation/wiring and
    `overrides`, and dropping override keys that no longer name a delay or
    declared property. Skips (returns the reason) when `renderType` differs or
    any pin referenced by a `pin` vertex of this instance is absent from the
    new definition (subunits: absent from the same unit) — the wire-endpoint
    contract (§7.1a) must stay intact.
  - `pinWorldPos(instance, pinName) → {x,y}` — applies rotation (§6.7). For
    subunit instances the unrotated pin offset comes from the symbol module
    (§6.8a) keyed by `renderAs`, input count, pin role, and slot index (the pin's
    order among same-role pins of its unit); for `unit` instances it comes from
    `side`/`position` as before. A `pin`
    vertex's position is **derived** from this; when the instance moves or rotates
    its pin vertices are recomputed, so wires referencing them **stretch
    automatically** (FR-018) with no per-segment fix-up.
  - `addVertex`/`removeVertex`, `addWire/addBus` (both reject a degenerate
    conductor whose two endpoints resolve to the **same vertex** — e.g. a wire
    from a pin to itself; the interaction layer additionally ignores a
    same-pin destination click rather than erroring), `insertBend`, `moveBend`,
    `deleteBend`, `branchWire` (creates or reuses a `junction` vertex; if the
    branch point lands on an interior `bend` path-point, that point flips to a
    `node` referencing the new vertex; an unequal-width bus↔bus T-junction records
    the FR-039b alignment `offset` on that vertex), `breakoutBit` (FR-043a: create a
    `junction` vertex on a bus with `bit` set to the chosen lane, and start a
    single-bit wire from it), `danglingEndAt` (FR-034c: find a free, non-snapped
    endpoint vertex within tol of a point that is the end of exactly one conductor,
    returning it with its conductor and width so the tool can target it),
    `joinFreeEnd` (FR-034c: splice the two distinct same-type/equal-width
    conductors meeting at a free vertex into one, the shared point becoming a bend,
    pruning it if collinear per FR-033c; called by `addWire`/`addBus` commands for a
    `vertex` endpoint. An unequal-width bus end-join does **not** splice — it keeps
    both buses and records an FR-039b `offset` junction at the shared vertex), `deleteWire` (decrements junction-vertex ref counts,
    demoting to `free`/deleting per §3.3 G2; prunes all-`free` wires per FR-030),
    `deleteSegment` (FR-033d: cut a conductor at one path edge into two parts,
    promoting a cut `bend` to a `free`-vertex endpoint and keeping a cut `node` as
    is; drop a <2-point part; the two parts inherit width/bitNames and each
    `groupConnection` follows the part keeping its vertex; then `cleanup`),
    `deleteInstance` (converts the instance's `pin` vertices to `free` and drops
    every bus `groupConnection` whose `instance` is the deleted refdes — the bus
    remains, its endpoint dangling (FR-018a) — then runs the FR-030 sweep; for a
    subunit instance it expands to **all** siblings sharing the package U-number
    — FR-018b — as one operation, the confirmation dialog being a chrome-layer
    concern §6.11), `setBusWidth`, `setBusBitNames`, `snapBusGroup`,
    `setOverride`.
- **Netlist (`netlist.js`) — `buildNets(design) → Net[]` (FR-034b/FR-059a/FR-037a):**
  Union-find runs over **bit-lanes**, not raw vertices, so a width-*w* bus
  contributes *w* independent nets (A7). A *lane* is one electrical conductor:
  a wire is 1 lane; a bus `B` is lanes `(B, 0…w-1)`.
  ```
  uf = UnionFind()                              # nodes are lanes
  lane(wire)         = ("wire", wire.id)
  lane(bus, i)       = ("bus",  bus.id, i)

  # 1. plain-wire connectivity: two wires sharing a vertex are one lane
  for each pair of wires sharing a vertex id:  union(lane(w1), lane(w2))
  for each wire pin-vertex pv:                  attach pin pv→ lane(wire)

  # 2. bus group snap (FR-042): bit i ↔ group pin bitMap[i]
  for each bus B, each groupConnection gc on B:
      for i, pinName in enumerate(gc.bitMap):   attach pin gc.instance.pinName → lane(B,i)

  # 3. bus↔bus full junction (no bit index): align lanes by index, or — for an
  #    unequal-width join (FR-039b) — by the junction's alignment offset k.
  for each junction vertex V shared by buses B1,B2 with V.bit == null:
      (wide, narrow) = the wider / narrower of (B1, B2)   # equal → offset 0
      k = V.offset ?? 0                        # wide bit that maps to narrow bit 0
      if k < 0 or k + width(narrow) > width(wide):
          # invalid alignment (only possible in a hand-edited file): warn —
          # never silently minimize — and skip the join.
          warn(invalid bus-join alignment at V); continue
      for i in 0..width(narrow)-1:             union(lane(narrow,i), lane(wide,k+i))

  # 4. breakout (FR-043a): wire taps one bus bit via junction vertex with V.bit set
  for each junction vertex V with V.bit == b shared by bus B and wire W:
      union(lane(W), lane(B, b))

  # 5. shared pins (FR-034b): a pin ties together every lane attached to it
  #    (e.g. a wire ending on U1.A0 plus a bus bit group-snapped to A0)
  for each pin P with attached lanes L1..Ln:
      for i in 2..n:                            union(lane(L1), lane(Li))

  # 6. connector ports (FR-094a/FR-094e, §6.14): within this design, connector
  #    vertices whose port carries the same label are one net (per bit for
  #    width>1). Each connector also attaches its OWN pin to its lane, so the
  #    port pin is a queryable/drivable net member (FR-094e).
  for each connector vertex V (port ref, pin P) with a wire-lane:
      attach pin V.ref.P → lane(V)                        # FR-094e net membership
  for each label L among connector vertices:
      union all lanes attached to connectors labelled L   # per bit when width>1

  groups = connected components of uf
  nets = []
  for each group with ≥1 attached pin:
      pins       = [attached pins in group]
      members    = [wire/bus ids whose lanes are in group]
      provenance = [{bus, bit, name?} for bus-lanes in group]   # FR-060a
      nets.push({pins, members, provenance, name: pickName(provenance)})
  ```
  `pickName` prefers an explicit bus `bitNames[bit]` (FR-037b), else a connected
  pin name, else null. This uses **ids and bit indices only** — never pixel
  coordinates — satisfying FR-059a/FR-060a. (Connector ports are unioned by label
  in step 6, which now **also** attaches each connector's own pin to its net so a
  port is a queryable/drivable member (FR-094e) — a labelled net is still named by
  its label, `labelByRoot` winning over `pickName`; cross-file off-sheet
  continuation, FR-101a, is composed at simulation time, not here — §6.14.)
- **Error handling:** operations validate references (e.g., moving a bend index
  that exists); invalid ops throw and are caught by the Store, which leaves state
  unchanged and surfaces a non-fatal toast.
- **Dependencies:** none (pure JS).

### 6.7 JS: geometry & rotation (`web/js/geometry.js`)
- **Purpose:** grid snapping, viewport transforms, rotation math.
- **Satisfies:** FR-012, FR-015, FR-017, FR-020, FR-021, FR-033c.
- **Collinear-bend pruning (FR-033c):** `isRedundantBend(prev, cur, next)` returns
  true when `cur` lies on segment `prev→next` — cross-product within `EPS` (1e-9)
  **and** within the `prev`/`next` bounding box, so dropping it cannot change the
  drawn shape. `pruneCollinearBends(points)` runs a single left-to-right pass over a
  polyline (endpoints included), comparing each interior point against the last
  *kept* point and the next original point, so a run of collinear points collapses
  fully. `interaction.js` (§6.9) uses these at conductor commit and at bend/segment
  drag-end; the model primitives (`addWire`/`addBus`) are left untouched.
- **Rotation (grid-preserving):** an instance has origin `(x,y)` (its unrotated
  top-left, on the grid) and `rotation ∈ {0,90,180,270}`. A pin's unrotated
  offset `(dx,dy)` (integers, from the pin layout) maps to a rotated offset:
  ```
    0:   ( dx,  dy)      90:  (-dy,  dx)
    180: (-dx, -dy)      270: ( dy, -dx)
  ```
  `pinWorld = (x,y) + rotatedOffset`. Because offsets are integers and 90° turns
  map integers→integers, **pins always land on grid intersections** (FR-021).
  Subunit pins use the same rotation math; their unrotated integer offsets come
  from the symbol module (§6.8a) instead of `side`/`position`, so they too stay
  on the grid (including mux selects, whose bubble is on-grid with a cosmetic stub
  to the sloped edge — FR-013b).
- **Upright labels (FR-012/FR-015/FR-020):** the outline and pin stubs are drawn
  through the rotated transform, but each text label (pin name, refdes, type) is
  drawn **in screen space with identity rotation**, anchored at the label's
  world point transformed to screen. Thus labels never rotate.
- **Dependencies:** none.

### 6.8 JS: Canvas renderer (`web/js/engine/canvas.js`)
- **Purpose:** draw the whole scene; own the render loop and viewport.
- **Satisfies:** FR-012–FR-015, FR-020, FR-021, FR-022, FR-023, FR-036, FR-037,
  FR-068 (simulated indicator states), FR-082 (red conflict nets), NFR-005.
- **Interface:** `init(canvasEl, store)`, `setViewport({pan, zoom})`,
  `setMarquee(rect | null)` (the live rubber-band rectangle + window/crossing
  mode, FR-016b), `requestRender()`. Renders on a `requestAnimationFrame` loop
  **only when dirty** (a render is requested), to meet NFR-005 without busy-spinning.
- **Backing-store sizing:** the device-pixel backing store
  (`canvas.width/height = round(clientSize × devicePixelRatio)`) is kept in sync
  with the element's CSS box by a **`ResizeObserver` on the canvas** (plus the
  `window` resize listener for `devicePixelRatio`-only changes), not by the
  window resize event alone — the canvas shrinks whenever sibling chrome grows
  (e.g. the status bar populating its trays after init) with no window resize,
  which would otherwise leave the backing store stale. Each frame clears the
  **whole backing store in device pixels** (identity transform) before applying
  the DPR scale, so neither a stale size nor the `round()` sub-pixel sliver can
  leave an uncleared bottom strip that accumulates drag-image fragments.
- **Draw order:** grid → buses (thick blue, width annotation `/n` at midpoint,
  FR-036/FR-037) → wires (thin black) → components (outline, pin leads, pin
  labels) → **vertex marks** → **group-snap braces** → upright text labels →
  selection highlight → tool preview (rubber-band polyline — the proposed route,
  §6.9a — plus the prospective group-snap brace, and the placement ghost) →
  marquee rectangle (FR-016b: window mode solid, crossing mode dashed, distinct
  stroke colors). Vertex marks and braces are drawn **after** components (moved
  2026-06-18; previously before) so a component body can never hide a
  connection/dangling indicator that sits on or under it.
- **Vertex marks (`drawVertices`):** a `junction` vertex draws a filled black dot.
  A `pin`/`connector` vertex with **two or more** conductor path-ends on it
  (fan-out, FR-034a) draws the same dot at each pair of ends' **branch point**
  (FR-034d): the two paths, oriented outward from the pin, are walked together
  (`branchPoint`) while their segment directions coincide, advancing by the
  shorter leg; the divergence point gets the dot. Ends arriving from different
  directions diverge at the pin itself and dot at its visual attachment point
  (`pinVisualPos`, FR-013d — where the wire ends are drawn to meet); ends
  sharing a collinear run dot at the visible T instead. Pairwise for ≥ 3 ends,
  coalescing duplicates. The ends are gathered from every wire's and bus's
  first/last path point. (Added 2026-07-19; branch-point walk added same day —
  the unconditional attachment-point dot landed mid-run when ends overlap.)
  A `free` vertex draws a red hollow "dangling" square (FR-029) **unless** it is a
  bus endpoint named by some bus's `groupConnections` (group-snapped, FR-042), in
  which case it draws nothing — its group-snap brace (below) is its indicator and
  it must not show the dangling mark. The group-snapped set is built the same way
  the §6.6 cleanup sweep builds its `snapped` set.
- **Group-snap braces (`drawBusBraces`, FR-042a):** for each bus `groupConnection`
  the renderer recomputes the brace from the bound instance + the connection's
  **claimed pins** via `busGroupBrace(inst, gc.bitMap)` — a sub-range of the group
  for a partial connection, the whole group for an equal-width one (FR-041c). The
  two tips sit at the claimed block's outermost pins' visual positions and the apex
  is anchored at the **block's middle pin's grid point** (`floor(k/2)`, `k` = block
  size), `BUS_BRACE_DEPTH` (integer) grid units outward — strokes it as two cubic
  Béziers meeting at the apex in a point (`strokeBrace`). Anchoring on a real middle
  pin keeps the apex on a grid intersection for an even pin count (the halves are
  then asymmetric), so the bus endpoint placed there is on-grid too. Because that
  endpoint follows the component (FR-018c), the bus terminates exactly at the brace
  point. The live bus-drag preview reuses the same helper for the pack-low block of
  the accepting group nearest the cursor (§6.9).
- **Component drawing dispatches on `renderType`:** a `unit` instance draws the
  rectangle path as today; a `subunit` instance draws its schematic symbol via the
  symbol module (§6.8a) — the gate/mux outline path plus an upright refdes (e.g.
  `U5A`). The grid-point/stub rule is common to both paths (FR-013/FR-013b). A
  `unit` instance (built-ins included) draws the FR-013 connection lead — a short
  outward segment from each `pinWorldPos` to `pinVisualPos` (0.5 grid out). A
  `subunit` instance draws no resting lead (FR-013c); instead, when that
  subunit is hovered (`state.hover`) or selected, the common path draws a short
  tick as an outward lead along the pin axis from the pin's grid point. In
  both paths an inverting output's bubble is owned by the symbol
  (`pinHasOwnBubble`, §6.8a), so the common path draws neither a lead nor a tick
  there. For subunit symbols the common path anchors each pin's
  upright name label to the body outline (`pinLabelEdge`, §6.8a) rather than the
  pin point, so stubs never bisect labels.
- **Unit pin-label placement (FR-015a):** for a `unit` instance the pin name is
  edge-anchored rather than centered on an inward-nudged point. The renderer picks
  the label's `textAlign`/`textBaseline` from the rotated outward direction (`outR`)
  so the text hugs its border edge — left-align inside a left edge, right-align
  inside a right edge, top/bottom baselines for horizontal edges — and offsets the
  anchor one small fixed pixel margin inward from the pin's screen point. Because
  the text then grows toward the body center, the gap to the border is constant
  regardless of name length and short names are not pushed inward. Alignment is set
  per pin and the labels stay upright/screen-space (FR-015). Subunit labels keep the
  centered inward-nudge off `pinLabelEdge`.
- **Text note (`note` renderType, FR-071f):** `drawComponent` gains a `note`
  branch (`drawNote`) drawing the note's `inst.text` line-broken on its embedded
  newlines. An outline box over the instance's auto-sized footprint —
  `width`/`height` recomputed in whole grid units from the wrapped text (a small
  minimum when empty) — is drawn **only when the note is selected or being edited**
  (dashed **blue** at rest-selected, solid when editing); at rest, unselected, only
  the text is drawn, with no box. Unlike every other instance the note draws **no
  refdes/type label and no pins/bubbles** (FR-011a/FR-012 exemptions). The text
  (and the box when shown) is emitted in the instance's local grid frame and
  projected through `rotateOffset`, so it turns with the instance (FR-071f rotation
  exception); the text is **not** re-uprighted the way pin/refdes labels are.
  While the note is the active text-entry target, the renderer **skips it
  entirely** — a DOM `<textarea>` overlay (§6.9) covers it — so the canvas never
  draws the note that is being edited; on commit the overlay is removed and the
  note draws normally again. The renderer knows the editing note from a transient
  `editing` refdes set via `setEditingNote` (§6.9).
- **Wire attachment drawing (FR-013d):** wire/bus *endpoint* segments and the
  rubber-band preview draw to the pin's visual attachment point —
  `pinVisualPos` (model/design.js): the lead's outer end (grid point + 0.5 grid
  outward along the pin side, rotation-aware) for lead pins, the plain grid point
  for subunit pins. Drawing only: path vertices keep the on-grid pin coordinate
  (FR-021/FR-059), so saves, netlist, and hit-tested wire geometry are
  unchanged.
- **Grid (FR-021):** draw grid dots/lines only when `scale` is large enough that
  spacing ≥ a threshold (e.g., 6 px); otherwise draw a coarser grid to avoid
  moiré and cost.
- **Simulation display (§6.13):** when the transient `state.sim` view is present,
  the indicator render branch draws its glyph from `sim.valueOfPin(refdes, "IN")`
  — `1` → white bubble/black "1", `0` → black bubble/white "0", U or Z → the gray
  "?" (FR-068) — and any wire/bus whose conductor is in `sim.conflictedConductors`
  strokes red instead of black/blue (FR-082). The view is retained after a run
  terminates, so final values stay visible until the store clears `state.sim` on
  the next design edit (FR-085).
- **Error handling:** rendering is read-only over the model; a malformed instance
  (e.g., unknown type) is drawn as a red placeholder box with the type name, never
  throwing out of the loop.
- **Dependencies:** `geometry.js`, `engine/symbols.js` (§6.8a), model (read-only),
  store (subscribe).

### 6.8a JS: schematic symbol geometry (`web/js/engine/symbols.js`)
- **Purpose:** the single source of truth for subunit symbol geometry, in grid
  units, shared by the model (pin positions, §6.6), the renderer (§6.8), and
  hit-test (§6.9) so they cannot drift apart.
- **Satisfies:** FR-013a, FR-013b, FR-014a.
- **Interface (pure functions, no rendering state):**
  - `symbolFootprint(renderAs, nIn) → {width, height}` — grid-unit bounding box.
  - `pinSlotOffset(renderAs, nIn, role, slotIndex) → {x, y}` — unrotated grid
    offset from the instance origin for the `slotIndex`-th pin of role
    `in`\|`out`\|`sel`. Every returned offset is integer (on-grid).
  - `drawSymbol(ctx, renderAs, nIn, instance, vp)` — strokes the gate/mux outline,
    any mux select stubs, the inverting-gate inversion bubble + output stub, and
    OR-family input stubs (connection marks — unit leads or subunit hover/select
    ticks per FR-013/FR-013c — are drawn by the common pin path in §6.8, except for
    the inverting output, whose bubble the symbol owns).
  - `pinHasOwnBubble(typeData, pin) → bool` — true for an inverting gate's output:
    the symbol's inversion bubble is that pin's single connection mark, so §6.8
    must not draw a second one (no extra bubble and no hover/select tick, FR-013c).
  - `pinLabelEdge(typeData, pin) → {x, y}` — grid point on the body outline from
    which the pin's upright name label hangs (§6.8 nudges a few px inward). Anchors
    to the body, not the pin point, so stubs never bisect the label.
- **Geometry (representative; tuned in code):** gates are width 4, height
  `2·nIn`, inputs on rows `1, 3, …`, output centered on the right edge; `not`
  width 3. Inverting gates (`nand`/`nor`/`xnor`/`not`) carry one inversion bubble
  tangent to the tip with a short stub out to the on-grid output pin; that bubble
  is the connection point (no separate pin bubble). OR-family gates
  (`or`/`nor`/`xor`/`xnor`) have a concave back, so each input pin point on the
  left edge gets a short stub to the back curve. Multiplexers draw as a trapezoid
  whose long left side has height `nData+1` (data inputs on rows `1..nData`),
  short right side carries the centered output, top/bottom edges slope toward the
  right, and select bubbles sit on their grid point on the top with a short stub
  to the sloped edge (FR-013b).
- **Dependencies:** `geometry.js`.

### 6.9 JS: interaction / tool FSM (`web/js/engine/interaction.js`, `hittest.js`)
- **Purpose:** translate pointer/keyboard events into Commands; hit-testing.
- **Satisfies:** FR-008–FR-010, FR-016–FR-019, FR-025, FR-026–FR-034, FR-027b,
  FR-027c (with §6.9a), FR-033c, FR-038–FR-043a, FR-039a.
- **Tools / states:** `SELECT` (default, FR-004), `PLACE(type)` (transient, set by
  palette click), `WIRE`, `BUS`. The FSM also has transient sub-states for
  in-progress gestures (e.g., `WIRE_AWAIT_DEST`, `DRAGGING_BEND`,
  `DRAGGING_COMPONENT`, `DRAGGING_BUS_ENDPOINT`, `MARQUEE`).

  | State | Event | Action → Command | Next state |
  |---|---|---|---|
  | SELECT | hover pin | show wire cursor (FR-027b) | SELECT |
  | SELECT | click pin | begin wire at pin, auto-arming WIRE from select (FR-027b) | WIRE_AWAIT_DEST |
  | SELECT | click component | select it, replacing the selection (FR-016) | SELECT |
  | SELECT | shift-click object | toggle it in the selection (component/wire/bus, FR-016a) | SELECT |
  | SELECT | drag selected component | `MoveComponent` for each selected component (snap, stretch connected segs FR-018) + `TranslateWiring` for the interior wiring of the moving set (FR-018c) **and the non-pin vertices of any explicitly selected conductor segments** (FR-018d), as one `composite` | SELECT |
  | SELECT | press Delete on selection | `DeleteComponent`/`DeleteWire`/`DeleteBus`/`DeleteSegment` per selected ref kind (FR-018a/FR-033a/FR-033d/FR-016a), as one `composite`; the conductor deletes are queued with `{ifPresent: true}` — an earlier delete's cascade (FR-029/FR-030) may already have removed a selected conductor by apply time, which must skip, not fail the whole composite (FR-024a) | SELECT |
  | SELECT | press `r` on selection | one `RotateSelection` turning every selected component, the interior bends/junctions (FR-018c), **and the non-pin vertices of any explicitly selected conductor segments** (FR-018d) rigidly about a single grid-snapped pivot (FR-019/FR-016a) | SELECT |
  | SELECT | click wire/bus segment | select that **segment** (`{kind:"segment", id, segIndex}`), replacing the selection (FR-031) | SELECT |
  | SELECT | drag from wire/bus segment | `InsertBend` at nearest grid pt, the new bend dragging until release (FR-031) | DRAGGING_BEND |
  | SELECT | drag bend point | `MoveBend` (rubber-band FR-032) | DRAGGING_BEND |
  | SELECT | right-click bend | context menu → `DeleteBend` (FR-033) | SELECT |
  | SELECT | right-click bus | context menu → `SetBusWidth` (FR-038) | SELECT |
  | SELECT | right-click bare canvas | recenter view on the cursor's world point + arm pending zoom anchor at canvas center (FR-023b) | SELECT |
  | SELECT | press bare canvas | begin rubber-band; snapshot pre-drag selection (FR-016b/FR-023a) | MARQUEE |
  | SELECT | release bare canvas (no drag) | clear selection (Shift preserves) (FR-023a) | SELECT |
  | MARQUEE | drag | window (drag right) or crossing (drag left) hits; live-update selection (replace, or Shift-add to the snapshot) (FR-016b) | MARQUEE |
  | MARQUEE | release | commit the live selection (FR-016b) | SELECT |
  | MARQUEE | Esc | cancel; restore the pre-drag selection (FR-016b) | SELECT |
  | PLACE(t) | click canvas | `PlaceComponent(t,@grid)` (FR-009) | SELECT (one-shot FR-010) |
  | (palette) | drag tile→canvas drop | `PlaceComponent(t,@grid)` (FR-008) | SELECT |
  | WIRE | click pin | begin wire at pin | WIRE_AWAIT_DEST |
  | WIRE | click existing segment | begin **branch**: create/reuse a `junction` vertex at the nearest grid pt, splitting that point of the host path into a `node` (FR-034) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | click pin/segment (real target) | `AddWire(a,b,bends)` — `bends` = the concatenated per-leg route corners with the locked waypoints between legs (`legBends`, FR-027/FR-027c/FR-027e, FR-034a/b) | SELECT (FR-028) |
  | WIRE_AWAIT_DEST | click bare canvas | lock a **waypoint** at the nearest grid pt; the router re-inits from it for the live leg (FR-027e) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | Backspace | pop the most-recent locked waypoint (FR-027e) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | Esc | cancel the in-progress conductor (`setTool("select")`) | SELECT |
  | BUS | (same as WIRE; an empty-canvas click locks a waypoint and no longer ends the bus at a free point — FR-027e) | `AddBus(...)` | SELECT (FR-040, A6) |
  | BUS | drag endpoint onto component | snap-connect (FR-041–043, §below) | SELECT |
  | BUS | drag endpoint onto another bus | join if equal width; else **reject** (FR-039a) | SELECT |
  | WIRE | click a bus segment (no source yet) | **breakout**: prompt bit index, create `junction` vertex with `bit` set, begin 1-bit wire (FR-043a) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | click a bus segment | **breakout (terminate)**: prompt bit index, create `junction` with `bit` set, commit a 1-bit wire from the source along the drawn route (FR-043b); cancel keeps drawing | SELECT (FR-028) |

- **Hit-testing (`hittest.js`):** in world space — components are rectangles
  (their rotated bounding outline); pins use the FR-013d hot region: a circle
  of radius 0.7 grid units centered on the pin's visual attachment point
  (`pinVisualPos`), with the **nearest** pin winning when nearby pins' regions
  overlap (pins sit 1 grid unit apart, so any tolerance > 0.5 overlaps);
  wire/bus segments use point-to-segment distance, and bend points are points.
  Their pick tolerance is a constant in **screen pixels** (≈6 px for segments,
  ≈8 px for bends so a bend keeps priority over the segment it sits on),
  converted to world units at the current zoom (`tol = px / scaleFor(viewport)`,
  in `interaction.js`), so the catch band stays a comfortable, zoom-independent
  size; a world-unit tolerance instead shrinks to a sub-pixel target when zoomed
  out. (The pin hot region, FR-013d, is a world-unit 0.7-radius circle — its
  size is tied to the 1-grid-unit pin pitch, not the cursor — except for the
  **select-mode** FR-027b hotspot, which caps it at
  `min(PIN_HIT_TOL, PIN_PICK_PX / scaleFor(viewport))`, `PIN_PICK_PX ≈ 12 px`
  in `interaction.js`, so at high zoom the hotspot shrinks in world terms and a
  1-grid-unit wire stub off a pin stays selectable; wire/bus-drawing pin
  snapping keeps the full 0.7. Added 2026-07-19.) `junction`/`free`
  vertices are points. When targets overlap, pins take priority over
  segments, and segments over component bodies.
  `marqueeHits(design, world0, world1, mode)` returns the selection refs for a
  rubber-band (FR-016b): **window** mode (`mode === "window"`) keeps objects whose
  whole extent is inside the rectangle — a component's bounding box, or all of a
  wire/bus path's world points; **crossing** mode keeps any object the rectangle
  intersects or encloses (bbox overlap; segment-vs-rectangle intersection).
- **Wire-mode cursor (FR-025/FR-027b):** the wire cursor is a short diagonal
  line **centered on the pointer** with a small open dot at its midpoint
  marking the active point; the hotspot is the image center. Supplied as an
  inline SVG data-URI so no asset file or server MIME mapping is needed. A
  symmetric glyph with a center hotspot keeps the visible aim point and the
  true active point coincident — including under cursor scaling, which
  preserves the center — so a rubber band anchors exactly where the glyph says
  it will. (Reworked 2026-06-11; supersedes both the tip-at-origin design and
  the original (5,5)-endpoint hotspot: any glyph whose visible mass sits off
  to one side of its active point reads as a "jump" the moment a rubber band
  exposes the true point.) It is set while `WIRE` is active, and in `SELECT`
  while the pointer is over a pin (a wire hotspot, FR-027b). `BUS` keeps a
  crosshair; `SELECT` off any pin uses the default pointer. **Select-mode wire
  start:** clicking a pin in `SELECT` (pins take hit priority over component
  bodies, so the click does not select/drag the component) arms `WIRE` from that
  pin — reusing the WIRE machinery (rubber-band preview, destination click,
  one-shot return to `SELECT` per FR-028) rather than duplicating it.
- **Route preview (FR-027a/FR-027c):** while a wire/bus awaits its destination,
  each mousemove calls the router (§6.9a) from the preview anchor
  (`previewAnchorWorld`, the FR-013d visual attachment point) to the snapped
  cursor and hands the resulting polyline to `renderer.setPreview`; a `null`
  result falls back to the straight two-point segment, preserving the original
  FR-027a behavior. The destination click passes the *current* proposal's
  interior corners to `AddWire`/`AddBus` as initial bend points — thereafter
  they are indistinguishable from manually inserted bends (FR-031–FR-033).
- **Locked waypoints (FR-027e):** the FSM holds `wireWaypoints` (an array of
  grid points) alongside `wireSource`, cleared by `resetInteraction`. While a
  conductor is in progress, an empty-canvas click (`wireTargetAt` → `null` for
  wires; `busTargetAt` → `kind:"free"` for buses) pushes a waypoint instead of
  completing; Backspace pops the last one; Esc clears all. The preview is the
  **locked legs** (`source→waypoint₁→…→last`, recomputed but visually fixed) plus
  the **live leg** from the last waypoint to the cursor — each leg routed
  independently by `proposeRoute` (a free waypoint carries no escape), assembled
  by `legPolyline`/`lockedLegPoints`/`concatDedup`. On commit, `legBends` returns
  the concatenation of every leg's interior corners with the waypoint coordinates
  inserted between legs, so the waypoints land as ordinary bend points. A
  conductor completes only on a real target; a bus can no longer end at a free
  point on an empty click (it may still *start* free). The commands and save
  format are unchanged — waypoints are just additional interior bends.
- **Join on a dangling end (FR-034c):** before the segment/branch check, both the
  start and completion paths — the wire-tool **start** handler, and the completion
  resolvers `wireTargetAt`/`busTargetAt` (the bus start runs through `busTargetAt`
  too) — call `danglingEndAt(design, pt, tol)` (§6.6) to detect a click on an
  existing **free, unconnected** endpoint of the **same conductor type** (and, for
  the bus tool, the same width); a hit returns a `kind:"vertex"` source/target
  carrying that vertex id (and the bus width), so no `junction` is created. The bus completion handler rejects a width-mismatched
  vertex target with the FR-039a toast, mirroring its bus↔bus branch check. After
  `addWire`/`addBus`, the command calls `joinFreeEnd(design, vertexId)` (§6.6) for
  any `vertex`-kind endpoint: when that vertex is now a free, non-snapped end
  shared by exactly two **distinct same-type** conductors (equal width for buses),
  it splices their paths into one — the shared point becoming an interior bend —
  removes the vertex, and prunes the join bend if collinear (FR-033c). The result
  is one conductor with no junction and no dangling mark. (Scoped to the
  completion commands, not global `cleanup`, so deleting a component that leaves
  two wires on a shared pin does not silently merge them.)
  Breakout taps (FR-043a) are excluded: they keep the straight preview and the
  two-point commit (`breakoutBitCmd` carries no bends), so their preview never
  promises a route the commit won't produce. (Reworked 2026-06-12; supersedes
  the straight-line-only preview and two-point commit.)
- **Collinear-bend pruning (FR-033c):** redundant, non-bending bend points are
  removed at three points, all using `geometry.js`'s `isRedundantBend` /
  `pruneCollinearBends` (§6.7). (a) *Conductor commit:* `prunedLegBends(stops)`
  rebuilds the full polyline (resolved source/target coords plus `legBends`),
  prunes it, and returns the surviving interior bends; it feeds every commit path —
  `AddWire`, `AddBus`, and the terminate-on-bus breakout (`breakoutBitCmd`,
  FR-043b) — so collinear routed corners and straight-line waypoints (FR-027e)
  never commit as bends, folded into the single creation command. (The start-on-bus
  breakout, FR-043a, commits straight with no bends and is unaffected.)
  (b) *Bend drag-end:* if the dragged bend's final position is collinear with its
  path neighbours, the mouseup dispatches `DeleteBend` instead of `MoveBend`
  (undo restores it). (c) *Segment drag-end:* if the released point is collinear
  with the host segment's endpoints, the live preview bend is dropped and **no**
  command is dispatched. Buses share these paths (FR-039). Previously-saved
  conductors are not retroactively swept.
- **Bus snap-connect (FR-041–FR-043a, A3/A7):** an endpoint targets a pin group
  one of two ways (`busTargetAt`, priority: bus segment > nearby group > body):
  Group **acceptance** is design-aware (FR-041/FR-041c): for an instance + group,
  `groupFreeBlock(design, refdes, group, width)` scans the group's pins in declared
  order, excludes pins already claimed by existing `groupConnections` on that
  instance+group (across all buses), and returns the **pack-low** block — the first
  `width` pins of the lowest contiguous free run of length ≥ `width` — or `null` if
  none fits. `groupsAcceptingBus(design, inst, width)` returns `[{group, block}]`
  for the groups that fit. Both the proximity and body paths key off these.
  - **Proximity (FR-042b):** `busGroupAt(world, width)` returns the accepting group
    nearest the cursor within `GROUP_SNAP_RANGE` of its **block's** pins or brace
    apex — no body click required. This yields a `kind:"group"` target naming that
    group **and its claimed block**, so it snaps directly (no dialog) with the
    endpoint at the block's brace apex. The same helper drives the live brace
    feedback, so a click wherever the brace shows starts/ends the bus there.
    `width == null` means **any width** (the block is the group's whole pack-low
    free run): the first-endpoint feedback and click pass `null` (the bus has no
    committed width yet, FR-042c), so a fresh bus shows feedback for — and adopts
    the free-block width of — the nearest group. Once the first endpoint fixes the
    width, the second endpoint passes that width and acceptance is by free block of
    that exact size (FR-041c). When the in-progress bus's source endpoint is a group
    snap (`wireSource.kind === "group"`), `updateWirePreview` also recomputes that
    source group's brace each frame and includes it in the preview so the
    originating connection stays drawn for the whole drag, independent of the
    cursor-near destination brace (FR-042b); `drawPreview` strokes both.
  - **Body click (FR-041):** falling back to the component body, compute the
    accepting groups via `groupsAcceptingBus`: **0** → leave the endpoint
    **unconnected** (FR-043); **1** → snap automatically to its block; **≥2** → open
    the **disambiguation dialog** (§6.11), choose by name (cancel → unconnected,
    FR-041b). Within one group the pack-low block is the single placement, so the
    dialog never disambiguates positions.
  A snap stores a `groupConnection` whose `bitMap` is the claimed block (bit *i* →
  `block[i]`, FR-042) and, if the bus has no `bitNames`, adopts that block's pin
  names (FR-037b). The snapped endpoint is placed at the block's brace apex
  (`busGroupBrace`, §6.8/FR-042a). `snapBusGroup` recomputes the pack-low block from
  current design state, so it matches what the feedback showed and sequential snaps
  in one commit pack correctly.
- **Breakout (FR-043a/FR-043b):** in WIRE mode, clicking a **bus** segment creates a
  `junction` vertex on that bus with `bit` = the chosen lane (the `chooseBitDialog`
  picker, labeled with `bitNames` when present) and a single-bit wire tying it into
  exactly that bit's net via the §6.6 lane union. This works in **both directions**:
  - As the **first** click (no `wireSource`), `startBreakout` arms a `breakout`
    wire source and the next click takes the destination — committed **straight**
    (`breakoutBitCmd` carries no bends), matching the deliberately straight preview
    (§6.9 below).
  - As the **terminating** click of an already-in-progress wire (FR-043b): the wire
    click handler hit-tests a bus segment (priority pin > bus > wire-branch, mirroring
    the start priority) *before* `wireTargetAt`, since `wireTargetAt` does not detect
    buses. On a bus hit it awaits `chooseBitDialog`, then dispatches `breakoutBitCmd`
    with the in-progress `wireSource` as the breakout wire's far endpoint and the
    drawn route's bends (`legBends([wireSource, …waypoints, busPoint])`, **reversed**
    because `breakoutBit` builds the path junction→dest). Honoring the bends keeps the
    commit faithful to the routed preview the user already sees; cancelling the dialog
    leaves the wire in progress. `breakoutBitCmd` resolves a `branch` far endpoint
    through `resolveSpec` (a pin/free/vertex endpoint passes through unchanged).
- **Width-mismatch guard (FR-039a):** a gesture that would join two buses of
  unequal width is rejected at drop time with a non-fatal toast; no command is
  dispatched. *Snap-connect, breakout, and bit-names may be deferred from the MVP
  per requirements; the model and save format support them regardless (A7).*
- **Simulation lock (FR-087):** while `store.state.simulating` the FSM accepts
  only pan, zoom, and hover; gestures that would dispatch a command — drags,
  deletes, wire/bus starts (including pin hotspots), placements — and palette/tool
  arming are ignored, as is the context menu's mutating items. Selection is locked
  too: a left-click that would select a wire, bus, or component instead posts the
  status-bar message "Editor is locked while the simulator is running" via
  `postMessage` (§6.11, `chrome/statusbar.js`) and leaves the selection unchanged;
  a bare-canvas click is ignored silently (no marquee, no message). The sole
  exception is a click on an **interactive built-in** (FR-087b): if the hit
  component's type has an `INTERACTIONS` handler (§6.11), the FSM applies it via
  `store.applyLive(() => INTERACTIONS[type](inst))` — a non-undoable live change
  that marks the design modified and wakes the simulator (§6.10) — instead of
  reporting the lock. The switch's handler toggles `switchState` 0↔1 (FR-087a).
  (Reworked 2026-06-17; supersedes selection remaining available during a run.)
- **Note text-entry mode (FR-071f):** editing a note overlays a real DOM
  `<textarea>` on the page, positioned over the note, and lets the browser handle
  the caret, text selection, and clipboard natively (DQ-001, §12). A SELECT-mode
  sub-state, `editingNote`, holds the note's refdes and the live textarea element.
  It is entered two ways: automatically when a `note` built-in is placed (the
  one-shot placement ends in this mode rather than plain SELECT), and by a
  **double-click** whose hit-test lands on a placed note. On entry the FSM creates
  the textarea (value = `inst.text`, caret at end), focuses it, and tells the
  renderer to **hide the canvas note** while editing (§6.8) so only the overlay
  shows; the overlay is placed at the note's screen position (`worldToScreen` +
  the canvas's client rect) and sized/styled from the note layout constants
  (`NOTE_PAD/NOTE_LINE/NOTE_FONT × scale`) to approximate the canvas text. The
  overlay is drawn **unrotated regardless of the note's rotation** — rotation of
  the editing overlay is deliberately out of scope (DQ-001, §12); the committed note
  still rotates normally (§6.8). The textarea owns keystrokes: **Shift+Enter**
  inserts a newline (native), **Enter** (no shift) commits, **Escape** commits,
  and a blur (click outside) or any tool switch commits. Commit reads the
  textarea value, removes the overlay, un-hides the canvas note, and dispatches a
  `setNoteText` command (§6.10) only when the text changed (recomputing the
  auto-sized footprint, FR-071f). The global keydown handler ignores events whose
  target is the textarea (as it already does for input fields), so editor
  shortcuts never fire mid-edit. Text-entry mode is unavailable while a simulation
  runs (the editor is locked, above), consistent with other design edits.
- **Error handling:** clicks on empty space in WIRE/BUS state are ignored (no
  partial wire). A gesture that would create a zero-endpoint wire is discarded
  (FR-030). Pressing `Esc` cancels an in-progress gesture, restoring SELECT.
- **Dependencies:** `geometry.js`, `hittest.js`, store, model.

### 6.9a JS: Manhattan route proposal (`web/js/engine/router.js`)
- **Purpose:** propose a Manhattan route for an in-progress wire/bus so the
  rubber-band preview (and the committed path) loops around components instead
  of rat's-nesting under them — notably when wiring a component's output back
  to one of its own inputs.
- **Satisfies:** FR-027c, FR-027d (and the routed forms of FR-027/FR-027a); NFR-005.
- **Interface (pure function, no rendering or store state):**
  - `proposeRoute(design, from, to) → [{x,y}, …] | null` — grid-unit world
    coordinates from `from` to `to` inclusive; interior points are the proposed
    corners. `from`/`to` carry an optional `escape` direction (a unit vector)
    when the endpoint is a pin: the route's first/last step must leave the pin
    in its facing direction, away from the component body (rotation-aware).
    Returns `null` when no route is found — the caller falls back to the
    straight line (FR-027c).
- **Algorithm:** A* over grid cells restricted to the bounding box of
  `from`/`to` plus a fixed padding (a few grid units, enough to loop around an
  endpoint's own component). Obstacle cells are the rotated bounding outlines
  of all component instances (the same rectangles hit-testing uses, §6.9), so
  routes never pass under a body; the route's own endpoints are always
  traversable so a pin on a body edge can escape. In addition (FR-027d), the
  segments of every existing wire and bus are decomposed into unit grid *edges*
  and collected into an occupied-edge set (keyed by the canonical ordered pair
  of the edge's two grid points); the A* neighbour expansion skips any step
  whose edge is in that set. Edge occupancy — not cell occupancy — is what makes
  crossings legal: two transverse conductors share a grid *vertex* but no edge,
  so a crossing is never blocked, while two collinear conductors share edges and
  are. Shared endpoints (fan-out at a pin, a branch junction) likewise share
  only a vertex and stay permitted. The route's own `from`/`to` endpoints (and
  their forced escape edges) are exempt so a wire can still leave a pin that
  already carries another wire. **Occupied corners (FR-027d):** in addition, the
  interior *corners* of every existing wire and bus are collected into an
  occupied-corner set, and the neighbour expansion forbids any step that would
  introduce a *turn* at one of those grid points. Two coincident bends carry no
  connection dot yet read as a junction; a straight pass-through such a point is
  already barred by the edge rule (it reuses one of the corner's arms), so only a
  turn there need be blocked. Like the edge constraint this is hard, so a route
  that would require a coincident corner degrades to the straight fallback. The
  cost function charges 1
  per step plus a turn penalty (≈ 5 steps per corner) so the search prefers
  few-bend routes over shortest-but-jagged ones; ties break toward the
  destination. The search-space bound, not the design size, caps the work: a
  few thousand cells per call, well under a millisecond — recomputing per
  mousemove stays inside the rAF render budget (NFR-005).
- **Post-processing:** collinear interior points are merged so the returned
  polyline's interior points are exactly the corners that become bend points
  on commit.
- **Error handling:** never throws on unreachable targets or degenerate input
  (zero-length, off-grid endpoints snapped by the caller); all failure modes
  return `null`.
- **Dependencies:** `geometry.js`, model (read-only). No store, no canvas —
  fully unit-testable as pure geometry.
- **Deferred (FR-027d scope boundary):** the occupied-edge constraint applies
  only to routes proposed at draw time. It does *not* re-validate after manual
  edits — dragging a bend (FR-031/FR-032) or moving a component (FR-018) can
  still drop a segment onto another. Enforcing the no-overlap invariant during
  those edits (live validation on drag, plus a chosen resolution — reject the
  drop, nudge off the conflicting edge, or warn) is a larger interaction-layer
  change left as a follow-up; it is not part of the router and is out of scope
  for the current change.

### 6.10 JS: store, commands, undo/redo (`web/js/store.js`)
- **Purpose:** single source of truth and the only mutation path; undo/redo;
  dirty tracking; pub/sub.
- **Satisfies:** FR-024, FR-049a, FR-121c (the no-project lock), NFR-006.
- **State:** `{ design, tool, selection, hover, viewport, dirty, savePath, designName,
  simulating, sim, vectorPanelOpen, project }`.
  `project` (FR-121, §6.19) is the client-held **current project**: `null` or
  `{ dir, name, manifestFile, mainDesign }`, set via a notifying
  `setProject(p)`. Transient session state, never persisted (the server holds
  no open-project state). While `project` is `null` the design is the inert
  FR-004 placeholder (§3.1 A8): `blocked()` — the same refusal mechanism as
  the simulation lock (FR-087) — additionally refuses `dispatch`/`undo`/`redo`
  with a tray report naming the cause ("no project is open — use File ▸ New
  Project or Open Project"). `isReadonly()` is unchanged (it reports only the
  sim/vector locks); chrome reads `state.project` directly for item enablement
  (§6.11).
  `hover` is the refdes of the component currently under the cursor (or `null`),
  used only to show subunit connection ticks (FR-013c). It is transient UI state:
  set directly by the interaction layer with a plain renderer re-render, never
  through the command/undo path, and not persisted.
  `selection` is an array of selection refs (`{kind:"component",refdes}`,
  `{kind:"wire",id}`, or `{kind:"bus",id}`); an empty array means nothing is
  selected. It may hold multiple objects of any mix of kinds (FR-016a). The store
  exposes `setSelection(arr)`, `toggleSelection(ref)`, and `isSelected(ref)`; it is
  transient UI state, set outside the command/undo path and not persisted.
  `simulating` (bool) and `sim` (the simulator's display view, §6.13) are likewise
  transient and non-persisted: set via notifying setters by the sim engine. While
  `simulating`, `dispatch`/`undo`/`redo` refuse with a message-tray report instead
  of mutating (FR-087). `sim` is retained after a run ends (FR-085) and cleared by
  the first design-modifying `dispatch` afterward.
- **Atomic command failure (FR-024a):** before `cmd.apply`, `dispatch` captures
  an in-store snapshot of the design's connectivity collections (`components`,
  `wires`, `buses`, `vertices`) and id counters (`nextWireId`/`nextBusId`/
  `nextVertexId`); on a throw it restores them **in place** (design object
  identity preserved — no swap for other layers to notice), reports via
  `onError` (app-wired to the error toast), and pushes nothing onto the undo
  stack — design, history, and `dirty` stay exactly as before the failed
  action. `undo`/`redo` are wrapped identically: a throwing revert/re-apply
  restores the pre-call state and leaves both stacks unmoved. The helpers are
  local to `store.js` (kept dependency-free; tolerant of the toy designs its
  tests use) rather than reusing `commands.js`'s `snapshotConnectivity`.
  The FR-011c `refCounters` are deliberately **outside** both this snapshot and
  `snapshotConnectivity`: they are monotonic, so a failed or undone allocation
  burns its number rather than making it reusable. Previously the failure was
  caught and reported but the partial mutation stood: invisible to undo,
  `dirty` unset.
- **Live inputs during a run (FR-087b):** `applyLive(mutate)` is a second
  mutation path used only while simulating — the interactive-input change behind
  a switch click (FR-087a). Unlike `dispatch` it bypasses the sim lock and the
  undo/redo stacks (the change is transient interaction, not an editing action),
  but still sets `dirty` and `notify()`s (so the backup snapshot, FR-092, and the
  properties panel reflect it) and, deliberately, does **not** clear the live
  `sim` view. After mutating it fires the store's **live-input channel**:
  `subscribeLive(fn) → unsubscribe`, which the sim engine subscribes to for the
  duration of a run so it can `wake()` and re-evaluate (§6.13). The channel is the
  general re-evaluation trigger — any `applyLive` wakes the sim, regardless of
  which interactive built-in caused it.
- **Command interface:** every mutating action is an object
  `{ apply(design), revert(design), label }`. The store:
  ```
  dispatch(cmd):
     cmd.apply(design)
     undoStack.push(cmd); redoStack.clear()
     if undoStack.length > UNDO_CAP: undoStack.shift()   # UNDO_CAP = 100 (≥50, NFR-006)
     dirty = true
     notify()
  undo(): cmd = undoStack.pop(); cmd.revert(design); redoStack.push(cmd); dirty=true; notify()
  redo(): cmd = redoStack.pop(); cmd.apply(design);  undoStack.push(cmd); dirty=true; notify()
  ```
- **Concrete commands:** `PlaceComponent`, `MoveComponent`, `RotateComponent`,
  `DeleteComponent`, `SetOverride`, `AddWire`, `AddBus`, `InsertBend`, `MoveBend`,
  `DeleteBend`, `DeleteWire`, `SetBusWidth`, `BranchWire`, `RefreshTypes`,
  `TranslateWiring` (shifts a set of bend points and junction/free vertices by an
  offset — the interior wiring of a group move, FR-018c). Later features added
  commands on the same pattern: `RotateSelection` (FR-019), `setLabelCmd`
  (FR-011b), `setNoteText` (FR-071f), `deleteSegmentCmd` (FR-033d),
  `SetPortProps`/`PlaceSubDesign`/`SetDefaultRender` (§6.14),
  `SetPrimaryClock` (FR-076b, dispatched by the Design Properties dialog,
  §6.11 — `PlaceComponent`/`DeleteComponent` additionally auto-set/reassign
  the same design-level field as part of their apply, capturing the prior
  value so revert restores it exactly), and the
  snapshot-based `pasteFragmentCmd` (§6.15, via `snapshotCommand`). A
  `composite` command bundles several of these into one undoable step — `apply`
  runs them in order, `revert` undoes them in reverse — so a group operation over
  a multi-object selection (FR-016a) applies and reverts as a single Ctrl-Z. Each
  captures enough
  pre-state to `revert` exactly (e.g., `MoveComponent` stores the old position;
  `DeleteComponent` stores the removed instance plus any vertex conversions/
  demotions and pruned wires it caused, so undo restores connectivity exactly).
  `RefreshTypes` (FR-088) runs `refreshInstance` over every instance against
  the client's loaded library as **one** undoable command, capturing each
  refreshed instance's prior `{typeData, overrides}` for exact revert; skipped
  instances are reported once per type via the message tray (FR-074).
  `DeleteWire`/`DeleteBus`/`DeleteSegment` accept an `{ifPresent: true}` option
  making the command a **no-op when its target no longer exists at apply time**
  — used only by the multi-delete composite (§6.9, FR-016a), whose queued
  targets an earlier sub-command's cascade may have already removed; every
  other caller keeps the default throwing lookup, so a stale id elsewhere still
  surfaces as a bug (FR-024a rolls it back).
- **Dirty/unsaved (FR-049a):** `dirty` set on every dispatch, cleared on
  successful save. New/Open guard on `dirty` (confirm dialog); a `beforeunload`
  handler warns on tab close. *(MVP-deferrable per requirements; implement the
  flag now, wire the warnings when convenient.)*
- **Dependencies:** model.

### 6.11 JS: chrome widgets (`web/js/chrome/*.js`)
- **Menu/tool bar (`toolbar.js`)** — Satisfies FR-004a, FR-004b, FR-026, FR-035, FR-022, FR-022a,
  FR-023, FR-024, FR-044, FR-046, FR-049, FR-052, FR-076, FR-087, FR-088,
  FR-121b/FR-121c (chrome side). A
  single horizontal bar with pull-down menus on the left and always-visible
  buttons on the right (FR-004a). **Menus:** **File** — New Project…, Open
  Project…, Duplicate Project… (FR-121b, §6.19), New, Open, Save, Save As,
  Export… (FR-119, §6.18), Refresh Types; **Edit** — Undo, Redo, Copy, Paste
  (FR-111/FR-112, §6.15), Design Properties… (FR-076b, dialog below); **View** — Zoom In, Zoom Out, Fit to Screen (FR-022a,
  `interaction.fitToScreen`); **Simulate** — Test Vectors… (FR-115b, §6.16) and
  Generate C… (FR-116, §6.17). **Buttons:**
  Select, Wire, Bus (modal tools), then **Run/Stop**, then — shown only while a
  run of a sequential design is active — the **pause/step cluster** (FR-076a):
  a Pause/Continue toggle and Step-cycle / Step-unit buttons, each an inline-SVG
  debugger glyph with a tooltip/aria-label (the Wire-icon pattern), the step
  buttons enabled only while paused; they call the engine's
  `pause()`/`resume()`/`stepUnit()`/`stepCycle()` (§6.13). (Pan has no control; it is
  space-drag/middle-drag or right-click-to-recenter on bare canvas —
  FR-023a/FR-023b; left-drag on bare canvas is rubber-band select, FR-016b.)
  A menu opens on click, closes on item choice / outside click / Escape, and is
  built so future commands drop in as additional items (as Copy/Paste, Test
  Vectors…, Generate C…, and Export… did).
  The Wire button shows the wire-cursor icon (the lower-right→upper-left
  diagonal line, inline SVG) instead of a text label (FR-025), keeping a
  `Wire tool` tooltip/aria-label. The active tool is highlighted; clicking a
  tool sets `store.tool`. The Run button calls the sim engine's `run()` and
  relabels to "Stop" (FR-076); while `simulating`, the design-modifying commands
  (Wire, Bus buttons; Undo, Redo, Paste, New, Open, Refresh Types, Test Vectors…,
  Generate C…, Export…, Design Properties…, and the three project items, FR-121b) are disabled —
  Save, Save As, the zoom items,
  Select, and Run/Stop stay enabled (FR-087; the same set is disabled under the
  test-vector panel lock via `isReadonly()`, §6.16/FR-115h). The **Refresh
  Types** item (FR-088, tooltip "Re-copy type data from the loaded library into
  placed components") first **re-fetches the merged library** for the current
  project (`getComponents(store.state.project.dir)`, §6.12), so externally
  added/edited `<project>/components/` types are picked up live (FR-121i; the
  shared startup library still needs a restart, FR-007), then dispatches
  `RefreshTypes` with that refreshed library. (Reworked 2026-06-21; supersedes the former flat toolbar — a row of
  text/icon buttons — whose File ops and Undo/Redo/zoom moved into menus while the
  modal tools and Run stayed as buttons. The filename is retained for now.)
  - *Current-project indicator (FR-121b)*: a `#project-name` label in the bar
    (`index.html`, styled beside `#design-name`) shows the current project's
    display name via a store subscription; before a project is current it reads
    "(no project)".
  - *No-project state (FR-121c)*: while `store.state.project` is `null`,
    `refresh()` additionally disables everything except **New Project…, Open
    Project…, Open, Select, and the View items** — i.e. it also disables Save,
    Save As, New, Export…, Refresh Types, the Simulate items, Run, the Wire/Bus
    tool buttons, Undo/Redo/Paste, and Duplicate Project… (nothing to
    duplicate). The FR-004b/FR-004c key bindings honor the same enablement:
    the store's no-project `blocked()` covers every dispatch path, and the
    fileops entry points guard themselves (§6.19), so a bound key cannot
    bypass a disabled item.
  - *Menu accelerators (FR-004b)*: `addItem` takes an optional accelerator
    descriptor and renders it right-aligned in the row (a `.menu-accel` span; the
    label and hint sit in a flex row). An `accelLabel(descriptor)` helper formats
    the platform-appropriate text (⌘/⇧ on macOS via a one-time `isMac` check, else
    `Ctrl+`/`Shift+`). The new File/View key bindings live in the global keydown
    handler (§6.9, `interaction.js`) beside the existing undo/redo/copy/paste keys;
    `initInteraction` now also receives `fileops` so the handler can call it:
    `Ctrl/Cmd+O`→`fileops.open()`, `Ctrl/Cmd+S`→`fileops.save()`,
    `Shift+Ctrl/Cmd+S`→`fileops.save({saveAs})`, `Ctrl/Cmd+=`/`+`→`zoomBy(1.25)`,
    `Ctrl/Cmd+-`→`zoomBy(0.8)`, each `preventDefault`-ing the browser default. Save
    and the zoom keys sit *above* the simulation-lock early-return (live while
    simulating, matching the menu, FR-087); Open sits *below* it (disabled while
    simulating). New (`Ctrl/Cmd+N`, browser-reserved), Refresh Types, and Fit to
    Screen (FR-022a) get no key and no hint. The **menu-less canvas keys**
    (FR-004c) live in the same handler below the lock early-return: `w`/`b` arm
    the Wire/Bus tools from select mode, `r`/`Shift+r` rotate the selection
    (`rotateSelectionCmd`), Delete/Backspace delete it (Backspace pops a locked
    waypoint mid-conductor, FR-027e), `+`/`=`/`-` on a single bus/segment
    selection resolve the parent bus and dispatch `setBusWidthCmd` (min width 1,
    FR-038), and `Ctrl/Cmd+Y` is a redo alias.
- **Palette (rendered by `app.js` `renderPalette`; there is no separate
  `palette.js` file)** — Satisfies FR-003, FR-005, FR-006, FR-008, FR-009,
  FR-009a. Renders one fixed-size tile per `ComponentType` in a 3-column CSS
  grid, ordered per FR-006: 74-series ascending by numeric part number
  (`Number(name.slice(2))`), then free-form-named parts (GAL, memory), ties by
  library id (`partOrder`).
  Each tile is labeled with the type's full external **display name** —
  `displayName(type)` = `partnumber` for a GAL part else `name` (FR-005, no longer
  abbreviated) — with that same name leading its `title`/tooltip; `dataset.type`
  carries the type's immutable `id` (FR-066e), and the library is keyed by `id`, so
  placement, behavior lookup, and Refresh Types are unaffected by display-name
  edits. The label is sized by a small CSS font (`.palette-tile` font-size) chosen
  so a five-character name (e.g. "74125") fits the fixed tile (FR-005). A **GAL
  part** (a type carrying `partnumber`, FR-005b/FR-066b) labels its tile with the
  `partnumber` and leads its `title` with `partnumber` then the `description`
  (FR-005a) — the part number is what disambiguates same-family tiles. Two GAL
  parts of one family stay distinct because their `id`s differ, not their display
  names. An authored part created in-app (FR-066c/FR-007a) is appended
  to the upper region live (no reload), keeping the FR-006 sort. Tiles are raised (drop shadow); a tile is `draggable` (HTML5 DnD →
  drop on canvas, FR-008) and click-selectable (sets `PLACE(type)`, FR-009). The
  armed tile shows a pressed-in (inset) look (FR-009a) by subscribing to the store
  and matching `state.placeType` while `tool === "place"`. Disabled/overlaid until
  the library load resolves (FR-003).
  The palette is split 50/50 (FR-006a) into an upper region (#palette-parts) for
  the 74-series tiles and a lower region (#palette-builtins) for built-in objects;
  each scrolls independently beneath a fixed `.palette-heading` bar (its half is a
  flex column: non-scrolling heading + scrolling grid). Lower-region tiles render an SVG icon (the object's
  glyph, e.g. the indicator bubble) with a descriptive `title`, and `dataset.type`
  set to the built-in type name; the armed-state subscription covers both regions.
- **Built-in objects (`builtins.js`)** — Satisfies FR-067–FR-071e. Exports a
  client-side array of synthetic `ComponentType`s (no server/YAML). Each carries
  `builtin: true`, an `icon` (inline-SVG palette glyph), a `title` (tooltip), plus
  the usual `name`/`width`/`height`/`pins`/`renderType`. Entries: **indicator**
  (`renderType:"indicator"`, 2×2, one bottom-center `in` pin, FR-068); **pull-up**
  (`"pullup"`, 2×2, one bottom-center pin, FR-069); **pull-down** (`"pulldown"`,
  2×2, one top-center pin, FR-070); **clock** (`"clock"`, 3×2, one right-center
  pin, FR-071); **power-on reset** (`"reset"`, 3×3, two right-edge `out` pins
  `R` and `/R`, FR-071b); **input switch** (`"switch"`, 2×2, one right-center
  `out` pin, FR-071c); **8-wide indicator** (`"indicator8"`, 3×9, eight left-edge
  `in` pins `D0`–`D7` in one pin group `D`, FR-071d); **multi-bit port**
  (`"portN"`, `3 × (N+1)`, N left-edge `bidir` pins `P0`–`P(N-1)` in one pin group
  `P`, FR-071e — width N chosen at placement, 2–16, default 8);
  **text note** (`"note"`, a `NOTE`-labeled tile, **no `pins`**, FR-071f);
  **transmission gate** (`"tgate"`, 2×2, left-center `bidir` pin `A`,
  right-center `bidir` pin `B`, top-center `in` pin `EN`, FR-071g — the
  renderType is `tgate`, not `switch`, which the input switch already owns);
  **relay** (`"relay"`, 4×4, top-edge `in` pin `COIL`, right-edge `bidir`
  pins `NO`/`COM`/`NC` top-to-bottom, FR-071h). The two switch elements'
  contact terminals are declared `bidir` — deliberately, since a switch
  terminal is genuinely directionless; a consequence is that a port whose net
  reaches a switch terminal derives direction **bidir** (FR-094c), the
  conservative result, for which the FR-094d override is the existing remedy.
  Like the text note, the switch elements have **no `BEHAVIORS` entry** and no
  `INTERACTIONS` entry: they neither source-drive a value nor accept sim-time
  clicks — the engine realizes them as dedicated `kind:"pass"` entities
  (§6.13, FR-083a), the same pattern as memory's `kind:"memory"` escape from
  the source-only `BEHAVIORS` signature. The
  8-wide indicator and the multi-bit port declare `pinGroups` so an N-bit bus
  snap-connects to all N bits at once (FR-041/FR-042, `matchingGroups`). Unlike the
  fixed built-ins, `portN`'s pins/group/footprint are generated for its chosen
  width (the `port8` definition with its `type-port8` id is withdrawn; FR-071e); it
  contributes a **pin group** of N one-bit pins to the interface (FR-095) with a
  derived direction (FR-094c) aggregated across its bit nets. Its pins join nets as ordinary members
  through the snapped bus/wire (not via `connector` vertices), so same-label
  joining (FR-094a) and off-sheet links (FR-101) stay deferred for it. On
  placement these flow through the normal
  non-subunit
  `addInstance` path; `addInstance` assigns an `A-<n>` refdes (FR-011a) when
  `type.builtin`. Each entry may declare `properties` (FR-020b): the clock
  declares `period` (ns, default 100) and `speed` (Hz, default 1) per FR-071a;
  the reset declares `cycles` (clock cycles, default 3) per FR-071b;
  the other built-ins declare none. Each built-in type carries an `id` (FR-066e)
  of the form `"type-"+name` (e.g. `"type-indicator"`), the value its instances
  record as `type` and the key for the registry below. The module also exports a `BEHAVIORS`
  registry (FR-067a) mapping type **id** → behavior function with the
  `behave(ctx)` signature defined in §6.13; functions stay
  out of the type objects so `typeData` copies remain pure JSON (§7.1).
  `drawComponent` has a render branch per built-in renderType: the
  indicator bubble (gray `?` for U/Z or no run, white `1`/black `0` from the
  live sim view, §6.8), the
  pull-up two-headed arrow, the pull-down upside-down `T`, the clock and
  reset boxes, and the switch (the same value bubble as the indicator — white
  `1`/black `0` from `inst.switchState` — plus a small arrow off the bubble
  toward the output pin marking it a source, FR-071c). The two 8-wide built-ins
  add branches: `drawIndicator8` draws the LED bar-graph (eight horizontal
  stripes, each filled by its bit's value via `sim.valueOfPin(refdes,"D"+i)` with
  the same white/black/gray mapping as the 1-wide indicator, FR-071d), and
  `drawPortN` draws N narrow off-sheet pentagons, one centered on each bit
  pin's row (FR-071e). Two switch-element branches (FR-071g/FR-071h):
  `drawTgate` draws the two overlapping opposite-pointing triangles between
  the `A` and `B` pins with the `EN` lead entering the top, and `drawRelay`
  draws a coil (its single lead entering from the top edge) with, on the
  right, the three contact terminals — `COM` as the common pole (marked with a
  dot) plus `NO` and `NC`, and **no moving contact arm** (a static one could not
  track the simulated state) — and draws the `NO`/`COM`/`NC` labels in a column
  between the coil and the contact so the three right-edge terminals are
  identifiable (FR-071h) — these labels are culled at low zoom like other pin
  names (FR-012a) and kept upright regardless of rotation (FR-015). The static
  symbol does not animate with the simulated coil state (indicators are the
  state display, FR-068). The shared pin loop draws the connection leads at
  each pin for both. Pin
  name labels are suppressed for built-ins (the glyph owns the body) — the relay
  is the exception, labeling its `NO`/`COM`/`NC` contacts (above); the refdes is
  drawn above the symbol. The **text note** (`note`) is the lone exception that
  draws neither pins nor refdes (FR-071f): `drawNote` (§6.8) draws only `inst.text`
  (plus a dotted blue outline box when selected). While a note is being edited the
  renderer skips it entirely — a DOM `<textarea>` overlay covers it (§6.9). Because it has no `pins`, `addInstance` assigns it
  an internal-only `N-<n>` `refdes` — a separate series, special-cased ahead of the
  `A-<n>` path (FR-011a) — that is its identity (FR-011) but is never drawn and has
  no editable label, keeping it selectable, movable, and persistable on the usual
  refdes-keyed machinery. It is invisible to
  `buildNets` (no `pin` vertices), and it has **no `BEHAVIORS` entry** (FR-067a),
  so `sim.js` must skip a behaviorless note rather than flagging it an unknown
  built-in. It is a normal selection member, so move and rotate (FR-019, including
  the text turning with the box) flow through the existing commands unchanged.
- **Note text state (FR-071f)** — the note carries one per-instance field,
  `inst.text` (string, default `""`), set on the instance directly rather than
  through `overrides`, round-tripping through save/load for free like
  `switchState` (§7.2). It is edited through a DOM `<textarea>` **overlay** managed
  by the interaction FSM (§6.9): entered automatically on placement and re-entered
  by double-clicking the note; **Enter** commits and exits, **Shift+Enter** inserts
  a newline, and a click elsewhere (blur) or Escape also commits. Each commit that changes
  the text is one undoable `setNoteText` command (§6.10); the auto-sized
  `width`/`height` (whole grid units) are recomputed from the wrapped text on
  commit.
- **Switch interactive state (FR-071c)** — the input switch carries one
  per-instance field, `inst.switchState` (`"0"` | `"1"`, default `"0"`),
  set on the instance directly rather than through `overrides`. It round-trips
  through save/load for free (the whole instance is serialized, §7.2). It is
  changed while editing by the properties panel control (§6.12, FR-020c) and
  while simulating by a click routed through the interaction FSM (§6.9,
  FR-087a). `drawComponent` reads it to draw the value bubble; the switch behavior
  (§6.13) reads it to drive its output. (A legacy `"U"` from an older saved
  design reads as `0`.)
- **Interactive-input registry (`INTERACTIONS`, FR-087b)** — a second registry
  exported beside `BEHAVIORS`, mapping built-in type name → an interaction
  handler `(inst) => void` that mutates the instance's interactive state in
  place. It is the input-side analogue of `BEHAVIORS` (output side): a type with
  an entry is *interactive* and accepts a sim-time click. The **switch** entry
  toggles `inst.switchState` 0↔1 (FR-087a). The interaction FSM (§6.9)
  routes a simulating-mode click on any interactive built-in through
  `store.applyLive(() => INTERACTIONS[type](inst))` — no per-type special case —
  and `applyLive` wakes the simulator (§6.10, §6.13). Adding a new interactive
  input is therefore: an `INTERACTIONS` handler + a render branch, nothing in the
  scheduler or the FSM.
- **Dialogs (`dialogs.js`)** — Satisfies FR-046–FR-049, FR-052–FR-054, plus the
  project-aware dialog machinery of FR-121 (§6.19). Modal DOM
  dialogs:
  - *Save* — on first save (no `savePath`) prompt with name prefilled to the
    design name (FR-047), **rooted at the current project root** (FR-121e/
    FR-121h; formerly the data dir) so the prompt effectively asks only for a
    name; the dialog uses `/api/v1/files` to navigate directories
    and choose a location (FR-051); subsequent saves skip the prompt (FR-048).
    The design adopts the chosen file's base name (FR-047a): fileops overrides
    `name` in the serialized payload (so the file matches) and
    `store.markSaved(path, name)` updates `design.name` and the displayed
    `designName` after the write succeeds.
  - *Design Properties (FR-076b)* — a small modal opened from Edit → Design
    Properties… presenting design-level properties; for now exactly one
    control: a **primary clock** `<select>` listing the design's clock
    generator instances by refdes (label shown when set, FR-011b), current
    value preselected, disabled with an explanatory note when the design has
    no clock generator. OK with a changed value dispatches `SetPrimaryClock`
    (§6.10, undoable); Cancel discards. The menu item is disabled while
    simulating and under the read-only lock (FR-087/FR-115h).
  - *Project-aware `openFileDialog` generalizations (§6.19, FR-121)*:
    (a) `allowDir: true` (open mode) — the OK button works with no file
    selected and resolves to the **currently listed directory**
    (`{path: currentPath, isDir: true}`), for Open Project's folder pick
    (FR-121b); (b) `includeManifests: true` — passes `manifests=1` to
    `listDir` so `*-manifest.json` files appear (they are excluded by default,
    FR-121a); (c) `exts: ["-"]` — the directories-only listing (§6.5) used by
    the New/Duplicate Project location prompt; (d) `saveExt: null` — no
    extension appended to the typed name (a project directory name, extending
    `applySaveExt`); (e) `ignoreLastDir: true` — this dialog starts at the
    caller's `startPath` even in open mode (the FR-121b main-design picker,
    §3.1 A11) while still updating the remembered directory; and
    (f) `validate(path) → string|null` (save mode) — run in `onOk` **before**
    the FR-049b overwrite guard; a non-null return renders on an inline error
    line and keeps the dialog open. fileops' design-save validator (§6.19)
    rejects a name matching the manifest pattern (FR-121a) and a resolved path
    outside the current project (FR-121e), also posting the rejection to the
    message tray (FR-074).
  - *Open* — server-assisted directory navigation via `/api/v1/files` (FR-052/
    FR-053). **Fallback (FR-054):** if navigation is judged impractical, render a
    recent-files list persisted in `localStorage`. Keep the recent-files code
    ready behind the same dialog. **Last-viewed directory (FR-052a):**
    `openFileDialog` writes each successfully listed directory to
    `localStorage` (key `sim.lastDir`; both modes write). An **open**-mode
    dialog starts at the stored directory when present, falling back to the
    caller's `startPath` if listing the stored path fails (dir deleted/moved);
    save mode ignores the stored value on open. One shared key serves all
    pickers (designs, ROM contents, `.tv` files). `localStorage` failures are
    swallowed (the backup.js precedent) — the feature degrades to the old
    startPath behavior.
  - *Bus group disambiguation (FR-041b)* — opened by snap-connect when **≥2** pin
    groups match the bus width. Lists the candidate groups by name (e.g., `A`,
    `B`, `Y` for a 16-bit ALU bus); the user picks one or cancels. Resolves a
    promise the interaction FSM awaits before dispatching `snapBusGroup`. Does
    **not** filter by pin direction (electrical-rule checking is out of scope this
    phase — see §4.1, OQ-008/D2).
- **Properties panel (`properties.js`)** — Satisfies FR-011b, FR-020a, FR-020b, FR-105. A docked
  right-edge panel showing the selected instance's type **display name**
  (`typeData.partnumber || typeData.name`, not the id `inst.type`), size, and pin
  count read-only, an **editable, free-form designator field** (FR-011b — its value
  dispatches an undoable `setLabelCmd(refdes, label)`, §6.10, with no uniqueness or
  format validation; a blank value clears the label back to the `refdes` default;
  the note built-in shows no designator and so no field), plus one numeric field per `delays` entry
  for per-instance propagation-delay overrides and — when the type declares
  `properties` (FR-020b) — a "Properties" section with one numeric field per
  declared property, labeled with its unit (e.g. `period (ns)`), prefilled with
  the effective value (override or default). Both sections share the same
  mechanics: editing dispatches `setOverride` (model + command, §6.9/§6.10),
  generalized to take an override group (`delays` | `props`); entering the type
  default or pressing the reset button clears the override. Overrides live in
  `inst.overrides.delays` / `inst.overrides.props` (§7.2) and persist via the
  full-instance save (FR-058). The panel re-renders on every store notification,
  which is why selection now flows through `store.setSelection` (notifying).
  - *Wire/bus synthetic sheet (FR-020d)*: when the single selection is a wire or a
    bus (`only.kind === "wire" | "bus"`) the panel renders a sheet describing the
    conductor's two endpoints — its `path`'s first and last `node` entries. For a
    **bus** the sheet additionally leads with one **editable** field, a free-form
    **name** (FR-040a) committed via `setBusNameCmd` (blank clears it back to the
    default), disabled while `store.isReadonly()` (FR-087/FR-115h); wires have no
    name field, so their sheet is fully read-only. `setBusNameCmd` propagates at
    set time (FR-040a): it walks the edited bus's **same-width group** — bus
    objects reachable through full-width, zero-offset bus↔bus joins (FR-039/FR-039b),
    stopping at any width change or nonzero offset — and writes (or, on blank,
    clears) the name on every bus in the group, capturing each one's prior name so
    revert restores them all as the single undoable action. Because every bus in the
    group then stores the name, `busLabel` stays a per-object lookup with no
    traversal. A shared `busLabel(bus)` gives a
    bus's display name with precedence (FR-040a): `bus.name ??` its first
    `groupConnections` group `?? bus.id`. A shared `describeEndpoint(design,
    vertexId, self)` resolves each endpoint vertex to text, recomputed on every
    render so a renamed designator (FR-011b) or bus name is reflected: a
    `pin`/`connector` vertex → "`<label> <pin>`" (label via the instance's
    `label ?? refdes`); a `junction` carrying a `bit` (a bus-breakout tap,
    FR-043a) → "`<bus>[<bit>]`" via `busLabel` of the owning bus; a `free` vertex
    named by some bus's `groupConnections` (group-snapped, FR-042) →
    "`<label> <group>`"; a plain
    `junction` (no `bit`, FR-034) → "`junction (x, y)`" (a junction ties ≥2
    conductors, so it is connected) — **except**, when the selected conductor is a
    bus and the junction ties it to **another bus** (a bus↔bus join, FR-039b), →
    "`<bus>[<lo>:<hi>]`", found by locating the other bus(es) whose `path` also
    passes through this junction node and computing the range of the *other* bus's
    bits that this bus joins: identify wide/narrow by width as in `netlist.js`
    (`offset = wide.width === narrow.width ? 0 : v.offset ?? 0`; narrow bit i ↔
    wide bit offset+i), so the other bus contributes bits `offset..offset+width-1`
    when it is the wider partner and its full `0..width-1` when it is the narrower
    (or equal-width) partner; the other bus is named by `busLabel`; otherwise (a
    dangling `free` end, FR-029) → "`unconnected (x, y)`" from the vertex position.
    This requires `describeEndpoint` to also receive the selected conductor so it
    can exclude it when finding the "other" bus. The endpoint rows are read-only;
    only the bus name field (above) is editable, so it alone honors the sim lock.
  - *Documentation section (FR-105)*: a read-only block rendered from the
    instance's type data (FR-104), placed after the read-only `Type/Size/Pins`
    rows and before the editable delay/property sections. The one-line
    `description` and the `datasheet` link (an `<a target="_blank"
    rel="noopener">` to `url`, labeled with vendor/title, rev shown muted) sit at
    the top. The per-pin roles (`name` then `desc`) go inside a collapsed
    `<details>` ("Pin roles") so they never crowd the override controls. Each
    piece appears only when its field is present, and a type with no
    documentation renders nothing extra. The section is purely informational, so
    it is never disabled while a simulation runs (FR-087 governs only the
    editable override fields).
- **Status bar (`statusbar.js`)** — Satisfies FR-072, FR-073, FR-074, FR-089
  (tray). A flex row
  docked at the bottom of the window (below the canvas, full width) holding
  trays styled with the palette tiles' raised drop-shadow look: a state tray at
  the lower-left corner showing the program's operating state (text: `editing`,
  `simulating` during a run, or `paused` while a sequential run is paused —
  FR-073/FR-076/FR-076a), a message tray filling the remaining
  width showing the most recent posted message (empty when none; long messages
  truncate with an ellipsis), and a connection tray at the right end showing
  the server connection state — `connected` or `disconnected` (FR-089), driven
  by the connection monitor (§6.12a). The module exports `setAppState(text)`,
  `postMessage(text)` / `clearMessage()`, and `setConnState(connected)` for
  other modules to call; status text
  is transient UI, not design state, so it does not flow through the store or
  the undo stack.
- **Context menu (`contextmenu.js`)** — Satisfies FR-033, FR-033b, FR-033d, FR-038, FR-037b,
  FR-033a, FR-018a. Right-click hit-tests the cursor (bend → wire → bus → component
  priority) and surfaces the matching actions: "Delete bend point" (on a bend);
  "Delete segment" (the segment under the cursor, FR-033d) and "Delete wire" (on a wire);
  "Delete segment", "Set width…", "Edit bit names…", and "Delete bus" (on
  a bus); "Delete component" (on a component; a sub-design instance additionally
  offers "Open sub-design", FR-100/§6.14, and a port carrying an off-sheet
  target offers "Follow off-sheet connector", FR-101/FR-101b). Dismissed by choosing an item,
  Escape, or an outside click. `interaction.js` builds the item list and dispatches
  the commands; `contextmenu.js` only renders and positions the menu. Width and
  bit-name entry use small modal prompts in `dialogs.js`.
- **Dependencies:** store, api, geometry.

### 6.12 JS: API client & bootstrap (`web/js/api.js`, `web/js/app.js`)
- **Purpose:** typed-ish wrappers over `fetch`; app startup.
- **Satisfies:** FR-003, FR-004, IR-001, NFR-002.
- **`api.js`:** `getComponents(projectDir?)` — passes `?project=<dir>` so the
  response is `shared ∪ project` types plus scan `warnings` (FR-121i; omitted
  when no project is current), `getDefaults()`, `listDir(path, exts,
  {includeManifests})`,
  `loadDesign(path)`, `saveDesign(path, design)`, `createComponent(yaml,
  projectDir)` — sends the current project dir so the server writes under
  `<project>/components/` (FR-007a/FR-121i), `readRomFile(path)` (FR-114e),
  `saveTextFile(path, content)`
  (FR-116/FR-119), `projectInfo(dir)`, `projectCreate(path)`,
  `projectDuplicate(src, dst)` (FR-121, §6.19), `ping()`. All target
  same-origin
  `/api/v1/*` (localhost only — no external requests, NFR-002). Each rejects with
  the server error envelope on non-2xx.
- **`app.js`:** create the store with an empty design named
  `unnamed schematic <localDateTime>` in SELECT mode (FR-004, FR-045) — with
  `project: null` this is the **inert placeholder** of FR-121c (§3.1 A8): the
  store's no-project lock (§6.10) and the toolbar's no-project state (§6.11)
  keep it uneditable until New Project / Open Project / Open establishes a
  current project (§6.19); fetch
  components + defaults (await both, FR-003) — at startup `project: null`, so
  `getComponents()` returns the **shared** library only, and the merged
  project-local library is (re)fetched when a project becomes current (FR-121i,
  §6.19); offer backup recovery (§6.12a,
  FR-093) before presenting the empty design — an accepted recovery that has a
  `savePath` also establishes its containing folder as the current project via
  `setCurrentProject` (§6.19), else the recovered design sits inert behind the
  FR-049a dirty guard until a project is opened; build palette, toolbar, canvas,
  interaction, and the project ops (`makeProjectOps`, §6.19, wired to the File
  menu); subscribe the `#project-name` label (FR-121b); start the connection
  monitor and backup writer (§6.12a); remove
  the loading overlay.
- **Error handling:** if `getComponents()` fails, show a blocking error banner
  ("server unreachable — is retrosim running?") and keep the canvas disabled.

### 6.12a JS: connection monitor & local backup (`web/js/connection.js`, `web/js/backup.js`)
- **Purpose:** survive server death and browser-side loss: detect/reconnect to
  a restarted server instance, and keep a localStorage snapshot of unsaved
  work.
- **Satisfies:** FR-089–FR-093.
- **Why this is enough:** the server is stateless and the design's single
  source of truth is the browser store; every save transmits the complete
  design (§6.4). So "reconnection" needs no session state or transfer
  protocol — only detection, messaging, and a save. The new instance must bind
  the same address:port (the SPA can only reach the origin that served it,
  NFR-002).
- **`connection.js` (FR-089–FR-091):** `startConnectionMonitor({store, save})`
  polls `api.ping()` every `HEARTBEAT_MS` (~3000). On a connected→disconnected
  transition: `setConnState(false)` and post via the message tray: work is
  retained in this tab, do **not** reload, restart the server at the same
  address/port. On disconnected→connected: `setConnState(true)`, post a
  reconnection message, and if `store.state.dirty` invoke the injected `save`
  action — the same fileops path used by the toolbar Save: writes to
  `savePath` when known, else opens the Save dialog (FR-091). Polling is
  skipped while a heartbeat is still in flight; the monitor never throws.
- **`backup.js` (FR-092/FR-093):** `startBackup(store, {storage, debounceMs,
  post})` subscribes to
  the store and, debounced ~1 s, writes
  `{design: serializeDesign(design), savePath, designName, time}` to
  `storage` (default `window.localStorage`, injectable for tests) under one
  fixed key while `dirty`; removes the key when a save lands (`dirty` false).
  `offerRecovery(store, {storage, confirmFn, post})` runs at startup (before
  FR-045's empty design is
  shown): if the key exists, a confirm dialog offers the snapshot (named, with
  its timestamp); accept → `deserializeDesign` into the store with the saved
  name/path and `dirty = true` (`replaceDesign`'s `dirty` option, §6.10);
  decline — or a corrupt snapshot — removes the key. Designs are small
  JSON, far under localStorage quotas; one fixed key means a second concurrent
  tab last-writer-wins, acceptable for a single-user localhost tool.
- **Error handling:** heartbeat failures are the *signal*, never errors;
  localStorage write failures (quota, privacy mode) post one message and
  disable the backup writer rather than interrupting editing.
- **Dependencies:** `api.js`, store, `chrome/statusbar.js`,
  `chrome/fileops.js` (injected), `model/persist.js`.

### 6.13 JS: slow simulator (`web/js/engine/sim.js`, `web/js/engine/galasm.js`)
- **Purpose:** the interpretive debug engine (requirements §3.19; sim-vision.md):
  execute the design live on the canvas under a unit-delay, four-state model.
- **Satisfies:** FR-075–FR-087, FR-083a, FR-067a, FR-062d (client side), FR-071a, FR-071b, FR-071g/FR-071h (simulation side).

**Four-state values (FR-077).** Every net carries `0`, `1`, `U`, or `Z`, encoded
as small ints in two `Uint8Array`s (`curr`, `next`) indexed by net id. Reading Z
yields U. Combination is **selectively pessimistic**, as real logic permits:
`0 AND x = 0` and `1 OR x = 1` regardless of U operands; every other combination
with a U operand yields U (§8). (Reworked 2026-06-12; supersedes strict
pessimism — any U operand → U — under which registered feedback could never be
initialized: `0 AND U = U` made even a held synchronous clear ineffective, so
no sequential part could ever leave U.)

**`galasm.js` — behavior compiler/evaluator (FR-079):**
- `compileBehavior(typeData) → CompiledBehavior | null` parses the equations-only
  dialect (galasmManual.txt §5). Tokens: `;` comments; names (letters+digits,
  ≤8); `/`/`!` negation; `*`/`&`; `+`/`#`; `=`; LHS suffixes `.T`/`.R`/`.E`;
  `AR`/`SP`; `VCC`/`GND`. Polarity follows the project's **physical-level
  convention** (§7.6; established on the 74138 and stated in every behavior
  header): a signal name is the YAML pin name with any leading `/` stripped,
  every signal is implicitly *declared active-high*, and the YAML `/` prefix
  contributes nothing — so the manual's §3.3 declaration/use XOR degenerates to
  the use-negation alone: literal `/X` is true iff pin X reads LOW, and LHS
  `/Y = term` drives pin Y LOW when the term is true.
- Validates **language rules only** (no 22V10 physical capacity, manual §5):
  unknown signal; LHS not an output-capable pin (`out`/`bidir`/`tristate`); two
  output equations for one signal; `.E` not single-term / before its output /
  on a plain output / with a negated LHS; `AR`/`SP` multi-term, on a
  RHS, or defined twice; `VCC`/`GND` not the entire RHS. A type with no
  `behavior:` block compiles to `null` (FR-080).
- **Buried internal nodes (FR-079c).** `compileBehavior` reads `typeData.internal`
  (a list of node names) and seeds the signal table with each one **alongside**
  the pin-derived signals, giving it a synthetic direction (`"internal"`, treated
  as output-capable so it may head a `.R` equation) and a `pin` of `null` (it owns
  no pin). The same lexical/reserved/collision checks that guard pin signals guard
  these: a name is rejected if it is illegal, reserved, or already a pin signal
  (one shared namespace). After parsing, `compileBehavior` verifies every declared
  internal node is defined by exactly one `.R` equation — a missing definition, or
  a definition that is plain/`.T`/`.E`, is a compile error (FR-079c). An internal
  node otherwise flows through compilation as an ordinary `.R` output record
  (`kind:"R"`, `pin:null`) and through evaluation (`updateRegisters`/`evalOutput`)
  **unchanged** — only its *drive target* differs, which is a `sim.js`/`cgen.js`
  concern (below), not a compiler one. The compiled form gains no new shape.
- Compiled form: `{ outputs: [{signal, pin, kind: plain|T|R|L, lhsLow,
  terms: [[{signal, low}]], enable: term|null}], ar, sp }`, cached **per type
  name** — instances share it. A **transparent-latch** output (`kind:"L"`,
  FR-079d) additionally carries a `gate` (its single-term `.G` product term) and
  an optional `arst` (single-term `.ARST`), the level-sensitive analogue of a
  `.R` output's `clk`/`arst`.
- Compiled literals carry `low` = the use-negation (`{signal, low}`, true iff
  the net reads `low ? 0 : 1`); outputs carry `lhsLow` = the LHS use-negation.
- Evaluation (selective pessimism, FR-077): a literal is true iff its net reads
  `(low ? 0 : 1)`, U if the net is U/Z; a product is **0 if any literal is
  false**, else U if any literal is U, else 1; the sum is **1 if any term is
  true**, else U if any term is U, else 0. A plain/`.T` output drives `sum XOR lhsLow`; a
  `.R` output drives `register XOR lhsLow` (the sum is the D input, latched by
  `sim.js`); a `.L` transparent-latch output (FR-079d) likewise drives `latch XOR
  lhsLow`, its stored value maintained level-sensitively by `sim.js` (below); a
  `.T`/`.R`/`.L` output with `enable` false contributes Z, with enable U
  contributes U (pessimistic). `AR` true forces all the instance's registers to
  the reset state each step (async); `AR` U forces them U; `SP` true at a clock
  edge sets them (manual §3.6).
- **Dialect modes (FR-066a/FR-079a/FR-079b).** `compileBehavior` takes the
  dialect from `typeData.gal`: absent → **extended** (default); a device name →
  **strict** for that device. The two modes share **one** evaluator — strictness
  is a validation gate layered over compile, never a second code path (FR-079b),
  so a block that passes strict validation evaluates bit-identically to the same
  block in extended mode.
  - *Extended* adds two things over flat SOP (FR-079a): (a) an **XOR** operator
    (the multi-char token `:+:`, PALASM's spelling) that joins sum-of-products
    operands — evaluation XORs the operand values with the
    same selective pessimism as the rest (a 0/1 result only when no operand is
    U/Z, else U); the compiled output record carries XOR-joined term groups
    rather than a single sum. (b) **Per-output clock/async control** via the
    GAL20RA10 suffixes `.CLK`/`.ARST`/`.APRST` (one product term each): a `.R`
    output may name its own clock signal in `.CLK`, and its own async reset/preset
    in `.ARST`/`.APRST`, instead of sharing the part's global `clock:`+`AR`/`SP`.
    (c) The level-sensitive **`.L`/`.G`** suffix pair for **transparent latches**
    (FR-079d): `Qn.L = <data>` names the latched sum-of-products and the required
    single-term `Qn.G = <gate>` names the transparency gate (transparent while the
    term is true). `.G` is legal only on a `.L` output; a `.L` output takes no
    `.CLK`, may add a single-term `.E` (3-state) and a single-term `.ARST`
    (async clear to 0), and takes no `.APRST`. The parser's suffix set therefore
    extends to `.T`/`.R`/`.E`/`.CLK`/`.ARST`/`.APRST`/`.L`/`.G`.
  - *Strict* (`gal:` present) runs a device table — pin/OLMC counts, which
    suffixes and which of `AR`/`SP`/`.CLK`/`.ARST`/`.APRST` the device allows, and
    the per-OLMC product-term profile — and pushes a preflight error (§6.13
    `errors`) for any construct or capacity the device lacks (e.g. XOR on any
    device, `.CLK` on a non-20RA10, `AR`/`SP` on a 16V8/20V8, the transparent-latch
    `.L`/`.G` on any device — FR-079d, extended-only). The product-term
    profile is checked **conservatively** (terms as written, no minimization —
    FR-079b); the cheap structural limits are exact. This same `validateStrict`
    gate is what the **New GAL part dialog** (§6.11, FR-066c) runs live while
    authoring, so a part cannot be created that Run would later reject.
- **Per-register clocks (sim.js).** Extended per-output `.CLK` means a single
  evaluation entity may hold registers on **different** clock nets, so the
  engine's one-`clockNet`-per-entity assumption generalizes to a clock net **per
  `.R` register** (the global `clock:` pin is the default when an output gives no
  `.CLK`). Each step latches each register on the 0→1 of *its own* clock net and
  applies that register's own `.ARST`/`.APRST` (async) — the existing rising-edge
  and `AR`/`SP` machinery, indexed per register instead of per entity.
- **Transparent-latch state (sim.js, FR-079d).** A `.L` output owns a stored
  four-state value held in the same per-instance state map as `.R` registers
  (power-up **U**, FR-079). Unlike a register, it is not edge-clocked: alongside
  the register-latch phase of the step (below), for each `.L` output the engine
  evaluates its `.G` gate term over `curr`; while the gate is **1** (transparent)
  it captures the `.L` sum-of-products (the D input, over `curr`) into the store,
  while the gate is **0** it holds, and a **U** gate stores U (selective
  pessimism, FR-077); a true `.ARST` term forces the store to 0 first (async
  clear). The drive phase then presents the stored value exactly like a register
  (`evalOutput` handles `kind:"L"` identically to `"R"`, gated by any `.E`). Because
  the store is read from `curr` and written for the next step, a transparent latch
  follows its data with the same **one-unit delay** as every other element
  (FR-078) — no special ordering. Latch state persists across settling episodes
  (it is seeded only at build), so hold works under the live combinational
  scheduler with no scheduler change; the stateful classification matters only to
  the vector runner (§6.16, FR-115e).
- **Complementary outputs — convention, no language change.** A part that exposes
  both a true output and its complement on separate pins (74HC151 `Y`//`Y`,
  74HC175 `Qn`//`Qn`, 74HC165 `/Q7`) must **not** name the inverted pin `/Q0`:
  the signal-name rule (§7.6) strips the `/`, so `Q0` and `/Q0` would collide on
  one net. Name the inverted pin without a leading `/` (e.g. `Q0B`/`nQ0`) and
  drive it with a derived inverse equation reading the true net (`Q0B = /Q0`).
  The complement then lags its true output by one unit — invisible at human
  pacing — and no language extension is needed.
- **Buried registered nodes as virtual nets (FR-079c, `sim.js`).** The engine
  realizes a buried node (`compileBehavior` emitted an `.R` output with `pin:null`,
  above) as a **virtual net**: a net cell that carries a four-state value and
  double-buffers exactly like a real net, but is bound to no conductor. In
  `makeGalasmEntity`, after compiling, for each declared `typeData.internal` name
  the build **appends a placeholder net** `{ pins:[], members:[] }` to the `nets`
  array (so `curr`/`next`, `contribs`, the resolve loop, and `changed` detection —
  all sized/indexed off `nets.length` — cover it for free), records its index under
  a synthetic key `"<entityRefdes>.#<node>"` in `netOfPin`, and maps the node
  signal to that key in `pinOwner`. Nothing else changes: `readNet(node)` resolves
  the node → synthetic key → virtual-net index → `curr[i]`, the drive loop already
  does `add(pinOwner.get(out.signal), evalOutput(out,…))` so a buried `.R` output
  contributes its (single) driver onto its virtual net, `resolveNet` reduces that
  lone driver to its value (a buried node has no enable, so never Z; a power-up or
  uncertain node contributes **U**, which flows down the chain — FR-079c/FR-077),
  and `updateRegisters` latches it on the global clock like any `.R` output. Because
  the virtual net double-buffers, a buried node's value is **one unit delayed** and
  constant within a step — identical to a real pin net — so a self-feedback term
  (`Q.R = … + hold * Q`) reads the held value and a shift term (`Qi.R = … Qi-1`)
  reads the previous stage's *pre-edge* value; the chain advances exactly one stage
  per clock with **no special evaluation ordering** (FR-078). The placeholder nets
  never enter `conflictedConductors` (empty `members`) and are unreachable by
  `valueOfPin` (their key carries `#`, matching no `refdes.pin`), so buried state
  stays invisible, as required.
- **The 74HC165 model (the driving case, FR-079c).** Nexperia 74HC165 (Rev. 8,
  9 May 2025) Table 3, verified against the PDF: `PL`/ (pin 1) is an **asynchronous**
  active-low parallel load; `CE`/ (pin 15) is an active-low clock enable (a HIGH on
  `CE`/ inhibits `CP`; the internal clock is effectively `CP OR CE`/); the shift
  runs on `CP`'s LOW→HIGH edge while `CE`/ is LOW; only stage 7 is exposed, as `Q7`
  (pin 9) and `/Q7` (pin 7). It is modeled with `clock: CP`, seven buried stages
  `internal: [SR0..SR6]` for the hidden bits, `Q7` as the eighth (exposed) `.R`
  register, and its complement pin named `Q7N` driven `Q7N = /Q7` (the §6.13
  complementary convention — the pin is *not* named `/Q7`). Clock-inhibit and load
  are **folded into each stage's `.R` D-equation** via buried self-feedback (rather
  than a per-output `.CLK`, which is a single product term and so cannot express the
  `CP OR CE`/ clock): with signals `PL`≡pin `PL`/ and `CE`≡pin `CE`/,
  `SR0.R = /PL*D0 + PL*/CE*DS + PL*CE*SR0`, `SRi.R = /PL*Di + PL*/CE*SR(i-1) + PL*CE*SRi`
  for i=1..6, and `Q7.R = /PL*D7 + PL*/CE*SR6 + PL*CE*Q7`. **Two deliberate fidelity
  approximations, documented in the YAML header and consistent with the standing
  FR-079a/§8 position that the 74HC165's variable behaviors sit outside the dialect:**
  (1) parallel load is modeled **synchronously** — it rides a `CP` edge while `PL`/
  is LOW — whereas the real part loads asynchronously (the engine has no variable
  async-load primitive; `AR`/`SP` force only a fixed 0/1); (2) the clock is `CP`
  alone with `CE`/ folded as a synchronous hold, so the datasheet's secondary
  "shift on `CE`/'s rising edge while `CP` is LOW" path is not reproduced. The
  dominant behaviors — the eight-stage shift, `CE`/ inhibit-as-hold, and parallel
  capture followed by serial-out — are faithful.

**`sim.js` — engine:**
- **Interface:** `createSim({store, renderer, library}) → {run(), stop(),
  isRunning()}`. `run()`/`stop()` own the FR-076 transitions: toolbar relabel,
  `setAppState("simulating"|"editing")` (§6.11 status bar), and the store's
  transient `simulating` flag (§6.10). `run()` first `clearMessage()`s the tray
  (so a stale editing-time message is dropped before compile/start-up reports are
  posted), and on a successful start clears the selection (`store.setSelection([])`,
  locked during a run, FR-087); `stop()` `clearMessage()`s the tray again,
  dropping any leftover run-time message such as the selection-lock notice (FR-074).
- **Compile at Run:** `buildNets(design)` (§6.6) gives the net partition; build a
  `(refdes, pin) → net` map and per-net **driver lists**. Per instance: built-in
  → its `BEHAVIORS` entry (below); 74-series → `compileBehavior` of its
  `typeData` (so per-instance overrides ride along), cached per type name.
  **Subunit packages:** siblings sharing a U-number (§6.6) form one evaluation
  entity — each sibling's `typeData.pins` holds only its own unit's pins while
  the behavior block names pins across all units, so the siblings' pin lists
  are unioned for compilation and each signal's net is reached through the
  sibling that owns its pin. Preflight failures post to
  the message tray and refuse to start: a behavior parse error, or a behavior
  using `.R` on a type without `clock:` (FR-062d). Behavior-less types are
  reported once and their outputs drive U for the run (FR-080).
- **Step (1 unit = 1 simulated ns, FR-078):** (1) per registered instance,
  compare its clock net's `curr` value with the previous step's; on a 0→1
  transition latch each `.R` output's sum-of-products (evaluated over `curr`)
  into its register; in the same phase, for each `.L` transparent-latch output
  (FR-079d) update its store level-sensitively — capture the `.L` sum while its
  `.G` gate reads 1, hold while 0, applying any `.ARST` clear first (all over
  `curr`). (2) Evaluate every driver against `curr`. (3) Resolve every
  net into `next` (below). (4) Swap buffers, `simTime++`. Double-buffering makes
  the step order-independent: outputs respond exactly one unit after inputs.
- **Net resolution (FR-081–FR-083):** a **strength-priority** reduction
  (`resolveNet`). Each contribution is `{v∈{0,1,U}, weak}`; a Z driver contributes
  nothing (it is dropped before resolution). Choose the deciding **tier**: the
  strong (non-weak) contributions if any are present, else the weak ones — i.e.
  the *presence* of a non-Z strong driver, **regardless of its value**, suppresses
  all weak drivers (a strong U, e.g. a tristate output with an uncertain enable
  evaluated pessimistically to U per FR-081, still counts as strong and forces the
  net to U, not to the weak pull value, FR-083). Then resolve **within** that tier:
  both 0 and 1 present → **conflict**: value U, conductor flagged for red rendering
  (§6.8), reported on onset via the message tray naming two conflicting drivers,
  e.g. `bus conflict: U3.Q0 vs U7.B2` (FR-082); any U present → U; all agree → that
  value. Empty pool (no driver, or every driver Z) → Z. Thus a weak pull decides a
  net only when every strong driver is Z, and a pull-up xor pull-down gives 1/0
  while both kinds together (still weak tier) is a conflict (FR-083).
- **Switch elements — dynamic net merging (FR-083a, FR-071g/FR-071h):** the
  transmission gate and relay are realized as a third entity kind,
  **`kind:"pass"`** (`makePassEntity`; "pass" because `"switch"` is the input
  switch's renderType). Like memory they escape the source-only `BEHAVIORS`
  signature, but unlike every other entity they deposit **no contributions**: a
  closed contact makes its two terminal nets *the same net* for resolution. Each
  pass entity carries its control net index (`EN` or `COIL`) and a list of
  **contact records** `{a, b, closedWhen}` over terminal net indices — tgate:
  one contact `{A, B, closedWhen: 1}`; relay: two contacts `{COM, NO,
  closedWhen: 1}` and `{COM, NC, closedWhen: 0}` (the changeover pair,
  complementary by construction). The step loop (FR-078) changes only in its
  resolve phase: after every entity's contributions are deposited per net and
  **before** resolution, each pass entity reads its control from `curr` (same
  Z→U normalization as `readNet`, FR-077) — preserving the one-unit
  control-to-contact delay — and (a) for a 0/1 control, `union(a, b)` is applied
  in a per-step **union-find over net indices** for each contact whose
  `closedWhen` matches; (b) for a U control, each contact terminal's net index
  is added to a `forceU` list (an unknown contact position joins nothing).
  Resolution then runs **per root instead of per net**: contributions are
  bucketed by `find(net)`, `resolveNet` runs once per root over the pooled
  contributions (strength tiers, conflicts, and weak-pull rules all unchanged —
  FR-081–FR-083 apply across a closed contact for free), and the result is
  written to every member net's `next`; finally every group containing a
  `forceU` terminal is overwritten to U (FR-083a's conservative rule). A
  conflict in a merged group flags **every member net's conductors** for red
  rendering and names two offending drivers as usual (FR-082). When the design
  contains no pass entities the union-find degenerates to the identity and
  resolution proceeds per net exactly as today — no cost for ordinary designs
  (the build skips the pass machinery entirely when the entity list has no
  `pass` kind). Everything downstream needs no change: `valueOfPin` reads any
  member net's resolved value, indicators display it, quiescence detection
  (`next` vs `curr`) is unaffected, and a switch whose control depends on nets
  it merges oscillates into the existing 10,000-unit settle bound (FR-085).
  The rejected alternative — modeling a closed switch as two back-to-back
  conditional drivers — is recorded in §8: once both sides carry a value the
  switch's own reflection sustains it after the external driver releases, an
  unintended charge-storage latch; merging has no such artifact, and FR-083a
  declares isolated-node charge storage a non-goal (an isolated group resolves
  Z through the normal empty-pool rule). Vector runs (§6.16) build the same
  simulation and inherit all of this unchanged; switch elements contribute no
  columns (`deriveColumns` ignores them, FR-115b).
- **Built-in behaviors (FR-067a):** the `BEHAVIORS` registry entries (§6.11)
  take the uniform signature `behave(ctx) → [{pin, value, weak?}]` with `ctx =
  {props, simTime, clockPeriod, state}`: **clock** returns its FR-084 waveform —
  low for the first half of each `period`, high for the second, so the first
  rising edge lands half a period in; **pull-up/pull-down** return their constant
  weak 1/0; **indicator** returns nothing (display only); **power-on reset**
  (FR-071b) drives `R` 1 and `/R` 0 while `simTime < cycles × clockPeriod`,
  the inverse afterward; **input switch** (FR-087a) strong-drives `OUT` to the
  logic value of `state` (`"1"`→V1, else V0). `props` carries
  effective values: `overrides.props` else the declared default (FR-020b).
  `state` is the live `inst.switchState` (§6.11), supplied so a click during
  a run takes effect the next step; the simulator entity therefore retains its
  source `inst` reference for built-ins. `clockPeriod` is resolved once at Run:
  the effective `period` of the design's clock instance when exactly one is
  placed, else the 100 ns FR-071a default (no clock, or several — FR-071b).
- **Memory entities (FR-114d):** a generated RAM/ROM (`inst.typeData.mem`, §6.11)
  is neither a `builtin` nor a GALasm part, so the entity loop routes it to a
  third `kind:"memory"` entity (`makeMemoryEntity`) wrapping the pure
  `createMemoryCore` (`engine/memory.js`) — the **first** built-in behavior that
  reads input nets, which the source-only `BEHAVIORS` signature can't do. The
  entity injects a `read(pinName)` returning the **previous** step's net value
  (`curr`, exactly like the galasm `readNet`), so the device follows its inputs by
  one unit (FR-078). `step()` calls each memory's `core.writeStep(read)` in the
  same pre-phase as register latching (a RAM latches the addressed cell on the
  WE/ 0→1 edge, sampling `curr` address+data), then in the contribution phase a
  `kind:"memory"` branch adds the `core.dataDrive(read)` values onto `D0..D(w-1)`
  (or nothing, for high-impedance). The core is the FR-114d truth table over the
  four-state values (`norm` maps a read Z→U); cells default undefined (read U) at
  Run — RAM contents reset each Run, and a ROM is seeded from its content file
  (FR-114e, below). Memory does not use or require the global clock (`hasClocks`
  ignores it); its writes are driven by the design's own `WE/` signal.
- **ROM content loading (FR-114e):** `createSim.run()` is **async**: before
  building, `loadRomContents(design)` collects each distinct `kind:"rom"` instance's
  `romFile`, fetches its bytes from the server (`api.readRomFile` → `GET /romfile`),
  and parses them by extension (`parseRomBytes`: `.bin` verbatim; `.hex` via
  `parseHexBytes` — whitespace-separated hex byte tokens) into a `Map<path,bytes>`
  passed to `buildSimulation` as `romContent`. `makeMemoryEntity` seeds a ROM core
  with `core.loadBytes(bytes)`, which packs the byte stream **little-endian** into
  `ceil(w/8)`-byte words (width 4 = low nibble) masked to `w` bits. A missing /
  wrong-type / malformed file is reported (FR-074) and that ROM reads U; over-capacity
  content is truncated with a report. A `starting` flag guards the async window
  (re-entrant `run()` is a no-op; `stop()` clears it to cancel a pending start).
  Only the **path** is saved with the design — editing the file and re-running
  reloads it.
- **RAM persistence (FR-114g):** a `kind:"ram"` instance may carry a per-instance
  `ramFile` (save-file path) and `ramLoad` (load-on-start) in its `mem` block.
  **Load** rides the same async pre-Run window as ROM: a separate
  `loadRamContents(design)` (sibling of `loadRomContents`, both delegating to a
  shared `fetchMemFile`) fetches the `ramFile` of each RAM whose `ramLoad` is set
  (same `GET /romfile`, `parseRomBytes`) into a `ramContent` map, and
  `makeMemoryEntity` seeds the RAM core with `core.loadBytes(bytes)` before the
  first step instead of leaving it all-U (a missing / wrong-type / malformed file
  is reported per FR-074 and the RAM stays all-U — non-fatal, so a first run with
  no file yet still runs). It is a **distinct** build option from `romContent` and
  the **vector runner never passes it** (§6.16), so a vector run cannot load a RAM
  save even though it shares `buildSimulation`. **Write** hangs
  off the interactive `stop()`: before tearing down, `saveRamContents(sim.persistentRams())`
  walks each `kind:"ram"` instance with a `ramFile` (the sim exposes them via
  `persistentRams()`), takes its full byte image via `core.dumpBytes()` — the
  inverse of `loadBytes`, `ceil(w/8)` bytes per location little-endian, each cell
  masked to `w` bits with **U written as 0** (the byte format has no U) — formats
  it by extension with `ramFileBody` (`.bin` = raw bytes; `.hex` = space-separated
  two-digit hex tokens), and POSTs it to `POST /ramfile` (`api.writeRamFile`,
  fire-and-forget: a write failure is reported via FR-074 but does not block the
  return to editing). Only the
  **path** and `ramLoad` flag are saved with the design (FR-060). This runs **only**
  on an interactive Stop: the vector runner (§6.16) builds its own throwaway sim,
  passes neither load nor the stop-write hook, and resets RAM per row (FR-115c), so
  a vector run never touches a save file. The fast C generator refuses a design
  whose RAM has a `ramFile` (cgen, alongside the switch-element refusal, FR-116).
- **External stimulus (FR-115f):** `buildSimulation(design, { romContent, stimulus })` accepts an optional `stimulus` — a list of `{ refdes, pin, value }` (`value` ∈ `V0`/`V1`). Each `step()`, after the entity contributions are gathered, the build adds every stimulus entry as a **strong driver** on the net containing `(refdes, pin)`, through the same `add(...)` path a switch built-in uses — forcing that net to `value` with no component placed. It is the input-driving half of test-vector **port binding** (§6.16): because a port pin is a net member (FR-094e), forcing `(portRefdes, "P"/"Pi")` drives the interface net. The live editor run passes no `stimulus` (it drives inputs through switch built-ins, FR-087a); the vector runner passes a per-row list (§6.16).
- **Scripted clocks (FR-115e):** `buildSimulation(design, { scriptedClocks: true })` suppresses the **time-based** built-in behaviors — the clock's simTime square wave (FR-084) and the power-on reset's simTime window (FR-071b), i.e. entities with `renderType` `"clock"` or `"reset"` contribute no drive — so the sequential vector runner (§6.16) owns those nets, driving them through the stimulus mechanism as scripted levels. The returned sim also exposes **`setStimulus(entries)`**, which replaces the stimulus list between steps: a long-lived sequential run re-drives its inputs row by row (and phase by phase within a `C` pulse) without rebuilding. The live editor run passes neither option; `scriptedClocks` without stimulus entries for the clock nets leaves them undriven (Z), which no caller does.
- **Scheduler (FR-084–FR-086):** both kinds run until `stop()`; neither
  auto-terminates. No clock instance placed → combinational: a *settling
  episode* runs steps unpaced (batched, with periodic yields to keep the tab
  live) until `next` equals `curr` (quiescent) or the 10,000-unit per-episode
  bound (report once via message tray — likely oscillation), then **idles** —
  no timer scheduled, no CPU — leaving the run active (FR-085). `wake()`
  (below) starts a fresh episode when an interactive input perturbs the design;
  the episode step counter is local so the bound is per-episode, not cumulative.
  Clock(s) present → sequential: target rate = max over clocks of effective
  `period × speed` units per wall second; a `requestAnimationFrame` loop advances
  `round(rate × dt)` steps per frame (capped to keep frames responsive), requests
  a render when any net changed, and runs until `stop()` (FR-086).
- **Pause & single-step (FR-076a/FR-076b):** the sequential engine additionally
  exposes `pause()`, `resume()`, `stepUnit()`, and `stepCycle()`, driven by the
  toolbar's pause/step cluster (§6.11); a combinational run exposes none of
  this (the cluster is not shown, FR-076a). `pause()` sets a paused flag read
  by the rAF loop, which then advances 0 steps (simulated time freezes at a
  unit-step boundary; the loop may equally cancel the rAF and re-request on
  resume) and sets the state tray to `paused` (§6.11 `setAppState`). While
  paused: `stepUnit()` advances exactly one unit step and renders;
  `stepCycle()` computes the primary clock's next rising-edge time
  `tEdge = min{ period/2 + k·period > simTime }` (the refdes from the
  design-level `primaryClock` field, §7.2; effective period per FR-071a),
  advances unit steps to `simTime = tEdge`, then keeps stepping until
  quiescence (`next` equals `curr`), stopping early at one unit before the
  next scheduled edge of **any** clock generator (min over all clocks of the
  next `k·period/2` boundary) and bounded by the FR-085 10,000-unit episode
  bound (tray message once, remain paused); `resume()` clears the flag,
  re-anchors the pacing baseline to the paused simTime (so the wall-clock rate
  math doesn't try to catch up the paused interval), and restores the
  `simulating` tray text. Steps run synchronously (a step-cycle settle is at
  most 10,000 units — well inside a frame). `stop()` while paused is the
  ordinary Stop path (FR-076, including the RAM write-back hook, FR-114g).
- **Interactive inputs (FR-087b):** the engine subscribes to the store's
  live-input channel (§6.10) for the duration of a run. `applyLive` (the
  non-undoable sim-time mutation behind a switch click, FR-087a) fires that
  channel; the engine's listener calls `wake()`. For a combinational run `wake()`
  re-runs a settling episode if idle (no-op if an episode is already in flight);
  for a paced run it is a no-op (the rAF loop already re-reads instance state
  each step) — including while **paused** (FR-076a): the click's mutation sits
  in the instance state until the next unit step (a Step or Continue) reads
  it, which is exactly the queued semantics FR-087b specifies, with no
  scheduler change. This is the general re-evaluation path — not switch-specific — so a
  new interactive built-in (an `INTERACTIONS` handler, §6.11) needs no scheduler
  change.
- **Display view:** the engine publishes `state.sim = { valueOfPin(refdes,
  pinName), conflictedConductors }` (transient, §6.10) consumed by the renderer
  (§6.8) for indicator glyphs and red conflict strokes. `stop()` retains the
  view so final values stay visible (FR-085); the store clears it on the next
  design-modifying dispatch.
- **Error handling:** a behavior evaluation throw (a compiler bug, not author
  error — author errors are caught at preflight) stops the simulation with a
  message rather than killing the rAF loop.
- **Dependencies:** `model/netlist.js`, store, `builtins.js`, `chrome/statusbar.js`.
  No server involvement: the slow simulator is entirely client-side (FR-075).

### 6.14 JS: sub-designs, ports & off-sheet connectors (`web/js/model/subdesign.js` + builtins/dialogs/interaction/canvas/sim)
- **Purpose:** hierarchical embedding (a child design placed as a single component) and flat multi-sheet wiring (peer sheets joined by labelled off-sheet connectors). Implements requirements §3.22.
- **Satisfies:** FR-094–FR-103, FR-060b.
- A new pure module `model/subdesign.js` holds the interface/flatten helpers; rendering lives in `canvas.js` (§6.8), the dialog in `dialogs.js` (§6.11), placement/navigation in `interaction.js` (§6.9), flattening is consumed by `sim.js` (§6.13). New commands (`PlaceSubDesign`, `SetPortProps`, `SetDefaultRender`) follow the §6.10 pattern.

**The port built-in (FR-094/FR-094a).** A port is an ordinary built-in instance (`builtins.js`, §6.11): a synthetic `ComponentType` `name:"port"`, `builtin:true`, one **one-bit** connection pin. It carries per-instance fields beyond the usual ones (the `switchState` precedent, §6.11): `label` and optional `target` (`{file,label}`, FR-101), user-set and round-tripping with the instance (§7.2), plus `portDir` (`in`|`out`|`bidir`) which is now a **derived** value (FR-094c) — computed from the wiring by `portDirection`, and written at save (`fileops.save`) rather than hand-edited — and an optional `dirOverride` (`in`|`out`, FR-094d). The port's **effective direction** is `effectivePortDir(design, refdes) = (portDirection(...) === "bidir" && inst.dirOverride) ? inst.dirOverride : portDirection(...)` (a small helper beside `portDirection`); this effective value is what is saved and what every consumer reads. The properties panel shows the direction **read-only** when the derived value is definite (`in`/`out`); only when it is `bidir` does it render an editable in/out/bidir selector that writes `inst.dirOverride` (clearing it when set back to `bidir`), carried by the existing `SetPortProps` command. A 1-wide port has **no width** field (superseded — a pin is one bit; multi-bit interfaces are portN, FR-071e). The port's connection point is a `connector` **vertex** (§7.1a): like a `pin` vertex its position derives from the instance (so wires to it stretch for free), but its kind marks it for the netlist's label rules. `drawComponent` gains a `port` branch (`drawPort`) — a **pentagon** "flag" (FR-094b): the flat back edge sits on the connection-pin side, and the body tapers to an apex pointing **off-sheet** (opposite the pin). The pentagon is built in the instance's local grid frame and projected through `rotateOffset`, so it rotates with the instance and the apex↔pin relationship holds (FR-020); the label is drawn upright at the body center (FR-015), with a small filled triangle at the apex when it carries a `target`. Ports get `A-<n>` refdes via `addInstance` (FR-011a). **Target editing (FR-101b, added 2026-07-08):** for a 1-wide port the properties panel (§6.11 `properties.js`) shows two text fields, **target file** (relative to the design's save directory) and **target label**, patched via the same `SetPortProps` command as `label`/`dirOverride`; a non-empty file yields `inst.target = {file, label}`, a cleared file yields `target: null`. portN shows no target fields (deferred, FR-071e).

**Interface resolution (FR-095).** `designInterface(childDesign) → InterfaceSignal[]` returns one `{label,dir,width}` per distinct port — both 1-wide `port`s (`width:1`) and multi-bit `portN`s (FR-071e, `width:N` = its `P` pin-group size) — keyed by label and ordered by label; the first port seen for a label wins on a disagreement. Here `width` is the **signal's** bit count, not a pin attribute — a pin is always one bit. Each signal's `dir` is **derived from the child's wiring** by `portDirection(design, portRefdes)` (FR-094c), not read from a stored `portDir`: it builds the child's nets (`buildNets`) and inspects the non-port pins on the relevant net(s) — any `bidir`/`tristate` pin → `bidir`; else any plain `out` driver → `out`; else `in` (also when unconnected). For a 1-wide port the net is found by **label** (the connector pin is now also a net member, FR-094e, but label lookup remains the direction-derivation path); for a `portN` the direction is **aggregated across its bit nets**, found by the port's `P0..P(N-1)` pin keys (which *are* net members, joined through the snapped bus/wire). `designInterface` then applies the port's `dirOverride` (FR-094d) — so a derived-`bidir` signal carrying an override reports `in`/`out`, and the dir returned is the **effective** direction (the override is ignored unless the derived value is `bidir`). `synthTypeForInterface(iface, render) → ComponentType` builds an **in-memory, never-saved** synthetic `ComponentType` whose pins are all **one bit**: a `width:1` signal becomes one pin named by its label; a `width:N` signal **expands into N pins** `<label>0`..`<label>(N-1)` (contiguous, in bit order) **plus a `pinGroups` entry** named `<label>` so a matching-width bus snaps to it through the ordinary group machinery (FR-041/FR-042). Pins are laid out per render style (`ic`: `out` right, `in`/`bidir` left; a signal's expanded pins stay together on one side). This is the key reuse: a sub-design instance carries this synthetic `typeData` in memory, so `pinWorldPos`, vertices, wire endpoints, bus snap, hit-testing, and the rectangle renderer all work **unchanged** (§6.6–§6.9). A child with no ports has an empty interface and cannot be embedded (FR-097a).

**The ADD flow (FR-097/097a/097b).** `builtins.js` exposes a single non-placeable lower-palette entry **ADD**. Arming it and clicking (or dropping it on) the canvas opens the **Add sub-component dialog** (`dialogs.js`) at the grid point instead of creating an object. The dialog: (1) navigates/loads a child via `/api/v1/files`+`/design/load` (§6.4); (2) shows the child's `defaultRender` (§7.2) and resolved interface; (3) offers an `ic`/`connector` choice defaulting to `defaultRender`. OK → dispatch `PlaceSubDesign(childPath, render, @grid)`; Cancel → nothing; both return to SELECT (one-shot, FR-010). `childPath` is held **absolute in memory** (the picked child's absolute path) and relativized to the parent's save dir only at save time (§7.4), so embedding **does not require a saved parent** and shows no save prompt (FR-097b). The dialog rejects an interface-less file, a self/cyclic embed (`wouldCycle`), and — FR-121d — a file **outside the current project directory** (`fileops.addSubDesign` checks containment against `store.state.project.dir` before the cycle check; §6.19), each with a message. Its picker is seeded at the project root (FR-121h) under the usual FR-052a remembered-directory rule.

**The New GAL part flow (FR-066b/066c/007a).** `builtins.js` exposes a non-placeable upper-palette action **New GAL part** (a tile that opens a dialog rather than arming placement). The **New GAL part dialog** (`dialogs.js`) renders the device's fixed skeleton — for the GAL22V10, the 24-pin map (pin 1 clock/in, 2–11 + 13 in, 14–23 OLMC I/O, 12 GND, 24 VCC) — and collects only the per-part data: `partnumber`, optional `description`, a label per I/O pin, a per-OLMC direction (in / comb-out / reg-out), optional named pin groups (FR-066d, below), and the `behavior` block. As the user types, the dialog assembles a candidate `typeData` (`type:"22V10"`, `gal:"GAL22V10"`, an immutable `id` generated from the `partnumber` (FR-066e), the chosen `pins`, the `behavior`) and runs `galasm.js` `compileBehavior`+`validateStrict` (§6.13) **live**, surfacing the same accept/reject diagnostics Run would (FR-079b) — the dialog reuses that one gate, adding no second validator. OK serializes the `typeData` to YAML client-side and `POST`s it to `/api/v1/components` **with the current project dir** (`store.state.project.dir`), so the server writes the `.yaml` under `<project>/components/` (FR-007a/FR-121i); on success it dispatches the live palette add (above) and returns to SELECT (one-shot, FR-010). A duplicate-`id`/existing-file 409 — collision against the project `components/` **or** the shared library (FR-121i) — or validation error is shown in the dialog; Cancel discards. Placement of the resulting tile is then ordinary FR-008/FR-009.

**Pin-groups sub-dialog (FR-066d).** A "Pin groups…" button opens a modal sub-dialog (`dialogs.js`) that edits the part's named pin groups (FR-063). It lists the groups defined so far (each with a remove control) and offers a name field plus a checkbox per pin (labeled with the pin's *current* label) to define one more; "Add group" appends it to the working list, and the sub-dialog returns the updated list to the parent on close. Membership is stored by the **skeleton pin** (its stable DIP `number`), not the label string, so a later rename does not break a group; `galPartYaml` resolves each member to its current label and emits members in **pin-layout order** (the part's pin order, top-to-bottom) so the bus bit order is deterministic (FR-066d). The parent dialog folds the groups into the candidate `typeData` only for the YAML write (a `groups:` block, §7.3) — groups do not enter `compileBehavior`/`validateStrict`. Client checks: non-empty unique name, ≥1 member, and the **geometry rule** (FR-063a) — the checked pins must share one side and form a contiguous run (no non-member pin between them); the sub-dialog rejects an "Add group" that straddles sides or is interrupted, so it can only build groups the brace can render. Membership is by skeleton DIP number, but the side/contiguity test resolves each member to its skeleton pin's side/`pos`.

**The memory-device generator (FR-114/FR-114a/FR-114b/FR-114f).** A second non-placeable **upper-palette** action tile, **NEW MEM** (built beside the New GAL part tile, labeled **NEW GAL**, in `app.js`, routed through interaction's palette-click handler to an `onNewMemDevice` callback exactly as `newgal` routes to `onNewGalPart`). Its callback opens the **New memory device dialog** (`memDeviceDialog`, `dialogs.js`). The dialog's top control is a **RAM/ROM** radio (default RAM); below it a common **name** field and a **dynamic region** holding the class-specific controls, fully rebuilt whenever the radio changes (FR-114 "completely re-initializes"): for both classes an **address-bits** number field *n* (1–24) with a live "= 2ⁿ locations" readout and a **data-width** select {4,8,16,32} (default 8); for ROM only, a **content-file** row — a "Choose file…" button that opens the server-side file browser (`openFileDialog`, FR-053, reused with a custom title) and a label showing the chosen path; for **RAM** only, an **optional** persistent **save-file** row — a "Choose file…" button (save-mode `openFileDialog` with `saveExts:["bin","hex"]`, so a typed `.bin`/`.hex` is honored and a bare name gets the `.bin` default — no `.hex.bin` doubling), a **Clear** button, and a path label — plus a **"Load save file at start-up"** checkbox (FR-114g). The **name** field (FR-114a) is common (it survives a class switch); it is pre-seeded with a size-based suggestion (`suggestName`, e.g. "RAM 256×8") that keeps tracking the class/size/width until the user types into it (a `nameEdited` flag then freezes it). A class switch re-initializes the file controls (both `romFile` and the RAM `ramFile`/`ramLoad` are discarded). `gather()` returns `{ name, kind:"ram"|"rom", addressBits, locations:2**n, dataWidth, romFile?, ramFile?, ramLoad? }` (the RAM fields only when a save file is chosen); a pure `validateMemSpec(spec)` helper (testable, no DOM) gates **Create** — name non-empty, *n* in range, width in the set, a ROM file chosen for ROM, and a RAM save file (if any) ending `.bin`/`.hex`. The RAM save file is **optional** and never blocks Create. The radio, fields, name, and file selection re-run validation live. OK resolves the gathered+validated spec to `app.js`, whose `onNewMemDevice` builds the type with `memDeviceType(spec)` (below), serializes it to component YAML with `memDeviceYaml(type)` (a `mem:` block plus the explicit pinout, §7.6/FR-114f), and **persists** it through the same `createComponent` POST the GAL flow uses — now carrying the current project dir so the server writes under `<project>/components/` (FR-007a/FR-121i) — returning the parsed type, which `addCreatedPart` joins to the library + sorted upper-palette tile. A duplicate name (hence `id`) or an existing file — in the project `components/` **or** the shared library (FR-121i) — is rejected by the server (409); `createComponent` throws and `memDeviceDialog` surfaces it inline (the dialog stays open). A built-in id collision (built-ins are not in the server library) is still caught client-side before the POST. A placed device **simulates** via the built-in memory behavior (FR-114d, §6.13), and a ROM's content is loaded from its file at Run (FR-114e). The ROM picker calls `openFileDialog` with `exts:["bin","hex"]`, so the server file browser lists those (and dirs) rather than designs. Both memory-file pickers (ROM content, RAM save) are seeded at the **current project root** (FR-121h; `onNewMemDevice` reads `store.state.project.dir` at invocation, superseding the static `defaults.dataDir` seed) but may navigate anywhere on disk — data files are exempt from the project boundary (FR-121d). **Cross-session persistence (FR-114f, was deferred per FR-114b/OQ-013):** the generated metatype is now written to the component library as a `.yaml` artifact carrying its `mem:` block, so it survives reload and Refresh Types (FR-088); on load the built-in behavior binds from that serializable `mem` data (not session-only code), and a *placed* instance still also round-trips via its embedded `typeData` (FR-057).

*Generated pinout (FR-114c, `memDeviceType` in `builtins.js`).* From `{name, kind, addressBits:n, dataWidth:w, locations}` it synthesizes a `ComponentType` rendered as an ordinary IC rectangle (§6.8): **left** edge top-to-bottom = `A0…A(n-1)` (an `ADDR` pin group, FR-063) followed by `CE/`, `OE/`, and — for RAM — `WE/` (the controls trail the address run so they don't break its contiguity, FR-063a); **right** edge = `D0…D(w-1)` (a `DATA` group). Address and control pins are `in`; data pins are `bidir` for RAM and `tristate` for ROM (FR-062a). The outline mirrors the server's `resolveOutline` (§6.3) — width 4 (no top/bottom pins), height = max-edge-position + 2. The type is **not** `builtin` (so it gets a U-series refdes and the default labelled-rectangle render with pin names, §6.8), takes the free-form `name` as its display name with the derived `id` `type-<name>` (FR-066e, the same rule loaded/GAL parts use — so a duplicate name is rejected by the create endpoint), and carries a `mem:{kind,addressBits,dataWidth,locations,romFile?,ramFile?,ramLoad?}` block driving the built-in behavior (FR-114d) and round-tripping through YAML persistence (FR-114f/FR-114g, via `memDeviceYaml` in `dialogs.js`). Pure, no DOM.

*Generated behavior (FR-114d), implemented in `engine/memory.js` + `sim.js` (§6.13).* Memory is the first built-in whose behavior **reads** its input nets and keeps per-instance state, which the source-only `BEHAVIORS` signature (§6.11) can't express — so it lives in a dedicated `createMemoryCore({kind,addressBits,dataWidth})` and a `kind:"memory"` simulator entity rather than the `BEHAVIORS` registry. ROM content loading from the chosen file is implemented (FR-114e), and cross-session metatype persistence is implemented (FR-114f, via a `mem:` YAML block) — both formerly open under OQ-013.

**Sub-design instance (FR-098/098a/099).** An entry in `design.components` with `kind:"subdesign"`, `childPath`, `render`, `iface` (the last-resolved interface record, FR-099c), `x`, `y`, `rotation`, and an `X<n>` refdes — a third series beside U and A, allocated by the shared FR-011c high-water rule (`allocRefNum`, §6.6; FR-098a); a child may be embedded repeatedly as independent X-instances. It stores **no** `typeData` (supersedes FR-057 for it); its in-memory `typeData` is the synthetic interface type, recomputed on load and whenever the child changes (FR-099b). Rendering (`canvas.js`, §6.8 dispatch on `kind`): `ic` — the existing rectangle over the synthetic type (inputs left, outputs right, pins labelled by port label, `X1` + child base name upright); `connector` — a tall narrow rectangle with all interface pins ranked along **one** long edge in label order (OQ-010). Both are purely cosmetic (same interface, same connectivity, FR-099); a multi-bit interface signal appears as a **pin group** of one-bit pins (bus snaps to the group, FR-041/FR-039a). A child that fails to load renders as a **broken-link placeholder** (a red box naming the missing relative path), reported once via the message tray (FR-099a), reusing §6.8's unknown-type placeholder.

**Navigation & back-stack (FR-100/100a).** Descending into a sub-design instance (double-click, or context-menu "Open sub-design") navigates to the instance's **absolute** `childPath` directly (no longer resolved against the parent dir, since the in-memory path is already absolute); following an off-sheet connector — **double-clicking a port whose `target` is set, or its context-menu "Follow off-sheet connector"** (FR-101; a plain click just selects) — calls `fileops.followTarget(target)`, which resolves the target — a **bare sibling filename in the same folder** (FR-101) — to an absolute path against the current design's save dir (`resolveRel(dirOf(savePath), target.file)`, unchanged since a bare name simply resolves within that same directory), first prompting to save a never-saved design exactly as `descend` does (resolving the sibling name needs a directory, and back needs a file), and on success pushes the referring sheet onto the back-stack like a descent (FR-100a). (Gesture and `followTarget` implemented 2026-07-08 — FR-101b; previously specified but never wired.) Both perform a **navigation** = the existing Open flow with the FR-049a unsaved-changes guard (save or discard before the canvas is replaced). Because **back** re-opens the parent from its file, descending while the parent is unsaved first prompts to save it (FR-100a interim); declining cancels the descent. `app.js` keeps a transient `navStack` of absolute paths recording the descended chain; a breadcrumb in the chrome offers **back**, popping and re-opening the parent (itself save-or-lose). The stack is session state — not persisted, not on the undo stack.

**Connectivity (FR-094a/FR-101a).** Within one open design `buildNets` (§6.6, step 6) unions lanes of `connector` vertices whose port shares a `label` (per bit for `width>1`), so same-label ports are one net with no drawn wire. Cross-file continuation is **not** applied in single-design `buildNets` (the editor edits one sheet at a time); it is composed only when the simulator assembles the sheet graph (below), and only across the **explicit** `target` links — never by coincidental label equality between unrelated files.

**Flattening for the simulator (FR-102/102a/103) — `flatten` in `subdesign.js`.** `flatten(rootDesign, loadChild, { rootPath }) → Promise<FlatDesign>` (async: children and peer sheets load through the injected `loadChild(absPath) → Promise<savedObject>`, the same `/api/v1/design/load` reader `resolveSubDesigns` uses) produces a plain simulation-only design — never rendered, never saved — that feeds the existing `buildNets`+evaluation pipeline (§6.13), and later the C generator (§6.17), unchanged. A design with no sub-design instances and no `target` links flattens to itself (identity pass), so the single-sheet path stays fast (NFR-005). (Reworked 2026-07-04; supersedes the earlier sketch of this block — mechanism made concrete: id/label prefixing, attachment-rewrite stitching, synthetic link wires, peer cycles legal.)
  - **Expansion (FR-102).** Depth-first over sub-design instances: each `X<n>` instance is replaced by a deep copy of its deserialized child's components/wires/buses/vertices with every `refdes` **and every wire/bus/vertex id** prefixed by the instance path (`X1/`, `X1/X2/`, …). Refdes prefixing keeps `refdes.pin` identity unique; id prefixing keeps copied conductors/vertices from colliding with the parent's ids (and keeps `conflictedConductors` from ever matching — hence falsely highlighting — a top-sheet conductor). Nested sub-design instances recurse with the accumulated prefix.
  - **Label namespacing (FR-102).** Copied port **labels** are prefixed the same way (`X1/CLK`): `buildNets`' label-union rule (step 6, FR-094a) then still unions same-label ports *within* one instance but never across instances or with the parent (FR-101a within the hierarchy). Hierarchical net names in conflict/indicator messages fall out of this for free.
  - **Interface stitching (attachment rewrite).** For each interface signal, the child's owning port (the first port carrying the label, matching `designInterface`) defines a target connection pin — the 1-wide port's single pin, or the portN's `Pk` for bit `k`. Every parent attachment on the instance — a `pin`/`connector` vertex with `ref === "X1"`, and a bus `groupConnections` entry with `instance === "X1"` — is rewritten in place to the prefixed target (`ref:"X1/A1", pin:<port pin>`; `gc.instance = "X1/A5"` with `bitMap` renamed to `Pk`). `buildNets`' shared-pin union (step 5) and the connector's FR-094e pin attachment (step 6) then merge the parent lane with the child's port net — no new netlist machinery, and no geometry (a FlatDesign is never drawn, so vertex positions are irrelevant).
  - **Off-sheet connectors (FR-101/103).** After embedding, follow every port `target` transitively (each `target.file` is a bare filename in the **same folder** as the referencing sheet, FR-101, so it resolves within that sheet's directory), de-duplicating loaded files by absolute path; each distinct peer sheet is merged under a per-sheet tag prefix (file base name, numeric suffix on a collision; the root sheet unprefixed) applied to refdes/ids/labels exactly as above. Each declared link then becomes a **synthetic two-node wire** between the two ports' connector vertices — the ordinary wire-lane union implements the cross-file net (FR-101a). Mutual peering (A↔B) is legal (FR-102a): de-dup bounds it.
  - **Cycles (FR-102a).** A visited-set of absolute file paths along the current expansion path detects an embed of an already-open ancestor — including via a `target` that leads back into one — and `flatten` throws; the sim run and the vector runner refuse with a message-tray report. The ADD dialog refuses via a `wouldCycle(childAbsPath, parentAbsPath, loadChild)` helper that walks the candidate child's transitive embeds (FR-097a).
  - **Consumers (§6.13/§6.16).** `createSim.run()` awaits `flatten` first and feeds the FlatDesign to `loadRomContents` + `buildSimulation`, so child ROMs preload (their `mem.romFile` paths are stored absolute, §6.14 persistence) and child built-ins (clock, POR, pulls, switches) participate; child switches/indicators have no top-sheet UI presence — their effect is electrical only. The FlatDesign **shares the root's component objects** (cloning only what flatten rewrites: wires/buses/vertices, plus shallow copies of the sub-design entries it replaces), because the running sim reads mutable interactive state off the retained instances — top-sheet switch clicks (FR-087b) must stay live during a run. Vector runs flatten at the caller: the panel's Run/Capture (`dialogs.js`) flatten before `loadRomContents` + `runVectors`/`captureVectors`, keeping the runner itself synchronous and design-agnostic; the runner refuses a **hidden clock** — a clock generator whose refdes is hierarchical (inside a child/peer) — since scripted-clock mode (FR-115e) drives clocks by top-sheet columns only. The FR-107 parity harness flattens its slow leg the same way (cgen milestone), so hierarchical parity pairs depend on this. `SUBUNIT_PKG_RE` (§6.13, and its `cgen.js` twin) becomes hierarchical-prefix-tolerant — the package key is the full prefixed stem (`X1/U3`), so a child's subunits group within their own instance and never across instances.
- **Loading (FR-098/099a):** on opening a design, `fileops` (`loadIntoStore`) converts each sub-design's stored **relative** `childPath` to **absolute** against the opened file's directory — and likewise absolutizes relative **mem data paths** (`typeData.mem.romFile`/`ramFile`) via `absolutizeDataPaths` (FR-121g, §6.19/§7.4) — then `resolveSubDesigns` loads each child (by its now-absolute path) far enough to resolve the interface for rendering; failures yield broken-link placeholders, never aborting the open. A child reference that resolves **outside the project directory** (a legacy design, FR-121d) still loads and renders normally but is reported once per offending path via the message tray (FR-074); after any successful load the containing-folder rule may switch the current project (§3.1 A10, §6.19). After load the model holds absolute paths. Deep child contents load lazily — only `flatten` (at Run) needs them. As its final step `loadIntoStore` invokes an `onLoaded` callback (wired in `app.js` to `interaction.fitToScreen`, FR-022a) so every completed load — Open and hierarchy navigation alike — frames the design in the viewport; the callback runs after `replaceDesign`, once the new geometry exists.
- **Interface-change re-route (FR-099c):** each instance carries `iface` — the `designInterface` array it was placed/last saved with (`addSubDesignInstance` sets it; §7.2 persists it; the comparison record FR-099c allows, never used for rendering or simulation). `resolveSubDesigns` deep-compares the freshly resolved interface against it: on a difference it updates `iface`, reports the instance, and returns the changed refdes list (`{ changed }`). `loadIntoStore` then calls `rerouteAttachedWires(design, changed)` (`engine/router.js`): for every **simple** wire — a two-point path whose ends are both `node` refs and which passes through no junction vertex — with an endpoint `pin`/`connector` vertex on a changed instance, propose a fresh route between the endpoints' derived world positions (escape vectors from the pins' rotated sides, as interaction's `routerEndpoint` does) and replace the wire's interior points, keeping the endpoint node refs; a null route keeps the old bends. Runs before `store.replaceDesign`, so like the FR-099b dangling rewrite it is load-time normalization — no command, no undo, no dirty mark. An instance with no stored `iface` (a pre-FR-099c file) skips the comparison and gains the field at the next save.
- **Persistence:** no Go change is needed — the server already stores designs as an opaque `json.RawMessage` (§6.5), so the new instance fields (`kind`/`childPath`/`render`/`iface`/`label`/`portDir`/`dirOverride`/`width`/`target`), the design-level `defaultRender`, and the `connector` vertex kind round-trip untouched (`iface` is additive-optional like `defaultRender`/`target` were — no `formatVersion` bump). Only the client model (`model/design.js`, `model/persist.js`) is typed; `persist.js`'s structural sanity pass (§7.4) validates a `connector` vertex's `ref`/`pin` exactly as it does a `pin` vertex. The in-memory `childPath` is absolute (FR-098); **`fileops.save` relativizes** each sub-design's `childPath` against the chosen save dir just before writing — and, by the same absolute-in-memory / relative-on-disk rule, each **in-project** mem data path via `relativizeDataPaths` (FR-121g, copy-on-write like the portDir stamping, so the live model keeps its absolute paths) — and **`loadIntoStore` absolutizes** on open — so the on-disk file stays relative/portable while the live model is absolute. `serializeDesign` itself round-trips `childPath` verbatim (a backup snapshot, §7.4, thus stores the absolute path, correct for same-session recovery). Child files are read through the existing `/api/v1/design/load` with client-resolved absolute paths.
- **Dependencies:** `model/design.js`, `model/netlist.js`, `api.js`, store, `chrome/dialogs.js`, `engine/canvas.js`, `engine/sim.js`.

### 6.15 JS: clipboard — copy & paste (`web/js/model/clipboard.js` + interaction/canvas/chrome)

- **Purpose:** duplicate a sub-circuit (components + their interior wiring) within a design. Implements requirements §3.5a (FR-111–FR-113).
- **Satisfies:** FR-111, FR-112, FR-113; extends FR-004a (Edit menu), FR-016a (selection), FR-024 (undo).

**The fragment (FR-111).** A new pure module `model/clipboard.js` defines a self-contained, plain-data **fragment** `{ components, wires, buses, vertices }` — deep clones detached from any live design. `extractFragment(design, refdeses) → fragment` collects:
  - the **components**: the selected components, each expanded to its whole subunit package via `packageSiblings` (§6.6, FR-018b), de-duplicated;
  - the **interior conductors**: every wire/bus network all of whose component connections are to copied components (the FR-018c interior test). This reuses the union-find network walk already written for `rigidWiring` (§6.6); a sibling helper `interiorConductors(design, refdesSet) → { wires, buses }` returns the whole conductors (not just their bends), and a network with any connection to a non-copied component, or no component connection at all, is excluded;
  - the **vertices** those conductors reference (pin/connector vertices keyed by `ref`+`pin`; junction/free vertices with their coordinates).
  Bus `groupConnections` and `bitNames` (§7.2) ride along inside the cloned buses. Copy performs no design mutation, so it is **not** a command and creates no undo entry; it just stores the fragment in the session clipboard (below).

**Pasting the fragment (FR-112).** `pasteFragment(design, fragment, dx, dy) → { components, wires, buses }` instantiates the fragment into `design`:
  - **Refdes remap.** Group fragment components by physical package: a subunit package (shared `U<n>` stem) gets **one** new U-number (via the FR-011c high-water allocator `allocRefNum`, §6.6) with its sibling letters preserved (`U7A…`); a single IC gets a new `U<n>`; a built-in gets a new `A-<n>`; a text note a new `N-<n>`; a sub-design instance a new `X<n>`. Build an `oldRefdes → newRefdes` map and rewrite each component's `refdes` (and its derived per-pin vertex `ref`).
  - **Id remap.** Allocate fresh `v…/w…/b…` ids from the design counters; rewrite every path `node.v`, each bus `groupConnections[].vertex`/`.instance`, and junction/free vertex ids through `old→new` maps.
  - **Translate.** Add `(dx,dy)` (whole grid units) to every component `x/y`, every junction/free vertex `x/y`, and every bend. Pin/connector vertices need no shift — their position is derived from the (already-translated) instance (§7.1a).
  - **Port labels (FR-112).** A pasted port whose `label === oldRefdes` (the default, §6.14) is reset to its `newRefdes`; a custom label is kept verbatim.
  Per-instance `typeData`, `overrides`, and `switchState` clone verbatim (FR-057/FR-058/FR-071c). The pasted objects are returned so the caller can select them.

  The **command** `pasteFragmentCmd(fragment, dx, dy)` (§6.10) is snapshot-based — it touches `components/wires/buses/vertices` plus the id counters, exactly the `snapshotConnectivity` set — so it reuses the existing `snapshotCommand` machinery (capture on first apply, restore on revert; redo re-runs `pasteFragment` deterministically against the restored counters, yielding the same new ids). It exposes the created components' refdeses (captured on apply) so the FSM can set the post-paste selection.

**Paste-at-cursor FSM (FR-113).** `interaction.js` (§6.9) gains a `paste` placement mode paralleling `place`: `startPaste()` checks the clipboard is non-empty and not simulating (FR-087), sets `tool === "paste"`, and arms a floating ghost. `mousemove` computes `(dx,dy)` so the fragment's anchor — the grid-snapped top-left of its components' bounding box — tracks the cursor grid point, and calls a new renderer hook `renderer.setGhost(fragment, dx, dy)`. A left-click commits `store.dispatch(pasteFragmentCmd(fragment, dx, dy))`, selects the created components, clears the ghost, and returns to select-tool (one-shot, FR-010). Escape or any `setTool` clears the ghost and cancels (no mutation). The **ghost** is a new translucent-draw path in `canvas.js` (§6.8): with `ctx.globalAlpha` lowered it draws the fragment's components through the existing `drawComponent` (offset by `dx,dy`) and its conductors as plain polylines — read-only, never hit-tested, drawn above the design and below the marquee.

**Session clipboard & chrome wiring.** The clipboard is a single module-level fragment variable owned by `interaction.js` (session-scoped, not persisted, not on the undo stack, surviving New/Open — FR-111). `initInteraction` returns `copySelection()` and `startPaste()` alongside `setTool`/`zoomBy`. The keydown handler (§6.9) adds Ctrl/Cmd+C → `copySelection()` and Ctrl/Cmd+V → `startPaste()` (both gated by the simulation lock for paste; copy is always allowed). The **Edit menu** (`toolbar.js`, §6.11/FR-004a) gains **Copy** and **Paste** items invoking the same two entry points; `refresh()` disables Paste when the clipboard is empty or simulating and Copy when the selection has no components.
- **Dependencies:** `model/design.js` (`packageSiblings`, `nextRefNum`, union-find network walk), `store.js`, `commands.js` (`snapshotCommand`), `engine/canvas.js`, `engine/interaction.js`, `chrome/toolbar.js`.

---

### 6.16 JS: test vectors (`web/js/engine/vectors.js` + `chrome/dialogs.js`/`toolbar.js`/`app.js`)

- **Purpose:** author and run a table of input patterns + expected outputs against the slow simulator — combinational rows independently (FR-115c), sequential (clocked) rows in order with scripted clocks (FR-115e). Implements requirements §3.19a in full.
- **Satisfies:** FR-115, FR-115a, FR-115b, FR-115c, FR-115d, FR-115e (sequential), FR-115f (port binding), FR-115i (bidirectional bus columns); extends FR-004a (new **Simulate** menu). (FR-115g, the interim clocked-design guard, is superseded and removed.)

**Pure runner & file model (`engine/vectors.js`, DOM-free, unit-tested in `vectors.test.js`).** A new module, deliberately free of any DOM so it tests like `validateMemSpec`/`memDeviceSpec`:
  - `deriveColumns(design) → { inputs, outputs, io, warnings }`. Enumerates `design.components` (the same iteration the simulator uses, §6.13) filtered by `typeData.renderType`: `"switch"` → one **input** column `{ refdes, pin:"OUT", label }`; `"indicator"` → one **output** column `{ refdes, pin:"IN", label }`; `"indicator8"` → eight output columns `{ refdes, pin:"D0".."D7", label }`; and **ports** (`"port"`/`"portN"`, FR-115f) by their **effective direction** (`effectivePortDir`, §6.14, FR-094c/FR-094d): an effective-`in` port → input column(s), an effective-`out` port → output column(s), an effective-`bidir` port → a **bidirectional column** `{ refdes, pin, label, io:true }` collected into a third **`io`** group (FR-115i, superseding the former skip-with-warning; a 1-wide port yields one io column, a `portN` N per-bit io columns). A 1-wide port contributes one column `{ refdes, pin:"P", label }`; a `portN` of width N expands to **N one-bit columns** `{ refdes, pin:"P"+i, label:label+i }` (uniform per-bit, no whole-bus column). A port column is thus identified by the port's **own** `(refdes, pin)` — the natural, stable identity (FR-115f). `label` is the instance's display label (FR-011b) falling back to `refdes`; columns are sorted by refdes (numeric-aware, then pin) for stable order — port-derived columns **coexist** with any switch/indicator columns. `"clock"` (FR-115e) → one **input** column `{ refdes, pin:"OUT", label, kind:"clock" }` whose cells take `0`/`1`/`C`; `kind` is a live-only marker (the dialog's cell options and `validateVectors`' `C` legality key off it) and is **not** persisted in the `.tv` file — reconciliation stays pure `(refdes,pin)`.
  - `runVectors(design, doc, { romContent }) → { rows:[{ cells:[{pass, actual}], pass }], passed, total }`. Branches on `hasClockGenerators(design)`. **Combinational** (FR-115c), for each row independently: `structuredClone(design)`; for each input column drive it by the row's symbol (`"0"`/`"1"`) — a **switch** column sets that instance's `switchState`, a **port** column appends `{ refdes, pin, value }` (`V0`/`V1`) to a per-row **stimulus** list (FR-115f) — then `buildSimulation(clone, { romContent, stimulus })` (§6.13, the stimulus strong-drives each bound input-port net), drive the **settle loop** — `step()` until `!lastStepChanged()` or `SETTLE_BOUND` (10,000) units, the same bound and quiescence test as `settle()` in `sim.js` (FR-085) — and read each output via `sim.valueOfPin(refdes, pin)` (a port output reads straight off its own net, FR-094e). Compare per FR-115c: `H`↔`V1`, `L`↔`V0`, `X` passes always; `VU`/`VZ` never match. Each **io** column (FR-115i) is handled per row by its cell: `0`/`1` appends `{refdes,pin,value}` to the stimulus list (drive, like a port input); `H`/`L`/`X` contributes no stimulus and, for `H`/`L`, is read via `valueOfPin` and scored (release/observe) — drive iff the cell is `0`/`1`. The clone makes the run side-effect-free (FR-115c): the live `store.design` is never mutated, dirtied, or pushed to undo.
  - **Sequential path (FR-115e).** One `structuredClone(design)` and one `buildSimulation(clone, { romContent, scriptedClocks: true, stimulus: [] })` for the whole run; rows share the instance so register/net state persists. The runner owns the clock and reset nets via `sim.setStimulus(...)` (§6.13). **Power-on preamble:** stimulus asserts every reset built-in (`R`=`V1`, `/R`=`V0` — two entries per instance) with all clocks at `V0`; settle; then `max(cycles)` scripted pulses (all clocks high, settle; low, settle), each reset instance switching to released (`R`=`V0`, `/R`=`V1`) once its own `cycles` (via `effectiveProps`-equivalent resolution, FR-020b) worth of pulses have elapsed; final settle. **Per row, in order:** set switch columns on the clone's instances (`switchState`, read live each step), rebuild the stimulus — ports per cell, resets released, each clock at its cell's level (`C` counts as low) — `setStimulus`, settle; if any clock cell is `C`, drive those clocks `V1`, settle, back to `V0`, settle (one shared pulse, FR-115e); then read and score outputs exactly as the combinational path. Every settle phase uses the same `SETTLE_BOUND` loop.
  - `captureVectors(design, { inputs, outputs, io }, rowsIn, { romContent }) → { out, io }` cell tables. Whole-table capture used by the dialog's Capture button: combinational designs capture each row independently (as `captureRow`); sequential designs run the same ordered pass as `runVectors` — preamble, then each row's inputs and pulses — recording each row's settled outputs in sequence (FR-115e). For **io** columns (FR-115i), Capture fills each **release** cell (`H`/`L`/`X`) with the settled value (`H`/`L`, `X` for U/Z) and preserves **drive** cells (`0`/`1`).
  - `captureRow(design, rowInputs, { romContent }) → outSymbols[]`. Same drive + settle (switches, port stimulus, and io drive cells alike), mapping each settled output to `H`/`L`, or `X` when `VU`/`VZ` — and, for an io column (FR-115i), filling a release cell while leaving a drive cell (`0`/`1`) as authored.
  - `validateVectors(doc, columns) → { ok, warnings, errors }`. Pure gate: legal cell symbols — `0`/`1` in input cells, with `C` additionally legal **only** in a `kind:"clock"` column (FR-115e); `H`/`L`/`X` in output cells; `0`/`1`/`H`/`L`/`X` in **io** cells (FR-115i) — row arity vs column count (inputs + outputs + io), and `(refdes,pin)` reconciliation against the live `columns` (a file column absent from the design, or a design column absent from the file, is a non-fatal warning, FR-115a).
  - File model: `FORMAT_VERSION` (**3** — v2 marked the `C` input symbol, FR-115e; **v3** adds the `io` column array and per-row `io` cell array, FR-115i; the v1→v2 migration is the identity, and v2→v3 adds empty `io:[]` to the column set and to each row), `serializeVectors(doc)`, `deserializeVectors(obj)` with a `migrate()` chain mirroring `model/persist.js` (§7.4); shape per §7.7. ROM content is loaded once before a run via `loadRomContents(design)` reused from `sim.js` (FR-114e), so ROM-backed combinational logic resolves.
  - `isStateful(design) → boolean` (was `hasClockGenerators`, generalized for FR-079d). True when the design carries any persistent state that must survive from one vector row to the next: any component whose `typeData.renderType` is `"clock"` **or** any component whose behavior declares a transparent latch (a `.L` output, FR-079d). It selects the **ordered/persistent** run path (FR-115e) in `runVectors`/`captureVectors` — so a latch's hold spans rows even in a clock-less design — and the dialog's sequential-mode notice. A separate `hasClockGenerators(design)` (the original `renderType==="clock"` scan) still gates the **clock-specific** machinery that only applies when a clock is present: the `C`-pulse columns in `deriveColumns` and the scripted-clock preamble. Both are pure, DOM-free design scans — deliberately not `buildSimulation(...).hasClocks()`, which would compile every behavior to answer a yes/no question; the latch test reads each in-use `typeData.behavior` for a `.L`-suffixed output (cheap string/compiled-shape check). (The clock scan was originally introduced for the FR-115g guard, now superseded.)

**Panel (`chrome/dialogs.js` `testVectorsPanel({ store, dataDir })`).** A **docked, modeless panel** (FR-115b, reworked 2026-07-02 from the former `.dialog-overlay` modal so the schematic stays visible while authoring). It mounts into `#vec-panel`, the bottom-third host inside a now flex-column `#canvas-area` (canvas host on top, panel host below); opening reveals the host and shrinks the canvas box, which the `canvas.js` `ResizeObserver` refits automatically at the unchanged viewport — content keeps its scale/aspect, only the visible extent shrinks (§6.13) — and closing hides it so the canvas grows back. It exposes `open()`/`close()`/`isOpen()` and a header **✕/Close** control, and binds **no** Escape-to-close (Escape remains a canvas gesture). While open it sets `store.state.vectorPanelOpen`, imposing the FR-115h read-only lock (see toolbar/store wiring below). It renders an HTML `<table>` whose header comes from `deriveColumns(store.design)` — which includes the design's port columns (FR-115f) and bidirectional (io) columns (FR-115i) directly, so the panel and runner operate on `store.design` itself (no wrapper); any `warnings` it returns (FR-115a reconciliation mismatches — the former bidir-port skip warning is gone now that bidir ports bind as io columns, FR-115i) show in the notice line — and whose body is rows of `<select>`/`<input>` cells held in a 2-D ref array read back in `gather()` (the map-to-`{el}`-then-read pattern of the GAL pin rows). Buttons: **+ Row** / **− Row**; **Run** → `runVectors` then paint each output cell — and each io **release** cell (FR-115i) — green/red (a failing cell shows its `actual`) and write an "N of M rows passed" summary line (FR-115d); **Capture** → `captureVectors` filling every row's expected cells (ordered pass for a sequential design, FR-115e); **sequential mode** (FR-115e): when `hasClockGenerators(store.design)`, a clock column's cell `<select>` offers `0`/`1`/`C` (per its `kind:"clock"` marker) and defaults to `C`, and a persistent notice line (`vec-mode`) states that rows run in order, state persists, and `C` pulses the clock — replacing the removed FR-115g guard; an **io** column's cell `<select>` (FR-115i) offers `0`/`1`/`H`/`L`/`X`, defaults to `X`, and styles by role (driving `0`/`1`, expected `H`/`L`, inert `X`); **Load**/**Save** → `openFileDialog` (§6.11) seeded at the **project root** (`store.state.project.dir`, FR-121h — identical to the former `dirOf(store.state.savePath)` under the flat project layout, and defined even for a not-yet-saved design) with default `<base>.tv`, then the design load/save API wrappers (`api.js`) — the `.tv` payload is JSON and rides the existing `/api/v1/design/{load,save}` endpoints (§6.4), which neither interpret nor extension-check the body. New `vec-*` CSS classes in `style.css` reuse the dialog primitives, the raised tray shadow, accent `#4a90d9`, error `#b00`, success `#1a7f37`.

**`openFileDialog` extension (`chrome/dialogs.js`).** Its save mode hardcodes a `.json` suffix; generalize it to take an optional target extension (e.g. `saveExt`) so the picker lists and names `.tv` files. The server `ListDir`/`exts` filter already accepts arbitrary extensions (the `.bin`/`.hex` ROM precedent, §6.4/FR-114e); no server change.

**Chrome wiring (`chrome/toolbar.js`, `chrome/properties.js`, `app.js`, `store.js`).** `toolbar.js` gains a **Simulate** menu (`createMenu`) with a **Test Vectors…** item (`addItem`) invoking an `onTestVectors` callback; the item stays enabled while the panel is open so it can toggle it closed (only `store.state.simulating` disables it, FR-115b). `app.js` supplies `onTestVectors`, which **toggles** the singleton `testVectorsPanel({ store, dataDir })` open/closed. **Read-only lock (FR-115h):** `store.js` adds `state.vectorPanelOpen` plus a read-only predicate `isReadonly() = simulating || vectorPanelOpen`; `blocked(what)` uses it (with a panel-specific message), so every canvas mutation is refused while the panel is open exactly as while simulating. `refresh()` ORs `vectorPanelOpen` into the FR-087 disables (Wire/Bus, Undo/Redo, New/Open/Refresh, Copy/Paste) and additionally disables the interactive **Run** button (mutual exclusion, FR-115h), while Select and the zoom/Fit commands stay enabled. `chrome/properties.js` swaps its `store.state.simulating` edit-lock checks for `isReadonly()`, so per-instance property edits are locked under the panel too.
- **Dependencies:** `engine/sim.js` (`buildSimulation` with `stimulus`/`scriptedClocks`, `setStimulus`, settle bound, `loadRomContents`), `engine/galasm.js` (`V0`/`V1`/`VU`/`VZ`), `model/design.js` (instance shape), `model/subdesign.js` (`effectivePortDir` for port-column direction, FR-115f), `store.js` (`state.design`, `state.savePath`, `state.simulating`, `state.vectorPanelOpen`, `isReadonly()`), `chrome/dialogs.js` (`openFileDialog`), `chrome/fileops.js` (`dirOf`), `api.js` (load/save), `chrome/toolbar.js`, `chrome/properties.js`, `app.js`.

---

### 6.17 JS: fast (generated C) simulator (`web/js/engine/cgen.js` + `web/cgen/runtime.{h,c}` + chrome wiring)

- **Purpose:** emit, from the current design, a standalone C program that simulates that one design with bit-for-bit slow-simulator semantics — the "fast" engine of `sim-vision.md`, realized as a code generator per §3.23.
- **Satisfies:** FR-106, FR-107, FR-108, FR-109, FR-110, FR-116, FR-116a, FR-117, FR-118; extends FR-004a (new Simulate-menu item).

**Architecture — runtime owns control flow, generated code is data + lowered logic (FR-116a).** The emitted program is two translation units. `runtime.c` contains `main()`, flag parsing, the settle/step loops, net resolution, the vector runner, and all reporting; it calls into a small **`gen_` interface** declared in `runtime.h` and implemented by the generated `<design>.c`. The generated file is therefore mostly tables plus straight-line lowered logic, and every subtle semantic lives in the hand-written, auditable runtime.

**Runtime (`web/cgen/runtime.h` / `web/cgen/runtime.c`).** Checked-in, human-readable C (C99, no dependencies beyond libc), served as static assets by the existing Go static handler and fetched by the client at generate time. `runtime.h` is the documented API (comments written as future user documentation); `runtime.c` carries FR-number references at each semantic re-expression, mirroring `sim.js`'s comment style. Core pieces:
  - **Four-state type:** `typedef enum { RT_0, RT_1, RT_U, RT_Z } rt_val;` — numerically identical to `V0`/`V1`/`VU`/`VZ` (§6.13). One byte per net (`rt_val curr[]`/`next[]`, double-buffered, FR-078); bit-packing is a deliberately deferred optimization.
  - **Combination ops:** `rt_and`, `rt_or`, `rt_not`, `rt_xor` implementing FR-077 selective pessimism (`0 AND x = 0`, `1 OR x = 1`, other U → U; Z reads as U), used by the generated evaluate functions.
  - **Contribution + resolution:** the generated per-step code deposits driver contributions (`rt_contrib(net, val, weak, label_index)`); `rt_resolve_nets()` re-expresses `resolveNet` from `sim.js` — enabled strong drivers win, weak pulls decide only when every strong driver is Z, 0-vs-1 disagreement → U with a conflict report to stderr naming both drivers on onset (FR-081–FR-083, FR-108/FR-118).
  - **Step/settle:** `rt_step()` (latch phase → contributions → resolve → swap, FR-078/FR-110) and `rt_settle()` (step to quiescence under `RT_SETTLE_BOUND` 10000, FR-085's bound).
  - **Built-ins:** behaviors for clock, power-on reset, input switch, pulls, and memory (FR-116a), driven from generated instance tables; indicators and ports are observation entries in the column tables. In vector mode clocks/resets are scripted exactly as `scriptedClocks` mode (§6.13/FR-115e).
  - **Vector runner:** reads whitespace-separated rows from stdin (`0`/`1`/`C` inputs `|` `H`/`L`/`X` expected, positional against the baked columns, FR-117), branches combinational/sequential exactly as `runVectors` (§6.16) — independent rows vs. ordered rows with reset preamble and shared `C` pulses — and prints the per-row transcript + summary to stdout (FR-118); exit status 0 iff all rows passed.
  - The runtime compiles standalone (a `RT_NO_GEN` test harness or equivalent), so its ops and resolver are natively unit-testable without a generated design.

**Generator (`web/js/engine/cgen.js`).** Pure, DOM-free ES module (unit-tested under `node:test` like `vectors.js`). `generateC(design, { columnsFrom = design } = {}) → { code, warnings }` produces the `<design>.c` text (the `{ romContent }` option was removed at M5 — ROM contents are no longer baked, FR-117b). `design` is the **FlatDesign** (§6.14) when the source is hierarchical; `columnsFrom` is the **root** design the column tables derive from — the same root-for-columns / flat-for-netlist split the vector panel uses (§6.16), because a top-sheet port's direction derivation needs the root's wiring and a child's ports/switches/indicators must not become columns (FR-116 hierarchy). It **reuses** the existing single-source modules (FR-109): `compileBehavior` (§6.13 `galasm.js`) for behavior lowering, `buildNets` (§6.6 `netlist.js`) for connectivity, `deriveColumns` (§6.16 `vectors.js`) for the baked column tables, and the `effectiveProps` merge (FR-020b) for built-in property values. Emission:
  - **Net table:** nets indexed as in `buildNets` order; a string table of `refdes.pin` labels for conflict messages (FR-108).
  - **GALasm entities:** each compiled output's term/sum tree is lowered to a C expression/function over `curr[]` using the `rt_*` ops — plain, `.T` (enable gating), `.R`, and `.L` outputs; register **and latch** state as static `rt_val` arrays; global-clock and per-output `.CLK` edge detection mirroring `updateRegisters`/`evalOutput` (§6.13, FR-079/FR-079a). A **transparent latch** (`.L`/`.G`, FR-079d) lowers to a `latch_<tag>[]` state array beside the `reg_` arrays: `gen_init` seeds it U; in the `gen_latch` phase (alongside register latching, before contributions) the generated fragment evaluates the `.G` gate over `curr` and, level-sensitively, captures the `.L` sum when the gate is 1 and holds when 0 (applying any `.ARST` clear first) — no edge state, mirroring §6.13's latch bullet; and `gen_drive` contributes `latch_<tag>[k]` gated by the output's `.E` exactly as a register drives, so `curr` carries the one-unit-delayed latched value the runtime's unchanged net resolve produces (the net-resolve, drive, and latch-capture paths use only existing `rt_*` ops, so they need no runtime change). The **one** runtime touch a clock-less latch design forces is the vector runner's **stateful decision**: the generator bakes a `gen_latch_count`, and `rt_run_vectors` runs its rows in order on persistent state when `gen_clock_count > 0 || gen_latch_count > 0` — not clocks alone — the C analogue of `isStateful` (§6.16, FR-115e). A clock-less latch design still has no `C` pulses and no power-on preamble (both keyed on `gen_clock_count`), but its rows share state so a latch's hold spans rows. Subunit packages union their siblings' pins exactly as `makeGalasmEntity`. **Buried registered nodes (FR-079c)** mirror the slow engine's virtual-net trick: `lowerGalasm` appends one placeholder net per `typeData.internal` name (bumping `gen_net_count`), maps the node to a synthetic `"<refdes>.#<node>"` key in `netOfPin`/`pinOwner` and interns a label for it; the buried `.R` output then lowers into ordinary `reg_<tag>[k]` state (`gen_init` U-seed, `gen_latch` rising-edge D-latch reading buried literals as `curr[<vnet>]`) and a `gen_drive` fragment `rt_contrib(<vnet>, reg_<tag>[k], 0, <label>)`, so `curr[<vnet>]` carries the one-unit-delayed buried value the runtime's unchanged net resolve produces — no runtime change, the two engines agree on `Q7`/`Q7N` (FR-107). New sequential parity pair `examples/74165-*` (a placed 74165 with switch-driven `D0..D7`/`DS`/`PL`//`CE`/, a clock on `CP`, indicators on `Q7`/`Q7N`, and a `.tv` exercising load-then-shift and `CE`/ inhibit) covers a buried sequential node through the FR-107 harness (`runtests.sh` step 3). A further parity pair `examples/74573-*` (a placed 74573 with switch-driven `D0..D7`, `LE`, and `/OE`, indicators on `Q0..Q7`, and a `.tv` that exercises transparency while `LE` is high, hold after `LE` falls, and high-Z under `/OE`) covers the transparent-latch lowering (FR-079d) through the same harness — a **clock-less stateful** design, verifying the `isStateful`/ordered-rows path (§6.16) in both engines.
  - **Built-ins/memory:** instance tables (type, nets, effective properties, switch's persisted state as its baked drive level — overridable by a vector input column); each ROM's **refdes and content-file path** baked for the runtime's startup load (FR-117b; superseded the M3 baked-bytes rule 2026-07-03); a plain RAM starts all-U, while a **persistent RAM** (FR-114g) additionally bakes its **save-file path and load-on-start flag** for the runtime's startup load and write-back (FR-117c).
  - **Preflight/refusals:** same compile errors as `buildSimulation` (parse failure, `.R` without `clock:`); behavior-less types generate U-drivers with a warning (FR-080 analogue). **Switch elements (FR-071g/FR-071h) are refused** (added 2026-07-07): `generateC` fails with "transmission gates / relays are not supported by the fast simulator" naming the offending refdes(es) — FR-083a's dynamic net merging is slow-engine-only for now (FR-116); the Generate C… flow surfaces the refusal via the message tray like a flatten failure. **Persistent RAM (FR-114g) is supported** (refusal withdrawn 2026-07-09, originally refused 2026-07-08): a RAM instance whose `mem.ramFile` is set bakes its save-file path and load-on-start flag into `gen_mems`, and the runtime loads it at start-up and writes it back on normal termination of either batch mode (FR-117c, M7 below); a plain RAM (no save file) bakes a NULL path and generates unchanged. If **switch-element** fast support is added later it will mirror the slow engine's per-root resolution (a union-find in `runtime.c` plus generated contact tables) with FR-107 parity coverage — no `gen_` interface provision is reserved for it now (YAGNI; the runtime pair ships verbatim per generation, so an interface change costs only a regenerate). The former FR-116 deferred-scope refusals of sub-design instances / off-sheet connectors remain **as internal guards** — the caller flattens first (FR-116 hierarchy, reworked 2026-07-04), so tripping one means an unflattened design reached the generator. `SUBUNIT_PKG_RE` is the hierarchical-prefix-tolerant form (§6.14), so a child's subunit packages group within their instance. A clock generator with a hierarchical refdes is baked normally (free-run mode drives it, FR-117a) and the **runtime's vector mode refuses it at startup** — `rt_init`/the vector runner scans `gen_clocks[].refdes` for `/`, reports the refdes with a pointer at `--cycles`, and exits 2 (the FR-115e hidden-clock rule, enforceable only at run time because one program serves both modes).

**Chrome wiring (`chrome/toolbar.js`, `app.js`).** The Simulate menu (§6.16) gains a **Generate C…** item (`onGenerateC`), disabled while `state.simulating` or `state.vectorPanelOpen` (FR-116). `app.js` handles it: fetch `/cgen/runtime.h` + `/cgen/runtime.c` → `flatten(store.design, loadDesign, { rootPath: savePath })` (FR-116 hierarchy; a flatten refusal posts to the tray and aborts) → `generateC(flat, { columnsFrom: store.design })` (no ROM preload — the program reads ROM contents itself at startup, FR-117b; the `loadRomContents` preload this section originally specified was discovered at M5 never to have been wired in — a latent all-U-ROM bug in app-generated programs, mooted by FR-117b) → `openFileDialog` in save mode with a `.c` extension (the `saveExt` generalization of §6.16) seeded at the project root (`store.state.project.dir`, FR-121h — same directory as the former `dirOf(savePath)` under the flat layout) with default `<base>.c` → write all three files through `POST /api/v1/file/save` (§6.4), the verbatim-text endpoint added for this purpose (the design-save endpoint requires a valid-JSON body — `json.Indent` — so C source cannot ride it; corrected 2026-07-02 from the original "reuse `/design/save`" plan). Failures/warnings post via the message tray (FR-074).

**Milestones.** (Sequencing per the 2026-07-02 discussion recorded in `gen-open.md`.)
  1. **M1 — runtime + minimal generator, combinational:** runtime pair, `cgen.js` for GALasm parts + switch/indicator/pulls, Generate-C menu flow; settle-and-stop; conflict reports. No compiler is invoked by any tool — the user compiles by hand (`cc <design>.c runtime.c`).
  2. **M2 — `.tv` stimulus + parity harness:** stdin vector rows (FR-117), transcript (FR-118); a Node-based parity harness (`web/tools/parity.js`) that, for each corpus design+`.tv` pair under `examples/`, loads the design (`deserializeDesign`), reads any ROM contents from disk (`loadRomContentsFs`, the Node/`fs` analogue of `sim.js` `loadRomContents`, passed to both engines), reconciles the `.tv` to the design's `deriveColumns` (§6.16), runs `runVectors` (§6.16) for the JS side, `generateC` + `cc` for the C side, feeds the same reconciled rows to the compiled program's stdin, and **diffs** the program's stdout transcript against the JS result **rendered into the identical FR-118 transcript format** (per-row `pass`/`FAIL <label>=<actual>` lines, `0/1/U/Z` actuals shared by both engines, plus the summary line) — the FR-107 check. Pairs the generator refuses (memory/sub-design/`.R`, M3+ scope) are reported as skipped, not failures. Run explicitly (`node web/tools/parity.js`); exits nonzero on any diff. M2 also delivers the **`tv2txt` converter** (`.tv` JSON → stdin row text), which must **reconcile**, not just dump: a `.tv` may assert only a subset of the design's derived columns (FR-115a reconciliation handles this in the panel), while the program's row format is positional against the **full baked column set** (FR-117) — discovered on first real use (74381, 2026-07-02), where a naive positional dump was rejected for arity. `tv2txt` therefore matches file columns to program columns by `(refdes,pin)` — exactly `reconcileVectors` (§6.16) — emitting `X` for design columns the file does not assert and warning on file columns the program lacks. To let it work from the emitted program alone (no design file needed), the generator shall bake each column's **`(refdes,pin)` identity** into `<design>.c` alongside its display label (the identity is already interned for port columns; this extends it to every column). **Chosen at M2 (2026-07-03):** the identity rides as extra **`refdes`/`pin` string fields on `rt_incol`/`rt_outcol`** (not a parallel table), and tooling reads the baked column set through a runtime **`--columns` dump mode** (the program prints its full column set — one line per column, `DIR KIND REFDES PIN LABEL…`, in row-format order — to stdout and exits), so `tv2txt` works from the compiled program alone with no `.c` text parsing. **`tv2txt` (`web/tools/tv2txt.js`, ESM, outside the `web/js/` `node:test` sweep):** `node tv2txt.js <program> <file.tv>` runs `<program> --columns`, parses the column set, and **reuses `deserializeVectors` + `reconcileVectors` (§6.16)** directly (single-source, FR-109) to align the file's `(refdes,pin)` columns to the program's positional order — inputs default `0` (clock columns `C`), outputs `X` — then writes the plain-text rows (`in… | out…`) to stdout and reconciliation warnings to stderr, so `node tv2txt.js ./sim d.tv | ./sim` runs the vectors.
  3. **M3 — sequential + memory:** delivered in steps. **Step 1 (landed 2026-07-03):** registered `.R` outputs on the global `clock:` pin, incl. global AR/SP (FR-079), lowered in `cgen.js` as per-instance `reg_<refdes>[]` state with a rising-edge latch in `gen_latch` mirroring `sim.js` `updateRegisters` (D input latched via `combExpr`, LHS-negation/enable applied at drive time as `evalOutput`); the runtime's sequential vector path (reset preamble, ordered rows, scripted `C` pulses) was already in place from M2, so no runtime change was needed. First sequential parity pair: `examples/simple174` (74174 hex-D FF with async `/MR`). **Step 2 (landed 2026-07-03):** per-output `.CLK` with async `.ARST`/`.APRST` (FR-079a) — independent clock domains and async set/reset, lowered alongside the global-clock family in one part (each self-clocked output carries its own `prevClk_<tag>_<k>` edge; global AR/SP restricted to the global-clock register indices). Runtime again unchanged. Second sequential parity pair: `examples/2-bit-SR` (7474 dual D-FF shift register). **Step 3 (landed 2026-07-03):** memory (RAM/ROM, FR-114d). The memory core (`memory.js` `createMemoryCore`) is re-expressed in `runtime.c` — `mem_decode`, `mem_write_all` (RAM WE/ 0→1 edge, in the latch phase alongside register latching), `mem_drive_all` (CE//OE//WE/ gating, in the contribution phase alongside `drive_builtins`), and `mem_reset` (RAM power-up U, ROM seeded from baked bytes via `loadBytes` semantics) — **runtime-owned**, driven from a `gen_mems[]` table (const wiring + `data_label` + baked ROM bytes) exactly like the other built-ins; the per-instance mutable store lives in the runtime, not the generated file. `cgen.js` emits the `gen_mems` entries and bakes ROM contents from the `romContent` map (FR-116a; all-U with a warning when a ROM's file is absent). Only sub-design instances remain refused (FR-116). Memory parity pairs: `examples/rom-demo` (R8X8 ROM + `rom-demo.hex`) and `examples/ram-demo` (1-bit RAM, tri-state data buffer released on read, dummy clock for sequential persistence). **M3 is complete.**
  4. **M4 — free-run + VCD** (scoped 2026-07-03: FR-117a, FR-118). **Free run (`--cycles N`, FR-117a):** a second, runtime-only drive path — instead of scripted clock/reset levels, the built-in drivers compute each clock's FR-084 square wave and each reset's FR-071b window from a simulated-time counter (`t` in unit steps, incremented by `rt_step`), exactly as `sim.js` evaluates those built-ins from `simTime`; the runner advances `N × clockPeriod` steps (`clockPeriod` per FR-071b's single-clock rule) with no settle loop, then prints the `LABEL=v` final observable dump (four-state, column order) to stdout. **No generator change:** the tables already bake `period_ns` (`rt_clock`) and `cycles` (`rt_reset`); `--cycles`/`--vcd` parsing, the time-driven drive path, the dump, and the VCD writer are all `runtime.c`. **VCD (`--vcd <file>`, FR-118):** works in both modes; header declares `$timescale 1ns` and one scalar signal per observable column; after every `rt_step` the runtime samples the columns and emits `#<t>` plus changed values (`0/1/U/Z` → `0/1/x/z`). Delivered in two steps, both landed 2026-07-03 — free run (parity-checked against the slow simulator run free for the same `N × clockPeriod` steps on `examples/counter` and `examples/simple174`), then VCD (initial `#0` power-up dump, change-only records; signal names are column labels with whitespace → `_`, ids bijective base-94). Runtime-only as designed — no generator change. **M4 complete.** **Free-run parity leg (added 2026-07-03):** `parity.js` additionally checks FR-117a for every `examples/*.json` design the generator accepts, `.tv` or not — the slow simulator runs free (`buildSimulation`, time-driven built-ins) for `8 × clockPeriod` unit steps (8 cycles clears the default 3-cycle reset window; `clockPeriod` per FR-071b's single-clock rule), its observable column set is rendered as the FR-117a `LABEL=v` dump, and the compiled program's `--cycles 8` stdout is line-diffed against it.
  5. **M5 — runtime ROM loading** (scoped 2026-07-03: FR-117b). ROM contents move from generate-time baking to a **startup load** in `runtime.c`, so a content file can change without regenerating. **Generated tables:** `rt_mem` gains `refdes` and `rom_file` (the `mem` block's path, FR-114f) and loses `rom`/`rom_len`; `cgen.js` stops consuming `romContent` (signature `generateC(design)`); `app.js` needs no change — it never actually wired the specified `loadRomContents` preload (a latent all-U-ROM bug in app-generated programs, found and mooted at M5). This is a `gen_`/runtime **interface change**: programs generated before M5 must be regenerated once. **Runtime:** `mem_load_all`, called from `rt_init` — per ROM, resolve the source (`--rom REFDES=FILE` override, else `rom_file` as recorded, else its basename in the cwd), parse per FR-114e (extension-selected `.bin`/`.hex`, hex = whitespace-separated byte tokens), pack little-endian `ceil(w/8)`-byte words into a runtime-owned byte buffer (partial trailing word dropped, over-capacity reported to stderr and truncated), any failure → stderr + exit 2 (an unresolvable `rom_file` names the refdes, both paths tried, and describes `--rom`); `mem_reset` seeds each ROM from that loaded buffer (the per-row combinational reset re-seeds from it, not from any file re-read). `main()` parses repeatable `--rom REFDES=FILE` before `rt_init`. **Parity:** `parity.js` keeps `loadRomContentsFs` for the JS engine only and points the program at the same file via `--rom` (its temp-dir cwd resolves neither baked path), exercising the override path on `rom-demo`.
  6. **M6 — hierarchy** (scoped 2026-07-04: FR-116 hierarchy rework). Fast-engine flattening: `onGenerateC` flattens (chrome wiring above); `generateC` gains `{ columnsFrom }` (generator paragraph above); the former X-instance/off-sheet refusals become internal unflattened-input guards; cgen's `SUBUNIT_PKG_RE` goes prefix-tolerant. **Runtime:** `rt_clock` gains no fields — the vector runner refuses at startup when any clock's `gen_labels` entry contains `/` (a clock's label is `<refdes>.OUT`, so a slash means a hierarchical refdes — hidden clock, FR-115e analogue; stderr names the clock and points at `--cycles`, exit 2); free-run mode unchanged. **Parity:** `parity.js` flattens the slow leg (Node `loadChild` reads relative to the design file's directory) and generates from the same FlatDesign with `columnsFrom` = the root; a hierarchical parity pair (a parent embedding a child) joins `examples/`. `engine/galasm.js` (`compileBehavior`, compiled-output shape), `model/netlist.js` (`buildNets`), `engine/vectors.js` (`deriveColumns`), `engine/sim.js` (semantic reference for the runtime), `engine/memory.js` (memory semantics reference; `parseRomBytes` as the FR-114e parsing reference), `chrome/dialogs.js` (`openFileDialog`), `chrome/fileops.js` (`dirOf`), `api.js` (save + static fetch), `chrome/toolbar.js`, `app.js`.
  7. **M7 — persistent RAM** (scoped 2026-07-09: FR-117c). Fast-engine RAM save files, the write-direction complement of M5's runtime ROM load. **Generated tables:** `rt_mem` gains `ram_file` (the `mem` block's `ramFile` path, FR-114f) and `ram_load` (the `ramLoad` flag); `cgen.js` bakes them for RAM instances and **drops the FR-114g refusal** (a plain RAM bakes `ram_file` NULL / `ram_load` 0 and generates unchanged). A `gen_`/runtime **interface change**: pre-M7 programs regenerate once. **Runtime:** `mem_load_all` seeds a load-on-start RAM the same way it seeds a ROM — reusing the `.bin`/`.hex` reader — but **non-fatally** (a read/format failure reports to stderr and leaves the RAM all-U, per FR-114g; the reader gains a fatal/non-fatal mode, and `mem_reset`, which already seeds any device with loaded bytes, seeds the RAM); a new `mem_save_all` dumps each save-file RAM's full store little-endian (U→0, format by extension — the `dumpBytes`/`ramFileBody` analogue) and `main()` calls it after the run in **both** modes (never after the hidden-clock refusal, which exits before running). No `--ram` override — the path is baked (contrast `--rom`). **Parity:** a save-file-RAM design (`examples/ram-persist.json`, a clock-driven write onto a loaded image) joins `examples/`, checked by a dedicated `parity.js` leg (`checkRamPersist`): seed the RAM's baked save file with a prepared image, run **both** engines free for the shared cycle count, and require the file the fast program writes back to equal the slow simulator's final `core.dumpBytes` (via `ramFileBody`) — covering the new `mem_load_all` RAM branch and `mem_save_all` against the slow load/dump reference. Only **free run** is compared: a slow-engine test-vector run never persists (FR-114g), so it has no vector-mode counterpart. Persistent-RAM designs are routed to this leg and **excluded** from the generic free-run leg (whose fileless all-U run would otherwise emit a misleading "cannot load").

### 6.18 JS: NDL netlist exporter (`web/js/engine/ndl.js` + chrome wiring)

- **Purpose:** render a flattened design as an NDL netlist (FR-119a) — the
  pinout/package/circuit language documented in `docs/netlist-language.md` —
  behind the generic **File ▸ Export…** flow (FR-119).
- **Satisfies:** FR-119, FR-119a. First consumer of the FR-062e `physical:`
  metadata (power pins, NC pins, pincount) outside the parser.
- **Interface:** `generateNDL(design, { name }) → { text, warnings }` — pure and
  synchronous, `design` already flattened (§6.14). Deterministic output: types
  ordered by first use, instances by refdes (natural sort), nets by their first
  exported reference; a given design always exports byte-identical text.
- **Behavior (mirrors FR-119a's clause letters):**
  - **Types → `pinout`.** One block per distinct `typeData` id among exported
    instances, named by the display name (whitespace → `_`, deduped). Signal
    pins emit `pin <number> = <name>`; a leading `/` (active-low) becomes a
    trailing `'` (NDL convention: `/MR` → `MR'`). When `typeData.physical` is
    present its `power[]` pins emit under their rail names and `nc` pins as
    `NC`; a type with any unnumbered signal pin gets lowest-unused invented
    numbers plus a warning comment in the block (FR-062e's degrade-gracefully
    case, e.g. generated memory devices).
  - **Power.** A synthetic `pinout POWER` / `package POWER PWR` with one pin per
    distinct rail name in use (numbered 1..k); the circuit block wires
    `PWR.<rail> -> <inst>.<rail>` for every physical power pin of every part
    carrying `physical:`.
  - **Ports → connector.** When the flattened design has ports, a
    `pinout <design>_IO` / `package <design>_IO J1`: one pin per distinct
    1-wide port label, `<label>0..(N-1)` per portN (FR-095 naming), numbered
    sequentially in label order. Net references to `A-n.P`/`A-n.Pi` rewrite to
    `J1.<label>`/`J1.<label><i>`; same-label ports collapse (FR-094a).
  - **Instances → `package`.** Instances grouped by type id; subunit siblings
    collapse to their package stem via the §6.13/§6.17 rule
    (`/^((?:.*\/)?U\d+)[A-Z]$/` — `U1A..U1D` → `U1`, `X1/U3A` → `X1/U3`), so a
    flattened child's packages stay distinct per instance. Text notes (no pins)
    are skipped entirely.
  - **Nets → `circuit`.** `buildNets(design)` (§6.6); per net, pin refs map
    through the subunit-stem and port rewrites, active-low renames, and
    dedupe; nets with ≥2 exported refs emit a star from the **driver** — the
    first ref whose pin direction is out/tristate/bidir, else the first ref —
    one `driver -> sink` statement per line, preceded by `# net <name>` when
    the net is named. The `->` is documentation of intent (NDL §5.2); star
    orientation is why direction matters here at all.
  - **Virtual built-ins.** clock/switch/indicator/indicator8/pullup/pulldown/
    reset — and, added 2026-07-07, tgate/relay (FR-071g/FR-071h) — instances
    have no physical package: each emits a comment line in the
    circuit block (`# virtual: A-3 (clock) OUT -> U1.CP, …`) naming every net
    pin it drives or observes — for a switch element, its control pin's net and
    its contact terminals' nets (`# virtual: A-4 (tgate) EN=…, A=…, B=…`) — so
    the information survives the export without
    inventing hardware. Ports are **not** virtual (they became `J1`).
- **Chrome wiring (`chrome/dialogs.js`, `chrome/toolbar.js`, `app.js`):** the
  File menu gains **Export…** (`onExport`), disabled like Generate C while
  `state.simulating` or `state.vectorPanelOpen` (FR-119). `app.js` handles it:
  `exportFormatDialog()` (dialogs.js — a modal with a format `<select>`
  listing `NDL netlist (.ndl)` only, OK/Cancel) → `flatten(store.design,
  loadDesign, { rootPath: savePath })` (§6.14; refusal posts to the tray and
  aborts) → `generateNDL(flat, { name: designName })` → `openFileDialog` in
  save mode (`.ndl` extension, seeded at the project root per FR-121h, default
  `<base>.ndl`) → `saveTextFile` (`POST /api/v1/file/save`, §6.4). Warnings
  post to the message tray (FR-074).
- **Tests (`web/js/engine/ndl.test.js`):** a small hand-built flat design (two
  ICs incl. a subunit pair and `physical:` blocks, a port, a clock, wires
  giving multi-pin nets) asserting: pinout lines incl. power/NC and active-low
  rename; invented-number warning for a numberless type; package grouping and
  subunit stem collapse; connector pinout and reference rewrite; power rail
  wiring; driver-first star statements; virtual-builtin comments;
  determinism (two runs byte-identical).

### 6.19 JS: projects (`web/js/chrome/project.js` + store/fileops/dialogs/app wiring)
- **Purpose:** the client side of the FR-121 **Projects** group: the current
  project as store state, the New/Open/Duplicate Project lifecycle, the
  design/data boundary rules, and project-relative data paths. This section
  names the concrete reworks the group makes to §6.10–§6.12, §6.14, and
  §6.16–§6.18.
- **Satisfies:** FR-121, FR-121a–FR-121i; the FR-121-driven reworks of
  FR-004a, FR-044, FR-047, FR-049, FR-050, FR-052, FR-053, FR-097a, FR-114e,
  FR-114g; and the Phase 2 reworks of FR-002, FR-007, FR-007a, FR-088.
- **Background (why this shape):** the FR-120 per-project component-scope
  design was reverted in full (CHANGELOG 2026-07-12) — its complexity all came
  from the project being *implicit*. Naming the project as a first-class,
  directory-backed value dissolves that: the reserved `components/`
  subdirectory (FR-121) is where per-project component types live. **Phase 2
  (FR-121i) is now implemented** on this foundation — see "Project-local
  component types" below — and stays small precisely because the project is
  explicit and always current (FR-121c), so the server just scans
  `<current project>/components/` per request with no scope-follows-file
  plumbing.

**Project-local component types (Phase 2, FR-121i).** The client library is a
**two-tier merge**: the read-only shared library fetched once at bootstrap
(§6.2/§6.12), with the current project's `components/` types layered on top.
- **Fetch.** `api.components(projectDir?)` (§6.12) calls
  `GET /api/v1/components?project=<dir>`; the server returns `shared ∪ project`
  and per-file `warnings` (posted to the tray, FR-074). With no project the call
  omits `project` and returns the shared library alone (startup, FR-121c).
- **Reload triggers.** `setCurrentProject` (and the New/Open Project and
  open-design paths that call it) re-fetches the merged library for the incoming
  project and rebuilds the palette, discarding the outgoing project's local
  parts; **Refresh Types** (FR-088, §6.11) additionally re-fetches so
  externally-added/-edited `components/` files go live. The palette keeps FR-006
  ordering — authored parts are free-form-named and sort within that group; no
  separate region.
- **Create.** The New GAL / New MEM create call (§6.11/§6.12) now passes the
  current project dir; the server writes under `<project>/components/` and refuses
  an `id`/filename that collides with the project **or** the shared library
  (FR-007a/FR-121i). On success the client appends the tile live (FR-007a), no
  re-fetch needed.
- **Non-goals.** No auto-migration of parts already in the shared startup
  directory (the two example RAM types authored under the old behavior are moved
  by hand if wanted, FR-121i); no filesystem watching beyond Refresh Types.

**Current project (store state, FR-121).** `store.state.project` (§6.10):
`null` or `{ dir, name, manifestFile, mainDesign }` — the client-side mirror of
the server's `ProjectInfo` (§6.5a) minus its warnings, which are posted to the
message tray at fetch time. At most one is current; the server holds no
open-project state.

**Module `web/js/chrome/project.js`.** Pure helpers (unit-tested in
`project.test.js`) plus a `makeProjectOps({ store, dataDir, fileops, post })`
factory whose ops `app.js` wires into the File menu:

- `isManifestName(name)` — case-insensitive `-manifest.json` suffix test,
  mirroring the Go `IsManifestName` (§6.5a). Used by the design-save validator
  (below) and `resolveProjectPick`.
- `resolveProjectPick({ path, isDir })` — pure mapping of an Open Project pick
  to `{ dir, designPath|null }`: a folder → itself; a manifest file → its
  containing folder; a design file → its containing folder plus that design
  (FR-121b's three accepted forms).
- `absoluteDataPaths(designObj)` — pure scan of a **saved** design object's
  `components[].typeData.mem` for absolute `romFile`/`ramFile` values,
  returning `[{ refdes, path }]`. By FR-121g an absolute mem path in a saved
  design is by construction outside its project, so this is exactly the
  Duplicate Project shared-data warning scan (FR-121f).
- `setCurrentProject(dir, info?)` — fetches `api.projectInfo(dir)` when `info`
  is not supplied, calls `store.setProject({dir, name, manifestFile,
  mainDesign})`, and posts each `warnings` entry to the tray (FR-074:
  extra manifests, unparseable manifest, dangling main design — FR-121a).
- `newProject()` (FR-121b) — FR-049a dirty guard → location+name prompt:
  `openFileDialog({ mode:"save", title:"New Project", startPath: dataDir
  (FR-050), exts:["-"], saveExt:null })` (§6.11: directories-only listing, no
  extension appended; the typed name is the folder name) →
  `api.projectCreate(path)` (a 409/exists or other failure posts to the tray
  and aborts) → `setCurrentProject` from the response → replace the canvas
  with a fresh empty design named after the project (FR-121b — the folder
  name, superseding the FR-045 default in this flow, so the first save
  prefills `<project>.json`; `savePath` null) and clear the nav stack — the
  new empty project is current with a new design in it (FR-121c).
- `openProject()` (FR-121b) — dirty guard → pick dialog
  `openFileDialog({ mode:"open", title:"Open Project", startPath: dataDir,
  allowDir:true, includeManifests:true })` (remembered directory applies,
  FR-052a) → `resolveProjectPick` → `api.projectInfo(dir)` →
  `designPath := picked design ?? (info.mainDesign ? dir + "/" + mainDesign :
  null)`. If `designPath` is set → `fileops.loadIntoStore(designPath,
  { projectInfo: info })` — success establishes the project (containing-folder
  rule below) with the prefetched info, including the FR-022a auto-fit; a load
  failure aborts the whole action with a tray report. If no `designPath` → the
  open-design dialog rooted at the project
  (`openFileDialog({ mode:"open", startPath: dir, ignoreLastDir: true })`,
  §3.1 A11); **cancel cancels the whole action** — no project change, no
  canvas change (§3.1 A9).
- `duplicateProject()` (FR-121f) — requires a current project; FR-049a dirty
  guard **first** (duplication copies files on disk, not the unsaved canvas) →
  destination prompt (the New Project prompt, seeded at the data dir) →
  `api.projectDuplicate(src: project.dir, dst)`. Failure → tray report noting
  the partial destination is left for manual cleanup (no rollback). Success →
  `setCurrentProject` from the response, then open per FR-121b: the (copied)
  manifest's `mainDesign` → `loadIntoStore` it; else the open-design dialog
  rooted at the duplicate — here a cancel leaves the duplicate current with a
  fresh empty design (project-named, as in `newProject`), because the copy has
  already happened (§3.1 A9's noted
  asymmetry). Finally the **shared-data scan**: `listDir(dst)` (designs only —
  manifests are excluded by default) → `loadDesign` each → `absoluteDataPaths`
  → one tray message per hit naming the design file, refdes, and path as
  "still shared with the original project" (a shared RAM save file would be
  overwritten by running the duplicate, FR-114g). Scan failures are non-fatal
  (tray).

**fileops rework (`chrome/fileops.js`).**
- `save` — the first-save / Save As prompt is `startPath:
  store.state.project.dir` (FR-047/FR-049/FR-121h) with the `validate` hook
  (§6.11): reject a name matching `isManifestName` (FR-121a) and a resolved
  path outside `project.dir` (FR-121e), inline in the dialog plus a tray post
  (FR-074). Serialization additionally runs `relativizeDataPaths(out, baseDir,
  project.dir)` (below). After `markSaved`, **main-design recording**
  (FR-121a): if `project.manifestFile` is set and `project.mainDesign` is not,
  read the manifest (`api.loadDesign` of the manifest path — it is plain
  JSON, the `.tv` precedent), set `mainDesign` to the saved file's base name,
  write it back (`api.saveDesign`), and `setProject` the updated value;
  any failure here is non-fatal (tray). Consequently no save ever changes the
  current project (FR-121e).
- `loadIntoStore(absPath, { projectInfo } = {})` — after the childPath
  absolutization it runs `absolutizeDataPaths(loaded, baseDir)` (FR-121g);
  reports each **legacy outside-project child reference** once via the tray
  (FR-121d; containment is checked against `dirOf(absPath)`, which under the
  flat layout *is* the project root of the design being loaded); and on
  success applies the **containing-folder rule** (§3.1 A10): if there is no
  current project or `dirOf(absPath)` differs from `project.dir`, it calls
  `setCurrentProject(dirOf(absPath), projectInfo)` — `projectInfo` avoids a
  duplicate fetch when Open Project already has it. Plain `open()`, `descend`,
  `followTarget`, and `back` are otherwise unchanged; project switching falls
  out of the shared load path (FR-121b/FR-121d).
- `addSubDesign` — picker seeded at the project root (FR-121h); refuses a
  chosen file outside `project.dir` with a toast (FR-121d/FR-097a), before the
  existing cycle check (§6.14).
- `save`, `newDesign`, `addSubDesign` early-return with a tray message when no
  project is current (defense in depth — the chrome already disables them and
  the store lock refuses dispatches, §6.10/§6.11).

**Data-path conversion helpers (`model/persist.js`, FR-121g).** Two pure,
unit-tested functions beside `serializeDesign`/`deserializeDesign` (POSIX
forms; the fileops path helpers' existing Windows caveat applies):
- `relativizeDataPaths(serialized, baseDir, projectDir)` — for each component
  whose `typeData.mem` carries an absolute `romFile`/`ramFile` **inside**
  `projectDir`, replace it with `relPath(baseDir, p)`; paths outside the
  project stay absolute (the loose data boundary, FR-121d). **Copy-on-write**
  (`{...c, typeData: {...td, mem: {...}}}`) because `serializeDesign` shares
  the live component objects — the portDir-stamping precedent (§6.14) — so
  the in-memory model keeps its absolute paths.
- `absolutizeDataPaths(design, baseDir)` — any relative `romFile`/`ramFile` →
  `resolveRel(baseDir, p)`, mutating the just-deserialized load copy in place.
  A legacy absolute in-project path loads as-is and comes back **relative**
  after its next save (FR-121g's rewrite-on-save rule, free from
  relativization being unconditional at save).

Consumers are unaffected: the run-time reads/writes (FR-114e/FR-114g), the mem
properties/dialog, and the C generator's baked paths (FR-117b/FR-117c) all see
the resolved absolute in-memory form. `serializeDesign` itself stays verbatim,
so a backup snapshot (§7.4) stores absolute paths — correct for same-session
recovery (the childPath precedent). The component-library YAML's `mem:` block
(§7.6) keeps the absolute path captured at creation — FR-121g governs only the
**design file**; the per-instance `typeData.mem` copy is what designs
round-trip. Node tooling needs no change: `parity.js` already resolves a
relative `romFile` via its basename-in-the-design's-directory candidate
(§6.17 M2), which is exactly where a project-relative path points under the
flat layout.

**API client (`api.js`).** `projectInfo(dir)`, `projectCreate(path)`,
`projectDuplicate(src, dst)` (thin wrappers over §6.4's endpoints);
`listDir(path, exts, { includeManifests } = {})` grows the `manifests=1`
query.

**Dialog-seeding summary (FR-121h).** Save-mode dialogs seed at the current
project root: design first-save/Save As (§6.11), `.tv` save (§6.16),
Generate C… (§6.17), Export… (§6.18) — for the last three this is the same
directory their former `dirOf(savePath)` defaults produced under the flat
layout, now stated once as the project rule and defined even for an unsaved
design. The ROM-content and RAM save-file pickers seed at the project root but
may navigate anywhere (FR-121d, §6.14). Open-mode dialogs keep the
remembered-directory rule (FR-052a) unchanged, except the FR-121b main-design
picker (`ignoreLastDir`, §3.1 A11).

- **Error handling:** every project-op failure (create/duplicate/info fetch,
  manifest read-modify-write, shared-data scan) posts to the message tray and
  leaves the store consistent — a failed Open Project changes nothing (§3.1
  A9); a failed Duplicate leaves the previous project current and names the
  partial destination. Manifest problems are never fatal (FR-121a).
- **Dependencies:** `store.js`, `api.js`, `chrome/dialogs.js`
  (`openFileDialog`), `chrome/fileops.js`, `chrome/statusbar.js`
  (`postMessage`), `model/persist.js`.

### 6.20 JS/C: magic UART + Console panel (`web/js/engine/uart.js`, `chrome/console.js` + builtins/sim/canvas/cgen/runtime/store/toolbar/app wiring)

- **Purpose:** a built-in, output-only character device (requirements §3.26) and the
  slow simulator's console surface for it.
- **Satisfies:** FR-122, FR-122a, FR-122b, FR-122c, FR-122d (and FR-107/FR-078 for it).

**Component kind — a fixed built-in, not a metatype.** The UART is byte-fixed with
no parameters, so it is a built-in in `builtins.js` `BUILTIN_DEFS` (like the
transmission gate/relay, FR-071g/h), **not** a server-persisted generated metatype
like the memory device (FR-114). Consequences: **no Go server change**, no dialog, no
library YAML; a placed instance round-trips through a save via its embedded
`typeData` (FR-057) like any built-in. The type entry (`builtins.js`, FR-122/FR-122a)
carries `name:"uart"`, `renderType:"uart"`, `title:"magic UART"`, pins
`D0..D7` (`BIT_PINS("D","left","in",8)`) plus `CS/`,`CE/`,`CLK` on the opposite edge,
one `pinGroups` entry `DATA`, and **no** `properties` and **no** `BEHAVIORS` entry —
its behavior reads input nets and keeps state, the same reason `memory.js` is a
separate core rather than a source-only `BEHAVIORS` function.

**Behavior core (`web/js/engine/uart.js`, FR-122b).** Pure, DOM-free, net-free —
the `memory.js` analogue. `createUartCore() → { clockStep(read, emit), peek() }`,
where `read(pinName)→V` is supplied by `sim.js` (previous-step net value, Z→U, unit
delay FR-078) and `emit(byte)` is the side-effect sink (byte 0..255, called at most
once per `clockStep`). It holds `prevClk` (power-up `VU`) and the latched `reg`.
`clockStep`: normalize `CLK`; on `prevClk===V0 && clk===V1`, and **only** if
`norm(read("CS/"))===V0` and `norm(read("CE/"))===V0`, assemble the byte from D0(LSB)
…D7(MSB) with any non-`V1` bit as 0 (U→0, FR-114g), store it, and `emit`; update
`prevClk`. Any uncertain/deasserted control ⇒ no emit (FR-122b — a character is
irreversible, so unlike memory this is conservative, not pessimistic). Unit-tested in
isolation (`uart.test.js`).

**Slow engine (`sim.js`, FR-122b).** `buildSimulation` gains an `onConsole` option
(default no-op). For each instance with `renderType==="uart"` it builds a
`{ kind:"uart", refdes, core:createUartCore(), read }` entity, reusing the same
per-pin previous-step `read` closure the memory entity uses. In `step()`, in the
latch phase beside the memory `writeStep` loop, it calls
`e.core.clockStep(e.read, onConsole)` for each UART entity. The UART deposits **no**
contributions (drives nothing) and adds no driver. Emission order across UARTs within
a step follows entity order (deterministic, for stable parity). `createSim.run()`
passes `onConsole: (b)=>consolePanel.write(b)` and clears the panel at run start
(beside the message-tray clear, FR-076). No change to `stop()`.

**Console panel (`web/js/chrome/console.js`, FR-122c).** A **bottom-docked** panel
in the canvas area, structurally like the test-vector panel (§6.16) but **modeless —
it never contributes to `isReadonly()`** (contrast FR-115h) and coexists with a live
run. `createConsolePanel({ store }) → { write(byte), clear(), setOpen(bool),
isOpen() }`. `write` pushes into an in-memory buffer and schedules a single
`requestAnimationFrame` repaint that flushes the buffer to the DOM, coalescing many
bytes/frame into one update — the "asynchronous, non-blocking, heavily buffered"
requirement (no backpressure ⇒ no overrun). Byte rendering is centralized in
`renderByte(b)`: printable ASCII verbatim, LF→newline, TAB→tab, CR ignored, else
`\xNN`. **Sticky-tail** autoscroll (scroll to bottom after a repaint only if already
at bottom). A **retained-history cap** (`CONSOLE_MAX_CHARS`, e.g. 200 000) head-trims
with a "…output truncated…" marker. `clear()` empties buffer+DOM (Clear button and
Run-start). DOM skeleton (`#console-panel` with `.console-header` holding the title +
Clear + close, and a scrolling monospace `.console-body`) lives in `web/index.html`
with CSS; open/close is driven by `store.state.consolePanelOpen`. Accumulated text and
open state are session-only (not saved). Unit-tested where logic allows
(`console.test.js`: `renderByte`, buffering/coalescing, cap trim, sticky-tail, clear).

**Chrome wiring.** `store.js` gains `consolePanelOpen:false` + `setConsolePanelOpen`
(notifying subscribers) that **does not** feed `isReadonly()`/`blocked()` (modeless).
`toolbar.js` adds a **View ▸ Console** toggle item (rendered checked when open),
enabled while simulating (it is meant to be opened during a run). `app.js`
instantiates the panel, wires `onConsole`, and subscribes it to
`consolePanelOpen`. `canvas.js` gains a `renderType==="uart"` draw branch (IC-style
box labeled "UART" + pin stubs from the type data), with pin geometry in `symbols.js`
if needed; the same glyph is the palette icon (FR-122a).

**Fast engine (`cgen.js` + `runtime.{h,c}`, FR-122d).** The `gen_mems[]` pattern
verbatim. `cgen.js` emits a `gen_uarts[]` table: for each `renderType==="uart"`
instance, the net indices of `D0..D7`,`CS/`,`CE/`,`CLK` (via `netOf`) plus the
refdes; the UART drives nothing, so `driverCount` is unchanged. `runtime.h` declares
`rt_uart { const int *data; int cs; int ce; int clk; const char *refdes; }`,
`gen_uarts[]`, `gen_uart_count`. `runtime.c` holds per-instance `uart_states[]`
(`prev_clk`, `RT_U` at reset via a `uart_reset` called from `rt_reset`) and
`uart_step()` — called in the **latch phase** beside `mem_write_all`, reusing
`mem_rd(curr,net)` (Z→U, and `-1`→U for an unwired pin): detect CLK 0→1, and if
CS/==RT_0 and CE/==RT_0 assemble the byte (clean-`RT_1` bits only) and `putchar` to
stdout. `main()` sets `setvbuf(stdout, NULL, _IOFBF, …)` (heavily buffered) and does
an explicit `fflush(stdout)` before the end-of-run observable dump so UART bytes and
the trailing dump/transcript are ordered deterministically across libc. This is a
`gen_`/runtime **interface addition** (pre-existing generated programs regenerate
once, as for the M5/M7 interface bumps). No generator refusal — the UART is supported
in both batch modes.

- **Error handling:** unconnected CLK/CS//CE/ (unknown pin in JS, net `-1` in C) read
  U ⇒ never qualifies, no emit, no crash; `putchar` failure ignored; `renderByte`
  total over 0..255.
- **Dependencies:** `uart.js` ← `galasm.js` V-constants; `sim.js` read-closure
  builder; `console.js` ← `store.js` + DOM; `cgen.js` `netOf`/`cstr`; `runtime.c`
  `mem_rd` + libc `stdio`.

---

## 7. Data Model

### 7.1 `ComponentType` (server in-memory + `/components` JSON + copied into saves)

| Field | Type | Notes |
|---|---|---|
| `id` | string | immutable, **library-unique** internal identity (FR-066e), e.g. `"type-74138"`, `"type-22V574"`; the sole library key, the value an instance records as its `type` (§7.2), and the YAML filename stem. Divorced from the display name, so editing `name`/`partnumber` never changes it |
| `name` | string | the type's free-form **display name** for a 74-series part, e.g. `"74138"` (FR-005/FR-062); for a GAL part this is the device family, e.g. `"22V10"` (FR-066b), and the `partnumber` is the display name instead. Not a key (see `id`) |
| `partnumber` | string? | GAL parts only (FR-066b): the part's free-form display name, e.g. `"PC-DECODE-A"` (shown as the tile/canvas label, FR-005b). Not a key and need not be unique. Absent on 74-series types |
| `renderType` | enum | `unit` (default) \| `subunit` (FR-062c) |
| `numUnits` | int | subunit packages only: number of functional units (FR-062c); 0/omitted for `unit` |
| `renderAs` | string | subunit packages only: schematic symbol — `nand`\|`and`\|`or`\|`nor`\|`xor`\|`xnor`\|`not`\|`mux2`\|`mux4`\|`mux8` (FR-013b) |
| `width` | int | `unit` only: outline width in grid units (>0); **resolved** value (stated as `outline:`, or derived from pins — §6.3). Unused for `subunit` (symbol geometry owns size — §6.8a) |
| `height` | int | `unit` only: outline height in grid units (>0); resolved value. Unused for `subunit` |
| `pins` | `Pin[]` | FR-062, FR-062a |
| `pinGroups` | `PinGroup[]` | optional (FR-063) |
| `delays` | `map[string]number` | optional propagation delays, ns (FR-064); not used by the slow simulator (FR-078) |
| `behavior` | string | GALasm equations, captured verbatim by the server (FR-066); compiled and evaluated client-side by the slow simulator (§6.13, FR-079) |
| `clock` | string? | optional name of the input pin that clocks `.R` registered behavior outputs (FR-062d); parser-validated to exist with `dir: in`; required (checked at Run time) iff the behavior uses `.R` |
| `internal` | `string[]?` | optional buried registered-node names (FR-079c): registered state the behavior block uses that surfaces on no pin (e.g. the 74HC165's seven hidden shift stages). Server-validated as legal, duplicate-free names distinct from pin names; that each has a `.R` equation is checked client-side at Run (§6.13). Absent on parts with no buried state |
| `properties` | `Property[]` | optional named numeric parameters (FR-020b): `{name, unit, default}`, e.g. the clock's `{name:"period", unit:"ns", default:100}` (FR-071a). Declared by built-ins in the client registry today; YAML types may declare them later. Serializable data only — per-instance values live in `overrides.props` (§7.2) |
| `description` | string? | optional one-line function summary (FR-104), e.g. `"3-to-8 line decoder/demultiplexer"`; presentation-only |
| `datasheet` | `Datasheet?` | optional provenance (FR-104): `{vendor, title, rev, url}`, all strings; the panel renders `url` as a link |
| `mem` | `MemSpec?` | generated memory device only (FR-114c/FR-114f): `{kind:"ram"\|"rom", addressBits, dataWidth, locations, romFile?, ramFile?, ramLoad?}`. Serializable data the client's built-in memory behavior binds from at Run (FR-114d); round-trips through the `mem:` YAML block (§7.6) so a persisted device simulates on reload. `ramFile`/`ramLoad` carry RAM persistence (FR-114g). Absent on all other types |
| `physical` | `PhysicalSpec?` | optional exporter-only package metadata (FR-062e): `{package?, pincount, power[], nc?}` — see §7.6. Carried verbatim (like `mem`), parser-validated for physical completeness, and copied into saves per FR-057 so exporters can work from the design JSON alone. Read by no editor or simulator code |

Built-in types additionally have a **behavior** (FR-067a): a client-JS function
held in a registry in `builtins.js` keyed by type `id` (FR-066e) — deliberately **not** a
`ComponentType` field, because `typeData` is deep-copied into instances and
saved as JSON (FR-057), which would drop or corrupt a function value. The
simulator resolves a behavior from the registry by `inst.type` (the type id) at
run time; its signature is `behave(ctx) → [{pin, value, weak?}]` (§6.13).

Note: for `unit` components `width`/`height` are always **concrete in the parsed
`ComponentType`** — resolution happens at parse time (§6.3) so the canvas, the
save format, and FR-057's full-copy all keep consuming explicit geometry. For
`subunit` components the rectangle is not drawn; each unit's footprint and pin
positions come from the schematic-symbol geometry module (§6.8a), so `outline:`
and per-pin `pos` are ignored. There is no package field **affecting geometry**:
physical packages were removed in favor of an explicit `outline:` or a
pin-derived default (see §8). The optional `physical` block (FR-062e) records
package metadata for exporters but never influences the symbol.

**`Pin`**

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"A0"`, `"/Y3"` |
| `side` | enum | `left` \| `right` \| `top` \| `bottom` (FR-014) |
| `position` | int | `unit` only: grid units along the side from its origin (top for L/R, left for T/B). Ignored for `subunit` |
| `unit` | string? | `subunit` only: the functional unit this pin belongs to (a letter, `A`, `B`, …); replaces `position` (FR-014a). List order within a unit sets slot order |
| `direction` | enum | `in` \| `out` \| `bidir` \| `tristate` (FR-062a) |
| `number` | int? | optional physical pin number (e.g., DIP pin 7); author-stated (FR-062b); footprint/BOM metadata only, used by neither drawing nor simulation |
| `desc` | string? | optional pin role for documentation (FR-104), e.g. `"active-low chip enable"`; presentation-only |

Every pin carries exactly one bit; a parallel bus is modeled as a `PinGroup` of
single-bit pins (FR-063), not as a multi-bit pin.

**`Datasheet`** (optional, FR-104)

| Field | Type | Notes |
|---|---|---|
| `vendor` | string | manufacturer, e.g. `"Nexperia"` |
| `title` | string | document title |
| `rev` | string | revision/date, e.g. `"Rev. 10, 26 Feb 2024"` |
| `url` | string | link to the datasheet PDF |

**`PinGroup`**

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"A"`, `"DATA"` |
| `pins` | string[] | ordered member pin names (bit order) (FR-063) |

Group width = number of member pins (each pin is one bit; A3). Used for bus snap
(FR-041).

### 7.1a `Vertex` — the first-class electrical node (A1, A2, FR-034b, FR-059)

Connectivity is modeled as a graph: wires/buses are edges, and every point where
a net can be joined (a component pin, a branch/junction, or a dangling free end)
is a `Vertex` object with a stable id. Wires reference vertices by id; two wires
connect **iff** they reference the same vertex id.

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `"v17"`; stable; referenced by wire/bus `path` node-points |
| `x`, `y` | int | grid coords of the node |
| `kind` | enum | `pin` \| `junction` \| `free` \| `connector` (FR-094, §6.14) |
| `ref` | string? | `kind=pin`/`connector` only: the host instance's `refdes` (its immutable identity, FR-011/§7.2), e.g. `"U3"` (for `connector`, the port instance, §6.14). The editable display label (§7.2) is never used here |
| `pin` | string? | `kind=pin` only: pin name, e.g. `"Y0"` |
| `bit` | int? | `kind=junction` on a **bus** only: the bit-lane this junction taps (FR-043a breakout). Absent/`null` = full join of all lanes (bus↔bus, FR-039a) |

**Position authority differs by kind (deliberate):**
- `kind=pin` → `x,y` is **derived** from `pinWorldPos(instance, pin)` and
  recomputed when the instance moves/rotates. This is why connected wires stretch
  for free (FR-018) — they reference the pin vertex, which follows the instance.
- `kind=junction` / `kind=free` → `x,y` is **authoritative** (user-placed/dragged).
- `kind=connector` → `x,y` is **derived** from the host port instance (like `pin`), so wires to a port stretch for free; the port's `label`/`portDir`/`dirOverride`/`width`/`target` live on the instance (§7.2), not the vertex (§6.14).

A junction vertex's grid position lives **only** here, so the host wire and every
branch wire that meet at it share one position and cannot drift apart (A1).

### 7.2 `Design` (JSON save file — FR-055/FR-056)

```jsonc
{
  "formatVersion": 3,                  // migration anchor (NFR-004-style); v2 re-keyed instance `type` to the type id (FR-066e); v3 added `refCounters` (FR-011c)
  "name": "unnamed schematic 2026-06-01 14:03",
  "defaultRender": "ic",               // FR-096: render style when THIS design is embedded (ic|connector)
  "primaryClock": "A-7",               // FR-076b: refdes of the primary clock generator (Step-cycle target, FR-076a); additive-optional — absent when the design has never had a clock, no formatVersion bump
  "refCounters": { "U": 29, "A": 19, "N": 4, "X": 5 },  // FR-011c: per-series high-water refdes counters — the next number each series may allocate; monotonic, so a retired designator is never reused
  "components": [ ComponentInstance, … ],   // (a) FR-056 (includes built-in ports and sub-design instances)
  "wires":      [ Wire, … ],                // (b) FR-056
  "buses":      [ Bus,  … ],                // (c) FR-056
  "vertices":   [ Vertex, … ],              // electrical nodes referenced by wires/buses (§7.1a)
  "nets":       [ Net,  … ]                 // derived convenience (A4, FR-059a)
}
```

**`ComponentInstance`** (FR-057, FR-058)

| Field | Type | Notes |
|---|---|---|
| `refdes` | string | the instance's reference designator, e.g. `"U3"` — its **immutable internal identity** (FR-011): unique within the design and the foreign key referenced by vertex `ref` (§7.1a), bus group-snaps, selection, and persistence. Auto-allocated (U/A/N/X series), never user-edited |
| `label` | string? | optional free-form, user-editable display designator (FR-011b); when absent the canvas/properties show the `refdes`. Editing it (a `setLabelCmd`) never affects identity or wiring; duplicates allowed. Absent for the text note (no designator shown) |
| `type` | string | the placed type's immutable **library id** (`ComponentType.id`, FR-066e), e.g. `"type-74138"` for a 74-series part, `"type-22V574"` for a GAL part, `"type-indicator"` for a built-in. It keys the simulator's per-type behavior cache and Refresh Types matching. The display name shown as the canvas label comes from `typeData` (`partnumber` or `name`), not this field |
| `x`, `y` | int | grid coordinates of unrotated origin (FR-021) |
| `rotation` | int | `0`\|`90`\|`180`\|`270` |
| `typeData` | `ComponentType` | full copy captured at placement, persisted verbatim at save (FR-057); re-copied only by Refresh Types (FR-088). **Exception (FR-121g):** `typeData.mem.romFile`/`ramFile` are held **absolute in memory** but written **project-relative** when they lie inside the project (relativized by `fileops.save`, absolutized by `loadIntoStore` — the `childPath` boundary-conversion pattern, §6.19); an outside-project data path stays absolute (FR-121d) |
| `overrides` | object | per-instance field overrides, grouped by kind: `{"delays":{"tpd":12},"props":{"period":200}}` — `delays` shadows `typeData.delays` (FR-058), `props` shadows `typeData.properties` defaults (FR-020b) |
| `switchState` | string? | input-switch built-in only (FR-071c): current state, `"0"` \| `"1"` (default `"0"`; a legacy `"U"` reads as `0`). Per-instance interactive state, not an `overrides` entry; set via the properties panel (FR-020c) or a click during a run (FR-087a) |
| `kind` | string? | `"subdesign"` for a sub-design instance (FR-098); absent/`"component"` for an ordinary, subunit, or built-in instance (§6.14) |
| `childPath` | string? | sub-design only: child design file path. **On disk relative to the parent's save dir** (FR-098); **absolute in memory** after load (absolutized by `fileops.loadIntoStore`, relativized by `fileops.save`). Resolved on load to derive the interface; no `typeData` is stored (supersedes FR-057 for sub-designs) |
| `render` | string? | sub-design only: chosen embed rendering `"ic"` \| `"connector"` (FR-099) |
| `label` | string? | port / portN built-ins (FR-094/FR-071e): interface signal name; same-label 1-wide ports share a net (FR-094a) |
| `portDir` | string? | port / portN built-ins: `"in"` \| `"out"` \| `"bidir"` — **derived** from wiring (FR-094c); the **effective** direction (override applied, FR-094d) is written at save, not hand-set (portN aggregates across its bits) |
| `dirOverride` | string? | port / portN built-ins: optional `"in"` \| `"out"` direction **override** (FR-094d), meaningful only when the derived direction (FR-094c) is `bidir`; absent otherwise. Set via the properties panel (`SetPortProps`); round-trips with the instance |
| `width` | int? | **portN built-in only**: chosen bit width 2–16, fixed at placement (FR-071e). A 1-wide port has no width — it is always one bit (FR-094) |
| `target` | object? | off-sheet connector only (FR-101): `{ "file": <sibling filename, same folder, no path>, "label": <port label in that file> }`; its presence makes the port navigable (FR-100) and cross-file-joined (FR-101a) |

**`PathPoint`** (FR-059, A1, A2) — a wire/bus `path` is an ordered list of these,
length ≥ 2. The **first and last** path-points must be `node` points (the wire's
two endpoints); interior points are usually `bend` (geometry only).

```jsonc
{ "t": "node", "v": "v17" }              // an electrical node — references a Vertex (§7.1a)
{ "t": "bend", "x": 40, "y": 16 }        // geometry only; nothing connects here
```

A `node` path-point whose vertex `kind=pin` ties the end to a component pin
(replacing the old `pin` endpoint); `kind=free` is a dangling end (FR-029);
`kind=junction` in the **interior** of a path is a branch point shared with
another wire (FR-034b).

**`Wire`** (FR-059)

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable, e.g. `"w12"` |
| `path` | `PathPoint[]` | ordered, length ≥ 2; first & last are `node` points (A2) |

**`Bus`** (FR-060) — a `Wire` plus:

| Field | Type | Notes |
|---|---|---|
| `width` | int | bus width in bits (FR-037, FR-038) |
| `groupConnections` | `GroupConnection[]` | snap-connect metadata (FR-042/FR-060) |
| `bitNames` | string[]? | optional per-bit signal names, length = `width` (FR-037b/FR-060a); adopted from a group on first snap; `null`/absent = unnamed |

`GroupConnection` anchors to the endpoint **vertex** rather than `"a"|"b"`:
`{ "vertex": "v31", "instance": "U3", "group": "A", "bitMap": ["A0","A1","A2"] }`.
Bit *i* of the bus ↔ `bitMap[i]` (FR-042). `bitMap` is the connection's **claimed
block** (FR-041c): the whole group for an equal-width snap, or a contiguous
sub-range of the group's pins for a partial (narrower-bus) snap. Because the
mapping is already pin-name-explicit, partial connections need no new field — two
buses may hold disjoint sub-ranges of one group. Breakout taps are **not** group
connections — they are wires whose endpoint vertex is a `junction` on the bus with
`bit` set (§7.1a, FR-043a).

**`Net`** (derived, A4/FR-059a/FR-060a) — one per electrical signal, so a width-*w*
bus yields up to *w* nets:
```jsonc
{
  "pins":       ["U3.Y0", "U5.A1"],          // attached component pins
  "members":    ["w12", "b3"],               // wire/bus ids carrying this signal
  "provenance": [ { "bus": "b3", "bit": 2, "name": "N" } ],  // bus-lane origin(s), FR-060a
  "name":       "N"                          // resolved signal name, or null
}
```

### 7.3 Data lifecycle (CRUD)
- **Create:** instances by placement (FR-008/009/011) — each pin a wire later
  binds to becomes a `pin` vertex on demand; wires/buses by the Wire/Bus tools
  (FR-027/039), creating their endpoint vertices (`pin`/`free`); bends by
  dragging from segments (FR-031); junction vertices by branching (FR-034).
- **Read:** the renderer reads the live model each frame; Save serializes it.
- **Update:** moves/rotations recompute affected `pin` vertices, so connected
  wires **stretch automatically** (FR-018); overrides/bend-drags/width changes,
  all via Commands. Dragging a junction vertex moves the one shared node, so all
  wires meeting there follow (FR-032, no drift).
- **Delete:** components (FR-018a — their `pin` vertices convert to `free`); wires/
  buses (FR-033a — junction-vertex ref counts decremented, demoting to `free` or
  deleting per §3.3 G2); bends (FR-033). The FR-030 sweep (remove any wire/bus
  whose endpoint vertices are all `free` **and not group-snap-connected** — a
  bus endpoint named by a `groupConnections` entry is connected per
  FR-041a/FR-042 even though its vertex kind is `free`) runs after any deletion.

### 7.4 Persistence & migration (FR-060c, FR-060d)
Files are JSON written atomically (§6.5). `formatVersion` is the migration anchor;
the client writes/reads version `3` (v2, FR-066e, re-keyed instance `type` to the
type id; v3, FR-011c, added the `refCounters` high-water designator counters).
The **vertex/graph model (§7.1a) is the
version-`1` format from the outset** (nothing older shipped). For the record, the
conceptual map from the earlier endpoint-union sketch is: old `pin` endpoint → a
`pin` vertex; old `free` → a `free` vertex; old `junction{target,x,y}` → a
`junction` vertex at `(x,y)` inserted as a `node` path-point in the target wire's
`path`, with the branch wire's endpoint referencing it.

**Migration framework (`persist.js`, FR-060c).** The compatibility scaffolding is
in place from version 1 so future format changes slot in without touching callers:

- `MIGRATIONS` maps a version *n* to a pure function upgrading a parsed save
  object from version *n* to *n+1*; each format change bumps `FORMAT_VERSION` and
  adds the one step keyed by the version it upgrades *from*. The **1→2** step
  (FR-066e) is a pure textual transform needing no library access: for each
  component instance it re-keys `type` to the type id by setting `type := "type-" +
  (typeData.partnumber || typeData.name)` (and stamps `typeData.id` to match) — the
  same deterministic id rule the library and built-ins use, so an old instance
  re-matches its type. `refdes` (the identity) and all `v.ref`/group-snap references
  are unchanged; the editable `label` (§7.2) needs no migration (absent ⇒ defaults
  to `refdes`). Sub-design instances (no `typeData`) keep their path-derived `type`.
  The **2→3** step (FR-011c) is likewise pure and textual: it sets `refCounters`
  to `{U, A, N, X}`, each `1 + the highest number present in components` for that
  series (0 present ⇒ counter 1; a subunit letter suffix is ignored, so `U5A`
  counts as 5) — exactly the value the pre-v3 allocation rule would compute. A
  number freed by a deletion made before the migration, and higher than every
  surviving number in its series, therefore remains reusable one last time; the
  file carries no history to recover it from (FR-011c).
- `migrate(obj, {target = FORMAT_VERSION, migrations = MIGRATIONS})` normalizes a
  parsed object to the target version: it reads `obj.formatVersion ?? 1` (absent =
  oldest understood) and, while below the target, applies each step in turn,
  stamping `formatVersion` after each. A missing step throws a legible error
  (rejecting the load, not misreading it). A file at or beyond the target is
  returned unchanged. `target`/`migrations` are injected only by tests, so the
  chain is exercised before a real version 2 exists.
- `deserializeDesign` calls `migrate` first, so every load path — Open (fileops),
  backup recovery (§6.10), tests — sees one normalized shape.

Forward-compat (newer than understood) is **not** a migrate concern: `migrate`
passes such a file through untouched and the load flow (`fileops.loadIntoStore`)
warns via toast `(obj.formatVersion ?? 1) > FORMAT_VERSION`, then loads best-effort
(NFR-004 spirit).

**Load-time repair (`repairStructure`, FR-060d).** The server validates only that
the payload is JSON, so a truncated or hand-edited file — and any editor bug that
saves stale references — must be caught at deserialize, not later: an unresolvable
reference that reaches the canvas throws per frame (`pinWorldPos` via
`drawBusBraces`/`vertexWorld`) and wedges the whole SPA. After `migrate`,
`deserializeDesign(obj, {onWarn})` runs `repairStructure(d, onWarn)`, which
**drops** every unresolvable element, reporting each drop through `onWarn` (one
legible message naming the element and reason), in dependency order:
(1) a `pin`/`connector` vertex whose instance or pin does not exist is dropped
(sub-design instances skipped — their interface resolves later, §6.14);
(2) a conductor whose path has < 2 points or references a missing or
just-dropped vertex is dropped whole (never a partial path, which would silently
change topology); (3) a bus group connection whose instance, endpoint vertex, or
any `bitMap` pin does not resolve is dropped from its bus (the bus remains).
Callers thread `onWarn` to their surface — `fileops.loadIntoStore` and backup
recovery post to the message tray (FR-074); it defaults to a no-op. The repair
runs before `replaceDesign`, so it neither dirties the design nor creates an
undo entry (the FR-099c load-time-normalization precedent); a subsequent save
persists the repaired form. This supersedes the former `validateStructure`,
which rejected the whole file with a legible error on the first inconsistency —
adopted when bad saves were assumed rare; in practice editor bugs write them,
rejection leaves such a file unopenable except by hand-editing JSON, and its
coverage gap (group connections were never checked) let a stale `bitMap` pin
reach the render loop and wedge the app. Rejection remains for unparseable JSON
and a missing migration step (FR-060c).

### 7.5 In-memory client structures
The live model mirrors §7.2 but additionally keeps `nextWireId` and
`nextVertexId` counters and a transient `selection`/`viewport` — these are not
persisted (the id counters are rebuilt from the loaded ids' maxima at
deserialize), unlike the FR-011c `refCounters`, which are part of the saved
design precisely because they must not be derivable-down from the surviving
components.
For O(1) ops it also keeps non-persisted indexes: a `vertices` map keyed by id and
a per-vertex **ref-count** (how many wires reference it) used by the G2 demotion
logic (§3.3). `nets` are recomputed by `buildNets` (§6.6) at save time and on
demand (e.g., for future tools).

### 7.6 YAML file format — **BINDING**
This is the concrete component-definition file syntax (OQ-001 resolved with the
stakeholder). Files are **YAML** (decoded with `gopkg.in/yaml.v3`, YAML 1.2 core
schema) and use the `.yaml` extension in the component-library directory (§6.2).
The parser maps each document onto the `ComponentType` of §7.1.

```yaml
# 74138 — 3-to-8 line decoder
id: "type-74138"         # immutable library-unique key (FR-066e); optional — derived from the display name if omitted, but stated in every library file
type: "74138"            # REQUIRED string: free-form display name. Quote it: bare 74138 is a YAML integer.
outline: [6, 12]         # optional [width, height] in grid units; omit to derive from pins

pins:                    # one flow-mapping per line: name, side, pos, dir [, number]
  - { name: A0,  side: left,  pos: 2, dir: in }
  - { name: A1,  side: left,  pos: 3, dir: in }
  - { name: A2,  side: left,  pos: 4, dir: in }
  - { name: /E1, side: left,  pos: 6, dir: in }
  - { name: /E2, side: left,  pos: 7, dir: in }
  - { name: E3,  side: left,  pos: 8, dir: in }
  - { name: /Y0, side: right, pos: 2, dir: out }
  - { name: /Y1, side: right, pos: 3, dir: out }
  # … each pin is one bit (a parallel bus is a `group` of single-bit pins, below);
  #   add `number: 15` to record a physical DIP pin number (optional footprint/BOM
  #   metadata only). Power and ground pins (GND, Vcc) are NOT listed — they do
  #   not exist in the file, the editor, or the simulation.

groups:                  # optional, for bus snap-connect (FR-063)
  - { name: A, pins: [A0, A1, A2] }

delays:                  # optional map, ns (FR-064)
  tpd: 7

behavior: |              # GALasm, captured verbatim (FR-066); evaluated by the slow simulator (FR-079)
  ; GALasm's own ';' starts a comment inside this block. Equations are
  ; sum-of-products only (GALasm has no parentheses); '/' complements the
  ; signal named by the pin name with any active-low '/' prefix dropped
  ; (specs/galasmManual.txt, srv/components/74138.yaml).
  /Y0 = /E1 * /E2 * E3 * /A2 * /A1 * /A0
  /Y1 = /E1 * /E2 * E3 * /A2 * /A1 *  A0
```

A **subunit** package (FR-062c) omits `outline`/`pos` and instead names the symbol
and the unit each pin belongs to; list order within a unit sets slot order:

```yaml
# 7400 — quad 2-input NAND
id: "type-7400"
type: "7400"
rendertype: subunit
numunits: 4
renderas: nand

pins:                    # unit + dir; pos is not used (FR-014a)
  - { name: 1A, side: left,  unit: A, dir: in }
  - { name: 1B, side: left,  unit: A, dir: in }
  - { name: 1Y, side: right, unit: A, dir: out }
  - { name: 2A, side: left,  unit: B, dir: in }
  - { name: 2B, side: left,  unit: B, dir: in }
  - { name: 2Y, side: right, unit: B, dir: out }
  # … units C and D likewise
```

Any part (`unit` or `subunit`) may additionally carry an optional
**exporter-only** `physical:` block (FR-062e), never read by the editor or the
simulators — shown here as it appears in 7400.yaml:

```yaml
physical:                # optional; exporter-only metadata (FR-062e)
  package: DIP-14        # free-form name; exporters interpret it
  pincount: 14           # REQUIRED in this block; drives completeness check
  power:                 # power/ground pins, absent from pins[] per FR-062
    - { name: VCC, number: 14 }
    - { name: GND, number: 7 }
  # nc: [ 13 ]           # optional no-connect pin numbers
```

Presence of the block makes the parser enforce **physical completeness** (§6.3):
all signal pins numbered, and signal + power + nc numbers tiling exactly
1..`pincount` with no duplicates — so a part carrying `physical:` is guaranteed
fully and consistently numbered for KiCad/NDL/BOM export.

**Field reference** (maps 1:1 onto §7.1):

| Key | Required | Maps to | Notes |
|---|---|---|---|
| `id` | no | `ComponentType.id` | immutable, library-unique internal key (FR-066e), e.g. `"type-74138"`, `"type-22V574"`; the library key and `<id>.yaml` filename stem. Divorced from the display name. Optional — derived as `type-`+(`partnumber`‖`type`) when omitted; stated explicitly in every library file |
| `type` | yes | `ComponentType.name` | free-form **display name** (FR-005); quote if all-digits (`"74138"`). For a GAL part this is the device family; the `partnumber` is the display name instead |
| `rendertype` | no | `renderType` | `unit` (default) \| `subunit` (FR-062c) |
| `numunits` | subunit | `numUnits` | unit count; required for `subunit` (FR-062c) |
| `renderas` | subunit | `renderAs` | symbol name (FR-013b); required for `subunit` |
| `outline` | no | `width`,`height` | `unit` only: `[w, h]` grid units; omitted ⇒ derived from pins (§6.3). Ignored for `subunit` |
| `pins[].name` | yes | `Pin.name` | e.g. `A0`, `/Y3`; leading `/` is a safe plain scalar |
| `pins[].side` | yes | `Pin.side` | `left`\|`right`\|`top`\|`bottom` (FR-014) |
| `pins[].pos` | unit | `Pin.position` | int ≥ 0, grid units along the side; required for `unit`, ignored for `subunit` |
| `pins[].unit` | subunit | `Pin.unit` | unit letter (FR-014a); required for `subunit`; list order within a unit = slot order |
| `pins[].dir` | yes | `Pin.direction` | `in`\|`out`\|`bidir`\|`tristate` (FR-062a) |
| `pins[].number` | no | `Pin.number` | physical pin #; footprint/BOM metadata only |
| `groups[].name` | — | `PinGroup.name` | optional section (FR-063) |
| `groups[].pins` | — | `PinGroup.pins` | ordered member names (bit order) |
| `delays` | no | `delays` | `map[string]number`, ns (FR-064) |
| `behavior` | no | `behavior` | literal block scalar; verbatim (FR-066); evaluated by the slow simulator (FR-079). Supports registered `.R` outputs (FR-079), the extended `:+:`/`.CLK`/`.ARST`/`.APRST` (FR-079a), and the transparent-latch `.L`/`.G` suffix pair (FR-079d, e.g. 74573.yaml) |
| `clock` | iff `.R` | `clock` | names the global clock input pin for `.R` registered outputs (FR-062d); must exist with `dir: in`. E.g. `clock: CP` in 74574.yaml. A `.R` output that gives its own `.CLK` (extended, FR-079a) needs no global `clock:`, and a purely-latch part (only `.L` outputs, FR-079d — gated by a level, not a clock edge) omits `clock:` entirely |
| `internal` | no | `internal` | optional list of buried registered-node names (FR-079c), e.g. `internal: [SR0, SR1, SR2, SR3, SR4, SR5, SR6]` for the 74HC165. Each must be a legal name, unique, and distinct from every pin name; each must be defined by exactly one `.R` equation in `behavior` (checked at Run). A buried node is read/written in the behavior block but drives no pin |
| `gal` | no | `gal` | optional GAL device name selecting **strict** dialect (FR-066a): one of `GAL16V8`/`GAL20V8`/`GAL22V10`/`GAL20RA10`. Omit ⇒ **extended** dialect (default; FR-079a). Server validates the name only |
| `partnumber` | iff `gal` | `partnumber` | GAL parts only (FR-066b): non-empty free-form **display name** (FR-005b), e.g. `"PC-DECODE-A"`; not a key and need not be unique (the library key is `id`). Absent on 74-series types |
| `description` | no | `description` | optional one-line function summary (FR-104); presentation-only. For a GAL part it is authored in the New GAL part dialog (FR-066c) since the part has no datasheet of its own |
| `datasheet` | no | `datasheet` | optional mapping `{vendor, title, rev, url}` (FR-104) |
| `pins[].desc` | no | `Pin.desc` | optional pin role text (FR-104) |
| `mem` | no | `mem` | generated memory device only (FR-114f): mapping `{kind: ram\|rom, addressBits, dataWidth, locations, romFile?, ramFile?, ramLoad?}` driving the built-in memory behavior (FR-114d). Carried through verbatim; the client binds the behavior from it on load. `romFile` is the absolute content-file path (ROM only, FR-114e); `ramFile` is the absolute persistent save-file path and `ramLoad` the load-on-start flag (RAM only, FR-114g) |
| `physical` | no | `physical` | exporter-only package metadata (FR-062e); carried verbatim like `mem`; ignored by editor and simulators; presence triggers the completeness validation (§6.3) |
| `physical.pincount` | in block | — | total physical pins; with `pins[].number` + `power` + `nc` must tile exactly 1..pincount, all `pins[]` numbered, no duplicates |
| `physical.package` | no | — | free-form package name (`"DIP-14"`, `"SOIC-16"`); uninterpreted by the server — exporters own the mapping (e.g. to a KiCad footprint id) |
| `physical.power[]` | in block | — | `{name, number}`; `name` is the rail net label (`VCC`, `GND`) for exporters; names may repeat across entries (multi-ground packages) but must not collide with `pins[].name` |
| `physical.nc` | no | — | list of no-connect pin numbers |

Documentation keys (`description`, `datasheet`, `pins[].desc`) are all optional
and presentation-only: the server copies them onto the `ComponentType` for the
properties panel (FR-105) and never lets them affect geometry or simulation. A
documented part looks like:

```yaml
type: "74138"
description: "3-to-8 line decoder/demultiplexer, inverting"
datasheet:
  vendor: Nexperia
  title: "74HC138; 74HCT138 3-to-8 line decoder/demultiplexer"
  rev: "Rev. 10, 26 Feb 2024"
  url: "https://assets.nexperia.com/documents/data-sheet/74HC_HCT138.pdf"
pins:
  - { name: /E1, side: left, pos: 6, dir: in, number: 4, desc: "active-low enable 1" }
  # … other pins
```

A **generated memory device** (FR-114c/FR-114f) is an ordinary `unit` component
plus a `mem:` block; the client emits its full pinout so the server parses it
generically (no memory-specific pinout logic server-side):

```yaml
id: "type-PROGRAM_RAM"
type: "PROGRAM_RAM"            # the device's free-form name is its display name
description: "256×8 RAM (generated)"
mem: { kind: ram, addressBits: 8, dataWidth: 8, locations: 256 }   # ROM: romFile: "<abs>"; RAM persistence: ramFile: "<abs>", ramLoad: true (FR-114g)
outline: [4, 13]
pins:
  - { name: A0, side: left,  pos: 1,  dir: in }
  # … A1…A7, then CE/, OE/, WE/ on the left edge
  - { name: D0, side: right, pos: 1,  dir: bidir }   # dir: tristate for a ROM
  # … D1…D7 on the right edge
groups:
  - { name: ADDR, pins: [A0, A1, A2, A3, A4, A5, A6, A7] }
  - { name: DATA, pins: [D0, D1, D2, D3, D4, D5, D6, D7] }
```

**Why a YAML literal block for `behavior`.** Under `|` every line is literal text
with newlines preserved and **no escaping**, so GALasm operators (`/ * + = ( )`)
pass through untouched — exactly what FR-066's "capture verbatim" needs, and the
lowest-ceremony way to hand-type equations. Two gotchas the author must know:
(1) `#` inside the block is literal text, not a YAML comment — use GALasm's `;`
for comments there; (2) the block's indentation is stripped, so indent the whole
block consistently.

**Behavior dialect — `gal:` (FR-066a).** Omitting `gal:` (the case for every
74-series part, which is not a GAL) selects the **extended** dialect (FR-079a):
the union of the four GAL device languages with capacity limits lifted, plus an
XOR operator — enough to model parts that flat SOP cannot (the 74HC283 adder via
XOR; the dual-clock 74HC74/192/193/595 via per-output `.CLK`). Naming a device
(`gal: GAL22V10`) selects **strict** validation (FR-079b): the simulator accepts
only that device's language and capacity and refuses to run otherwise — the mode
to use when authoring an actual GAL you intend to burn. The value vocabulary is
GALasm's own four device names, so a strict part's `gal:` matches the device line
of the equivalent `.pld`. Strict never changes simulation *results*, only whether
the block is accepted, so a part can be developed in extended mode and later
locked to a device.

**Authoring gotchas (hand- or AI-written).** Quote any all-digit scalar (`type:
"74138"`); single-letter names such as `N`/`Y` stay strings under the 1.2 core
schema (`yaml.v3`) and need no quoting; unknown top-level keys are ignored, not
errors (FR-066), so future sections (e.g., richer timing) are additive.

### 7.7 `.tv` test-vector file (JSON sibling — FR-115a)

A test-vector set is a JSON document saved beside the design (extension `.tv`),
read/written through the same `/api/v1/design/{load,save}` endpoints as a design
(§6.4) — they neither interpret nor extension-check the body. Shape:

```json
{ "formatVersion": 3,
  "inputs":  [ { "refdes": "A-1", "pin": "OUT", "label": "A" },
               { "refdes": "A-2", "pin": "OUT", "label": "B" } ],
  "outputs": [ { "refdes": "A-5", "pin": "IN",  "label": "Sum" },
               { "refdes": "A-6", "pin": "IN",  "label": "Cout" } ],
  "io":      [ { "refdes": "A-9", "pin": "P",   "label": "DBUS" } ],
  "rows": [ { "in": ["0","0"], "io": ["1"], "out": ["L","L"] },   // harness drives DBUS
            { "in": ["1","0"], "io": ["H"], "out": ["H","L"] },   // harness observes DBUS
            { "in": ["1","1"], "io": ["X"], "out": ["L","H"] } ] }
```

- **Columns bind by `refdes`+`pin`**, never by label (FR-115a): relabeling a
  switch/indicator (FR-011b) does not break a file. `label` is a display cache,
  refreshed from the live design on open. An 8-wide indicator (FR-071d) appears as
  eight output columns with pins `D0`…`D7`.
- **Port columns (FR-115f)** are identified by the **port's own** `(refdes, pin)`:
  a 1-wide port as `(refdes, "P")`, a multi-bit portN as N columns `(refdes, "P"i)`.
  This is the natural, stable identity an author writes by hand and that reconciles
  by `(refdes,pin)` like any other column — a port input cell drives its net via
  the simulator's stimulus (FR-115f), a port output reads its net directly
  (FR-094e); no helper components exist in the design.
- **Bidirectional columns (FR-115i)** — a `bidir` port's own `(refdes, "P")` (or a
  portN's N per-bit `(refdes, "P"i)`), carried in the separate `"io"` array. Each
  per-row `io` cell is drive-or-observe: `"0"`/`"1"` **drive** the net (like an
  input, via the stimulus, FR-115f/FR-094e); `"H"`/`"L"` **release and assert**;
  `"X"` (default) releases and asserts nothing. A cell drives iff it is `"0"`/`"1"`.
  Same `(refdes,pin)` reconciliation as any column.
- **Cell symbols:** input cells `"0"`/`"1"` (an input switch only ever drives 0 or
  1, FR-071c); a **clock column** (FR-115e — a clocked design's clock generator,
  identified by the clock's own `(refdes, "OUT")`) additionally allows `"C"` (apply
  one full positive pulse); output cells `"H"` (expect 1), `"L"` (expect 0), `"X"`
  (don't-test). Which input columns are clock columns is re-derived from the design
  on open (`kind:"clock"` is live-only, never stored).
- **Reconciliation on load:** the file's `inputs`/`outputs`/`io` are matched against
  `deriveColumns(design)` (§6.16) by `(refdes,pin)`; a mismatch (a file column the
  design lacks, or a design column the file lacks) is a **warning**, not a load
  failure (FR-115a) — the editor opens with the design's current columns, carrying
  over the file rows that still align.
- **Versioning:** `formatVersion` + a `migrate()` chain mirror the design format
  (§7.4/FR-060c). v1 is the initial, combinational-only version; **v2** marks the
  sequential `C` input symbol (FR-115e) — the shape is unchanged, so the v1→v2
  migration is the identity and every v1 file is a valid v2 file; **v3** (current)
  adds the `io` column array and per-row `io` cell array (FR-115i), the v2→v3
  migration adding an empty `io:[]` to the column set and to each row. Run
  **results** (pass/fail, actuals) are presentational and are **not** stored here
  (FR-115d).

### 7.8 Project manifest (`*-manifest.json` — FR-121a)

A JSON file at the project root:

```jsonc
{
  "formatVersion": 1,          // migration anchor, like the design format (FR-060c)
  "name": "WUT-4 CPU",         // project display name (top-bar indicator, FR-121b)
  "mainDesign": "cpu.json"     // optional: bare filename of the main design at the project root
}
```

- **Recognition is by name pattern, tolerant of the prefix:** any file at the
  project root whose name ends `-manifest.json` (case-insensitive, §6.5a). New
  Project writes `<folder name>-manifest.json`, but renaming the folder outside
  the app never orphans the manifest. Several matches → the first in sorted
  filename order is recognized and the condition is reported (FR-074).
- **Optional:** a project with no manifest is fully functional — its display
  name is the folder's base name and it has no main design. A manifest that
  fails to parse degrades the same way, with a warning (never an error).
- **`mainDesign`:** recorded by the client on the **first design save** into a
  manifest-carrying project whose `mainDesign` is unset (§6.19); a recorded
  main design that no longer exists is cleared in the served info with a
  warning (§6.5a). Open Project opens it immediately when present (FR-121b).
- **Read/write:** the server parses it tolerantly for `/project/info` and
  rewrites it — unknown fields preserved — during Duplicate Project (§6.5a);
  the client's `mainDesign` update is a read-modify-write over the design
  load/save endpoints (the `.tv` precedent, §6.4). All other client access
  goes through `/project/info`.
- **Exclusions:** manifest files are excluded from design listings unless
  `manifests=1` (§6.4), and a design may not be **saved** under a matching
  name (the save validator, §6.19) — so a manifest can never be opened or
  clobbered as a design.
- **Migration:** `formatVersion` is the anchor; v1 is current. Future changes
  migrate forward like §7.4; tolerance to unknown fields means older servers
  simply ignore newer additions.

---

## 8. Key Design Decisions

| Decision | Alternatives Considered | Choice | Rationale |
|---|---|---|---|
| Canvas tech for the drawing surface | SVG/DOM (declarative, easy hit-testing); WebGL (fast, heavy) | **HTML5 Canvas 2D (immediate mode)** | Full control over high-frequency drag/rubber-band/pan/zoom; predictable perf on large designs (NFR-005); avoids DOM-node blowup that SVG suffers; WebGL is overkill for 2D lines/rects |
| UI "chrome" stack | React+Vite; Preact/htm; Lit | **Vanilla ES modules, no build step** | Honors the no-build/plain-JS constraint; the chrome is modest; the complexity that grows (canvas engine) lives outside any framework anyway; a framework can be added later because chrome is decoupled (user-confirmed) |
| Mutation path | Direct model edits from event handlers | **Single Command pipeline through the Store** | Makes undo/redo total and uniform (FR-024, NFR-006); one place to set the dirty flag (FR-049a); testable commands |
| Net representation | Compute nets geometrically (intersections) at read time; store nets only; connection-by-name net labels | **Graph of `Vertex` nodes + union-find over vertex ids; `nets` stored as derived convenience** | FR-059a forbids pixel-geometry-dependent connectivity; id-based union-find is exact and pixel-free; storing nets aids downstream tools (A1/A4); net labels rejected by stakeholder |
| Junction identity | (a) reference a point on a wire by coordinate; (b) junction endpoint stores *target wire id* + render-only coord; (c) split host wire into two records on branch | **First-class `Vertex` objects shared by id; a branched wire keeps one record with the junction as an interior `node` path-point** | Symmetric (no host/branch parent-child); deleting a wire just drops a vertex ref-count (eliminates the G2 special case); shared vertex holds the only position copy so junctions can't drift; preserves "the wire I drew" as one record for select/delete (FR-033a) and aligns with FR-031/033 in-place editing; cleanly absorbs the future off-sheet **connector** tool and edge-connector components as new vertex kinds |
| Bus connectivity (N nets) | Treat a bus as one net; expand bits only in a downstream tool; per-bit explicit net objects | **Bit-lane union-find: a bus = `width` lanes `(busId,i)`; group snap binds bit i, bus↔bus joins lanes by index, breakout taps one lane** | A bus is genuinely *width* signals (FR-037a); lanes make wires, group snaps, bus joins, and breakout all the same union; subsumes the old "one net per bus" bug; provenance (`{bus,bit,name}`) serves downstream tools (FR-060a) |
| Bus group-match tie | First group in file order (silent) | **Auto-connect only on a single match; prompt to disambiguate on ≥2 (FR-041b)** | Silent guessing is wrong for chips with multiple equal-width groups (e.g., ALU A/B/Y); stakeholder confirmed → promoted to requirement; withdraws design-only assumption A3 |
| YAML file format | Bespoke line-oriented grammar; Markdown-with-frontmatter; TOML; **YAML** | **YAML (`gopkg.in/yaml.v3`, 1.2 core schema)** | A well-known format an LLM can emit reliably when transcribing datasheets (a stakeholder goal); free comment/escape/unknown-key handling (FR-066); the `\|` block scalar makes hand-typing GALasm equations ceremony-free. Supersedes the earlier "syntax TBD / strawman" and closes OQ-001 |
| Component outline source | Declared physical `package:` resolved by a parser registry/parametric generator to outline + pin numbers (earlier design) | **Explicit `outline: [w, h]` else a pin-derived default box; no package mechanism at all** | Stakeholder removed packages: power/ground (the only reason the physical package mattered for the symbol) do not exist in file/editor/sim, and outlines are better derived from author-placed pins (FR-014). Eliminates `packages.go`, the package-name grammar, and the `pincount`/generator entirely; physical pin `number`s, if used, are author-stated optional metadata. Supersedes the package-registry decision (was FR-062b). (The later exporter-only `physical:` block, FR-062e, reintroduces package *metadata* — `package` free-form and uninterpreted, `pincount` used only to validate numbering completeness — without reviving this mechanism: nothing about the symbol, editor, or simulation reads it) |
| Subunit package model (FR-013a) | One instance owning a `subunits[]` array of positions; teach wires/netlist/hittest/persistence about sub-identities | **N sibling instances sharing a U-number (refdes `U5A`…), one per unit** | Each gate is independently placeable/movable/rotatable like any instance, so wiring, netlist (`U5A.1Y`), hit-test, and persistence work unchanged; the "package" is just a shared U-number + grouped drop/delete (FR-018b). Symbol geometry lives in one module (§6.8a) consumed by model/renderer/hittest so they cannot drift |
| Coordinate system | Store pixels; store mm | **Store integer grid units; derive pixels via viewport** | Everything snaps to grid by construction (FR-021); zoom/pan are pure view transforms; rotation by 90° preserves grid (§6.7) |
| Rotation pivot | Rotate about component center | **Rotate pin offsets about the instance origin** | Guarantees rotated pins stay on integer grid intersections (FR-021) without half-grid artifacts |
| File I/O location | Browser native file picker / downloads | **All FS access server-side via REST** | FR-053 requires server-assisted navigation; keeps a single trusted FS actor; localhost-only (NFR-001) |
| Server framework | gin/echo/chi | **net/http standard library** | Tiny API surface; no dependency; matches the project's minimalist Go style |
| Slow-simulator timing model | Zero-delay settle (fixpoint per edge); event-driven with the YAML ns delays | **Unit delay: 1 unit = 1 simulated ns, double-buffered synchronous update (FR-078)** | Stakeholder-chosen. Deterministic and evaluation-order-independent; settling ripples one component level per step (observable sequence); the clock `period` (ns) sets steps/cycle with no conversion factor; a design not settled by the next edge is a *visible* timing failure. Trade-off accepted: every component takes 1 ns regardless of internal depth |
| Four-state combination rule | Strict pessimism (any U operand → U; the vision statement's original rule, chosen first) | **Selective pessimism: `0 AND x = 0`, `1 OR x = 1`; other U combinations → U; Z reads as U (FR-077)** | Reworked 2026-06-12 (supersedes the strict-pessimism decision): under strict-U, registered feedback could never be initialized — `0 AND U = U` made even a held synchronous clear/load ineffective (discovered on the 74163), so no sequential part could leave U. Selective pessimism is what real logic permits; genuinely uninitialized paths still surface as U, preserving the debug intent |
| Clock pin for `.R` outputs | Name convention (CP/CLK/CK); infer from equations | **Explicit `clock:` YAML key (FR-062d)** | Unambiguous and parser-validated; makes the 74574's named-clock convention machine-readable; additive per FR-066 |
| Expressing parts beyond flat SOP / one clock (74HC74, 165, 283, 595, …) | (a) integrate a full **Verilog** parser + 4-state event simulator; (b) a bare `galasm: strict` boolean; (c) hand-coded **native-JS** behaviors for the hard parts (the `BEHAVIORS` escape hatch already used by built-ins); (d) compose hard parts as **sub-designs** of primitive built-ins (§6.14 hierarchy) | **Device-named dialect: `gal: <device>` ⇒ strict that device; omit ⇒ extended (union of the four GAL dialects, capacity lifted, plus XOR) — FR-066a/FR-079a/FR-079b** | Verilog is an order of magnitude more code than the whole engine, imports a worldview that clashes with the unit-delay SOP model, and the stakeholder dislikes it — disproportionate for ~5 parts. A boolean can't say "fits *what*", and breaks the moment a second device matters; naming the device makes strict a real "would this burn?" gate and gives *extended* a principled definition (the GAL20RA10's per-output `.CLK` is real GALasm, so independent clock domains aren't invented syntax). Strict is a pure accept/reject gate, never a second evaluator. The native-JS (c) and sub-design (d) paths remain available for behaviors no GAL can express (74HC165 async variable load) — they sit *outside* the `gal:` flag and are out of scope for this change |
| Buried registered internal nodes (74HC165 & kin, FR-079c) | (a) infer a buried node from any `.R` LHS that matches no pin — no new YAML key; (b) a separate per-entity value buffer with a new `readNet` branch and an explicit swap; (c) native-JS behavior (the `BEHAVIORS` escape hatch); (d) compose from primitive built-ins as a sub-design | **Explicit `internal:` node list + realize each node as a driver-less *virtual net* appended to the net array** | Explicit declaration keeps typo-safety (an unknown signal still errors, vs. (a) where a mistyped pin silently becomes a buried node) and is self-documenting. The virtual-net realization reuses `readNet`, `updateRegisters`, `evalOutput`, and `resolveNet` **unchanged** — a buried node is just a net with one driver and no conductor — so it inherits the one-unit-delay, four-state, U-propagation semantics for free and both engines stay in lock-step (FR-107); (b) reimplements that machinery for no gain. (c)/(d) are the heavier escape hatches reserved for behaviors no GAL can express (async variable load); a buried *shift register* is ordinary registered logic that only lacked a way to name hidden state |
| 74HC165 parallel load: sync vs. async | Model load faithfully **async** (needs a new variable-async-load engine primitive); model it **synchronously** (folds into the `.R` D-equation, no engine change); omit load entirely (support only shift) | **Synchronous load, folded into each stage's `.R` D-equation, documented as an approximation** | The real part loads asynchronously, but the engine has no variable-async-load primitive and adding one is out of scope (the standing FR-079a/§8 position, restated across two prior decisions). A sync-load approximation reuses the buried-`.R` mechanism with zero new machinery and matches the real part whenever load is followed by a clock (the normal usage); the gap is stated in the YAML header and FR-079c. Omitting load would make the part far less useful for no saving |
| API versioning | Unversioned routes | **`/api/v1/` prefix** | New endpoints (future transpiler) added without breaking clients (NFR-004) |
| Fast-engine deliverable & runtime split (FR-116/FR-116a) | Single emitted `.c` with the runtime text prepended; server-side compile and/or run; generated-only program with no fixed runtime | **Two-file delivery: a fixed, hand-written, documented `runtime.h`/`runtime.c` pair copied verbatim beside the thin generated `<design>.c`; user compiles with plain `cc`** | Stakeholder-chosen (2026-07-02). A human-readable runtime with a documentable API keeps every subtle semantic (FR-077/FR-081–083/FR-078/FR-115c/e) in one auditable, natively-testable C file; the generator stays small (tables + lowered expressions); no toolchain dependency enters the product — compilation is the user's step |
| Fast-engine batch I/O (FR-117/FR-118) | Teach the C program to parse `.tv` JSON; bake vector rows into the emitted source; VCD as the primary output | **Columns baked at generate time (they derive from the design), rows as plain whitespace text on stdin; stdout transcript + stderr conflicts; VCD as a later `--vcd` flag** | Avoids a JSON parser in C; rows-on-stdin lets vectors change without regenerating; a line-oriented transcript is directly diffable against `runVectors` output — the cheapest FR-107 parity harness (`gen-open.md` sequencing) |
| Bidirectional switch elements — transmission gate & relay (FR-071g/FR-071h/FR-083a) | (a) two back-to-back conditional tri-state drivers (drive B with `curr[A]` when closed, and A with `curr[B]`); (b) variant of (a) with "resolve the net excluding my own contribution" to cancel the reflection; (c) **dynamic net merging** — a closed contact makes its terminal nets one net: per-step union-find over net indices, one `resolveNet` per merged group; (d) support in both engines at once | **Dynamic net merging (c), slow engine only for now — `kind:"pass"` entities + per-root resolution in `sim.js`; Generate C refuses (FR-116)** | (a) is subtly wrong: once both sides carry a value the switch's own reflection sustains it — release the external driver and the net latches its old value forever, an unintended charge-storage artifact; (b) cures that only by contorting the contribution model. Merging matches what a four-state no-analog simulator can honestly claim: strength survives a closed contact (weak pull stays weak, FR-083), the existing conflict machinery works across it (FR-082), chains merge transitively, and `valueOfPin`/display need no change. Charge storage on an isolated node is declared an explicit non-goal (weak keepers cover retention); a U control conservatively forces the terminal groups U. Slow-only is a clean incremental line (stakeholder-chosen 2026-07-07): vectors run on the slow engine so they work day one, and fast support can be added later without reworking FR-083a because both engines share the net-resolution semantics (FR-107) |
| Sub-design embedding & off-sheet connectors (FR-094–FR-103) | (a) embed a copy of the child like FR-057; (b) two separate primitives (a port object and a distinct connector object); (c) compute multi-sheet/hierarchical nets in the editor at edit time | **One `port` built-in (a new `connector` vertex kind) serving both roles; a sub-design instance is a live relative-path reference whose interface is resolved to a synthetic in-memory `ComponentType`; flatten + cross-file label-union composed only at Run** | The synthetic type lets the whole pin/vertex/wire/netlist/render pipeline serve hierarchy unchanged — only render style, navigation, and flatten are new; a live reference keeps one source of truth (no stale copy, supersedes FR-057 here); the junction-identity decision already reserved a single `connector` vertex kind for this; composing cross-file nets only at Run keeps single-sheet editing fast and local (NFR-005); render style is deliberately cosmetic so simulation semantics never depend on a symbol toggle (stakeholder-confirmed) |
| Project identity (FR-121/FR-121a) | A required project file (KiCad-style — breaks every existing design folder); an app-side project registry/config; keep the implicit "the design's directory" conventions (the reverted FR-120 approach) | **A project *is* a directory; an optional, pattern-recognized `*-manifest.json` adds display name + main design** | Five features had already converged on the design's directory as an anonymous grouping (FR-098, FR-101, FR-115a, FR-116, reverted FR-120); naming it dissolves the reverted complexity (scope-follows-file plumbing, save-first refusals, Save As copy semantics). No required marker → zero migration for existing folders; pattern recognition rather than a fixed filename survives folder renames (KiCad-conventions review, `divergences.md`) |
| Where "current project" lives (FR-121) | Server-side open-project session state; inferring the project from each design path per request | **Client-only store value; every project-aware request carries the directory as a parameter** | Preserves the server's total statelessness, which the resilience story depends on (§6.12a: reconnection needs no session transfer); the client already owns `savePath`/`designName` the same way |
| Duplicate Project mechanism (FR-121f) | Client-orchestrated copy (list + per-file load/save round trips, client-side manifest rewrite); server-side copy with rollback on failure | **One `POST /project/duplicate` doing a recursive server-side copy + manifest rename; no rollback — partial destination left and reported** | One round trip and byte-verbatim fidelity (no client staging or JSON re-encode of design files); the manifest rename needs server-side tolerant JSON handling anyway (§6.5a); rollback machinery is disproportionate for a localhost tool — the report-and-manual-cleanup rule is FR-121f's stated behavior |
| Data-path storage form (FR-121g) | Always absolute (status quo — breaks Duplicate self-containment); always relative (breaks FR-121d's anywhere-on-disk exemption) | **Absolute in memory; relative on disk iff inside the project** | Exactly the proven `childPath` boundary conversion (FR-098) — one pattern, two field families; consumers (sim run-time, cgen bake) never see a relative path; Duplicate's shared-data warning scan falls out for free — any absolute mem path in a saved design is by construction outside its project |
| Project-boundary enforcement point (FR-121d/FR-121e) | Server-side path validation on save/load/embed | **Client-side checks (embed dialog refusal, save-dialog validator); server unchanged** | The server deliberately does not sandbox paths (§4.2: trusted single-user local FS); the boundary is a project-hygiene UX rule, not a security control — and server enforcement would break the legacy outside-project references FR-121d explicitly requires to keep loading |
| Magic UART: built-in vs. metatype (FR-122) | Server-persisted generated metatype with a New-UART dialog (the memory path, FR-114); a fixed built-in in `BUILTIN_DEFS` | **Fixed built-in** | The device is byte-fixed with no configurable parameters, so the FR-114 machinery (dialog, `mem`-block YAML, Go server parsing) buys nothing (YAGNI). A built-in needs no server change, no dialog, no library file — much less surface. A future width-configurable variant would migrate toward the FR-114 generator |
| Magic UART: behavior location (FR-122b) | Inline in `sim.js`; a source-only `BEHAVIORS` function (like clock/reset) | **Dedicated net-free `uart.js` core** | The behavior reads input nets and keeps state — the exact criterion that made `memory.js` a separate, unit-testable core rather than a `BEHAVIORS` entry. Mirrors a proven pattern and gives the fast engine one semantic reference |
| Magic UART: uncertain (U/Z) CS//CE/ at edge (FR-122b) | Emit pessimistically (as memory drives U on the bus, FR-114d); emit a placeholder byte; **do not emit** | **Emit only when CS/ and CE/ are exactly 0** | A character is an irreversible side effect; a phantom byte corrupts the console stream unrecoverably. Requiring certainty keeps output deterministic and both engines trivially in agreement — a deliberate divergence from memory's recoverable-bus pessimism. Undefined data bits mask to 0 (U→0, FR-114g), since ASCII has no U encoding |
| Magic UART: debug-sim "stdout" (FR-122c) | Reuse the message tray; a modal log window; **a docked Console panel** | **Docked, modeless Console panel (View ▸ Console)** | The browser has no OS stdout; a persistent scrollable monospace panel matches "console" semantics and reuses the docked-panel idiom (FR-115b), while staying modeless (no design lock) because it is output-only. Buffered append + rAF repaint delivers "asynchronous, heavily buffered, no overrun" without backpressure into the engine |
| Magic UART: fast-C output channel (FR-122d) | A separate file/fd; stderr; **real stdout, fully buffered** | **stdout (`setvbuf _IOFBF`)** | The prompt specifies "standard output"; full stdio buffering is the "heavily buffered" requirement. Interleaving with the trailing free-run dump/vector transcript is acceptable (dump trails all UART output) and handled by the parity harness's ordering |

---

## 9. File and Directory Plan

```
srv/                        Go module (module path retains the historical name
                            github.com/gmofishsauce/retrosim/sim/srv)
  cmd/retrosim/main.go      entry point: flags, bind 127.0.0.1, wire deps (§6.1)
  cmd/dumplib/main.go       dump parsed library as JSON for offline tooling (refresh-types)
  server/api.go             /api/v1 router + handlers + static (§6.4)
  server/components.go      library load/hold/List (§6.2)
  server/yamlparse.go       ParseComponent: YAML → ComponentType (§6.3, §7.6)
  server/storage.go         ListDir/LoadDesign/SaveDesign (§6.5)
  server/project.go         manifest discovery/parse, project create/duplicate (§6.5a, FR-121)
  server/paths.go           DesignsDir per-OS documents folder (§6.5, FR-050)
  server/types.go           ComponentType/Pin/PinGroup/Design/Vertex/Wire/Bus/PathPoint Go structs (§7)
  components/*.yaml         the component library (74138.yaml, 74165.yaml, …; §7.6)
web/
  index.html                SPA shell + <canvas> + module entry
  css/style.css             layout for toolbar/palette/canvas/dialogs/vector panel
  js/app.js                 bootstrap + palette rendering (§6.11/§6.12; there is no palette.js)
  js/api.js                 REST client (§6.12)
  js/store.js               store + undo/redo + locks (§6.10)
  js/commands.js            Command constructors (§6.10)
  js/builtins.js            client-side built-in object registry (§6.11)
  js/connection.js          server heartbeat + reconnect (§6.12a)
  js/backup.js              localStorage snapshot + recovery (§6.12a)
  js/geometry.js            grid/viewport/rotation math (§6.7)
  js/model/design.js        design ops (§6.6)
  js/model/clipboard.js     copy/paste fragment extract + instantiate (§6.15)
  js/model/netlist.js       buildNets union-find (§6.6)
  js/model/persist.js       serialize/deserialize + formatVersion migration (§7.4)
  js/model/subdesign.js     interface resolution, synthetic type, flatten/cycle (§6.14)
  js/engine/canvas.js       renderer + render loop (§6.8)
  js/engine/symbols.js      schematic symbol geometry (§6.8a)
  js/engine/interaction.js  tool FSM + event handling (§6.9)
  js/engine/hittest.js      hit-testing (§6.9)
  js/engine/router.js       Manhattan route proposal (§6.9a)
  js/engine/galasm.js       GALasm behavior compiler/evaluator (§6.13)
  js/engine/sim.js          slow simulator engine + scheduler (§6.13)
  js/engine/memory.js       RAM/ROM behavior core (§6.13, FR-114d)
  js/engine/uart.js         magic-UART behavior core (§6.20, FR-122b)  [CREATE]
  js/engine/vectors.js      test-vector runner + .tv file model (§6.16)
  js/engine/cgen.js         fast-engine C code generator (§6.17)
  js/engine/ndl.js          NDL netlist exporter (§6.18)
  js/chrome/toolbar.js      menu/tool bar (§6.11)
  js/chrome/dialogs.js      dialogs + test-vector panel (§6.11, §6.16)
  js/chrome/fileops.js      save/open/navigation flows (§6.11, §6.14, §6.19)
  js/chrome/project.js      project lifecycle ops + manifest helpers (§6.19, FR-121)
  js/chrome/properties.js   per-instance properties panel (§6.11)
  js/chrome/contextmenu.js  right-click menu (§6.11)
  js/chrome/statusbar.js    bottom status bar trays (§6.11)
  js/chrome/console.js      docked debug-sim Console panel (§6.20, FR-122c)  [CREATE]
  cgen/runtime.h            fast-engine C runtime API, documented (§6.17)
  cgen/runtime.c            fast-engine C runtime implementation (§6.17)
  tools/tv2txt.js           .tv → generated-program stdin rows (§6.17 M2)
  tools/parity.js           fast-vs-slow FR-107 parity harness (§6.17 M2)
  tools/refresh-types.js    batch FR-088 refresh for saved designs (uses cmd/dumplib)
examples/                   parity corpus: design + .tv pairs (§6.17)
specs/                      requirements.md, design.md (this document), CHANGELOG.md
```

Unit tests sit beside their modules (`*.test.js` / `*_test.go`) and run via
`./runtests.sh` (repo root). (Updated 2026-07-08 to the actual tree; supersedes
the original greenfield plan, whose `sim/` root and never-created
`js/chrome/palette.js` no longer described the repository.)

---

## 10. Requirement Traceability

| Requirement | Design Section | Files |
|---|---|---|
| FR-001 | §6.1, §6.4, §5 | `main.go`, `api.go` |
| FR-002 | §6.2 | `components.go`, `yamlparse.go` |
| FR-003 | §6.4, §6.11, §6.12 | `api.go`, `app.js` |
| FR-004 | §6.12 | `app.js`, `store.js` |
| FR-004a, FR-004b | §6.11 | `toolbar.js`, `interaction.js`, `index.html`, `style.css` |
| FR-005, FR-005a, FR-005b, FR-006 | §6.2, §6.11 | `components.go`, `app.js` |
| FR-006a | §6.11 | `app.js`, `style.css`, `builtins.js` |
| FR-007 | §6.2 | `components.go` |
| FR-008, FR-009, FR-010 | §6.9, §6.11 | `interaction.js`, `app.js`, `store.js` |
| FR-011 | §6.6 | `model/design.js` |
| FR-011a | §6.6 | `model/design.js` |
| FR-067–FR-071 | §6.6, §6.8, §6.11 | `builtins.js`, `model/design.js`, `canvas.js`, `app.js` |
| FR-012, FR-015, FR-020 | §6.7, §6.8 | `geometry.js`, `canvas.js` |
| FR-013, FR-014 | §6.8, §7.1 | `canvas.js`, `types.go` |
| FR-013a, FR-013b, FR-014a | §6.6, §6.8, §6.8a, §7.1 | `symbols.js`, `canvas.js`, `model/design.js` |
| FR-013c | §6.8, §6.8a, §6.10 | `canvas.js`, `symbols.js`, `store.js`, `interaction.js` |
| FR-016, FR-017 | §6.9 | `interaction.js`, `hittest.js` |
| FR-018 | §6.6, §6.9 | `model/design.js`, `interaction.js` |
| FR-018a | §6.6, §6.9, §6.10 | `model/design.js`, `store.js` |
| FR-018b | §6.6, §6.11 | `model/design.js`, `dialogs.js`, `contextmenu.js` |
| FR-019, FR-020 | §6.7, §6.9, §6.10 | `geometry.js`, `interaction.js`, `store.js` |
| FR-020a | §6.11, §7.2 | `properties.js`, `store.js` |
| FR-020b | §6.11, §7.1, §7.2 | `properties.js`, `builtins.js`, `model/design.js`, `commands.js` |
| FR-067a, FR-071a, FR-071b | §6.11, §6.13, §7.1 | `builtins.js`, `sim.js`, `canvas.js` |
| FR-071c, FR-087a | §6.8, §6.9, §6.11, §6.13, §7.2 | `builtins.js`, `canvas.js`, `interaction.js`, `sim.js`, `model/design.js` |
| FR-071d, FR-071e | §6.8, §6.11 | `builtins.js`, `canvas.js`, `model/design.js` |
| FR-020c | §6.12, §7.2 | `properties.js`, `model/design.js`, `commands.js` |
| FR-021 | §6.7, §6.8 | `geometry.js`, `canvas.js` |
| FR-022, FR-023 | §6.8, §6.11 | `canvas.js`, `toolbar.js` |
| FR-024 | §6.10 | `store.js` |
| FR-025, FR-026 | §6.9, §6.11 | `interaction.js`, `toolbar.js` |
| FR-027, FR-027a, FR-027b, FR-027c, FR-028 | §6.9, §6.9a, §6.10 | `interaction.js`, `router.js`, `store.js` |
| FR-029, FR-030 | §6.6 | `model/design.js` |
| FR-031, FR-032, FR-033, FR-033a | §6.9, §6.10, §6.11 | `interaction.js`, `store.js`, `contextmenu.js` |
| FR-034, FR-034a, FR-034b | §6.6, §6.9 | `model/netlist.js`, `interaction.js` |
| FR-035, FR-036, FR-037 | §6.8, §6.11 | `canvas.js`, `toolbar.js` |
| FR-037a | §6.6, §7.2, A7 | `model/netlist.js`, `types.go` |
| FR-037b | §6.9, §6.11, §7.2 | `interaction.js`, `contextmenu.js`, `model/design.js` |
| FR-038 | §6.9, §6.11 | `interaction.js`, `contextmenu.js` |
| FR-039, FR-040 | §6.9 | `interaction.js` |
| FR-039a | §6.9 | `interaction.js`, `hittest.js` |
| FR-041, FR-041a, FR-041b, FR-041c | §6.9, §6.11, A3 | `interaction.js`, `dialogs.js`, `model/design.js` |
| FR-042, FR-042a, FR-042b, FR-042c, FR-043 | §6.8, §6.9, §7.2 | `interaction.js`, `canvas.js`, `model/design.js` |
| FR-043a, FR-043b | §6.6, §6.9, §7.1a | `interaction.js`, `model/design.js`, `commands.js`, `model/netlist.js` |
| FR-044, FR-045 | §6.10, §6.12, §6.19 | `store.js`, `app.js`, `fileops.js`, `toolbar.js` |
| FR-046, FR-047, FR-047a, FR-048, FR-049 | §6.5, §6.10, §6.11, §6.19 | `storage.go`, `dialogs.js`, `fileops.js`, `store.js` |
| FR-049a | §6.10, §6.11 | `store.js`, `dialogs.js` |
| FR-050, FR-051 | §6.5, §6.11, §6.19 | `paths.go`, `storage.go`, `dialogs.js`, `chrome/project.js` |
| FR-052, FR-053, FR-054 | §6.4, §6.5, §6.11, §6.19 | `api.go`, `storage.go`, `project.go`, `dialogs.js`, `fileops.js` |
| FR-055, FR-056 | §7.2 | `types.go`, `model/design.js` |
| FR-057, FR-058 | §7.2 | `types.go`, `model/design.js`, `properties.js` |
| FR-059, FR-059a, FR-060 | §6.6, §7.2 | `model/netlist.js`, `types.go` |
| FR-060a | §6.6, §7.2, A7 | `model/netlist.js`, `types.go` |
| FR-061…FR-064 | §6.3, §7.1, §7.6 | `yamlparse.go`, `types.go` |
| FR-062b | §6.3, §7.1, §7.6 | `yamlparse.go`, `types.go` |
| FR-062c | §6.3, §6.8a, §7.1, §7.6 | `yamlparse.go`, `types.go`, `symbols.js` |
| FR-065 | §6.4 | `api.go` |
| FR-066 | §6.3, §7.1 | `yamlparse.go` |
| FR-114, FR-114a | §6.11 | `dialogs.js`, `app.js`, `interaction.js` |
| FR-114c | §6.11 | `builtins.js` (`memDeviceType`), `app.js` |
| FR-114d | §6.11, §6.13 | `engine/memory.js`, `sim.js` |
| FR-114e | §6.4, §6.13, §6.19 (path form) | `engine/memory.js`, `sim.js`, `api.js`, `storage.go`, `api.go`, `dialogs.js`, `model/persist.js` |
| FR-114f, FR-007a | §6.4, §6.11, §7.6 | `dialogs.js` (`memDeviceYaml`), `app.js`, `api.js`, `components.go`, `yamlparse.go`, `types.go` |
| FR-114g | §6.4, §6.11, §6.13, §6.17, §6.19 (path form) | `engine/memory.js` (`dumpBytes`), `sim.js` (load/stop-write), `dialogs.js`, `app.js`, `api.js`, `storage.go`, `api.go`, `engine/cgen.js` (bake), `web/cgen/runtime.c` (load/write, FR-117c), `model/persist.js` |
| FR-115, FR-115a–h | §6.13, §6.16, §7.7 | `engine/vectors.js`, `engine/sim.js`, `chrome/dialogs.js`, `chrome/toolbar.js`, `chrome/properties.js`, `store.js`, `app.js`, `index.html`, `style.css` |
| FR-106–FR-110, FR-116, FR-116a, FR-117, FR-117a, FR-117b, FR-117c, FR-118 | §6.17 | `engine/cgen.js`, `web/cgen/runtime.h`, `web/cgen/runtime.c`, `chrome/toolbar.js`, `app.js` |
| FR-072, FR-073, FR-074 | §6.11 | `statusbar.js`, `index.html`, `style.css` |
| FR-089, FR-090, FR-091 | §6.4, §6.11, §6.12a | `api.go`, `connection.js`, `statusbar.js`, `api.js` |
| FR-092, FR-093 | §6.12, §6.12a | `backup.js`, `app.js`, `model/persist.js` |
| FR-062d | §6.3, §6.13, §7.1, §7.6 | `yamlparse.go`, `types.go`, `sim.js` |
| FR-062e | §6.3, §7.1, §7.6 | `yamlparse.go`, `types.go`, `srv/components/*.yaml` |
| FR-119, FR-119a | §6.18 | `engine/ndl.js`, `chrome/dialogs.js`, `chrome/toolbar.js`, `app.js`, `docs/netlist-language.md` |
| FR-075, FR-078, FR-079, FR-080 | §6.13 | `sim.js`, `galasm.js` |
| FR-079c | §6.3, §6.13, §6.17, §7.1, §7.6 | `types.go`, `yamlparse.go`, `galasm.js`, `sim.js`, `cgen.js`, `srv/components/74165.yaml`, `examples/74165-*` |
| FR-076, FR-087 | §6.9, §6.10, §6.11, §6.13 | `toolbar.js`, `store.js`, `interaction.js`, `sim.js`, `statusbar.js` |
| FR-077, FR-081, FR-082, FR-083 | §6.8, §6.13 | `sim.js`, `galasm.js`, `canvas.js` |
| FR-084, FR-085, FR-086 | §6.13 | `sim.js`, `builtins.js` |
| FR-076a, FR-076b | §6.10, §6.11, §6.13, §7.2 | `toolbar.js`, `dialogs.js`, `statusbar.js`, `sim.js`, `store.js`, `model/design.js` |
| FR-071g, FR-071h, FR-083a | §6.11, §6.13, §6.17 (refusal), §6.18 (comment lines), §8 | `builtins.js`, `canvas.js`, `sim.js`, `cgen.js`, `ndl.js` |
| FR-087b | §6.9, §6.10, §6.11, §6.13 | `interaction.js`, `store.js`, `builtins.js`, `sim.js` |
| FR-088 | §6.6, §6.10, §6.11 | `model/design.js`, `commands.js`, `toolbar.js` |
| FR-094, FR-094a, FR-095 | §6.14, §7.1a, §7.2 | `subdesign.js`, `builtins.js`, `model/design.js`, `model/netlist.js` |
| FR-096 | §6.14, §7.2 | `model/design.js`, `dialogs.js` |
| FR-097, FR-097a, FR-097b | §6.9, §6.11, §6.14, §6.19 (boundary) | `interaction.js`, `dialogs.js`, `subdesign.js`, `fileops.js` |
| FR-098, FR-098a, FR-099, FR-099a, FR-099b | §6.6, §6.8, §6.14, §7.2 | `subdesign.js`, `model/design.js`, `canvas.js` |
| FR-100, FR-100a | §6.9, §6.11, §6.12, §6.14 | `interaction.js`, `app.js`, `dialogs.js` |
| FR-101, FR-101a, FR-101b | §6.6, §6.9, §6.11, §6.14 | `subdesign.js`, `model/netlist.js`, `properties.js`, `interaction.js`, `fileops.js`, `contextmenu.js` |
| FR-102, FR-102a, FR-103 | §6.13, §6.14 | `sim.js`, `subdesign.js` |
| FR-060b | §6.14, §7.1a, §7.2 | `types.go`, `model/design.js` |
| FR-060c | §7.2, §7.4 | `model/persist.js`, `chrome/fileops.js` |
| FR-104 | §6.3, §7.1, §7.6 | `yamlparse.go`, `types.go`, `srv/components/*.yaml` |
| FR-105 | §6.11, §7.1 | `properties.js`, `style.css` |
| FR-111, FR-112, FR-113 | §6.15, §6.9, §6.10, §6.11 | `clipboard.js`, `interaction.js`, `commands.js`, `canvas.js`, `toolbar.js` |
| FR-004c | §6.9, §6.11 | `interaction.js` |
| FR-011b | §6.6, §6.10, §6.11, §7.2 | `model/design.js`, `commands.js`, `properties.js` |
| FR-012a | §6.8 | `canvas.js` |
| FR-013d | §6.8, §6.9 | `canvas.js`, `hittest.js`, `model/design.js` |
| FR-015a | §6.8 | `canvas.js` |
| FR-016a, FR-016b | §6.8, §6.9, §6.10 | `interaction.js`, `hittest.js`, `store.js`, `canvas.js` |
| FR-018c | §6.6, §6.9, §6.10 | `model/design.js`, `interaction.js`, `commands.js` |
| FR-020d | §6.11 | `properties.js` |
| FR-022a | §6.9, §6.11, §6.14 | `interaction.js`, `toolbar.js`, `fileops.js` |
| FR-023a, FR-023b | §6.9 | `interaction.js` |
| FR-027d, FR-027e | §6.9, §6.9a | `router.js`, `interaction.js` |
| FR-032a | §6.6, §6.9 | `model/design.js`, `interaction.js` |
| FR-033b, FR-033c, FR-033d | §6.6, §6.7, §6.9, §6.11 | `contextmenu.js`, `geometry.js`, `interaction.js`, `model/design.js` |
| FR-034c | §6.6, §6.9 | `model/design.js`, `interaction.js` |
| FR-049b, FR-052a | §6.11 | `dialogs.js` |
| FR-063a | §6.3, §6.14 | `yamlparse.go`, `dialogs.js` |
| FR-066a, FR-079a, FR-079b | §6.3, §6.13, §7.6 | `yamlparse.go`, `galasm.js`, `sim.js` |
| FR-066b, FR-066c, FR-066d | §6.4, §6.14 | `dialogs.js`, `app.js`, `api.go`, `yamlparse.go` |
| FR-066e | §6.2, §6.3, §7.1, §7.4 | `yamlparse.go`, `components.go`, `model/persist.js`, `builtins.js` |
| FR-071f | §6.8, §6.9, §6.11, §7.2 | `builtins.js`, `canvas.js`, `interaction.js`, `model/design.js` |
| FR-094b, FR-094c, FR-094d, FR-094e | §6.6, §6.11, §6.14 | `subdesign.js`, `model/netlist.js`, `canvas.js`, `properties.js` |
| FR-099c | §6.9a, §6.14 | `subdesign.js`, `router.js`, `fileops.js` |
| FR-121, FR-121a, FR-121b, FR-121c, FR-121d, FR-121e, FR-121f, FR-121g, FR-121h | §6.19, §6.4, §6.5a, §6.10, §6.11, §6.12, §6.14, §7.8, §8, §3.1 A8–A11 | `project.go`, `api.go`, `storage.go`, `chrome/project.js`, `chrome/fileops.js`, `chrome/dialogs.js`, `chrome/toolbar.js`, `store.js`, `app.js`, `api.js`, `model/persist.js`, `index.html`, `style.css` |
| FR-122, FR-122a, FR-122b | §6.20 | `builtins.js`, `engine/uart.js`, `engine/sim.js`, `engine/canvas.js`, `engine/symbols.js` |
| FR-122c | §6.20 | `chrome/console.js`, `chrome/toolbar.js`, `store.js`, `app.js`, `index.html`, `style.css` |
| FR-122d | §6.20 | `engine/cgen.js`, `cgen/runtime.h`, `cgen/runtime.c`, `tools/parity.js` |
| NFR-001 | §6.1 | `main.go` |
| NFR-002 | §6.12 | `api.js` |
| NFR-003 | all | server `*.go`, `web/js/*` |
| NFR-004 | §6.4, §7.4 | `api.go`, `types.go` |
| NFR-005 | §6.8, §6.9 | `canvas.js`, `interaction.js` |
| NFR-006 | §6.10 | `store.js` |
| IR-001 | §6.4, §6.12 | `api.go`, `api.js` |
| IR-002 | — | (none; no external integrations) |

All current requirements are covered (table backfilled 2026-07-08; superseded
FRs — e.g. FR-115g — carry no row, and the file column names modules, with unit
tests beside them per §9).

---

## 11. Testing Strategy

### 11.1 Unit tests
- **Go `yamlparse` (YAML, §7.6):** valid file → correct `ComponentType`; missing
  `type` / bad `side` / bad `dir` / non-integer `pos` / group
  referencing unknown pin → error with file (+YAML line); behavioral block
  captured verbatim into `Behavior`; unknown top-level keys ignored (FR-061–
  FR-066). YAML-specific: `type: "74138"` round-trips as the string `"74138"`; a
  pin or bit name `N`/`Y` stays a string (1.2 core schema), not a boolean; a `#`
  inside the `behavior:` block is preserved as literal text.
- **Go `yamlparse` outline (FR-062b):** explicit `outline: [6, 12]` → `width`/
  `height` = 6/12; omitted `outline` → outline derived from pin positions (> 0);
  optional `number:` is preserved but never affects geometry. (No package
  mechanism exists; there is nothing to resolve or disambiguate.)
- **Go `yamlparse` documentation (FR-104):** `description`, `datasheet`
  (vendor/title/rev/url), and `pins[].desc` round-trip onto the `ComponentType`;
  a file with none of them parses fine with the documentation fields left
  zero/nil.
- **Go `storage`:** atomic save does not corrupt an existing file when the write
  fails midway; `ListDir` returns dirs plus files filtered by the `exts`
  parameter (default `.json`; e.g. `bin,hex` for the ROM picker, FR-114e;
  `-` lists directories only, §6.5) with
  a correct `parent`;
  load of malformed JSON → 422 (FR-046–FR-053, FR-055).
- **Go `project` (§6.5a, FR-121a/FR-121b/FR-121f):** `IsManifestName` —
  suffix match, case-insensitive, any prefix, non-matches (`manifest.json`
  alone, `.json` designs); `FindManifest` — none/one/several (sorted-first
  recognized, rest as extras); `ProjectInfo` — manifest `name`/`mainDesign`
  extracted, folder-base fallback (no/unparseable manifest, with a warning),
  dangling `mainDesign` cleared with a warning; `CreateProject` — directory +
  `<base>-manifest.json` written, existing path → `ErrProjectExists` (409),
  missing parent → error; `DuplicateProject` — files (incl. subdirectories)
  copied byte-verbatim, recognized manifest renamed with `name` rewritten and
  unknown fields preserved, extra manifests copied verbatim, missing `src` →
  404, existing `dst` → 409, mid-copy failure leaves the partial destination.
  `handleFiles` (§6.4): `*-manifest.json` excluded from `.json` listings by
  default, included under `manifests=1`.
- **Go `paths`:** `DesignsDir` returns the documents-folder path per `GOOS`
  (FR-050): darwin/linux `~/Documents/retrosim`, windows
  `%USERPROFILE%\Documents\retrosim`, unset `USERPROFILE` → error.
- **JS `geometry`:** rotation table maps integer offsets to integer offsets for
  all four angles; round-trip world↔screen; snap-to-grid (FR-021, FR-020).
- **JS `netlist.buildNets`:** see edge cases below (FR-034b/FR-059a/FR-037a). A
  width-8 bus snapped to an 8-pin group yields **8** nets, one per bit, with
  correct `provenance` (FR-037a/FR-060a); a breakout wire joins exactly its bit's
  net (FR-043a); two equal-width buses joined at a no-`bit` junction align lanes by
  index (FR-039a).
- **JS `store`:** every command's `apply`∘`revert` restores prior state; undo
  stack honors `UNDO_CAP ≥ 50` (NFR-006); redo cleared on new dispatch;
  `markSaved(path, name)` records the path, adopts the saved file's base name
  into `design.name`/`designName` (FR-047a), and clears `dirty`;
  `dispatch`/`undo`/`redo` refused with a report while `project` is `null`
  (the no-project lock, FR-121c) and permitted again after `setProject`.
- **JS `project` (§6.19):** `isManifestName` mirrors the Go rule (same case
  table); `resolveProjectPick` maps folder / manifest / design picks to
  `{dir, designPath}`; `absoluteDataPaths` finds absolute `mem.romFile`/
  `ramFile` values, ignores relative ones and non-mem components. Lifecycle
  ops with stubbed api/fileops (the `connection.js` injection pattern):
  `openProject` cancel → no state change (§3.1 A9); a manifest naming a main
  design loads it directly; `duplicateProject` posts one warning per shared
  absolute data path and reports a copy failure as partial-left.
- **JS `persist` data paths (FR-121g):** `relativizeDataPaths` — an in-project
  absolute `romFile`/`ramFile` becomes design-dir-relative, an outside-project
  path stays absolute, and the **live objects are untouched** (copy-on-write);
  `absolutizeDataPaths` — relative → absolute against the design dir;
  round-trip identity both ways; a legacy absolute in-project path comes back
  relative after one save cycle.
- **JS `refreshInstance`/`RefreshTypes` (FR-088):** refresh replaces `typeData`
  (new behavior/delays/properties reach the instance) while preserving refdes,
  position, rotation, and overrides; an override key absent from the new
  definition is dropped; a connected pin missing from the new definition (or
  moved to a different unit) skips the instance with a reason; renderType
  change skips; subunit siblings get per-unit filtered copies; undo restores
  every prior `{typeData, overrides}` exactly; unknown type names are left
  untouched.
- **JS `backup` (FR-092/FR-093):** with an injected fake storage — dirty
  dispatch → debounced snapshot written with design/savePath/name/time; save
  (dirty cleared) → key removed; `offerRecovery` round-trips
  serialize/deserialize (components, wires, vertices, overrides intact);
  decline discards the key; storage that throws disables the writer without
  breaking dispatch.
- **JS `connection` (FR-089–FR-091):** with a stubbed `ping` — flips
  disconnected after a failed beat and posts the do-not-reload instructions
  once; flips connected on recovery; invokes the injected `save` only when
  dirty; overlapping heartbeats are not issued.
- **JS `router.proposeRoute` (FR-027c):** open field → straight or single-L
  route with ≤ 1 corner; obstacle between endpoints → route detours around it,
  never crossing a component outline; output-to-input of the same component →
  route loops around the body; pin escape — first/last step follows the
  endpoint's `escape` direction for all four rotations; collinear interior
  points merged (returned interior points are corners only); boxed-in endpoint
  → `null` (fallback); turn penalty prefers a longer 2-corner route over a
  shorter many-corner one.
- **JS `galasm` (FR-079):** physical-level polarity — for YAML pin `/E1` the
  literal `/E1` is true when the pin reads LOW and `E1` when it reads HIGH;
  `/Y0 = term` drives Y0 LOW when the term is true (the 74138 equations
  reproduce the datasheet function table). Selective pessimism (FR-077):
  `U AND 0 = 0`, `U OR 1 = 1`, `U AND 1 = U`, `U OR 0 = U` — and a registered
  part with U feedback is rescued by a held clear/load (the 74163 clears to
  0000 with /CLR low even from all-U registers). `.T` with `.E` false → Z,
  `.E` of U → U. `.R` presents the register,
  not the sum; `lhsLow` flips the presented value. `AR`/`SP` reset/set; `VCC`/
  `GND` constants. Validation errors: two output equations for one signal; `.E`
  before its output / multi-term / on a plain output; unknown signal; `.R`
  without `clock:` is a `sim.js` preflight error.
- **JS `sim` (FR-078, FR-081–FR-086):** net-resolution truth table — agreeing
  strong drivers, 0-vs-1 conflict → U + flagged conductor, any-U → U, all-Z →
  Z, weak pull-up/pull-down resolve Z and lose to strong, pull-up + pull-down
  alone → conflict. Unit-delay ripple: an N-inverter chain settles in exactly N
  steps (one level per step, FR-078). Registers latch only on 0→1 of the
  declared clock net and the output changes one unit later. Combinational
  design: settles then idles (no auto-terminate) and re-settles on an
  interactive input (`applyLive` → `wake()`, FR-085/FR-087b); a ring oscillator
  hits the 10,000-unit per-episode bound, reports once, and idles (FR-085). Clock waveform: low first half-period, rising
  edge at period/2 (FR-084). Power-on reset (FR-071b): R=1//R=0 for
  `cycles × clockPeriod` units then the inverse; `clockPeriod` = the single
  clock instance's effective period, else 100 (no clock, or several); the
  default 3 cycles spans the first three rising edges. Dispatch refused while
  `simulating` (FR-087);
  `state.sim` retained at stop, cleared on next dispatch (FR-085).
- **JS `sim` switch elements (FR-071g/FR-071h/FR-083a):** transmission gate —
  closed (EN=1): a strong driver on A is read at B (and vice versa; terminals
  symmetric); open (EN=0): the undriven side resolves Z, and releasing the
  driver on a previously-closed gate leaves **both** sides Z next step (no
  charge-storage latch — the regression the back-to-back-driver model fails).
  Chain of two closed gates joins three nets transitively; opening the middle
  one splits them. A weak pull-up seen through a closed contact still loses to
  a strong 0 on the far side and still decides the group when all strong
  drivers are Z (strength preserved across merge, FR-083). Strong 0 vs strong 1
  across a closed switch → conflict: group value U, **every** member conductor
  flagged red, two drivers named (FR-082). EN=U forces the terminal groups U
  (both sides, regardless of drivers); EN read is one unit delayed (a control
  change joins/splits on the *next* step, FR-078). Relay: COIL=0 joins COM–NC
  (NO isolated), COIL=1 joins COM–NO (NC isolated), COIL=U forces all three
  terminals' groups U; SPST usage (a throw unwired) works. A switch whose
  control depends on a net it merges (merge-feedback oscillator) hits the
  10,000-unit bound and reports once (FR-085). A design with no switch
  elements resolves per net exactly as before (identity union-find /
  skipped pass machinery). Vector run over a switch circuit passes/fails
  per FR-115c unchanged; `deriveColumns` yields no columns for switch
  elements (FR-115b).
- **JS `cgen` (§6.17, FR-116a/FR-117):** `generateC` structure tests under
  `node:test` — emitted text contains the expected net table, column tables,
  labels, and lowered expressions for small designs; refusal cases (sub-design
  instance, off-sheet connector, behavior parse error, `.R` without `clock:`,
  and — FR-116/FR-083a — a design containing a transmission gate or relay,
  whose refusal message names the offending refdes and says "not supported by
  the fast simulator").
  The C **runtime** is natively testable standalone (ops/resolver truth tables
  mirroring the JS `sim` cases above). The **parity harness** (M2) generates,
  compiles (`cc`), and runs corpus design+`.tv` pairs, diffing the stdout
  transcript against `runVectors` (§6.16) — the FR-107 check; it is run
  explicitly, not as part of the compiler-free unit-test sweep (location TBD,
  §12).
- **JS `uart` core (§6.20, FR-122b):** `uart.test.js` under `node:test` —
  rising-edge latch with CS/=0/CE/=0 emits the byte once; **no** emit on held
  clock, falling edge, CS/=1, CE/=1, or CS//CE/=U/Z; bit order D0=LSB…D7=MSB on a
  mixed pattern; data-bit U/Z→0 masking; power-up `prevClk=U` so a first step
  reading CLK=1 is not an edge; one emit per qualified edge. **`console.js`
  (FR-122c):** `renderByte` truth cases (printable verbatim, LF/TAB, CR ignored,
  control/high bytes → `\xNN`); buffered writes coalesce into one repaint; history
  cap head-trims with the truncation marker; sticky-tail (at-bottom scrolls,
  scrolled-up does not); `clear` empties. **`sim.js` integration:** a design with
  a UART fed by switches/registers under a clock delivers the expected byte
  sequence to the `onConsole` sink in order (incl. CS//CE/ gating and a
  deterministic two-UART interleave by entity order).
- **UART parity leg (§6.20, FR-122d/FR-107):** modeled on the RAM-persist leg —
  for `examples/uart-demo.json` run both engines free for the shared cycle count
  and compare emitted output. The slow side captures bytes via an `onConsole`
  collector; the fast side runs `--cycles N` and reads stdout. Because the
  free-run observable dump trails all UART bytes on the fast side, the harness
  compares against a slow-side expected stdout built as the UART byte stream
  followed by the same `LABEL=v` dump the generic free-run leg synthesizes. UART
  designs route to this leg and are excluded from the generic free-run leg (as
  ram-persist designs are), so the two never double-count.

### 11.2 Integration / end-to-end (Chrome + Firefox, manual or Playwright)
- Startup blocks canvas until palette loads (FR-003); empty design named
  `unnamed schematic <datetime>` in select mode (FR-004).
- Hover a palette tile for a documented part (74138): tooltip reads
  `"74138: 3-to-8 line decoder/demultiplexer, inverting"` (FR-005a); a part with
  no description falls back to the plain full-name tooltip (FR-005).
- Place via drag and via click-then-click; both return to select (FR-008–FR-010);
  refdes increments past gaps after deletions (FR-011).
- Rotate; verify all labels stay upright and pins stay on grid (FR-012/020).
- Draw wire, add/drag/delete bend, branch in wire mode (FR-027–FR-034).
- Move a component; connected segments stretch (FR-018).
- Bus: thick blue, `/n` annotation, right-click width, snap to a matching pin
  group, leave unconnected when no group matches (FR-035–FR-043).
- Bus disambiguation: snap a 16-bit bus to an ALU with three 16-bit groups (A/B/Y)
  → dialog lists all three by name; pick `B` → connects to B; cancel → unconnected
  (FR-041b). Snap a 4-bit bus to the same ALU → flags group auto-connects, no
  dialog (FR-041a), and the bus adopts names C/V/N/Z (FR-037b).
- Breakout: rip one bit off a bus into a single wire to a pin; verify only that
  bit's net includes the pin (FR-043a). Attempt to join a 16-bit bus to a 4-bit
  bus → rejected at drop with a toast (FR-039a).
- Save (first-time prompt, prefilled name) → overwrite silently → Save As → Open
  via navigation; round-trip equality of the model, including `bitNames`,
  breakout taps, and `nets` provenance (FR-044–FR-060a).
- Project-first startup (FR-121c): before any project the canvas is inert
  (place/wire/undo refused with a tray message), Save/New/Run and the Simulate
  items disabled, only New Project / Open Project / Open live; New Project
  creates the folder + `<name>-manifest.json` and enables editing; the top bar
  shows the project's display name (FR-121b), falling back to the folder name
  for a manifest-less folder (FR-121a).
- Open Project by folder, by manifest file, and by design file all land in the
  same project (FR-121b); a manifest carrying `mainDesign` opens that design
  immediately (with the FR-022a auto-fit); cancelling the no-main-design picker
  changes nothing (§3.1 A9); plain File ▸ Open switches the current project to
  the opened design's folder.
- Save confinement (FR-121a/FR-121e): Save As navigated outside the project is
  rejected with the dialog open; a design named `x-manifest.json` is refused;
  the first save into a manifest-carrying project records `mainDesign`, and a
  second save does not overwrite it.
- Embed boundary (FR-121d): the ADD dialog refuses a child outside the project;
  a legacy design with an outside-project child still loads, renders, and
  simulates, with one tray report.
- Duplicate Project (FR-121f/FR-121g): full copy with the manifest renamed and
  its `name` rewritten; the duplicate becomes current; an outside-project RAM
  save file is warned as shared with the original; an in-project ROM content
  path saves project-relative, and the duplicate's copy loads its **own** ROM
  file at Run (self-containment).
- Select a documented part (74138): properties panel shows the description, a
  datasheet link that opens the PDF in a new tab, and a "Pin roles" disclosure
  listing each pin's role; select a built-in with no docs → no documentation
  block appears (FR-104, FR-105). Docs survive save/open and a "Refresh Types"
  (FR-057, FR-088).

### 11.3 Edge / boundary cases
- Delete a component → connected wires keep one dangling end (FR-029); wires with
  both ends now free are removed (FR-030); junctions on a deleted wire become free
  (G2).
- Fan-out: one pin with three wires forms one net (FR-034a/b).
- Junction chain A→B→C: all three wires + their pins are one net, computed from
  ids only — moving any vertex does not change the net (FR-059a).
- Bus accepted by a pin group holding a free contiguous block ≥ the bus width,
  claimed pack-low (FR-041/FR-041c); ≥2 accepting groups → disambiguation
  dialog, not a silent pick (FR-041b).
- Bus-to-bus chain bit alignment: bit 3 at one end equals bit 3 at the other; a
  breakout off bit 3 anywhere along the chain lands in that same net (FR-037a/043a).
- Undo across a delete-that-pruned-wires restores every pruned wire and junction.
- Zoom at min/max bounds (0.25×/4.0×); pan far from origin keeps grid crisp.

### 11.4 Verifying NFR-005 (U1)
Generate a stress design (e.g., 200 components, 600 wire segments) and confirm
interactive frames render in **≤16 ms** during drag/pan/zoom on the reference
machine. (Confirm the target numbers in §12 if different.)

---

## 12. Open Questions

Every item below is **resolved**; the entries are retained as decision records
and nothing here currently gates any work. (Intro re-scoped 2026-07-08; it
formerly gated implementation slices that have long since shipped.)

- **OQ-001 / G1 — YAML file syntax — RESOLVED.** Settled with the stakeholder: the
  YAML file is **YAML** (§7.6, binding; §6.3 parser). The package mechanism is
  **removed entirely** — no `package`/`pincount`, no package-name grammar, no
  parametric generator (`packages.go` deleted). Outlines come from an explicit
  `outline: [w, h]` or a pin-derived default; physical pin `number`s are
  author-stated optional metadata. `yamlparse.go` may now be implemented against
  §7.6. (FR-062e later added an exporter-only `physical:` block that carries
  `package`/`pincount` as uninterpreted metadata — it does not revive the
  removed mechanism; nothing geometric or behavioral reads it.)
- **A3 — Pin-group "width" semantics & tie-break — RESOLVED.** Group width =
  number of member pins (each pin is one bit); on a tie the user is **prompted**
  (no silent pick). This was
  confirmed with the stakeholder and **promoted to requirements** (FR-041/041a/
  041b); it is no longer an open question. (Extended 2026-06-20 by FR-041c:
  "accepts" replaced the equal-width "matches" — pack-low free-block claiming.)
  Bus snap, breakout, and bus bit-names (FR-037b/043a) are all implemented (A7)
  and the save format accommodates them (FR-060a).
- **OQ-007 / A1 — Junction representation.** Resolved to a **graph of first-class
  `Vertex` objects shared by id** (§7.1a), chosen with the stakeholder in light of
  the planned off-sheet **connector tool** (and possible edge-connector
  components), which are future `Vertex` kinds the model absorbs uniformly. A
  branched wire keeps one record (`path[]` with an interior junction node).
  Confirm this satisfies the downstream-tool netlist needs before a later phase
  consumes it. *(Note: the connector tool implies a future multi-**sheet**
  container, which this single-canvas phase does not provide; that is orthogonal
  to the topology model and tracked as future scope.)*
- **OQ-004 / A5 — Grid spacing & default zoom — RESOLVED (2026-07-08,
  confirmed by use).** Defaults chosen (8 px/unit at zoom 1, range 0.25×–4.0×)
  have served through weeks of real editing; they stand, remaining tunable
  constants in one place (A5).
- **U1 — NFR-005 threshold & target design size — RESOLVED (2026-07-08,
  confirmed by use).** The ≤16 ms / 200-component / 600-segment budget stands
  as stated in §11.4; real designs to date show no responsiveness issues.
- **OQ-003 — File navigation vs recent-files — RESOLVED (2026-07-08).**
  Server-assisted navigation shipped and now underpins every picker (designs,
  ROM contents, `.tv` files — FR-052/FR-052a/FR-053); the recent-files fallback
  (FR-054) was never needed and remains only a designed contingency.
- **OQ-008 — Pin-direction set — RESOLVED.** Final set is `{in,out,bidir,
  tristate}`. Power and ground are not represented anywhere (file, editor, or
  simulation), so no `pwr`/`power` direction is needed; the four directions map
  cleanly to the future four-level model.
- **DQ-001 — Text selection inside a note while editing (FR-071f) — RESOLVED.**
  *(Renamed 2026-07-08 from "OQ-011": that ID collided with requirements.md's
  unrelated OQ-011 — the fast-engine output-mechanism question, resolved per
  FR-118. `DQ-` numbers are design-local questions that never appeared in
  requirements.md.)* Adopted the **DOM `<textarea>` overlay**: editing a note hides the canvas note
  and overlays a real textarea over it (§6.9), so caret placement, text selection,
  and clipboard are the browser's native behavior. This supersedes the original
  keystroke-capture / cosmetic-caret approach (no caret index, no selection). The
  remaining simplification is **rotation**: the overlay is drawn **unrotated**
  regardless of the note's rotation (no CSS transform to align it with a rotated
  note), and the overlay font only **approximates** the canvas metrics. Aligning
  the overlay with a rotated note is intentionally deferred and not currently
  planned. (Raised 2026-06-22; resolved 2026-06-22.)

- **Fast-engine parity-harness location (§6.17 M2) — RESOLVED (2026-07-03).**
  The FR-107 parity harness shells out to a C compiler, so it must not sit where
  the ordinary compiler-free `node:test` sweep would pick it up. It lives at
  **`web/tools/parity.js`** alongside `tv2txt`, run explicitly (`node
  web/tools/parity.js`), never in the `web/js/` sweep.

(The former closing note — gating the YAML parser body and the bus-snap slice
on their confirmations — is superseded 2026-07-08: everything above shipped.)
