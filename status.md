# retrosim — Implementation Status

_Last updated: 2026-06-03_

A localhost-only TTL circuit design editor (Go server + plain-JS SPA), built per
`sim/specs/requirements.md` and `sim/specs/design.md`. This file tracks what is
implemented, how it's verified, and what remains.

## Summary

The editor is a usable MVP: place/select/move/rotate/delete components, draw and
route wires (bends, branches/junctions, fan-out), draw buses (width, branch,
group snap-connect, single-bit breakout), and save/open designs. Tools are
available from a toolbar; zoom and pan work. The component library is loaded
from **YAML files** (`components/*.yaml`) parsed at startup.

**Spec sync note (2026-06-03):** the component-definition format is now fully
specified — it is **YAML** (design §7.6), the **package mechanism is removed**,
**every pin is one bit** (no `Pin.width`), and **power/ground are not
represented** anywhere (OQ-001 and OQ-008 resolved). The code has been brought
back in sync: `ComponentType.Package` and `Pin.Width` removed; the real YAML
parser (`yamlparse.go`) is written and `LoadLibrary` now globs and parses
`components/*.yaml` (stub fixtures retired).

- **Go server tests:** all green (`cd sim/srv && go test ./...`)
- **JS unit tests:** 104 passing (`cd sim/web && node --test`)
- **End-to-end:** verified in headless Chrome via the DevTools Protocol
  (placement, rotate, move, wire, branch, delete, bus draw/width/branch, file
  save→new→open round-trip, zoom, pan).

## Layout

```
sim/
  srv/                 Go module: github.com/gmofishsauce/retrosim/sim/srv
    cmd/retrosim/      entry point (loopback-only bind, flags)
    server/            api, components, yamlparse, storage, paths, types
    components/        YAML component library (74138, 7400, 74245)
  web/                 SPA (plain ES modules, no build step)
    js/                app, api, store, geometry, commands
      model/           design, netlist, persist
      engine/          canvas (renderer), interaction (tool FSM), hittest
      chrome/          toolbar, dialogs, fileops
  specs/               requirements.md, design.md (authoritative)
```

## Implemented

### Server (Go, `net/http` only)
- Loopback-only bind with a fatal guard on non-loopback `--addr` (NFR-001).
- Flags: `--addr`, `--components-dir`, `--data-dir`, `--web-dir`.
- `GET /api/v1/components` — component library, parsed at startup from
  `components/*.yaml` (74138, 7400, 74245) by `yamlparse.go`. `LoadLibrary` globs
  the dir, skips+logs bad files, and treats a missing dir as an empty palette.
- `yamlparse.go` — `ParseComponent` decodes a `.yaml` file (`gopkg.in/yaml.v3`,
  unknown keys ignored per FR-066), validates `type`/pin `side`/`pos`/`dir` and
  group members, resolves the outline (explicit `outline:` else derived from
  pins), and captures `behavior:` verbatim (§6.3/§7.6). Unit-tested.
- `GET /api/v1/defaults` — platform app-data dir (per-OS, table-tested seam).
- `GET /api/v1/files` — directory listing for the file dialog (.json + dirs).
- `GET /api/v1/design/load`, `POST /api/v1/design/save` — JSON designs, atomic
  write (temp + rename); designs stored opaquely (`json.RawMessage`).
- Static handler serves `web/`. Consistent `{"error":...}` envelope + status map.

### Client model (pure, unit-tested)
- `Design` shape; `addInstance` with refdes assignment (FR-011).
- First-class `Vertex` graph; `addWire`, pin-vertex create/reuse (fan-out),
  `vertexWorld` (pin positions derived → wires stretch on move, FR-018).
- Bends (insert/move/delete), branch/junction (`branchWire`,
  `branchAtPathPoint`).
- `cleanup`: G2 junction demotion (interior→bend, endpoint→free), FR-030 prune,
  vertex GC; `deleteWire`, `deleteInstance` (FR-018a/029/033a).
