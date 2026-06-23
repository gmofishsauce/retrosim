import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryCore, parseHexBytes, parseRomBytes } from "./memory.js";
import { V0, V1, VU, VZ } from "./galasm.js";

// wordVal collapses a V-value bit array (LSB first) to an integer, for asserting
// loaded ROM contents.
const wordVal = (arr) => arr.reduce((acc, v, i) => acc + (v === V1 ? 2 ** i : 0), 0);

// reader builds a read(pinName)→V backed by a plain map; an unlisted pin reads Z
// (unconnected), exactly as the simulator's net-backed read does.
const reader = (pins) => (name) => (name in pins ? pins[name] : VZ);

const ram = (n, w) => createMemoryCore({ kind: "ram", addressBits: n, dataWidth: w });
const rom = (n, w) => createMemoryCore({ kind: "rom", addressBits: n, dataWidth: w });

test("RAM latches on WE/ rising edge and reads the word back (FR-114d)", () => {
  const m = ram(2, 4);
  // CE/=0 selected, address 01, data 1010 on the bus, WE/ low (write asserted).
  const lowWE = { "CE/": V0, "OE/": V1, "WE/": V0, A0: V1, A1: V0, D0: V1, D1: V0, D2: V1, D3: V0 };
  m.writeStep(reader(lowWE)); // prevWE U→0, no edge yet
  // While WE/ is low the outputs are disabled (Z) regardless of OE/ (FR-114d).
  assert.equal(m.dataDrive(reader({ ...lowWE, "OE/": V0 })), null);

  // WE/ rises (0→1): latch address 01 ← 1010.
  m.writeStep(reader({ ...lowWE, "WE/": V1 }));
  assert.deepEqual(m.peek(1), [V1, V0, V1, V0]);

  // Read it back: CE/=0, OE/=0, WE/=1, address 01.
  assert.deepEqual(
    m.dataDrive(reader({ "CE/": V0, "OE/": V0, "WE/": V1, A0: V1, A1: V0 })),
    [V1, V0, V1, V0],
  );
  // A different, unwritten address reads U on every bit.
  assert.deepEqual(
    m.dataDrive(reader({ "CE/": V0, "OE/": V0, "WE/": V1, A0: V0, A1: V0 })),
    [VU, VU, VU, VU],
  );
});

test("no write without a clean rising edge or with an undecodable address (FR-114d)", () => {
  const m = ram(1, 4);
  // WE/ held high the whole time → no edge, no write.
  m.writeStep(reader({ "WE/": V1, A0: V0, D0: V1 }));
  m.writeStep(reader({ "WE/": V1, A0: V0, D0: V1 }));
  assert.equal(m.peek(0), undefined);
  // A rising edge but an unknown address bit → the write is dropped.
  m.writeStep(reader({ "WE/": V0, A0: VU }));
  m.writeStep(reader({ "WE/": V1, A0: VU, D0: V1, D1: V1, D2: V1, D3: V1 }));
  assert.equal(m.peek(0), undefined);
  assert.equal(m.peek(1), undefined);
});

test("CE/ high deselects: data bus is high-impedance (FR-114d)", () => {
  const m = ram(1, 4);
  assert.equal(m.dataDrive(reader({ "CE/": V1, "OE/": V0, "WE/": V1, A0: V0 })), null);
});

test("a RAM write cycle (WE/ low) disables the outputs even with OE/ low (FR-114d)", () => {
  const m = ram(1, 4);
  assert.equal(m.dataDrive(reader({ "CE/": V0, "OE/": V0, "WE/": V0, A0: V0 })), null);
});

test("OE/ high disables the outputs while selected (FR-114d)", () => {
  const m = ram(1, 4);
  assert.equal(m.dataDrive(reader({ "CE/": V0, "OE/": V1, "WE/": V1, A0: V0 })), null);
});

test("uncertain or floating controls drive pessimistic U (FR-114d/FR-077)", () => {
  const m = ram(1, 4);
  // CE/ uncertain → might be selected and driving → U.
  assert.deepEqual(m.dataDrive(reader({ "CE/": VU, "OE/": V0, "WE/": V1, A0: V0 })), [VU, VU, VU, VU]);
  // OE/ floating (Z) reads as U → uncertain enable → U.
  assert.deepEqual(m.dataDrive(reader({ "CE/": V0, "OE/": VZ, "WE/": V1, A0: V0 })), [VU, VU, VU, VU]);
  // Selected read but an unknown address bit → U.
  assert.deepEqual(m.dataDrive(reader({ "CE/": V0, "OE/": V0, "WE/": V1, A0: VU })), [VU, VU, VU, VU]);
});

