# Design: TTL Circuit Design Editor (Visual Editor + Local Server)

> Audience: a developer implementing this phase with no access to the
> requirements interview or to the architect. This document is self-contained.
> It restates the requirements, so `requirements.md` is not required reading
> (though it remains the authoritative source if a conflict is found).

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
- **FR-002** — On startup the server loads all component-definition (MD) files
  from a configured component-library directory.
- **FR-003** — The SPA fetches the component library at startup and populates the
  palette *before* allowing canvas interaction.
- **FR-004** — App opens in **select-tool** mode with an empty, unsaved design
  named `unnamed schematic <datetime>` (local date/time).

**Component Palette**
- **FR-005** — One palette tile per loaded component type, showing the type name
  (e.g., `74138`).
- **FR-006** — Palette is a flat, unordered list of tiles (no grouping).
- **FR-007** — Library loaded once at startup; no live reload of MD files.

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
- **FR-013** — Each component is a rectangular outline with pin stubs and pin
  name labels on the rectangle's sides.
- **FR-014** — Pin side (left/right/top/bottom) and position come from the MD
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
- **FR-020** — Rotation repositions pin stubs; all text labels stay upright.

**Per-Instance Type Overrides**
- **FR-020a** — View a selected instance's type data and override specific values
  (e.g., propagation delay) for that instance only. Overrides do not affect other
  instances or the MD file; persisted per FR-058.

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
- **FR-038** — Right-click a bus to set its width.
- **FR-039** — Bus drawing/bending/branching follow the wire interaction model
  (FR-026…FR-034).
- **FR-040** — After placing a bus, return to select mode.

**Bus-to-Component Snap Connection**
- **FR-041** — Dragging a bus endpoint onto a component checks the component's MD
  file for a pin group matching the bus width.
- **FR-042** — If a matching group exists, auto-connect each bit to the
  corresponding pin in declared order (no per-pin wiring).
- **FR-043** — If no matching group exists, attach the endpoint to the nearest pin
  only; remaining bits unconnected.

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
  rotation, and a **full copy** of the type's MD data at save time.
- **FR-058** — Per-instance overrides stored alongside the copied type data.
- **FR-059** — Each wire record includes two endpoint references plus an ordered
  list of bend-point grid coordinates. An endpoint is one of: (a) a component pin
  (U-number + pin name), (b) a junction on another wire/bus, or (c) a free grid
  coordinate (dangling).
- **FR-059a** — Saved design represents electrical connectivity (the nets) in a
  form derivable without pixel geometry.
- **FR-060** — Each bus record includes the same endpoint/bend data as a wire,
  plus bus width (bits) and pin-group connection data for snap-connected ends.

**Component Definition (MD File)**
- **FR-061** — Each TTL type is defined by an MD file; the format is to be
  designed collaboratively, then parsed by the server.
- **FR-062** — The MD file specifies: type name, outline dimensions, and per pin:
  name, side, and position along that side.
- **FR-062a** — The MD file specifies each pin's electrical direction (at least:
  input, output, bidirectional, tristate-capable).
- **FR-063** — The MD file may declare named pin groups (ordered pins forming a
  bus) for snap-connection (FR-041…FR-043).
- **FR-064** — The MD file may specify propagation-delay values.
- **FR-065** — Server exposes the parsed library to the SPA via an API endpoint.
- **FR-066** — The MD format is designed so behavioral logic (GALasm) can be added
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
  geometry to determine connectivity. **Resolution:** a junction endpoint stores
  the **id of the target wire/bus** plus a grid coordinate. Net membership is
  computed purely from ids (pin↔wire and wire↔wire unions via union-find — §6.6),
  never by computing geometric intersections. The coordinate is rendering-only.

