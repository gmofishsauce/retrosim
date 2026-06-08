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
- **FR-005** — One palette tile per loaded component type, showing the type name
  (e.g., `74138`).
- **FR-006** — Palette is a flat, unordered list of tiles (no grouping).
- **FR-007** — Library loaded once at startup; no live reload of YAML files.

**Component Placement**
- **FR-008** — Place by dragging a tile from the palette onto the canvas.
- **FR-009** — Place by clicking a tile, then clicking a canvas point.
- **FR-010** — Placement is **one-shot**: after placing, return to select mode.
- **FR-011** — On placement assign a unique reference designator `U1, U2, …`,
  incremented from the highest existing designator in the design.
- **FR-012** — Each instance displays its refdes (e.g., `U3`) and type name
  (e.g., `74138`) as canvas labels, **always rendered upright** regardless of
  rotation.

**Component Appearance**
- **FR-013** — Each component is a rectangular outline with a small connection
  bubble (circle) just outside the body at each pin and pin name labels on the
  rectangle's sides. The bubble is tangent to the outline edge and anchored on the
  pin's grid point (that grid point stays the connection coordinate). It is sized
  so adjacent pins (1 grid unit apart) never overlap and so the whole bubble lies
  within the pin hit tolerance, and is the wire-connection target (click anywhere
  within it to start/end a wire).
- **FR-014** — Pin side (left/right/top/bottom) and position come from the YAML
  file; the editor never infers or rearranges pins.
- **FR-015** — Pin name labels always render upright regardless of rotation.

**Component Selection and Movement**
- **FR-016** — In select mode, click a component to select it.
- **FR-017** — Drag a selected component to a new position; it snaps to grid.
- **FR-018** — When a component moves, wire/bus segments connected to its pins
  **stretch** to follow (may cross other components; user re-routes later).
- **FR-018a** — In select mode, delete a selected component. Wires/buses
  connected to it remain, with formerly-connected endpoints left **dangling**
  (see FR-029, FR-030).

