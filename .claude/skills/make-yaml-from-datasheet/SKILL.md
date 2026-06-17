---
name: make-yaml-from-datasheet
description: Find a 7400-series component datasheet on the Internet and write or update the component-definition YAML (pin layout, groups, delays, and GALasm behavior equations) in sim/srv/components/. Use when asked to add a new component to the library or to fill in a component's behavior from its datasheet.
---

# Make a component YAML from a datasheet

Produce `sim/srv/components/<part>.yaml` for a 7400-series part, grounded in a
real manufacturer datasheet. The exemplar is `srv/components/74138.yaml` —
match its structure, comment style, and conventions exactly.

## 1. Read the references first

- `specs/design.md` §7.6 — the **binding** YAML format and field reference.
- `specs/design.md` §6.3 — the server-side validation rules the file must pass
  (unique pin/group names, pins within outline, valid side/dir, etc.).
- `specs/galasmManual.txt` — the GALasm language reference (the **strict**
  GAL-device dialect). The simulator evaluates the **extended** dialect by
  default (FR-079a): everything in the manual **plus** an XOR operator and
  per-output clocks (see §4). Equations must conform to the manual *unless* you
  rely on a clearly-labelled extended feature — and you only need strict
  conformance when the part declares `gal:` (FR-066a/FR-079b, below).