- Buses: `addBus`/`deleteBus`/`setBusWidth`; `snapBusGroup` (group snap-connect +
  bit-name adoption, FR-042/037b), `setBusBitNames`, `breakoutBit` (FR-043a);
  `matchingGroups` (width-match query, FR-041).
- `buildNets`: union-find over **bit-lanes**, derived from ids/bit indices only
  (FR-034b/059a/037a); handles group snap, bus↔bus join, breakout, with per-net
  provenance and resolved name (FR-060a/037b).
- `serializeDesign`/`deserializeDesign` (FR-055/056); id counters rebuilt on load.

### Store & commands
- Single command pipeline with undo/redo (UNDO_CAP=100, NFR-006), dirty flag,
  pub/sub; `replaceDesign`/`markSaved` for New/Open/Save.
- Commands: place/move/rotate/delete component; add/delete wire; insert/move
  bend; add/delete bus; set bus width; snap bus group (also folded into
  `addBusCmd` for one-undo drops); break out bus bit; set bus bit names. Cascade-
  causing deletes use snapshot revert for exact undo.

### UI
- Canvas renderer (rAF, render-on-dirty): grid, component outlines + pin stubs +
  **upright** labels, wires (thin black), junction dots, dangling-end markers,
  buses (thick blue + `/n` width annotation).
- Interaction FSM: SELECT / PLACE / WIRE / BUS. Placement (click or drag,
  one-shot); select/move(snap)/rotate(R)/delete; wire click-to-select,
  drag-to-bend, branch; bus draw with equal-width guard (FR-039a). Bus endpoint
  dropped on a component snap-connects: auto on a single width-matching pin group
  (FR-041a), disambiguation dialog on ≥2 (FR-041b). WIRE-click on a bus breaks out
  a single bit via a bit picker (FR-043a). Verified end-to-end in headless Chrome.
- Toolbar: Select/Wire/Bus, zoom −/+, Undo/Redo, New/Open/Save/Save As;
  active-tool highlight; design-name with unsaved `*` marker.
- File dialogs (server-assisted navigation) for Save/Open.
- Right-click context menu (FR-033b): delete bend point (FR-033), delete wire
  (FR-033a), bus set-width (FR-038) / edit-bit-names (FR-037b) / delete-bus, and
  delete component (FR-018a). Width/bit-name entry via small modal prompts.
- Properties panel (FR-020a): docked right-edge panel showing the selected
  instance's type data; per-instance propagation-delay overrides via
  `setOverride`/`setOverrideCmd`, persisted in the instance record (FR-058).
- Zoom (wheel to cursor, buttons) and pan (left-drag empty canvas, middle-drag,
  space+drag).
- Keyboard: `w`/`b` tools, `R`/`Shift+R` rotate, Delete, Esc, Ctrl/Cmd+Z /
  Shift+Ctrl/Cmd+Z / Ctrl/Cmd+Y undo-redo.

## Not yet implemented

- Minor: pin-label crowding at low zoom (readable when zoomed in).

## Deviations from the design (agreed with stakeholder)

- Go server is its own module at `sim/srv/` (design §9 implied `sim/server`),
  keeping the server separate from the SPA at `sim/web/`.
- Designs are persisted **opaquely** (`json.RawMessage`); no full `Design` Go
  struct (the SPA owns the schema).
- `paths.go` uses a testable `appDataDir(goos, getenv, home)` seam.
- SELECT-mode wire interaction: click selects, drag inserts/moves a bend
  (reconciles FR-031 with FR-033a; stakeholder-confirmed).
- The bit-lane `buildNets` extension was moved from S16 to S17 (needs snap/pin
  connections to be observable).
- Recent-files list (FR-054) is **not** built: it is an optional fallback for
  when server-assisted navigation is impractical, and server-assisted navigation
  (FR-052/053) works, so FR-054 is satisfied by that alternative.

## How to run

```
cd sim/srv
go build -o /tmp/retrosim ./cmd/retrosim
/tmp/retrosim --web-dir ../web        # binds 127.0.0.1:8137
# open http://127.0.0.1:8137
```

Tests:

```
cd sim/srv && go test ./...
cd sim/web && node --test
```
