# Requirements: TTL Circuit Design Editor

> This document, together with `design.md`, is the single source of truth for
> the system's intended state and is kept current. `CHANGELOG.md` is a
> chronological index of change requests (history and rationale only) — it is
> not needed to determine current behavior.

## 1. Overview

A localhost-only digital circuit design editor for retro computing hobbyists who design CPUs and other digital hardware using classic TTL components. The system consists of a JavaScript web application running in the browser and a small Go server running on the same machine. The browser application provides a schematic-style canvas on which the user places and wires TTL components. The server stores and retrieves designs and hosts the component library. Of the two simulation engines described in the vision statement (`sim-vision.md`), the slow ("debug") simulator is now in scope (§3.19); the fast engine — a generator producing a standalone C simulation program — remains out of scope. (Supersedes the original "simulation out of scope for this phase".)

---

## 2. Users and Roles

**Designer (the only user role):** A single local user. There is no authentication, multi-user access, or network exposure. The server listens on localhost only.

---

## 3. Functional Requirements

### 3.1 Application Shell and Startup

- FR-001: The system shall consist of a JavaScript single-page application served by a Go HTTP server bound exclusively to `localhost`.
- FR-002: On startup, the server shall load all component definition files (YAML files) from a configured component library directory.
- FR-003: The browser application shall retrieve the component library from the server at startup and populate the palette before allowing the user to interact with the canvas.
- FR-004: The application shall open in select-tool mode with an empty, unsaved design named `"unnamed schematic <datetime>"` where `<datetime>` is the current local date and time.

### 3.2 Component Palette

- FR-005: The palette shall display one fixed-size tile per loaded component type. Each tile shall show the component type name with its leading two characters (the "74" family prefix) removed, leaving a 2- or 3-digit label (e.g., "138" for "74138", "00" for "7400"); the full unabbreviated type name shall be available as the tile's tooltip.
- FR-006: The palette shall arrange tiles in a fixed-width grid of equal-size tiles (3 per row), packed left-to-right then top-to-bottom in ascending order of the numeric abbreviated part number. (Supersedes the prior flat, unordered list.)
- FR-006a: The palette shall be divided into two equal-height regions by a horizontal divider at its vertical midpoint. The upper region shall hold the 74-series component tiles (FR-005, FR-006). The lower region shall hold built-in editor objects (FR-067). Each region shall scroll independently when its contents overflow. The lower-region tiles follow the same grid and click/drag-to-place behavior as the upper region (FR-006, FR-008, FR-009, FR-009a) but are labeled by a distinct icon and tooltip per object rather than an abbreviated part number.
- FR-007: The component library shall be loaded once at server startup; the server is not required to detect or reload YAML files added while running.

### 3.3 Component Placement

- FR-008: The user shall be able to place a component by dragging its tile from the palette onto the canvas.
- FR-009: The user shall be able to place a component by clicking its tile in the palette and then clicking a point on the canvas.
- FR-009a: While a palette tile is armed for click-to-place (FR-009), that tile shall show a pressed-in (inset) appearance distinguishing it from the unarmed, raised tiles, and shall return to the raised appearance once placement completes or is cancelled.
- FR-010: In both cases, placement shall be one-shot: after the component is placed the application shall return to select-tool mode automatically.
- FR-011: On placement, the system shall assign the component a unique reference designator (U1, U2, U3, …) incremented from the highest existing designator in the design. A subunit-rendered package (FR-013a) consumes a single U-number shared by all of its subunits, whose designators append a letter suffix in unit order (e.g., U5A, U5B, U5C, U5D).
- FR-011a: Built-in editor objects (FR-067) shall instead be assigned a reference designator from a separate series (A-1, A-2, A-3, …), incremented from the highest existing A-number in the design, so they do not consume IC U-numbers (FR-011).
- FR-012: Each component instance shall display its reference designator (e.g., "U3") and its type name (e.g., "74138") as text labels on the canvas. These labels shall always render upright regardless of the component's rotation.

### 3.4 Component Appearance

