// Client-side registry of built-in editor objects (FR-067, FR-068). These are
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
];