- **A2 — Fan-out vs. two-endpoint wires (FR-034a vs FR-059).** A wire has exactly
  two endpoints, yet a pin may carry several wires and wires may branch.
  **Resolution (interpretation):** fan-out is achieved by **multiple distinct
  wires sharing a pin endpoint**, and by **junction endpoints** (one wire's
  endpoint referencing another wire). No wire ever has more than two endpoints.
  This is consistent with FR-059; stated here to remove doubt.

- **A3 — "Matching pin group" for bus snap (FR-041).** Matching is by *width*;
  the requirement is silent on ties (multiple groups of the same width) and on
  whether group "width" is the **pin count** or the **sum of member pin bit-
  widths**. **Resolution:** group width = **sum of member pin bit-widths**
  (equals pin count when all members are 1-bit, the common case). On a tie,
  choose the **first group in MD declaration order**. See §6.9; confirm in §12.

- **A4 — Net storage vs derivation (FR-059a).** "Derivable" does not say whether
  to *store* nets. **Resolution:** the save file **includes** a `nets` array
  computed at save time as a convenience for downstream tools, but it is
  **regenerated on every save** and treated as derived/non-authoritative; the
  wires/buses/instances remain the source of truth.

- **A5 — Grid spacing & default zoom (OQ-004).** **Resolution:** one grid unit =
  a "~2 mm" cell; the default viewport renders **8 device pixels per grid unit**;
  zoom range **0.25×–4.0×**. These are constants (`GRID_MM`, `PX_PER_UNIT_DEFAULT`,
  `ZOOM_MIN`, `ZOOM_MAX`) in one module so they are trivially tunable.

- **A6 — Bus-tool one-shot (OQ-005).** Assumed **yes**: the Bus tool returns to
  select mode after placing one bus, mirroring the Wire tool (FR-040 confirms).

### 3.2 Contradictions

- **C1 — None material.** NFR-002 ("no external network requests") vs IR-001
  ("HTTP over localhost") is only apparent: "external" means the public internet;
  localhost API traffic is intended and allowed. Stated for the record.

### 3.3 Gaps

- **G1 — Concrete MD file syntax is undefined (OQ-001, FR-061).** By your
  instruction this is deferred to a later collaborative session. This design
  pins down the **in-memory `ComponentType` model and the parser contract**
  (§7.1) so all other work proceeds; a **non-binding strawman syntax** is offered
  in §7.6 for discussion. **This is an open item (see §12).**

- **G2 — Delete of a wire/bus that leaves another wire's junction dangling.**
  FR-033a deletes a wire; FR-034b says wires can reference it via a junction.
  **Resolution:** when a wire/bus is deleted, any *other* wire endpoint that was a
  `junction` referencing it is converted to a **`free`** endpoint at the same grid
  coordinate (becoming dangling, per FR-029), and the FR-030 zero-endpoint sweep
  then runs. Implied by FR-018a/FR-029/FR-030; made explicit here.

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
- Out of scope: multi-select, copy/paste, the simulation engine, the transpiler.
- Target browsers: modern desktop **Chrome/Firefox**. No mobile support.

### 4.2 Assumptions
- The repository is already a Go module (`github.com/gmofishsauce/wut4`); the
  server lives under `sim/` as new packages. (Greenfield: no existing sim code.)
- The user authors valid MD files; the parser reports errors but need not repair
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
│   ├─ GET  /components   ─▶ components.go  ─▶ mdparse.go  (load library at startup)         │
│   ├─ GET  /files        ─▶ storage.go (list directory)                                     │
│   ├─ GET  /design/load  ─▶ storage.go (read JSON)                                          │
│   ├─ POST /design/save  ─▶ storage.go (write JSON)                                         │
│   └─ GET  /defaults     ─▶ paths.go    (platform app-data dir)                             │
│  static file handler  ─▶ web/ (index.html + js/ + css/)                                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Control & data flow
1. **Startup:** server parses every MD file in the component dir into
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
  - `--components-dir` (default: `./components`) — MD library directory.
  - `--data-dir` (default: platform app-data dir from `paths.go`) — designs root.
  - `--web-dir` (default: `./web`) — static SPA assets.
