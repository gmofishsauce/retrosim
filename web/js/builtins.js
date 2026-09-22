import { V0, V1, VU, evalTerm } from "./engine/galasm.js";

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

// --- Seven-segment hex display (FR-071j) ---------------------------------
//
// HEX_SEGMENTS is the decode: for each nibble value 0..15, a bitmask of the
// segments that light, bit 0 = a (top) through bit 6 = g (middle), in the
// conventional a,b,c,d,e,f,g order that sevenSegPolys below returns. The letters
// use the only seven-segment forms that stay distinct from digits — upper-case
// A, C, E, F and lower-case b, d (an upper-case B is an 8 and an upper-case D is
// a 0). The table is the whole of the display's behavior: it is combinational,
// so there is nothing else to remember about it.
export const HEX_SEGMENTS = [
  0b0111111, // 0: abcdef
  0b0000110, // 1: bc
  0b1011011, // 2: abdeg
  0b1001111, // 3: abcdg
  0b1100110, // 4: bcfg
  0b1101101, // 5: acdfg
  0b1111101, // 6: acdefg
  0b0000111, // 7: abc
  0b1111111, // 8: all
  0b1101111, // 9: abcdfg
  0b1110111, // A: abcefg
  0b1111100, // b: cdefg
  0b0111001, // C: adef
  0b1011110, // d: bcdeg
  0b1111001, // E: adefg
  0b1110001, // F: aefg
];

// ALL_SEGMENTS is the "value unknown" face (FR-071j): every segment lit, drawn in
// the indicator's undriven gray — a gray 8, the ghost a real display shows when
// it is off.
export const ALL_SEGMENTS = 0b1111111;

// sevenSegPolys returns the seven segment outlines of one digit occupying the
// box (x0,y0,w,h), each as a list of [x,y] points in that same frame, in the
// order a,b,c,d,e,f,g (matching HEX_SEGMENTS' bit order). `t` is the segment
// thickness. Each segment is the classic tapered hexagon — a bar with 45° ends —
// so neighboring segments meet at a mitre instead of overlapping. Frame-agnostic
// and unit-free: the canvas passes grid units (drawn through fillLocalPoly, so
// rotation and zoom come free) and the palette icon passes SVG user units, which
// is what keeps the tile's glyph and the placed object's glyph the same shape.
export function sevenSegPolys(x0, y0, w, h, t) {
  const g = t * 0.55; // gap at each end, where two segments would otherwise meet
  const h2 = t / 2;
  const xl = x0 + h2;
  const xr = x0 + w - h2;
  const yt = y0 + h2;
  const ym = y0 + h / 2;
  const yb = y0 + h - h2;
  const bar = (y, xa, xb) =>
    [[xa, y], [xa + h2, y - h2], [xb - h2, y - h2], [xb, y], [xb - h2, y + h2], [xa + h2, y + h2]];
  const post = (x, ya, yb2) =>
    [[x, ya], [x + h2, ya + h2], [x + h2, yb2 - h2], [x, yb2], [x - h2, yb2 - h2], [x - h2, ya + h2]];
  return [
    bar(yt, xl + g, xr - g), // a — top
    post(xr, yt + g, ym - g), // b — upper right
    post(xr, ym + g, yb - g), // c — lower right
    bar(yb, xl + g, xr - g), // d — bottom
    post(xl, ym + g, yb - g), // e — lower left
    post(xl, yt + g, ym - g), // f — upper left
    bar(ym, xl + g, xr - g), // g — middle
  ];
}

