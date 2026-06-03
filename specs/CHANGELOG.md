# Changelog: TTL Circuit Design Editor

Chronological index of change requests. **History and rationale only** — this
file is *not* needed to determine current behavior. `requirements.md` and
`design.md` are the single source of truth for the system's intended state and
are always kept current.

Each entry records what was requested, when, why, and which requirement IDs and
design sections it touched. Newest entries at the top.

## Format

```
## YYYY-MM-DD — Short title
What: one-line description of the change requested.
Why: rationale (optional if obvious).
Touches: FR-0xx, FR-0yy; design §6.x, §8
```

---

## 2026-06-03 — Remove multi-bit pins; every pin is one bit
What: Removed the `Pin.width`/`bit-width` attribute. Every pin carries exactly
one bit; a parallel bus is modeled as a `PinGroup` of single-bit pins. Restated
pin-group bus matching as "member pin count == bus width" (was "Σ member pin
bit-widths == width") in FR-041 and design §2.1/§3.1/§6.3/§6.9/§7.1/§7.6/§8/§11.
Why: Physically every TTL pin is a single bit; multi-bit pins were a vestigial,
unused concept that contradicted the symbol model and the pin-group mechanism.
Touches: FR-041; requirements Pin entity; design §2.1, §3.1, §6.3, §6.9, §7.1
(Pin/PinGroup), §7.6, §8 (A3), §11, §12 (A3).

## 2026-06-03 — Rename parser source file `mdparse.go` → `yamlparse.go`
What: Renamed the planned Go parser source file from `mdparse.go` to
`yamlparse.go` everywhere it appears in the design (§5.2 diagram, §6.1/§6.2
dependencies, §6.3 heading, §9 file plan, §10 traceability, §11 test bullets).
Why: Match the YAML decision; the `md` name was a Markdown holdover. No code
exists yet, so this is a spec-only rename.
Touches: design §5.2, §6.1, §6.2, §6.3, §9, §10, §11.

## 2026-06-03 — Component files use `.yaml`; retire the "MD file" term
What: Component-definition files now use the `.yaml` extension (loader glob
`*.yaml`, sample files `74138.yaml` etc.). Renamed the entrenched "MD file"
terminology to "YAML file" throughout both specs (it originally meant Markdown,
which is no longer accurate); the glossary key is now "YAML file". Marked the
remaining MD-syntax gap (design §3.3 G1) RESOLVED.
Why: Follow-up to the YAML decision — the `.md` extension and "MD" name were
misleading now that content is YAML; `.yaml` gives correct editor/LLM handling.
Touches: FR-002, FR-007, FR-014, FR-020a, FR-057, FR-061–FR-066; requirements §3.17
heading, §5 data table, §8 MVP, glossary; design §2.1, §3.3 (G1), §5.2, §6.1,
§6.2, §6.3, §7.6, §9 (sample filenames), §11.

## 2026-06-03 — MD format finalized as YAML; package mechanism removed
What: Resolved the MD-file open question. The format is now YAML (binding spec in
design.md §7.6, replacing the non-binding strawman). Removed the package
mechanism entirely — the `package`/`pincount` keyword, the `DIP-16`/`DIP-24/0.6`
naming grammar, and the parametric outline/pin-number generator (`packages.go`).
Outlines are now stated as `outline: [w, h]` or derived from the author-placed
pins; physical pin `number` is author-stated optional footprint/BOM metadata.
Confirmed power and ground are not represented in the file, editor, or
simulation, so the pin-direction set is exactly {in, out, bidir, tristate}.
Why: Stakeholder decisions — YAML is reliably authorable by hand and by an LLM
transcribing datasheets (the `|` block scalar makes GALasm equations
ceremony-free); the package keyword caused confusion; power/ground have no role.
Closes OQ-001 and OQ-008.
Touches: FR-061, FR-062, FR-062a, FR-062b; design §6.3, §7.1, §7.6, §8, §9, §10,
§11, §12 (OQ-001, OQ-008); removed `packages.go` from the file plan; requirements
§5 data table, §7 assumptions, glossary.

## 2026-06-03 — Establish changelog process
What: Added this CHANGELOG and a header note to `requirements.md` and
`design.md` declaring them the single source of truth and this file a
history-only index. Added `sim/CLAUDE.md` documenting the change-tracking
workflow for future sessions.
Why: Set up a change-tracking process before a series of upcoming changes.
Touches: requirements.md (header), design.md (header), CLAUDE.md (new)