- **Behavior:** load library (§6.2) → if zero components, log a warning but
  continue → construct `http.Server` with the router (§6.4) → `ListenAndServe`.
- **Error handling:** invalid/non-loopback `--addr` → exit non-zero with message.
  Missing `--components-dir` → warn, serve an empty palette. Port in use → exit
  non-zero. MD parse errors → see §6.3 (server still starts).
- **Dependencies:** `components.go`, `api.go`, `paths.go`, std `net/http`, `flag`.

### 6.2 Go: component library loader (`sim/server/components.go`)
- **Purpose:** load and hold the parsed component library; expose it as JSON.
- **Satisfies:** FR-002, FR-005, FR-007, FR-065.
- **Types:** see §7.1 (`ComponentType`, `Pin`, `PinGroup`).
- **Interface:**
  - `LoadLibrary(dir string) (*Library, error)` — read every `*.md` in `dir`
    (non-recursive), parse each (§6.3), collect into a `Library` keyed by type
    name. Loaded **once** (FR-007).
  - `(*Library) List() []ComponentType` — stable, deterministic order (sorted by
    type name) for the palette.
- **Behavior:** for each file, call `ParseComponent`. Duplicate type names →
  last-wins with a logged warning. The library is immutable after load.
- **Error handling:** a single file's parse error does **not** abort startup; the
  bad file is skipped and logged (file + line + reason). `LoadLibrary` returns an
  error only on an unreadable directory.
- **Dependencies:** `mdparse.go`.

### 6.3 Go: MD parser (`sim/server/mdparse.go`)
- **Purpose:** convert one MD file's bytes into a `ComponentType`.
- **Satisfies:** FR-061, FR-062, FR-062a, FR-063, FR-064, FR-066.
- **Interface (the deferral boundary — stable even though syntax is TBD):**
  - `ParseComponent(path string) (ComponentType, error)`
  - The returned `ComponentType` MUST be fully populated for the fields in §7.1.
  - Any **behavioral / GALasm** content MUST be captured verbatim into
    `ComponentType.Behavior` (a single string) and otherwise ignored (FR-066).
  - Unknown sections/keys MUST be ignored (not error) so future additions don't
    break the parser (FR-066).
- **Behavior:** to be specified in the MD-format session. A strawman is in §7.6.
  The parser validates: type name present; outline dims > 0; every pin has a
  valid `side` ∈ {left,right,top,bottom}, integer `position ≥ 0`, `direction`
  ∈ {in,out,bidir,tristate}, `width ≥ 1`; every pin-group member names an
  existing pin.
- **Error handling:** return an `error` with file + line + human-readable reason
  on any validation failure; the loader logs and skips (§6.2). Never panic.
- **Dependencies:** none beyond std lib.

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
- **Satisfies:** FR-011, FR-018, FR-030, FR-034a, FR-034b, FR-056–FR-060, FR-059a.
- **Data:** the `Design` object (§7.2) and pure helper functions. Mutations are
  performed **only** by Command objects (§6.10), but the low-level operations live
  here so they are unit-testable in isolation:
  - `addInstance(design, type, x, y, rotation) → instance` — assigns refdes
    `U<n>` where `n = 1 + max(existing numeric suffixes)` (FR-011).
  - `pinWorldPos(instance, pinName) → {x,y}` — applies rotation (§6.7).
  - `addWire/addBus`, `insertBend`, `moveBend`, `deleteBend`, `deleteWire`,
    `deleteInstance` (re-targets junctions per §3.3 G2, prunes zero-endpoint
    wires per FR-030), `setBusWidth`, `setOverride`.
