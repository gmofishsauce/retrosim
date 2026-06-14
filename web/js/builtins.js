import { V0, V1, VU } from "./engine/galasm.js";

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

// SWITCH_ICON: a rotary dial — a circle with 1 / 0 / ? position marks and a
// pointer (FR-071c). The placed object draws the pointer at its current
// switchState; the palette glyph shows a representative position.
const SWITCH_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<circle cx="18" cy="18" r="15" fill="#fff" stroke="#333"/>' +
  '<text x="18" y="7" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-size="7" fill="#000">1</text>' +
  '<text x="29" y="25" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-size="7" fill="#000">0</text>' +
  '<text x="7" y="25" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-size="7" fill="#000">?</text>' +
  '<line x1="18" y1="18" x2="18" y2="8" stroke="#000" stroke-width="2"' +
  ' stroke-linecap="round"/>' +
  '<circle cx="18" cy="18" r="2.5" fill="#333"/></svg>';

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
    // Position is per-instance interactive state (inst.switchState, default
    // "U"), not a numeric property (FR-071c); set via the properties panel
    // (FR-020c) or a dial click while simulating (FR-087a).
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
  // Strong driver of its current dial position (FR-087a): "1"→V1, "0"→V0,
  // "U" (or unset)→VU. `state` is the live inst.switchState (§6.13).
  switch({ state }) {
    const value = state === "1" ? V1 : state === "0" ? V0 : VU;
    return [{ pin: "OUT", value }];
  },
};

// INTERACTIONS maps built-in type name → an interaction handler (inst) => void
// that mutates the instance's interactive state in place (FR-087b). It is the
// input-side analogue of BEHAVIORS (output side): a type with an entry here is
// interactive and accepts a sim-time click, routed through store.applyLive by
// the interaction FSM (§6.9), which wakes the simulator to re-evaluate (§6.13).
// A new interactive input is added by registering a handler here plus a render
// branch — no scheduler or FSM change.
const SWITCH_NEXT = { U: "1", "1": "0", "0": "U" }; // dial cycle ? → 1 → 0 → ?
export const INTERACTIONS = {
  // Advance the switch one dial position (FR-087a).
  switch(inst) {
    const cur = inst.switchState === "1" || inst.switchState === "0" ? inst.switchState : "U";
    inst.switchState = SWITCH_NEXT[cur];
  },
};
