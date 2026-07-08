// Built-in simulation behavior for generator-defined memory devices (FR-114d).
// This is the first built-in whose behavior must *read* its input nets and keep
// per-instance state, so — unlike the source-only BEHAVIORS in builtins.js — it
// is modeled as a small core here: the per-device store plus the read / write /
// output-enable logic, expressed over the four-state V-values (FR-077) and fully
// decoupled from the netlist. The simulator (sim.js) injects a `read(pinName)→V`
// that returns the pin's net value from the *previous* step (unit delay, FR-078)
// and applies the data drive this returns. Pure logic + local state — no DOM, no
// net knowledge — so it is unit-testable in isolation.

import { V0, V1, VU, VZ } from "./galasm.js";

// parseHexBytes parses a .hex ROM file (FR-114e): whitespace-separated hex byte
// tokens (1–2 hex digits each, value 0–255), runs of whitespace collapsing to one
// separator. Returns the bytes as a Uint8Array; throws on a malformed token.
export function parseHexBytes(text) {
  const out = [];
  for (const tok of text.split(/\s+/)) {
    if (tok === "") continue; // leading/trailing/collapsed whitespace
    if (!/^[0-9a-fA-F]{1,2}$/.test(tok)) {
      throw new Error(`invalid hex byte "${tok}" (want 1–2 hex digits)`);
    }
    out.push(parseInt(tok, 16));
  }
  return Uint8Array.from(out);
}

// parseRomBytes turns a fetched ROM file's raw bytes into the packed byte stream
// the memory loader consumes, per the file format (FR-114e): "bin" is the bytes
// verbatim; "hex" decodes them as text and parses hex byte tokens.
export function parseRomBytes(raw, format) {
  if (format === "bin") return raw;
  if (format === "hex") return parseHexBytes(new TextDecoder().decode(raw));
  throw new Error(`unknown ROM format ${format}`);
}

// createMemoryCore builds the per-instance behavior of one RAM or ROM, sized by
// its `mem` block {kind, addressBits, dataWidth} (FR-114c). The returned object
// exposes `writeStep(read)` (latch on a RAM's WE/ rising edge) and
// `dataDrive(read)` (the values to drive on D0..D(w-1), or null for Z).
export function createMemoryCore({ kind, addressBits: n, dataWidth: w }) {
  const isRam = kind === "ram";
  const mem = new Map(); // addr → V-value[w]; absent = unwritten, reads U (FR-114d)
  let prevWE = VU; // for WE/ rising-edge detection; power-up unknown

  // Reading a high-impedance (Z) input is treated as U (FR-077).
  const norm = (v) => (v === VZ ? VU : v);

  // decodeAddr resolves the address lines A0(LSB)..A(n-1) to an integer, or null
  // when any address bit is not a clean 0/1 (U/Z) — an undecodable address.
  function decodeAddr(read) {
    let addr = 0;
    for (let i = 0; i < n; i++) {
      const b = norm(read(`A${i}`));
      if (b !== V0 && b !== V1) return null;
      if (b === V1) addr += 2 ** i;
    }
    return addr;
  }

  return {
    // writeStep latches the data bus into the addressed cell on a RAM's WE/
    // rising edge (0→1, FR-114d), sampling the address and data present this
    // step (the previous step's resolved net values). A ROM never writes. Call
    // once per unit step, before dataDrive, so a write is visible to the next
    // step's read.
    writeStep(read) {
      if (!isRam) return;
      const we = norm(read("WE/"));
      if (prevWE === V0 && we === V1) {
        const addr = decodeAddr(read);
        if (addr !== null) {
          const word = new Array(w);
          for (let i = 0; i < w; i++) word[i] = norm(read(`D${i}`));
          mem.set(addr, word);
        }
      }
      prevWE = we;
    },

    // dataDrive returns the w values driven onto D0..D(w-1), or null to drive
    // nothing (high-impedance Z), per FR-114d:
    //   CE/=1                      → deselected, Z
    //   CE/=0, RAM WE/=0           → write cycle, outputs disabled, Z
    //   CE/=0, OE/=0 (RAM: WE/=1)  → read: drive the addressed word (U if the
    //                                cell is unwritten or the address undecodable)
    //   CE/=0, OE/=1               → output disabled, Z
    //   any deciding control uncertain (U) → pessimistic U (might be driving)
    dataDrive(read) {
      const ce = norm(read("CE/"));
      const oe = norm(read("OE/"));
      const we = isRam ? norm(read("WE/")) : V1;
      if (ce === V1) return null; // deselected
      if (ce !== V0) return new Array(w).fill(VU); // CE/ uncertain
      if (isRam && we === V0) return null; // write in progress: outputs disabled
      if (oe === V1) return null; // output disabled
      if (oe === V0 && (!isRam || we === V1)) {
        const addr = decodeAddr(read);
        if (addr === null) return new Array(w).fill(VU);
        const word = mem.get(addr);
        return word ? word.slice() : new Array(w).fill(VU); // unwritten → U
      }
      return new Array(w).fill(VU); // OE/ or WE/ uncertain
    },

    // loadBytes seeds the store from a byte stream (FR-114e), used at Run to load
    // a ROM's content. Each location takes B = ceil(w/8) bytes, **little-endian**
    // (byte 0 = low 8 bits), masked to w bits (so width 4 uses the low nibble of
    // its one byte); bytes [k·B, k·B+B) form location k, in file (memory) order.
    // A trailing partial word is dropped, and words past the device capacity are
    // ignored. Returns {loaded, capacity, fileWords, truncated} for reporting.
    loadBytes(bytes) {
      const B = Math.ceil(w / 8);
      const capacity = 2 ** n;
      const fileWords = Math.floor(bytes.length / B);
      const loaded = Math.min(fileWords, capacity);
      for (let k = 0; k < loaded; k++) {
        const word = new Array(w);
        for (let i = 0; i < w; i++) {
          const byte = bytes[k * B + (i >> 3)];
          word[i] = (byte >> (i % 8)) & 1 ? V1 : V0;
        }
        mem.set(k, word);
      }
      return { loaded, capacity, fileWords, truncated: fileWords > capacity };
    },

    // dumpBytes serializes the full store to a byte stream (FR-114g), the inverse
    // of loadBytes — a RAM's persistent-content save, written on Stop. Every
    // location 0..2^n-1 is emitted (so the file always describes the whole
    // device), B = ceil(w/8) bytes each, **little-endian**, each cell masked to
    // w bits. A cell bit that is not a clean 1 — undefined (U), or a never-written
    // cell — is written as **0**, since the byte format has no encoding for U; so
    // a save→load round trip is not identity for uninitialized cells. Returns a
    // Uint8Array of 2^n·B bytes, ready for the .bin/.hex formatter in the caller.
    dumpBytes() {
      const B = Math.ceil(w / 8);
      const capacity = 2 ** n;
      const out = new Uint8Array(capacity * B); // zero-filled: unwritten cells stay 0
      for (let k = 0; k < capacity; k++) {
        const word = mem.get(k);
        if (!word) continue; // unwritten location → all-zero bytes
        for (let i = 0; i < w; i++) {
          if (word[i] === V1) out[k * B + (i >> 3)] |= 1 << (i % 8);
        }
      }
      return out;
    },

    // peek returns the stored word at an address (V-value[w]) or undefined if
    // unwritten — for tests/inspection only.
    peek: (addr) => mem.get(addr),
  };
}