- **Netlist (`netlist.js`) — `buildNets(design) → Net[]` (FR-034b/FR-059a):**
  ```
  uf = UnionFind()                       # nodes: "pin:U3.Y0", "wire:w12", "bus:b3"
  for each wire/bus W:
      add node "wire:W.id"
      for endpoint E in (W.a, W.b):
          if E.kind == "pin":      union("pin:"+E.ref+"."+E.pin, "wire:W.id")
          if E.kind == "junction": union("wire:W.id", "wire:"+E.target)   # ids only
          if E.kind == "free":     (no union — dangling)
  groups = connected components of uf
  nets = [ {pins:[…], members:[wire/bus ids…]} for each group containing ≥1 pin ]
  ```
  This uses **ids only** — never pixel coordinates — satisfying FR-059a.
- **Error handling:** operations validate references (e.g., moving a bend index
  that exists); invalid ops throw and are caught by the Store, which leaves state
  unchanged and surfaces a non-fatal toast.
- **Dependencies:** none (pure JS).

### 6.7 JS: geometry & rotation (`web/js/geometry.js`)
- **Purpose:** grid snapping, viewport transforms, rotation math.
- **Satisfies:** FR-012, FR-015, FR-017, FR-020, FR-021.
- **Rotation (grid-preserving):** an instance has origin `(x,y)` (its unrotated
  top-left, on the grid) and `rotation ∈ {0,90,180,270}`. A pin's unrotated
  offset `(dx,dy)` (integers, from the MD layout) maps to a rotated offset:
  ```
    0:   ( dx,  dy)      90:  (-dy,  dx)
    180: (-dx, -dy)      270: ( dy, -dx)
  ```
  `pinWorld = (x,y) + rotatedOffset`. Because offsets are integers and 90° turns
  map integers→integers, **pins always land on grid intersections** (FR-021).
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
  stubs, pin labels) → upright text labels → selection highlight → tool preview
  (rubber-band line, placement ghost).
- **Grid (FR-021):** draw grid dots/lines only when `scale` is large enough that
  spacing ≥ a threshold (e.g., 6 px); otherwise draw a coarser grid to avoid
  moiré and cost.
- **Error handling:** rendering is read-only over the model; a malformed instance
  (e.g., unknown type) is drawn as a red placeholder box with the type name, never
  throwing out of the loop.
- **Dependencies:** `geometry.js`, model (read-only), store (subscribe).

### 6.9 JS: interaction / tool FSM (`web/js/engine/interaction.js`, `hittest.js`)
- **Purpose:** translate pointer/keyboard events into Commands; hit-testing.
- **Satisfies:** FR-008–FR-010, FR-016–FR-019, FR-026–FR-034, FR-038–FR-043.
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
  | WIRE | click existing segment | begin **branch** (junction endpoint, FR-034) | WIRE_AWAIT_DEST |
  | WIRE_AWAIT_DEST | click pin/segment | `AddWire(a,b)` (FR-027, FR-034a/b) | SELECT (FR-028) |
  | BUS | (same as WIRE) | `AddBus(...)` | SELECT (FR-040, A6) |
  | BUS | drag endpoint onto component | snap-connect (FR-041–043, §below) | SELECT |

- **Hit-testing (`hittest.js`):** in world space — components are rectangles
  (their rotated bounding outline); pins are points (tolerance ≈ ½ grid);
  wire/bus segments use point-to-segment distance (tolerance ≈ ⅓ grid scaled);
  bend points are points. Pins take priority over segments take priority over
  component bodies when overlapping.
- **Wire-mode cursor (FR-025):** while `WIRE`/`BUS` active, set a crosshair
  cursor and show a status hint; `SELECT` uses the default pointer.
- **Bus snap-connect (FR-041–FR-043, A3):** on dropping a bus endpoint over a
  component, compute the component's pin groups whose **summed member bit-width ==
  bus width**; pick the first in MD order (A3). If found, create a `Bus` whose
  endpoint is a group connection mapping bit *i* → group.pins[i] in order
  (FR-042); store as `groupConnection` (§7.2). If none, attach the endpoint to the
  **nearest pin** only (FR-043). *This feature may be deferred from the MVP per
  the requirements; if deferred, the bus simply attaches to the nearest pin.*
