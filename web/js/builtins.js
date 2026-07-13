import { V0, V1 } from "./engine/galasm.js";

// Client-side registry of built-in editor objects (FR-067–FR-071a). These are
// synthetic ComponentTypes defined by the app rather than loaded from YAML; once
// placed they flow through the normal instance machinery (§6.6). Each carries
// `builtin: true` so addInstance assigns an A-<n> designator (FR-011a) and the
// palette files it into the lower region (FR-006a). A type may declare
// `properties` (FR-020b) — named numeric parameters with per-instance override
// values in `inst.overrides.props` — and every built-in has a behavior in the
// BEHAVIORS registry below (FR-067a).

// INDICATOR_ICON is the palette glyph for the state indicator: the same bubble it
// shows on the canvas in its undriven state — medium gray with a black "?"
// (FR-068) — as an inline SVG so no asset file is needed.
const INDICATOR_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<circle cx="18" cy="18" r="15" fill="#9a9a9a" stroke="#333"/>' +
  '<text x="18" y="19" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="18" fill="#000">?</text>' +
  "</svg>";

// PULLUP_ICON: two stacked up-chevrons over a vertical shaft (FR-069).
const PULLUP_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="8,13 18,6 28,13"/>' +
  '<polyline points="8,20 18,13 28,20"/>' +
  '<line x1="18" y1="22" x2="18" y2="32"/></svg>';

// PULLDOWN_ICON: an upside-down "T" — long stem, short bottom bar (FR-070).
const PULLDOWN_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<line x1="18" y1="4" x2="18" y2="28"/>' +
  '<line x1="8" y1="28" x2="28" y2="28"/></svg>';

// CLOCK_ICON: a box reading "CLK" (FR-071).
const CLOCK_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="3" y="11" width="30" height="14" fill="#fff" stroke="#333"/>' +
  '<text x="18" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="10" fill="#000">CLK</text>' +
  "</svg>";

// RESET_ICON: a box reading "RST" (FR-071b).
const RESET_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="3" y="11" width="30" height="14" fill="#fff" stroke="#333"/>' +
  '<text x="18" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="10" fill="#000">RST</text>' +
  "</svg>";

// SWITCH_ICON: the state-indicator value bubble (here showing "1") with a small
// arrow off its right side toward the output pin, marking it a signal source
// (FR-071c). The placed object draws the bubble at its current switchState.
const SWITCH_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<circle cx="15" cy="18" r="12" fill="#fff" stroke="#333"/>' +
  '<text x="15" y="19" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="14" fill="#000">1</text>' +
  '<line x1="27" y1="18" x2="31" y2="18" stroke="#333" stroke-width="2"/>' +
  '<path d="M29 14 L35 18 L29 22 Z" fill="#333"/></svg>';

// NOTE_ICON: a box reading "NOTE" with a blue dotted outline (FR-071f), echoing
// the dotted box drawn on the canvas. Like the CLK/RST tiles it is just a labeled
// box; the dashed blue stroke marks it as the annotation note rather than a part.
const NOTE_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="3" y="11" width="30" height="14" fill="#fff" stroke="#1565c0"' +
  ' stroke-dasharray="3 2"/>' +
  '<text x="18" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="9" fill="#000">NOTE</text>' +
  "</svg>";

// PORT_ICON: a pentagon "flag" whose apex points off-sheet, away from its
// connection point (FR-094/FR-094b) — matching the placed object, where the flat
// back edge carries the pin (into the sheet) and the apex is the front. The port
// is the shared primitive behind both hierarchical interfaces and off-sheet
// connectors (§6.14); the placed object shows the instance's label.
const PORT_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<path d="M31 11 H14 L5 18 L14 25 H31 Z" fill="#fff" stroke="#333"/>' +
  '<text x="22" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="9" fill="#000">P</text>' +
  "</svg>";

