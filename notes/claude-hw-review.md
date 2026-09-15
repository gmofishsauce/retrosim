# Per-cycle instruction decode for the RiSC-16 CPU (U6 / U15 / U31)

## Context

`examples/cpu` is a fully wired multi-cycle RiSC-16 demo CPU. Three GAL22V10s —
**U6** (`type-INS-DCD`), **U15** (`type-22VDCD2`), **U31** (`type-22V003`) — share
the same seven inputs (IR15..IR13 opcode from X3, CY3..CY0 from the 74163 cycle
counter U7) and between them drive every control line. None has logic equations
yet. The task is to author those equations so all eight RiSC-16 instructions
execute.

Tracing the datapath from `core.json`, `prog.json`, `components/L4C381.json` and
the part YAMLs turned up **five wiring problems** that block parts of the ISA.
Agreed plan: **I edit the part YAMLs and write the equations; you make the
schematic changes in the editor** from the explicit list in §4. `sw`=100,
`lw`=101 (the p.1 format figure). `X1.OSA`/`OSB` get freed from their pull-up.
`jalr` is jump-only for now, with the link revisited later.

---

## 1. The machine as wired (verified, not assumed)

### 1.1 PC / fetch — X3 (`prog.json`)

X3 holds the PC (an L4C381 whose F register *is* the PC), the 64K×16 program ROM
addressed by the PC, and the 16-bit instruction register. `X3.RD/` is tied low so
the IR always drives `X3.OUT` = IR[15:0]; `X3.LD/` loads the IR from ROM[PC] on
the clock edge. U9 (`type-22V-DCD`, equations already present) decodes F2..F0 —
re-derived from its equations, matching the `prog.json` notes:

| F | PC operation |
|---|---|
| 0 | hold |
| 1 | PC := 0 (ALU CLEAR — needs no operand, so it resolves an undefined PC) |
| 2 | PC := PC + 1 |
| 3 | PC := A-bus |
| 4 | PC := PC + A-bus (signed) |
| 5–7 | hold |

### 1.2 Buses

* **A-bus** = `Ain-low[0..7]` (value bits 0–7) + `Ain-high[0..7]` (bits 8–15).
  Drivers: U3 (reg-file port A, `/ROE2`), U18/U19 (ALU result, `/RWE`), U25/U26
  (sext imm7), U27/U28 (imm10<<6), U22/U23 (memory read). Receivers: X1 `Ain`,
  U3 data, `X3.A-39` (PC operand), U21 address A0..A7.
* **B-bus** = `Bin-low` (bits 0–7) + `Bin-high` (bits 8–15). Drivers: U4
  (reg-file port B, `/ROE1`), U16/U17 (ALU result, `/RWE`), U21 (RAM data,
  `/MRD`). Receivers: X1 `Bin`, U4 data, U21 data D0..D15, U21 address A8..A15.

### 1.3 Register file

U3 and U4 are two `RAM 8×16` copies of one 8-register file — U3 reads onto the
A-bus, U4 onto the B-bus, and a write hits both at once. Addresses come from the
74157 muxes U5/U13 under the single select `CSRC`:

| CSRC | U3 (A-bus port) | U4 (B-bus port) |
|---|---|---|
| 0 | regC = IR[2:0] | regB = IR[9:7] |
| 1 | regA = IR[12:10] | regA = IR[12:10] |

`rB`+`rC` are available simultaneously; **`rA`+`rB` are not** — that pairing must
go through the ALU's A/B input registers (`/ENA`, `/ENB`).

### 1.4 Main ALU X1 (`L4C381`)

Four 74V581 slices plus operand muxes, input registers, an F (result) register
and a zero comparator. Function select `S0,S1,S2` (from U15):

| S0 S1 S2 | op | | S0 S1 S2 | op |
|---|---|---|---|---|
| 0 0 0 | CLEAR (F=0000) | | 0 0 1 | A XOR B |
| 1 0 0 | B − A (= B + /A + Cin) | | 1 0 1 | A OR B |
| 0 1 0 | A − B (= A + /B + Cin) | | 0 1 1 | A AND B |
| 1 1 0 | A + B + Cin | | 1 1 1 | PRESET (F=FFFF) |

