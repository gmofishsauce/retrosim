# Missed components

Components from the `moar-parts` request that were **not** turned into
`srv/components/*.yaml` files, with the reason for each. The other 12 parts in
that list were created successfully.

These are not datasheet-availability problems (except 74HC162); they are cases
where the component-definition format / slow simulator cannot currently express
the part's behavior. The limitations were verified against the binding format
(`specs/design.md` §6.3, §7.6), the GALasm reference (`specs/galasmManual.txt`),
the behavior parser (`web/js/engine/galasm.js`), and the simulator
(`web/js/engine/sim.js`). Resolving them would require extending the format
and/or the simulator (a specs change — out of scope for library content), so per
`CLAUDE.md` they are flagged here rather than modeled with invented conventions.

## Two independent clock domains

The simulator supports exactly **one** clock pin per component type: a single
`clock:` pin whose net drives every `.R` register in the part (`sim.js`
~line 123; FR-062d). Parts with two independent edge-triggered clocks cannot be
represented.

- **74HC74** — dual D-type flip-flop. The two flip-flops have separate clock
  pins (1CP, 2CP); they cannot share one `clock:`.
- **74HC192** — presettable BCD up/down counter. Counting up and down are driven
  by two separate clock inputs (count-up clock and count-down clock).
- **74HC193** — presettable binary up/down counter. Same two-clock structure as
  the 74HC192.
- **74HC595** — 8-bit serial-in shift register with output latch. Two separate
  rising-edge clocks: the shift-register clock (SHCP) and the storage-register
  (output latch) clock (STCP).

## Complementary (Q / Q-bar) outputs on separate pins

A pin's GALasm signal name is its YAML pin name with any leading `/` dropped
(§7.6), and the simulator maps each signal to exactly one pin/net
(`sim.js` ~line 96, the `pinOwner` map). A part that exposes both a true output
and its complement on separate pins (e.g. `Q0` and `/Q0`) collides: both reduce
to signal `Q0` and only one pin can be driven. The current naming convention
treats `/X` as "active-low X", not as a distinct complementary net.

- **74HC151** — 8-input multiplexer with both Y and /Y outputs.
- **74HC175** — quad D-type flip-flop with complementary outputs (Qn and /Qn).
  Also note: the global asynchronous reset (`AR`) forces all registers to 0,
  which is the wrong level for the /Qn outputs on reset (they should go HIGH).
- **74HC165** — see below (also has a complementary output, /Q7).

## Asynchronous parallel load of variable data

GALasm's `AR` / `SP` only force every register to a fixed 0 / 1 (galasmManual
§3.6); there is no construct to asynchronously load arbitrary data-input values
into the registers.

- **74HC165** — 8-bit parallel-in/serial-out shift register. Parallel load is
  asynchronous and level-sensitive on /PL (it transparently loads D0–D7
  regardless of the clock), which `.R` + `AR`/`SP` cannot express. (It also has
  a complementary /Q7 output and a clock-enable input.)

## No XOR operator (sum-of-products only)

The behavior language is sum-of-products with `* & + #` and complement only —
there is no XOR operator (`galasm.js` tokenizer; galasmManual §2). A 4-bit
adder's sum outputs are parity functions, which have no SOP simplification; the
most-significant sum bit alone expands to roughly 256 product terms, so a
correct flat-SOP model is impractical.

- **74HC283** — 4-bit binary full adder with fast carry.

## Datasheet not readily available

- **74HC162** — presettable synchronous BCD decade counter (synchronous reset).
  Nexperia no longer publishes a 74HC162 data sheet, and a clean
  machine-readable HC-family PDF was not obtained. (Functionally it is the
  decade/synchronous-reset sibling of the existing `74163.yaml`.) Skipped at the
  requester's direction — rarely used.
