# Design: TTL Circuit Design Editor (Visual Editor + Local Server)

> Audience: a developer implementing this phase with no access to the
> requirements interview or to the architect. This document is self-contained.
> It restates the requirements, so `requirements.md` is not required reading
> (though it remains the authoritative source if a conflict is found).
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

The simulation engine and the GALasm→C transpiler from the vision statement are
**out of scope** for this phase. This phase produces a *visual editor* whose
saved files capture enough structure (geometry **and** electrical connectivity)
for those later tools to consume.

---

## 2. Requirements Summary

The analyst's IDs are preserved exactly (`FR-###`, `NFR-###`, `IR-###`,
`OQ-###`). Grouping follows the analyst's grouping.

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
- **FR-005** — One fixed-size palette tile per loaded component type, labeled with
  the type name minus its leading `74` (e.g., `138`, `00`); full name in tooltip.
- **FR-005a**: the tile tooltip also carries the type's one-line `description`
  (FR-104) when present, as `"<name>: <description>"`; a type with no description
  keeps the plain full-name tooltip.
- **FR-006** — Palette is a fixed-width grid of equal tiles (3/row), packed
  left→right, top→bottom in ascending part-number order (supersedes flat list).
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
  bubble showing wire state — gray `?` (undriven), white `1`, black `0`. Not
  independently stateful; displays `?` until the simulator exists. Same bubble for
  palette icon and placed object.
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
  single grid-snapped pivot: each selected component's origin and each interior
  bend/junction vertex (FR-018c) maps `q → P + R(q − P)`, and each component's
  `rotation` is bumped by the delta — so pins, bends, and junctions all turn
  together and the sub-circuit keeps its shape. Pivot `P`: a single component's
  own origin (unchanged in-place rotation); otherwise the grid-snapped center of
  the selected components' combined bounding box. One reversible
  `rotateSelectionCmd` captures the prior origins/rotations and interior
  positions for undo. Supersedes per-component "about its own center", which
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
- **FR-039a** — Joining two buses of **unequal width** is prevented at connect time.
- **FR-040** — After placing a bus, return to select mode.

**Bus-to-Component Snap Connection**
- **FR-041** — Dragging a bus endpoint onto a component determines which declared
  pin groups **match the bus width** (match = member pin count == width).
- **FR-041a** — Exactly **one** matching group → snap-connect automatically.
- **FR-041b** — **More than one** matching group → prompt the user to choose by
  name (may cancel). Supersedes the old "first declared on tie" guess.
- **FR-042** — On connect (auto or chosen), connect each bit to the corresponding
  group pin in declared bit order (no per-pin wiring).
- **FR-043** — **No** matching group → leave the endpoint **unconnected**.
  (Supersedes the earlier nearest-pin-attach rule.)
- **FR-043a** — The user can **break out** a single bit from a bus and route it as
  an ordinary single-bit wire; the wire joins that bus bit's net (FR-037a).

**File Operations — New**
- **FR-044** — Create a new empty design at any time.
- **FR-045** — A new design is named `unnamed schematic <datetime>`.

**File Operations — Save**
- **FR-046** — Save the current design.
- **FR-047** — On first save, prompt to confirm/change the filename (prefilled
  with the default name).
- **FR-047a** — A save under a different file name renames the design to the
  file's base name: shown in the toolbar, written inside the file, and
  pre-filled by future prompts.
- **FR-048** — Subsequent saves overwrite without prompting.
- **FR-049** — Save As at any time, to a new name.
- **FR-049a** — Indicate unsaved changes; warn before discarding them (New/Open).
- **FR-049b** — A save prompt (FR-047/FR-049) that targets an existing file
  confirms the overwrite before writing and aborts if declined. Implemented in
  the save-mode file dialog (`openFileDialog`, dialogs.js): on OK it confirms
  when the chosen name matches a file in the current directory listing. The
  FR-048 same-file re-save skips the dialog, so it is unaffected.
- **FR-050** — Server stores designs in `retrosim` inside the user's
  documents directory by default (created if absent). (Reworked 2026-06-12;
  supersedes the platform-standard application data directory.)
- **FR-051** — The file dialog lets the user choose a different save location.

**File Operations — Open**
- **FR-052** — Open an existing design via a file-navigation dialog.
- **FR-053** — Server provides an endpoint to list directory contents so the
  browser can render a navigation dialog (no native file picker).
- **FR-054** — If server-assisted navigation proves impractical, fall back to a
  list of recently opened designs.

**Design Save Format**
- **FR-055** — Designs saved as JSON.
- **FR-056** — JSON contains at minimum three collections: (a) component
  instances, (b) wire routes, (c) bus routes.
- **FR-057** — Each instance record includes: type name, refdes, canvas position,
  rotation, and a **full copy** of the type's YAML data at save time.
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
  later without changing the editor or breaking the parser. This phase **ignores**
  any behavioral content present (but preserves it on round-trip — see §7).

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
  → leave unconnected (FR-043). See §6.9/§6.11.

- **A4 — Net storage vs derivation (FR-059a).** "Derivable" does not say whether
  to *store* nets. **Resolution:** the save file **includes** a `nets` array
  computed at save time as a convenience for downstream tools, but it is
  **regenerated on every save** and treated as derived/non-authoritative; the
  wires/buses/instances remain the source of truth.

- **A5 — Grid spacing & default zoom (OQ-004).** **Resolution:** one grid unit =
  a "~2 mm" cell; `PX_PER_UNIT_DEFAULT` is **8 device pixels per grid unit** at
  zoom 1, and the initial viewport opens at **zoom 1.6** (≈12.8 px/grid-unit) so
  pins are easy to click and labels stay legible; zoom range **0.25×–4.0×**.
  These are constants (`GRID_MM`, `PX_PER_UNIT_DEFAULT`, `ZOOM_MIN`, `ZOOM_MAX`,
  default viewport zoom) in one place so they are trivially tunable.

- **A6 — Bus-tool one-shot (OQ-005).** Assumed **yes**: the Bus tool returns to
  select mode after placing one bus, mirroring the Wire tool (FR-040 confirms).

- **A7 — Buses as N nets + breakout (FR-037a/b, FR-039a, FR-043a, FR-060a).** A bus
  is *width* independent signals, not one net. **Resolution:** the netlist treats
  each conductor as a **bit-lane** — a wire is 1 lane, a width-*w* bus is lanes
  `(busId, 0…w-1)` — and runs ordinary union-find over lanes (§6.6). A full
  bus↔bus junction unions lanes pairwise by index (equal width enforced at connect
  time, FR-039a); a **breakout** is a wire whose endpoint is a junction vertex on a
  bus carrying a **bit index**, unioning that one lane (FR-043a). Buses may carry
  per-bit names adopted from the snapped group (FR-037b); the saved `nets` carry
  per-bit **provenance** `{bus,bit,name?}` (FR-060a).

### 3.2 Contradictions

- **C1 — None material.** NFR-002 ("no external network requests") vs IR-001
  ("HTTP over localhost") is only apparent: "external" means the public internet;
  localhost API traffic is intended and allowed. Stated for the record.

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
  A junction vertex referenced by **exactly one** remaining wire is **demoted to a
  `free` vertex** (becoming dangling, per FR-029); one referenced by **zero**
  remaining wires is **deleted**. The FR-030 sweep (a wire/bus all of whose
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
- Out of scope: copy/paste, the simulation engine, the transpiler,
  and **electrical-rule checking** (e.g., output-to-output conflicts, direction
  validation). Pin `direction` is captured (FR-062a) so ERC can be added later
  without a model change; the bus disambiguation dialog (FR-041b) does **not**
  filter candidates by direction this phase (D2).
- Target browsers: modern desktop **Chrome/Firefox**. No mobile support.

### 4.2 Assumptions
- The repository is already a Go module (`github.com/gmofishsauce/retrosim/sim/srv`); the
  server lives under `sim/srv` as new packages. (Greenfield: no existing sim code.)
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
│   ├─ GET  /components   ─▶ components.go  ─▶ yamlparse.go  (load library at startup)      │
│   ├─ GET  /files        ─▶ storage.go (list directory; ext filter, FR-114e)               │
│   ├─ GET  /romfile      ─▶ storage.go (read ROM .bin/.hex bytes, FR-114e)                  │
│   ├─ GET  /design/load  ─▶ storage.go (read JSON)                                          │
│   ├─ POST /design/save  ─▶ storage.go (write JSON)                                         │
│   └─ GET  /defaults     ─▶ paths.go    (platform app-data dir)                             │
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

### 5.3 New vs modified vs unchanged
Everything is **new** (greenfield). No existing code is modified. Conventions
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

### 6.1 Go: `main` (package `main`, `sim/cmd/retrosim/main.go`)
- **Purpose:** entry point; parse flags, build dependencies, bind localhost.
- **Satisfies:** FR-001, NFR-001, NFR-003.
- **Interface (CLI flags):**
  - `--addr` (default `127.0.0.1:8137`) — **must** be a loopback host; reject any
    non-loopback host at startup with a fatal error.
  - `--components-dir` (default: `./components`) — YAML library directory.
  - `--data-dir` (default: platform app-data dir from `paths.go`) — designs root.
  - `--web-dir` (default: `./web`) — static SPA assets.
- **Behavior:** load library (§6.2) → if zero components, log a warning but
  continue → construct `http.Server` with the router (§6.4) → `ListenAndServe`.
- **Error handling:** invalid/non-loopback `--addr` → exit non-zero with message.
  Missing `--components-dir` → warn, serve an empty palette. Port in use → exit
  non-zero. YAML parse errors → see §6.3 (server still starts).
- **Dependencies:** `components.go`, `api.go`, `paths.go`, std `net/http`, `flag`.

### 6.2 Go: component library loader (`sim/server/components.go`)
- **Purpose:** load and hold the parsed component library; expose it as JSON.
- **Satisfies:** FR-002, FR-005, FR-007, FR-065.
- **Types:** see §7.1 (`ComponentType`, `Pin`, `PinGroup`).
- **Interface:**
  - `LoadLibrary(dir string) (*Library, error)` — read every `*.yaml` in `dir`
    (non-recursive), parse each (§6.3), collect into a `Library` keyed by type
    `id` (FR-066e). Loaded **once** (FR-007).
  - `(*Library) List() []ComponentType` — stable, deterministic order (sorted by
    `id`) for the palette.
- **Behavior:** for each file, call `ParseComponent`. Duplicate `id`s →
  last-wins with a logged warning. The library is immutable after load.
- **Error handling:** a single file's parse error does **not** abort startup; the
  bad file is skipped and logged (file + line + reason). `LoadLibrary` returns an
  error only on an unreadable directory.
- **Dependencies:** `yamlparse.go`.

### 6.3 Go: YAML parser (`sim/server/yamlparse.go`)
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

### 6.4 Go: HTTP API (`sim/server/api.go`)
- **Purpose:** route and handle all REST endpoints; serve static SPA.
- **Satisfies:** FR-001, FR-003, FR-046–FR-053, FR-065, FR-089 (server side),
  NFR-004, IR-001.
- **Versioning (NFR-004):** all API routes are under `/api/v1/`. New capabilities
  (e.g., a future transpiler) get new paths or a new version prefix; existing
  routes never change shape.
- **Endpoints:**

  | Method & Path | Request | Success Response | Errors |
  |---|---|---|---|
  | `GET /api/v1/components` | – | `{"components":[ComponentType,…]}` | 500 on internal error |
  | `POST /api/v1/components` | `{"yaml":"<authored YAML>"}` | `{"component":ComponentType}` | 400 bad body / invalid YAML, 409 duplicate part number, 500 write failure |
  | `GET /api/v1/defaults` | – | `{"dataDir":"<abs path>"}` | – |
  | `GET /api/v1/files?path=<p>&exts=<e>` | query `path` (abs; empty = data dir), optional `exts` (csv, default `json`) | `{"path","parent","entries":[{"name","isDir"}]}` | 400 bad path, 404 missing, 403 not a dir |
  | `GET /api/v1/romfile?path=<p>` | query `path` (abs, `.bin`/`.hex`) | raw bytes (`application/octet-stream`), capped at `MaxRomBytes` 64 MiB | 400 bad/!bin·hex, 404 missing, 500 too large |
  | `GET /api/v1/design/load?path=<p>` | query `path` | `{"design":Design}` | 400, 404, 422 malformed JSON |
  | `POST /api/v1/design/save` | `{"path":"<abs>","design":Design}` | `{"path":"<abs>"}` | 400 bad body, 409/500 write failure |
  | `POST /api/v1/file/save` | `{"path":"<abs>","content":"<text>"}` | `{"path":"<abs>"}` | 400 bad body/path, 500 write failure |
  | `GET /api/v1/ping` | – | `{"ok":true}` | – (FR-089 heartbeat; no side effects) |

  Directory entries: subdirectories plus the files whose extension is in `exts`
  (default `.json`; the ROM picker passes `bin,hex`, FR-114e); the response
  includes `parent` so the dialog can offer "up".

  `POST /api/v1/file/save` writes **verbatim text** — the same absolute-path
  validation and `atomicWrite` as a design save, but no JSON interpretation or
  re-indenting. Added for the C generator's delivery (FR-116: `<design>.c` +
  `runtime.c`/`runtime.h`), which `/design/save` cannot carry: that endpoint
  requires a valid-JSON body (it `json.Indent`s it), fine for `.json`/`.tv` but
  a discovered flaw in §6.17's original "ride the design-save endpoint" plan
  (corrected 2026-07-02).
