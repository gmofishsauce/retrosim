// Client-side registry of built-in editor objects (FR-067–FR-071). These are
// synthetic ComponentTypes defined by the app rather than loaded from YAML; once
// placed they flow through the normal instance machinery (§6.6). Each carries
// `builtin: true` so addInstance assigns an A-<n> designator (FR-011a) and the
// palette files it into the lower region (FR-006a).

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
  },
];
