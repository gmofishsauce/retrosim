# retrosim — User Manual

retrosim is a localhost-only schematic editor and slow ("debug") simulator for
TTL/74-series digital logic. You place 74-series parts and a handful of built-in
objects on a grid canvas, wire them together (single-bit wires and multi-bit
buses), and run a four-valued logic simulation directly on the schematic.

This manual assumes you are comfortable with digital simulation and have used a
schematic editor such as KiCad. The canvas interaction model is deliberately
KiCad-like.

---

## Contents

1. [Building and running](#1-building-and-running)
2. [The workspace](#2-the-workspace)
3. [Placing components](#3-placing-components)
4. [Navigating the canvas](#4-navigating-the-canvas)
5. [The selection model](#5-the-selection-model)
6. [Wiring](#6-wiring)
7. [Buses](#7-buses)
8. [Per-instance overrides](#8-per-instance-overrides)
9. [Refreshing type data](#9-refreshing-type-data)
10. [Projects and files](#10-projects-and-files)
11. [Built-in components](#11-built-in-components) — including [Text notes](#text-notes)
12. [Sub-designs and ports](#12-sub-designs-and-ports)
13. [Simulation](#13-simulation) — including [Pausing and single-stepping](#pausing-and-single-stepping), [Console output](#console-output), [Test vectors](#test-vectors) and [Generating a standalone C simulator](#generating-a-standalone-c-simulator)
14. [If the server disconnects](#14-if-the-server-disconnects)
15. [Keyboard and mouse reference](#15-keyboard-and-mouse-reference)

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

The component library has **two tiers**. The **shared library** (`--components-dir`,
the 74-series parts) is read once at startup; it is read-only and available in every
project. On top of it, each project layers its **own component types** — the GAL
parts and memory devices you author in-app — kept in a `components/` subfolder of the
project. A project's parts appear in the palette only while that project is current,
and layer over (never replace) the shared parts. If you edit a **shared** YAML file,
restart the server and reload the page to pick it up; a project's own `components/`
are re-read whenever you make that project current and by **File ▸ Refresh Types**.
After either kind of edit, use Refresh Types to push the new definitions into an
existing design (see [Refreshing type data](#9-refreshing-type-data)). Parts you
create in-app (see [Creating a custom GAL part](#creating-a-custom-gal-part-22v10))
appear in the running palette without a restart.

---

## 2. The workspace

The window has four regions plus a status bar:

- **Menu bar** (top): the **File** menu (`New Project…`, `Open Project…`,
  `Duplicate Project…`, `New`, `Open`, `Save`, `Save As`,
  `Export…`, `Refresh Types`), the **Edit** menu (`Undo`, `Redo`, `Copy`, `Paste`),
  the **View** menu (`Zoom In`, `Zoom Out`, `Fit to Screen`, `Console`), and the **Simulate**
  menu (`Test Vectors…`, `Generate C…`), followed by the tool buttons `Select`,
  `Wire`, `Bus` and the `Run` button. Menu items with a standard keyboard shortcut
  show it in the menu (see [§15](#15-keyboard-and-mouse-reference)). Click a menu to open it; click an item to run it, or
  press `Esc` / click elsewhere to dismiss it. The current **project** name, the
  current design name, and the tool mode are shown next to the buttons; an
  asterisk marks unsaved changes.
- **Palette** (left): split into two scrolling regions. The **upper** region
  holds the loaded parts — 74-series parts plus any custom GAL parts you author
  (see [Creating a custom GAL part](#creating-a-custom-gal-part-22v10)), including
  the **NEW GAL** and **NEW MEM** action tiles that open the authoring dialogs;
  the **lower** region holds the
  built-in objects (see [Built-in components](#11-built-in-components)).
- **Canvas** (center): the grid drawing surface. Everything snaps to grid
  intersections.
- **Properties panel** (right): shows the type data and per-instance overrides of
  a single selected component (see [Per-instance overrides](#8-per-instance-overrides)).
- **Status bar** (bottom): a **state tray** ("editing" / "simulating") on the
  left, a **message tray** for occasional messages, and a **connection tray**
  showing "connected" / "disconnected".

The app opens with **no project** — the bar reads `(no project)` and the canvas
is empty and inert: everything except **New Project…**, **Open Project…**, and
**Open** is disabled until you create or open a project (see
[Projects and files](#10-projects-and-files)). Every design you edit belongs to
a project.

---

## 3. Placing components

Palette tiles are labeled with the part's full name — `74138`, `7400`, etc. — in a
small font so a five-character name still fits; the tooltip repeats the name and
adds the one-line description when the part has one. Built-in tiles show an icon
instead. A **custom GAL part** tile shows its **part number** (e.g. `PC-DECODE-A`),
with the part number and description in the tooltip, so several GAL parts of the
same device family stay distinguishable. The displayed name is just a label —
internally each type has a fixed identifier — so you can rename a part freely (by
editing its YAML) without breaking designs that already use it.

To place a part, either:

- **Click** a palette tile to arm it, then **click** a spot on the canvas, or
- **Drag** a tile onto the canvas and drop it.

After a single placement the tool returns to Select. 74-series parts are numbered
`U1`, `U2`, …; built-in objects are numbered `A-1`, `A-2`, …. This number is the
component's **designator**; you can change the displayed designator to anything you
like in the properties panel (see [§8](#8-per-instance-overrides)) — including a
duplicate — without affecting wiring, since the editor tracks each component by a
stable internal identity, not by the text you see.

Some 74-series parts (e.g. `7400`, `7402`, `7404`, `7432`, `7486`) are **multi-unit
packages**: they are drawn as separate gate symbols, one per unit, and all units
are dropped at once, slightly offset. Each unit is independently selectable,
movable, and rotatable, but deleting any one unit deletes the whole package (after
a confirmation).

The `74165` 8-bit parallel-in/serial-out **shift register** is included as well. It
holds eight internal bits but exposes only the last stage — `Q7` and its complement
`Q7N` — shifting one bit toward that output per clock. One fidelity note: its
parallel load (`/PL` low) is modeled as **synchronous** (data is captured on a clock
edge), whereas the real chip loads asynchronously; in the usual pattern of loading
and then clocking the bits out, the two behave identically.

The `74595` 8-bit serial-in, serial/parallel-out **shift register with output
latches** is the complementary part. Serial data (`DS`) is clocked into the shift
register on the **shift clock** `SHCP`; a separate **storage clock** `STCP` transfers
the shift register's contents into an 8-bit latch driving the parallel outputs
`Q0`–`Q7`. Because it has two independent clocks, they are drawn as separate pins.
The parallel outputs are **3-state**, enabled by `/OE` (low); the master reset `/MR`
(low) asynchronously clears the shift register only, leaving the output latch
untouched. `Q7S` is the serial output of the last stage, for daisy-chaining chips.

The `74573` octal **transparent latch** is included too. Unlike a register it is
**level-sensitive, not edge-clocked**: while its latch-enable `LE` is **high** the
eight outputs `Q0`–`Q7` follow the data inputs `D0`–`D7` transparently, and the
`LE` high→low transition **latches** the current data, which the outputs then hold
while `LE` stays low. The outputs are **3-state**, enabled by `/OE` (low). The
simulator models this transparent behavior directly (with the usual one-unit
delay), so it needs no clock — a handy way to hold a bus value without a clock
edge. `D0`–`D7` and `Q0`–`Q7` are each a pin group, so buses snap to them.

### Creating a custom GAL part (22V10)

Unlike the fixed-function 74-series parts, a GAL22V10 is **programmable** — its
logic is yours to define. Instead of hand-editing a YAML file you can author one
in-app: click the **NEW GAL** tile in the upper palette region to open the **New GAL
part** dialog. It presents the chip's fixed 24-pin skeleton (pin 1 is the
clock/input, pins 2–11 and 13 are inputs, pins 14–23 are the ten I/O "OLMC" pins,
pins 12/24 are ground/power) and collects only what varies between parts:

- **Part number** — a required name for this specific programmed part
  (e.g. `PC-DECODE-A`). It is the part's display name: the palette tile's label,
  the tooltip, and the chip's on-canvas label, and is how you tell several parts of
  the same device family apart.
- **Description** — an optional one-line summary (shown in the tile's tooltip).
- **Pin labels** — a name for each input and I/O pin.
- **Per-I/O direction** — for each OLMC pin: **comb out** (combinational output),
  **reg out** (registered output, clocked by pin 1), or **input**.
- **Behavior** — the logic as GALasm sum-of-products equations (the same dialect
  used by the 74-series behavior blocks).
- **Pin groups** — optionally bundle pins into named groups so a bus can
  snap-connect to all of them at once (see [Buses](#7-buses)). Click
  **Pin groups…**, type a name, and check the member pins. A group's pins must
  all be on the **same side** of the part and **contiguous** (no non-member pin
  between them); the dialog refuses a group that breaks either rule and tells you
  why.

As you type, the behavior is **validated live against the real GAL22V10**: the
status line shows a green check when it is acceptable, or the specific problem
otherwise, and **Create** is disabled until it passes. This is the same strict
check the simulator applies at Run, so a part you can create is one you could
later produce on an actual device with GALasm.

**Create** saves the part into the **current project's** `components/` folder (as a
YAML file named after the part number) and adds its tile to the upper palette
**immediately** — no restart. From there it places, wires, and simulates like any
other part. The part belongs to this project: it shows in the palette while this
project is current, and is not visible in other projects. (Cancel discards it.)

### Creating a memory device (RAM/ROM)

Beside **NEW GAL** is the **NEW MEM** tile, which opens the **New memory device** dialog
to generate a RAM or ROM without writing YAML:

- **Type** — **RAM** or **ROM** (the radio at the top). Switching it resets the
  class-specific fields.
- **Name** — the device's display name, which also names its library file. It is
  pre-filled with a size-based suggestion (e.g. `RAM 256×8`) that keeps tracking
  the size until you edit it.
- **Address bits** *n* — the device has 2ⁿ locations (the count is shown beside
  the field).
- **Data width** — 4, 8, 16, or 32 bits.
- **ROM file** (ROM only) — the content file (`.bin` or `.hex`) whose bytes the
  ROM serves, chosen through the same file browser as Open. Its contents are read
  at each Run, so editing the file and re-running reloads it.
- **Save file** (RAM only, optional) — a persistent file (`.bin` or `.hex`) for the
  RAM's contents. Leave it empty for an ordinary RAM that starts blank every run.
  Use **Choose file…** to pick or name one, **Clear** to remove it. When set, the
  RAM is **written to this file when you press Stop** (see *Persistent RAM* below).
- **Load save file at start-up** (RAM only) — when checked (and a save file is set),
  the RAM is **loaded** from that file before the run begins, instead of starting
  blank.

The generated chip carries its address pins (group **ADDR**) and the control pins
`CE/`, `OE/`, and — on a RAM — `WE/` on the left edge, and its data pins (group
**DATA**) on the right, so a bus can snap-connect to the address or data lines all
at once.

**Create** saves the device into the **current project's** `components/` folder as a
YAML file named after its name and adds its tile **immediately** — no restart. Like a
custom GAL part it belongs to that project and **persists**: reopen the project and
the device is still in its palette, ready to place and simulate. Creation is one-way
for now — the app never overwrites an existing part, so a name that already exists
**in this project or in the shared library** is refused with an inline message; to
change a device, create one under a new name (or edit its YAML file directly and
restart).

#### Persistent RAM

Normally a RAM starts every run blank (every cell undefined). Giving a RAM a **save
file** makes its contents survive across runs — an unrealistic but handy convenience,
for example to keep a scratchpad or to preload a fixed pattern.

- **On Stop** — when you press Stop (a *normal* end of the run), the RAM's full
  contents are written to its save file. If the file doesn't exist yet it is created.
- **Abnormal end** — if the run ends abnormally (you close or reload the browser tab,
  or it crashes), nothing is written and any changes since the last Stop are lost.
- **On start-up** — if **Load save file at start-up** is checked, the RAM is filled
  from the save file before the run begins; otherwise it starts blank even if a save
  file is set (so you can save without auto-loading).
- **File format** — same as a ROM content file: `.bin` is raw bytes, `.hex` is
  whitespace-separated hex byte tokens, packed low-byte-first, one location after
  another. So you can prepare a file by hand and check **Load at start-up** to
  guarantee the RAM's initial contents.

A few details worth knowing:

- A cell that was never written (or holds an undefined value) is saved as **0** — the
  file format has no way to record "undefined", so a blank cell reads back as 0.
- A ROM content or RAM save file may live anywhere on disk, but keeping it
  **inside the project folder** has an advantage: the design stores it as a
  relative path, so **Duplicate Project** gives the copy its own file. An
  outside-project file stays a shared absolute path — the duplicate warns
  about it (see [Projects and files](#10-projects-and-files)).
- If **Load at start-up** is on but the file is missing or malformed, the run still
  starts (blank) and a message appears in the status bar — it is never an error. The
  file will then be created on the next Stop.
- The save file is written only for an **interactive** Run/Stop. Running **test
  vectors** never reads or writes it.
- The **standalone C simulator** (Generate C…) supports persistent RAM too. The
  save-file path and *Load at start-up* setting are baked into the generated
  program, which loads the file when it starts and writes the RAM back when the
  run finishes (in **both** its batch modes — test vectors and free-running). A
  missing or malformed file is non-fatal there too (the RAM starts blank and a
  note is printed). The path is baked in, so the file is found relative to where
  you run the program; there is no command-line option to override it.

---

## 4. Navigating the canvas

- **Zoom:** mouse wheel (zooms toward the cursor), or the **View** menu's
  `Zoom In` / `Zoom Out` items — `Ctrl/Cmd+=` / `Ctrl/Cmd+-` — which zoom about
  the canvas center.
- **Fit to Screen:** the **View** menu's `Fit to Screen` item sizes and centers
  the view so the whole design fits the canvas. This also happens automatically
  whenever you load a design (Open, or stepping into or back out of a
  sub-design), so a freshly loaded design always arrives framed in the view.
- **Pan:** drag with the **middle** mouse button, or hold **Space** and drag with
  the left button.
- **Recenter:** **right-click on empty canvas** — the clicked point becomes the
  new center of the view (zoom unchanged). If you then zoom **before moving the
  mouse**, the zoom is anchored on that new center, so the recentered point
  stays put — handy for "right-click a spot, then wheel in on it." Moving the
  mouse returns zoom to its usual zoom-toward-the-cursor behavior.
- **Context menu:** **right-click on an object** (component, wire, bus, or bend
  point) opens a menu of actions for that object.

> Note: left-dragging empty canvas does **not** pan; it draws a selection
> rectangle (next section).

**Labels thin out when zoomed out.** Component text is drawn at a fixed size, so
on a small symbol it would otherwise pile up into a knot of squiggles. As you
zoom out, a component drops its **pin name labels** first, then its **type/part
name**, leaving just the **U-number** (reference designator), which is always
shown. Zoom back in to bring them back. Larger parts keep their labels to a
lower zoom than small ones.

---

## 5. The selection model

This is the heart of the editor and follows KiCad's conventions.

**Clicking**

- **Left-click an object** selects it, replacing any current selection. Clicking a
  **wire or bus** selects just the **single segment** under the cursor (the stretch
  between two bends/endpoints), KiCad-style — not the whole conductor — and that
  segment is highlighted. (To select a whole wire/bus, rubber-band over it.)
- **Shift + left-click** toggles an object in or out of the selection, so you can
  build up a set of components, wires, buses, and segments of any mix.
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
- **Delete:** press **Delete** or **Backspace** to remove every selected object. If
  the selection is a single wire/bus **segment**, only that leg is deleted: cutting
  an interior leg leaves two wires each with a dangling end, and cutting an end leg
  leaves a shorter wire plus a now-unconnected pin. (Select several legs of one
  conductor and delete to remove the whole conductor.) A dangling end shows as a
  small red square; you can later re-join two ends by drawing a wire onto one.
- **Copy / Paste:** **Copy** (Edit ▸ Copy or **Ctrl/Cmd+C**) puts the selected
  components — and the wiring *interior* to them (the same rule as Move) — onto a
  clipboard. **Paste** (Edit ▸ Paste or **Ctrl/Cmd+V**) drops a copy: a translucent
  ghost follows the cursor, and the next click places it, snapped to grid. The
  pasted parts get fresh reference designators (new `U`/`A` numbers; a multi-unit
  package takes one new `U` number), keep their interior wiring, overrides, and
  switch states, and become the new selection. Press **Esc** (or pick another tool)
  to cancel a pending paste. Copy selecting a single subunit copies its whole
  package. The clipboard lasts for the session (it survives New/Open) and is not
  the operating-system clipboard.

Move, rotate, delete, and paste each apply as a single undo step.

The **properties panel** is shown only when exactly one component is selected.

---

## 6. Wiring

Wires are single-bit nets, drawn as thin black lines.

- Activate the **Wire** tool (the `Wire` button or press **`w`**). Click a **source pin**,
  then a **destination pin**. As you move the cursor a rubber-band preview shows
  the proposed **Manhattan route**, which avoids passing under component bodies,
  avoids lying on top of existing wires and buses, and prefers few corners; the
  route's corners become editable bend points. Wires may **cross** (meet at a
  single point) but never run on top of one another, so a busy area pushes more
  routes onto a straight (direct) line. If no clean route is found, the preview
  falls back to that straight line. After a wire is placed the tool returns to
  Select.
- **Steering the route (locked waypoints):** while drawing, **click on empty
  canvas** to lock a corner at that grid point. The auto-router restarts from
  there and proposes the rest of the route as you keep moving, so you can shape a
  wire instead of taking one suggestion whole. Place as many as you like.
  **Backspace** removes the most recent one; **Esc** cancels the whole wire. Once
  the wire is finished the locked corners are just **ordinary bend points** — drag
  or delete them like any other. A wire is completed only by clicking a **real
  target** (a pin or an existing wire/bus segment); an empty-canvas click always
  adds a waypoint.
- **Pin hotspot:** in Select mode, hovering a pin shows the wire cursor; clicking
  it starts a wire without switching tools.
- **Bends:** in Select mode, **drag a wire segment** to insert a bend point at the
  nearest grid intersection and drag it; **drag an existing bend** to move it;
  **right-click a bend** → "Delete bend point" to remove it and merge the segments.
  Bend points that don't actually bend are tidied up automatically: a bend dragged
  back onto the straight line through its neighbours is removed, dragging a segment
  and releasing it still-straight adds no bend, and any straight-line corners
  (including locked waypoints) are dropped when the wire is completed. Buses behave
  the same way.
- **Branching:** with the Wire tool active, clicking an existing wire segment
  starts a new branch from that point (an electrical junction, shown as a black
  dot). A single pin may also drive several wires (fan-out).
- **Joining a dangling end:** starting or ending a wire **on an existing dangling
  end** (the small red square left when, say, a component was deleted) joins the
  two wires into one continuous wire — no junction dot appears and the red square
  goes away. Buses of the **same width** join the same way. Buses of **different
  widths** can join too, but through a junction that carries a chosen bit
  alignment (see *Joining buses of different widths* under [Buses](#7-buses)).
  (Ending a wire on a dangling **bus** end still taps a single bit instead.)
- **Right-click a wire** for **Delete segment** (just the leg under the cursor) and
  **Delete wire** (the whole conductor).
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

- Use the **Bus** tool (or press **`b`**). Drawing, bends, branching, and
  **locked waypoints** (click empty canvas to lock a corner) work just like wires.
  A bus is completed by clicking a pin group, an existing bus/wire, or a component
  body — **not** by clicking empty space, which adds a waypoint. (A bus may still
  *start* in empty space.)
- **Right-click a bus** for: **Delete segment** (just the leg under the cursor),
  **Set width…**, **Edit bit names…**, and **Delete bus**. (With one bus segment
  selected you can also press `+` / `-` to change the bus's width.)
- **Snap-connect to a pin group:** the editor connects a bus to a **pin group** —
  a set of related pins (e.g. the 8 `D` inputs of a `74574`, or the 8 bits of an
  8-wide port/indicator) — wiring each bus bit to the corresponding pin in declared
  bit order, so you don't wire bits one at a time. A bus connects when the group has
  a run of unconnected pins at least as long as the bus is wide (so a bus may be
  *narrower* than the group — see *Filling part of a group* below).
  - With the **Bus** tool active, move the cursor **near a group's pins** — you do
    **not** need to click on the part body. A large **curly brace** appears,
    enclosing the group and opening toward its pins, with the bus running to the
    brace's **point** (the connection point). Click while the brace is showing to
    start or finish the bus there. The same works at both ends.
  - **A fresh bus takes its width from the group you start on.** Before you place
    the first end a new bus has no fixed width, so the brace appears for a group
    of **any** width — start on a 4-bit group (e.g. a `74157` input) and the bus
    becomes 4 bits wide. Once the first end is placed the width is fixed; the
    **other** end then snaps to any group with a free block of that width.
  - **Filling part of a group (narrower buses):** a bus narrower than a group can
    connect to a contiguous block of the group's still-unconnected pins, provided
    that many pins are free in a row. The bus packs into the **lowest** free pins,
    so two 4-bit buses fill one 8-pin group: the first takes the top four pins, the
    second the bottom four. The brace previews exactly which pins the bus will
    claim. Once some pins are taken, a bus that no longer fits is refused — e.g. an
    8-bit bus won't connect to an 8-pin group after a 4-bit bus has claimed half.
  - If several groups are in range (e.g. the 574's `D` inputs and `Q` outputs) the
    brace snaps to the group **nearest the cursor**. (Clicking the part body still
    works too: one accepting group connects automatically; several prompt you to
    choose; none connects nothing.)
  - **Joining buses of different widths:** you can connect a narrower bus to a
    wider one — either by ending it on the wider bus's dangling end or by branching
    it onto the wider bus (a T-junction). Because the widths differ the two buses
    stay separate conductors joined at a junction dot (they don't merge into one).
    A small dialog asks **which bit of the wider bus lines up with bit 0 of the
    narrower bus**; from there the narrower bus's bits map to a contiguous run of
    the wider bus's bits (bit 0 → the chosen bit, bit 1 → the next, and so on). Only
    alignments that fit are offered, and the wider bus's remaining bits are left
    untouched at that point. Equal-width joins need no dialog and line up bit-for-bit.
  - A **connected** bus end is always drawn with its curly brace; a **red square**
    marks an end that is still **dangling** (unconnected). The brace tracks the part
    if you move or rotate it.
- **Bit names:** a bus may carry a name per bit; snap-connecting to a named pin
  group adopts those names (bit position, not name, determines connectivity).
- **Breakout:** you can tap a single bit out of a bus and route it as an ordinary
  wire; the tapped wire is electrically part of that bus bit's net. This works in
  either direction — click a bus first to start the wire there, or draw a wire from
  a pin and click onto a bus to finish it there. Either way a small dialog lets you
  choose which bit to tap. (A wire you draw *to* a bus keeps the route you drew; one
  *started* from a bus runs straight to its destination.)

---

## 8. Per-instance overrides

Select a single component to view its type data in the properties panel. The
read-only fields show the part's type (its display name), size, and pin count;
editable fields let you override numeric values — such as propagation delays, or a
built-in's declared properties (e.g. a clock's `period`) — **for that instance
only**. Overrides do not affect other instances or the underlying YAML, and are
saved with the design.

The panel also has an editable **designator** field — the `U`/`A` number drawn on
the canvas. You may set it to any text, with no restrictions: it need not follow
the `U`/`A` numbering and may even duplicate another component's designator. The
designator is only a label; the editor identifies each component internally by a
fixed, hidden identity, so renaming or duplicating it never changes wiring,
connectivity, or the netlist. Clear the field to restore the default (the original
auto-assigned number). Edits are undoable. (Text notes have no designator, so the
field is absent for them.)

---

## 9. Refreshing type data

When you place a part, the editor copies the type's data (pins, delays, behavior)
into the instance and keeps that copy with the design forever (so opening an old
design always reproduces the parts it was built with). If you later edit a
component definition, existing instances keep their old copy.

The **File ▸ Refresh Types** menu item re-copies type data from the **currently
loaded** component library into every placed instance whose type still exists —
74-series parts from the library, built-ins from the app's registry. For each
refreshed instance it preserves position, rotation, reference designator, wiring,
and your per-instance overrides; an override that no longer matches any delay or
property in the new definition is dropped.

An instance is **skipped** (left unchanged, and reported once per type in the
message tray) if the new definition is structurally incompatible — its render type
changed, or a pin currently used by a wire or bus no longer exists. Refresh is one
undo step and is disabled while simulating.

Refresh also **rescans the current project's `components/` folder** first, so a
project-local part you added or edited on disk goes live without a restart. To pick
up edits to a **shared** library YAML file, though, you must first **restart the
server and reload the page**; then use Refresh to push the new definitions into an
existing design.

---

## 10. Projects and files

### Projects

A **project is a folder** — the folder that collects one circuit's designs:
top-level designs, peer sheets, embeddable children, `.tv` test-vector files,
and generated outputs, all directly at the folder's root, plus a reserved
`components/` subfolder holding the component types (GAL parts and memory
devices) you author in that project. Any folder works as a project; no special
file is required, so your existing design folders are already projects. Exactly
one project is **current** at a time, shown in the top bar, and every design
belongs to the project whose folder it lives in.

A project may carry an optional **manifest** — a `<name>-manifest.json` file at
its root recording a display name and the project's **main design** (the file
Open Project opens directly). New Project writes one for you; recognition is by
the `*-manifest.json` name pattern, so renaming the folder outside the app never
orphans it. A project without a manifest is fully functional — its display name
is just the folder name. Manifests never appear in design listings, and a design
cannot be saved under a name matching the pattern.

- **New Project…** — prompts for a location (starting at the designs root,
  `~/Documents/retrosim`) and a project name, creates the folder and its
  manifest, and enters it with a fresh empty design named after the project —
  so the first Save prefills `<project>.json`. The **first design saved** into a
  project is recorded in the manifest as its main design.
- **Open Project…** — pick **a folder, a manifest file, or a design file**; each
  resolves to its containing folder as the project (KiCad users: opening "the
  project file" works). If the manifest names a main design it opens
  immediately; otherwise you're shown the open-design dialog rooted at the
  project — cancelling it cancels the whole action, changing nothing. (A folder
  containing no designs can therefore only be entered via New Project.)
- **Duplicate Project…** — copies the **entire current project folder** to a new
  location chosen through the New Project prompt (the manifest is renamed and
  its display name updated), then makes the copy current. This is how you fork a
  project. If any design in the copy references a data file by **absolute path**
  (a ROM content or RAM save file outside the project), a message warns that the
  file is still **shared with the original** — a shared RAM save file would be
  overwritten by running the duplicate. A failure mid-copy leaves the partial
  destination for manual cleanup.

**Boundary rules — strict for designs, loose for data.** Design-file references
stay inside the project: an embedded sub-design must be a file in the current
project (the ADD dialog refuses one outside it), off-sheet targets are bare
same-folder filenames as before, and Save/Save As are confined to the project.
**Data files are exempt**: ROM content and RAM save files may live anywhere on
disk. A ROM/RAM path *inside* the project is stored in the saved design as a
relative path (so a duplicated project uses its own copy); a path outside stays
absolute (and triggers the Duplicate warning above). An old design whose
sub-design reference points outside the project still loads, renders, and
simulates — the condition is reported once in the message tray — but *new*
outside-project references are refused.

To move a design into a different project, move the file with your file manager
(and any children/`.tv` siblings it needs); the app deliberately has no
cross-project save.

### File operations

- **New** — start a fresh empty design in the current project. You're warned
  first if the current design has unsaved changes. (No keyboard shortcut —
  browsers reserve `Ctrl/Cmd+N`.)
- **Open** (`Ctrl/Cmd+O`) — browse the server's filesystem (a dialog backed by the server, not the
  browser's native picker) and open a design. You're warned about unsaved changes.
  The opened design's containing folder becomes the current project.
  The dialog opens in the folder you last viewed in any file dialog — remembered
  across sessions — so you don't re-navigate every time. (If that folder no longer
  exists, it falls back to the designs root.) The ROM-content and test-vector
  pickers share the same memory.
- **Save** (`Ctrl/Cmd+S`) — the first save prompts for a filename (pre-filled with the design
  name) with the dialog rooted at the project folder, so it effectively asks
  only for a **name**; later saves overwrite the same file silently. Saving
  under a different file name renames the design to that file's base name. A
  location outside the project, or a name matching `*-manifest.json`, is
  rejected with a message and the dialog stays open.
- **Save As** (`Shift+Ctrl/Cmd+S`) — save under a new name at any time, within
  the current project (same rejections as Save; to fork a whole project use
  **Duplicate Project…**).
- **Export…** — write the design to a foreign netlist format. A small dialog
  picks the format — **NDL** (`.ndl`), a plain-text pinout/package/circuit
  netlist language, is currently the only one — then the usual save dialog picks
  the file. Export reads the **live** design (unsaved edits included) and never
  modifies it; hierarchical designs are flattened first, exactly as Run does.
  Each part's `physical:` YAML metadata (when present) supplies physical pin
  numbers, power pins, and no-connects — a synthetic **POWER** package carries
  the rails — and the design's ports become a connector package (`J1`). Built-ins
  with no physical package (clocks, switches, indicators, pulls, resets,
  transmission gates, relays) are recorded as comment lines so no connectivity
  is silently dropped. Output is deterministic: exporting the same design twice
  gives byte-identical text, so exports diff cleanly. Unavailable while a
  simulation runs or the test-vector panel is open.

Designs are JSON files. The designs root `~/Documents/retrosim`
(`%USERPROFILE%\Documents\retrosim` on Windows) is the default home for project
folders — the New Project prompt starts there — but a project can live anywhere
you can navigate to. The unsaved-changes indicator (an asterisk by the design
name) tells you when there is work to save. Saving is allowed even while
simulating.

---

## 11. Built-in components

Built-in objects live in the lower palette region. Once placed they behave like
ordinary component instances (selectable, movable, rotatable, deletable, wireable)
and are designated `A-1`, `A-2`, …. Their behavior is defined by the app, not by
YAML. (The **text note** is the exception: it is a pure annotation with no pins,
no behavior, and no designator — see below.)

| Object | Pins | Behavior |
|---|---|---|
| **State indicator** | one input (`IN`, bottom) | Display only — drives nothing. Shows the value of the connected net (0 / 1 / U / Z); a gray "?" bubble when undriven or at rest. Use it to watch a signal during a run. |
| **Pull-up** | one output (`OUT`, bottom) | A **weak** driver of logic **1**: sets the net to 1 only when no enabled strong driver is present; any strong driver overrides it silently. |
| **Pull-down** | one output (`OUT`, top) | A **weak** driver of logic **0**, symmetric to the pull-up. A pull-up and pull-down on the same net with no strong driver is a conflict. |
| **Clock** | one output (`OUT`, right) | A square wave, 50% duty cycle: low from t = 0 with the first rising edge half a period in. Properties: `period` (ns, default 100) and `speed` (Hz, default 1). A design with a clock is *sequential* and runs continuously; see [Simulation](#13-simulation). |
| **Power-on reset** | two outputs (`R` active-high, `/R` active-low, right) | Asserts reset (`R`=1, `/R`=0) for the first `cycles` clock periods of a run, then releases (inverse afterward). Property: `cycles` (default 3). |
| **Input switch** | one output (`OUT`, right) | A user-set logic source with two states, **1** and **0**, drawn like the state indicator — a round value bubble (white **1** / black **0**) — with a small arrow toward its output pin. A **strong** driver: it overrides pull-ups/pull-downs on its net. Set its state in the properties panel while editing, or **click it during a simulation** to toggle **0 ↔ 1**. The state is saved with the design (a new switch starts at **0**). |
| **State indicator (8-wide)** | eight inputs (`D0`–`D7`, left) | An 8-bit display, drawn as an LED **bar-graph** (eight stripes). Display only — drives nothing. The eight pins form one pin group, so an 8-wide bus snap-connects to all bits at once (see [Buses](#7-buses)); each stripe shows its bit's value (white **1** / black **0** / gray **?**) during and after a run. |
| **Port / off-sheet connector (multi-bit)** | N pins (`P0`–`P(N-1)`, left) | A multi-bit interface port. When you drop it, a dialog asks for its **bit width** (2–16); that width is fixed for the life of the instance (to change it, delete and re-place). It is drawn as N narrow pentagons — one roughly aligned with each pin, each pointing off-sheet away from the pins. The N pins form one pin group so a matching-width bus snap-connects to all bits at once (see [Buses](#7-buses)). Like the 1-wide [port](#12-sub-designs-and-ports) it is part of the design's interface (it contributes a pin **group** when the design is embedded), with a direction derived from its wiring; it does not yet join to same-label or cross-file ports. |
| **Port / off-sheet connector** (1-bit) | one pin (flat back edge) | The pentagon "flag" that marks its net as part of the design's external interface for embedding. See [Sub-designs and ports](#12-sub-designs-and-ports). |
| **Transmission gate** | `A` (left), `B` (right), `EN` (top) | An ideal **bidirectional switch**: `A` and `B` are interchangeable contact terminals — neither is an input or an output, and drivers on either side may come and go. While `EN` reads **1** the two sides are electrically **joined** (they resolve as one net); while it reads **0** they are isolated. An `EN` of U (or Z) means the switch position is unknown: both sides are forced to **U**. Drives nothing, stores nothing, no properties; see the switch-element notes in [Simulation](#13-simulation). |
| **Relay (SPDT)** | `COIL` (top); contacts `NO` / `COM` / `NC` (right, labeled on the canvas) | A changeover relay with an idealized logic-level coil (one pin — no second coil terminal, no coil current). Released (`COIL` = 0): `COM`–`NC` joined, `NO` isolated. Energized (`COIL` = 1): `COM`–`NO` joined, `NC` isolated. A U coil forces all three contact nets to **U**. Contacts follow the coil after the standard one-unit delay (no pick/drop time is modeled). For an SPST contact, leave the unused throw unwired. No moving contact arm is drawn — read the live state from wired indicators. |
| **Magic UART** | eight inputs (`D0`–`D7`, left, one pin group `DATA`); `CS/`, `CE/`, `CLK` (right) | A convenience character-output device — physically unrealistic, but handy for getting text out of a running design. Drawn as an IC-style box labeled **UART**. On each **rising edge of `CLK`**, and only while both `CS/` and `CE/` read **0**, it latches `D0`(LSB)…`D7`(MSB) and emits that byte as an **ASCII character** to the simulator's standard output — the **[Console panel](#console-output)** in the slow simulator, and real `stdout` in [generated C](#generating-a-standalone-c-simulator). It drives no nets and has no readback path. Emission is deliberately careful: if `CS/` or `CE/` is **1** (deselected) or uncertain (U/Z), nothing is emitted; any data bit that is not a clean **1** counts as **0**. The eight `DATA` pins form one pin group, so an 8-wide bus snap-connects to all of them at once (see [Buses](#7-buses)). No properties. |
| **Text note** (`NOTE` tile) | none | A free-form text annotation — pure documentation, with no pins, no wiring, and no part in simulation. See **[Text notes](#text-notes)** below for how to type and edit one. |

You can override a built-in's properties per instance via the properties panel
(e.g. give one clock a different `period`). The input switch is set the same way:
select it and choose its state (`1` / `0`) in the properties panel.

**Interactive inputs.** The input switch is an *interactive input* — a built-in
you can change by hand **while a simulation is running**: click its body and the
simulation immediately re-evaluates from the new value (see
[Simulation](#13-simulation)). This is the one kind of design change allowed
during a run.

### Text notes

A **text note** lets you annotate a schematic with free-form text. Place the
`NOTE` tile like any other built-in. It is purely decorative — it has no pins,
carries no signal, and is ignored by the netlist and the simulator — so it never
affects how a design behaves. At rest it shows just its text; a dotted blue box
appears around it only while it is selected or being edited.

- **Typing:** a note opens for editing the moment you place it, and you can
  re-open it any time by **double-clicking** it. While editing, a text box
  appears over the note where you can type, select text, and cut/copy/paste with
  the usual shortcuts.
- **Finishing:** press **Enter** (or click elsewhere) to commit the text;
  press **Esc** to commit and leave editing.
- **Line breaks:** press **Shift+Enter** to start a new line within the note.
- The box **grows to fit** what you type. Notes **rotate** with the rest of a
  selection (the text turns with the box), can be moved and deleted like anything
  else, and their text is saved with the design.

Notes carry no `A-` number and show no type label — only your text on the canvas.

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
your circuit. A port is always **one bit**. Select a port to see its fields in the
properties panel:

- **label** — the signal name (editable). Within one design, **all ports with the
  same label are the same net**, so an interface signal can appear at several
  points on the sheet without a drawn wire between them. (A fresh port's label
  defaults to its `A-` designator, i.e. its own net until you name it.)
- **direction** — `in`, `out`, or `bidir`, **derived from the port's wiring**:
  `bidir` if its net touches a bidirectional/three-state pin (e.g. a RAM/ROM data
  line), else `out` if a plain output drives it, else `in`. A definite `in`/`out`
  is shown **read-only** — it always agrees with the wiring. A derived **`bidir`**
  is genuinely ambiguous (the wiring can't distinguish a true bidirectional bus
  from a 3-state output used as a switchable driver), so in that case the panel
  offers an editable selector to **override** the direction to `in` or `out`
  (choose `bidir` again to clear the override). The override applies only while
  the derived value is bidir — if the wiring later becomes definite, the wiring
  wins. The effective direction drives the embedded block's pin layout and the
  [test-vector](#test-vectors) column binding.
- **off-sheet target** (optional) — two fields, **target file** and **target
  label**, that turn the port into an *off-sheet connector*: its net continues
  to the port carrying that label in another sheet of the same circuit. The
  target file must be a design file **in the same folder** as this one — enter a
  bare filename, not a path (a value containing a folder separator is rejected).
  Leave the file blank for no target; clearing it removes an existing one. A port
  that has a target shows a small filled triangle at its apex. Off-sheet
  connectors join sibling sheets of one circuit *flatly* — unlike embedding a
  sub-design, neither sheet contains the other. (Multi-bit ports don't yet offer
  off-sheet targets.)

For a **multi-bit (bus) interface**, use the *Port / off-sheet connector
(multi-bit)* built-in instead — you choose its width (2–16) when you drop it, and
it presents its bits as a pin group (see the built-ins table in
[Built-in components](#11-built-in-components)).

A design's **interface** is the set of its ports: each distinct 1-wide-port label
contributes one one-bit interface pin, and each multi-bit port contributes a pin
**group** — each carrying its derived direction. A design with no ports has no
interface and cannot be embedded.

**Embedding a sub-design (ADD).** The **ADD** tile (the dashed `+` box at the end
of the lower palette) embeds a saved design. You do **not** need to have saved
the parent first — embedding never prompts to save. (In the saved file the child
is recorded by a path relative to the parent, but that path is computed when you
save; only *descending into* a child prompts for a save — see below — so there is
a file to come back to.)
Drop ADD on the canvas to open the *Add sub-component* dialog: choose a design
file (it must have ports), preview its interface, and pick how it should be drawn
— an **IC** rectangle (inputs left, outputs right) or a **connector** strip (all
pins along one edge). Confirm to place it. Sub-design instances are designated
`X1`, `X2`, … and are wired through their interface pins like any component.
The child must be a design **in the current project** — a file outside the
project folder is refused (see the boundary rules in
[Projects and files](#10-projects-and-files)). A design cannot embed itself,
and the dialog also refuses any choice that would
create an **embedding cycle** — a child that (directly or through its own
sub-designs) embeds the design you're editing.

The reference is **live**: the instance stores no copy of the child, so changes to
the child design appear in the parent the next time the parent is opened. If a
child file can't be found when the parent opens, its instance is drawn as a
red **broken-link** box naming the missing path, and the condition is reported in
the message tray — opening still succeeds.

When a child's **interface has changed** since the parent was last saved (ports
added, removed, or relabeled), the embedded block re-lays-out its pins on the
next open — and the parent's wires to it are **automatically re-routed** so they
don't keep the routes they had to the old pin positions. Only plain
point-to-point wires are re-routed; wires carrying taps or junctions, and wires
to pins that no longer exist (left **dangling**, per the message tray), are left
for you to tidy. The message tray names each re-routed instance. Hand-tweaked
routes elsewhere are never touched, and nothing about this marks the design
modified.

**Moving between sheets.** **Double-click** a sub-design instance (or right-click
it and choose **Open sub-design**) to descend into the child design — it replaces
the editing canvas. A **← back** button appears in the top bar; click it to return
to the parent. Descending and going back are each treated as closing the current
design, so the usual unsaved-changes prompt applies — save or discard before the
canvas changes. A plain New or Open leaves the hierarchy and clears the back path.

To **follow an off-sheet connector**, double-click a port that has a target (or
right-click it and choose **Follow off-sheet connector**) — a plain click still
just selects it. This opens the target sheet the same way as descending, joining
the same **← back** path. Because the target names a file in this design's own
folder, following from a never-saved design first prompts you to save it (so the
name can be resolved and **back** has a sheet to return to).

**Simulating a hierarchical design.** Pressing **Run** (or running
[test vectors](#test-vectors)) **flattens** the design first: each sub-design
instance is replaced, internally, by its child's contents — recursively, so
children may embed children. You don't see the flattening; the schematic stays
as drawn. Things to know:

- Reference designators in messages are **hierarchical**: a bus conflict inside
  the first instance of a child reports names like `X1/U3.1Y`, so you can tell
  *which* instance is involved. (Following the name: descend into the child and
  look at `U3`.)
- A child's built-ins come along **electrically**: its pull-ups, clocks, and
  power-on resets all participate. But a child's **input switches and
  indicators have no presence on the parent sheet** — you can't click a child's
  switch or read a child's indicator during a run. A switch buried in a child
  still *drives* its net at its saved position, which leads to:
- **Keep embeddable children free of test stimulus.** A child that carries its
  own switches wired to its input ports will fight the parent's drivers — both
  drive the net, and wherever they disagree you get a red bus conflict; where
  they agree, the child's switch silently pins the input. Before embedding a
  design, remove its test switches (its ports are how the parent drives it).
- An interface input the parent leaves **unconnected** floats — the child sees
  U, and anything that genuinely depends on it (an XOR, an undriven data input)
  shows **?** on indicators downstream. Tie unused inputs with a switch,
  pull-up, or pull-down.
- If a file in the hierarchy can't be loaded, or the embedding graph has a
  cycle, the run refuses with a message instead of starting.

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
  They can also be paused and stepped by the clock cycle or the unit — see
  [Pausing and single-stepping](#pausing-and-single-stepping).
- **Conflicts:** when enabled drivers of a net disagree 0-vs-1, the net goes to U,
  every segment of that net turns **red** while the conflict lasts, and the message
  tray names the conflicting drivers. The simulation keeps running.
- **Switch elements** (the [transmission gate and relay](#11-built-in-components)):
  a **closed** contact makes the nets on its two sides **one net** for resolution —
  driver strength survives the contact (a weak pull-up seen through a closed relay
  contact still loses to a strong driver on the far side), chains of closed
  switches join transitively, and disagreeing drivers across a closed contact are
  an ordinary red-flagged bus conflict. A control (`EN`/`COIL`) reading **U**
  means the contact position is unknown: the nets on both sides are forced to U.
  Contact changes follow the control by the standard one unit. An **open** switch
  isolates its sides completely: an isolated net with no driver reads **Z** — the
  simulator never retains a value on an isolated node (**no charge storage**), so
  dynamic-latch and precharged-bus tricks won't work; add a pull-up or pull-down
  as a keeper where you need retention.
- A 74-series part whose YAML has no behavior block holds its outputs at U and is
  reported once when the run starts.

While simulating, the design is **read-only** and the **selection is locked**:
placing, wiring, moving, rotating, deleting, overrides, paste, undo/redo, New,
Open, and changing the selection are all disabled. Pan, zoom, right-click
recenter, Save, and Save As remain available. Starting a run clears the current selection and the message
tray; stopping a run clears the message tray again. A click that would normally
select an item instead shows "Editor is locked while the simulator is running" in
the status bar and changes nothing (a click on empty canvas does nothing). The one
exception is clicking an **interactive input** (the input switch), which changes
its value live and re-evaluates the simulation.

### Pausing and single-stepping

While a **sequential** design (one with a clock generator) is running, three
extra icon buttons appear beside Run/Stop — the conventional debugger controls:

- **Pause / Continue** (two bars / a triangle) — Pause freezes simulated time
  at a unit-step boundary; the state tray reads **"paused"** and the indicators
  keep showing the frozen state. The run stays active: **Continue** resumes
  wall-clock pacing from exactly where you paused (the paused interval is never
  "caught up"), and **Stop** works normally, including writing back any
  [persistent RAM](#persistent-ram).
- **Step one clock cycle** (an arrow arcing over a dot) — enabled while paused.
  Advances just past the **next rising edge of the primary clock** (see below)
  and then keeps stepping until the circuit settles, so each click shows the
  stable state produced by one more clock. Settling stops early one unit before
  the next scheduled edge of any clock — a step never swallows an edge — and a
  circuit that won't settle gets the usual 10,000-unit oscillation report and
  stays paused.
- **Step one unit** (an arrow dropping onto a dot) — enabled while paused.
  Advances exactly one simulated nanosecond, for watching a value ripple
  through logic one gate level at a time.

Clicking an **input switch** while paused still flips it immediately (the
switch redraws), but the new value reaches the circuit on the *next* step —
nothing advances until you Step or Continue.

Combinational designs (no clock) show no pause/step controls; they already
settle and idle on their own.

**The primary clock.** Step-cycle needs to know which clock defines "a cycle".
The first clock generator placed in a design becomes its **primary clock**,
which is saved with the design. If you delete the primary, the role passes to
the lowest-numbered remaining clock (reported in the message tray). To pick a
different one, open **Edit ▸ Design Properties…** — a small dialog with a
selector over the design's clock generators; changing it is undoable. A design
saved before this feature exists simply uses its lowest-numbered clock until
you set one. With a single clock — the usual case — you never need to think
about any of this.

### Console output

The **[magic UART](#11-built-in-components)** built-in emits characters to a
**Console panel** — the slow simulator's standard-output surface. Toggle it from
**View ▸ Console** (the menu item shows a check mark while it is open). The panel
docks along the bottom of the canvas area, like the Test Vectors panel, and shows
the interleaved characters emitted by every placed magic UART during a run.

Unlike the Test Vectors panel, the Console is **modeless**: it imposes no
read-only lock and is meant to be opened *during* a run — you can leave it open,
press Run, and watch text appear. It scrolls and sticks to the newest output
unless you scroll up to read earlier lines. Characters are rendered as you'd
expect — printable ASCII verbatim, newline and tab literally, carriage return
ignored, and any other byte as a visible `\xNN` escape. **Clear** empties it, and
it is cleared automatically at the start of each Run. Its contents and open/closed
state are session-only — they are **not** saved with the design.

To try it: place a **UART**, wire an 8-bit value to `D0`–`D7` (a bus snaps to the
whole `DATA` group at once), hold `CS/` and `CE/` low, drive `CLK` from a clock
generator, open **View ▸ Console**, and press **Run**. In the [generated C
simulator](#generating-a-standalone-c-simulator) the same bytes go to the
program's real standard output instead.

### Test vectors

Instead of toggling switches and reading indicators by hand, you can write a
**table of test vectors** — input patterns paired with the outputs you expect —
and have the simulator run and score them. Open it from **Simulate ▸ Test
Vectors…**, which toggles a **panel docked across the bottom third of the
canvas**. The schematic stays visible above it, so you can pan and zoom to see
which switches, indicators, and ports the columns correspond to. Choosing
**Simulate ▸ Test Vectors…** again, or the **✕** in the panel's header, closes
it. Both combinational and clocked (sequential) designs are supported.

While the panel is open the design is **read-only**: you can pan, zoom, Save,
and Save As, but the editing commands (placing, wiring, moving, deleting, undo/redo,
paste, property edits) are disabled — as they are while a simulation runs. The
**Run/Stop** button is disabled too, since the panel and a live simulation are
mutually exclusive. Close the panel to edit or run the design again.

The table's columns come from your design automatically:

- one **input** column per [input switch](#11-built-in-components), holding `0` or `1`;
- one **input** column per **clock generator**, holding `0`, `1`, or `C`
  (sequential designs — see below);
- your design's [ports](#12-sub-designs-and-ports) become columns according to
  their direction — an **input** port's cell drives its net (`0`/`1`), an
  **output** port's cell is checked like an indicator (`H`/`L`/`X`); a multi-bit
  port contributes one column per bit. A **bidirectional** port — a three-state
  bus, e.g. a net driven through `74244`-style buffers — becomes an **IO** column
  instead (see *Bidirectional bus columns* below). To bind it as a plain input or
  output column, set its direction override in the properties panel.
- one **output** column per [indicator](#11-built-in-components) — a single
  indicator is one column, an 8-wide indicator becomes eight columns `D0`…`D7` —
  holding the value you expect: **H** (logic 1), **L** (logic 0), or **X**
  (don't-test, i.e. ignore this output on this row).

A design containing [sub-designs](#12-sub-designs-and-ports) runs **flattened**,
exactly as the interactive simulator does; the columns still come only from the
top sheet's own switches, clocks, indicators, and ports. One restriction: a
**clock generator inside an embedded child** can't be scripted by the table, so
Run and Capture refuse such a design with a message — keep clocks on the sheet
under test.

**Combinational designs** (no clock generator): each row is one **independent**
case — its inputs are applied, the circuit settles, and the outputs are compared.

**Sequential designs** (at least one clock generator): the panel shows a notice
that rows run **in order** on one continuous simulation — registers keep their
state from each row to the next, so the table reads as a script. Each clock
generator gets its own column:

- **`C`** (the default in a new row) applies **one full clock pulse**: the row's
  other inputs are applied and settled first, then the clock goes high and back
  low, and the outputs are checked after the pulse — so one row is one clock
  cycle.
- **`0` / `1`** hold the clock at that level for the whole row (useful for
  testing level-sensitive behavior). Raising a clock from `0` in one row to `1`
  in the next is itself a rising edge, so half-cycles can be scripted with
  level cells.

If the design contains a [power-on reset](#11-built-in-components), a **power-on
preamble** runs automatically before the first row: reset is held asserted while
the clock is pulsed for the reset's `cycles` property, then released — the same
power-up sequence the design sees in the interactive simulator. Registers still
power up as U, so circuits without a reset start undefined until something is
clocked in.

Build the table and use the buttons:

- **+ Row** adds a blank row; the **✕** at the end of a row deletes it.
- **Run** drives each row's inputs (in table order for a clocked design), lets
  the circuit settle, and compares the outputs to your expected values. Passing
  output cells turn **green**; a mismatch turns **red** and shows what the
  circuit actually produced (e.g. `got 1`). A summary line reads "N of M rows
  passed". A `U` or `Z` output never matches `H` or `L`.
- **Capture** fills in the expected-output cells of every row by running the
  table through the simulator (in order, for a clocked design) — a quick way to
  author a "golden" table from a circuit you believe is correct, which you can
  then edit. (It records whatever the circuit currently does, so eyeball the
  captured values; capturing a buggy circuit bakes in the bug.)
- **Load** / **Save** read and write a **test-vector file** (`.tv`, stored beside
  your design) through the same file browser as Open. Columns are matched back to
  your switches, clocks, ports, and indicators by their internal designators, so
  renaming a label never breaks a saved file; if the design's columns have changed
  since the file was written, the mismatch is reported as a warning when you load.

#### Bidirectional bus columns

A **bidirectional** (three-state) port — a bus that can be driven from more than
one side, such as a net fed through tristate buffers — becomes an **IO** column,
shown in its own **IO** group. Each IO cell chooses, per row, whether the vector
runner **drives** the bus or **observes** it:

- **`0` / `1`** — *drive* the bus to that value on this row (like an input);
- **`H` / `L`** — *release* the bus and *check* that it reads 1 / 0 (like an output);
- **`X`** (the default) — release the bus and don't check it.

So one bus column can be **driven on some rows and checked on others** — for
example, drive a value onto a data bus on one row, then read the design's response
on a later row (in a clocked design, state carries between rows). On **Run**, only
the release cells (`H`/`L`) are scored green/red; drive cells are stimulus and are
never marked. **Capture** fills the release cells from the settled bus and leaves
your drive cells as you wrote them.

If you drive a bus on a row where the design's *own* logic is also driving it, the
two collide and the net reads **U** (a bus conflict) — use the design's real
control/enable inputs (other columns) to switch the internal driver off on the
rows you drive, just as real hardware relies on an output-enable.

Bidirectional columns run in the interactive **Test Vectors** panel only; the
[generated C simulator](#generating-a-standalone-c-simulator) does not yet emit
them (it warns and omits any IO columns).

Running test vectors **does not change your design** — it neither marks it modified
nor disturbs an in-progress edit — and is separate from the **Run/Stop** button.
The **Test Vectors…** command is unavailable while a normal simulation is running;
press Stop first.

### Generating a standalone C simulator

**Simulate ▸ Generate C…** turns the current design into a self-contained C
program — the "fast" engine. A file dialog asks where to put it (defaulting to
the project folder); three files are written there:

- `<design>.c` — generated from your design; regenerate rather than edit it.
- `runtime.c` / `runtime.h` — a fixed, documented support library, copied
  alongside every generated file.

Compile them with any C compiler, no flags needed:

```
cc -o mydesign mydesign.c runtime.c
```

**Command line at a glance:**

```
./mydesign                      run test vectors from standard input (default mode)
./mydesign --cycles N           free-run N clock cycles, then print final values
./mydesign --columns            print the vector column set, one per line, and exit

Options for either run mode:
--vcd FILE                      also write a VCD waveform trace to FILE
--rom REFDES=FILE               read ROM REFDES's contents from FILE instead of
                                its recorded path
```

Any unrecognized flag prints this usage and exits with status 2. The exit
status is 0 for a vector run in which every row passed, or for a completed
free run; each flag is described in detail below.

The program has exactly the debug simulator's semantics — the same four
values, unit-delay timing, settling behavior, and bus-conflict detection — so
the two engines produce the same results for the same design. It runs in one
of two modes: a **test-vector runner** (the default) or a **free-running
simulation** (`--cycles`, below).

As a vector runner it reads rows from standard input as plain text, one row per line:
the input symbols (`0`/`1`, or `C` to pulse a clock column), a `|`, then the
expected outputs (`H`/`L`/`X`), separated by spaces. Blank lines and lines
starting with `#` are skipped. For example, two rows for a two-switch,
one-indicator design:

```
0 1 | H
1 1 | L
```

Each row prints `row N: pass` or `row N: FAIL` naming the failing columns and
the values actually observed, followed by a `passed R of T rows` summary; the
program exits 0 only if every row passed. Bus conflicts and
failure-to-settle reports go to standard error, like the message tray during a
debug run.

**Column order matters.** The rows are positional against the design's full
derived column set — the same columns the test-vector panel shows, in the same
order — which is baked into the generated program (run it with `--columns` to
print the set, one column per line). A `.tv` file saved from the test-vector
panel need not assert every column; the `tv2txt` converter reconciles it
against the program's columns and emits ready-to-pipe rows:

```
node web/tools/tv2txt.js ./mydesign mydesign.tv | ./mydesign
```

**Free-running mode.** `--cycles N` runs the design free for `N` clock periods
instead of reading vectors: the clock generator produces its real square wave
(per its `period` property), the power-on reset asserts and releases exactly as
in a debug run, switches hold the positions they were in when you generated,
and after the last cycle the program prints each observable point (the same
column set) as a `LABEL=value` line — values `0`, `1`, `U`, or `Z`. This is
the mode for letting a design — a ROM-driven circuit, a counter, eventually a
CPU — simply run.

Any **[magic UART](#11-built-in-components)** in the design writes its emitted
characters to the program's real standard output in both modes, so you can pipe
or redirect them like any command output. The `LABEL=value` free-run dump (and
the test-vector transcript) share that stream and trail all the UART bytes.

**Waveform traces.** In either mode, `--vcd trace.vcd` also writes a VCD
waveform trace of the observable columns over simulated time (1 ns per unit
step). VCD is a standard format; any VCD viewer works (examples include
Surfer and GTKWave). Undefined shows as `x`, undriven as `z`.

**ROM contents.** A ROM's contents are **not** baked into the program: it
reads each ROM's content file when it starts, just as the editor reads it at
Run — so you can edit a `.hex` or `.bin` file and re-run without regenerating
or recompiling. By default the program uses the file path recorded in the ROM
device, trying it as recorded and then by filename in the directory you run
from (handy when the program was generated on another machine — put the file
next to where you run it). To point a ROM somewhere else, pass
`--rom REFDES=FILE` (once per ROM), for example:

```
./mydesign --rom U1=program2.hex --cycles 1000
```

A content file that is missing, unreadable, or malformed stops the program
with a message rather than running with empty memory; the message names the
ROM and shows the `--rom` option to use.

A **RAM with a save file** (persistent RAM) is generated too: the program loads
the save file when it starts and writes the RAM back when the run ends, in both
batch modes. Unlike a ROM, a missing or malformed RAM save file is not fatal —
the RAM just starts blank and a note is printed. The path is baked in (there is
no override option), so put the file where you run the program. See
[Persistent RAM](#persistent-ram) for the file format and details.

Generation never modifies the design, and works whether or not it has been
saved. Registered (`.R`) parts, independent per-output clocks, and RAM/ROM
devices — including persistent RAM — are all supported. One thing is refused,
with a message naming the instance, because it runs only on the debug simulator
for now: a design containing a **transmission gate or relay** (the bidirectional
switch elements, see [Built-in components](#11-built-in-components)).

**Hierarchical designs** generate too: like Run and the test-vector panel,
generation **flattens** the design first (see
[Simulating a hierarchical design](#12-sub-designs-and-ports)), so anything
that would stop a flattened Run — an embedding cycle, or a sub-design file
that can't be loaded — stops generation with the same message. The program's
vector columns come from the **top sheet only**, exactly as in the test-vector
panel. A clock generator inside a sub-design follows the panel's rule,
enforced when the program runs: vector mode refuses at startup (naming the
clock and pointing at `--cycles`, exit status 2), while `--cycles` free-runs
such clocks normally.

The menu item is unavailable while a
simulation is running or the test-vector panel is open.

---

## 14. If the server disconnects

Your design's source of truth is the browser tab, so editing keeps working even if
the server goes away (the connection tray shows "disconnected"). **Do not reload
the page** — restart the server at the same address and port and the app will
reconnect. On reconnecting it reports success and, if you have unsaved changes,
saves them immediately (or opens the Save dialog if the design has never been
saved). Server-dependent actions (Save, Open, directory listing) fail with a
clear message until then, without losing your work.

---

## 15. Keyboard and mouse reference

**Mouse (Select tool)**

| Action | Result |
|---|---|
| Left-click object | Select it (replaces selection); on a wire/bus selects one segment |
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
| Double-click a text note | Edit its text |
| Left-click input switch (while simulating) | Toggle its state `0 ↔ 1` |
| Left-click any other item (while simulating) | Selection is locked — status bar shows "Editor is locked while the simulator is running" |

**Keyboard**

| Key | Action |
|---|---|
| `w` | Wire tool |
| `b` | Bus tool |
| `r` / `Shift+r` | Rotate selection CW / CCW |
| `Delete` / `Backspace` | Delete selection (while drawing a wire/bus, `Backspace` removes the last locked waypoint instead) |
| `+` / `-` | Change width of the one selected bus |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |
| `Ctrl/Cmd+C` | Copy selection to the clipboard |
| `Ctrl/Cmd+V` | Paste (ghost follows the cursor; click to drop) |
| `Ctrl/Cmd+O` | Open |
| `Ctrl/Cmd+S` | Save |
| `Shift+Ctrl/Cmd+S` | Save As |
| `Ctrl/Cmd+=` / `Ctrl/Cmd+-` | Zoom in / out (about the canvas center) |
| `Space` (hold) | Pan with left-drag |
| `Enter` / `Shift+Enter` (editing a text note) | Commit the note / insert a line break |
| `Esc` | Cancel the current gesture / tool / selection / pending paste (or commit a text note being edited) |