**Component Rotation**
- **FR-019** — Rotate a selected component 90° CW or CCW.
- **FR-020** — Rotation repositions pin bubbles; all text labels stay upright.

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
- **FR-027** — Click source pin, then destination pin → a straight (rat's-nest)
  line between them.
- **FR-028** — After placing a wire, return to select mode.
- **FR-029** — A wire/bus with exactly one connected endpoint is permitted.
- **FR-030** — A wire/bus with no connected endpoints is auto-removed.

**Wire Routing (Bend Points)**
- **FR-031** — In select mode, click any point on a wire segment → insert a bend
  point at the nearest grid intersection, splitting the segment in two.
- **FR-032** — Drag a bend point to any grid intersection (mouse held down); the
  two adjoining segments rubber-band continuously.
- **FR-033** — Right-click a bend point → "Delete bend point"; the two adjoining
  segments merge into one straight segment.
- **FR-033a** — In select mode, delete an entire wire or bus.

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
- **FR-048** — Subsequent saves overwrite without prompting.
- **FR-049** — Save As at any time, to a new name.
- **FR-049a** — Indicate unsaved changes; warn before discarding them (New/Open).
- **FR-050** — Server stores designs in the platform-standard application data
  directory by default.
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
  remaining wires is **deleted**. The FR-030 sweep (a wire all of whose endpoint
  vertices are `free` is removed) then runs. There is no coordinate copying or
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
- Out of scope: multi-select, copy/paste, the simulation engine, the transpiler,
  and **electrical-rule checking** (e.g., output-to-output conflicts, direction
  validation). Pin `direction` is captured (FR-062a) so ERC can be added later
  without a model change; the bus disambiguation dialog (FR-041b) does **not**
  filter candidates by direction this phase (D2).
- Target browsers: modern desktop **Chrome/Firefox**. No mobile support.

### 4.2 Assumptions
- The repository is already a Go module (`github.com/gmofishsauce/wut4`); the
  server lives under `sim/` as new packages. (Greenfield: no existing sim code.)
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
│   ├─ GET  /files        ─▶ storage.go (list directory)                                     │
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

### 6.1 Go: `main` (package `main`, `sim/cmd/wut4-editor/main.go`)
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
    name. Loaded **once** (FR-007).
  - `(*Library) List() []ComponentType` — stable, deterministic order (sorted by
    type name) for the palette.
- **Behavior:** for each file, call `ParseComponent`. Duplicate type names →
  last-wins with a logged warning. The library is immutable after load.
- **Error handling:** a single file's parse error does **not** abort startup; the
  bad file is skipped and logged (file + line + reason). `LoadLibrary` returns an
  error only on an unreadable directory.
- **Dependencies:** `yamlparse.go`.

### 6.3 Go: YAML parser (`sim/server/yamlparse.go`)
- **Purpose:** convert one YAML file's bytes (YAML — §7.6) into a `ComponentType`.
- **Satisfies:** FR-061, FR-062, FR-062a, FR-062b, FR-062c, FR-063, FR-064, FR-066.
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
  then build and validate the `ComponentType`. The parser validates: `type`
  present (a non-empty string); every pin has a valid `side` ∈
  {left,right,top,bottom}, integer `pos ≥ 0`, `dir` ∈ {in,out,bidir,tristate};
  every pin-group member names an existing pin. Power and ground pins
  are **not represented** — there is no `pwr`/`power` direction and such pins are
  simply omitted from the file (and thus from the symbol and the simulation).
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
- **Error handling:** return an `error` with file + human-readable reason (and
  YAML line where `yaml.v3` supplies one) on any decode or validation failure; the
  loader logs and skips (§6.2). Never panic.
- **Dependencies:** `gopkg.in/yaml.v3`; otherwise std lib.

### 6.4 Go: HTTP API (`sim/server/api.go`)
- **Purpose:** route and handle all REST endpoints; serve static SPA.
- **Satisfies:** FR-001, FR-003, FR-046–FR-053, FR-065, NFR-004, IR-001.
- **Versioning (NFR-004):** all API routes are under `/api/v1/`. New capabilities
  (e.g., a future transpiler) get new paths or a new version prefix; existing
  routes never change shape.
- **Endpoints:**

  | Method & Path | Request | Success Response | Errors |
  |---|---|---|---|
  | `GET /api/v1/components` | – | `{"components":[ComponentType,…]}` | 500 on internal error |
  | `GET /api/v1/defaults` | – | `{"dataDir":"<abs path>"}` | – |
  | `GET /api/v1/files?path=<p>` | query `path` (abs; empty = data dir) | `{"path","parent","entries":[{"name","isDir"}]}` | 400 bad path, 404 missing, 403 not a dir |
  | `GET /api/v1/design/load?path=<p>` | query `path` | `{"design":Design}` | 400, 404, 422 malformed JSON |
  | `POST /api/v1/design/save` | `{"path":"<abs>","design":Design}` | `{"path":"<abs>"}` | 400 bad body, 409/500 write failure |

  Directory entries: only `.json` files and subdirectories are returned for
  navigation; the response includes `parent` so the dialog can offer "up".
- **Behavior:** decode JSON, delegate to `storage.go`/`components.go`, encode
  JSON. All responses `Content-Type: application/json`. Static handler serves
  `web/` for any non-`/api/` path; unknown SPA routes fall back to `index.html`.
  Static responses carry `Cache-Control: no-store` so a plain browser reload
  always picks up edited SPA assets (localhost-only authoring tool served from the
  source tree — no hard-refresh / DevTools cache toggle needed).
- **Error handling:** consistent error envelope `{"error":"<message>"}` with the
  HTTP status above. No stack traces leak to the client; full detail is logged
  server-side.
- **Dependencies:** `storage.go`, `components.go`, `paths.go`.

### 6.5 Go: storage & paths (`sim/server/storage.go`, `sim/server/paths.go`)
- **Purpose:** filesystem I/O for designs; resolve the platform data dir.
- **Satisfies:** FR-050, FR-051, FR-052, FR-053, FR-055, OQ-006.
- **Interface:**
  - `ListDir(path string) (DirListing, error)` — entries + parent (FR-053).
  - `LoadDesign(path string) (Design, error)` — read+unmarshal (FR-052, FR-055).
  - `SaveDesign(path string, d Design) error` — marshal (indented) + atomic write
    (write temp file in same dir, `fsync`, `rename`) to avoid truncating an
    existing design on failure (FR-046–FR-049).
  - `AppDataDir() (string, error)` — platform data dir, creating it if absent
    (FR-050, OQ-006): macOS `~/Library/Application Support/wut4-editor`,
    Linux `$XDG_DATA_HOME` or `~/.local/share/wut4-editor`, Windows `%APPDATA%\wut4-editor`.
    Implemented over `os.UserConfigDir`/`os.UserHomeDir` with per-GOOS handling.
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
  - `addInstance(design, type, x, y, rotation) → instance` — assigns refdes
    `U<n>` where `n = 1 + max(existing numeric suffixes)` (FR-011); the
    numeric-suffix scan ignores any trailing unit letter so `U5A` counts as 5.
  - `addSubunitPackage(design, type, x, y) → instance[]` (FR-013a/FR-011) —
    allocates **one** U-number and creates `type.numUnits` sibling instances
    `U<n>A`, `U<n>B`, … Each sibling gets a per-unit `typeData` holding only that
    unit's pins (in list order) plus `renderAs`/`unit`, and `width`/`height` from
    the symbol footprint (§6.8a). The units are offset (stacked vertically by
    footprint height + 1) so they do not overlap on drop.
  - `pinWorldPos(instance, pinName) → {x,y}` — applies rotation (§6.7). For
    subunit instances the unrotated pin offset comes from the symbol module
    (§6.8a) keyed by `renderAs`, input count, pin role, and slot index (the pin's
    order among same-role pins of its unit); for `unit` instances it comes from
    `side`/`position` as before. A `pin`
    vertex's position is **derived** from this; when the instance moves or rotates
    its pin vertices are recomputed, so wires referencing them **stretch
    automatically** (FR-018) with no per-segment fix-up.
  - `addVertex`/`removeVertex`, `addWire/addBus`, `insertBend`, `moveBend`,
    `deleteBend`, `branchWire` (creates or reuses a `junction` vertex; if the
    branch point lands on an interior `bend` path-point, that point flips to a
    `node` referencing the new vertex), `breakoutBit` (FR-043a: create a
    `junction` vertex on a bus with `bit` set to the chosen lane, and start a
    single-bit wire from it), `deleteWire` (decrements junction-vertex ref counts,
    demoting to `free`/deleting per §3.3 G2; prunes all-`free` wires per FR-030),
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
      assert width(B1)==width(B2)               # guaranteed by FR-039a at edit time
      for i in 0..w-1:                          union(lane(B1,i), lane(B2,i))

  # 4. breakout (FR-043a): wire taps one bus bit via junction vertex with V.bit set
  for each junction vertex V with V.bit == b shared by bus B and wire W:
      union(lane(W), lane(B, b))

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
  coordinates — satisfying FR-059a/FR-060a. (Future connector rule: union lanes of
  `connector` vertices sharing a label.)
- **Error handling:** operations validate references (e.g., moving a bend index
  that exists); invalid ops throw and are caught by the Store, which leaves state
  unchanged and surfaces a non-fatal toast.
- **Dependencies:** none (pure JS).

### 6.7 JS: geometry & rotation (`web/js/geometry.js`)
- **Purpose:** grid snapping, viewport transforms, rotation math.
- **Satisfies:** FR-012, FR-015, FR-017, FR-020, FR-021.
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
  NFR-005.
- **Interface:** `init(canvasEl, store)`, `setViewport({pan, zoom})`,
  `requestRender()`. Renders on a `requestAnimationFrame` loop **only when dirty**
  (a render is requested), to meet NFR-005 without busy-spinning.
- **Draw order:** grid → buses (thick blue, width annotation `/n` at midpoint,
  FR-036/FR-037) → wires (thin black) → junction dots → components (outline, pin
  bubbles, pin labels) → upright text labels → selection highlight → tool preview
  (rubber-band line, placement ghost).
- **Component drawing dispatches on `renderType`:** a `unit` instance draws the
  rectangle path as today; a `subunit` instance draws its schematic symbol via the
  symbol module (§6.8a) — the gate/mux outline path plus an upright refdes (e.g.
  `U5A`). The grid-point/stub rule is common to both paths (FR-013/FR-013b). A
  `unit` instance draws the FR-013 connection bubble at each `pinWorldPos`. A
  `subunit` instance draws no resting bubble (FR-013c); instead, when that
  subunit is hovered (`state.hover`) or selected, the common path draws a short
  tick as an outward lead along the pin axis from the pin's grid point. In
  both paths an inverting output's bubble is owned by the symbol
  (`pinHasOwnBubble`, §6.8a), so the common path draws neither a bubble nor a tick
  there. For subunit symbols the common path anchors each pin's
  upright name label to the body outline (`pinLabelEdge`, §6.8a) rather than the
  pin point, so stubs never bisect labels.
- **Grid (FR-021):** draw grid dots/lines only when `scale` is large enough that
  spacing ≥ a threshold (e.g., 6 px); otherwise draw a coarser grid to avoid
  moiré and cost.
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
    OR-family input stubs (connection marks — unit bubbles or subunit hover/select
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
- **Satisfies:** FR-008–FR-010, FR-016–FR-019, FR-026–FR-034, FR-038–FR-043a,
  FR-039a.
- **Tools / states:** `SELECT` (default, FR-004), `PLACE(type)` (transient, set by
  palette click), `WIRE`, `BUS`. The FSM also has transient sub-states for
  in-progress gestures (e.g., `WIRE_AWAIT_DEST`, `DRAGGING_BEND`,
  `DRAGGING_COMPONENT`, `DRAGGING_BUS_ENDPOINT`).

  | State | Event | Action → Command | Next state |
  |---|---|---|---|
  | SELECT | click component | select it | SELECT |
  | SELECT | drag component | `MoveComponent` (snap, stretch connected segs FR-018) | SELECT |
  | SELECT | press Delete on selection | `DeleteComponent`/`DeleteWire` (FR-018a/FR-033a) | SELECT |
  | SELECT | click wire/bus segment | `InsertBend` at nearest grid pt (FR-031) | DRAGGING_BEND |
  | SELECT | drag bend point | `MoveBend` (rubber-band FR-032) | DRAGGING_BEND |
  | SELECT | right-click bend | context menu → `DeleteBend` (FR-033) | SELECT |
  | SELECT | right-click bus | context menu → `SetBusWidth` (FR-038) | SELECT |
  | PLACE(t) | click canvas | `PlaceComponent(t,@grid)` (FR-009) | SELECT (one-shot FR-010) |
  | (palette) | drag tile→canvas drop | `PlaceComponent(t,@grid)` (FR-008) | SELECT |
  | WIRE | click pin | begin wire at pin | WIRE_AWAIT_DEST |
  | WIRE | click existing segment | begin **branch**: create/reuse a `junction` vertex at the nearest grid pt, splitting that point of the host path into a `node` (FR-034) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | click pin/segment | `AddWire(a,b)` (FR-027, FR-034a/b) | SELECT (FR-028) |
  | BUS | (same as WIRE) | `AddBus(...)` | SELECT (FR-040, A6) |
  | BUS | drag endpoint onto component | snap-connect (FR-041–043, §below) | SELECT |
  | BUS | drag endpoint onto another bus | join if equal width; else **reject** (FR-039a) | SELECT |
  | WIRE | click a bus segment | **breakout**: prompt/derive bit index, create `junction` vertex with `bit` set, begin 1-bit wire (FR-043a) | WIRE_AWAIT_DEST |

- **Hit-testing (`hittest.js`):** in world space — components are rectangles
  (their rotated bounding outline); pins are points (tolerance ≈ ½ grid);
  wire/bus segments use point-to-segment distance (tolerance ≈ ⅓ grid scaled);
  bend points and `junction`/`free` vertices are points. Pins take priority over
  segments take priority over component bodies when overlapping.
- **Wire-mode cursor (FR-025):** while `WIRE`/`BUS` active, set a crosshair
  cursor and show a status hint; `SELECT` uses the default pointer.
- **Bus snap-connect (FR-041–FR-043a, A3/A7):** on dropping a bus endpoint over a
  component, compute the candidate pin groups whose **member pin count == bus
  width**, then branch on the candidate count:
  - **0 candidates** → leave the endpoint **unconnected** (FR-043).
  - **1 candidate** → snap-connect automatically: store a `groupConnection`
    mapping bit *i* → `group.pins[i]` (FR-041a/FR-042). If the bus has no
    `bitNames`, adopt the group's member pin names (FR-037b).
  - **≥2 candidates** → open the **disambiguation dialog** (§6.11), list groups by
    name; on choose, snap as above; on cancel, leave the endpoint unconnected
    (FR-041b).
- **Breakout (FR-043a):** in WIRE mode, clicking a **bus** segment creates a
  `junction` vertex on that bus with `bit` = the chosen lane (defaulting to the
  bus's nearest bit; if the bus has `bitNames`, a small picker offers them) and
  starts a single-bit wire from it. The lane union in §6.6 routes the wire into
  exactly that bit's net.
- **Width-mismatch guard (FR-039a):** a gesture that would join two buses of
  unequal width is rejected at drop time with a non-fatal toast; no command is
  dispatched. *Snap-connect, breakout, and bit-names may be deferred from the MVP
  per requirements; the model and save format support them regardless (A7).*
- **Error handling:** clicks on empty space in WIRE/BUS state are ignored (no
  partial wire). A gesture that would create a zero-endpoint wire is discarded
  (FR-030). Pressing `Esc` cancels an in-progress gesture, restoring SELECT.
- **Dependencies:** `geometry.js`, `hittest.js`, store, model.

### 6.10 JS: store, commands, undo/redo (`web/js/store.js`)
- **Purpose:** single source of truth and the only mutation path; undo/redo;
  dirty tracking; pub/sub.
- **Satisfies:** FR-024, FR-049a, NFR-006.
- **State:** `{ design, tool, selection, hover, viewport, dirty, savePath, designName }`.
  `hover` is the refdes of the component currently under the cursor (or `null`),
  used only to show subunit connection ticks (FR-013c). It is transient UI state:
  set directly by the interaction layer with a plain renderer re-render, never
  through the command/undo path, and not persisted.
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
  `DeleteBend`, `DeleteWire`, `SetBusWidth`, `BranchWire`. Each captures enough
  pre-state to `revert` exactly (e.g., `MoveComponent` stores the old position;
  `DeleteComponent` stores the removed instance plus any vertex conversions/
  demotions and pruned wires it caused, so undo restores connectivity exactly).
- **Dirty/unsaved (FR-049a):** `dirty` set on every dispatch, cleared on
  successful save. New/Open guard on `dirty` (confirm dialog); a `beforeunload`
  handler warns on tab close. *(MVP-deferrable per requirements; implement the
  flag now, wire the warnings when convenient.)*
- **Dependencies:** model.

### 6.11 JS: chrome widgets (`web/js/chrome/*.js`)
- **Toolbar (`toolbar.js`)** — Satisfies FR-026, FR-035, FR-022, FR-023, FR-024,
  FR-044, FR-046, FR-049, FR-052. Buttons: Select, Wire, Bus, Zoom +/−, Pan
  (or pan via left-drag on empty canvas, space-drag, or middle-drag — FR-023a),
  Undo, Redo, New, Open, Save, Save As. The
  active tool is highlighted; clicking a tool sets `store.tool`.
- **Palette (`palette.js`)** — Satisfies FR-003, FR-005, FR-006, FR-008, FR-009.
  Renders one tile per `ComponentType` (flat, sorted). A tile is `draggable`
  (HTML5 DnD → drop on canvas, FR-008) and click-selectable (sets `PLACE(type)`,
  FR-009). Disabled/overlaid until the library load resolves (FR-003).
- **Dialogs (`dialogs.js`)** — Satisfies FR-046–FR-049, FR-052–FR-054. Modal DOM
  dialogs:
  - *Save* — on first save (no `savePath`) prompt with name prefilled to the
    design name (FR-047); the dialog uses `/api/v1/files` to navigate directories
    and choose a location (FR-051); subsequent saves skip the prompt (FR-048).
  - *Open* — server-assisted directory navigation via `/api/v1/files` (FR-052/
    FR-053). **Fallback (FR-054):** if navigation is judged impractical, render a
    recent-files list persisted in `localStorage`. Keep the recent-files code
    ready behind the same dialog.
  - *Bus group disambiguation (FR-041b)* — opened by snap-connect when **≥2** pin
    groups match the bus width. Lists the candidate groups by name (e.g., `A`,
    `B`, `Y` for a 16-bit ALU bus); the user picks one or cancels. Resolves a
    promise the interaction FSM awaits before dispatching `snapBusGroup`. Does
    **not** filter by pin direction (electrical-rule checking is out of scope this
    phase — see §4.1, OQ-008/D2).
- **Properties panel (`properties.js`)** — Satisfies FR-020a. A docked right-edge
  panel showing the selected instance's copied type data (refdes, type, size, pin
  count) read-only, plus one numeric field per `delays` entry for per-instance
  propagation-delay overrides. Editing dispatches `setOverride` (model + command,
  §6.9/§6.10); entering the type default or pressing the reset button clears the
  override. Overrides live in `inst.overrides.delays` (§7.2) and persist via the
  full-instance save (FR-058). The panel re-renders on every store notification,
  which is why selection now flows through `store.setSelection` (notifying).
- **Context menu (`contextmenu.js`)** — Satisfies FR-033, FR-033b, FR-038, FR-037b,
  FR-033a, FR-018a. Right-click hit-tests the cursor (bend → wire → bus → component
  priority) and surfaces the matching actions: "Delete bend point" (on a bend);
  "Delete wire" (on a wire); "Set width…", "Edit bit names…", and "Delete bus" (on
  a bus); "Delete component" (on a component). Dismissed by choosing an item,
  Escape, or an outside click. `interaction.js` builds the item list and dispatches
  the commands; `contextmenu.js` only renders and positions the menu. Width and
  bit-name entry use small modal prompts in `dialogs.js`.
- **Dependencies:** store, api, geometry.

### 6.12 JS: API client & bootstrap (`web/js/api.js`, `web/js/app.js`)
- **Purpose:** typed-ish wrappers over `fetch`; app startup.
- **Satisfies:** FR-003, FR-004, IR-001, NFR-002.
- **`api.js`:** `getComponents()`, `getDefaults()`, `listDir(path)`,
  `loadDesign(path)`, `saveDesign(path, design)`. All target same-origin
  `/api/v1/*` (localhost only — no external requests, NFR-002). Each rejects with
  the server error envelope on non-2xx.
- **`app.js`:** create the store with an empty design named
  `unnamed schematic <localDateTime>` in SELECT mode (FR-004, FR-045); fetch
  components + defaults (await both, FR-003); build palette, toolbar, canvas,
  interaction; remove the loading overlay.
- **Error handling:** if `getComponents()` fails, show a blocking error banner
  ("server unreachable — is wut4-editor running?") and keep the canvas disabled.

---

## 7. Data Model

### 7.1 `ComponentType` (server in-memory + `/components` JSON + copied into saves)

| Field | Type | Notes |
|---|---|---|
| `name` | string | unique type name, e.g. `"74138"` (FR-062) |
| `renderType` | enum | `unit` (default) \| `subunit` (FR-062c) |
| `numUnits` | int | subunit packages only: number of functional units (FR-062c); 0/omitted for `unit` |
| `renderAs` | string | subunit packages only: schematic symbol — `nand`\|`and`\|`or`\|`nor`\|`xor`\|`xnor`\|`not`\|`mux2`\|`mux4`\|`mux8` (FR-013b) |
| `width` | int | `unit` only: outline width in grid units (>0); **resolved** value (stated as `outline:`, or derived from pins — §6.3). Unused for `subunit` (symbol geometry owns size — §6.8a) |
| `height` | int | `unit` only: outline height in grid units (>0); resolved value. Unused for `subunit` |
| `pins` | `Pin[]` | FR-062, FR-062a |
| `pinGroups` | `PinGroup[]` | optional (FR-063) |
| `delays` | `map[string]number` | optional propagation delays, ns (FR-064) |
| `behavior` | string | opaque GALasm text, preserved & ignored (FR-066) |

Note: for `unit` components `width`/`height` are always **concrete in the parsed
`ComponentType`** — resolution happens at parse time (§6.3) so the canvas, the
save format, and FR-057's full-copy all keep consuming explicit geometry. For
`subunit` components the rectangle is not drawn; each unit's footprint and pin
positions come from the schematic-symbol geometry module (§6.8a), so `outline:`
and per-pin `pos` are ignored. There is no package field: physical packages were
removed in favor of an explicit `outline:` or a pin-derived default (see §8).

**`Pin`**

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"A0"`, `"/Y3"` |
| `side` | enum | `left` \| `right` \| `top` \| `bottom` (FR-014) |
| `position` | int | `unit` only: grid units along the side from its origin (top for L/R, left for T/B). Ignored for `subunit` |
| `unit` | string? | `subunit` only: the functional unit this pin belongs to (a letter, `A`, `B`, …); replaces `position` (FR-014a). List order within a unit sets slot order |
| `direction` | enum | `in` \| `out` \| `bidir` \| `tristate` (FR-062a) |
| `number` | int? | optional physical pin number (e.g., DIP pin 7); author-stated (FR-062b); footprint/BOM metadata only, used by neither drawing nor simulation |

Every pin carries exactly one bit; a parallel bus is modeled as a `PinGroup` of
single-bit pins (FR-063), not as a multi-bit pin.

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
| `kind` | enum | `pin` \| `junction` \| `free` (future: `connector`) |
| `ref` | string? | `kind=pin` only: instance refdes, e.g. `"U3"` |
| `pin` | string? | `kind=pin` only: pin name, e.g. `"Y0"` |
| `bit` | int? | `kind=junction` on a **bus** only: the bit-lane this junction taps (FR-043a breakout). Absent/`null` = full join of all lanes (bus↔bus, FR-039a) |

**Position authority differs by kind (deliberate):**
- `kind=pin` → `x,y` is **derived** from `pinWorldPos(instance, pin)` and
  recomputed when the instance moves/rotates. This is why connected wires stretch
  for free (FR-018) — they reference the pin vertex, which follows the instance.
- `kind=junction` / `kind=free` → `x,y` is **authoritative** (user-placed/dragged).

A junction vertex's grid position lives **only** here, so the host wire and every
branch wire that meet at it share one position and cannot drift apart (A1).

### 7.2 `Design` (JSON save file — FR-055/FR-056)

```jsonc
{
  "formatVersion": 1,                  // migration anchor (NFR-004-style)
  "name": "unnamed schematic 2026-06-01 14:03",
  "components": [ ComponentInstance, … ],   // (a) FR-056
  "wires":      [ Wire, … ],                // (b) FR-056
  "buses":      [ Bus,  … ],                // (c) FR-056
  "vertices":   [ Vertex, … ],              // electrical nodes referenced by wires/buses (§7.1a)
  "nets":       [ Net,  … ]                 // derived convenience (A4, FR-059a)
}
```

**`ComponentInstance`** (FR-057, FR-058)

| Field | Type | Notes |
|---|---|---|
| `refdes` | string | `"U3"` — unique id within the design; used by wire endpoints |
| `type` | string | type name |
| `x`, `y` | int | grid coordinates of unrotated origin (FR-021) |
| `rotation` | int | `0`\|`90`\|`180`\|`270` |
| `typeData` | `ComponentType` | full copy at save time (FR-057) |
| `overrides` | object | per-instance field overrides, e.g. `{"delays":{"tpd":12}}` (FR-058) |

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
Bit *i* of the bus ↔ `bitMap[i]` (FR-042). Breakout taps are **not** group
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
  (FR-027/039), creating their endpoint vertices (`pin`/`free`); bends by clicking
  segments (FR-031); junction vertices by branching (FR-034).
- **Read:** the renderer reads the live model each frame; Save serializes it.
- **Update:** moves/rotations recompute affected `pin` vertices, so connected
  wires **stretch automatically** (FR-018); overrides/bend-drags/width changes,
  all via Commands. Dragging a junction vertex moves the one shared node, so all
  wires meeting there follow (FR-032, no drift).
- **Delete:** components (FR-018a — their `pin` vertices convert to `free`); wires/
  buses (FR-033a — junction-vertex ref counts decremented, demoting to `free` or
  deleting per §3.3 G2); bends (FR-033). The FR-030 sweep (remove any wire whose
  endpoint vertices are all `free`) runs after any deletion.

### 7.4 Persistence & migration
Files are JSON written atomically (§6.5). `formatVersion` enables future
migration; this phase only writes/reads version `1`. Because nothing has shipped,
the **vertex/graph model (§7.1a) is the version-`1` format from the outset — there
is no runtime migration to write.** For the record, the conceptual map from the
earlier endpoint-union sketch is: old `pin` endpoint → a `pin` vertex; old `free`
→ a `free` vertex; old `junction{target,x,y}` → a `junction` vertex at `(x,y)`
inserted as a `node` path-point in the target wire's `path`, with the branch
wire's endpoint referencing it. Loading a file with an unknown `formatVersion` →
server returns it as-is and the SPA warns if it is newer than it understands
(forward-compat per NFR-004 spirit).

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
type: "74138"            # REQUIRED string. Quote it: bare 74138 is a YAML integer.
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

behavior: |              # opaque GALasm, captured verbatim & ignored this phase (FR-066)
  /Y0 = /(/E1 * /E2 * E3 * /A2 * /A1 * /A0)
  /Y1 = /(/E1 * /E2 * E3 * /A2 * /A1 *  A0)
  ; GALasm's own ';' starts a comment inside this block
```

A **subunit** package (FR-062c) omits `outline`/`pos` and instead names the symbol
and the unit each pin belongs to; list order within a unit sets slot order:

```yaml
# 7400 — quad 2-input NAND
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

**Field reference** (maps 1:1 onto §7.1):

| Key | Required | Maps to | Notes |
|---|---|---|---|
| `type` | yes | `ComponentType.name` | quote if all-digits (`"74138"`) |
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
| `behavior` | no | `behavior` | literal block scalar; verbatim & ignored (FR-066) |

**Why a YAML literal block for `behavior`.** Under `|` every line is literal text
with newlines preserved and **no escaping**, so GALasm operators (`/ * + = ( )`)
pass through untouched — exactly what FR-066's "capture verbatim" needs, and the
lowest-ceremony way to hand-type equations. Two gotchas the author must know:
(1) `#` inside the block is literal text, not a YAML comment — use GALasm's `;`
for comments there; (2) the block's indentation is stripped, so indent the whole
block consistently.

**Authoring gotchas (hand- or AI-written).** Quote any all-digit scalar (`type:
"74138"`); single-letter names such as `N`/`Y` stay strings under the 1.2 core
schema (`yaml.v3`) and need no quoting; unknown top-level keys are ignored, not
errors (FR-066), so future sections (e.g., richer timing) are additive.

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
| Component outline source | Declared physical `package:` resolved by a parser registry/parametric generator to outline + pin numbers (earlier design) | **Explicit `outline: [w, h]` else a pin-derived default box; no package mechanism at all** | Stakeholder removed packages: power/ground (the only reason the physical package mattered for the symbol) do not exist in file/editor/sim, and outlines are better derived from author-placed pins (FR-014). Eliminates `packages.go`, the package-name grammar, and the `pincount`/generator entirely; physical pin `number`s, if used, are author-stated optional metadata. Supersedes the package-registry decision (was FR-062b) |
| Subunit package model (FR-013a) | One instance owning a `subunits[]` array of positions; teach wires/netlist/hittest/persistence about sub-identities | **N sibling instances sharing a U-number (refdes `U5A`…), one per unit** | Each gate is independently placeable/movable/rotatable like any instance, so wiring, netlist (`U5A.1Y`), hit-test, and persistence work unchanged; the "package" is just a shared U-number + grouped drop/delete (FR-018b). Symbol geometry lives in one module (§6.8a) consumed by model/renderer/hittest so they cannot drift |
| Coordinate system | Store pixels; store mm | **Store integer grid units; derive pixels via viewport** | Everything snaps to grid by construction (FR-021); zoom/pan are pure view transforms; rotation by 90° preserves grid (§6.7) |
| Rotation pivot | Rotate about component center | **Rotate pin offsets about the instance origin** | Guarantees rotated pins stay on integer grid intersections (FR-021) without half-grid artifacts |
| File I/O location | Browser native file picker / downloads | **All FS access server-side via REST** | FR-053 requires server-assisted navigation; keeps a single trusted FS actor; localhost-only (NFR-001) |
| Server framework | gin/echo/chi | **net/http standard library** | Tiny API surface; no dependency; matches the project's minimalist Go style |
| API versioning | Unversioned routes | **`/api/v1/` prefix** | New endpoints (future transpiler) added without breaking clients (NFR-004) |

---

## 9. File and Directory Plan

```
sim/
  cmd/wut4-editor/
    main.go                 CREATE  entry point: flags, bind 127.0.0.1, wire deps (§6.1)
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
    js/geometry.js          CREATE  grid/viewport/rotation math (§6.7)
    js/model/design.js      CREATE  design ops (§6.6)
    js/model/netlist.js     CREATE  buildNets union-find (§6.6)
    js/engine/canvas.js     CREATE  renderer + render loop (§6.8)
    js/engine/symbols.js    CREATE  schematic symbol geometry (§6.8a)
    js/engine/interaction.js CREATE tool FSM + event handling (§6.9)
    js/engine/hittest.js    CREATE  hit-testing (§6.9)
    js/chrome/toolbar.js    CREATE  toolbar (§6.11)
    js/chrome/palette.js    CREATE  palette tiles (§6.11)
    js/chrome/dialogs.js    CREATE  save/open dialogs (§6.11)
    js/chrome/properties.js CREATE  per-instance overrides panel (§6.11)
    js/chrome/contextmenu.js CREATE right-click menu (§6.11)
  components/
    74138.yaml              CREATE  (user-authored sample; §7.6)
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
| FR-005, FR-006 | §6.2, §6.11 | `components.go`, `palette.js` |
| FR-007 | §6.2 | `components.go` |
| FR-008, FR-009, FR-010 | §6.9, §6.11 | `interaction.js`, `palette.js`, `store.js` |
| FR-011 | §6.6 | `model/design.js` |
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
| FR-021 | §6.7, §6.8 | `geometry.js`, `canvas.js` |
| FR-022, FR-023 | §6.8, §6.11 | `canvas.js`, `toolbar.js` |
| FR-024 | §6.10 | `store.js` |
| FR-025, FR-026 | §6.9, §6.11 | `interaction.js`, `toolbar.js` |
| FR-027, FR-028 | §6.9, §6.10 | `interaction.js`, `store.js` |
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
| FR-043a | §6.6, §6.9, §7.1a | `interaction.js`, `model/design.js`, `model/netlist.js` |
| FR-044, FR-045 | §6.10, §6.12 | `store.js`, `app.js` |
| FR-046, FR-047, FR-048, FR-049 | §6.5, §6.11 | `storage.go`, `dialogs.js` |
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
- **Go `storage`:** atomic save does not corrupt an existing file when the write
  fails midway; `ListDir` returns only `.json`+dirs with a correct `parent`;
  load of malformed JSON → 422 (FR-046–FR-053, FR-055).
- **Go `paths`:** `AppDataDir` returns the correct path per `GOOS` (OQ-006).
- **JS `geometry`:** rotation table maps integer offsets to integer offsets for
  all four angles; round-trip world↔screen; snap-to-grid (FR-021, FR-020).
- **JS `netlist.buildNets`:** see edge cases below (FR-034b/FR-059a/FR-037a). A
  width-8 bus snapped to an 8-pin group yields **8** nets, one per bit, with
  correct `provenance` (FR-037a/FR-060a); a breakout wire joins exactly its bit's
  net (FR-043a); two equal-width buses joined at a no-`bit` junction align lanes by
  index (FR-039a).
- **JS `store`:** every command's `apply`∘`revert` restores prior state; undo
  stack honors `UNDO_CAP ≥ 50` (NFR-006); redo cleared on new dispatch.

### 11.2 Integration / end-to-end (Chrome + Firefox, manual or Playwright)
- Startup blocks canvas until palette loads (FR-003); empty design named
  `unnamed schematic <datetime>` in select mode (FR-004).
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
  §7.6.
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

None of the above prevent starting the server skeleton, the canvas engine, the
store/undo pipeline, or the chrome. Only the YAML **parser body** and the **bus
snap** slice should wait on their respective confirmations.
```