test("ROM never writes and (with no content) reads U; has no WE/ (FR-114d)", () => {
  const r = rom(2, 8);
  // A would-be write is ignored — a ROM has no WE/.
  r.writeStep(reader({ "WE/": V1, A0: V0, A1: V0, D0: V1 }));
  assert.equal(r.peek(0), undefined);
  // Selected read (CE/=0, OE/=0): no content loaded yet → all U.
  assert.deepEqual(
    r.dataDrive(reader({ "CE/": V0, "OE/": V0, A0: V0, A1: V0 })),
    new Array(8).fill(VU),
  );
  // Still tristates when deselected / output-disabled.
  assert.equal(r.dataDrive(reader({ "CE/": V1, "OE/": V0, A0: V0, A1: V0 })), null);
  assert.equal(r.dataDrive(reader({ "CE/": V0, "OE/": V1, A0: V0, A1: V0 })), null);
});

// --- ROM content loading (FR-114e) ---

test("parseHexBytes reads whitespace-separated hex byte tokens (FR-114e)", () => {
  assert.deepEqual([...parseHexBytes("01 0a FF")], [0x01, 0x0a, 0xff]);
  // Runs of mixed whitespace collapse; leading/trailing ignored; 1-digit ok.
  assert.deepEqual([...parseHexBytes("  01\n\n02\t03 \r\n5 ")], [1, 2, 3, 5]);
  assert.deepEqual([...parseHexBytes("")], []);
  assert.throws(() => parseHexBytes("01 xy"), /invalid hex byte/);
  assert.throws(() => parseHexBytes("100"), /invalid hex byte/); // >2 digits = not a byte
});

test("parseRomBytes: bin is verbatim, hex is decoded then parsed (FR-114e)", () => {
  const bin = Uint8Array.from([1, 2, 3]);
  assert.equal(parseRomBytes(bin, "bin"), bin);
  const hex = new TextEncoder().encode("01 02 03");
  assert.deepEqual([...parseRomBytes(hex, "hex")], [1, 2, 3]);
  assert.throws(() => parseRomBytes(bin, "wat"), /unknown ROM format/);
});

test("loadBytes packs bytes little-endian per data width (FR-114e)", () => {
  // width 8: one byte per location.
  let m = rom(4, 8);
  m.loadBytes(Uint8Array.from([0xa5, 0x3c]));
  assert.equal(wordVal(m.peek(0)), 0xa5);
  assert.equal(wordVal(m.peek(1)), 0x3c);

  // width 16: two bytes per location, low byte first.
  m = rom(4, 16);
  m.loadBytes(Uint8Array.from([0x34, 0x12, 0x78, 0x56]));
  assert.equal(wordVal(m.peek(0)), 0x1234);
  assert.equal(wordVal(m.peek(1)), 0x5678);

  // width 32: four bytes, little-endian.
  m = rom(4, 32);
  m.loadBytes(Uint8Array.from([0x78, 0x56, 0x34, 0x12]));
  assert.equal(wordVal(m.peek(0)), 0x12345678);

  // width 4: the low nibble of its single byte.
  m = rom(4, 4);
  m.loadBytes(Uint8Array.from([0xa5]));
  assert.equal(wordVal(m.peek(0)), 0x5);
});

test("loadBytes drops a trailing partial word and truncates past capacity (FR-114e)", () => {
  // 16-bit words; a lone trailing byte can't complete a word → dropped.
  let m = rom(4, 16);
  let info = m.loadBytes(Uint8Array.from([0x34, 0x12, 0x99]));
  assert.equal(wordVal(m.peek(0)), 0x1234);
  assert.equal(m.peek(1), undefined);
  assert.equal(info.truncated, false);

  // Capacity 2 (addressBits 1), 8-bit: 4 bytes → 4 words, only 2 fit.
  m = rom(1, 8);
  info = m.loadBytes(Uint8Array.from([1, 2, 3, 4]));
  assert.equal(info.loaded, 2);
  assert.equal(info.fileWords, 4);
  assert.equal(info.capacity, 2);
  assert.equal(info.truncated, true);
  assert.equal(m.peek(2), undefined);
});

test("a loaded ROM reads its content; unloaded addresses read U (FR-114e/FR-114d)", () => {
  const r = rom(2, 8); // 4 locations
  r.loadBytes(Uint8Array.from([0xde, 0xad]));
  // Read addr 0 / addr 1 with CE/=0, OE/=0.
  assert.equal(wordVal(r.dataDrive(reader({ "CE/": V0, "OE/": V0, A0: V0, A1: V0 }))), 0xde);
  assert.equal(wordVal(r.dataDrive(reader({ "CE/": V0, "OE/": V0, A0: V1, A1: V0 }))), 0xad);
  // addr 2 was not loaded → U.
  assert.deepEqual(r.dataDrive(reader({ "CE/": V0, "OE/": V0, A0: V0, A1: V1 })), new Array(8).fill(VU));
});
