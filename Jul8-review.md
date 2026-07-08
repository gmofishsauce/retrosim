# Code Review — `web/` and `srv/` against `specs/design.md`

Date: 2026-07-08
Reviewer: expert code review pass
Scope: all source in `web/js`, `web/cgen`, `srv/`, checked against the current
(uncommitted-but-authoritative) `specs/design.md` and `requirements.md`.

## Summary

This is a mature, unusually disciplined codebase. The Go server, the netlist
derivation, the GALasm compiler/evaluator, the four-state simulator, the memory
core, and the geometry/rotation math all track the design document closely and
are supported by 411 passing unit tests. I found **one genuine correctness bug**
(subunit packages record the wrong `type` identity, silently breaking Refresh
Types for every basic-gate package and producing non-conforming save files), plus
a handful of stale doc comments. Overall assessment: **approve with one change
requested** — fix the subunit `type` identity before it accretes more
non-conforming save files.

The review is intentionally short: burying one real bug under dozens of
style notes would hurt, not help.

---

## Warning Issues

### [warning] Subunit packages store the display name in `type`, not the library id — breaks Refresh Types and violates §7.2

**Location:** `web/js/model/design.js`, `addSubunitPackage`, line 142.

```js
const inst = {
  refdes: "U" + num + letter,
  type: type.name,          // ← should be typeIdentity(type)
  ...
};
```

Compare `addInstance` (line 91), which correctly uses `type: typeIdentity(type)`.

**Why it's wrong.** §7.2 (the binding data model) states that `type` is *"the
placed type's immutable library id (`ComponentType.id`, FR-066e)"* and that this
applies to *"an ordinary, subunit, or built-in instance"* — it *"keys the
simulator's per-type behavior cache and Refresh Types matching."* Every subunit
type loaded from YAML carries an `id` (e.g. `type-7400`), so `typeIdentity(type)`
returns `"type-7400"`, but `addSubunitPackage` stamps the bare display name
`"7400"`.

**Concrete failure — Refresh Types (FR-088) silently no-ops on basic gates.**
`refreshTypesCmd` (commands.js:507) matches instances to the library with:

```js
const libType = library.find((t) => typeIdentity(t) === inst.type);
if (!libType) continue;   // subunit package: typeIdentity(t)="type-7400" ≠ inst.type="7400"
```

For a placed 7400/7402/7404/7408/7410/7414/7420/7430/7432/7486 package, the match
fails, `libType` is `undefined`, and the instance is skipped **before** the
skip-reporting logic — so it is not refreshed *and* not reported. §6.6 says
Refresh Types runs `refreshInstance` over *every* instance; for the ten most
common parts in the library it runs on none of them, with no user feedback.

**Concrete failure — non-conforming save files.** A freshly placed-and-saved
subunit instance serializes `"type":"7400"`. That violates §7.2 and diverges from
what the 1→2 migration produces for the *same* design loaded from a v1 file
(`persist.js` MIGRATIONS[1] sets `type := "type-" + typeData.name` →
`"type-7400"`). Two designs that should be identical differ by provenance.

**Why the tests miss it.** The `type7400()` fixture in `design.test.js` (and the
subunit fixture in `commands.test.js`) omit the `id` field, so `typeIdentity`
falls back to `name` and both sides coincidentally read `"7400"`. Production
library YAML always sets `id:`, so the mismatch only appears at runtime.

**Fix.** One line:

```js
type: typeIdentity(type),
```

This is safe for the simulator (it uses `inst.type` only as a per-type compile
cache key and error label — an id works identically) and for persistence. Please
add a regression test that gives the subunit fixture an `id` distinct from its
`name` and asserts both (a) `addSubunitPackage` sets each sibling's `type` to the
id and (b) `refreshTypesCmd` actually refreshes a subunit package. (Flagging per
CLAUDE.md: the fixture change is the regression to save, not a throwaway probe.)

---

## Nits

Grouped; all optional.

- **`srv/cmd/retrosim/main.go:1-5`** — the package doc comment still describes the
  "walking-skeleton entry point [that] … serves an empty mux. Endpoints and the
  static SPA handler are added in later slices." The server is fully built now;
  the comment is stale and misleads a new reader.
- **`srv/cmd/retrosim/main.go:19`** — the `--data-dir` flag help reads
  `"designs root (default: platform app-data dir)"`. Per FR-050 / §6.5 the default
  is now `~/Documents/retrosim` (documents dir), not an app-data dir. Minor, but
  it is user-facing `--help` text.
- **`srv/server/storage.go:127`** — `fmt.Errorf("%s: %w", err, ErrMalformedJSON)`
  formats the underlying `err` with `%s` as a *prefix* to the wrapped sentinel.
  It works, but reads backwards ("<indent error>: malformed JSON"); consider
  `fmt.Errorf("%s: %w: %v", path, ErrMalformedJSON, err)` for parallelism with the
  other messages in the file.

---

## Things checked and found correct (for the record)

Not exhaustive, but the higher-risk areas I verified against the spec and can
vouch for:

- **Go server** — loopback-only bind (NFR-001), atomic writes (§6.5), the full
  physical-completeness validation in `validatePhysical` (§6.3), subunit
  arity/mux-side validation, `id` derivation matching the client and migration
  rules. Clean.
- **Netlist (`netlist.js`)** — union-find over bit-lanes, all six connectivity
  passes, unequal-width bus warning (never silent), connector-label unioning, and
  the FR-094e port-pin attachment all match the §6.6 pseudocode.
- **GALasm (`galasm.js`)** — selective-pessimism evaluation (0·U=0, 1+U=1),
  per-output `.CLK/.ARST/.APRST` edge/async handling with reset-wins ordering,
  buried-node `.R` validation, and the strict-device capacity gate match §6.13.
- **Simulator (`sim.js`)** — the `kind:"pass"` per-step union-find net merge for
  transmission gates/relays (FR-083a), the `forceU` U-control rule, virtual nets
  for buried nodes, memory write/drive phases, and the settle/paced schedulers all
  match §6.13. The double-buffered `curr`/`next` closure discipline is correct.
- **Persistence (`persist.js`)** — the migration framework, structural validation
  pass, and id-counter restoration match §7.4.
- **Built-ins (`builtins.js`)** — tgate (A/B `bidir`, EN `in`) and relay
  (COIL `in`, NO/COM/NC `bidir`) declarations, and the deliberate absence of
  `BEHAVIORS`/`INTERACTIONS` entries for them, match FR-071g/FR-071h; built-in
  ids are stamped correctly via `builtinId`.

---

## Questions

None blocking.