// PORTN_ICON: a short stacked column of right-pointing pentagons, suggesting the
// multi-bit port (FR-071e). Just a few flags, with no letter — the stack only
// marks the type, independent of the instance's chosen width. The same glyph is
// used for the palette tile and the placed object.
const PORTN_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="#fff" stroke="#333" stroke-width="1.5" stroke-linejoin="round">' +
  "0 8 16 24".split(" ").map(Number)
    .map((y) => `<path d="M7 ${y + 3} H20 L28 ${y + 7.5} L20 ${y + 12} H7 Z"/>`)
    .join("") +
  "</svg>";

// BARGRAPH_ICON: an LED bar-graph — a rectangle of horizontal stripes — for the
// 8-wide indicator (FR-071d). Alternating dark/light stripes read as lit/unlit
// segments. Same glyph for the palette tile and the placed object's silhouette.
const BARGRAPH_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="7" y="3" width="22" height="30" fill="#fff" stroke="#333" stroke-width="1.5"/>' +
  [0, 1, 2, 3, 4, 5, 6, 7]
    .map(
      (i) =>
        `<rect x="10" y="${5 + i * 3.4}" width="16" height="2.2" fill="${i % 2 ? "#cfcfcf" : "#222"}"/>`,
    )
    .join("") +
  "</svg>";

// TGATE_ICON: the conventional transmission-gate glyph — two overlapping
// opposite-pointing triangles between the A and B terminals — with the EN lead
// entering the top (FR-071g). Same glyph as drawTgate on the canvas.
const TGATE_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="11,9 11,27 25,18"/>' + // left triangle, apex pointing right
  '<polygon points="25,9 25,27 11,18"/>' + // right triangle, apex pointing left
  '<line x1="3" y1="18" x2="11" y2="18"/>' + // A lead (left)
  '<line x1="25" y1="18" x2="33" y2="18"/>' + // B lead (right)
  '<line x1="18" y1="2" x2="18" y2="9"/>' + // EN lead entering the top
  "</svg>";

// RELAY_ICON: a schematic SPDT relay (FR-071h) — a coil whose single logic-level
// lead enters from the top, and on the right the three contact terminals: COM
// (the common pole, marked with a dot) plus NO and NC. No moving contact arm is
// drawn (it could not track the simulated state). Same glyph as drawRelay on the
// canvas (the NO/COM/NC labels are canvas-only). Coords track the 4×4 footprint
// at scale 7, origin (2,8).
const RELAY_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="4.8" y="15" width="5.6" height="14" fill="#fff"/>' + // coil
  '<line x1="9" y1="4.5" x2="9" y2="15"/>' + // COIL lead (top) into the coil
  '<line x1="33.5" y1="22" x2="24.4" y2="22"/>' + // COM common pole
  '<line x1="33.5" y1="29" x2="27.2" y2="29"/>' + // NC terminal (bottom)
  '<line x1="33.5" y1="15" x2="27.2" y2="15"/>' + // NO terminal (top)
  '<circle cx="24.4" cy="22" r="1.4" fill="#333" stroke="none"/>' + // COM pole dot
  "</svg>";

// UART_ICON: an IC-style box reading "UART" (FR-122a). The same glyph is drawn
// on the canvas (drawLabelBox with "UART") so the palette tile and the placed
// object match.
const UART_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="3" y="10" width="30" height="16" fill="#fff" stroke="#333"/>' +
  '<text x="18" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="9" fill="#000">UART</text>' +
  "</svg>";

// BIT_NAMES returns the n bit names "<prefix>0".."<prefix>(n-1)" for a wide
// built-in's pins and its single pin group (FR-071d/e). n defaults to 8 (the
// fixed-width 8-wide indicator); the multi-bit port passes its chosen width.
const BIT_NAMES = (prefix, n = 8) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// BIT_PINS lays the n bit pins down one side at grid rows 1..n — a 3×(n+1)
// footprint leaves a one-unit margin top and bottom (FR-071d/e).
const BIT_PINS = (prefix, side, direction, n = 8) =>
  BIT_NAMES(prefix, n).map((name, i) => ({ name, side, position: i + 1, direction }));