// HEXDISP_ICON: the two-digit display package showing "AF" — two hex letters, so
// the tile says at a glance what the part decodes (FR-071j). Built from
// sevenSegPolys and HEX_SEGMENTS, the same pair the canvas renderer draws from,
// so the tile and the placed object cannot drift apart.
const HEXDISP_ICON = (() => {
  const digit = (x, mask) =>
    sevenSegPolys(x, 9, 11, 18, 1.9)
      .map(
        (pts, i) =>
          `<polygon points="${pts.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(" ")}"` +
          ` fill="${(mask >> i) & 1 ? "#222" : "#e0e0e0"}"/>`,
      )
      .join("");
  return (
    '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
    '<rect x="4" y="6" width="28" height="24" rx="1.5" fill="#fff" stroke="#333"/>' +
    digit(6, HEX_SEGMENTS[0xa]) +
    digit(19, HEX_SEGMENTS[0xf]) +
    "</svg>"
  );
})();

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

// --- Labeled 3-to-8 decoder (FR-071k) -------------------------------------
//
// DECODER_LABEL_MAX is the per-value string limit (five characters), enforced
// at the source — the properties-panel field — and again at draw time, so a
// design hand-edited or carried in from elsewhere still cannot overflow the
// title band.
export const DECODER_LABEL_MAX = 5;

// DECODER_DISABLED_TEXT is the face shown whenever there is no decoded
// selection to name (FR-071k): the decoder disabled, an enable or address bit
// not a defined 0/1, or no run at all. Four dashes, as specified — deliberately
// shorter than the five-character maximum, so it never reads as a label.
export const DECODER_DISABLED_TEXT = "----";

// DECODER_OUTPUTS names the eight active-low outputs in value order, so
// DECODER_OUTPUTS[n] is the pin selected by input value n.
// DECODER_BAND_H is the height, in grid units, of the title band that carries
// the decoded string across the top of the body (FR-071k) — the "on top of the
// component" the requirement asks for, drawn inside the outline so it cannot
// collide with the designator the shared label pass puts above every built-in.
export const DECODER_BAND_H = 2;

export const DECODER_OUTPUTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `/Y${i}`);

// DECODER_TERMS[n] is the AND term that selects output n, as a GALasm literal
// list ({signal, low}) over this built-in's own pin names — the 74138's
// equations with one active-high enable (E) and one active-low (/E):
//
//   /Yn = E * //E * <A2> * <A1> * <A0>
//
// Written as data rather than as JS conditionals so the slow engine can
// evaluate it with galasm.js's own `evalTerm` (FR-077 selective pessimism, so a
// 0 on any input still decides the term over a U on another) and the fast engine
// can lower the identical literals to rt_and/rt_not (§6.17) — one definition of
// the logic, two engines, which is what FR-107 parity asks for.
export const DECODER_TERMS = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [
  { signal: "E", low: false },
  { signal: "/E", low: true },
  { signal: "A2", low: (n & 4) === 0 },
  { signal: "A1", low: (n & 2) === 0 },
  { signal: "A0", low: (n & 1) === 0 },
]);

// decoderSelection reads the five inputs through `read(pinName) → V0|V1|VU|VZ`
// and returns the selected value 0..7, or null when there is none: the decoder
// disabled (E not 1, or /E not 0) or any address bit not a defined 0/1. Null is
// the display's dashes case (FR-071k); it says nothing about the outputs, which
// the behavior below decides per output with the full four-state rules.
export function decoderSelection(read) {
  if (read("E") !== V1 || read("/E") !== V0) return null;
  let v = 0;
  for (let i = 0; i < 3; i++) {
    const b = read(`A${i}`);
    if (b === V1) v |= 1 << i;
    else if (b !== V0) return null;
  }
  return v;
}

// decoderText returns the string the title band shows for selection `sel`
// (decoderSelection's result): the instance's string for that value, clipped to
// DECODER_LABEL_MAX; the value's own digit when no string is set, so a decoder
// nobody has labeled still reads out its state; and the four dashes when there
// is no selection at all.
export function decoderText(inst, sel) {
  if (sel === null || sel === undefined) return DECODER_DISABLED_TEXT;
  const s = inst?.decodeLabels?.[sel];
  return s ? String(s).slice(0, DECODER_LABEL_MAX) : String(sel);
}