- **Behavior:** decode JSON, delegate to `storage.go`/`components.go`, encode
  JSON. All responses `Content-Type: application/json`. `POST /api/v1/components`
  (FR-007a) parses the submitted YAML through the same `yamlparse.go` path as a
  startup load, requires an authored marker — a non-empty `partnumber` (a GAL part,
  FR-066b) **or** a `mem` block (a memory device, FR-114f) — and an immutable
  library-unique `id` (FR-066e), writes `<id>.yaml` into the library dir (filename
  sanitized from the `id`; reject on `id` collision **or** an existing file of that
  name → 409, never overwriting), appends the parsed `ComponentType` to
  the in-memory library, and returns it so the client can add the tile live. Static handler serves
  `web/` for any non-`/api/` path; unknown SPA routes fall back to `index.html`.
  Static responses carry `Cache-Control: no-store` so a plain browser reload
  always picks up edited SPA assets (localhost-only authoring tool served from the
  source tree — no hard-refresh / DevTools cache toggle needed).
- **Error handling:** consistent error envelope `{"error":"<message>"}` with the
  HTTP status above. No stack traces leak to the client; full detail is logged
  server-side.
- **Dependencies:** `storage.go`, `components.go`, `paths.go`.

### 6.5 Go: storage & paths (`sim/server/storage.go`, `sim/server/paths.go`)
- **Purpose:** filesystem I/O for designs; resolve the default designs dir.
- **Satisfies:** FR-050, FR-051, FR-052, FR-053, FR-055, OQ-006 (resolved).
- **Interface:**
  - `ListDir(path string) (DirListing, error)` — entries + parent (FR-053).
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
    `refdes` `U<n>` where `n = 1 + max(existing numeric suffixes)` (FR-011); the
    numeric-suffix scan ignores any trailing unit letter so `U5A` counts as 5.
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
    `node` referencing the new vertex), `breakoutBit` (FR-043a: create a
    `junction` vertex on a bus with `bit` set to the chosen lane, and start a
    single-bit wire from it), `danglingEndAt` (FR-034c: find a free, non-snapped
    endpoint vertex within tol of a point that is the end of exactly one conductor,
    returning it with its conductor and width so the tool can target it),
    `joinFreeEnd` (FR-034c: splice the two distinct same-type/equal-width
    conductors meeting at a free vertex into one, the shared point becoming a bend,
    pruning it if collinear per FR-033c; called by `addWire`/`addBus` commands for a
    `vertex` endpoint), `deleteWire` (decrements junction-vertex ref counts,
    demoting to `free`/deleting per §3.3 G2; prunes all-`free` wires per FR-030),
    `deleteSegment` (FR-033d: cut a conductor at one path edge into two parts,
    promoting a cut `bend` to a `free`-vertex endpoint and keeping a cut `node` as
    is; drop a <2-point part; the two parts inherit width/bitNames and each
    `groupConnection` follows the part keeping its vertex; then `cleanup`),
    `deleteInstance` (converts the instance's `pin` vertices to `free`, then runs
    the FR-030 sweep; for a subunit instance it expands to **all** siblings
    sharing the package U-number — FR-018b — as one operation, the confirmation
    dialog being a chrome-layer concern §6.11), `setBusWidth`, `setBusBitNames`,
    `snapBusGroup`, `setOverride`.
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

  # 3. bus↔bus full junction (no bit index): align lanes by index
  for each junction vertex V shared by buses B1,B2 with V.bit == null:
      # FR-039a guarantees equal widths at edit time, but a loaded file may
      # violate it (e.g. hand-edited): warn — never silently minimize — and
      # union the overlapping lanes. (Supersedes the bare assert.)
      if width(B1) != width(B2): warn(width mismatch at V)
      for i in 0..min(w1,w2)-1:                 union(lane(B1,i), lane(B2,i))

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
  | SELECT | drag selected component | `MoveComponent` for each selected component (snap, stretch connected segs FR-018) + `TranslateWiring` for the interior wiring of the moving set (FR-018c), as one `composite` | SELECT |
  | SELECT | press Delete on selection | `DeleteComponent`/`DeleteWire`/`DeleteBus`/`DeleteSegment` per selected ref kind (FR-018a/FR-033a/FR-033d/FR-016a) | SELECT |
  | SELECT | press `r` on selection | one `RotateSelection` turning every selected component **and** the interior bends/junctions rigidly about a single grid-snapped pivot (FR-019/FR-016a) | SELECT |
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
  out. (The pin hot region, FR-013d, stays a world-unit 0.7-radius circle: its
  size is tied to the 1-grid-unit pin pitch, not the cursor.) `junction`/`free`
  vertices are points. Pins take priority over
  segments take priority over component bodies when overlapping.
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
  the caret, text selection, and clipboard natively (OQ-011). A SELECT-mode
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
  the editing overlay is deliberately out of scope (OQ-011); the committed note
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
  already carries another wire. The cost function charges 1
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
- **Satisfies:** FR-024, FR-049a, NFR-006.
- **State:** `{ design, tool, selection, hover, viewport, dirty, savePath, designName,
  simulating, sim }`.
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
  offset — the interior wiring of a group move, FR-018c). A
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
- **Dirty/unsaved (FR-049a):** `dirty` set on every dispatch, cleared on
  successful save. New/Open guard on `dirty` (confirm dialog); a `beforeunload`
  handler warns on tab close. *(MVP-deferrable per requirements; implement the
  flag now, wire the warnings when convenient.)*
- **Dependencies:** model.

### 6.11 JS: chrome widgets (`web/js/chrome/*.js`)
- **Menu/tool bar (`toolbar.js`)** — Satisfies FR-004a, FR-004b, FR-026, FR-035, FR-022, FR-022a,
  FR-023, FR-024, FR-044, FR-046, FR-049, FR-052, FR-076, FR-087, FR-088. A
  single horizontal bar with pull-down menus on the left and always-visible
  buttons on the right (FR-004a). **Menus:** **File** — New, Open, Save, Save As,
  Refresh Types; **Edit** — Undo, Redo, Copy, Paste (FR-111/FR-112, §6.15);
  **View** — Zoom In, Zoom Out, Fit to Screen (FR-022a, `interaction.fitToScreen`). **Buttons:**
  Select, Wire, Bus (modal tools), then **Run/Stop**. (Pan has no control; it is
  space-drag/middle-drag or right-click-to-recenter on bare canvas —
  FR-023a/FR-023b; left-drag on bare canvas is rubber-band select, FR-016b.)
  A menu opens on click, closes on item choice / outside click / Escape, and is
  built so future commands (Edit Copy/Paste, etc.) drop in as additional items.
  The Wire button shows the wire-cursor icon (the lower-right→upper-left
  diagonal line, inline SVG) instead of a text label (FR-025), keeping a
  `Wire tool` tooltip/aria-label. The active tool is highlighted; clicking a
  tool sets `store.tool`. The Run button calls the sim engine's `run()` and
  relabels to "Stop" (FR-076); while `simulating`, the design-modifying commands
  (Wire, Bus buttons; Undo, Redo, New, Open, Refresh Types items) are disabled —
  Save, the zoom items, Select, and Run/Stop stay enabled (FR-087). The **Refresh
  Types** item (FR-088, tooltip "Re-copy type data from the loaded library into
  placed components") dispatches `RefreshTypes` with the library the app loaded
  at startup. (Reworked 2026-06-21; supersedes the former flat toolbar — a row of
  text/icon buttons — whose File ops and Undo/Redo/zoom moved into menus while the
  modal tools and Run stayed as buttons. The filename is retained for now.)
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
    Screen (FR-022a) get no key and no hint.
- **Palette (`palette.js`)** — Satisfies FR-003, FR-005, FR-006, FR-008, FR-009,
  FR-009a. Renders one fixed-size tile per `ComponentType` in a 3-column CSS grid,
  sorted ascending by the numeric abbreviated part number (`Number(name.slice(2))`).
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
  **text note** (`"note"`, a `NOTE`-labeled tile, **no `pins`**, FR-071f). The
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
  registry (FR-067a) mapping type **id** → behavior function — one stub per
  built-in until the simulator design defines the call interface; functions stay
  out of the type objects so `typeData` copies remain pure JSON (§7.1).
  `drawComponent` has a render branch per built-in renderType: the
  indicator bubble (gray `?` until the simulator, then white `1`/black `0`), the
  pull-up two-headed arrow, the pull-down upside-down `T`, the clock and
  reset boxes, and the switch (the same value bubble as the indicator — white
  `1`/black `0` from `inst.switchState` — plus a small arrow off the bubble
  toward the output pin marking it a source, FR-071c). The two 8-wide built-ins
  add branches: `drawIndicator8` draws the LED bar-graph (eight horizontal
  stripes, each filled by its bit's value via `sim.valueOfPin(refdes,"D"+i)` with
  the same white/black/gray mapping as the 1-wide indicator, FR-071d), and
  `drawPortN` draws N narrow off-sheet pentagons, one centered on each bit
  pin's row (FR-071e). The shared
  pin loop draws the connection bubbles down the left edge for both. Pin
  name labels are suppressed for built-ins (the glyph owns the body); the refdes is
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
- **Dialogs (`dialogs.js`)** — Satisfies FR-046–FR-049, FR-052–FR-054. Modal DOM
  dialogs:
  - *Save* — on first save (no `savePath`) prompt with name prefilled to the
    design name (FR-047); the dialog uses `/api/v1/files` to navigate directories
    and choose a location (FR-051); subsequent saves skip the prompt (FR-048).
    The design adopts the chosen file's base name (FR-047a): fileops overrides
    `name` in the serialized payload (so the file matches) and
    `store.markSaved(path, name)` updates `design.name` and the displayed
    `designName` after the write succeeds.
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
    bus (`only.kind === "wire" | "bus"`) the panel instead renders a read-only sheet
    describing the conductor's two endpoints — its `path`'s first and last `node`
    entries. A shared `describeEndpoint(design, vertexId)` resolves each endpoint
    vertex to text, recomputed on every render so a renamed designator (FR-011b) is
    reflected: a `pin`/`connector` vertex → "`<label> <pin>`" (label via the
    instance's `label ?? refdes`); a `junction` carrying a `bit` (a bus-breakout
    tap, FR-043a) → "`<group>[<bit>]`", the group taken from the owning bus's first
    `groupConnections` entry (else the bus id); a `free` vertex named by some bus's
    `groupConnections` (group-snapped, FR-042) → "`<label> <group>`"; a plain
    `junction` (no `bit`, FR-034) → "`junction (x, y)`" (a junction ties ≥2
    conductors, so it is connected); otherwise (a dangling `free` end, FR-029) →
    "`unconnected (x, y)`" from the vertex position. No editable fields, so the sheet
    ignores the simulating lock.
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
  the lower-left corner showing the program's operating state (text; always
  `editing` until the simulator exists), a message tray filling the remaining
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
  a bus); "Delete component" (on a component). Dismissed by choosing an item,
  Escape, or an outside click. `interaction.js` builds the item list and dispatches
  the commands; `contextmenu.js` only renders and positions the menu. Width and
  bit-name entry use small modal prompts in `dialogs.js`.
