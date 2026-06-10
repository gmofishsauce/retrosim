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
- `specs/galasmManual.txt` — the **authoritative** GALasm reference
  (parser-verified, GAL22V10 dialect); equations must conform to it.
- `srv/components/74138.yaml` — the exemplar (unit part with behavior).
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

## 4. Write the GALasm behavior block

This is the hard part. Conventions (established with the stakeholder on the
74138 — follow them exactly):

- YAML literal block scalar (`behavior: |`). Inside it, `;` starts a comment;
  `#` is literal text, never a comment.
- **Physical-level equations**: `/` is the GALasm complement operator applied
  to a signal name; signal names are the YAML pin names with any active-low
  `/` prefix dropped. So for pin `/E1`, the token `/E1` means "pin /E1 is
  LOW (asserted)". State this convention in the block's header comment.
- **Sum-of-products only**: AND terms (`*`) joined by OR (`+`). GALasm has
  **no parentheses** — `/(A * B)` is not in the language. If the function
  needs a complemented product, apply De Morgan by hand or put the `/` on the
  output (LHS `/Yn = term` drives pin Yn LOW exactly when the term is true).
  The full polarity rule (declaration/use XOR) is galasmManual.txt §3.3.
- Derive the equations from the function/truth table and then **verify every
  row**, including the disabled/default rows (for active-low outputs these
  usually fall out of the same equations — say so in a comment rather than
  adding rows).
- **Bidirectional (`dir: bidir`) pins** use the GAL tristate idiom
  (galasmManual.txt §3.4, established on the 74245): each bidir pin gets a
  `.T` output equation fed from its source plus a single-term `.E` enable,
  and appears as a feedback input in the opposite direction's equations.
  The `.E` terms for the two directions must be mutually exclusive.
- **Physical GAL capacity is NOT a constraint**: behavior blocks use the
  GALasm language, not the 22V10's pin count, OLMC count, or per-pin
  product-term limits (galasmManual.txt §5).
- Cite the datasheet table number in the block's comments.
- **Sequential parts** (latches, flip-flops, counters): registered outputs
  are fully documented — `.R` outputs, AR/SP, and `.E` are galasmManual.txt
  §3.4/§3.6; the Counter example in §4.2 shows the equation style. One
  project convention is **not yet established**: GALasm's `.R` implies the
  GAL22V10's dedicated pin-1 clock, but a 74xx part has a *named* clock pin.
  For the first sequential part, propose a mapping (e.g. a header comment
  declaring which YAML pin plays the pin-1 clock role) and **get the user's
  approval before treating it as precedent**; then record the decision here
  and in the exemplar.

## 5. Validate

1. Write a throwaway Go test in `srv/server/` (e.g. `zz_check_test.go`)
   calling `ParseComponent("../components/<part>.yaml")`; assert pin count,
   outline, delays, a verbatim equation line from `Behavior`, and one pin
   `Number`. Run it, then **delete it**. (Pattern: see the 74138 session —
   count equation lines by prefix, not by `=`, since comments contain `=`.)
2. Run `go test ./...` from `sim/srv` to confirm the library still loads.
3. Re-read the finished YAML against the datasheet one last time: pin numbers,
   truth-table rows, delay values.

## Notes

- Temp files go in `/Users/jeff/tmp`, never `/tmp`.
- This is library content, not a spec change: no requirements/design edits and
  no CHANGELOG entry are needed unless a format question comes up — if the
  YAML format itself needs extending, stop and flag it (specs win).
