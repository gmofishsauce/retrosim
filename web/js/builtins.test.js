import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILTINS,
  BEHAVIORS,
  DECODER_BAND_H,
  DECODER_DISABLED_TEXT,
  DECODER_LABEL_MAX,
  DECODER_OUTPUTS,
  decoderSelection,
  decoderText,
  HEX_SEGMENTS,
  INTERACTIONS,
  memDeviceType,
  portNFields,
  sevenSegPolys,
  PORTN_MIN_WIDTH,
  PORTN_MAX_WIDTH,
  PORTN_DEFAULT_WIDTH,
} from "./builtins.js";
import { V0, V1, VU, VZ } from "./engine/galasm.js";

function find(name) {
  const t = BUILTINS.find((b) => b.name === name);
  assert.ok(t, `built-in ${name} is registered`);
  return t;
}

// The wide built-ins (FR-071d/FR-071e) expose their bit pins down the left edge
// in one pin group, so a same-width bus snap-connects to all of them at once
// (and, per FR-041c, a narrower bus may take a free sub-block of the group). The
// 8-wide indicator is fixed at eight; the multi-bit port's palette prototype uses
// the default width (8) but regenerates per its chosen width (covered below).
test("wide built-ins expose grouped bits for a bus snap (FR-071d/e)", () => {
  for (const { name, prefix, dir } of [
    { name: "indicator8", prefix: "D", dir: "in" },
    { name: "portN", prefix: "P", dir: "bidir" },
  ]) {
    const t = find(name);
    assert.equal(t.width, 3);
    assert.equal(t.height, 9);
    assert.equal(t.pins.length, 8);
    assert.deepEqual(
      t.pins.map((p) => p.name),
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => prefix + i),
    );
    assert.ok(t.pins.every((p) => p.side === "left" && p.direction === dir));
    // Pins sit at grid rows 1..8 (3×9 footprint, 1-unit top/bottom margin).
    assert.deepEqual(
      t.pins.map((p) => p.position),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    // Exactly one pin group, named `prefix`, holding all eight bits.
    assert.deepEqual(
      t.pinGroups.map((g) => g.name),
      [prefix],
    );
    assert.equal(t.pinGroups[0].pins.length, 8);
  }
});

// portNFields generates a multi-bit port's width-driven typeData (FR-071e): N
// bidir pins P0..P(N-1) down the left edge in one group P, footprint 3×(N+1).
test("portNFields generates pins/group/footprint for the chosen width (FR-071e)", () => {
  for (const n of [PORTN_MIN_WIDTH, 5, PORTN_MAX_WIDTH]) {
    const f = portNFields(n);
    assert.equal(f.width, 3);
    assert.equal(f.height, n + 1);
    assert.equal(f.pins.length, n);
    assert.deepEqual(
      f.pins.map((p) => p.name),
      Array.from({ length: n }, (_, i) => "P" + i),
    );
    assert.ok(f.pins.every((p) => p.side === "left" && p.direction === "bidir"));
    assert.deepEqual(
      f.pins.map((p) => p.position),
      Array.from({ length: n }, (_, i) => i + 1),
    );
    assert.deepEqual(f.pinGroups, [
      { name: "P", pins: Array.from({ length: n }, (_, i) => "P" + i) },
    ]);
  }
  // The palette prototype carries the default width.
  assert.equal(find("portN").pins.length, PORTN_DEFAULT_WIDTH);
});

// Both are passive: the multi-bit port (an interface node) and the display-only
// indicator drive nothing (FR-071d/e).
test("wide built-ins drive nothing", () => {
  // BEHAVIORS is keyed by type id (FR-066e), e.g. "type-indicator8".
  assert.deepEqual(BEHAVIORS["type-indicator8"]({}), []);
  assert.deepEqual(BEHAVIORS["type-portN"]({}), []);
});

// --- Hex display (FR-071j) ---