// DECODER_ICON: the placed object in miniature (FR-071k) — a box with a title
// band showing the disabled face over the "3:8" body, so the tile says both what
// the part is and that its top line is a readout.
const DECODER_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">' +
  '<rect x="4" y="5" width="28" height="26" fill="#fff" stroke="#333"/>' +
  '<line x1="4" y1="14" x2="32" y2="14" stroke="#333"/>' +
  '<text x="18" y="10" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="ui-monospace,monospace" font-size="8" fill="#000">----</text>' +
  '<text x="18" y="23" text-anchor="middle" dominant-baseline="central"' +
  ' font-family="system-ui,sans-serif" font-weight="bold" font-size="10" fill="#000">3:8</text>' +
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
    name: "hexdisplay",
    builtin: true,
    title: "hex display (2-digit)", // FR-071j palette tooltip
    icon: HEXDISP_ICON,
    renderType: "hexdisplay",
    // Wider than the other 8-bit built-ins: the body has to hold two digits.
    // Height 9 for the same reason indicator8 is 9 — eight pin rows plus a
    // one-unit margin top and bottom.
    width: 8,
    height: 9,
    // Eight input bits down the left edge, grouped so an 8-bit bus snap-connects
    // to all of them at once (FR-041/FR-042), adopting D0..D7 as its bit names.
    // D0 is the LSB: D3..D0 decode to the right digit, D7..D4 to the left.
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
    // changeover contact: NO/COM/NCC down the right edge, all bidir (FR-071h).
    // The normally-closed terminal is NCC, not NC: the pin name NC is reserved
    // library-wide for "no connect" (FR-062f) and cannot mean two things. No
    // properties, and no BEHAVIORS/INTERACTIONS entry — realized as a kind:"pass"
    // entity (§6.13).
    pins: [
      { name: "COIL", side: "top", position: 1, direction: "in" },
      { name: "NO", side: "right", position: 1, direction: "bidir" },
      { name: "COM", side: "right", position: 2, direction: "bidir" },
      { name: "NCC", side: "right", position: 3, direction: "bidir" },
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
    name: "decoder",
    builtin: true,
    title: "decoder (3-to-8, labeled)", // FR-071k palette tooltip
    icon: DECODER_ICON,
    renderType: "decoder",
    // A title band (the top DECODER_BAND_H rows) over the pin field: eight
    // output rows 3..10 plus a one-unit bottom margin make the height 11, and
    // the width holds five monospace characters between the two pin-name
    // columns.
    width: 8,
    height: 11,
    // Five inputs down the left edge — the two enables above the three address
    // bits, separated by a blank row — and the eight active-low outputs down the
    // right (FR-071k). Like the magic UART this is an IC-style built-in whose pin
    // names are drawn, so E and /E are tellable apart on the canvas.
    pins: [
      { name: "E", side: "left", position: 3, direction: "in" },
      { name: "/E", side: "left", position: 4, direction: "in" },
      { name: "A2", side: "left", position: 6, direction: "in" },
      { name: "A1", side: "left", position: 7, direction: "in" },
      { name: "A0", side: "left", position: 8, direction: "in" },
      ...DECODER_OUTPUTS.map((name, i) => ({
        name,
        side: "right",
        position: i + 3,
        direction: "out",
      })),
    ],
    // The three address bits as one group (LSB first, the 74138's convention) so
    // a 3-bit bus snap-connects to all of them at once (FR-041/FR-042). The
    // outputs are deliberately ungrouped: a bus adopts its group's pin names as
    // bit names, and the active-low `/Y0`–`/Y7` do not make usable ones.
    pinGroups: [{ name: "A", pins: ["A0", "A1", "A2"] }],
    // The eight display strings are per-instance state (inst.decodeLabels), not
    // numeric properties (FR-020b) — the switchState/note-text precedent — set
    // through the properties panel (FR-020e) and round-tripping with the
    // instance (§7.2). The decoder declares no properties.
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

// NOCONNECT_ICON: the small X of the no-connect mark (FR-071i), centered in the
// tile — the same glyph canvas.js draws on a marked pin.
const NOCONNECT_ICON =
  '<svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"' +
  ' fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round">' +
  '<line x1="12" y1="12" x2="24" y2="24"/>' +
  '<line x1="24" y1="12" x2="12" y2="24"/></svg>';

// PIN_MARK_TOOL is the no-connect mark's palette entry (FR-071i), and is
// deliberately NOT a member of BUILTINS: every consumer of that list treats its
// entries as placeable component types (placement, type resolution for an
// instance's `type` id, the refdes series, the generator's and exporters' type
// switches), and this places no instance at all — it toggles a pin name on an
// instance that is already there (§6.22). The palette appends its tile to the
// lower region and the interaction layer enters the `markPin` tool on click.
export const PIN_MARK_TOOL = {
  id: "tool-noconnect",
  title: "no connect", // palette tooltip (FR-071i)
  icon: NOCONNECT_ICON,
};

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
  // A port drives nothing of its own: within a sheet, same-label ports share a
  // net (FR-094a, netlist step 6); cross-file continuation is composed at Run by
  // flatten (FR-101a, §6.14). It is a net-label node, not a source. The one
  // exception is the run-time debug drive of FR-094g — a sim-time click on an
  // eligible port — which arrives as `drive` and exists only on the run-time
  // copy, never in the saved design: with none, this is still the empty list.
  port({ drive }) {
    const v = driveValue(drive?.[0]);
    return v === null ? [] : [{ pin: "P", value: v }];
  },
  // Labeled 3-to-8 decoder (FR-071k): eight active-low outputs, one per input
  // value, driven by the DECODER_TERMS literals above. Unlike every earlier
  // built-in this behavior READS its own input nets, through the `read`
  // accessor the simulator now supplies in ctx (§6.13) — the same previous-step
  // accessor the memory and UART entities take, so the outputs follow the inputs
  // by the standard one unit (FR-078). `/Yn = term` means pin /Yn is LOW exactly
  // when its term is true, hence the inversion here; evalTerm supplies the
  // four-state rules (a 0 on any input decides the term even when another reads
  // U, FR-077), so a disabled decoder drives all eight outputs high without
  // knowing its address.
  decoder({ read }) {
    return DECODER_TERMS.map((term, i) => {
      const t = evalTerm(term, read);
      return { pin: DECODER_OUTPUTS[i], value: t === VU ? VU : t === V1 ? V0 : V1 };
    });
  },
  // Display only, like the 1-wide indicator (FR-071d): drives nothing; the
  // renderer reads each bit's net value to light the bar-graph stripes.
  indicator8() {
    return [];
  },
  // Display only, like the indicators (FR-071j): drives nothing, and keeps no
  // state — the renderer decodes the eight live net values into two hex digits
  // every frame, so "combinational" needs no machinery here at all.
  hexdisplay() {
    return [];
  },
  // Multi-bit port (FR-071e): drives nothing on its own — it is an interface
  // node (FR-095). Off-sheet net joining (same-label / cross-file) is deferred.
  // Like the 1-wide port it drives only what a debug click put on its run-time
  // copy (FR-094g), and there per bit: an undriven bit contributes nothing at
  // all, so a run nobody clicked resolves exactly as it did before.
  portN({ drive }) {
    if (!drive) return [];
    const out = [];
    for (let i = 0; i < drive.length; i++) {
      const v = driveValue(drive[i]);
      if (v !== null) out.push({ pin: `P${i}`, value: v });
    }
    return out;
  },
};

