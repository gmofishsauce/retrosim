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

// PORT_ICON: a flag/tag pointing at its connection point (FR-094). The port is
// the shared primitive behind both hierarchical interfaces and off-sheet
// connectors (§6.14); the placed object shows the instance's label.
const PORT_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<path d="M5 11 H22 L31 18 L22 25 H5 Z" fill="#fff" stroke="#333"/>' +
  '<text x="14" y="18" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="9" fill="#000">P</text>' +
  "</svg>";

// PORT8_ICON: a short stacked column of right-pointing pentagons, suggesting the
// 8-wide port (FR-071e). Fewer than eight, with no letter — the stack only marks
// the type. The same glyph is used for the palette tile and the placed object.
const PORT8_ICON =
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

// BIT_NAMES returns the eight bit names "<prefix>0".."<prefix>7" for an 8-wide
// built-in's pins and its single pin group (FR-071d/e).
const BIT_NAMES = (prefix) => Array.from({ length: 8 }, (_, i) => `${prefix}${i}`);

// BIT_PINS lays the eight bit pins down one side at grid rows 1..8 — a 3×9
// footprint leaves a one-unit margin top and bottom (FR-071d/e).
const BIT_PINS = (prefix, side, direction) =>
  BIT_NAMES(prefix).map((name, i) => ({ name, side, position: i + 1, direction }));

export const BUILTINS = [
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
    name: "port8",
    builtin: true,
    title: "port / off-sheet connector (8 wide)", // FR-071e palette tooltip
    icon: PORT8_ICON,
    renderType: "port8",
    width: 3,
    height: 9,
    // Eight on-sheet ("internal") bits down the left edge, grouped for bus snap
    // (FR-041/FR-042), adopting P0..P7. A grouped bus terminal only for now: it
    // drives nothing and does no off-sheet net joining yet (FR-071e); the
    // external/off-sheet side stays virtual.
    pins: BIT_PINS("P", "left", "bidir"),
    pinGroups: [{ name: "P", pins: BIT_NAMES("P") }],
  },
];

// BEHAVIORS maps built-in type name → behavior function (FR-067a). Behaviors
// are code, not data: they live here — not on the ComponentType — because
// typeData is deep-copied into instances and saved as JSON (FR-057, §7.1),
// which would drop a function value. The simulator resolves a behavior by
// `inst.type` at run time and calls it each unit step with
// `{props, simTime}` (effective property values per FR-020b; simulated ns);
// it returns this step's driver contributions `[{pin, value, weak?}]` (§6.13).
export const BEHAVIORS = {
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
  // Grouped bus terminal (FR-071e): drives nothing on its own. Off-sheet net
  // joining (same-label / cross-file) is deferred to a later change.
  port8() {
    return [];
  },
};

// INTERACTIONS maps built-in type name → an interaction handler (inst) => void
// that mutates the instance's interactive state in place (FR-087b). It is the
// input-side analogue of BEHAVIORS (output side): a type with an entry here is
// interactive and accepts a sim-time click, routed through store.applyLive by
// the interaction FSM (§6.9), which wakes the simulator to re-evaluate (§6.13).
// A new interactive input is added by registering a handler here plus a render
// branch — no scheduler or FSM change.
export const INTERACTIONS = {
  // Toggle the switch between its two states 0↔1 (FR-087a). Anything that is
  // not "1" (including a legacy "U") toggles to "1".
  switch(inst) {
    inst.switchState = inst.switchState === "1" ? "0" : "1";
  },
};