// Same grouped-bit wiring story as the other 8-bit built-ins, in a wider body:
// D0..D7 down the left edge in one group D, so an 8-bit bus snaps to all of them.
test("hex display exposes eight grouped input bits (FR-071j)", () => {
  const t = find("hexdisplay");
  assert.equal(t.width, 8);
  assert.equal(t.height, 9);
  assert.deepEqual(
    t.pins.map((p) => p.name),
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => "D" + i),
  );
  assert.ok(t.pins.every((p) => p.side === "left" && p.direction === "in"));
  assert.deepEqual(
    t.pins.map((p) => p.position),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.deepEqual(t.pinGroups, [
    { name: "D", pins: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => "D" + i) },
  ]);
  // Display-only, and stateless: it drives nothing and declares no properties.
  assert.deepEqual(BEHAVIORS["type-hexdisplay"]({}), []);
  assert.equal(t.properties, undefined);
  assert.equal(INTERACTIONS["type-hexdisplay"], undefined);
});

// The decode itself (FR-071j). Spelled out segment-by-segment rather than by
// repeating the bitmasks: the table is the component's whole behavior, so a
// test that restates it in the same encoding would check nothing.
test("HEX_SEGMENTS decodes every nibble to its hex glyph (FR-071j)", () => {
  const NAMES = "abcdefg";
  const lit = (mask) =>
    [...NAMES].filter((_, i) => (mask >> i) & 1).join("");
  const expected = [
    "abcdef", // 0
    "bc", // 1
    "abdeg", // 2
    "abcdg", // 3
    "bcfg", // 4
    "acdfg", // 5
    "acdefg", // 6
    "abc", // 7
    "abcdefg", // 8
    "abcdfg", // 9
    "abcefg", // A
    "cdefg", // b
    "adef", // C
    "bcdeg", // d
    "adefg", // E
    "aefg", // F
  ];
  assert.equal(HEX_SEGMENTS.length, 16);
  expected.forEach((segs, v) => assert.equal(lit(HEX_SEGMENTS[v]), segs, `nibble ${v}`));
  // Every glyph is distinct — the point of the lower-case b and d.
  assert.equal(new Set(HEX_SEGMENTS).size, 16);
});

// sevenSegPolys is shared by the canvas renderer and the palette icon, so its
// contract is the order (a..g, matching HEX_SEGMENTS' bits) and staying inside
// the box it is given — both engines' glyphs depend on it.
test("sevenSegPolys returns seven segments inside its box, in a..g order (FR-071j)", () => {
  const [x0, y0, w, h, t] = [1, 2, 3, 6, 0.5];
  const polys = sevenSegPolys(x0, y0, w, h, t);
  assert.equal(polys.length, 7);
  for (const pts of polys) {
    assert.equal(pts.length, 6); // tapered hexagon
    for (const [x, y] of pts) {
      assert.ok(x >= x0 && x <= x0 + w, `x ${x} within [${x0}, ${x0 + w}]`);
      assert.ok(y >= y0 && y <= y0 + h, `y ${y} within [${y0}, ${y0 + h}]`);
    }
  }
  const midY = (pts) => pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const midX = (pts) => pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const [a, b, c, d, e, f, g] = polys;
  // a top, g middle, d bottom.
  assert.ok(midY(a) < midY(g) && midY(g) < midY(d));
  // b/c on the right, f/e on the left; b/f upper, c/e lower.
  assert.ok(midX(b) > midX(f) && midX(c) > midX(e));
  assert.ok(midY(b) < midY(c) && midY(f) < midY(e));
});

// --- memDeviceType (FR-114c) ---