// driveValue maps one bit of a port's run-time debug drive (FR-094g) to the
// logic value it strong-drives, or null for the undriven default — the state
// that contributes no driver at all rather than driving U, which is what lets a
// bidir port sit on a three-state bus without contending until it is clicked.
const driveValue = (d) => (d === "1" ? V1 : d === "0" ? V0 : null);

// WEAK_DRIVERS names the built-ins whose output is a WEAK drive (FR-083) —
// effective only when no strong driver is enabled — keyed by `renderType`. It
// lives here, beside the behaviors that return `weak: true`, so the two cannot
// drift: anything added to one belongs in the other. Read by the port-direction
// derivation (FR-094c, model/subdesign.js), which must not mistake a pull-up for
// a signal source: a pull-up is the idiom for "input, idles high", not an output.
export const WEAK_DRIVERS = new Set(["pullup", "pulldown"]);

// BEHAVIORS is BEHAVIOR_DEFS re-keyed by type id (FR-066e/FR-067a).
export const BEHAVIORS = Object.fromEntries(
  Object.entries(BEHAVIOR_DEFS).map(([name, fn]) => [builtinId(name), fn]),
);

// INTERACTIONS maps built-in type id → an interaction handler
// (inst, hit) => void that mutates the instance's interactive state in place
// (FR-087b). It is the input-side analogue of BEHAVIORS (output side): a type
// with an entry here is interactive and accepts a sim-time click, routed through
// store.setLiveInput by the interaction FSM (§6.9), which wakes the simulator to
// re-evaluate (§6.13). `hit` describes what part of the body was clicked — only
// `{bit}`, for the multi-bit port — and is ignored by handlers with a single
// click target. A new interactive input is added by registering a handler here
// plus a render branch — no scheduler or FSM change. Defined by name, exported
// keyed by id (FR-066e) so `INTERACTIONS[inst.type]` matches the instance's id
// `type`.
const INTERACTION_DEFS = {
  // Toggle the switch between its two states 0↔1 (FR-087a). Anything that is
  // not "1" (including a legacy "U") toggles to "1".
  switch(inst) {
    inst.switchState = inst.switchState === "1" ? "0" : "1";
  },
  // Debug-input ports (FR-094g): advance the clicked bit's drive. The 1-wide
  // port has one bit; a portN's pentagons are separate click targets, so the FSM
  // says which — and, from this run's debugPorts map, whether the port may be
  // released. Whether the port is eligible at all is likewise the FSM's
  // question, not the handler's.
  port: cyclePortDrive,
  portN: cyclePortDrive,
};