- FR-013: Each component shall be rendered as a rectangular outline with a small connection bubble (circle) at each pin and pin name labels on the sides of the rectangle. Each bubble shall be drawn just outside the body, tangent to the outline edge and anchored on the pin's grid point (the grid point remains the wire-connection coordinate). The bubble shall be small enough that adjacent pins (one grid unit apart) do not overlap. The drawn wire attachment point and the wire hot region are specified by FR-013d. (Subunit-rendered components, FR-013a, mark pin connection points per FR-013c instead of a resting bubble, so the circle stays reserved for logic negation.) (Reworked 2026-06-11; supersedes "clicking anywhere within a pin's bubble starts or ends a wire" — see FR-013d.)
- FR-013a: A component whose YAML declares `rendertype: subunit` shall be rendered as a set of separate traditional schematic symbols — one per functional unit — rather than a single rectangle (FR-013). On placement, all of the package's units shall be dropped onto the canvas at once, offset so they do not overlap, each independently selectable, movable (FR-017), and rotatable (FR-019).
- FR-013b: The renderer shall provide the schematic symbols named by `renderas`: `nand`, `and`, `or`, `nor`, `xor`, `xnor`, `not`, `mux2`, `mux4`, `mux8`. Gate symbols draw their inputs on the left and their output on the right; the number of inputs is the count of the unit's input pins. Multiplexers draw as a symmetrical trapezoid whose long (left) side carries the data inputs and whose short (right) side carries the output, with the top and bottom edges sloping about 30° toward the right; select inputs enter the top. Every connection point — including multiplexer selects — shall lie on a grid intersection (FR-021); where the symbol edge does not pass through that intersection (the sloped mux top), a short stub shall connect the on-grid connection point to the edge, and the grid intersection shall remain the wire-connection coordinate (FR-013). Connection points are marked per FR-013c.
- FR-013c: For subunit-rendered components (FR-013a), a pin's connection point shall not carry a resting bubble (so the circle remains exclusively a logic-negation indicator, and a positive-true pin is not mistaken for an inverted one). Instead, when the subunit symbol is hovered or selected, each connection point shall be marked with a short tick drawn as an outward lead along the pin's direction from the pin's grid point (so it reads as a connection stub rather than disappearing into a body edge); at rest no such mark is shown. An inverting output is exempt: its negation bubble already marks the connection point, so it receives neither a resting bubble nor a hover/select tick. The pin's grid point remains the wire-connection coordinate (FR-013) whether or not a tick is shown.
- FR-013d: Wires and buses shall be *drawn* attaching at a pin's visual attachment point: the center of the pin's bubble for pins that carry one (FR-013, built-ins included), or the pin's on-grid connection point for subunit-rendered pins (FR-013c; an inverting output's wire still attaches outside its negation bubble, never inside it). This is rendering only: the pin's grid point remains the electrical wire-connection coordinate and the persisted endpoint (FR-021, FR-059). A pin's hot region — the area over which the cursor becomes the wire cursor (FR-025, FR-027b) and a click starts or terminates a wire — shall be a circle of radius approximately 0.7 grid units centered on the visual attachment point; where the hot regions of nearby pins overlap, the nearest pin shall win. (Reworks FR-013's "the bubble is the click target"; the prior hot region was a 0.5-grid-unit circle on the grid point.)
- FR-014: The position and side (left, right, top, bottom) of each pin shall be determined by the component's YAML file; the editor shall not infer or rearrange pin positions automatically.
- FR-014a: For subunit-rendered components (FR-013a) the position of each pin is dictated by its symbol, not by the YAML; such pins specify their `unit` (a letter) instead of a position, and their order within a unit in the YAML determines slot order on the symbol (inputs top-to-bottom; multiplexer selects in least-significant-first order).
- FR-015: Pin name labels shall always render upright regardless of the component's rotation.

### 3.4a Built-in Objects

- FR-067: The editor shall provide a set of built-in objects — entities with functionality built into the editor and eventual simulator, as distinct from 74-series parts loaded from YAML. Built-in objects are defined by the client application (not by YAML files), placed from the lower palette region (FR-006a), and once placed behave as component instances: selectable, movable, rotatable, deletable, persisted in the design, and wireable through their connection points. They are designated A-1, A-2, … (FR-011a).
- FR-067a: Each built-in object shall be associated with a behavior: a simulation-semantics function implemented in client JavaScript and registered alongside the object's type definition (it is the built-in analogue of a 74-series part's GALasm equations, FR-066). The behaviors' semantics are specified in §3.19: the clock per FR-084, pull-up/pull-down per FR-083, the indicator per FR-068 (display only; it drives nothing). Behaviors are code, not data: they are resolved from the client registry by type name and are never serialized into saved designs. (Reworked 2026-06-11; supersedes "interface deferred to the simulator design".)
- FR-068: The first built-in object shall be a state indicator. It occupies a 2×2 grid-unit footprint and exposes a single input connection point on the bottom edge (centered) that may be wired to any wire or driven output. It is drawn as a round bubble sized to fit comfortably within the square. The indicator is not independently stateful: it always displays the state of the wire to which it is attached. It has three displayed states: undriven/undefined — a medium-gray bubble with a black "?"; logic 1 — a white bubble with a black "1"; logic 0 — a black bubble with a white "0". While a simulation runs (§3.19) the indicator displays its net's simulated value, with both U and Z (FR-077) rendered as the undriven "?" state; when no simulation has run it displays the undriven state. After a simulation terminates, the last simulated values remain displayed until the design is next modified (FR-085). The same bubble image is used for the palette icon (FR-006a) and the placed object. (Reworked 2026-06-11; supersedes "always displays the undriven state until the simulator exists".)
- FR-069: A built-in logical pull-up object. It occupies a 2×2 grid-unit footprint and exposes a single connection point on the bottom edge (centered). It is drawn as a two-headed upward arrow: two upward-pointing chevrons (carats) stacked at the top of the symbol, with a vertical line bisecting the symbol that rises from the bottom connection point up to just below the chevrons without intersecting them. Its palette tooltip is "pull up". The same image is used for the palette icon and the placed object.
- FR-070: A built-in logical pull-down object. It occupies a 2×2 grid-unit footprint and exposes a single connection point on the top edge (centered). It is drawn as an upside-down "T": a long vertical stem descending from the top connection point to a short horizontal bar near the bottom. Its palette tooltip is "pull down". The same image is used for the palette icon and the placed object.
- FR-071: A built-in clock generator object. It is drawn as a box containing the letters "CLK" and exposes a single connection point on the right edge (centered). Its palette tooltip is "clock". The same image is used for the palette icon and the placed object.
- FR-071a: The clock generator shall declare two properties (FR-020b): `period` — the simulated clock period in nanoseconds (default 100) — and `speed` — the human-perceived clock rate in hertz, i.e. cycles of the simulated clock per real second (default 1). The future simulator shall therefore advance period × speed nanoseconds of simulated time per real second: setting both to 1 simulates an unrealistically fast 1 ns per second; the defaults give 100 simulated ns per real second. The other built-ins (FR-068–FR-070) declare no properties.