test("memDeviceType builds a RAM pinout: ADDR left, DATA right, CE//OE//WE/ (FR-114c)", () => {
  const t = memDeviceType({ name: "PROGRAM_RAM", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  // Not a built-in: U-series refdes + default labelled-rectangle render.
  assert.ok(!t.builtin);
  // The free-form name is the display name and derives the library id (FR-066e).
  assert.equal(t.id, "type-PROGRAM_RAM");
  assert.equal(t.name, "PROGRAM_RAM");
  const byName = Object.fromEntries(t.pins.map((p) => [p.name, p]));
  // 8 address inputs on the left at positions 1..8.
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(byName[`A${i}`], { name: `A${i}`, side: "left", position: i + 1, direction: "in" });
  }
  // Controls follow the address run on the left, in order CE/, OE/, WE/.
  assert.deepEqual(byName["CE/"], { name: "CE/", side: "left", position: 9, direction: "in" });
  assert.deepEqual(byName["OE/"], { name: "OE/", side: "left", position: 10, direction: "in" });
  assert.deepEqual(byName["WE/"], { name: "WE/", side: "left", position: 11, direction: "in" });
  // 8 bidirectional data pins on the right at positions 1..8.
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(byName[`D${i}`], { name: `D${i}`, side: "right", position: i + 1, direction: "bidir" });
  }
  // Snap groups.
  assert.deepEqual(t.pinGroups, [
    { name: "ADDR", pins: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"] },
    { name: "DATA", pins: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"] },
  ]);
  // Outline: width floors at 4; height fits the taller (left) edge + margin.
  assert.equal(t.width, 4);
  assert.equal(t.height, 11 + 2);
});

test("memDeviceType ROM has no WE/ and tristate data pins (FR-114c)", () => {
  const t = memDeviceType({ name: "FONT_ROM", kind: "rom", addressBits: 4, dataWidth: 16, locations: 16, romFile: "/r/x.bin" });
  assert.equal(t.id, "type-FONT_ROM");
  assert.ok(!t.pins.some((p) => p.name === "WE/"));
  assert.ok(t.pins.filter((p) => p.name.startsWith("D")).every((p) => p.direction === "tristate"));
  // ROM data is the taller edge here (16 vs 4 addr + 2 ctrl = 6).
  assert.equal(t.height, 16 + 2);
  // The chosen content file is carried on the type for the deferred behavior.
  assert.equal(t.mem.romFile, "/r/x.bin");
  assert.equal(t.mem.kind, "rom");
});

test("memDeviceType id follows the name, not the pinout (FR-114c/FR-066e)", () => {
  // Same pinout, different names → distinct ids (two distinct types).
  const a = memDeviceType({ name: "RAM_A", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  const b = memDeviceType({ name: "RAM_B", kind: "ram", addressBits: 8, dataWidth: 8, locations: 256 });
  assert.notEqual(a.id, b.id);
  // Same name → same id, so the caller's library collision check catches a dup.
  const c = memDeviceType({ name: "RAM_A", kind: "ram", addressBits: 4, dataWidth: 16, locations: 16 });
  assert.equal(a.id, c.id);
});

// The text note (FR-071f) is a pure annotation: a built-in with no pins, no
// pin groups, no properties, and no behavior or interaction entry.
test("text note is a pinless, behaviorless built-in (FR-071f)", () => {
  const t = find("note");
  assert.equal(t.builtin, true);
  assert.equal(t.renderType, "note");
  assert.deepEqual(t.pins, []);
  assert.ok(!t.pinGroups);
  assert.ok(!t.properties);
  // No simulation behavior and no interactive handler — sim.js skips it.
  // (registries are keyed by type id, FR-066e.)
  assert.ok(!("type-note" in BEHAVIORS));
  assert.ok(!("type-note" in INTERACTIONS));
});

// The debug-input port's handler (FR-094g) — the second INTERACTIONS entry, and
// the demonstration that FR-087b's mechanism takes a new interactive input with
// a handler alone. The FSM decides *whether* a port is clickable (§6.9); the
// handler only advances the bit it is handed.
// The 0-before-1 order is normative (FR-094g): a rising edge is strictly 0→1
// (FR-079), so this is the only order that makes reaching 1 an edge and thus the
// only one that can hand-clock a design through a clock port.
test("a bidir port cycles undriven → 0 → 1 → undriven (FR-094g)", () => {
  const cycle = INTERACTIONS["type-port"];
  const inst = { refdes: "A-1", typeData: find("port") };
  const click = () => (cycle(inst, { bit: 0, releasable: true }), inst.portDrive[0]);

  assert.equal(click(), "0");
  assert.equal(click(), "1"); // the click that carries the rising edge
  assert.equal(click(), null); // released: back to watching the bus
  assert.equal(click(), "0"); // and round again
});

// An input port has no bus to let go of, so it toggles instead of cycling —
// one click per clock edge rather than three (FR-094g).
test("an input port toggles 0 ↔ 1 and never returns to undriven (FR-094g)", () => {
  const cycle = INTERACTIONS["type-port"];
  const inst = { refdes: "A-1", typeData: find("port") };
  const click = () => (cycle(inst, { bit: 0, releasable: false }), inst.portDrive[0]);

  assert.equal(click(), "0"); // first click drives low, from the power-on float
  assert.deepEqual([click(), click(), click(), click()], ["1", "0", "1", "0"]);
});

// The switch predates the {bit} argument and must be untouched by it (FR-087b).
test("the switch handler ignores the hit descriptor (FR-087a/FR-087b)", () => {
  const inst = { refdes: "A-1", switchState: "0" };
  INTERACTIONS["type-switch"](inst, { bit: 3 });
  assert.equal(inst.switchState, "1");
});

// --- Labeled 3-to-8 decoder (FR-071k) --------------------------------------

// The shape: an IC-style built-in with five inputs (two enables, three address
// bits) down the left edge and eight active-low outputs down the right, the
// address bits grouped so a 3-bit bus snaps to all of them at once.
test("the decoder exposes E, /E, A2..A0 and eight active-low outputs (FR-071k)", () => {
  const t = find("decoder");
  assert.equal(t.id, "type-decoder");
  assert.equal(t.renderType, "decoder");
  assert.equal(t.width, 8);
  assert.equal(t.height, 11);

  const byName = new Map(t.pins.map((p) => [p.name, p]));
  for (const name of ["E", "/E", "A2", "A1", "A0"]) {
    assert.equal(byName.get(name)?.side, "left", `${name} on the left edge`);
    assert.equal(byName.get(name)?.direction, "in");
  }
  DECODER_OUTPUTS.forEach((name, i) => {
    assert.equal(name, `/Y${i}`);
    assert.equal(byName.get(name)?.side, "right");
    assert.equal(byName.get(name)?.direction, "out");
    assert.equal(byName.get(name)?.position, i + 3); // below the title band
  });
  // Every pin fits inside the footprint, below the title band.
  assert.ok(t.pins.every((p) => p.position > DECODER_BAND_H && p.position < t.height));
  // Address bits grouped LSB-first (the 74138's convention); the /Y outputs are
  // deliberately ungrouped — active-low names make no usable bus bit names.
  assert.deepEqual(t.pinGroups, [{ name: "A", pins: ["A0", "A1", "A2"] }]);
  assert.ok(!t.properties); // no numeric properties (FR-020b)
});

// The behavior: exactly one output low, the addressed one, when E is 1 and /E
// is 0; all eight high when either enable says no — regardless of the address.
test("the decoder drives the addressed output low when enabled (FR-071k)", () => {
  const behave = BEHAVIORS["type-decoder"];
  const reader = (pins) => (name) => pins[name] ?? VU;

  for (let n = 0; n < 8; n++) {
    const out = behave({
      read: reader({
        E: V1,
        "/E": V0,
        A2: n & 4 ? V1 : V0,
        A1: n & 2 ? V1 : V0,
        A0: n & 1 ? V1 : V0,
      }),
    });
    assert.equal(out.length, 8);
    out.forEach((c, i) => {
      assert.equal(c.pin, `/Y${i}`);
      assert.equal(c.value, i === n ? V0 : V1, `value ${n}: ${c.pin}`);
      assert.ok(!c.weak); // a strong driver, like any ordinary output
    });
  }
});

// Disabled is decided by the enables alone: a 0 on an enable literal settles
// every term even when the address bits read U (FR-077 selective pessimism), so
// a disabled decoder drives all eight outputs high without knowing its address.
test("a disabled decoder drives every output high, address unknown (FR-071k)", () => {
  const behave = BEHAVIORS["type-decoder"];
  const reader = (pins) => (name) => pins[name] ?? VU;
  for (const enables of [
    { E: V0, "/E": V0 }, // active-high enable not asserted
    { E: V1, "/E": V1 }, // active-low enable not asserted
    { E: V0, "/E": V1 }, // neither
  ]) {
    const out = behave({ read: reader(enables) }); // A2..A0 read U
    assert.deepEqual(
      out.map((c) => c.value),
      new Array(8).fill(V1),
      JSON.stringify(enables),
    );
  }
});

// An unknown enable or address bit is unknown only where it could matter: an
// output whose address does not match is high whatever the enables say, because
// a 0 on any address literal settles that term (FR-077). So an unknown enable
// puts only the ADDRESSED output at U, and an unknown address bit puts only the
// pair of outputs it chooses between at U.
test("the decoder reports U only where the inputs do not decide (FR-071k/FR-077)", () => {
  const behave = BEHAVIORS["type-decoder"];
  const reader = (pins) => (name) => pins[name] ?? VU;

  // E is U, address 0: /Y0 might or might not be driven low; the rest cannot be.
  const unknownEnable = behave({ read: reader({ "/E": V0, A2: V0, A1: V0, A0: V0 }) });
  assert.deepEqual(
    unknownEnable.map((c) => c.value),
    [VU, V1, V1, V1, V1, V1, V1, V1],
  );

  // E=1, /E=0, A2=1, A1=0, A0=U → /Y4 and /Y5 undecided, the rest high.
  const partial = behave({ read: reader({ E: V1, "/E": V0, A2: V1, A1: V0 }) });
  assert.deepEqual(
    partial.map((c) => c.value),
    [V1, V1, V1, V1, VU, VU, V1, V1],
  );
});

// An unwired input reads Z (the simulator's no-net answer), which the term rules
// treat as U — so an unwired decoder is undecided, never accidentally enabled.
test("an unwired decoder input reads Z and decides nothing (FR-071k/FR-077)", () => {
  const out = BEHAVIORS["type-decoder"]({ read: () => VZ });
  assert.deepEqual(
    out.map((c) => c.value),
    new Array(8).fill(VU),
  );
});

// decoderSelection is the DISPLAY's reading of the inputs (not the outputs'):
// a value 0-7 only when the decoder is enabled and all three address bits are
// defined, and null — the dashes case — otherwise.
test("decoderSelection answers only for an enabled, fully defined input (FR-071k)", () => {
  const reader = (pins) => (name) => pins[name] ?? VU;
  const enabled = { E: V1, "/E": V0 };
  assert.equal(decoderSelection(reader({ ...enabled, A2: V1, A1: V0, A0: V1 })), 5);
  assert.equal(decoderSelection(reader({ ...enabled, A2: V0, A1: V0, A0: V0 })), 0);
  assert.equal(decoderSelection(reader({ ...enabled, A2: V1, A1: V1, A0: V1 })), 7);

  assert.equal(decoderSelection(reader({ ...enabled, A2: V1, A1: V0 })), null); // A0 is U
  assert.equal(decoderSelection(reader({ E: V0, "/E": V0, A2: V0, A1: V0, A0: V0 })), null);
  assert.equal(decoderSelection(reader({ E: V1, "/E": V1, A2: V0, A1: V0, A0: V0 })), null);
  assert.equal(decoderSelection(() => VZ), null); // nothing wired
});

// decoderText is the title-band string: the instance's label for the selected
// value, clipped to five characters; the value's own digit when unlabeled; the
// four dashes when there is no selection at all.
test("decoderText shows the label, else the digit, else the dashes (FR-071k)", () => {
  const inst = { decodeLabels: ["FETCH", "", "DECODE", "EXEC"] };
  assert.equal(decoderText(inst, 0), "FETCH");
  assert.equal(decoderText(inst, 1), "1"); // set but empty → the digit
  assert.equal(decoderText(inst, 6), "6"); // never set at all → the digit
  assert.equal(decoderText(inst, 2), "DECOD"); // clipped to DECODER_LABEL_MAX
  assert.equal(decoderText(inst, null), DECODER_DISABLED_TEXT);
  assert.equal(decoderText(inst, undefined), DECODER_DISABLED_TEXT);
  assert.equal(DECODER_DISABLED_TEXT, "----");
  // A decoder placed before it had labels at all still draws.
  assert.equal(decoderText({}, 3), "3");
  assert.equal(decoderText(undefined, null), DECODER_DISABLED_TEXT);
});