// cyclePortDrive advances one bit of a port's run-time debug drive (FR-094g).
// Two cycles, chosen by `releasable` — a bidir port's `undriven → 0 → 1 →
// undriven`, or an input port's two-state `0 ↔ 1` toggle after a first click
// that drives 0. Releasing exists so a port can let go of a shared bus, which
// only a bidir port is on; an input port's undriven state is its power-on
// condition, not a position worth cycling back into.
//
// The order 0-before-1 is LOAD-BEARING in both cycles, not cosmetic: it is what
// lets a port clock a design by hand. A rising edge is strictly 0→1 (FR-079) —
// Z→1 is not one, and must not become one — so an order that reaches 1 from
// undriven rather than from 0 offers no rising edge at all, and no amount of
// clicking ever advances a register.
//
// The array is REPLACED rather than mutated in place: setLiveInput hands us a
// shallow copy of the previous run-time copy (§6.10), so writing through the
// old array would also rewrite the state the renderer already drew from.
function cyclePortDrive(inst, { bit = 0, releasable = true } = {}) {
  const bits = inst.typeData?.renderType === "portN" ? (inst.typeData.pins?.length ?? 1) : 1;
  const drive = inst.portDrive ? inst.portDrive.slice() : new Array(bits).fill(null);
  const cur = drive[bit];
  drive[bit] = cur === "0" ? "1" : cur === "1" ? (releasable ? null : "0") : "0";
  inst.portDrive = drive;
}

export const INTERACTIONS = Object.fromEntries(
  Object.entries(INTERACTION_DEFS).map(([name, fn]) => [builtinId(name), fn]),
);