- **Dependencies:** store, api, geometry.

### 6.12 JS: API client & bootstrap (`web/js/api.js`, `web/js/app.js`)
- **Purpose:** typed-ish wrappers over `fetch`; app startup.
- **Satisfies:** FR-003, FR-004, IR-001, NFR-002.
- **`api.js`:** `getComponents()`, `getDefaults()`, `listDir(path)`,
  `loadDesign(path)`, `saveDesign(path, design)`, `ping()`. All target
  same-origin
  `/api/v1/*` (localhost only — no external requests, NFR-002). Each rejects with
  the server error envelope on non-2xx.
- **`app.js`:** create the store with an empty design named
  `unnamed schematic <localDateTime>` in SELECT mode (FR-004, FR-045); fetch
  components + defaults (await both, FR-003); offer backup recovery (§6.12a,
  FR-093) before presenting the empty design; build palette, toolbar, canvas,
  interaction; start the connection monitor and backup writer (§6.12a); remove
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
- **Satisfies:** FR-075–FR-087, FR-067a, FR-062d (client side), FR-071a, FR-071b.

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
- Compiled form: `{ outputs: [{signal, pin, kind: plain|T|R, lhsLow,
  terms: [[{signal, low}]], enable: term|null}], ar, sp }`, cached **per type
  name** — instances share it.
- Compiled literals carry `low` = the use-negation (`{signal, low}`, true iff
  the net reads `low ? 0 : 1`); outputs carry `lhsLow` = the LHS use-negation.
- Evaluation (selective pessimism, FR-077): a literal is true iff its net reads
  `(low ? 0 : 1)`, U if the net is U/Z; a product is **0 if any literal is
  false**, else U if any literal is U, else 1; the sum is **1 if any term is
  true**, else U if any term is U, else 0. A plain/`.T` output drives `sum XOR lhsLow`; a
  `.R` output drives `register XOR lhsLow` (the sum is the D input, latched by
  `sim.js`); a `.T`/`.R` output with `enable` false contributes Z, with enable U
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
  - *Strict* (`gal:` present) runs a device table — pin/OLMC counts, which
    suffixes and which of `AR`/`SP`/`.CLK`/`.ARST`/`.APRST` the device allows, and
    the per-OLMC product-term profile — and pushes a preflight error (§6.13
    `errors`) for any construct or capacity the device lacks (e.g. XOR on any
    device, `.CLK` on a non-20RA10, `AR`/`SP` on a 16V8/20V8). The product-term
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
  into its register. (2) Evaluate every driver against `curr`. (3) Resolve every
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
- **Interactive inputs (FR-087b):** the engine subscribes to the store's
  live-input channel (§6.10) for the duration of a run. `applyLive` (the
  non-undoable sim-time mutation behind a switch click, FR-087a) fires that
  channel; the engine's listener calls `wake()`. For a combinational run `wake()`
  re-runs a settling episode if idle (no-op if an episode is already in flight);
  for a paced run it is a no-op (the rAF loop already re-reads instance state
  each step). This is the general re-evaluation path — not switch-specific — so a
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

**The port built-in (FR-094/FR-094a).** A port is an ordinary built-in instance (`builtins.js`, §6.11): a synthetic `ComponentType` `name:"port"`, `builtin:true`, one **one-bit** connection pin. It carries per-instance fields beyond the usual ones (the `switchState` precedent, §6.11): `label` and optional `target` (`{file,label}`, FR-101), user-set and round-tripping with the instance (§7.2), plus `portDir` (`in`|`out`|`bidir`) which is now a **derived** value (FR-094c) — computed from the wiring by `portDirection`, and written at save (`fileops.save`) rather than hand-edited — and an optional `dirOverride` (`in`|`out`, FR-094d). The port's **effective direction** is `effectivePortDir(design, refdes) = (portDirection(...) === "bidir" && inst.dirOverride) ? inst.dirOverride : portDirection(...)` (a small helper beside `portDirection`); this effective value is what is saved and what every consumer reads. The properties panel shows the direction **read-only** when the derived value is definite (`in`/`out`); only when it is `bidir` does it render an editable in/out/bidir selector that writes `inst.dirOverride` (clearing it when set back to `bidir`), carried by the existing `SetPortProps` command. A 1-wide port has **no width** field (superseded — a pin is one bit; multi-bit interfaces are portN, FR-071e). The port's connection point is a `connector` **vertex** (§7.1a): like a `pin` vertex its position derives from the instance (so wires to it stretch for free), but its kind marks it for the netlist's label rules. `drawComponent` gains a `port` branch (`drawPort`) — a **pentagon** "flag" (FR-094b): the flat back edge sits on the connection-pin side, and the body tapers to an apex pointing **off-sheet** (opposite the pin). The pentagon is built in the instance's local grid frame and projected through `rotateOffset`, so it rotates with the instance and the apex↔pin relationship holds (FR-020); the label is drawn upright at the body center (FR-015), with a small filled triangle at the apex when it carries a `target`. Ports get `A-<n>` refdes via `addInstance` (FR-011a).

**Interface resolution (FR-095).** `designInterface(childDesign) → InterfaceSignal[]` returns one `{label,dir,width}` per distinct port — both 1-wide `port`s (`width:1`) and multi-bit `portN`s (FR-071e, `width:N` = its `P` pin-group size) — keyed by label and ordered by label; the first port seen for a label wins on a disagreement. Here `width` is the **signal's** bit count, not a pin attribute — a pin is always one bit. Each signal's `dir` is **derived from the child's wiring** by `portDirection(design, portRefdes)` (FR-094c), not read from a stored `portDir`: it builds the child's nets (`buildNets`) and inspects the non-port pins on the relevant net(s) — any `bidir`/`tristate` pin → `bidir`; else any plain `out` driver → `out`; else `in` (also when unconnected). For a 1-wide port the net is found by **label** (the connector pin is now also a net member, FR-094e, but label lookup remains the direction-derivation path); for a `portN` the direction is **aggregated across its bit nets**, found by the port's `P0..P(N-1)` pin keys (which *are* net members, joined through the snapped bus/wire). `designInterface` then applies the port's `dirOverride` (FR-094d) — so a derived-`bidir` signal carrying an override reports `in`/`out`, and the dir returned is the **effective** direction (the override is ignored unless the derived value is `bidir`). `synthTypeForInterface(iface, render) → ComponentType` builds an **in-memory, never-saved** synthetic `ComponentType` whose pins are all **one bit**: a `width:1` signal becomes one pin named by its label; a `width:N` signal **expands into N pins** `<label>0`..`<label>(N-1)` (contiguous, in bit order) **plus a `pinGroups` entry** named `<label>` so a matching-width bus snaps to it through the ordinary group machinery (FR-041/FR-042). Pins are laid out per render style (`ic`: `out` right, `in`/`bidir` left; a signal's expanded pins stay together on one side). This is the key reuse: a sub-design instance carries this synthetic `typeData` in memory, so `pinWorldPos`, vertices, wire endpoints, bus snap, hit-testing, and the rectangle renderer all work **unchanged** (§6.6–§6.9). A child with no ports has an empty interface and cannot be embedded (FR-097a).

**The ADD flow (FR-097/097a/097b).** `builtins.js` exposes a single non-placeable lower-palette entry **ADD**. Arming it and clicking (or dropping it on) the canvas opens the **Add sub-component dialog** (`dialogs.js`) at the grid point instead of creating an object. The dialog: (1) navigates/loads a child via `/api/v1/files`+`/design/load` (§6.4); (2) shows the child's `defaultRender` (§7.2) and resolved interface; (3) offers an `ic`/`connector` choice defaulting to `defaultRender`. OK → dispatch `PlaceSubDesign(childPath, render, @grid)`; Cancel → nothing; both return to SELECT (one-shot, FR-010). `childPath` is held **absolute in memory** (the picked child's absolute path) and relativized to the parent's save dir only at save time (§7.4), so embedding **does not require a saved parent** and shows no save prompt (FR-097b). The dialog rejects an interface-less file, and a self/cyclic embed (`wouldCycle`), with a message.

**The New GAL part flow (FR-066b/066c/007a).** `builtins.js` exposes a non-placeable upper-palette action **New GAL part** (a tile that opens a dialog rather than arming placement). The **New GAL part dialog** (`dialogs.js`) renders the device's fixed skeleton — for the GAL22V10, the 24-pin map (pin 1 clock/in, 2–11 + 13 in, 14–23 OLMC I/O, 12 GND, 24 VCC) — and collects only the per-part data: `partnumber`, optional `description`, a label per I/O pin, a per-OLMC direction (in / comb-out / reg-out), optional named pin groups (FR-066d, below), and the `behavior` block. As the user types, the dialog assembles a candidate `typeData` (`type:"22V10"`, `gal:"GAL22V10"`, an immutable `id` generated from the `partnumber` (FR-066e), the chosen `pins`, the `behavior`) and runs `galasm.js` `compileBehavior`+`validateStrict` (§6.13) **live**, surfacing the same accept/reject diagnostics Run would (FR-079b) — the dialog reuses that one gate, adding no second validator. OK serializes the `typeData` to YAML client-side and `POST`s it to `/api/v1/components` (§6.4); on success it dispatches the live palette add (above) and returns to SELECT (one-shot, FR-010). A duplicate-`id` 409 or validation error is shown in the dialog; Cancel discards. Placement of the resulting tile is then ordinary FR-008/FR-009.

