# Release Notes

## 0.2.1 — 2026-07-06

Changes since 0.1.1. Format follows [Keep a Changelog](https://keepachangelog.com/).

### Added

- **File ▸ Export… with NDL netlist backend** (FR-119/FR-119a): new Export menu
  item writes an `.ndl` netlist of the live design (unsaved edits included),
  flattening hierarchy like Generate C. The dialog is format-extensible (KiCad
  to come). NDL renders pinouts, a synthetic POWER package, a `J1` connector for
  ports, and driver-first star nets. Output is deterministic.
- **Exporter physical package metadata** (FR-062e): optional top-level
  `physical:` YAML block (package, pincount, power pins, NC pins) for netlist
  exporters, validated for pin-number completeness. Added to all 31 numbered
  component YAMLs; the check caught and fixed real pin-number errors in
  74688.yaml.
- **Buried registered internal nodes + 74HC165 shift register** (FR-079c):
  behavior blocks may declare hidden registered state (`internal:` nodes),
  letting shift/counter chains model faithfully in both simulators.
- **New components**: 74HC595 (8-bit shift register w/ output latches), 74165
  (8-bit PISO shift register), and 74540 / 74541 / 74688 (contributed by
  @jirne).
- **Batch Refresh Types tool** (`node web/tools/refresh-types.js`): offline tool
  that migrates saved designs to the current format and re-copies library type
  data, no running server required.
- **NDL language documentation** (`docs/netlist-language.md`).
- **Auto fit-to-screen on design load** (FR-022a): opening a design (or
  descending into a sub-design) now frames it in the viewport automatically.

### Changed

- **Pin connection leads replace connection bubbles** (FR-013/FR-013d/FR-020):
  rectangle and built-in component pins now draw a short straight lead instead
  of a resting bubble, reading more like a schematic. Wire attachment moves to
  the lead's outer end; the electrical grid point is unchanged.
- **Edge-anchored unit pin-name labels** (FR-015a): unit pin names hug their
  border edge with a fixed margin (growing inward) instead of centering on a
  fixed point, keeping the gap to the border constant and legible for long names.

### Fixed

- **ROM binding preserved on Refresh Types** (FR-088): `refreshInstance` no
  longer clobbers an instance's own `romFile` with the library metatype's
  creation-time ROM path.