// Multi-bit port width bounds and default (FR-071e): the drop-time dialog
// constrains the chosen width to [2, 16]; the palette prototype uses the default.
export const PORTN_MIN_WIDTH = 2;
export const PORTN_MAX_WIDTH = 16;
export const PORTN_DEFAULT_WIDTH = 8;

// portNFields returns the width-driven typeData fields for a multi-bit port of
// the given bit width (FR-071e): N left-edge bidir pins P0..P(N-1) in one pin
// group P, in a 3×(N+1) footprint. The chosen width is fixed at placement; the
// drop flow (§6.14) stamps these onto the instance's typeData.
export function portNFields(width) {
  return {
    width: 3,
    height: width + 1,
    pins: BIT_PINS("P", "left", "bidir", width),
    pinGroups: [{ name: "P", pins: BIT_NAMES("P", width) }],
  };
}

// builtinId is the immutable library id of a built-in type (FR-066e): the same
// "type-"+name rule the YAML library and the save-format migration use, so a
// built-in instance's `type` (its id) resolves uniformly with loaded parts.
const builtinId = (name) => "type-" + name;

const BUILTIN_DEFS = [
  {
    name: "indicator",
    builtin: true,
    title: "State indicator", // palette tooltip (FR-006a)
    icon: INDICATOR_ICON, // palette tile glyph (FR-006a)
    renderType: "indicator",
    width: 2,
    height: 2,
    // One input connection point, centered on the bottom edge (FR-068).
    pins: [{ name: "IN", side: "bottom", position: 1, direction: "in" }],
  },
  {
    name: "pullup",
    builtin: true,
    title: "pull up", // FR-069
    icon: PULLUP_ICON,
    renderType: "pullup",
    width: 2,
    height: 2,
    pins: [{ name: "OUT", side: "bottom", position: 1, direction: "out" }],
  },
  {
    name: "pulldown",
    builtin: true,
    title: "pull down", // FR-070
    icon: PULLDOWN_ICON,
    renderType: "pulldown",
    width: 2,
    height: 2,
    pins: [{ name: "OUT", side: "top", position: 1, direction: "out" }],
  },
  {
    name: "clock",
    builtin: true,
    title: "clock", // FR-071
    icon: CLOCK_ICON,
    renderType: "clock",
    width: 3,
    height: 2,
    pins: [{ name: "OUT", side: "right", position: 1, direction: "out" }],
    // FR-071a: the simulator advances period × speed simulated ns per real
    // second (defaults: 100 simulated ns per real second).
    properties: [
      { name: "period", unit: "ns", default: 100 }, // simulated clock period
      { name: "speed", unit: "Hz", default: 1 }, // human-perceived clock rate
    ],
  },
  {
    name: "reset",
    builtin: true,
    title: "power-on reset", // FR-071b
    icon: RESET_ICON,
    renderType: "reset",
    width: 3,
    height: 3,
    pins: [
      { name: "R", side: "right", position: 1, direction: "out" }, // active high
      { name: "/R", side: "right", position: 2, direction: "out" }, // active low
    ],
    // FR-071b: reset asserted for the first cycles × clockPeriod units of a run.
    properties: [{ name: "cycles", unit: "cycles", default: 3 }],
  },
  {
    name: "switch",
    builtin: true,
    title: "input switch", // FR-071c
    icon: SWITCH_ICON,
    renderType: "switch",
    width: 2,
    height: 2,
    pins: [{ name: "OUT", side: "right", position: 1, direction: "out" }],
    // State is per-instance interactive state (inst.switchState, "0"|"1",
    // default "0"), not a numeric property (FR-071c); set via the properties
    // panel (FR-020c) or a click while simulating (FR-087a).
  },
  {
    name: "port",
    builtin: true,
    title: "port / off-sheet connector", // FR-094
    icon: PORT_ICON,
    renderType: "port",
    width: 2,
    height: 2,
    // One connection point on the right edge; the flag body and label sit to its
    // left. The pin carries the bit the interface net attaches to (FR-094).
    pins: [{ name: "P", side: "right", position: 1, direction: "bidir" }],
    // Per-instance fields beyond the usual ones (the switchState precedent),
    // set on placement by addInstance and edited in the properties panel:
    //   label (signal name), portDir (in|out|bidir), width (bits, default 1),
    //   and an optional off-sheet target {file, label} (FR-101). (§6.14, §7.2)
  },
  {
    name: "indicator8",
    builtin: true,
    title: "state indicator (8-wide)", // FR-071d palette tooltip
    icon: BARGRAPH_ICON,
    renderType: "indicator8",
    width: 3,
    height: 9,
    // Eight input bits down the left edge (one grid row each), grouped so an
    // 8-bit bus snap-connects to all of them at once (FR-041/FR-042), adopting
    // D0..D7 as its bit names. Display-only, like the 1-wide indicator (FR-068).
    pins: BIT_PINS("D", "left", "in"),
    pinGroups: [{ name: "D", pins: BIT_NAMES("D") }],
  },
  {
    name: "portN",
    builtin: true,
    title: "port / off-sheet connector (multi-bit)", // FR-071e palette tooltip
    icon: PORTN_ICON,
    renderType: "portN",
    // Palette prototype at the default width; the drop dialog (§6.14) regenerates
    // these fields for the user's chosen width (2–16) on placement. Each instance
    // carries a `label` (interface signal name) and the chosen bit `width`, joins
    // the interface (FR-095) with a derived direction (FR-094c), and snaps an
    // N-bit bus to its P0..P(N-1) group (FR-041/FR-042).
    ...portNFields(PORTN_DEFAULT_WIDTH),
  },
  {
    name: "tgate",
    builtin: true,
    title: "transmission gate", // FR-071g palette tooltip
    icon: TGATE_ICON,
    renderType: "tgate", // not "switch" — the input switch owns that renderType
    width: 2,
    height: 2,
    // Two symmetric, interchangeable contact terminals (bidir) plus an active-
    // high enable on top (FR-071g). No properties, and no BEHAVIORS/INTERACTIONS
    // entry: the engine realizes it as a kind:"pass" entity (§6.13, FR-083a).
    pins: [
      { name: "A", side: "left", position: 1, direction: "bidir" },
      { name: "B", side: "right", position: 1, direction: "bidir" },
      { name: "EN", side: "top", position: 1, direction: "in" },
    ],
  },
  {
    name: "relay",
    builtin: true,
    title: "relay (SPDT)", // FR-071h palette tooltip
    icon: RELAY_ICON,
    renderType: "relay",
    width: 4,
    height: 4,
    // Idealized single-pin logic-level coil (in, on the top edge) and an SPDT
    // changeover contact: NO/COM/NC down the right edge, all bidir (FR-071h). No
    // properties, and no BEHAVIORS/INTERACTIONS entry — realized as a kind:"pass"
    // entity (§6.13).
    pins: [
      { name: "COIL", side: "top", position: 1, direction: "in" },
      { name: "NO", side: "right", position: 1, direction: "bidir" },
      { name: "COM", side: "right", position: 2, direction: "bidir" },
      { name: "NC", side: "right", position: 3, direction: "bidir" },
    ],
  },
  {
    name: "uart",
    builtin: true,
    title: "magic UART", // FR-122a palette tooltip
    icon: UART_ICON,
    renderType: "uart",
    width: 4,
    height: 9,
    // Eight data inputs D0..D7 down the left edge (one grid row each), grouped so
    // an 8-bit bus snap-connects to all of them at once (FR-041/FR-042), adopting
    // D0..D7 as its bit names; the control pins CS//CE//CLK on the opposite
    // (right) edge (FR-122/FR-122a). No properties and no BEHAVIORS entry — its
    // behavior reads input nets and keeps state, so the engine realizes it as a
    // kind:"uart" entity over the uart.js core (§6.20, FR-122b).
    pins: [
      ...BIT_PINS("D", "left", "in"),
      { name: "CS/", side: "right", position: 1, direction: "in" },
      { name: "CE/", side: "right", position: 2, direction: "in" },
      { name: "CLK", side: "right", position: 3, direction: "in" },
    ],
    pinGroups: [{ name: "DATA", pins: BIT_NAMES("D") }],
  },
  {
    name: "note",
    builtin: true,
    title: "text note", // FR-071f palette tooltip
    icon: NOTE_ICON,
    renderType: "note",
    // Auto-sizes to its text (FR-071f); these are the empty-note minimum, in grid
    // units, recomputed on each text commit.
    width: 4,
    height: 2,
    // Pure annotation: no pins, no pinGroups, no properties, and no entry in
    // BEHAVIORS/INTERACTIONS below. Per-instance text lives in inst.text.
    pins: [],
  },
];

