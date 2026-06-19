# retrosim — User Manual

retrosim is a localhost-only schematic editor and slow ("debug") simulator for
TTL/74-series digital logic. You place 74-series parts and a handful of built-in
objects on a grid canvas, wire them together (single-bit wires and multi-bit
buses), and run a four-valued logic simulation directly on the schematic.

This manual assumes you are comfortable with digital simulation and have used a
schematic editor such as KiCad. The canvas interaction model is deliberately
KiCad-like.

---

## 1. Building and running

There is no binary distribution; you build and run the server yourself. The
server is a small Go program that serves the single-page web app and reads/writes
design files on your machine. Everything stays on `localhost` — it is a
single-user, single-machine tool.

**Requirements**

- Go 1.24 or later.
- A modern desktop browser: Chrome or Firefox.

**Build**

From the repository root:

```sh
(cd srv && go build -o ../retrosim ./cmd/retrosim)
```

This produces a `retrosim` executable in the repository root.

**Run**

```sh
./retrosim --web-dir=./web --components-dir=./srv/components
```

The server binds `127.0.0.1:8137` only. Open <http://127.0.0.1:8137> in your
browser. Designs are saved by default under `~/Documents/retrosim`
(`%USERPROFILE%\Documents\retrosim` on Windows), created on first use.

**Build and run in one step**

The `build-run` script does a clean rebuild and then launches the server,
forwarding any extra flags:

```sh
./build-run
```

**Flags**

- `--addr` — loopback host:port to bind (default `127.0.0.1:8137`; non-loopback
  addresses are refused).
- `--components-dir` — directory of 74-series component YAML files
  (default `./srv/components`).
- `--web-dir` — directory of the web app assets (default `./web`).
- `--data-dir` — designs root (default: the documents folder above).