### 3.5 Component Selection and Movement

- FR-016: In select-tool mode, the user shall be able to click a component to select it.
- FR-017: The user shall be able to drag a selected component to a new position on the canvas; the component shall snap to the grid.
- FR-018: When a component is moved, any wire or bus segments directly connected to its pins shall stretch to follow, maintaining connectivity. The stretched segments may cross other components; the user is responsible for re-routing them afterward.
- FR-018a: In select-tool mode, the user shall be able to delete a selected component. Wires and buses connected to the deleted component shall remain in the design with their formerly-connected endpoints left dangling (see FR-029, FR-030).
- FR-018b: Deleting any subunit of a subunit-rendered package (FR-013a) shall delete all subunits of that package as a single action; the system shall require explicit user confirmation (a warning dialog) before performing the deletion.

### 3.6 Component Rotation

- FR-019: The user shall be able to rotate a selected component 90° clockwise or 90° counter-clockwise.
- FR-020: Rotation shall reposition pin bubbles accordingly; all text labels (pin names, reference designator, type name) shall remain upright after rotation.

### 3.6a Per-Instance Type Overrides

- FR-020a: The user shall be able to view the type data of a selected component instance and override specific values (e.g., propagation delay) for that instance only. Overrides shall not affect other instances of the same type or the underlying YAML file, and shall be persisted per FR-058.
- FR-020b: A component type may declare named numeric properties, each with a name, a unit, and a default value (e.g., the clock's period in ns, FR-071a). Per-instance property values shall be viewable and settable through the same per-instance override mechanism as other type data (FR-020a) and persisted per FR-058. Built-in objects (FR-067) declare their properties in the client-side registry; the YAML format may later declare properties for 74-series types without breaking the parser or the editor (consistent with FR-066).

### 3.7 The Canvas and Grid

- FR-021: The entire canvas shall be backed by a uniform fine grid (approximately 1–2 mm screen spacing at default zoom). All components, pins, wire endpoints, and bend points shall be located on grid intersections.
- FR-022: The user shall be able to zoom in and out on the canvas.
- FR-023: The user shall be able to pan the canvas.
- FR-023a: In select-tool mode, the user shall be able to pan by dragging with the left mouse button on empty canvas (a drag whose press begins on bare canvas, not on a component, wire, bus, or pin); a left press on empty canvas that does not drag clears the selection. Panning by middle-button drag and by Space+left-drag shall remain available in all tool modes.
- FR-024: Undo and redo shall be supported for all user actions that modify the design.

### 3.8 Wire Drawing

- FR-025: The application shall provide a Wire tool. While the Wire tool is active the cursor shall provide clear visual feedback indicating wire-drawing mode: a wire cursor drawn as a short diagonal line centered on the pointer, interrupted at its midpoint by a small open dot that marks the cursor's active point (the hotspot is the image center). The Wire tool's toolbar button (FR-026) shall display this same wire icon in place of a text label. (Reworked 2026-06-11; supersedes the uncentered lower-right→upper-left line, whose active point sat at an end of the glyph and read as a jump once a rubber band anchored to it.)
- FR-026: The user shall activate the Wire tool by clicking a wire-tool button in the toolbar.
- FR-027: To draw a wire, the user shall click a source pin, then click a destination pin. The system shall create a wire between the two pins following the proposed route (FR-027c) current at the moment of the destination click. (Reworked 2026-06-12; supersedes the straight rat's-nest line — the committed wire now follows the Manhattan route proposal, with the straight line retained only as the router's fallback.)
- FR-027a: After the source is clicked and before the destination is clicked, the system shall display a rubber-band preview of the proposed route (FR-027c) from the source point to the current cursor position, recomputed as the cursor moves until the wire is committed or the gesture is cancelled. The same preview applies to bus drawing (FR-039). (Reworked 2026-06-12; supersedes the straight-line-only preview, which survives only as the router's fallback per FR-027c.)
- FR-027b: In select-tool mode, a component pin shall act as a wire hotspot, so the user can draw a wire without first activating the Wire tool. While in select-tool mode, hovering the cursor within a pin's hot region (FR-013d) shall change the cursor to the wire cursor (FR-025), and clicking there shall begin a wire from that pin exactly as the Wire tool does (FR-027/FR-027a); the wire is completed by the destination click and the application returns to select-tool mode (FR-028). Only pins are select-tool wire hotspots; clicks on wire segments, buses, bend points, and component bodies retain their existing select-tool meanings (FR-016, FR-031, FR-033b, FR-023a).
- FR-027c: The proposed route shall be a Manhattan (orthogonal) path from source to destination that avoids passing under component bodies, leaves a pin in the pin's facing direction (away from the component body), and prefers routes with few corners. Routing is best-effort: when no such route is found, the proposal shall degrade to the straight rat's-nest line. On commit, the route's corners shall become ordinary bend points, fully editable by the existing mechanisms (FR-031 through FR-033); a fallback straight proposal commits as a two-point wire, exactly as before.
- FR-028: After a wire is placed, the application shall automatically return to select-tool mode.
- FR-029: A wire or bus with exactly one connected endpoint shall be permitted (e.g., as a result of deleting a component).
- FR-030: A wire or bus with no connected endpoints shall be automatically removed from the design.

### 3.9 Wire Routing (Bend Points)

- FR-031: In select-tool mode, a plain click on a wire segment shall select the wire (enabling delete, FR-033a, and the context-menu/properties actions). A press-and-drag beginning on a wire segment shall insert a bend point at the nearest grid intersection to the cursor, dividing the segment in two, and shall continue dragging the new bend until release (FR-032). (Reworked 2026-06-10; supersedes the original "click inserts a bend" — selection-on-click matches the implementation and is needed for delete/properties.)
- FR-032: The user shall be able to drag a bend point to any grid intersection while holding the mouse button down; the two segments touching the bend point shall rubber-band continuously during the drag.
- FR-033: The user shall be able to right-click a bend point and select "Delete bend point"; the bend point shall be removed and the two segments it connected shall merge into one straight segment between the surrounding endpoints.
- FR-033a: In select-tool mode, the user shall be able to delete an entire wire or bus.
- FR-033b: A right-click on the canvas shall open a context menu offering the actions appropriate to the item under the cursor: a bend point offers "Delete bend point" (FR-033); a wire offers "Delete wire" (FR-033a); a bus offers "Set width…" (FR-038), "Edit bit names…" (FR-037b), and "Delete bus" (FR-033a); a component offers "Delete component" (FR-018a). The menu is dismissed by choosing an item, pressing Escape, or clicking elsewhere.

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

- FR-041: When the user drags a bus endpoint onto a component, the system shall determine which of the component's declared pin groups match the bus width. Each pin carries one bit, so a pin group matches when its number of member pins equals the bus width.
- FR-041a: If exactly one pin group matches the bus width, the system shall snap-connect the bus to that group automatically (per FR-042).
- FR-041b: If more than one pin group matches the bus width, the system shall prompt the user to choose which matching group to connect to, presenting the candidate groups by name; the user may cancel the connection. (This supersedes any rule that silently selects a default group on a tie.)
- FR-042: When a pin group is connected — automatically per FR-041a or by the user's choice per FR-041b — the system shall connect each bit of the bus to the corresponding pin in the group's declared bit order, without requiring the user to wire each pin individually.
- FR-043: If no pin group matches the bus width, the bus endpoint shall be left unconnected. (Supersedes the earlier rule that attached the endpoint to the nearest pin only: an unmatched drop now connects nothing rather than guessing a single pin.)
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
- FR-057: Each component instance record shall include: component type name, reference designator, canvas position, rotation, and a full copy of the type's data from the YAML file at the time of save.
- FR-058: Per-instance overrides of type data (e.g., a custom propagation delay for a specific instance) shall be stored alongside the copied type data in the instance record.
- FR-059: Each wire route record shall include: the two endpoint references and an ordered list of bend-point grid coordinates. An endpoint reference shall be one of: (a) a component pin (U-number and pin name), (b) a junction on another wire or bus (FR-034b), or (c) a free canvas grid coordinate if the endpoint is dangling.
- FR-059a: The saved design shall represent electrical connectivity (the set of nets per FR-034b) in a form derivable without reference to pixel geometry, so that a later tool can determine which pins are electrically connected.
- FR-060: Each bus route record shall include: the same endpoint and bend-point data as a wire, plus the bus width in bits and any pin-group connection data for snap-connected endpoints.
- FR-060a: For buses, the saved design shall additionally include any per-bit signal names (FR-037b) and any single-bit breakout connections (FR-043a), such that the net membership of each individual bus bit — including which bus and bit each net originates from — is derivable without reference to pixel geometry (consistent with FR-059a).

### 3.17 Component Definition (YAML File)

- FR-061: Each TTL component type shall be defined by a YAML file (`.yaml` extension), parsed by the server. (The format was designed collaboratively; see design.md §7.6.)
- FR-062: The YAML file shall specify: component type name; the rectangular outline dimensions (either stated directly or derived from the author-placed pins per FR-062b); and for each pin: its name, the side of the rectangle it appears on (left, right, top, bottom), and its position along that side. Power and ground pins shall not be represented in the YAML file, the editor, or the simulation.
- FR-062a: The YAML file shall specify each pin's electrical direction, which shall be one of exactly: input, output, bidirectional, or tristate-capable, so that high-impedance behavior and signal direction can be represented in a later simulation phase. There is no power/ground direction (see FR-062).
- FR-062b: Outline dimensions may be stated explicitly in the YAML file; if omitted, the server shall derive the outline from the author-placed pins. Each pin may optionally carry a physical pin number, which is footprint/BOM metadata only and shall not be used for drawing or simulation. (Supersedes the earlier declared-package mechanism: the standard-physical-package keyword, the package-name grammar, and the package table/generator are removed entirely, because power/ground — the only reason the physical package affected the symbol — are no longer represented.)
- FR-062c: The YAML file shall optionally specify `rendertype` (`unit` — the default — or `subunit`). For `rendertype: subunit` it shall additionally specify `numunits` (the number of functional units in the package) and `renderas` (the schematic symbol, per FR-013b), and each pin shall specify its `unit` (FR-014a) in place of a position. A `unit`-rendered component is drawn as the rectangle of FR-013.
- FR-062d: The YAML file shall optionally specify `clock: <pin name>`, naming the input pin that clocks the component's registered (`.R`) behavior outputs (FR-079). The key is required when the behavior block uses `.R` and meaningless otherwise; the parser shall verify the named pin exists and has direction input. (This makes explicit the named-clock convention first established in 74574.yaml's behavior comment.)
- FR-063: The YAML file shall optionally specify one or more named pin groups, each listing the pins that form a bus and their bit order, to support bus snap-connection (FR-041 through FR-043).
- FR-064: The YAML file shall optionally specify propagation delay values for the component.
- FR-065: The server shall expose the parsed component library to the browser application via an API endpoint.
- FR-066: The YAML file format shall accommodate later addition of behavioral logic equations (in GALasm form, per the vision statement) to a component definition without requiring changes to the editor or breaking the existing parser. The editor phase shall ignore any behavioral content present.

### 3.18 Status Bar

- FR-072: The application shall display a status bar docked along the bottom edge of the window, spanning its full width. The status bar is composed of trays: visually distinct regions, each rendered with a raised drop-shadow appearance (consistent with the palette tiles, FR-006), each reflecting some aspect of the program's state.
- FR-073: A state tray at the lower-left corner of the status bar shall display the program's current operating state (e.g., "editing", "simulating"). Until the simulator exists, the only state is "editing".
- FR-074: A message tray occupying the remaining width of the status bar (to the right of the state tray) shall display occasional messages posted by the application. The tray shows the most recent message; a message persists until replaced or cleared, and the tray is empty when no message is current.

### 3.19 Slow (Debug) Simulator

- FR-075: The application shall provide a slow ("debug") simulator, implemented in JavaScript in the browser front end, that executes the current design live on the editing canvas. It interprets the behavior of every component participating in the schematic: GALasm behavior blocks for 74-series types (FR-079) and registered behaviors for built-ins (FR-067a). The fast engine (C-code generator) is a future phase; nothing in the slow simulator's design shall preclude it.
- FR-076: The toolbar shall provide a button labeled "Run". Clicking it starts the simulation, relabels the button "Stop", and sets the state tray (FR-073) to "simulating". Clicking "Stop" — or automatic termination per FR-085 — ends the simulation, restores the "Run" label, and returns the state tray to "editing".
- FR-077: The simulator shall represent exactly four signal values on every net: logic 0, logic 1, U (undefined), and Z (high impedance, a tristate net with no enabled driver). A component reading Z from a net treats it as U; any logical combination involving a U operand yields U.
- FR-078: The simulator shall use a unit-delay timing model with 1 unit = 1 simulated nanosecond. At each unit step, every component computes its outputs from the net values of the previous step, and all nets then update simultaneously (double-buffered evaluation). Every component's outputs thus respond exactly one unit after its inputs, regardless of internal complexity, so logic settles in a deterministic, observable sequence; the YAML propagation delays (FR-064) are not used by the slow simulator.
- FR-079: For 74-series types, the simulator shall parse and evaluate the YAML behavior block per the GALasm reference (`galasmManual.txt`): flat sum-of-products equations; the declaration/use polarity XOR rule; plain, `.T` (tristate), and `.R` (registered) outputs; single-term `.E` enables; `AR`/`SP`; and the `VCC`/`GND` constants. `.R` outputs latch their sum-of-products value on the rising edge (0→1 transition between consecutive steps) of the component's declared clock pin (FR-062d). All registers power up as U.
- FR-080: A 74-series type whose YAML has no behavior block shall leave its outputs at U for the entire run; the simulator shall report each such type once via the message tray (FR-074) when the simulation starts.
- FR-081: At every step the simulator shall evaluate all drivers of every net — including every driver of a tristate net, so that conflicts are always detectable. A net's value is: the common value of its enabled (non-Z) drivers if they agree; Z if it has no enabled driver and no weak driver (FR-083); the conflict result of FR-082 otherwise.
- FR-082: A bus conflict — enabled drivers of one net disagreeing 0-versus-1 — shall set the net to U and be reported visually: all of the net's wire/bus segments render red for as long as the conflict persists, and the message tray (FR-074) names the conflicting drivers (e.g., "bus conflict: U3.Q0 vs U7.B2"). The simulation continues running.
- FR-083: The pull-up and pull-down built-ins (FR-069, FR-070) are weak drivers: they determine the net value (1 for pull-up, 0 for pull-down) only when the net has no enabled strong driver; an enabled strong driver overrides them silently. A pull-up and a pull-down on the same net with no enabled strong driver is a conflict per FR-082.
- FR-084: The clock built-in (FR-071, FR-071a) shall output a square wave with 50% duty cycle derived from its effective `period` property: low from t = 0, with the first rising edge after half a period. The simulation shall advance period × speed simulated nanoseconds (unit steps) per real second of wall-clock time, per the effective `speed` property. If multiple clock generators are placed, each toggles per its own `period`, and the pacing rate is the maximum period × speed over all of them.
- FR-085: A design containing no clock generator is purely combinational and shall be simulated as a single implicit clock cycle: the simulator runs unit steps as fast as practical (unpaced) until no net changes value between consecutive steps, displays the results, and terminates automatically (per FR-076). If the design has not settled within a bound of 10,000 units, the simulator shall report this via the message tray and terminate. Final indicator values remain displayed after termination until the design is next modified.
- FR-086: A design containing at least one clock generator is sequential and shall run, paced per FR-084, until stopped via the toolbar button (FR-076).
- FR-087: While the simulation is running, the design shall be read-only: placing, wiring, moving, rotating, deleting, property/override editing, undo/redo, New, and Open shall be disabled; pan, zoom, selection, and Save shall remain available.

### 3.20 Type Data Refresh

- FR-088: The application shall provide a "Refresh Types" action (toolbar) that re-copies type data from the currently loaded component library into the placed instances of the open design, so edited component definitions reach existing instances without deleting and re-placing them (placement-time copies otherwise persist indefinitely per FR-057). For each instance whose type name exists in the library — built-ins refresh from the client registry (FR-067) — the copied type data is replaced while preserving position, rotation, reference designator, wiring, and per-instance overrides (FR-058); an override key that no longer matches any delay or declared property in the new definition is dropped. An instance shall be skipped — left unchanged and reported once per type via the message tray (FR-074) — when the new definition is structurally incompatible: its render type changed, or a pin currently referenced by a wire or bus connection no longer exists (for subunit packages: no longer exists in the same unit). The whole action is one undoable operation (FR-024) and is unavailable while simulating (FR-087). The action reads the client's already-loaded library: picking up YAML edits still requires a server restart and page reload first (FR-007).

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
| ComponentType | name, outline dimensions (stated or derived from pins), pins (name, side, position, direction, optional pin number), pin groups, propagation delays, properties (name, unit, default — FR-020b), (future) behavioral equations | Loaded from YAML files at server startup; built-in types defined in the client (FR-067), with behaviors in a client registry (FR-067a) |
| ComponentInstance | type name, U-number, canvas position (x, y), rotation (0/90/180/270), copied type data, per-instance overrides | One per placed component in a design |
| Pin | name, side, position along side, direction (in/out/bidir/tristate), optional physical pin number | Defined in YAML file; carries exactly one bit; referenced by wires and buses |
| PinGroup | name, ordered list of pins | Optional; declared in YAML file; enables bus snap-connect |
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
- The fast simulation engine (C-code transpiler) is out of scope; the slow debug simulator is in scope (§3.19).

**Assumptions:**
- The user runs a modern desktop browser (Chrome or Firefox); mobile browser support is not required.
- The component-definition file format has been designed and agreed upon (YAML; design.md §7.6) and is capable of expressing all data described in FR-062 through FR-064.
- A single instance of the server runs per user; concurrent multi-session access is not required.
- Design files fit comfortably in memory; no streaming or chunked I/O is needed for save/load.

---

## 8. MVP Scope

The minimum set of requirements needed for a usable first release:

**Server:** FR-001, FR-002, FR-003, FR-050, FR-061 through FR-066 (component library loading, pin direction, YAML forward-compat, API), FR-046 through FR-048 (save), FR-052 through FR-053 (open/list).

**Canvas and tools:** FR-004, FR-007, FR-021 through FR-024 (grid, zoom, pan, undo/redo), FR-005 through FR-006 (palette), FR-008 through FR-015 (placement and appearance), FR-016 through FR-018a (selection, movement, delete), FR-019 through FR-020 (rotation).

**Wiring:** FR-025 through FR-034b (wire tool, routing, bend points, branching, fan-out, connectivity), FR-033a (delete wire/bus).

**Buses:** FR-035 through FR-040 (bus tool, rendering, width), plus FR-037a (per-bit net semantics) and FR-039a (unequal-width connection prevention). Bus snap-connect and its extensions — FR-041 through FR-043a (group matching, disambiguation, leave-unconnected on no match, single-bit breakout) and FR-037b (bus bit names) — may be deferred to a follow-on iteration, but the save format (FR-060a) and connectivity model must accommodate them from the outset.

**File format:** FR-055 through FR-060, plus FR-059a (connectivity representation).

**Deferred from MVP but specified:** FR-020a (per-instance overrides UI), FR-049a (unsaved-changes warning) are desirable but may slip to a follow-on iteration.

---

## 9. Open Questions

- OQ-001: RESOLVED. The component-definition file format is YAML (design.md §7.6, binding). The previously-contemplated package mechanism (optional package type, the `DIP-16`/`DIP-24/0.6` naming grammar, and the package table/generator) was removed entirely; outlines are stated explicitly or derived from pins (FR-062b).
- OQ-002: Bus snap-connection and its extensions (FR-041 through FR-043a) may prove complex enough to warrant their own design pass; they are noted as potentially deferrable from the MVP. Disambiguation on multiple width-matches (FR-041b) and single-bit breakout (FR-043a) have now been specified following stakeholder discussion.
- OQ-003: Server-assisted file navigation (FR-053) may be difficult to implement cleanly in the browser; the fallback to a recent-files list (FR-054) should be kept as a ready alternative.
- OQ-004: The exact grid spacing (1 mm vs. 2 mm equivalent at default zoom) and the default zoom level are not yet specified.
- OQ-005: Whether the Bus tool reverts to select-tool mode after placing one bus (consistent with the Wire tool) was not explicitly confirmed — assumed yes for consistency.
- OQ-006: The platform-standard application data directory varies by OS (e.g., `~/Library/Application Support` on macOS, `~/.local/share` on Linux, `%APPDATA%` on Windows). The server should handle all three; the primary development platform is not yet confirmed.
- OQ-007: The exact representation of electrical nets and wire-to-wire junctions in the JSON save format (FR-034b, FR-059a) needs to be settled as part of the save-format and YAML-format design session, since it affects both. This now also covers per-bit bus net representation and provenance (FR-037a, FR-060a); the design phase has proposed a first-class-vertex graph with per-bit lanes as the chosen representation.
- OQ-008: RESOLVED. The pin-direction set is exactly input/output/bidirectional/tristate (FR-062a). Power and ground are not represented anywhere, so no power/ground direction is required; the four directions map cleanly to the future four-level logic model.
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
| GALasm | A logic-equation language used to describe TTL component behavior in YAML files (simulation phase) |
| Grid | A uniform lattice of points covering the canvas; all design elements snap to grid intersections |
| Junction | A point at which a wire branches from another wire or bus, electrically tying them together |
| Net | The set of pins and wire/bus segments that are all electrically connected through pins and junctions |
| Palette | The panel displaying available component types as tiles, from which the user selects components to place |
| Pin group | A named set of pins declared in a YAML file that collectively form a bus interface |
| Rat's nest wire | A straight-line wire drawn directly between two pins before the user has routed it with bend points |
| Reference designator | A unique identifier assigned to each component instance (e.g., U1, U2) |
| Rubber-banding | The real-time stretching of wire segments as the user drags a bend point or component |
| Select tool | The default canvas mode in which the user can select, move, and interact with existing elements |
| Slow simulator | The interpretive, in-browser debug simulation engine (§3.19), as opposed to the future fast engine (a generated standalone C program) |
| Strong / weak driver | A component output is a strong driver of its net; the pull-up/pull-down built-ins are weak drivers, effective only when no strong driver is enabled |
| Unit delay | The slow simulator's timing model: every component's outputs respond exactly one unit (1 simulated ns) after its inputs, regardless of internal complexity |
| Snap-connect | The automatic connection of all pins in a declared pin group when a matching bus is dragged onto a component |
| TTL | Transistor-Transistor Logic; a family of digital logic components (e.g., 74xx series) |
| Wire | A single-bit signal connection rendered as a thin black line |
| YAML file | The component-definition file (`.yaml`; design.md §7.6) defining the name, pin layout, pin directions, pin groups, optional timing, and (eventually) the GALasm behavior of one TTL component type |