- **Error handling:** clicks on empty space in WIRE/BUS state are ignored (no
  partial wire). A gesture that would create a zero-endpoint wire is discarded
  (FR-030). Pressing `Esc` cancels an in-progress gesture, restoring SELECT.
- **Dependencies:** `geometry.js`, `hittest.js`, store, model.

### 6.10 JS: store, commands, undo/redo (`web/js/store.js`)
- **Purpose:** single source of truth and the only mutation path; undo/redo;
  dirty tracking; pub/sub.
- **Satisfies:** FR-024, FR-049a, NFR-006.
- **State:** `{ design, tool, selection, viewport, dirty, savePath, designName }`.
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
  `DeleteComponent` stores the removed instance and any junction-retargeting it
  caused, so undo restores connectivity).
- **Dirty/unsaved (FR-049a):** `dirty` set on every dispatch, cleared on
  successful save. New/Open guard on `dirty` (confirm dialog); a `beforeunload`
  handler warns on tab close. *(MVP-deferrable per requirements; implement the
  flag now, wire the warnings when convenient.)*
- **Dependencies:** model.

### 6.11 JS: chrome widgets (`web/js/chrome/*.js`)
- **Toolbar (`toolbar.js`)** — Satisfies FR-026, FR-035, FR-022, FR-023, FR-024,
  FR-044, FR-046, FR-049, FR-052. Buttons: Select, Wire, Bus, Zoom +/−, Pan
  (or pan via space-drag/middle-drag), Undo, Redo, New, Open, Save, Save As. The
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
- **Properties panel (`properties.js`)** — Satisfies FR-020a. Shows the selected
  instance's copied type data; editable fields (e.g., propagation delay) dispatch
  `SetOverride`. *(MVP-deferrable; the data model and `SetOverride` command exist
  regardless so the panel is purely additive — see §7.2 `overrides`.)*
- **Context menu (`contextmenu.js`)** — Satisfies FR-033, FR-038. Right-click
  surfaces "Delete bend point" (on a bend) and "Set bus width…" (on a bus).
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
| `width` | int | outline width in grid units (>0) |
| `height` | int | outline height in grid units (>0) |
| `pins` | `Pin[]` | FR-062, FR-062a |
| `pinGroups` | `PinGroup[]` | optional (FR-063) |
| `delays` | `map[string]number` | optional propagation delays, ns (FR-064) |
| `behavior` | string | opaque GALasm text, preserved & ignored (FR-066) |

