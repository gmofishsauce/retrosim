# Requirements: TTL Circuit Design Editor

## 1. Overview

A localhost-only digital circuit design editor for retro computing hobbyists who design CPUs and other digital hardware using classic TTL components. The system consists of a JavaScript web application running in the browser and a small Go server running on the same machine. The browser application provides a schematic-style canvas on which the user places and wires TTL components. The server stores and retrieves designs and hosts the component library. The simulation engine and C-code transpiler described in the vision statement are out of scope for this phase.

---

## 2. Users and Roles

**Designer (the only user role):** A single local user. There is no authentication, multi-user access, or network exposure. The server listens on localhost only.

---

## 3. Functional Requirements

### 3.1 Application Shell and Startup

- FR-001: The system shall consist of a JavaScript single-page application served by a Go HTTP server bound exclusively to `localhost`.
- FR-002: On startup, the server shall load all component definition files (MD files) from a configured component library directory.
- FR-003: The browser application shall retrieve the component library from the server at startup and populate the palette before allowing the user to interact with the canvas.
- FR-004: The application shall open in select-tool mode with an empty, unsaved design named `"unnamed schematic <datetime>"` where `<datetime>` is the current local date and time.

### 3.2 Component Palette

- FR-005: The palette shall display one tile per loaded component type, showing the component type name (e.g., "74138").
- FR-006: The palette shall be a flat, unordered list of tiles — no grouping or categorization in this phase.
- FR-007: The component library shall be loaded once at server startup; the server is not required to detect or reload MD files added while running.

### 3.3 Component Placement

- FR-008: The user shall be able to place a component by dragging its tile from the palette onto the canvas.
- FR-009: The user shall be able to place a component by clicking its tile in the palette and then clicking a point on the canvas.
- FR-010: In both cases, placement shall be one-shot: after the component is placed the application shall return to select-tool mode automatically.
- FR-011: On placement, the system shall assign the component a unique reference designator (U1, U2, U3, …) incremented from the highest existing designator in the design.
- FR-012: Each component instance shall display its reference designator (e.g., "U3") and its type name (e.g., "74138") as text labels on the canvas. These labels shall always render upright regardless of the component's rotation.

### 3.4 Component Appearance

- FR-013: Each component shall be rendered as a rectangular outline with pin stubs and pin name labels on the sides of the rectangle.
- FR-014: The position and side (left, right, top, bottom) of each pin shall be determined by the component's MD file; the editor shall not infer or rearrange pin positions automatically.
- FR-015: Pin name labels shall always render upright regardless of the component's rotation.

### 3.5 Component Selection and Movement

- FR-016: In select-tool mode, the user shall be able to click a component to select it.
- FR-017: The user shall be able to drag a selected component to a new position on the canvas; the component shall snap to the grid.
- FR-018: When a component is moved, any wire or bus segments directly connected to its pins shall stretch to follow, maintaining connectivity. The stretched segments may cross other components; the user is responsible for re-routing them afterward.
- FR-018a: In select-tool mode, the user shall be able to delete a selected component. Wires and buses connected to the deleted component shall remain in the design with their formerly-connected endpoints left dangling (see FR-029, FR-030).

### 3.6 Component Rotation

- FR-019: The user shall be able to rotate a selected component 90° clockwise or 90° counter-clockwise.
- FR-020: Rotation shall reposition pin stubs accordingly; all text labels (pin names, reference designator, type name) shall remain upright after rotation.

### 3.6a Per-Instance Type Overrides

- FR-020a: The user shall be able to view the type data of a selected component instance and override specific values (e.g., propagation delay) for that instance only. Overrides shall not affect other instances of the same type or the underlying MD file, and shall be persisted per FR-058.

### 3.7 The Canvas and Grid

- FR-021: The entire canvas shall be backed by a uniform fine grid (approximately 1–2 mm screen spacing at default zoom). All components, pins, wire endpoints, and bend points shall be located on grid intersections.
- FR-022: The user shall be able to zoom in and out on the canvas.
- FR-023: The user shall be able to pan the canvas.
- FR-024: Undo and redo shall be supported for all user actions that modify the design.

### 3.8 Wire Drawing