**Pin-groups sub-dialog (FR-066d).** A "Pin groups…" button opens a modal sub-dialog (`dialogs.js`) that edits the part's named pin groups (FR-063). It lists the groups defined so far (each with a remove control) and offers a name field plus a checkbox per pin (labeled with the pin's *current* label) to define one more; "Add group" appends it to the working list, and the sub-dialog returns the updated list to the parent on close. Membership is stored by the **skeleton pin** (its stable DIP `number`), not the label string, so a later rename does not break a group; `galPartYaml` resolves each member to its current label and emits members in **pin-layout order** (the part's pin order, top-to-bottom) so the bus bit order is deterministic (FR-066d). The parent dialog folds the groups into the candidate `typeData` only for the YAML write (a `groups:` block, §7.3) — groups do not enter `compileBehavior`/`validateStrict`. Client checks: non-empty unique name, ≥1 member, and the **geometry rule** (FR-063a) — the checked pins must share one side and form a contiguous run (no non-member pin between them); the sub-dialog rejects an "Add group" that straddles sides or is interrupted, so it can only build groups the brace can render. Membership is by skeleton DIP number, but the side/contiguity test resolves each member to its skeleton pin's side/`pos`.

**The memory-device generator (FR-114/FR-114a/FR-114b/FR-114f).** A second non-placeable **upper-palette** action tile, **NEW MEM** (built beside the New GAL part tile, labeled **NEW GAL**, in `app.js`, routed through interaction's palette-click handler to an `onNewMemDevice` callback exactly as `newgal` routes to `onNewGalPart`). Its callback opens the **New memory device dialog** (`memDeviceDialog`, `dialogs.js`). The dialog's top control is a **RAM/ROM** radio (default RAM); below it a common **name** field and a **dynamic region** holding the class-specific controls, fully rebuilt whenever the radio changes (FR-114 "completely re-initializes"): for both classes an **address-bits** number field *n* (1–24) with a live "= 2ⁿ locations" readout and a **data-width** select {4,8,16,32} (default 8); for ROM only, a **content-file** row — a "Choose file…" button that opens the server-side file browser (`openFileDialog`, FR-053, reused with a custom title) and a label showing the chosen path. The **name** field (FR-114a) is common (it survives a class switch); it is pre-seeded with a size-based suggestion (`suggestName`, e.g. "RAM 256×8") that keeps tracking the class/size/width until the user types into it (a `nameEdited` flag then freezes it). `gather()` returns `{ name, kind:"ram"|"rom", addressBits, locations:2**n, dataWidth, romFile? }`; a pure `validateMemSpec(spec)` helper (testable, no DOM) gates **Create** — name non-empty, *n* in range, width in the set, and a ROM file chosen for ROM. The radio, fields, name, and file selection re-run validation live. OK resolves the gathered+validated spec to `app.js`, whose `onNewMemDevice` builds the type with `memDeviceType(spec)` (below), serializes it to component YAML with `memDeviceYaml(type)` (a `mem:` block plus the explicit pinout, §7.6/FR-114f), and **persists** it through the same `createComponent` POST the GAL flow uses (FR-007a) — the server writes the `.yaml`, registers it, and returns the parsed type, which `addCreatedPart` joins to the library + sorted upper-palette tile. A duplicate name (hence `id`) or an existing library file is rejected by the server (409); `createComponent` throws and `memDeviceDialog` surfaces it inline (the dialog stays open). A built-in id collision (built-ins are not in the server library) is still caught client-side before the POST. A placed device **simulates** via the built-in memory behavior (FR-114d, §6.13), and a ROM's content is loaded from its file at Run (FR-114e). The ROM picker calls `openFileDialog` with `exts:["bin","hex"]`, so the server file browser lists those (and dirs) rather than designs. **Cross-session persistence (FR-114f, was deferred per FR-114b/OQ-013):** the generated metatype is now written to the component library as a `.yaml` artifact carrying its `mem:` block, so it survives reload and Refresh Types (FR-088); on load the built-in behavior binds from that serializable `mem` data (not session-only code), and a *placed* instance still also round-trips via its embedded `typeData` (FR-057).

*Generated pinout (FR-114c, `memDeviceType` in `builtins.js`).* From `{name, kind, addressBits:n, dataWidth:w, locations}` it synthesizes a `ComponentType` rendered as an ordinary IC rectangle (§6.8): **left** edge top-to-bottom = `A0…A(n-1)` (an `ADDR` pin group, FR-063) followed by `CE/`, `OE/`, and — for RAM — `WE/` (the controls trail the address run so they don't break its contiguity, FR-063a); **right** edge = `D0…D(w-1)` (a `DATA` group). Address and control pins are `in`; data pins are `bidir` for RAM and `tristate` for ROM (FR-062a). The outline mirrors the server's `resolveOutline` (§6.3) — width 4 (no top/bottom pins), height = max-edge-position + 2. The type is **not** `builtin` (so it gets a U-series refdes and the default labelled-rectangle render with pin names, §6.8), takes the free-form `name` as its display name with the derived `id` `type-<name>` (FR-066e, the same rule loaded/GAL parts use — so a duplicate name is rejected by the create endpoint), and carries a `mem:{kind,addressBits,dataWidth,locations,romFile?}` block driving the built-in behavior (FR-114d) and round-tripping through YAML persistence (FR-114f, via `memDeviceYaml` in `dialogs.js`). Pure, no DOM.

*Generated behavior (FR-114d), implemented in `engine/memory.js` + `sim.js` (§6.13).* Memory is the first built-in whose behavior **reads** its input nets and keeps per-instance state, which the source-only `BEHAVIORS` signature (§6.11) can't express — so it lives in a dedicated `createMemoryCore({kind,addressBits,dataWidth})` and a `kind:"memory"` simulator entity rather than the `BEHAVIORS` registry. ROM content loading from the chosen file is implemented (FR-114e), and cross-session metatype persistence is implemented (FR-114f, via a `mem:` YAML block) — both formerly open under OQ-013.

**Sub-design instance (FR-098/098a/099).** An entry in `design.components` with `kind:"subdesign"`, `childPath`, `render`, `iface` (the last-resolved interface record, FR-099c), `x`, `y`, `rotation`, and an `X<n>` refdes — a third series beside U and A (`addInstance` scans X-suffixes, FR-098a); a child may be embedded repeatedly as independent X-instances. It stores **no** `typeData` (supersedes FR-057 for it); its in-memory `typeData` is the synthetic interface type, recomputed on load and whenever the child changes (FR-099b). Rendering (`canvas.js`, §6.8 dispatch on `kind`): `ic` — the existing rectangle over the synthetic type (inputs left, outputs right, pins labelled by port label, `X1` + child base name upright); `connector` — a tall narrow rectangle with all interface pins ranked along **one** long edge in label order (OQ-010). Both are purely cosmetic (same interface, same connectivity, FR-099); a multi-bit interface signal appears as a **pin group** of one-bit pins (bus snaps to the group, FR-041/FR-039a). A child that fails to load renders as a **broken-link placeholder** (a red box naming the missing relative path), reported once via the message tray (FR-099a), reusing §6.8's unknown-type placeholder.

**Navigation & back-stack (FR-100/100a).** Descending into a sub-design instance (double-click, or context-menu "Open sub-design") navigates to the instance's **absolute** `childPath` directly (no longer resolved against the parent dir, since the in-memory path is already absolute); following an off-sheet connector (clicking a port whose `target` is set) resolves its target path relative→absolute against the current design's save dir. Both perform a **navigation** = the existing Open flow with the FR-049a unsaved-changes guard (save or discard before the canvas is replaced). Because **back** re-opens the parent from its file, descending while the parent is unsaved first prompts to save it (FR-100a interim); declining cancels the descent. `app.js` keeps a transient `navStack` of absolute paths recording the descended chain; a breadcrumb in the chrome offers **back**, popping and re-opening the parent (itself save-or-lose). The stack is session state — not persisted, not on the undo stack.

**Connectivity (FR-094a/FR-101a).** Within one open design `buildNets` (§6.6, step 6) unions lanes of `connector` vertices whose port shares a `label` (per bit for `width>1`), so same-label ports are one net with no drawn wire. Cross-file continuation is **not** applied in single-design `buildNets` (the editor edits one sheet at a time); it is composed only when the simulator assembles the sheet graph (below), and only across the **explicit** `target` links — never by coincidental label equality between unrelated files.

**Flattening for the simulator (FR-102/102a/103) — `flatten` in `subdesign.js`.** `flatten(rootDesign, loadChild, { rootPath }) → Promise<FlatDesign>` (async: children and peer sheets load through the injected `loadChild(absPath) → Promise<savedObject>`, the same `/api/v1/design/load` reader `resolveSubDesigns` uses) produces a plain simulation-only design — never rendered, never saved — that feeds the existing `buildNets`+evaluation pipeline (§6.13), and later the C generator (§6.17), unchanged. A design with no sub-design instances and no `target` links flattens to itself (identity pass), so the single-sheet path stays fast (NFR-005). (Reworked 2026-07-04; supersedes the earlier sketch of this block — mechanism made concrete: id/label prefixing, attachment-rewrite stitching, synthetic link wires, peer cycles legal.)
  - **Expansion (FR-102).** Depth-first over sub-design instances: each `X<n>` instance is replaced by a deep copy of its deserialized child's components/wires/buses/vertices with every `refdes` **and every wire/bus/vertex id** prefixed by the instance path (`X1/`, `X1/X2/`, …). Refdes prefixing keeps `refdes.pin` identity unique; id prefixing keeps copied conductors/vertices from colliding with the parent's ids (and keeps `conflictedConductors` from ever matching — hence falsely highlighting — a top-sheet conductor). Nested sub-design instances recurse with the accumulated prefix.
  - **Label namespacing (FR-102).** Copied port **labels** are prefixed the same way (`X1/CLK`): `buildNets`' label-union rule (step 6, FR-094a) then still unions same-label ports *within* one instance but never across instances or with the parent (FR-101a within the hierarchy). Hierarchical net names in conflict/indicator messages fall out of this for free.
  - **Interface stitching (attachment rewrite).** For each interface signal, the child's owning port (the first port carrying the label, matching `designInterface`) defines a target connection pin — the 1-wide port's single pin, or the portN's `Pk` for bit `k`. Every parent attachment on the instance — a `pin`/`connector` vertex with `ref === "X1"`, and a bus `groupConnections` entry with `instance === "X1"` — is rewritten in place to the prefixed target (`ref:"X1/A1", pin:<port pin>`; `gc.instance = "X1/A5"` with `bitMap` renamed to `Pk`). `buildNets`' shared-pin union (step 5) and the connector's FR-094e pin attachment (step 6) then merge the parent lane with the child's port net — no new netlist machinery, and no geometry (a FlatDesign is never drawn, so vertex positions are irrelevant).
  - **Off-sheet connectors (FR-101/103).** After embedding, follow every port `target` transitively (target file paths resolve against the referencing sheet's directory), de-duplicating loaded files by absolute path; each distinct peer sheet is merged under a per-sheet tag prefix (file base name, numeric suffix on a collision; the root sheet unprefixed) applied to refdes/ids/labels exactly as above. Each declared link then becomes a **synthetic two-node wire** between the two ports' connector vertices — the ordinary wire-lane union implements the cross-file net (FR-101a). Mutual peering (A↔B) is legal (FR-102a): de-dup bounds it.
  - **Cycles (FR-102a).** A visited-set of absolute file paths along the current expansion path detects an embed of an already-open ancestor — including via a `target` that leads back into one — and `flatten` throws; the sim run and the vector runner refuse with a message-tray report. The ADD dialog refuses via a `wouldCycle(childAbsPath, parentAbsPath, loadChild)` helper that walks the candidate child's transitive embeds (FR-097a).
  - **Consumers (§6.13/§6.16).** `createSim.run()` awaits `flatten` first and feeds the FlatDesign to `loadRomContents` + `buildSimulation`, so child ROMs preload (their `mem.romFile` paths are stored absolute, §6.14 persistence) and child built-ins (clock, POR, pulls, switches) participate; child switches/indicators have no top-sheet UI presence — their effect is electrical only. The FlatDesign **shares the root's component objects** (cloning only what flatten rewrites: wires/buses/vertices, plus shallow copies of the sub-design entries it replaces), because the running sim reads mutable interactive state off the retained instances — top-sheet switch clicks (FR-087b) must stay live during a run. Vector runs flatten at the caller: the panel's Run/Capture (`dialogs.js`) flatten before `loadRomContents` + `runVectors`/`captureVectors`, keeping the runner itself synchronous and design-agnostic; the runner refuses a **hidden clock** — a clock generator whose refdes is hierarchical (inside a child/peer) — since scripted-clock mode (FR-115e) drives clocks by top-sheet columns only. The FR-107 parity harness flattens its slow leg the same way (cgen milestone), so hierarchical parity pairs depend on this. `SUBUNIT_PKG_RE` (§6.13, and its `cgen.js` twin) becomes hierarchical-prefix-tolerant — the package key is the full prefixed stem (`X1/U3`), so a child's subunits group within their own instance and never across instances.
- **Loading (FR-098/099a):** on opening a design, `fileops` (`loadIntoStore`) converts each sub-design's stored **relative** `childPath` to **absolute** against the opened file's directory, then `resolveSubDesigns` loads each child (by its now-absolute path) far enough to resolve the interface for rendering; failures yield broken-link placeholders, never aborting the open. After load the model holds absolute paths. Deep child contents load lazily — only `flatten` (at Run) needs them. As its final step `loadIntoStore` invokes an `onLoaded` callback (wired in `app.js` to `interaction.fitToScreen`, FR-022a) so every completed load — Open and hierarchy navigation alike — frames the design in the viewport; the callback runs after `replaceDesign`, once the new geometry exists.
- **Interface-change re-route (FR-099c):** each instance carries `iface` — the `designInterface` array it was placed/last saved with (`addSubDesignInstance` sets it; §7.2 persists it; the comparison record FR-099c allows, never used for rendering or simulation). `resolveSubDesigns` deep-compares the freshly resolved interface against it: on a difference it updates `iface`, reports the instance, and returns the changed refdes list (`{ changed }`). `loadIntoStore` then calls `rerouteAttachedWires(design, changed)` (`engine/router.js`): for every **simple** wire — a two-point path whose ends are both `node` refs and which passes through no junction vertex — with an endpoint `pin`/`connector` vertex on a changed instance, propose a fresh route between the endpoints' derived world positions (escape vectors from the pins' rotated sides, as interaction's `routerEndpoint` does) and replace the wire's interior points, keeping the endpoint node refs; a null route keeps the old bends. Runs before `store.replaceDesign`, so like the FR-099b dangling rewrite it is load-time normalization — no command, no undo, no dirty mark. An instance with no stored `iface` (a pre-FR-099c file) skips the comparison and gains the field at the next save.
- **Persistence:** no Go change is needed — the server already stores designs as an opaque `json.RawMessage` (§6.5), so the new instance fields (`kind`/`childPath`/`render`/`iface`/`label`/`portDir`/`dirOverride`/`width`/`target`), the design-level `defaultRender`, and the `connector` vertex kind round-trip untouched (`iface` is additive-optional like `defaultRender`/`target` were — no `formatVersion` bump). Only the client model (`model/design.js`, `model/persist.js`) is typed; `persist.js`'s structural sanity pass (§7.4) validates a `connector` vertex's `ref`/`pin` exactly as it does a `pin` vertex. The in-memory `childPath` is absolute (FR-098); **`fileops.save` relativizes** each sub-design's `childPath` against the chosen save dir just before writing, and **`loadIntoStore` absolutizes** on open — so the on-disk file stays relative/portable while the live model is absolute. `serializeDesign` itself round-trips `childPath` verbatim (a backup snapshot, §7.4, thus stores the absolute path, correct for same-session recovery). Child files are read through the existing `/api/v1/design/load` with client-resolved absolute paths.
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
  - **Refdes remap.** Group fragment components by physical package: a subunit package (shared `U<n>` stem) gets **one** new U-number (via `nextRefNum`, §6.6) with its sibling letters preserved (`U7A…`); a single IC gets a new `U<n>`; a built-in gets a new `A-<n>`; a text note a new `N-<n>`; a sub-design instance a new `X<n>`. Build an `oldRefdes → newRefdes` map and rewrite each component's `refdes` (and its derived per-pin vertex `ref`).
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
- **Satisfies:** FR-115, FR-115a, FR-115b, FR-115c, FR-115d, FR-115e (sequential), FR-115f (port binding); extends FR-004a (new **Simulate** menu). (FR-115g, the interim clocked-design guard, is superseded and removed.)

**Pure runner & file model (`engine/vectors.js`, DOM-free, unit-tested in `vectors.test.js`).** A new module, deliberately free of any DOM so it tests like `validateMemSpec`/`memDeviceSpec`:
  - `deriveColumns(design) → { inputs, outputs, warnings }`. Enumerates `design.components` (the same iteration the simulator uses, §6.13) filtered by `typeData.renderType`: `"switch"` → one **input** column `{ refdes, pin:"OUT", label }`; `"indicator"` → one **output** column `{ refdes, pin:"IN", label }`; `"indicator8"` → eight output columns `{ refdes, pin:"D0".."D7", label }`; and **ports** (`"port"`/`"portN"`, FR-115f) by their **effective direction** (`effectivePortDir`, §6.14, FR-094c/FR-094d): an effective-`in` port → input column(s), an effective-`out` port → output column(s), an effective-`bidir` port → **skipped** (its label collected into `warnings`). A 1-wide port contributes one column `{ refdes, pin:"P", label }`; a `portN` of width N expands to **N one-bit columns** `{ refdes, pin:"P"+i, label:label+i }` (uniform per-bit, no whole-bus column). A port column is thus identified by the port's **own** `(refdes, pin)` — the natural, stable identity (FR-115f). `label` is the instance's display label (FR-011b) falling back to `refdes`; columns are sorted by refdes (numeric-aware, then pin) for stable order — port-derived columns **coexist** with any switch/indicator columns. `"clock"` (FR-115e) → one **input** column `{ refdes, pin:"OUT", label, kind:"clock" }` whose cells take `0`/`1`/`C`; `kind` is a live-only marker (the dialog's cell options and `validateVectors`' `C` legality key off it) and is **not** persisted in the `.tv` file — reconciliation stays pure `(refdes,pin)`.
  - `runVectors(design, doc, { romContent }) → { rows:[{ cells:[{pass, actual}], pass }], passed, total }`. Branches on `hasClockGenerators(design)`. **Combinational** (FR-115c), for each row independently: `structuredClone(design)`; for each input column drive it by the row's symbol (`"0"`/`"1"`) — a **switch** column sets that instance's `switchState`, a **port** column appends `{ refdes, pin, value }` (`V0`/`V1`) to a per-row **stimulus** list (FR-115f) — then `buildSimulation(clone, { romContent, stimulus })` (§6.13, the stimulus strong-drives each bound input-port net), drive the **settle loop** — `step()` until `!lastStepChanged()` or `SETTLE_BOUND` (10,000) units, the same bound and quiescence test as `settle()` in `sim.js` (FR-085) — and read each output via `sim.valueOfPin(refdes, pin)` (a port output reads straight off its own net, FR-094e). Compare per FR-115c: `H`↔`V1`, `L`↔`V0`, `X` passes always; `VU`/`VZ` never match. The clone makes the run side-effect-free (FR-115c): the live `store.design` is never mutated, dirtied, or pushed to undo.
  - **Sequential path (FR-115e).** One `structuredClone(design)` and one `buildSimulation(clone, { romContent, scriptedClocks: true, stimulus: [] })` for the whole run; rows share the instance so register/net state persists. The runner owns the clock and reset nets via `sim.setStimulus(...)` (§6.13). **Power-on preamble:** stimulus asserts every reset built-in (`R`=`V1`, `/R`=`V0` — two entries per instance) with all clocks at `V0`; settle; then `max(cycles)` scripted pulses (all clocks high, settle; low, settle), each reset instance switching to released (`R`=`V0`, `/R`=`V1`) once its own `cycles` (via `effectiveProps`-equivalent resolution, FR-020b) worth of pulses have elapsed; final settle. **Per row, in order:** set switch columns on the clone's instances (`switchState`, read live each step), rebuild the stimulus — ports per cell, resets released, each clock at its cell's level (`C` counts as low) — `setStimulus`, settle; if any clock cell is `C`, drive those clocks `V1`, settle, back to `V0`, settle (one shared pulse, FR-115e); then read and score outputs exactly as the combinational path. Every settle phase uses the same `SETTLE_BOUND` loop.
  - `captureVectors(design, { inputs, outputs }, rowsIn, { romContent }) → outSymbols[][]`. Whole-table capture used by the dialog's Capture button: combinational designs capture each row independently (as `captureRow`); sequential designs run the same ordered pass as `runVectors` — preamble, then each row's inputs and pulses — recording each row's settled outputs in sequence (FR-115e).
  - `captureRow(design, rowInputs, { romContent }) → outSymbols[]`. Same drive + settle (switches and port stimulus alike), mapping each settled output to `H`/`L`, or `X` when `VU`/`VZ`.
  - `validateVectors(doc, columns) → { ok, warnings, errors }`. Pure gate: legal cell symbols — `0`/`1` in input cells, with `C` additionally legal **only** in a `kind:"clock"` column (FR-115e); `H`/`L`/`X` in output cells — row arity vs column count, and `(refdes,pin)` reconciliation against the live `columns` (a file column absent from the design, or a design column absent from the file, is a non-fatal warning, FR-115a).
  - File model: `FORMAT_VERSION` (**2** — v2 marks the `C` input symbol, FR-115e; the shape is unchanged and the v1→v2 migration is the identity), `serializeVectors(doc)`, `deserializeVectors(obj)` with a `migrate()` chain mirroring `model/persist.js` (§7.4); shape per §7.7. ROM content is loaded once before a run via `loadRomContents(design)` reused from `sim.js` (FR-114e), so ROM-backed combinational logic resolves.
  - `hasClockGenerators(design) → boolean`. True when any component's `typeData.renderType` is `"clock"` — the same built-in identification `buildSimulation` uses for the sequential/combinational split (§6.13, FR-086). Selects the sequential run path (FR-115e) in `runVectors`/`captureVectors`, the clock columns in `deriveColumns`, and the dialog's sequential-mode notice. Pure and DOM-free; deliberately a design scan rather than `buildSimulation(...).hasClocks()`, which would compile every behavior just to answer a yes/no question. (Originally introduced for the FR-115g guard, now superseded.)

**Panel (`chrome/dialogs.js` `testVectorsPanel({ store, dataDir })`).** A **docked, modeless panel** (FR-115b, reworked 2026-07-02 from the former `.dialog-overlay` modal so the schematic stays visible while authoring). It mounts into `#vec-panel`, the bottom-third host inside a now flex-column `#canvas-area` (canvas host on top, panel host below); opening reveals the host and shrinks the canvas box, which the `canvas.js` `ResizeObserver` refits automatically at the unchanged viewport — content keeps its scale/aspect, only the visible extent shrinks (§6.13) — and closing hides it so the canvas grows back. It exposes `open()`/`close()`/`isOpen()` and a header **✕/Close** control, and binds **no** Escape-to-close (Escape remains a canvas gesture). While open it sets `store.state.vectorPanelOpen`, imposing the FR-115h read-only lock (see toolbar/store wiring below). It renders an HTML `<table>` whose header comes from `deriveColumns(store.design)` — which includes the design's port columns (FR-115f) directly, so the panel and runner operate on `store.design` itself (no wrapper); any `warnings` it returns (bidir ports skipped for lack of an override, FR-094d) show in the notice line alongside FR-115a reconciliation warnings — and whose body is rows of `<select>`/`<input>` cells held in a 2-D ref array read back in `gather()` (the map-to-`{el}`-then-read pattern of the GAL pin rows). Buttons: **+ Row** / **− Row**; **Run** → `runVectors` then paint each output cell green/red (a failing cell shows its `actual`) and write an "N of M rows passed" summary line (FR-115d); **Capture** → `captureVectors` filling every row's expected cells (ordered pass for a sequential design, FR-115e); **sequential mode** (FR-115e): when `hasClockGenerators(store.design)`, a clock column's cell `<select>` offers `0`/`1`/`C` (per its `kind:"clock"` marker) and defaults to `C`, and a persistent notice line (`vec-mode`) states that rows run in order, state persists, and `C` pulses the clock — replacing the removed FR-115g guard; **Load**/**Save** → `openFileDialog` (§6.11) seeded at `dirOf(store.state.savePath)` (POSIX helper from `fileops.js`) with default `<base>.tv`, then the design load/save API wrappers (`api.js`) — the `.tv` payload is JSON and rides the existing `/api/v1/design/{load,save}` endpoints (§6.4), which neither interpret nor extension-check the body. New `vec-*` CSS classes in `style.css` reuse the dialog primitives, the raised tray shadow, accent `#4a90d9`, error `#b00`, success `#1a7f37`.

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
  - **GALasm entities:** each compiled output's term/sum tree is lowered to a C expression/function over `curr[]` using the `rt_*` ops — plain, `.T` (enable gating), and `.R` outputs; register state as static `rt_val` arrays; global-clock and per-output `.CLK` edge detection mirroring `updateRegisters`/`evalOutput` (§6.13, FR-079/FR-079a). Subunit packages union their siblings' pins exactly as `makeGalasmEntity`. **Buried registered nodes (FR-079c)** mirror the slow engine's virtual-net trick: `lowerGalasm` appends one placeholder net per `typeData.internal` name (bumping `gen_net_count`), maps the node to a synthetic `"<refdes>.#<node>"` key in `netOfPin`/`pinOwner` and interns a label for it; the buried `.R` output then lowers into ordinary `reg_<tag>[k]` state (`gen_init` U-seed, `gen_latch` rising-edge D-latch reading buried literals as `curr[<vnet>]`) and a `gen_drive` fragment `rt_contrib(<vnet>, reg_<tag>[k], 0, <label>)`, so `curr[<vnet>]` carries the one-unit-delayed buried value the runtime's unchanged net resolve produces — no runtime change, the two engines agree on `Q7`/`Q7N` (FR-107). New sequential parity pair `examples/74165-*` (a placed 74165 with switch-driven `D0..D7`/`DS`/`PL`//`CE`/, a clock on `CP`, indicators on `Q7`/`Q7N`, and a `.tv` exercising load-then-shift and `CE`/ inhibit) covers a buried sequential node through the FR-107 harness (`runtests.sh` step 3).
  - **Built-ins/memory:** instance tables (type, nets, effective properties, switch's persisted state as its baked drive level — overridable by a vector input column); each ROM's **refdes and content-file path** baked for the runtime's startup load (FR-117b; superseded the M3 baked-bytes rule 2026-07-03); RAM starts all-U.
  - **Preflight/refusals:** same compile errors as `buildSimulation` (parse failure, `.R` without `clock:`); behavior-less types generate U-drivers with a warning (FR-080 analogue). The former FR-116 deferred-scope refusals of sub-design instances / off-sheet connectors remain **as internal guards** — the caller flattens first (FR-116 hierarchy, reworked 2026-07-04), so tripping one means an unflattened design reached the generator. `SUBUNIT_PKG_RE` is the hierarchical-prefix-tolerant form (§6.14), so a child's subunit packages group within their instance. A clock generator with a hierarchical refdes is baked normally (free-run mode drives it, FR-117a) and the **runtime's vector mode refuses it at startup** — `rt_init`/the vector runner scans `gen_clocks[].refdes` for `/`, reports the refdes with a pointer at `--cycles`, and exits 2 (the FR-115e hidden-clock rule, enforceable only at run time because one program serves both modes).

**Chrome wiring (`chrome/toolbar.js`, `app.js`).** The Simulate menu (§6.16) gains a **Generate C…** item (`onGenerateC`), disabled while `state.simulating` or `state.vectorPanelOpen` (FR-116). `app.js` handles it: fetch `/cgen/runtime.h` + `/cgen/runtime.c` → `flatten(store.design, loadDesign, { rootPath: savePath })` (FR-116 hierarchy; a flatten refusal posts to the tray and aborts) → `generateC(flat, { columnsFrom: store.design })` (no ROM preload — the program reads ROM contents itself at startup, FR-117b; the `loadRomContents` preload this section originally specified was discovered at M5 never to have been wired in — a latent all-U-ROM bug in app-generated programs, mooted by FR-117b) → `openFileDialog` in save mode with a `.c` extension (the `saveExt` generalization of §6.16) seeded at `dirOf(savePath)` with default `<base>.c` → write all three files through `POST /api/v1/file/save` (§6.4), the verbatim-text endpoint added for this purpose (the design-save endpoint requires a valid-JSON body — `json.Indent` — so C source cannot ride it; corrected 2026-07-02 from the original "reuse `/design/save`" plan). Failures/warnings post via the message tray (FR-074).

**Milestones.** (Sequencing per the 2026-07-02 discussion recorded in `gen-open.md`.)
  1. **M1 — runtime + minimal generator, combinational:** runtime pair, `cgen.js` for GALasm parts + switch/indicator/pulls, Generate-C menu flow; settle-and-stop; conflict reports. No compiler is invoked by any tool — the user compiles by hand (`cc <design>.c runtime.c`).
  2. **M2 — `.tv` stimulus + parity harness:** stdin vector rows (FR-117), transcript (FR-118); a Node-based parity harness (`web/tools/parity.js`) that, for each corpus design+`.tv` pair under `examples/`, loads the design (`deserializeDesign`), reads any ROM contents from disk (`loadRomContentsFs`, the Node/`fs` analogue of `sim.js` `loadRomContents`, passed to both engines), reconciles the `.tv` to the design's `deriveColumns` (§6.16), runs `runVectors` (§6.16) for the JS side, `generateC` + `cc` for the C side, feeds the same reconciled rows to the compiled program's stdin, and **diffs** the program's stdout transcript against the JS result **rendered into the identical FR-118 transcript format** (per-row `pass`/`FAIL <label>=<actual>` lines, `0/1/U/Z` actuals shared by both engines, plus the summary line) — the FR-107 check. Pairs the generator refuses (memory/sub-design/`.R`, M3+ scope) are reported as skipped, not failures. Run explicitly (`node web/tools/parity.js`); exits nonzero on any diff. M2 also delivers the **`tv2txt` converter** (`.tv` JSON → stdin row text), which must **reconcile**, not just dump: a `.tv` may assert only a subset of the design's derived columns (FR-115a reconciliation handles this in the panel), while the program's row format is positional against the **full baked column set** (FR-117) — discovered on first real use (74381, 2026-07-02), where a naive positional dump was rejected for arity. `tv2txt` therefore matches file columns to program columns by `(refdes,pin)` — exactly `reconcileVectors` (§6.16) — emitting `X` for design columns the file does not assert and warning on file columns the program lacks. To let it work from the emitted program alone (no design file needed), the generator shall bake each column's **`(refdes,pin)` identity** into `<design>.c` alongside its display label (the identity is already interned for port columns; this extends it to every column). **Chosen at M2 (2026-07-03):** the identity rides as extra **`refdes`/`pin` string fields on `rt_incol`/`rt_outcol`** (not a parallel table), and tooling reads the baked column set through a runtime **`--columns` dump mode** (the program prints its full column set — one line per column, `DIR KIND REFDES PIN LABEL…`, in row-format order — to stdout and exits), so `tv2txt` works from the compiled program alone with no `.c` text parsing. **`tv2txt` (`web/tools/tv2txt.js`, ESM, outside the `web/js/` `node:test` sweep):** `node tv2txt.js <program> <file.tv>` runs `<program> --columns`, parses the column set, and **reuses `deserializeVectors` + `reconcileVectors` (§6.16)** directly (single-source, FR-109) to align the file's `(refdes,pin)` columns to the program's positional order — inputs default `0` (clock columns `C`), outputs `X` — then writes the plain-text rows (`in… | out…`) to stdout and reconciliation warnings to stderr, so `node tv2txt.js ./sim d.tv | ./sim` runs the vectors.
  3. **M3 — sequential + memory:** delivered in steps. **Step 1 (landed 2026-07-03):** registered `.R` outputs on the global `clock:` pin, incl. global AR/SP (FR-079), lowered in `cgen.js` as per-instance `reg_<refdes>[]` state with a rising-edge latch in `gen_latch` mirroring `sim.js` `updateRegisters` (D input latched via `combExpr`, LHS-negation/enable applied at drive time as `evalOutput`); the runtime's sequential vector path (reset preamble, ordered rows, scripted `C` pulses) was already in place from M2, so no runtime change was needed. First sequential parity pair: `examples/simple174` (74174 hex-D FF with async `/MR`). **Step 2 (landed 2026-07-03):** per-output `.CLK` with async `.ARST`/`.APRST` (FR-079a) — independent clock domains and async set/reset, lowered alongside the global-clock family in one part (each self-clocked output carries its own `prevClk_<tag>_<k>` edge; global AR/SP restricted to the global-clock register indices). Runtime again unchanged. Second sequential parity pair: `examples/2-bit-SR` (7474 dual D-FF shift register). **Step 3 (landed 2026-07-03):** memory (RAM/ROM, FR-114d). The memory core (`memory.js` `createMemoryCore`) is re-expressed in `runtime.c` — `mem_decode`, `mem_write_all` (RAM WE/ 0→1 edge, in the latch phase alongside register latching), `mem_drive_all` (CE//OE//WE/ gating, in the contribution phase alongside `drive_builtins`), and `mem_reset` (RAM power-up U, ROM seeded from baked bytes via `loadBytes` semantics) — **runtime-owned**, driven from a `gen_mems[]` table (const wiring + `data_label` + baked ROM bytes) exactly like the other built-ins; the per-instance mutable store lives in the runtime, not the generated file. `cgen.js` emits the `gen_mems` entries and bakes ROM contents from the `romContent` map (FR-116a; all-U with a warning when a ROM's file is absent). Only sub-design instances remain refused (FR-116). Memory parity pairs: `examples/rom-demo` (R8X8 ROM + `rom-demo.hex`) and `examples/ram-demo` (1-bit RAM, tri-state data buffer released on read, dummy clock for sequential persistence). **M3 is complete.**
  4. **M4 — free-run + VCD** (scoped 2026-07-03: FR-117a, FR-118). **Free run (`--cycles N`, FR-117a):** a second, runtime-only drive path — instead of scripted clock/reset levels, the built-in drivers compute each clock's FR-084 square wave and each reset's FR-071b window from a simulated-time counter (`t` in unit steps, incremented by `rt_step`), exactly as `sim.js` evaluates those built-ins from `simTime`; the runner advances `N × clockPeriod` steps (`clockPeriod` per FR-071b's single-clock rule) with no settle loop, then prints the `LABEL=v` final observable dump (four-state, column order) to stdout. **No generator change:** the tables already bake `period_ns` (`rt_clock`) and `cycles` (`rt_reset`); `--cycles`/`--vcd` parsing, the time-driven drive path, the dump, and the VCD writer are all `runtime.c`. **VCD (`--vcd <file>`, FR-118):** works in both modes; header declares `$timescale 1ns` and one scalar signal per observable column; after every `rt_step` the runtime samples the columns and emits `#<t>` plus changed values (`0/1/U/Z` → `0/1/x/z`). Delivered in two steps, both landed 2026-07-03 — free run (parity-checked against the slow simulator run free for the same `N × clockPeriod` steps on `examples/counter` and `examples/simple174`), then VCD (initial `#0` power-up dump, change-only records; signal names are column labels with whitespace → `_`, ids bijective base-94). Runtime-only as designed — no generator change. **M4 complete.** **Free-run parity leg (added 2026-07-03):** `parity.js` additionally checks FR-117a for every `examples/*.json` design the generator accepts, `.tv` or not — the slow simulator runs free (`buildSimulation`, time-driven built-ins) for `8 × clockPeriod` unit steps (8 cycles clears the default 3-cycle reset window; `clockPeriod` per FR-071b's single-clock rule), its observable column set is rendered as the FR-117a `LABEL=v` dump, and the compiled program's `--cycles 8` stdout is line-diffed against it.
  5. **M5 — runtime ROM loading** (scoped 2026-07-03: FR-117b). ROM contents move from generate-time baking to a **startup load** in `runtime.c`, so a content file can change without regenerating. **Generated tables:** `rt_mem` gains `refdes` and `rom_file` (the `mem` block's path, FR-114f) and loses `rom`/`rom_len`; `cgen.js` stops consuming `romContent` (signature `generateC(design)`); `app.js` needs no change — it never actually wired the specified `loadRomContents` preload (a latent all-U-ROM bug in app-generated programs, found and mooted at M5). This is a `gen_`/runtime **interface change**: programs generated before M5 must be regenerated once. **Runtime:** `mem_load_all`, called from `rt_init` — per ROM, resolve the source (`--rom REFDES=FILE` override, else `rom_file` as recorded, else its basename in the cwd), parse per FR-114e (extension-selected `.bin`/`.hex`, hex = whitespace-separated byte tokens), pack little-endian `ceil(w/8)`-byte words into a runtime-owned byte buffer (partial trailing word dropped, over-capacity reported to stderr and truncated), any failure → stderr + exit 2 (an unresolvable `rom_file` names the refdes, both paths tried, and describes `--rom`); `mem_reset` seeds each ROM from that loaded buffer (the per-row combinational reset re-seeds from it, not from any file re-read). `main()` parses repeatable `--rom REFDES=FILE` before `rt_init`. **Parity:** `parity.js` keeps `loadRomContentsFs` for the JS engine only and points the program at the same file via `--rom` (its temp-dir cwd resolves neither baked path), exercising the override path on `rom-demo`.
  6. **M6 — hierarchy** (scoped 2026-07-04: FR-116 hierarchy rework). Fast-engine flattening: `onGenerateC` flattens (chrome wiring above); `generateC` gains `{ columnsFrom }` (generator paragraph above); the former X-instance/off-sheet refusals become internal unflattened-input guards; cgen's `SUBUNIT_PKG_RE` goes prefix-tolerant. **Runtime:** `rt_clock` gains no fields — the vector runner refuses at startup when any clock's `gen_labels` entry contains `/` (a clock's label is `<refdes>.OUT`, so a slash means a hierarchical refdes — hidden clock, FR-115e analogue; stderr names the clock and points at `--cycles`, exit 2); free-run mode unchanged. **Parity:** `parity.js` flattens the slow leg (Node `loadChild` reads relative to the design file's directory) and generates from the same FlatDesign with `columnsFrom` = the root; a hierarchical parity pair (a parent embedding a child) joins `examples/`. `engine/galasm.js` (`compileBehavior`, compiled-output shape), `model/netlist.js` (`buildNets`), `engine/vectors.js` (`deriveColumns`), `engine/sim.js` (semantic reference for the runtime), `engine/memory.js` (memory semantics reference; `parseRomBytes` as the FR-114e parsing reference), `chrome/dialogs.js` (`openFileDialog`), `chrome/fileops.js` (`dirOf`), `api.js` (save + static fetch), `chrome/toolbar.js`, `app.js`.

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
    reset instances have no physical package: each emits a comment line in the
    circuit block (`# virtual: A-3 (clock) OUT -> U1.CP, …`) naming every net
    pin it drives or observes, so the information survives the export without
    inventing hardware. Ports are **not** virtual (they became `J1`).
- **Chrome wiring (`chrome/dialogs.js`, `chrome/toolbar.js`, `app.js`):** the
  File menu gains **Export…** (`onExport`), disabled like Generate C while
  `state.simulating` or `state.vectorPanelOpen` (FR-119). `app.js` handles it:
  `exportFormatDialog()` (dialogs.js — a modal with a format `<select>`
  listing `NDL netlist (.ndl)` only, OK/Cancel) → `flatten(store.design,
  loadDesign, { rootPath: savePath })` (§6.14; refusal posts to the tray and
  aborts) → `generateNDL(flat, { name: designName })` → `openFileDialog` in
  save mode (`.ndl` extension, seeded at `dirOf(savePath)`, default
  `<base>.ndl`) → `saveTextFile` (`POST /api/v1/file/save`, §6.4). Warnings
  post to the message tray (FR-074).
- **Tests (`web/js/engine/ndl.test.js`):** a small hand-built flat design (two
  ICs incl. a subunit pair and `physical:` blocks, a port, a clock, wires
  giving multi-pin nets) asserting: pinout lines incl. power/NC and active-low
  rename; invented-number warning for a numberless type; package grouping and
  subunit stem collapse; connector pinout and reference rewrite; power rail
  wiring; driver-first star statements; virtual-builtin comments;
  determinism (two runs byte-identical).

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
| `mem` | `MemSpec?` | generated memory device only (FR-114c/FR-114f): `{kind:"ram"\|"rom", addressBits, dataWidth, locations, romFile?}`. Serializable data the client's built-in memory behavior binds from at Run (FR-114d); round-trips through the `mem:` YAML block (§7.6) so a persisted device simulates on reload. Absent on all other types |
| `physical` | `PhysicalSpec?` | optional exporter-only package metadata (FR-062e): `{package?, pincount, power[], nc?}` — see §7.6. Carried verbatim (like `mem`), parser-validated for physical completeness, and copied into saves per FR-057 so exporters can work from the design JSON alone. Read by no editor or simulator code |

Built-in types additionally have a **behavior** (FR-067a): a client-JS function
held in a registry in `builtins.js` keyed by type `id` (FR-066e) — deliberately **not** a
`ComponentType` field, because `typeData` is deep-copied into instances and
saved as JSON (FR-057), which would drop or corrupt a function value. The
simulator resolves a behavior from the registry by `inst.type` (the type id) at run time; its
signature is specified in the simulator design pass.

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
  "formatVersion": 2,                  // migration anchor (NFR-004-style); v2 re-keyed instance `type` to the type id (FR-066e)
  "name": "unnamed schematic 2026-06-01 14:03",
  "defaultRender": "ic",               // FR-096: render style when THIS design is embedded (ic|connector)
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
| `typeData` | `ComponentType` | full copy at save time (FR-057) |
| `overrides` | object | per-instance field overrides, grouped by kind: `{"delays":{"tpd":12},"props":{"period":200}}` — `delays` shadows `typeData.delays` (FR-058), `props` shadows `typeData.properties` defaults (FR-020b) |
| `switchState` | string? | input-switch built-in only (FR-071c): current state, `"0"` \| `"1"` (default `"0"`; a legacy `"U"` reads as `0`). Per-instance interactive state, not an `overrides` entry; set via the properties panel (FR-020c) or a click during a run (FR-087a) |
| `kind` | string? | `"subdesign"` for a sub-design instance (FR-098); absent/`"component"` for an ordinary, subunit, or built-in instance (§6.14) |
| `childPath` | string? | sub-design only: child design file path. **On disk relative to the parent's save dir** (FR-098); **absolute in memory** after load (absolutized by `fileops.loadIntoStore`, relativized by `fileops.save`). Resolved on load to derive the interface; no `typeData` is stored (supersedes FR-057 for sub-designs) |
| `render` | string? | sub-design only: chosen embed rendering `"ic"` \| `"connector"` (FR-099) |
| `label` | string? | port / portN built-ins (FR-094/FR-071e): interface signal name; same-label 1-wide ports share a net (FR-094a) |
| `portDir` | string? | port / portN built-ins: `"in"` \| `"out"` \| `"bidir"` — **derived** from wiring (FR-094c); the **effective** direction (override applied, FR-094d) is written at save, not hand-set (portN aggregates across its bits) |
| `dirOverride` | string? | port / portN built-ins: optional `"in"` \| `"out"` direction **override** (FR-094d), meaningful only when the derived direction (FR-094c) is `bidir`; absent otherwise. Set via the properties panel (`SetPortProps`); round-trips with the instance |
| `width` | int? | **portN built-in only**: chosen bit width 2–16, fixed at placement (FR-071e). A 1-wide port has no width — it is always one bit (FR-094) |
| `target` | object? | off-sheet connector only (FR-101): `{ "file": <relative path>, "label": <port label in that file> }`; its presence makes the port navigable (FR-100) and cross-file-joined (FR-101a) |

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

### 7.4 Persistence & migration (FR-060c)
Files are JSON written atomically (§6.5). `formatVersion` is the migration anchor;
the client writes/reads version `2` (FR-066e re-keyed instance `type` to the type
id). The **vertex/graph model (§7.1a) is the
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
(NFR-004 spirit). On load the SPA also runs a cheap structural sanity pass (every
conductor path has ≥ 2 points; every `node` path point and every `pin` vertex
references something that exists) and rejects the file with a legible error
instead of failing later deep in render/hit-test — the server validates only that
the payload is JSON.

### 7.5 In-memory client structures
The live model mirrors §7.2 but additionally keeps `nextWireId` and
`nextVertexId` counters and a transient `selection`/`viewport` (not persisted).
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
| `behavior` | no | `behavior` | literal block scalar; verbatim (FR-066); evaluated by the slow simulator (FR-079) |
| `clock` | iff `.R` | `clock` | names the global clock input pin for `.R` registered outputs (FR-062d); must exist with `dir: in`. E.g. `clock: CP` in 74574.yaml. A `.R` output that gives its own `.CLK` (extended, FR-079a) needs no global `clock:` |
| `internal` | no | `internal` | optional list of buried registered-node names (FR-079c), e.g. `internal: [SR0, SR1, SR2, SR3, SR4, SR5, SR6]` for the 74HC165. Each must be a legal name, unique, and distinct from every pin name; each must be defined by exactly one `.R` equation in `behavior` (checked at Run). A buried node is read/written in the behavior block but drives no pin |
| `gal` | no | `gal` | optional GAL device name selecting **strict** dialect (FR-066a): one of `GAL16V8`/`GAL20V8`/`GAL22V10`/`GAL20RA10`. Omit ⇒ **extended** dialect (default; FR-079a). Server validates the name only |
| `partnumber` | iff `gal` | `partnumber` | GAL parts only (FR-066b): non-empty free-form **display name** (FR-005b), e.g. `"PC-DECODE-A"`; not a key and need not be unique (the library key is `id`). Absent on 74-series types |
| `description` | no | `description` | optional one-line function summary (FR-104); presentation-only. For a GAL part it is authored in the New GAL part dialog (FR-066c) since the part has no datasheet of its own |
| `datasheet` | no | `datasheet` | optional mapping `{vendor, title, rev, url}` (FR-104) |
| `pins[].desc` | no | `Pin.desc` | optional pin role text (FR-104) |
| `mem` | no | `mem` | generated memory device only (FR-114f): mapping `{kind: ram\|rom, addressBits, dataWidth, locations, romFile?}` driving the built-in memory behavior (FR-114d). Carried through verbatim; the client binds the behavior from it on load. `romFile` is the absolute content-file path (ROM only, FR-114e) |
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
mem: { kind: ram, addressBits: 8, dataWidth: 8, locations: 256 }   # romFile: "<abs path>" for a ROM
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
{ "formatVersion": 2,
  "inputs":  [ { "refdes": "A-1", "pin": "OUT", "label": "A" },
               { "refdes": "A-2", "pin": "OUT", "label": "B" } ],
  "outputs": [ { "refdes": "A-5", "pin": "IN",  "label": "Sum" },
               { "refdes": "A-6", "pin": "IN",  "label": "Cout" } ],
  "rows": [ { "in": ["0","0"], "out": ["L","L"] },
            { "in": ["1","0"], "out": ["H","L"] },
            { "in": ["1","1"], "out": ["L","H"] } ] }
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
- **Cell symbols:** input cells `"0"`/`"1"` (an input switch only ever drives 0 or
  1, FR-071c); a **clock column** (FR-115e — a clocked design's clock generator,
  identified by the clock's own `(refdes, "OUT")`) additionally allows `"C"` (apply
  one full positive pulse); output cells `"H"` (expect 1), `"L"` (expect 0), `"X"`
  (don't-test). Which input columns are clock columns is re-derived from the design
  on open (`kind:"clock"` is live-only, never stored).
- **Reconciliation on load:** the file's `inputs`/`outputs` are matched against
  `deriveColumns(design)` (§6.16) by `(refdes,pin)`; a mismatch (a file column the
  design lacks, or a design column the file lacks) is a **warning**, not a load
  failure (FR-115a) — the editor opens with the design's current columns, carrying
  over the file rows that still align.
- **Versioning:** `formatVersion` + a `migrate()` chain mirror the design format
  (§7.4/FR-060c). v1 is the initial, combinational-only version; **v2** (current)
  marks the sequential `C` input symbol (FR-115e) — the shape is unchanged, so the
  v1→v2 migration is the identity and every v1 file is a valid v2 file. Run
  **results** (pass/fail, actuals) are presentational and are **not** stored here
  (FR-115d).

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
| Sub-design embedding & off-sheet connectors (FR-094–FR-103) | (a) embed a copy of the child like FR-057; (b) two separate primitives (a port object and a distinct connector object); (c) compute multi-sheet/hierarchical nets in the editor at edit time | **One `port` built-in (a new `connector` vertex kind) serving both roles; a sub-design instance is a live relative-path reference whose interface is resolved to a synthetic in-memory `ComponentType`; flatten + cross-file label-union composed only at Run** | The synthetic type lets the whole pin/vertex/wire/netlist/render pipeline serve hierarchy unchanged — only render style, navigation, and flatten are new; a live reference keeps one source of truth (no stale copy, supersedes FR-057 here); the junction-identity decision already reserved a single `connector` vertex kind for this; composing cross-file nets only at Run keeps single-sheet editing fast and local (NFR-005); render style is deliberately cosmetic so simulation semantics never depend on a symbol toggle (stakeholder-confirmed) |

---

## 9. File and Directory Plan

```
sim/
  cmd/retrosim/
    main.go                 CREATE  entry point: flags, bind 127.0.0.1, wire deps (§6.1)
  cmd/dumplib/
    main.go                 CREATE  dump parsed library as JSON for offline tooling (refresh-types)
  server/
    api.go                  CREATE  /api/v1 router + handlers + static (§6.4)
    components.go           CREATE  library load/hold/List (§6.2)
    yamlparse.go            CREATE  ParseComponent: YAML → ComponentType (§6.3, §7.6)
    storage.go              CREATE  ListDir/LoadDesign/SaveDesign (§6.5)
    paths.go                CREATE  AppDataDir per-OS (§6.5)
    types.go                CREATE  ComponentType/Pin/PinGroup/Design/Vertex/Wire/Bus/PathPoint Go structs (§7)
  web/
    index.html              CREATE  SPA shell + <canvas> + module entry
    css/style.css           CREATE  layout for toolbar/palette/canvas/dialogs
    js/app.js               CREATE  bootstrap (§6.12)
    js/api.js               CREATE  REST client (§6.12)
    js/store.js             CREATE  store + commands + undo/redo (§6.10)
    js/builtins.js          CREATE  client-side built-in object registry (§6.11, FR-067/FR-068)
    js/connection.js        CREATE  server heartbeat + reconnect (§6.12a)
    js/backup.js            CREATE  localStorage snapshot + recovery (§6.12a)
    js/geometry.js          CREATE  grid/viewport/rotation math (§6.7)
    js/model/design.js      CREATE  design ops (§6.6)
    js/model/clipboard.js   CREATE  copy/paste fragment extract + instantiate (§6.15)
    js/model/netlist.js     CREATE  buildNets union-find (§6.6)
    js/model/subdesign.js   CREATE  interface resolution, synthetic type, flatten/cycle (§6.14)
    js/engine/canvas.js     CREATE  renderer + render loop (§6.8)
    js/engine/symbols.js    CREATE  schematic symbol geometry (§6.8a)
    js/engine/interaction.js CREATE tool FSM + event handling (§6.9)
    js/engine/hittest.js    CREATE  hit-testing (§6.9)
    js/engine/router.js     CREATE  Manhattan route proposal (§6.9a)
    js/engine/galasm.js     CREATE  GALasm behavior compiler/evaluator (§6.13)
    js/engine/sim.js        CREATE  slow simulator engine + scheduler (§6.13)
    js/engine/cgen.js       CREATE  fast-engine C code generator (§6.17)
    js/engine/ndl.js        CREATE  NDL netlist exporter (§6.18)
    cgen/runtime.h          CREATE  fast-engine C runtime API, documented (§6.17)
    cgen/runtime.c          CREATE  fast-engine C runtime implementation (§6.17)
    tools/tv2txt.js         CREATE  .tv → generated-program stdin rows (§6.17 M2)
    tools/parity.js         CREATE  fast-vs-slow FR-107 parity harness (§6.17 M2)
    tools/refresh-types.js  CREATE  batch FR-088 refresh for saved designs (uses cmd/dumplib)
    js/chrome/toolbar.js    CREATE  toolbar (§6.11)
    js/chrome/palette.js    CREATE  palette tiles (§6.11)
    js/chrome/dialogs.js    CREATE  save/open dialogs (§6.11)
    js/chrome/properties.js CREATE  per-instance overrides panel (§6.11)
    js/chrome/contextmenu.js CREATE right-click menu (§6.11)
    js/chrome/statusbar.js  CREATE  bottom status bar trays (§6.11)
  components/
    74138.yaml              CREATE  (user-authored sample; §7.6)
    74165.yaml              CREATE  8-bit PISO shift register; buried nodes (FR-079c, §6.13)
    74xxx.yaml              CREATE  (additional user-authored samples)
  specs/
    design.md               (this document)
```

No files are modified (greenfield).

---

## 10. Requirement Traceability

| Requirement | Design Section | Files |
|---|---|---|
| FR-001 | §6.1, §6.4, §5 | `main.go`, `api.go` |
| FR-002 | §6.2 | `components.go`, `yamlparse.go` |
| FR-003 | §6.4, §6.11, §6.12 | `api.go`, `palette.js`, `app.js` |
| FR-004 | §6.12 | `app.js`, `store.js` |
| FR-005, FR-005a, FR-006 | §6.2, §6.11 | `components.go`, `app.js` |
| FR-006a | §6.11 | `app.js`, `style.css`, `builtins.js` |
| FR-007 | §6.2 | `components.go` |
| FR-008, FR-009, FR-010 | §6.9, §6.11 | `interaction.js`, `palette.js`, `store.js` |
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
| FR-041, FR-041a, FR-041b | §6.9, §6.11, A3 | `interaction.js`, `dialogs.js` |
| FR-042, FR-043 | §6.9, §7.2 | `interaction.js`, `model/design.js` |
| FR-043a, FR-043b | §6.6, §6.9, §7.1a | `interaction.js`, `model/design.js`, `commands.js`, `model/netlist.js` |
| FR-044, FR-045 | §6.10, §6.12 | `store.js`, `app.js` |
| FR-046, FR-047, FR-047a, FR-048, FR-049 | §6.5, §6.10, §6.11 | `storage.go`, `dialogs.js`, `fileops.js`, `store.js` |
| FR-049a | §6.10, §6.11 | `store.js`, `dialogs.js` |
| FR-050, FR-051 | §6.5, §6.11 | `paths.go`, `storage.go`, `dialogs.js` |
| FR-052, FR-053, FR-054 | §6.4, §6.5, §6.11 | `api.go`, `storage.go`, `dialogs.js` |
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
| FR-114e | §6.4, §6.13 | `engine/memory.js`, `sim.js`, `api.js`, `storage.go`, `api.go`, `dialogs.js` |
| FR-114f, FR-007a | §6.4, §6.11, §7.6 | `dialogs.js` (`memDeviceYaml`), `app.js`, `api.js`, `components.go`, `yamlparse.go`, `types.go` |
| FR-115, FR-115a–h | §6.13, §6.16, §7.7 | `engine/vectors.js`, `engine/sim.js`, `chrome/dialogs.js`, `chrome/toolbar.js`, `chrome/properties.js`, `store.js`, `app.js`, `index.html`, `style.css` |
| FR-106–FR-110, FR-116, FR-116a, FR-117, FR-118 | §6.17 | `engine/cgen.js`, `web/cgen/runtime.h`, `web/cgen/runtime.c`, `chrome/toolbar.js`, `app.js` |
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
| FR-087b | §6.9, §6.10, §6.11, §6.13 | `interaction.js`, `store.js`, `builtins.js`, `sim.js` |
| FR-088 | §6.6, §6.10, §6.11 | `model/design.js`, `commands.js`, `toolbar.js` |
| FR-094, FR-094a, FR-095 | §6.14, §7.1a, §7.2 | `subdesign.js`, `builtins.js`, `model/design.js`, `model/netlist.js` |
| FR-096 | §6.14, §7.2 | `model/design.js`, `dialogs.js` |
| FR-097, FR-097a, FR-097b | §6.9, §6.11, §6.14 | `interaction.js`, `dialogs.js`, `subdesign.js` |
| FR-098, FR-098a, FR-099, FR-099a, FR-099b | §6.6, §6.8, §6.14, §7.2 | `subdesign.js`, `model/design.js`, `canvas.js` |
| FR-100, FR-100a | §6.9, §6.11, §6.12, §6.14 | `interaction.js`, `app.js`, `dialogs.js` |
| FR-101, FR-101a | §6.6, §6.14 | `subdesign.js`, `model/netlist.js` |
| FR-102, FR-102a, FR-103 | §6.13, §6.14 | `sim.js`, `subdesign.js` |
| FR-060b | §6.14, §7.1a, §7.2 | `types.go`, `model/design.js` |
| FR-060c | §7.2, §7.4 | `model/persist.js`, `chrome/fileops.js` |
| FR-104 | §6.3, §7.1, §7.6 | `yamlparse.go`, `types.go`, `srv/components/*.yaml` |
| FR-105 | §6.11, §7.1 | `properties.js`, `style.css` |
| FR-111, FR-112, FR-113 | §6.15, §6.9, §6.10, §6.11 | `clipboard.js`, `interaction.js`, `commands.js`, `canvas.js`, `toolbar.js` |
| NFR-001 | §6.1 | `main.go` |
| NFR-002 | §6.12 | `api.js` |
| NFR-003 | all | server `*.go`, `web/js/*` |
| NFR-004 | §6.4, §7.4 | `api.go`, `types.go` |
| NFR-005 | §6.8, §6.9 | `canvas.js`, `interaction.js` |
| NFR-006 | §6.10 | `store.js` |
| IR-001 | §6.4, §6.12 | `api.go`, `api.js` |
| IR-002 | — | (none; no external integrations) |

All requirements are covered. MVP-deferrable items (FR-020a, FR-049a, and the bus
snap FR-041–043) are fully designed so they are additive when implemented.

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
  fails midway; `ListDir` returns only `.json`+dirs with a correct `parent`;
  load of malformed JSON → 422 (FR-046–FR-053, FR-055).
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
  into `design.name`/`designName` (FR-047a), and clears `dirty`.
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
- **JS `cgen` (§6.17, FR-116a/FR-117):** `generateC` structure tests under
  `node:test` — emitted text contains the expected net table, column tables,
  labels, and lowered expressions for small designs; refusal cases (sub-design
  instance, off-sheet connector, behavior parse error, `.R` without `clock:`).
  The C **runtime** is natively testable standalone (ops/resolver truth tables
  mirroring the JS `sim` cases above). The **parity harness** (M2) generates,
  compiles (`cc`), and runs corpus design+`.tv` pairs, diffing the stdout
  transcript against `runVectors` (§6.16) — the FR-107 check; it is run
  explicitly, not as part of the compiler-free unit-test sweep (location TBD,
  §12).

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
- Bus width matched by a pin group whose member-pin count equals the width (A3);
  width tie (≥2 matching groups) → disambiguation dialog, not a silent pick
  (FR-041b).
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

Implementation of the **core editor and server can begin now**; these items gate
only the noted slices.

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
  041b); it is no longer an open question. Bus snap, breakout, and bus bit-names
  (FR-037b/043a) are MVP-deferrable but fully designed (A7) and the save format
  accommodates them now (FR-060a).
- **OQ-007 / A1 — Junction representation.** Resolved to a **graph of first-class
  `Vertex` objects shared by id** (§7.1a), chosen with the stakeholder in light of
  the planned off-sheet **connector tool** (and possible edge-connector
  components), which are future `Vertex` kinds the model absorbs uniformly. A
  branched wire keeps one record (`path[]` with an interior junction node).
  Confirm this satisfies the downstream-tool netlist needs before a later phase
  consumes it. *(Note: the connector tool implies a future multi-**sheet**
  container, which this single-canvas phase does not provide; that is orthogonal
  to the topology model and tracked as future scope.)*
- **OQ-004 / A5 — Grid spacing & default zoom.** Defaults chosen (8 px/unit,
  0.25×–4.0×). Confirm or adjust the constants.
- **U1 — NFR-005 threshold & target design size.** Proposed ≤16 ms at 200
  components / 600 segments. Confirm the numbers (or supply real target sizes).
- **OQ-003 — File navigation vs recent-files.** Design includes server-assisted
  navigation with a ready `localStorage` recent-files fallback (FR-054). Decide at
  implementation which ships first; both are designed.
- **OQ-008 — Pin-direction set — RESOLVED.** Final set is `{in,out,bidir,
  tristate}`. Power and ground are not represented anywhere (file, editor, or
  simulation), so no `pwr`/`power` direction is needed; the four directions map
  cleanly to the future four-level model.
- **OQ-011 — Text selection inside a note while editing (FR-071f) — RESOLVED.**
  Adopted the **DOM `<textarea>` overlay**: editing a note hides the canvas note
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

None of the above prevent starting the server skeleton, the canvas engine, the
store/undo pipeline, or the chrome. Only the YAML **parser body** and the **bus
snap** slice should wait on their respective confirmations.
```