**`Pin`**

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"A0"`, `"/Y3"` |
| `side` | enum | `left` \| `right` \| `top` \| `bottom` (FR-014) |
| `position` | int | grid units along the side from its origin (top for L/R, left for T/B) |
| `direction` | enum | `in` \| `out` \| `bidir` \| `tristate` (FR-062a) |
| `width` | int | bit-width, default `1` |

**`PinGroup`**

| Field | Type | Notes |
|---|---|---|
| `name` | string | e.g. `"A"`, `"DATA"` |
| `pins` | string[] | ordered member pin names (bit order) (FR-063) |

Group bit-width = Σ member `pin.width` (A3). Used for bus snap (FR-041).

### 7.2 `Design` (JSON save file — FR-055/FR-056)

```jsonc
{
  "formatVersion": 1,                  // migration anchor (NFR-004-style)
  "name": "unnamed schematic 2026-06-01 14:03",
  "components": [ ComponentInstance, … ],   // (a) FR-056
  "wires":      [ Wire, … ],                // (b) FR-056
  "buses":      [ Bus,  … ],                // (c) FR-056
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

**`Endpoint`** (FR-059, A1, A2) — exactly one `kind`:

```jsonc
{ "kind": "pin",      "ref": "U3", "pin": "Y0" }          // component pin
{ "kind": "junction", "target": "w12", "x": 40, "y": 16 } // on wire/bus id; x,y render-only
{ "kind": "free",     "x": 40, "y": 24 }                  // dangling (FR-029)
```

**`Wire`** (FR-059)

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable, e.g. `"w12"` (junction targets reference it) |
| `a`, `b` | `Endpoint` | exactly two (A2) |
| `bends` | `{x,y}[]` | ordered grid coordinates (FR-059) |

**`Bus`** (FR-060) — a `Wire` plus:

| Field | Type | Notes |
|---|---|---|
| `width` | int | bus width in bits (FR-037, FR-038) |
| `groupConnections` | `GroupConnection[]` | snap-connect metadata (FR-042/FR-060) |

`GroupConnection`: `{ "endpoint": "a"|"b", "instance": "U3", "group": "A",
"bitMap": ["A0","A1","A2"] }`.

**`Net`** (derived, A4/FR-059a): `{ "pins": ["U3.Y0","U5.A1", …],
"members": ["w12","b3", …] }`.

### 7.3 Data lifecycle (CRUD)
- **Create:** instances by placement (FR-008/009/011); wires/buses by the
  Wire/Bus tools (FR-027/039); bends by clicking segments (FR-031).
- **Read:** the renderer reads the live model each frame; Save serializes it.
- **Update:** moves/rotations/overrides/bend-drags/width changes, all via Commands.
- **Delete:** components (FR-018a, retargets junctions to `free` per G2), wires/
  buses (FR-033a), bends (FR-033). The zero-endpoint sweep (FR-030) runs after any
  deletion.

### 7.4 Persistence & migration
Files are JSON written atomically (§6.5). `formatVersion` enables future
migration; this phase only writes/reads version `1`. Loading a file with an
unknown `formatVersion` → server returns it as-is and the SPA shows a warning if
it is newer than it understands (forward-compat per NFR-004 spirit).

### 7.5 In-memory client structures
The live model mirrors §7.2 but additionally keeps a `nextWireId` counter and a
transient `selection`/`viewport` (not persisted). `nets` are recomputed by
`buildNets` (§6.6) at save time and on demand (e.g., for future tools).

### 7.6 STRAWMAN MD format — **NON-BINDING, FOR DISCUSSION ONLY**
> This is **not** part of the contract. The parser interface (§6.3) is the
> contract; the concrete syntax below is a starting point for the dedicated
> MD-format session (G1/OQ-001). Do **not** finalize the parser against it
> without sign-off.

```
# 74138                        ; type name (FR-062)
outline: 6 x 12                ; width x height in grid units

pins:                          ; name  side    pos  dir       [width]
  A0    left    2   in
  A1    left    3   in
  A2    left    4   in
  /E1   left    6   in
  /E2   left    7   in
  E3    left    8   in
  /Y0   right   2   out
  /Y1   right   3   out
  ; …                          ; tristate example: DQ0  right 2  tristate
groups:                        ; name: ordered pins (FR-063)
  A: A0, A1, A2                ; 3-bit address group

delays:                        ; optional, ns (FR-064)
  tpd: 7

behavior: |                    ; opaque GALasm, preserved & ignored (FR-066)
  /Y0 = /(/E1 * /E2 * E3 * /A2 * /A1 * /A0)
  ; …
```

---

## 8. Key Design Decisions

| Decision | Alternatives Considered | Choice | Rationale |
|---|---|---|---|
| Canvas tech for the drawing surface | SVG/DOM (declarative, easy hit-testing); WebGL (fast, heavy) | **HTML5 Canvas 2D (immediate mode)** | Full control over high-frequency drag/rubber-band/pan/zoom; predictable perf on large designs (NFR-005); avoids DOM-node blowup that SVG suffers; WebGL is overkill for 2D lines/rects |
| UI "chrome" stack | React+Vite; Preact/htm; Lit | **Vanilla ES modules, no build step** | Honors the no-build/plain-JS constraint; the chrome is modest; the complexity that grows (canvas engine) lives outside any framework anyway; a framework can be added later because chrome is decoupled (user-confirmed) |
| Mutation path | Direct model edits from event handlers | **Single Command pipeline through the Store** | Makes undo/redo total and uniform (FR-024, NFR-006); one place to set the dirty flag (FR-049a); testable commands |
| Net representation | Compute nets geometrically (intersections) at read time; store nets only | **Union-find over pin/wire ids; `nets` stored as derived convenience** | FR-059a forbids pixel-geometry-dependent connectivity; id-based union-find is exact and pixel-free; storing nets aids downstream tools (A1/A4) |
| Junction identity | Reference a point on a wire by coordinate; split the target wire at the junction | **Junction endpoint stores target wire id (+ render-only coord)** | Connectivity derivable from ids alone (FR-059a); avoids brittle coordinate matching and target re-splitting (A1) |
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
    mdparse.go              CREATE  ParseComponent contract (syntax TBD) (§6.3)
    storage.go              CREATE  ListDir/LoadDesign/SaveDesign (§6.5)
    paths.go                CREATE  AppDataDir per-OS (§6.5)
    types.go                CREATE  ComponentType/Pin/PinGroup/Design/... Go structs (§7)
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
    js/engine/interaction.js CREATE tool FSM + event handling (§6.9)
    js/engine/hittest.js    CREATE  hit-testing (§6.9)
    js/chrome/toolbar.js    CREATE  toolbar (§6.11)
    js/chrome/palette.js    CREATE  palette tiles (§6.11)
    js/chrome/dialogs.js    CREATE  save/open dialogs (§6.11)
    js/chrome/properties.js CREATE  per-instance overrides panel (§6.11)
    js/chrome/contextmenu.js CREATE right-click menu (§6.11)
  components/
    74138.md                CREATE  (user-authored sample; format TBD)
    74xxx.md                CREATE  (additional user-authored samples)
  specs/
    design.md               (this document)
```

No files are modified (greenfield).

---

## 10. Requirement Traceability

| Requirement | Design Section | Files |
|---|---|---|
| FR-001 | §6.1, §6.4, §5 | `main.go`, `api.go` |
| FR-002 | §6.2 | `components.go`, `mdparse.go` |
| FR-003 | §6.4, §6.11, §6.12 | `api.go`, `palette.js`, `app.js` |
| FR-004 | §6.12 | `app.js`, `store.js` |
| FR-005, FR-006 | §6.2, §6.11 | `components.go`, `palette.js` |
| FR-007 | §6.2 | `components.go` |
| FR-008, FR-009, FR-010 | §6.9, §6.11 | `interaction.js`, `palette.js`, `store.js` |
| FR-011 | §6.6 | `model/design.js` |
| FR-012, FR-015, FR-020 | §6.7, §6.8 | `geometry.js`, `canvas.js` |
| FR-013, FR-014 | §6.8, §7.1 | `canvas.js`, `types.go` |
| FR-016, FR-017 | §6.9 | `interaction.js`, `hittest.js` |
| FR-018 | §6.6, §6.9 | `model/design.js`, `interaction.js` |
| FR-018a | §6.6, §6.9, §6.10 | `model/design.js`, `store.js` |
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
| FR-038 | §6.9, §6.11 | `interaction.js`, `contextmenu.js` |
| FR-039, FR-040 | §6.9 | `interaction.js` |
| FR-041, FR-042, FR-043 | §6.9, §7.2 | `interaction.js`, `model/design.js` |
| FR-044, FR-045 | §6.10, §6.12 | `store.js`, `app.js` |
| FR-046, FR-047, FR-048, FR-049 | §6.5, §6.11 | `storage.go`, `dialogs.js` |
| FR-049a | §6.10, §6.11 | `store.js`, `dialogs.js` |
| FR-050, FR-051 | §6.5, §6.11 | `paths.go`, `storage.go`, `dialogs.js` |
| FR-052, FR-053, FR-054 | §6.4, §6.5, §6.11 | `api.go`, `storage.go`, `dialogs.js` |
| FR-055, FR-056 | §7.2 | `types.go`, `model/design.js` |
| FR-057, FR-058 | §7.2 | `types.go`, `model/design.js`, `properties.js` |
| FR-059, FR-059a, FR-060 | §6.6, §7.2 | `model/netlist.js`, `types.go` |
| FR-061…FR-064 | §6.3, §7.1, §7.6 | `mdparse.go`, `types.go` |
| FR-065 | §6.4 | `api.go` |
| FR-066 | §6.3, §7.1 | `mdparse.go` |
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
- **Go `mdparse`:** valid file → correct `ComponentType`; missing name / bad side
  / bad direction / non-integer position / group referencing unknown pin → error
  with file+line; behavioral block captured into `Behavior` and unknown keys
  ignored (FR-061–FR-066).
- **Go `storage`:** atomic save does not corrupt an existing file when the write
  fails midway; `ListDir` returns only `.json`+dirs with a correct `parent`;
  load of malformed JSON → 422 (FR-046–FR-053, FR-055).
- **Go `paths`:** `AppDataDir` returns the correct path per `GOOS` (OQ-006).
- **JS `geometry`:** rotation table maps integer offsets to integer offsets for
  all four angles; round-trip world↔screen; snap-to-grid (FR-021, FR-020).
- **JS `netlist.buildNets`:** see edge cases below (FR-034b/FR-059a).
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
  group, fallback to nearest pin (FR-035–FR-043).
- Save (first-time prompt, prefilled name) → overwrite silently → Save As → Open
  via navigation; round-trip equality of the model (FR-044–FR-060).

### 11.3 Edge / boundary cases
- Delete a component → connected wires keep one dangling end (FR-029); wires with
  both ends now free are removed (FR-030); junctions on a deleted wire become free
  (G2).
- Fan-out: one pin with three wires forms one net (FR-034a/b).
- Junction chain A→B→C: all three wires + their pins are one net, computed from
  ids only — moving any vertex does not change the net (FR-059a).
- Bus width with a pin group whose summed bit-width matches via multi-bit pins
  (A3); width tie → first declared group chosen.
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

- **OQ-001 / G1 — MD file syntax (BLOCKS `mdparse.go` body only).** The concrete
  syntax must be settled collaboratively (strawman in §7.6). All other modules
  proceed against the `ComponentType` contract (§7.1) and can be exercised with a
  hand-written stub library. *Do not finalize the parser until the format session
  concludes.*
- **A3 — Pin-group "width" semantics & tie-break.** This design assumes width =
  Σ member pin bit-widths and "first declared on tie." Confirm when the MD format
  is designed (ties also affect FR-041). Gates **bus snap-connect** only.
- **OQ-007 / A1 — Junction representation.** This design fixes it (target wire id
  + render coord). Please confirm it satisfies the downstream-tool needs you have
  in mind before the netlist is consumed by a later phase.
- **OQ-004 / A5 — Grid spacing & default zoom.** Defaults chosen (8 px/unit,
  0.25×–4.0×). Confirm or adjust the constants.
- **U1 — NFR-005 threshold & target design size.** Proposed ≤16 ms at 200
  components / 600 segments. Confirm the numbers (or supply real target sizes).
- **OQ-003 — File navigation vs recent-files.** Design includes server-assisted
  navigation with a ready `localStorage` recent-files fallback (FR-054). Decide at
  implementation which ships first; both are designed.
- **OQ-008 — Pin-direction set.** Assumed `{in,out,bidir,tristate}` is sufficient
  and maps cleanly to the future four-level model. Confirm with the MD format.

None of the above prevent starting the server skeleton, the canvas engine, the
store/undo pipeline, or the chrome. Only the MD **parser body** and the **bus
snap** slice should wait on their respective confirmations.
```