// BUILTINS stamps each definition with its immutable id (FR-066e); placement and
// the simulator key off `id` (typeIdentity, §6.6), divorced from the name.
export const BUILTINS = BUILTIN_DEFS.map((t) => ({ id: builtinId(t.name), ...t }));

// memDeviceType synthesizes the ComponentType for a generator-defined memory
// device (FR-114c) from a validated dialog spec {name, kind, addressBits,
// dataWidth, locations, romFile?, ramFile?, ramLoad?}. Its free-form `name` is the display name and
// also derives the immutable library id `type-<name>` (the same rule loaded parts
// and GAL parts use, FR-066e), so two devices with different names are distinct
// types and a name colliding with any existing type is rejected by the caller. It
// is an ordinary IC-style type — deliberately **not** `builtin`, so it gets a
// U-series refdes (FR-011) and the default labelled-rectangle render (§6.8) —
// with n address inputs A0..A(n-1) plus CE//OE/ (and WE/ for RAM) down the left
// edge, and w data pins D0..D(w-1) down the right, exposed as the snap-connectable
// groups ADDR and DATA (FR-063). Data pins are bidirectional on a RAM and tristate
// on a ROM (FR-062a). The built-in behavior (FR-114d) and cross-session
// persistence are deferred (FR-114b/OQ-013); the `mem` field carries the spec for
// that later work and round-trips with a placed instance (FR-057). Pure — no DOM,
// no behavior yet. Outline mirrors the server's resolveOutline (§6.3): width
// floors at 4 (no top/bottom pins), height fits the taller edge plus a 2-unit
// margin.
export function memDeviceType(spec) {
  const { name, kind, addressBits: n, dataWidth: w, locations } = spec;
  const isRam = kind === "ram";
  const pins = [];
  const addrNames = [];
  for (let i = 0; i < n; i++) {
    addrNames.push(`A${i}`);
    pins.push({ name: `A${i}`, side: "left", position: i + 1, direction: "in" });
  }
  const ctrl = isRam ? ["CE/", "OE/", "WE/"] : ["CE/", "OE/"];
  ctrl.forEach((name, i) =>
    pins.push({ name, side: "left", position: n + 1 + i, direction: "in" }),
  );
  const dataDir = isRam ? "bidir" : "tristate";
  const dataNames = [];
  for (let i = 0; i < w; i++) {
    dataNames.push(`D${i}`);
    pins.push({ name: `D${i}`, side: "right", position: i + 1, direction: dataDir });
  }
  const maxLeftRight = Math.max(n + ctrl.length, w);
  return {
    id: `type-${name}`,
    name,
    description: `${locations}×${w} ${kind.toUpperCase()} (generated)`,
    mem: {
      kind,
      addressBits: n,
      dataWidth: w,
      locations,
      ...(spec.romFile ? { romFile: spec.romFile } : {}),
      ...(isRam && spec.ramFile ? { ramFile: spec.ramFile, ramLoad: !!spec.ramLoad } : {}),
    },
    width: 4,
    height: Math.max(maxLeftRight + 2, 4),
    pins,
    pinGroups: [
      { name: "ADDR", pins: addrNames },
      { name: "DATA", pins: dataNames },
    ],
  };
}