The component library is read once at startup. If you edit a component YAML file,
you must restart the server and reload the page for the change to be loaded.  You must use the refresh button to update a design from the catalog (see
[Refreshing type data](#9-refreshing-type-data)). The one exception is creating a
GAL part in-app (see [Creating a custom GAL part](#creating-a-custom-gal-part-22v10)),
which is added to the running library and palette without a restart.

---

## 2. The workspace

The window has four regions plus a status bar:

- **Toolbar** (top): `Select`, `Wire`, `Bus`, zoom `−` / `+`, `Undo`, `Redo`,
  `New`, `Open`, `Save`, `Save As`, `Refresh`, `Run`. The current design name and
  tool mode are shown next to the buttons; an asterisk marks unsaved changes.
- **Palette** (left): split into two scrolling regions. The **upper** region
  holds the loaded parts — 74-series parts plus any custom GAL parts you author
  (see [Creating a custom GAL part](#creating-a-custom-gal-part-22v10)), including
  a **+ GAL** tile that opens the authoring dialog; the **lower** region holds the
  built-in objects (see [Built-in components](#11-built-in-components)).
- **Canvas** (center): the grid drawing surface. Everything snaps to grid
  intersections.
- **Properties panel** (right): shows the type data and per-instance overrides of
  a single selected component (see [Per-instance overrides](#8-per-instance-overrides)).
- **Status bar** (bottom): a **state tray** ("editing" / "simulating") on the
  left, a **message tray** for occasional messages, and a **connection tray**
  showing "connected" / "disconnected".

The app opens with an empty, unsaved design named `unnamed schematic <date time>`.

---

## 3. Placing components

Palette tiles are labeled by part number with the leading `74` removed (so `74138`
shows as `138`, `7400` as `00`); the full name is the tile's tooltip. Built-in
tiles show an icon instead. A **custom GAL part** tile shows its device family
(`22V10`) and uses its **part number** as the tooltip, so several GAL parts of the
same family stay distinguishable on hover.

To place a part, either:

- **Click** a palette tile to arm it, then **click** a spot on the canvas, or
- **Drag** a tile onto the canvas and drop it.

After a single placement the tool returns to Select. 74-series parts are numbered
`U1`, `U2`, …; built-in objects are numbered `A-1`, `A-2`, ….

Some 74-series parts (e.g. `7400`, `7402`, `7404`, `7432`, `7486`) are **multi-unit
packages**: they are drawn as separate gate symbols, one per unit, and all units
are dropped at once, slightly offset. Each unit is independently selectable,
movable, and rotatable, but deleting any one unit deletes the whole package (after
a confirmation).

### Creating a custom GAL part (22V10)

Unlike the fixed-function 74-series parts, a GAL22V10 is **programmable** — its
logic is yours to define. Instead of hand-editing a YAML file you can author one
in-app: click the **+ GAL** tile in the upper palette region to open the **New GAL
part** dialog. It presents the chip's fixed 24-pin skeleton (pin 1 is the
clock/input, pins 2–11 and 13 are inputs, pins 14–23 are the ten I/O "OLMC" pins,
pins 12/24 are ground/power) and collects only what varies between parts:

- **Part number** — a required, unique name for this specific programmed part
  (e.g. `PC-DECODE-A`). Since every 22V10 tile is labeled `22V10`, the part number
  is how you tell them apart; it is also the chip's on-canvas label.
- **Description** — an optional one-line summary (shown in the tile's tooltip).
- **Pin labels** — a name for each input and I/O pin.
- **Per-I/O direction** — for each OLMC pin: **comb out** (combinational output),
  **reg out** (registered output, clocked by pin 1), or **input**.
- **Behavior** — the logic as GALasm sum-of-products equations (the same dialect
  used by the 74-series behavior blocks).

As you type, the behavior is **validated live against the real GAL22V10**: the
status line shows a green check when it is acceptable, or the specific problem
otherwise, and **Create** is disabled until it passes. This is the same strict
check the simulator applies at Run, so a part you can create is one you could
later produce on an actual device with GALasm.

**Create** saves the part into the component library (as a YAML file named after
the part number) and adds its tile to the upper palette **immediately** — no
restart. From there it places, wires, and simulates like any other part. (Cancel
discards it.)

---

## 4. Navigating the canvas

- **Zoom:** mouse wheel (zooms toward the cursor), or the toolbar `−` / `+`
  buttons (zoom about the canvas center).
- **Pan:** drag with the **middle** mouse button, or hold **Space** and drag with
  the left button.
- **Recenter:** **right-click on empty canvas** — the clicked point becomes the
  new center of the view (zoom unchanged).
- **Context menu:** **right-click on an object** (component, wire, bus, or bend
  point) opens a menu of actions for that object.

> Note: left-dragging empty canvas does **not** pan; it draws a selection
> rectangle (next section).

---

## 5. The selection model

This is the heart of the editor and follows KiCad's conventions.

**Clicking**

- **Left-click an object** selects it, replacing any current selection.
- **Shift + left-click** toggles an object in or out of the selection, so you can
  build up a set of components, wires, and buses of any mix.
- **Left-click empty canvas** clears the selection (Shift+click preserves it).

**Rubber-band (box) selection** — left-drag on empty canvas:

- **Drag to the right** → **window** selection (solid blue box): only objects that
  lie **entirely inside** the box are selected.
- **Drag to the left** → **crossing** selection (dashed green box): **any object
  the box touches** is selected.
- Only the horizontal direction matters; up vs. down is irrelevant.
- The selection updates **live** as you drag. Hold **Shift** to add the box's hits
  to the existing selection. Press **Esc** to cancel and restore the previous
  selection.

**Acting on the selection**

- **Move:** drag any selected component; the whole selection moves together,
  snapping to grid. Wiring that is *interior* to the selection — bend points and
  junctions of wires/buses whose every endpoint is on a moving component — travels
  rigidly with it. Wires running to a component you did **not** select stay
  anchored at that end and stretch (re-route them yourself).
- **Rotate:** press **`r`** to rotate the selection 90° clockwise, **`Shift+r`**
  for counter-clockwise. The whole selection turns together as one rigid group
  about a single pivot — components **and** the bend points and junctions interior
  to the selection — so the sub-circuit keeps its shape. A lone component rotates
  in place about its own origin; a multi-component selection turns about the
  centre of its bounding box.
- **Delete:** press **Delete** or **Backspace** to remove every selected object.

Move, rotate, and delete each apply as a single undo step.

The **properties panel** is shown only when exactly one component is selected.

---

## 6. Wiring

Wires are single-bit nets, drawn as thin black lines.

- Activate the **Wire** tool (toolbar or press **`w`**). Click a **source pin**,
  then a **destination pin**. As you move the cursor a rubber-band preview shows
  the proposed **Manhattan route**, which avoids passing under component bodies,
  avoids lying on top of existing wires and buses, and prefers few corners; the
  route's corners become editable bend points. Wires may **cross** (meet at a
  single point) but never run on top of one another, so a busy area pushes more
  routes onto a straight (direct) line. If no clean route is found, the preview
  falls back to that straight line. After a wire is placed the tool returns to
  Select.
- **Pin hotspot:** in Select mode, hovering a pin shows the wire cursor; clicking
  it starts a wire without switching tools.
- **Bends:** in Select mode, **drag a wire segment** to insert a bend point at the
  nearest grid intersection and drag it; **drag an existing bend** to move it;
  **right-click a bend** → "Delete bend point" to remove it and merge the segments.
- **Branching:** with the Wire tool active, clicking an existing wire segment
  starts a new branch from that point (an electrical junction, shown as a black
  dot). A single pin may also drive several wires (fan-out).
- **Moving a junction:** in Select mode, **drag a junction dot** to a new grid
  intersection. Because a junction is one shared connection point, every wire and
  bus that meets there follows it and the branch stays connected — the move
  changes only the layout, never the wiring.
- A wire with one dangling end is allowed (e.g. after deleting a component); a wire
  with no connected ends is removed automatically.

Connectivity is by pins and junctions, not pixels — the saved design records the
set of electrical nets independently of geometry.

---

## 7. Buses

Buses carry N independent single-bit signals and are drawn as thick blue lines
with a `/N` width annotation.

- Use the **Bus** tool (or press **`b`**). Drawing, bends, and branching work just
  like wires.
- **Right-click a bus** for: **Set width…**, **Edit bit names…**, and
  **Delete bus**. (With exactly one bus selected you can also press `+` / `-` to
  change its width.)
- **Snap-connect to a pin group:** the editor connects a whole bus to a matching
  **pin group** — a set of pins whose count equals the bus width (e.g. the 8 `D`
  inputs of a `74574`, or the 8 bits of an 8-wide port/indicator) — wiring each bus
  bit to the corresponding pin in declared bit order, so you don't wire bits one at
  a time.
  - With the **Bus** tool active, move the cursor **near a group's pins** — you do
    **not** need to click on the part body. A large **curly brace** appears,
    enclosing the group and opening toward its pins, with the bus running to the
    brace's **point** (the connection point). Click while the brace is showing to
    start or finish the bus there. The same works at both ends.
  - If several groups are in range (e.g. the 574's `D` inputs and `Q` outputs) the
    brace snaps to the group **nearest the cursor**. (Clicking the part body still
    works too: one matching group connects automatically; several prompt you to
    choose; none connects nothing.) Joining two buses of unequal width is prevented.
  - A **connected** bus end is always drawn with its curly brace; a **red square**
    marks an end that is still **dangling** (unconnected). The brace tracks the part
    if you move or rotate it.
- **Bit names:** a bus may carry a name per bit; snap-connecting to a named pin
  group adopts those names (bit position, not name, determines connectivity).
- **Breakout:** you can break a single bit out of a bus and route it as an ordinary
  wire; the broken-out wire is electrically part of that bus bit's net.

---

## 8. Per-instance overrides

Select a single component to view its type data in the properties panel. The
read-only fields show the part's size and pin count; editable fields let you
override numeric values — such as propagation delays, or a built-in's declared
properties (e.g. a clock's `period`) — **for that instance only**. Overrides do
not affect other instances or the underlying YAML, and are saved with the design.

---

## 9. Refreshing type data

When you place a part, the editor copies the type's data (pins, delays, behavior)
into the instance and keeps that copy with the design forever (so opening an old
design always reproduces the parts it was built with). If you later edit a
component definition, existing instances keep their old copy.

The **Refresh** button ("Refresh Types") re-copies type data from the **currently
loaded** component library into every placed instance whose type still exists —
74-series parts from the library, built-ins from the app's registry. For each
refreshed instance it preserves position, rotation, reference designator, wiring,
and your per-instance overrides; an override that no longer matches any delay or
property in the new definition is dropped.

An instance is **skipped** (left unchanged, and reported once per type in the
message tray) if the new definition is structurally incompatible — its render type
changed, or a pin currently used by a wire or bus no longer exists. Refresh is one
undo step and is disabled while simulating.

Important: Refresh reads the library **already loaded in the browser**. To pick up
edits you made to a YAML file on disk, you must first **restart the server and
reload the page**, then use Refresh to push the new definitions into an existing
design.

---

## 10. Files

- **New** — start a fresh empty design. You're warned first if the current design
  has unsaved changes.
- **Open** — browse the server's filesystem (a dialog backed by the server, not the
  browser's native picker) and open a design. You're warned about unsaved changes.
- **Save** — the first save prompts for a filename (pre-filled with the design
  name); later saves overwrite the same file silently. Saving under a different
  file name renames the design to that file's base name.
- **Save As** — save under a new name at any time.

Designs are JSON files, stored by default in `~/Documents/retrosim`; you can choose
a different location in the dialog. The unsaved-changes indicator (an asterisk by
the design name) tells you when there is work to save. Saving is allowed even while
simulating.

---

## 11. Built-in components

Built-in objects live in the lower palette region. Once placed they behave like
ordinary component instances (selectable, movable, rotatable, deletable, wireable)
and are designated `A-1`, `A-2`, …. Their behavior is defined by the app, not by
YAML.

| Object | Pins | Behavior |
|---|---|---|
| **State indicator** | one input (`IN`, bottom) | Display only — drives nothing. Shows the value of the connected net (0 / 1 / U / Z); a gray "?" bubble when undriven or at rest. Use it to watch a signal during a run. |
| **Pull-up** | one output (`OUT`, bottom) | A **weak** driver of logic **1**: sets the net to 1 only when no enabled strong driver is present; any strong driver overrides it silently. |
| **Pull-down** | one output (`OUT`, top) | A **weak** driver of logic **0**, symmetric to the pull-up. A pull-up and pull-down on the same net with no strong driver is a conflict. |
| **Clock** | one output (`OUT`, right) | A square wave, 50% duty cycle: low from t = 0 with the first rising edge half a period in. Properties: `period` (ns, default 100) and `speed` (Hz, default 1). A design with a clock is *sequential* and runs continuously; see [Simulation](#13-simulation). |
| **Power-on reset** | two outputs (`R` active-high, `/R` active-low, right) | Asserts reset (`R`=1, `/R`=0) for the first `cycles` clock periods of a run, then releases (inverse afterward). Property: `cycles` (default 3). |
| **Input switch** | one output (`OUT`, right) | A user-set logic source with two states, **1** and **0**, drawn like the state indicator — a round value bubble (white **1** / black **0**) — with a small arrow toward its output pin. A **strong** driver: it overrides pull-ups/pull-downs on its net. Set its state in the properties panel while editing, or **click it during a simulation** to toggle **0 ↔ 1**. The state is saved with the design (a new switch starts at **0**). |
| **State indicator (8-wide)** | eight inputs (`D0`–`D7`, left) | An 8-bit display, drawn as an LED **bar-graph** (eight stripes). Display only — drives nothing. The eight pins form one pin group, so an 8-wide bus snap-connects to all bits at once (see [Buses](#7-buses)); each stripe shows its bit's value (white **1** / black **0** / gray **?**) during and after a run. |
| **Port / off-sheet connector (8 wide)** | eight pins (`P0`–`P7`, left) | An 8-bit off-sheet connector, drawn as eight narrow pentagons — one roughly aligned with each pin, each pointing off-sheet away from the pins. The eight pins form one pin group so an 8-wide bus snap-connects to all bits at once (see [Buses](#7-buses)). It is a bus terminal for now: it drives nothing and does not yet join to same-label or cross-file ports (that's the 1-wide [port](#12-sub-designs-and-ports)'s job today). |

You can override a built-in's properties per instance via the properties panel
(e.g. give one clock a different `period`). The input switch is set the same way:
select it and choose its state (`1` / `0`) in the properties panel.

**Interactive inputs.** The input switch is an *interactive input* — a built-in
you can change by hand **while a simulation is running**: click its body and the
simulation immediately re-evaluates from the new value (see
[Simulation](#13-simulation)). This is the one kind of design change allowed
during a run.

---

## 12. Sub-designs and ports

A saved design can be **embedded** in a larger design as a single component (a
*sub-design*), letting you build a circuit hierarchically. The interface between
the two is defined by **ports**.

**Ports.** A port is a built-in object (lower palette region, the flag glyph)
that marks a net as part of the design's external interface. It is drawn as a
**pentagon**: the body carries the label, the flat back edge holds the
connection pin (facing into the sheet), and the apex points off-sheet. The apex
keeps its relationship to the pin as you rotate the part, while the label stays
upright. Place it like any built-in and wire its single connection point into
your circuit. Select a port to edit its three fields in the properties panel:

- **label** — the signal name. Within one design, **all ports with the same label
  are the same net**, so an interface signal can appear at several points on the
  sheet without a drawn wire between them. (A fresh port's label defaults to its
  `A-` designator, i.e. its own net until you name it.)
- **direction** — `in`, `out`, or `bidir`.
- **width** — bits (default 1; greater than 1 makes it a bus interface).

A design's **interface** is the set of its ports: one interface pin per distinct
label, carrying that label's direction and width. A design with no ports has no
interface and cannot be embedded.

**Embedding a sub-design (ADD).** The **ADD** tile (the dashed `+` box at the end
of the lower palette) embeds a saved design. Because the embedded design is
referenced by a path **relative to where the parent is saved**, the parent must
have a save location — if it doesn't, you'll be prompted to save it first.
Drop ADD on the canvas to open the *Add sub-component* dialog: choose a design
file (it must have ports), preview its interface, and pick how it should be drawn
— an **IC** rectangle (inputs left, outputs right) or a **connector** strip (all
pins along one edge). Confirm to place it. Sub-design instances are designated
`X1`, `X2`, … and are wired through their interface pins like any component.

The reference is **live**: the instance stores no copy of the child, so changes to
the child design appear in the parent the next time the parent is opened. If a
child file can't be found when the parent opens, its instance is drawn as a
red **broken-link** box naming the missing path, and the condition is reported in
the message tray — opening still succeeds.

**Moving between sheets.** **Double-click** a sub-design instance (or right-click
it and choose **Open sub-design**) to descend into the child design — it replaces
the editing canvas. A **← back** button appears in the toolbar; click it to return
to the parent. Descending and going back are each treated as closing the current
design, so the usual unsaved-changes prompt applies — save or discard before the
canvas changes. A plain New or Open leaves the hierarchy and clears the back path.

---

## 13. Simulation

retrosim ships with a **slow ("debug") simulator** that runs in the browser
directly on the editing canvas.

- **Run / Stop:** click **Run** to start; the button becomes **Stop** and the state
  tray reads "simulating". A run continues until you click **Stop**.
- **Values:** every net carries one of four values — **0**, **1**, **U**
  (undefined), **Z** (high-impedance / no enabled driver). A component reading Z
  treats it as U. Logic is selectively pessimistic (e.g. `0 AND U = 0`,
  `1 OR U = 1`); all registers power up as U.
- **Timing:** a unit-delay model where 1 unit = 1 simulated nanosecond. Every
  component computes its outputs from the previous step's net values, and all nets
  update together — outputs respond exactly one unit after their inputs. (The slow
  simulator does not use the YAML propagation delays.)
- **Combinational designs** (no clock) run unpaced until the nets stop changing,
  display the result, and then **idle** — the run stays active but uses no CPU
  until you change an interactive input (e.g. click an [input switch](#11-built-in-components)),
  which makes the circuit re-settle. They no longer stop on their own. If a
  settling pass doesn't reach a stable state within 10,000 units (a likely
  oscillation) that is reported in the message tray and evaluation pauses; press
  Stop to end. Final indicator values stay on screen until you next edit the design.
- **Sequential designs** (at least one clock) run continuously, paced at
  `period × speed` simulated nanoseconds per real second, until you press Stop.
- **Conflicts:** when enabled drivers of a net disagree 0-vs-1, the net goes to U,
  every segment of that net turns **red** while the conflict lasts, and the message
  tray names the conflicting drivers. The simulation keeps running.
- A 74-series part whose YAML has no behavior block holds its outputs at U and is
  reported once when the run starts.

While simulating, the design is **read-only** and the **selection is locked**:
placing, wiring, moving, rotating, deleting, overrides, undo/redo, New, Open, and
changing the selection are all disabled. Pan, zoom, right-click recenter, and Save
remain available. Starting a run clears the current selection and the message
tray; stopping a run clears the message tray again. A click that would normally
select an item instead shows "Editor is locked while the simulator is running" in
the status bar and changes nothing (a click on empty canvas does nothing). The one
exception is clicking an **interactive input** (the input switch), which changes
its value live and re-evaluates the simulation.

---

## 14. If the server disconnects

Your design's source of truth is the browser tab, so editing keeps working even if
the server goes away (the connection tray shows "disconnected"). **Do not reload
the page** — restart the server at the same address and port and the app will
reconnect. Server-dependent actions (Save, Open, directory listing) fail with a
clear message until then, without losing your work.

---

## 15. Keyboard and mouse reference

**Mouse (Select tool)**

| Action | Result |
|---|---|
| Left-click object | Select it (replaces selection) |
| Shift + left-click object | Toggle it in the selection |
| Left-click empty | Clear selection (Shift preserves) |
| Left-drag empty → right | Window select (enclosed only) |
| Left-drag empty → left | Crossing select (anything touched) |
| Drag a selected component | Move the whole selection |
| Drag a wire/bus segment | Insert and drag a bend point |
| Drag a bend point / junction dot | Move it (the junction carries every wire that meets there) |
| Middle-drag / Space+left-drag | Pan |
| Mouse wheel | Zoom to cursor |
| Right-click empty | Recenter view on the cursor |
| Right-click object | Context menu |
| Double-click a sub-design | Open it (descend); **← back** returns to the parent |
| Left-click input switch (while simulating) | Toggle its state `0 ↔ 1` |
| Left-click any other item (while simulating) | Selection is locked — status bar shows "Editor is locked while the simulator is running" |

**Keyboard**

| Key | Action |
|---|---|
| `w` | Wire tool |
| `b` | Bus tool |
| `r` / `Shift+r` | Rotate selection CW / CCW |
| `Delete` / `Backspace` | Delete selection |
| `+` / `-` | Change width of the one selected bus |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |
| `Space` (hold) | Pan with left-drag |
| `Esc` | Cancel the current gesture / tool / selection |
