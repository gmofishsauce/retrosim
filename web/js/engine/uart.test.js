import { test } from "node:test";
import assert from "node:assert/strict";

import { createUartCore } from "./uart.js";
import { V0, V1, VU, VZ } from "./galasm.js";

// reader builds a read(pinName)→V backed by a plain map; an unlisted pin reads Z
// (unconnected), exactly as the simulator's net-backed read does.
const reader = (pins) => (name) => (name in pins ? pins[name] : VZ);

// dataPins spreads a byte over D0(LSB)…D7(MSB) as V0/V1 bits (FR-122b).
const dataPins = (byte) => {
  const p = {};
  for (let i = 0; i < 8; i++) p[`D${i}`] = byte & (1 << i) ? V1 : V0;
  return p;
};

// collect runs a sequence of read-maps through clockStep, returning the emitted
// bytes in order.
function collect(core, maps) {
  const out = [];
  for (const m of maps) core.clockStep(reader(m), (b) => out.push(b));
  return out;
}

// selected(byte, over) is a fully-asserted read map (CS/=0, CE/=0) carrying a
// byte on the data bus plus the given CLK level.
const selected = (byte, clk) => ({ "CS/": V0, "CE/": V0, CLK: clk, ...dataPins(byte) });

test("emits the latched byte on CLK's rising edge while CS/=0 and CE/=0 (FR-122b)", () => {
  const u = createUartCore();
  const out = collect(u, [selected(0x41, V0), selected(0x41, V1)]);
  assert.deepEqual(out, [0x41]);
  assert.equal(u.peek(), 0x41);
});

test("bit order is D0(LSB)…D7(MSB) (FR-122b)", () => {
  const u = createUartCore();
  // 0x81 = 1000_0001: D0 and D7 set.
  const map = { "CS/": V0, "CE/": V0, CLK: V1, D0: V1, D7: V1 };
  const out = collect(u, [{ ...map, CLK: V0 }, map]);
  assert.deepEqual(out, [0x81]);
});

test("emits at most one byte per rising edge; a held-high clock does not re-emit", () => {
  const u = createUartCore();
  const out = collect(u, [
    selected(0x20, V0),
    selected(0x20, V1), // rising edge → emit
    selected(0x20, V1), // held high, no edge → silent
    selected(0x21, V0), // falling, silent
    selected(0x21, V1), // rising edge → emit the new byte
  ]);
  assert.deepEqual(out, [0x20, 0x21]);
});

test("no emit when CS/ is deasserted (1) or uncertain (U/Z) (FR-122b)", () => {
  for (const cs of [V1, VU, VZ]) {
    const u = createUartCore();
    const out = collect(u, [
      { "CS/": cs, "CE/": V0, CLK: V0, ...dataPins(0x41) },
      { "CS/": cs, "CE/": V0, CLK: V1, ...dataPins(0x41) },
    ]);
    assert.deepEqual(out, []);
    assert.equal(u.peek(), null);
  }
});

test("no emit when CE/ is deasserted (1) or uncertain (U/Z) (FR-122b)", () => {
  for (const ce of [V1, VU, VZ]) {
    const u = createUartCore();
    const out = collect(u, [
      { "CS/": V0, "CE/": ce, CLK: V0, ...dataPins(0x41) },
      { "CS/": V0, "CE/": ce, CLK: V1, ...dataPins(0x41) },
    ]);
    assert.deepEqual(out, []);
  }
});

test("a data bit that is not a clean logic 1 (0/U/Z) contributes 0 (U→0, FR-114g)", () => {
  const u = createUartCore();
  // Want 0xFF but drive D3 as U and D5 as Z → those bits mask to 0 → 0xD7.
  const map = { "CS/": V0, "CE/": V0, CLK: V1, ...dataPins(0xff), D3: VU, D5: VZ };
  const out = collect(u, [{ ...map, CLK: V0 }, map]);
  assert.deepEqual(out, [0xff & ~(1 << 3) & ~(1 << 5)]);
});

test("power-up prevClk is U: a run starting with CLK already high does not emit (FR-122b)", () => {
  const u = createUartCore();
  // First step sees CLK high with no observed prior low, so U→1 is not a 0→1 edge.
  const out = collect(u, [selected(0x41, V1)]);
  assert.deepEqual(out, []);
});

test("an unconnected control pin reads U and never qualifies (no crash) (FR-122b)", () => {
  const u = createUartCore();
  // CS/ absent → reads Z→U → no emit, even across a clean CLK edge.
  const out = collect(u, [
    { "CE/": V0, CLK: V0, ...dataPins(0x41) },
    { "CE/": V0, CLK: V1, ...dataPins(0x41) },
  ]);
  assert.deepEqual(out, []);
});