// BEHAVIORS maps built-in type name → behavior function (FR-067a). Behaviors
// are code, not data: they live here — not on the ComponentType — because
// typeData is deep-copied into instances and saved as JSON (FR-057, §7.1),
// which would drop a function value. The simulator resolves a behavior by
// `inst.type` at run time and calls it each unit step with
// `{props, simTime}` (effective property values per FR-020b; simulated ns);
// it returns this step's driver contributions `[{pin, value, weak?}]` (§6.13).
// Defined keyed by readable name, then exported keyed by id (FR-066e) so the
// simulator's `BEHAVIORS[inst.type]` lookup matches the instance's id `type`.
const BEHAVIOR_DEFS = {
  // Display only: the indicator drives nothing (FR-068).
  indicator() {
    return [];
  },
  // Weak drivers (FR-083): effective only when no strong driver is enabled.
  pullup() {
    return [{ pin: "OUT", value: V1, weak: true }];
  },
  pulldown() {
    return [{ pin: "OUT", value: V0, weak: true }];
  },
  // Square wave, 50% duty cycle: low for the first half of each period, so the
  // first rising edge lands half a period in (FR-084).
  clock({ props, simTime }) {
    const period = Math.max(2, Math.floor(props.period));
    const half = Math.floor(period / 2);
    return [{ pin: "OUT", value: simTime % period < half ? V0 : V1 }];
  },
  // Power-on reset (FR-071b): R high and /R low for the first
  // cycles × clockPeriod units of the run, the inverse afterward. With the
  // FR-084 waveform (first rising edge half a period in) this spans the first
  // `cycles` rising edges, releasing half a period after the last.
  // clockPeriod is resolved once at Run by sim.js (§6.13).
  reset({ props, simTime, clockPeriod }) {
    const active = simTime < props.cycles * clockPeriod;
    return [
      { pin: "R", value: active ? V1 : V0 },
      { pin: "/R", value: active ? V0 : V1 },
    ];
  },
  // Strong driver of its current state (FR-087a): "1"→V1, otherwise V0 (a
  // legacy "U" or unset reads as 0). `state` is the live inst.switchState (§6.13).
  switch({ state }) {
    return [{ pin: "OUT", value: state === "1" ? V1 : V0 }];
  },
  // A port drives nothing on its own: within a sheet, same-label ports share a
  // net (FR-094a, netlist step 6); cross-file continuation is composed at Run by
  // flatten (FR-101a, §6.14). It is a net-label node, not a source.
  port() {
    return [];
  },
  // Display only, like the 1-wide indicator (FR-071d): drives nothing; the
  // renderer reads each bit's net value to light the bar-graph stripes.
  indicator8() {
    return [];
  },
  // Multi-bit port (FR-071e): drives nothing on its own — it is an interface
  // node (FR-095). Off-sheet net joining (same-label / cross-file) is deferred.
  portN() {
    return [];
  },
};

