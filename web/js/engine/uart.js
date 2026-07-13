// Built-in simulation behavior for the magic UART output device (FR-122b).
// Like the memory device (memory.js), the UART's behavior must *read* its input
// nets and keep per-instance state (the latched byte and the previous clock
// level), so it is modeled as a small pure core here rather than a source-only
// BEHAVIORS function in builtins.js: the per-device register plus the edge /
// gate / assemble logic, expressed over the four-state V-values (FR-077) and
// fully decoupled from the netlist. The simulator (sim.js) injects a
// `read(pinName)→V` returning the pin's net value from the *previous* step
// (unit delay, FR-078) and an `emit(byte)` side-effect sink. Pure logic + local
// state — no DOM, no net knowledge — so it is unit-testable in isolation.

import { V0, V1, VU, VZ } from "./galasm.js";

// createUartCore builds the per-instance behavior of one magic UART (FR-122).
// The returned object exposes `clockStep(read, emit)` (latch + emit on CLK's
// rising edge while CS/=0 and CE/=0) and `peek()` (the last latched byte, or
// null before any emit — tests/inspection only).
export function createUartCore() {
  let prevClk = VU; // for CLK rising-edge detection; power-up unknown (FR-122b)
  let reg = null; // last latched byte (0..255), or null before any emit

  // Reading a high-impedance (Z) input is treated as U (FR-077).
  const norm = (v) => (v === VZ ? VU : v);

  return {
    // clockStep detects CLK's 0→1 transition against the previous step's values
    // (FR-078). On a rising edge, and only when CS/ and CE/ both read exactly
    // logic 0 (an uncertain or deasserted control emits nothing — a character is
    // an irreversible side effect, so this is conservative, not pessimistic,
    // FR-122b), it assembles the byte from D0(LSB)…D7(MSB) — any data bit that
    // is not a clean logic 1 (0, U, or Z) contributes 0 (U→0, FR-114g) — latches
    // it, and calls emit(byte) at most once per rising edge. Deposits no
    // contributions; the UART drives no nets.
    clockStep(read, emit) {
      const clk = norm(read("CLK"));
      if (prevClk === V0 && clk === V1) {
        const cs = norm(read("CS/"));
        const ce = norm(read("CE/"));
        if (cs === V0 && ce === V0) {
          let byte = 0;
          for (let i = 0; i < 8; i++) {
            if (norm(read(`D${i}`)) === V1) byte |= 1 << i;
          }
          reg = byte;
          emit(byte);
        }
      }
      prevClk = clk;
    },

    // peek returns the last latched byte (0..255) or null if nothing has been
    // emitted yet — for tests/inspection only.
    peek: () => reg,
  };
}