- `srv/components/74138.yaml` — the exemplar (unit part, plain combinational).
- `srv/components/74283.yaml` — exemplar for the extended-dialect `:+:` XOR
  operator (the 4-bit adder's sum bits).
- `srv/components/74574.yaml` — exemplar for sequential (`.R` + `clock:`) parts.
- `srv/components/7400.yaml` — exemplar for `rendertype: subunit` parts.

## 2. Find the datasheet

- WebSearch for `<part> datasheet`, preferring **nexperia.com** (direct PDFs at
  `assets.nexperia.com/documents/data-sheet/...`) and **ti.com**
  (`ti.com/lit/...`). Mouser-hosted manufacturer PDFs are acceptable.
- WebFetch the PDF — the tool saves the binary locally and reports the path.
  **Read the saved PDF pages directly** (the Read tool takes a `pages` range)
  for every number you record. Do not trust the fetch summarizer for tables:
  read the pin-description table, the function/truth table, and the dynamic
  characteristics table yourself.
- Datasheets are inconsistent across vendors and decades: behavior may appear
  as a truth table, a logic diagram, Boolean equations, or prose. Use whatever
  is present and **cross-check two representations** when both exist (e.g.
  truth table against the logic diagram).

## 3. Write the YAML

- **Provenance header**: top-of-file `#` comments naming the manufacturer, the
  document title, revision and date, and the URL.
- **Naming**: prefer Nexperia signal names. An active-low pin's `/` prefix is
  part of its YAML name (`/E1`, `/Y0`). Quote the all-digit `type:`
  (`type: "74138"` — bare `74138` is a YAML integer).
- **Layout**: multi-gate packages (NANDs, inverters, muxes) are
  `rendertype: subunit` with `renderas` + per-pin `unit`; MSI parts (decoders,
  counters, registers) are `unit` with `outline: [w, h]` and per-pin
  `side`/`pos`. Inputs on the left, outputs on the right; group related pins
  with a one-row gap between functional clusters (see the 74138's select vs
  enable spacing). **Never list power/ground pins** — they do not exist in
  this system.
- **`number:`**: record the physical DIP pin number for every pin, from the
  pin-description table. Metadata only, but it cross-checks the pin list.
- **`groups:`**: ordered, bus-snappable pin groups (address, data) with the
  LSB first.
- **`delays:`**: from the dynamic-characteristics table — typical values, HC
  family at Vcc=4.5 V / 25 °C unless told otherwise. One key per distinct
  timing path, named `tpd_<path>` (e.g. `tpd_a`, `tpd_e`), with a comment
  naming the datasheet table and conditions.
- **Documentation fields (FR-104)**: emit these alongside the structural fields;
  they are optional and presentation-only (shown in the properties panel, FR-105,
  and never affecting geometry or simulation). Source them from the same
  datasheet you already have open:
  - `description:` — one line naming the part's function (the same text you put
    in the provenance header's first line).
  - `datasheet:` — a mapping `{vendor, title, rev, url}` carrying the provenance
    you already record in the header comments.
  - per-pin `desc:` — add to each pin a short role (e.g. `desc: "active-low
    enable 1"`) drawn from the datasheet's pin-description table. Skip it for the
    repetitive identical units of a plain gate package, where the symbol already
    says everything. See `srv/components/74138.yaml` for the established style.

## 4. Write the GALasm behavior block

This is the hard part. Conventions (established with the stakeholder on the
74138 — follow them exactly):

- YAML literal block scalar (`behavior: |`). Inside it, `;` starts a comment;
  `#` is literal text, never a comment.
- **Physical-level equations**: `/` is the GALasm complement operator applied
  to a signal name; signal names are the YAML pin names with any active-low
  `/` prefix dropped. So for pin `/E1`, the token `/E1` means "pin /E1 is
  LOW (asserted)". State this convention in the block's header comment.
- **Sum-of-products**: AND terms (`*`) joined by OR (`+`). GALasm has **no
  parentheses** — `/(A * B)` is not in the language. If the function needs a
  complemented product, apply De Morgan by hand or put the `/` on the output
  (LHS `/Yn = term` drives pin Yn LOW exactly when the term is true). The full
  polarity rule (declaration/use XOR) is galasmManual.txt §3.3.
- **XOR via `:+:` (extended dialect, FR-079a)**: when a flat sum-of-products
  blows up — parity, comparators, adder sum bits — join SOP groups with the
  `:+:` operator instead: `S = A :+: B :+: CIN`. `:+:` binds looser than `+`,
  so each operand is a full SOP. There are no internal nodes, so a value that
  ripples (e.g. an adder carry into bit n) must be inlined as the flat SOP of
  the primary inputs; only the rippling term grows, while the XOR keeps the
  output itself tiny (see 74283.yaml — the sum bits are trivial, only the
  fast-carry `COUT` expands). `:+:` is **extended-only**: never use it in a part
  that declares `gal:` (the GAL devices have no XOR), and never inside `AR`/`SP`/
  `.E`/`.CLK`/`.ARST`/`.APRST` (single-term constructs).
- Derive the equations from the function/truth table and then **verify every
  row**, including the disabled/default rows (for active-low outputs these
  usually fall out of the same equations — say so in a comment rather than
  adding rows).
- **Bidirectional (`dir: bidir`) pins** use the GAL tristate idiom
  (galasmManual.txt §3.4, established on the 74245): each bidir pin gets a
  `.T` output equation fed from its source plus a single-term `.E` enable,
  and appears as a feedback input in the opposite direction's equations.
  The `.E` terms for the two directions must be mutually exclusive.
- **Subunit (multi-gate) parts** (`rendertype: subunit`) get a full behavior
  block too (convention established on the 7400): the gates are independent,
  so write **one sum-of-products equation per unit**, each using that unit's
  own pin names (`1Y = /1A + /1B`, `2Y = …`). `renderas` fixes only the drawn
  symbol; the equations are the authoritative logic. GALasm pin names may
  begin with a digit (galasmManual.txt §1.3), so the datasheet's `1A`/`1Y`
  names are used verbatim.
- **Extended by default; strict only on request (FR-066a/FR-079a/FR-079b)**: a
  74-series part models behavior, so omit `gal:` — it gets the extended dialect
  (XOR, per-output clocks, no capacity limit). Add a top-level `gal: <device>`
  (`GAL16V8`/`GAL20V8`/`GAL22V10`/`GAL20RA10`) **only** when authoring an actual
  GAL you intend to burn: that turns on strict validation, which rejects the
  extended-only features and enforces the device's pin/OLMC/product-term
  capacity. Don't reach for `gal:` to model a 7400-series chip.
- Cite the datasheet table number in the block's comments.
- **Sequential parts** (latches, flip-flops, counters): registered outputs
  are fully documented — `.R` outputs, AR/SP, and `.E` are galasmManual.txt
  §3.4/§3.6; the Counter example in §4.2 shows the equation style. The
  **named-clock convention** (established on the 74574, the first sequential
  part): GALasm's `.R` implies the GAL22V10's dedicated pin-1 clock, so the
  part's named clock pin (e.g. `CP`) plays that pin-1 role and does **not**
  appear as a term in any equation — a header comment in the `behavior` block
  states this and names the clock pin and its active edge. Registered outputs
  are then `Qn.R = <data>` with an optional single-term `.E` enable for
  3-state outputs (see `srv/components/74574.yaml`).
- **Independent clock domains (extended dialect, FR-079a)**: the single global
  `clock:` pin clocks every plain `.R` register, so a part with **two or more
  independent clocks** (dual flip-flops like the 74HC74, up/down counters, a
  shift register with a separate output-latch clock) cannot use it alone.
  Instead give each registered output its own GAL20RA10-style suffix — a
  single-term `.CLK` naming its clock pin, and optional single-term `.ARST`
  (async reset) / `.APRST` (async preset): `Q1.R = D1` / `Q1.CLK = CP1`. An
  output that carries its own `.CLK` ignores the global `clock:`; mix the two
  freely (some registers global, some self-clocked). A part whose `.R` outputs
  **all** carry `.CLK` needs no top-level `clock:` key at all.
- **`clock:` keyword (REQUIRED for sequential parts, FR-062d)**: whenever the
  behavior block uses `.R`, add a top-level `clock: <pin name>` key naming the
  clock input pin (e.g. `clock: CP`) — it is how the simulator knows which pin
  drives the registers. The named pin must exist in `pins:` with `dir: in`
  (the parser validates this), and it is the same pin the behavior block's
  header comment names under the named-clock convention above. Omit the key
  entirely for purely combinational parts. Exemplar: `srv/components/74574.yaml`.

## 5. Validate

1. Write a throwaway Go test in `srv/server/` (e.g. `zz_check_test.go`)
   calling `ParseComponent("../components/<part>.yaml")`; assert pin count,
   outline, delays, a verbatim equation line from `Behavior`, and one pin
   `Number`. Run it, then **delete it**. (Pattern: see the 74138 session —
   count equation lines by prefix, not by `=`, since comments contain `=`.)
2. Run `go test ./...` from `sim/srv` to confirm the library still loads.
3. **Verify the logic by simulation**, not by eye — essential for anything
   beyond a small truth table (adders, comparators, multi-term carries) and for
   machine-generated equations. Write a throwaway Node script in `/Users/jeff/tmp`
   that imports `web/js/engine/galasm.js`, reads the YAML's `behavior:` block,
   `compileBehavior`s it, and checks every output via `evalCombinational`
   (combinational) or `updateRegisters` (sequential) against the datasheet truth
   table — or against arithmetic for an exhaustive input sweep (the 74283 was
   verified over all 512 input combinations this way). Run it, then delete it.
4. Re-read the finished YAML against the datasheet one last time: pin numbers,
   truth-table rows, delay values.

## Notes

- Temp files go in `/Users/jeff/tmp`, never `/tmp`.
- This is library content, not a spec change: no requirements/design edits and
  no CHANGELOG entry are needed unless a format question comes up — if the
  YAML format itself needs extending, stop and flag it (specs win).