// BEHAVIORS is BEHAVIOR_DEFS re-keyed by type id (FR-066e/FR-067a).
export const BEHAVIORS = Object.fromEntries(
  Object.entries(BEHAVIOR_DEFS).map(([name, fn]) => [builtinId(name), fn]),
);

// INTERACTIONS maps built-in type id → an interaction handler (inst) => void
// that mutates the instance's interactive state in place (FR-087b). It is the
// input-side analogue of BEHAVIORS (output side): a type with an entry here is
// interactive and accepts a sim-time click, routed through store.applyLive by
// the interaction FSM (§6.9), which wakes the simulator to re-evaluate (§6.13).
// A new interactive input is added by registering a handler here plus a render
// branch — no scheduler or FSM change. Defined by name, exported keyed by id
// (FR-066e) so `INTERACTIONS[inst.type]` matches the instance's id `type`.
const INTERACTION_DEFS = {
  // Toggle the switch between its two states 0↔1 (FR-087a). Anything that is
  // not "1" (including a legacy "U") toggles to "1".
  switch(inst) {
    inst.switchState = inst.switchState === "1" ? "0" : "1";
  },
};

export const INTERACTIONS = Object.fromEntries(
  Object.entries(INTERACTION_DEFS).map(([name, fn]) => [builtinId(name), fn]),
);
