# Release Notes

## 0.3.1 — 2026-07-09

Changes since 0.2.1. Format follows [Keep a Changelog](https://keepachangelog.com/).

### Added

- **Transmission gates & relays** (FR-071g/FR-071h/FR-083a): two bidirectional
  switch built-ins with no fixed input/output side — a transmission gate
  (terminals A/B, active-high EN) and an SPDT changeover relay (logic-level
  COIL, contacts NO/COM/NC). A closed contact drives nothing; it merges its
  terminal nets for that step (per-step union-find), preserving drive strength
  and bus-conflict detection. Debug simulator only for now; Generate C… refuses
  a switch-bearing design with a clear message.
- **Off-sheet connector UI** (FR-101/FR-101b): the properties panel now sets a
  1-wide port's target file and label, and double-click or **Follow off-sheet
  connector** navigates there (joining the back-stack). Targets are a **bare
  filename in the same folder** as the referring design — peer sheets of one
  circuit live in one folder; a path separator is rejected.
- **Persistent RAM save files** (FR-114g): a RAM device may back its contents
  with a per-instance `.bin`/`.hex` save file — written on Stop, optionally
  loaded at start-up — to retain RAM across runs or seed fixed initial contents.
  Undefined cells save as 0; a missing/malformed load is non-fatal. Interactive
  Run/Stop only (test-vector runs never persist).
- **Persistent RAM in the fast C generator** (FR-117c): Generate C… now supports
  save-file RAMs too — the path and load-on-start flag are baked into the
  program, which loads the file at start-up and writes the RAM back on exit in
  both batch modes. A missing/malformed file is non-fatal (starts blank).

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