- FR-025: The application shall provide a Wire tool. While the Wire tool is active the cursor shall provide clear visual feedback indicating wire-drawing mode.
- FR-026: The user shall activate the Wire tool by clicking a wire-tool button in the toolbar.
- FR-027: To draw a wire, the user shall click a source pin, then click a destination pin. The system shall draw a straight line (rat's nest wire) between the two pins.
- FR-028: After a wire is placed, the application shall automatically return to select-tool mode.
- FR-029: A wire or bus with exactly one connected endpoint shall be permitted (e.g., as a result of deleting a component).
- FR-030: A wire or bus with no connected endpoints shall be automatically removed from the design.

### 3.9 Wire Routing (Bend Points)

- FR-031: In select-tool mode, the user shall be able to click any point on a wire segment. The system shall insert a bend point at the nearest grid intersection to the click, dividing the segment in two.
- FR-032: The user shall be able to drag a bend point to any grid intersection while holding the mouse button down; the two segments touching the bend point shall rubber-band continuously during the drag.
- FR-033: The user shall be able to right-click a bend point and select "Delete bend point"; the bend point shall be removed and the two segments it connected shall merge into one straight segment between the surrounding endpoints.
- FR-033a: In select-tool mode, the user shall be able to delete an entire wire or bus.

### 3.10 Wire Branching and Connectivity

- FR-034: While the Wire tool is active, clicking on an existing wire segment shall start a new wire branch from that point rather than inserting a bend point.
- FR-034a: A single pin shall be permitted to have more than one wire connected to it (fan-out), so that one output may drive multiple inputs.
- FR-034b: A point at which a wire branches from another wire (FR-034) constitutes an electrical junction. All pins and wires that are transitively connected through pins and junctions form a single electrical net. The design's connectivity (its set of nets) shall be derivable from the saved design without reference to pixel geometry.

### 3.11 Bus Drawing

- FR-035: The application shall provide a Bus tool, separate from the Wire tool.
- FR-036: Buses shall be rendered as thick blue lines. Single-bit wires shall be rendered as thin black lines.
- FR-037: Each bus shall display a width annotation consisting of a slash mark and a digit indicating the bus width in bits.
- FR-037a: A bus of width N shall represent N independent single-bit signals (nets). Signal identity is determined by bit position: bit i of a bus is a distinct net from bit j (i ≠ j). The connectivity rule of FR-034b applies independently to each bit.
- FR-037b: A bus may optionally carry a signal name for each bit (e.g., C, V, N, Z). When a bus is snap-connected (FR-041) to a pin group whose member pins are named, and the bus does not already have bit names, the bus shall adopt the group's pin names in bit order. Bit position, not name, determines electrical connectivity.
- FR-038: The user shall be able to right-click a bus and set its width from a context menu.
- FR-039: Bus drawing, bend-point editing, and branching shall follow the same interaction model as wires (FR-026 through FR-034).
- FR-039a: A connection that would join two buses of unequal width shall be prevented at the time the user attempts it.
- FR-040: After a bus is placed, the application shall automatically return to select-tool mode.

### 3.12 Bus-to-Component Snap Connection

- FR-041: When the user drags a bus endpoint onto a component, the system shall determine which of the component's declared pin groups match the bus width. A pin group matches when the sum of its member pins' bit-widths equals the bus width.
- FR-041a: If exactly one pin group matches the bus width, the system shall snap-connect the bus to that group automatically (per FR-042).
- FR-041b: If more than one pin group matches the bus width, the system shall prompt the user to choose which matching group to connect to, presenting the candidate groups by name; the user may cancel the connection. (This supersedes any rule that silently selects a default group on a tie.)
- FR-042: When a pin group is connected — automatically per FR-041a or by the user's choice per FR-041b — the system shall connect each bit of the bus to the corresponding pin in the group's declared bit order, without requiring the user to wire each pin individually.
- FR-043: If no pin group matches the bus width, the bus endpoint shall attach to the nearest pin only, and the remaining bits shall be left unconnected.
- FR-043a: The user shall be able to break out a single signal (one bit) from a bus and route it as an ordinary single-bit wire to a pin or other connection point. The broken-out wire shall be electrically part of that bus bit's net (per FR-037a).

### 3.13 File Operations — New Design

- FR-044: The application shall support creating a new, empty design at any time.
- FR-045: A new design shall be assigned the default name `"unnamed schematic <datetime>"`.

### 3.14 File Operations — Save

- FR-046: The user shall be able to save the current design via a Save action.
- FR-047: The first time a design is saved, the system shall prompt the user to confirm or change the filename, pre-filling the default name.
- FR-048: Subsequent saves of the same design shall overwrite the existing file without prompting.
- FR-049: The user shall be able to invoke Save As at any time to save the design under a new name.
- FR-049a: The application shall indicate when the current design has unsaved changes, and shall warn the user before discarding unsaved changes (e.g., on New or Open).
- FR-050: The server shall store design files in the platform-standard application data directory by default.
- FR-051: The file dialog shall allow the user to choose a different save location.

### 3.15 File Operations — Open

- FR-052: The user shall be able to open an existing design via a file navigation dialog.
- FR-053: The server shall provide an API endpoint to list directory contents so that the browser can render a file navigation dialog without relying on the browser's native file picker.
- FR-054: If server-assisted file navigation proves impractical, the system may fall back to presenting a list of recently opened designs instead.

### 3.16 Design Save Format

- FR-055: Designs shall be saved as JSON files.
- FR-056: The JSON file shall contain at minimum three distinct collections: (a) component instances, (b) wire routes, and (c) bus routes.
- FR-057: Each component instance record shall include: component type name, reference designator, canvas position, rotation, and a full copy of the type's data from the MD file at the time of save.
- FR-058: Per-instance overrides of type data (e.g., a custom propagation delay for a specific instance) shall be stored alongside the copied type data in the instance record.
- FR-059: Each wire route record shall include: the two endpoint references and an ordered list of bend-point grid coordinates. An endpoint reference shall be one of: (a) a component pin (U-number and pin name), (b) a junction on another wire or bus (FR-034b), or (c) a free canvas grid coordinate if the endpoint is dangling.
- FR-059a: The saved design shall represent electrical connectivity (the set of nets per FR-034b) in a form derivable without reference to pixel geometry, so that a later tool can determine which pins are electrically connected.
- FR-060: Each bus route record shall include: the same endpoint and bend-point data as a wire, plus the bus width in bits and any pin-group connection data for snap-connected endpoints.
- FR-060a: For buses, the saved design shall additionally include any per-bit signal names (FR-037b) and any single-bit breakout connections (FR-043a), such that the net membership of each individual bus bit — including which bus and bit each net originates from — is derivable without reference to pixel geometry (consistent with FR-059a).

### 3.17 Component Definition (MD File)

- FR-061: Each TTL component type shall be defined by an MD file whose format is to be designed collaboratively and then parsed by the server.
- FR-062: The MD file shall specify: component type name; the rectangular outline dimensions (either stated directly or derived from a declared package type per FR-062b); and for each pin: its name, the side of the rectangle it appears on (left, right, top, bottom), and its position along that side.
- FR-062a: The MD file shall specify each pin's electrical direction (at minimum: input, output, bidirectional, and tristate-capable), so that high-impedance behavior and signal direction can be represented in a later simulation phase.
- FR-062b: The MD file may declare a standard physical package type (e.g., `DIP-16`, `DIP-24/0.6`). The server shall resolve the package — via a built-in package table/generator — to the component's outline dimensions and to each pin's physical pin number, so the author need not state outline dimensions explicitly. A declared package supplies defaults and physical metadata only; it shall not override author-specified pin side/position (FR-014). The component remains a functional schematic symbol, not a pictorial package drawing.
- FR-063: The MD file shall optionally specify one or more named pin groups, each listing the pins that form a bus and their bit order, to support bus snap-connection (FR-041 through FR-043).
- FR-064: The MD file shall optionally specify propagation delay values for the component.
- FR-065: The server shall expose the parsed component library to the browser application via an API endpoint.
- FR-066: The MD file format shall be designed so that behavioral logic equations (in GALasm form, per the vision statement) can be added to a component definition later without requiring changes to the editor or breaking the existing parser. The editor phase shall ignore any behavioral content present.

---

## 4. Non-Functional Requirements

- NFR-001: The server shall bind exclusively to `127.0.0.1` (localhost) and shall not accept connections from any other network interface.
- NFR-002: The browser application shall function entirely within a single browser tab with no external network requests.
- NFR-003: The server shall be implemented in Go; the browser application shall be implemented in JavaScript.
- NFR-004: The server API shall be versioned or structured so that new endpoints (e.g., for the future transpiler) can be added without breaking existing clients.
- NFR-005: Canvas interactions (drag, rubber-band, pan, zoom) shall feel responsive; there shall be no perceptible lag between user input and canvas update for operations that do not require a server round-trip.
- NFR-006: The undo/redo stack shall support at least 50 discrete actions.

---

## 5. Data Requirements

| Entity | Key Attributes | Notes |
|---|---|---|
| ComponentType | name, optional package type, outline dimensions (stated or package-derived), pins (name, side, position, direction, optional pin number), pin groups, propagation delays, (future) behavioral equations | Loaded from MD files at server startup |
| ComponentInstance | type name, U-number, canvas position (x, y), rotation (0/90/180/270), copied type data, per-instance overrides | One per placed component in a design |
| Pin | name, side, position along side, direction (in/out/bidir/tristate), bit-width, optional physical pin number | Defined in MD file; referenced by wires and buses |
| PinGroup | name, ordered list of pins | Optional; declared in MD file; enables bus snap-connect |
| Wire | endpoint A, endpoint B (each: instance+pin, junction on another wire/bus, or free coord), ordered bend points | A wire with zero connected endpoints is not persisted |
| Bus | same as Wire, plus width in bits, snap-connection metadata, optional per-bit signal names, single-bit breakout taps | Represents N independent nets (one per bit); rendered as thick blue line with annotation |
| Net | set of pins and wire/bus segments electrically connected through pins and junctions; a bus contributes one net per bit | Derivable from the design without pixel geometry (FR-034b, FR-059a); per-bit provenance (originating bus and bit) retained for downstream tools |
| Design | name, save path, list of ComponentInstances, list of Wires, list of Buses | Top-level save file entity |

---

## 6. Integration Requirements

- IR-001: The browser application shall communicate with the local Go server exclusively via HTTP/REST over localhost.
- IR-002: There are no external third-party service integrations in this phase.

---

## 7. Constraints and Assumptions

**Constraints:**
- The browser application must be implemented in JavaScript (no TypeScript, WebAssembly, or other compile-to-JS languages unless discussed).
- The server must be implemented in Go.
- The system is single-user and localhost-only; no authentication or TLS is required.
- Multi-select and copy/paste of components are out of scope for this phase.
- The simulation engine and C-code transpiler are out of scope for this phase.

**Assumptions:**
- The user runs a modern desktop browser (Chrome or Firefox); mobile browser support is not required.
- The component MD file format will be designed and agreed upon before implementation of the parser begins; these requirements assume that format will be capable of expressing all data described in FR-062 through FR-064.
- A single instance of the server runs per user; concurrent multi-session access is not required.
- Design files fit comfortably in memory; no streaming or chunked I/O is needed for save/load.

---

## 8. MVP Scope

The minimum set of requirements needed for a usable first release:

**Server:** FR-001, FR-002, FR-003, FR-050, FR-061 through FR-066 (component library loading, pin direction, MD forward-compat, API), FR-046 through FR-048 (save), FR-052 through FR-053 (open/list).

**Canvas and tools:** FR-004, FR-007, FR-021 through FR-024 (grid, zoom, pan, undo/redo), FR-005 through FR-006 (palette), FR-008 through FR-015 (placement and appearance), FR-016 through FR-018a (selection, movement, delete), FR-019 through FR-020 (rotation).

**Wiring:** FR-025 through FR-034b (wire tool, routing, bend points, branching, fan-out, connectivity), FR-033a (delete wire/bus).

**Buses:** FR-035 through FR-040 (bus tool, rendering, width), plus FR-037a (per-bit net semantics) and FR-039a (unequal-width connection prevention). Bus snap-connect and its extensions — FR-041 through FR-043a (group matching, disambiguation, nearest-pin fallback, single-bit breakout) and FR-037b (bus bit names) — may be deferred to a follow-on iteration, but the save format (FR-060a) and connectivity model must accommodate them from the outset.

**File format:** FR-055 through FR-060, plus FR-059a (connectivity representation).

**Deferred from MVP but specified:** FR-020a (per-instance overrides UI), FR-049a (unsaved-changes warning) are desirable but may slip to a follow-on iteration.

---

## 9. Open Questions

- OQ-001: The MD file format is not yet defined. A separate design session is needed to specify the syntax and semantics before parser implementation begins. The data content now includes an optional package type (FR-062b); the concrete package-naming grammar (e.g., `DIP-16` vs `DIP-24/0.6`) and the package table/generator contents are part of that session.
- OQ-002: Bus snap-connection and its extensions (FR-041 through FR-043a) may prove complex enough to warrant their own design pass; they are noted as potentially deferrable from the MVP. Disambiguation on multiple width-matches (FR-041b) and single-bit breakout (FR-043a) have now been specified following stakeholder discussion.
- OQ-003: Server-assisted file navigation (FR-053) may be difficult to implement cleanly in the browser; the fallback to a recent-files list (FR-054) should be kept as a ready alternative.
- OQ-004: The exact grid spacing (1 mm vs. 2 mm equivalent at default zoom) and the default zoom level are not yet specified.
- OQ-005: Whether the Bus tool reverts to select-tool mode after placing one bus (consistent with the Wire tool) was not explicitly confirmed — assumed yes for consistency.
- OQ-006: The platform-standard application data directory varies by OS (e.g., `~/Library/Application Support` on macOS, `~/.local/share` on Linux, `%APPDATA%` on Windows). The server should handle all three; the primary development platform is not yet confirmed.
- OQ-007: The exact representation of electrical nets and wire-to-wire junctions in the JSON save format (FR-034b, FR-059a) needs to be settled as part of the save-format and MD-format design session, since it affects both. This now also covers per-bit bus net representation and provenance (FR-037a, FR-060a); the design phase has proposed a first-class-vertex graph with per-bit lanes as the chosen representation.
- OQ-008: The set of pin directions in FR-062a (input/output/bidirectional/tristate) and how they map to the four-level logic model is assumed sufficient; this should be confirmed when the MD format is designed.
- OQ-009: The UI for viewing and editing per-instance overrides (FR-020a) is not yet specified (e.g., a properties panel vs. a dialog).

---

## 10. Glossary

| Term | Definition |
|---|---|
| Anchor point | A pin on a component where a wire or bus can connect |
| Bend point | A moveable intermediate point on a wire or bus segment that allows the user to shape the route |
| Breakout | Extracting a single bit (signal) from a bus and routing it onward as an ordinary single-bit wire |
| Bus | A multi-bit signal connection rendered as a thick blue line with a width annotation; electrically it is N independent single-bit nets, one per bit |
| Canvas | The drawing surface in the browser on which components and wires are placed |
| GALasm | A logic-equation language used to describe TTL component behavior in MD files (simulation phase) |
| Grid | A uniform lattice of points covering the canvas; all design elements snap to grid intersections |
| Junction | A point at which a wire branches from another wire or bus, electrically tying them together |
| MD file | A text file (format TBD) that defines the name, pin layout, pin directions, pin groups, optional timing, and (eventually) the GALasm behavior of one TTL component type |
| Package | The physical package of a TTL part (e.g., DIP-16, DIP-24/0.6). Declared optionally in the MD file; the server resolves it to outline dimensions and physical pin numbers. It is metadata/defaults — the schematic symbol's pin placement is still author-controlled (FR-014) |
| Net | The set of pins and wire/bus segments that are all electrically connected through pins and junctions |
| Palette | The panel displaying available component types as tiles, from which the user selects components to place |
| Pin group | A named set of pins declared in an MD file that collectively form a bus interface |
| Rat's nest wire | A straight-line wire drawn directly between two pins before the user has routed it with bend points |
| Reference designator | A unique identifier assigned to each component instance (e.g., U1, U2) |
| Rubber-banding | The real-time stretching of wire segments as the user drags a bend point or component |
| Select tool | The default canvas mode in which the user can select, move, and interact with existing elements |
| Snap-connect | The automatic connection of all pins in a declared pin group when a matching bus is dragged onto a component |
| TTL | Transistor-Transistor Logic; a family of digital logic components (e.g., 74xx series) |
| Wire | A single-bit signal connection rendered as a thin black line |