* `FTAB` = 1 → both operands from the buses; = 0 → both from the A/B input
  registers. **They cannot be mixed** — one bus operand plus one register
  operand is impossible.
* `OSA`/`OSB` select operand sources (see U63's equations inside L4C381):
  `11` → A and B from reg/bus; `10` → B := 0; `01` → A := 0; `00` → B := F
  (accumulator feedback). Currently unreachable — see **W6**.
* `FTF` = 0 → `OUT` is the F register; = 1 → the combinational result. `/OE`
  enables `OUT`. `/ENF` loads the F register on the clock edge.
* `Z` is high when `OUT` == 0, and is valid only while `/OE` is asserted.

### 1.5 The decoders are registered — everything is one cycle late

All three decoders' outputs are `olmc: reg` on the primary clock, as are U7 and
every datapath register. The control word present while the counter reads *n* was
computed from counter value *n−1*. The microcode is written in that frame:

> **Phase *p*** = the interval during which control word *p* is active.
> Control word *p* is produced by product terms conditioned on **CY = p−1**.

Consequence: **phase 0 is a bubble.** The IR loads on the same edge that clears
the counter, so the word active during CY=0 was computed before the new opcode
was visible. Writing *no* terms at CY = 5 (the terminal count) makes that bubble
an automatic no-op: active-low outputs written `/X.R = ...` idle high, active-high
outputs idle at 0 (F=0 → PC holds, `/ENF` deasserted → F holds).

`/LD` is shared by `X3.LD/`, `U7./CLR` and `U7.ENT`, so asserting it always means
"fetch and restart the cycle counter" — coherent and intended.

### 1.6 Write timing

RAM and register-file writes latch on the **rising** edge of `WE/`
(`memory.js` `writeStep`), sampling what `curr` holds at that step — which, under
the unit-delay model, is still the pre-edge bus value. So "assert `WE/` for the
whole of phase *p*" writes phase *p*'s data. The microcode below never merges a
write into the fetch phase, so this is not load-bearing, but it is worth
confirming on the first run.

---

## 2. Findings — the wiring problems

**W1 — the Z flag is not connected to anything.** `X1.Z` appears in no net in
`core.json`. U6, U15 and U31 each have four `NC` inputs (pins 9, 10, 11, 13) and
none is Z. `beq` cannot be conditional. Z must reach **U6**, which owns F2..F0.

**W2 — there is no reset, and the machine cannot start without one.** GAL `.R`
outputs and the 74163 power up **U** (`sim.js` seeds `VU`). `U7./CLR` comes from
`U6./LD`, itself a register reading CY and IR — all U. Under three-valued rules
(`0·x = 0`, `1+x = 1`) nothing ever resolves; the CPU sits at U forever. No
`type-reset` builtin is placed. U31 in particular needs the reset, or an
undefined register-write strobe scribbles on the register file at power-up.

**W3 — the ALU result reaches the B-bus byte-swapped, corrupting register port B
on every write.** U18/U19 carry `OUT-LO→Ain-low`, `OUT-HI→Ain-high` (straight);
U16/U17 carry `OUT-LO→Bin-high`, `OUT-HI→Bin-low` (**swapped**). One `/RWE`
writes both U3 and U4, so U3 stores the result and U4 stores its byte-swap and
reads back byte-swapped. The swap is evidently deliberate — `U21.A8..A15` come
from `Bin-low`, and the swap is exactly what puts the result's high byte there so
the RAM address `{Bin-low, Ain-low}` is correct — but the two purposes cannot
share the net.

**W4 — `/RWE` conflates three jobs, so `lw`/`sw` are impossible.** One net drives
`U3.WE/`, `U4.WE/` and the output enables of U16, U17, U18 and U19. The ALU
result can therefore never be placed on a bus (e.g. as a memory address) without
also writing the register file, and the address on `Bin-low` always collides with
the RAM's own data pins on that same net.

**W5 — `/MRD` conflates two jobs.** It drives `U21.OE/` *and* U22/U23, the B→A
memory-read buffers. During a load the address must hold the A-bus, so U22/U23
must not drive it.

**W6 — `X1.OSA`/`OSB` are tied to pull-up A-8**, so the ALU's "A := 0",
"B := 0" and "B := F feedback" operand modes are permanently unreachable. Not a
correctness bug, but it costs a clock per instruction and many product terms.

**W7 (deferred, your call later) — `jalr` cannot link.** `X3.PC-HI`/`PC-LO` are
unconnected; there is no path from the PC into the datapath, so `R[rA] := PC+1`
is unimplementable. The jump half works and is what §3 implements.

**Also worth knowing:**

* **Four pins cannot be named in equations at all.** Signal names are
  `[A-Za-z0-9]{1,8}` and only a *leading* `/` is stripped (`galasm.js`
  `NAME_RE`, `parseName`), so `U15.IMM10/`, `U15.IMM7/`, `U31.ENA/` and
  `U31.ENB/` are unreachable as left-hand sides and **must be renamed**.
* **`!` is a legal negation prefix** alongside `/`, so the old experimental
  `F0.R = !CY0 * ...` syntax was fine.
* **r0 is not enforced to read zero** — it is an ordinary RAM cell, and the
  decoders cannot see IR[12:10], so they cannot suppress a write to r0. Software
  convention only. The register RAMs are also unseeded (`ramLoad: false`, and
  `regram.bin` does not exist), so registers read **U** until written; a 16-byte
  zero `regram.bin` with `ramLoad: true` would make r0 read 0 from power-up.

---

## 3. Proposed microcode

### 3.1 Structure

* **Uniform length**: every instruction runs phases 0..5 — phase 0 bubble,
  phases 1..4 work, **phase 5 = fetch**. Six clocks per instruction. This makes
  `/LD.R` two product terms (`RESET` + `/RESET * /CY3*CY2*/CY1*/CY0`) instead of
  eight, and unused phases cost nothing because "no terms" already means "no-op".
* **PC+1 happens in phase 1**, not at the fetch. The fetch asserts only `/LD`
  (F=0). This keeps the invariant "while the instruction at address *a* executes,
  PC = a+1" — what `beq` needs, and what a future `jalr` link would need — **and**
  avoids executing the instruction at address 0 twice coming out of reset.
* **Reset word**: `RESET` → `F=1` (PC := 0) + `/LD` (counter → 0, IR loads), every
  other output forced idle by gating each product term with `/RESET`. A 3-cycle
  reset pulse leaves PC=0, CY=0, IR=ROM[0].

### 3.2 Sequences

Only asserted signals are listed; everything else idles. Pin names are the
post-rename ones (§4.1).

| op | phase 1 | phase 2 | phase 3 | phase 4 | phase 5 |
|---|---|---|---|---|---|
| **000 add**<br>rA ← rB+rC | F=2; CSRC=0; `/ROE2`,`/ROE1`; FTAB=1; OSA=OSB=1; S=A+B; Cin=0; `/ENF` | CSRC=1; `/RWE`,`/BOE`,`/REGWE`; `/OE`; FTF=0 | — | — | `/LD` |
| **001 addi**<br>rA ← rB+imm7 | F=2; `/IMM7`; CSRC=0; `/ROE1`; FTAB=1; OSA=OSB=1; S=A+B; Cin=0; `/ENF` | write-back (as add) | — | — | `/LD` |
| **010 nand**<br>rA ← ~(rB&rC) | F=2; CSRC=0; `/ROE2`,`/ROE1`; FTAB=1; OSA=OSB=1; S=AND; `/ENF` | `/RWE` (A-bus←F); FTAB=1; OSA=1,OSB=0 (B:=0); S=B−A; Cin=0; `/ENF` → F := ~F | write-back | — | `/LD` |
| **011 lui**<br>rA ← imm10<<6 | F=2; `/IMM10`; FTAB=1; OSA=1,OSB=0; S=A+B; Cin=0; `/ENF` | write-back | — | — | `/LD` |
| **100 sw**<br>Mem[rB+imm7] ← rA | F=2; `/IMM7`; CSRC=0; `/ROE1`; FTAB=1; OSA=OSB=1; S=A+B; Cin=0; `/ENF` → F := addr | `/RWE` (A-bus←addr→RAM addr); CSRC=1; `/ROE1` (B-bus←R[rA]); `/MWE` | — | — | `/LD` |
| **101 lw**<br>rA ← Mem[rB+imm7] | F=2; `/IMM7`; CSRC=0; `/ROE1`; FTAB=1; OSA=OSB=1; S=A+B; Cin=0; `/ENF` → F := addr | `/RWE` (A-bus←addr); `/MRD` (RAM→B-bus); FTAB=1; OSA=0,OSB=1 (A:=0); S=A+B; Cin=0; `/ENF` → F := Mem | write-back | — | `/LD` |
| **110 beq**<br>if rA==rB PC+=imm7 | F=2; CSRC=1; `/ROE2`; `/ENA` → Areg := R[rA] | CSRC=0; `/ROE1`; `/ENB` → Breg := R[rB] | FTAB=0; OSA=OSB=1; S=A−B; Cin=1; FTF=1; `/OE` → Z valid | **if Z**: `/IMM7`; F=4 (PC += imm) | `/LD` |
| **111 jalr**<br>PC ← rB (jump only) | F=2; CSRC=0; `/ROE1`; FTAB=1; OSA=0,OSB=1 (A:=0); S=A+B; Cin=0; `/ENF` → F := R[rB] | `/RWE` (A-bus←F); F=3 (PC := A-bus) | — | — | `/LD` |
| **reset** | `RESET`: F=1; `/LD`; all else idle | | | | |

Notes:
* `beq`'s branch (F=4) and the fetch cannot share a phase — F encodes one PC op
  per cycle, and a fetch concurrent with `PC += imm` would read the pre-branch PC.
* Z is sampled by U6 at the edge ending phase 3 and gates the phase-4 word —
  exactly what the registered decoder gives for free.
* `sw` phase 2: `/RWE` drives the A-bus (address) while `/ROE1` drives the B-bus
  (data) — different buses, no conflict. The RAM latches at the end of the phase.
* With W7 fixed later, `jalr` becomes P1 `F := PC`, P2 write-back to rA,
  P3 `F := R[rB]`, P4 `PC := F`, P5 fetch — still inside the 6-clock budget.

### 3.3 Output assignment

| U6 (`type-INS-DCD`) | U15 (`type-22VDCD2`) | U31 (`type-22V003`) |
|---|---|---|
| F0 F1 F2, `/LD`, `/MWE`, CSRC, `/RWE`, `/MRD`, `/ROE1`, `/ROE2` | S0 S1 S2, FTAB, `/ENF`, FTF, `/OE`, Cin, `/IMM10`, `/IMM7` | `/ENA`(14), `/ENB`(15), **`/BOE`**(16), **`/REGWE`**(17), **`/MBUF`**(18), **OSA**(19), **OSB**(20), spare(21–23) |

Term budget: the simulator caps each output at 16 products uniformly
(`galasm.js` `GAL22V10.maxTerms`) and does **not** enforce the real 22V10's
per-pin 8/10/12/14/16 profile. Worst case here is ~6 terms (`CSRC`, `/ROE1`), so
there is ample headroom — but if these are ever burned, pin assignment matters
(F0 on pin 14 gets only 8 terms).

---

## 4. Implementation steps

Per `CLAUDE.md`: specs first, then code, `docs/user.md` only after **your**
manual verification.

### 4.0 Specs

1. `specs/requirements.md` / `specs/design.md` — add/amend the FRs and design
   sections covering the decoder behavior and the wiring changes. Edit in place;
   additive → suffixed FR, rework → note the supersession in the design.md §8
   style.
2. `specs/CHANGELOG.md` — one line on top naming the touched FR IDs and sections.

### 4.1 Part YAMLs (I do these)

`examples/cpu/components/type-INS-DCD.yaml`
* rename `NC` pin 9 → `RESET`, `NC` pin 10 → `Z` (both `dir: in`)
* add the `behavior:` block

`examples/cpu/components/type-22VDCD2.yaml`
* rename `NC` pin 9 → `RESET`
* rename `IMM10/` (pin 22) → `/IMM10`, `IMM7/` (pin 23) → `/IMM7`
* add the `behavior:` block

`examples/cpu/components/type-22V003.yaml`
* rename `NC` pin 9 → `RESET`
* rename `ENA/` (14) → `/ENA`, `ENB/` (15) → `/ENB`
* rename `IO16`→`/BOE`, `IO17`→`/REGWE`, `IO18`→`/MBUF`, `IO19`→`OSA`,
  `IO20`→`OSB`; leave `IO21`–`IO23` as spares (an `olmc: reg` output with no
  equation is legal — FR-066j)
* add the `behavior:` block

Equations: strict GALasm (`gal: GAL22V10`), sum-of-products, `/` or `!` for
complement, `.R` on every driven output, `;` comments, no reference to the `CLK`
pin or any `NC` pin, every term gated with `/RESET`. I will generate all three
blocks from one microcode table so they cannot drift apart.

### 4.2 Schematic changes (you do these in the editor)

After I land the YAMLs, open `examples/cpu` and **Refresh Types** — the renames
will drop the connections listed below and report them; then re-make them.

*Re-make (dropped by the renames):*
* `/IMM7` → `U25./OE1`, `U25./OE2`, `U26./OE1`, `U26./OE2`
* `/IMM10` → `U27./OE1`, `U27./OE2`, `U28./OE1`, `U28./OE2`
* `/ENA` → `X1./ENA`;  `/ENB` → `X1./ENB`

*W1 — Z:* new net `X1.Z` → `U6.Z`.

*W2 — reset:* place the power-on **reset** builtin (`cycles` ≥ 3); its
active-high `R` output → `U6.RESET`, `U15.RESET`, `U31.RESET`.

*W3 — un-swap and re-address:*
* swap U16's and U17's input bundles: `U16.D0..D7` move from the `X1.OUT-LO*`
  nets to the `X1.OUT-HI*` nets, and `U17.D0..D7` the other way. Their outputs
  stay on `Bin-high*` / `Bin-low*` as they are.
* move `U21.A8..A15` off `Bin-low0..7` onto `Ain-high0..7`.

*W4 — split `/RWE` three ways:*
* `/RWE` (U6) keeps only `U18./OE1`, `U18./OE2`, `U19./OE1`, `U19./OE2`
* new `/BOE` (U31 pin 16) → `U16./OE1`, `U16./OE2`, `U17./OE1`, `U17./OE2`
* new `/REGWE` (U31 pin 17) → `U3.WE/`, `U4.WE/`

*W5 — split `/MRD`:*
* `/MRD` (U6) keeps only `U21.OE/`
* new `/MBUF` (U31 pin 18) → `U22./OE1`, `U22./OE2`, `U23./OE1`, `U23./OE2`
  (the microcode leaves it deasserted; the ALU reads memory off the B-bus)

*W6 — free OSA/OSB:*
* delete the `X1.OSA` – `A-8` – `X1.OSB` net (and the now-unused pull-up A-8)
* `X1.OSA` → U31 `OSA` (pin 19); `X1.OSB` → U31 `OSB` (pin 20)

### 4.3 Program and register seed

* a test ROM in `examples/cpu/cpurom.bin` exercising all eight instructions
* optionally a zero-filled 16-byte `examples/cpu/regram.bin` with `ramLoad: true`
  in `type-RAM-8-16.yaml`, so registers — r0 in particular — start defined

### 4.4 Docs

`docs/user.md` only after you have manually verified the CPU runs.

---

## 5. Verification

* `./runtests.sh` (`--quick` while iterating) — JS unit tests, Go tests, C-gen
  parity. The GAL equations compile under `validateStrict`, so a definition error
  surfaces as a refusal to Run and as red instances on the canvas (FR-066l).
* Cheapest first check: a `.tv` test-vector file against each decoder GAL alone,
  driving RESET/CY/IR/Z and asserting the expected control word per cell — this
  validates the microcode table before the whole CPU is in play.
* Then Run the slow simulator on `examples/cpu` and single-step: the counter
  should sequence 0..5, `/LD` should fire once per instruction, and the PC should
  advance by exactly one per instruction.
* Per-instruction ROM checks: `addi` then `add` (arithmetic plus a register
  write-back through **both** U3 and U4 — the direct test for W3); `lui`+`addi`
  to build a constant; `sw` then `lw` to the same address; `beq` taken and
  not-taken; `jalr` as a jump.
