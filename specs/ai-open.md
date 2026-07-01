# AI-Assisted Design Authoring — Open Proposals

This is a standalone scratch document, not part of the requirements/design
pair. It captures two proposals discussed 2026-07-01 for making the tool
more effective as a target for AI-generated (or AI-assisted) circuit
designs. Neither is an approved requirement yet; if either is adopted it
should be folded into `requirements.md`/`design.md` per the normal change
process (new suffixed FRs, CHANGELOG entry) before implementation.

## 1. Netlist import endpoint

**Problem.** The save format (FR-055–FR-060c) already separates electrical
connectivity from pixel geometry (FR-059a/FR-060a) — a wire's *meaning* is
its two endpoint references, not its bend points. But there is no way to
*produce* a valid design file without also producing the geometry: full
component positions, rotations, per-instance copied type data, and
per-wire bend-point lists. That geometry is exactly what an LLM is bad at
generating correctly, and a small mistake (wrong grid coordinate, wrong
`refdes`) yields a file that fails to load or silently connects the wrong
pins.

**Proposal.** Add a server endpoint, e.g.:

```
POST /api/v1/design/from-netlist
```

Request body: a minimal, geometry-free description —

```json
{
  "components": [
    { "refdes": "U1", "typeId": "type-7400" },
    { "refdes": "U2", "typeId": "type-7404" }
  ],
  "nets": [
    { "pins": [["U1", "Y"], ["U2", "A"]] },
    { "pins": [["U1", "A"], ["U1", "B"]], "label": "TIED_HIGH" }
  ]
}
```

Server-side behavior:

- Resolve each `typeId` against the component library (as `POST
  /api/v1/components` already does for authored parts) and reject unknown
  types with a structured error listing the offending `refdes`.
- Auto-place components on the grid (simple left-to-right/row-wrapping
  layout is sufficient — this is a staging area, not a finished
  schematic).
- Emit one wire per net edge as a **straight, unrouted** rat's-nest line
  between the two pin positions (no bend points) — this is already a
  legitimate rendering state per the vision doc's description of the
  rat's-nest phase, not a new concept.
- Validate as it goes and return a structured report: unconnected pins
  left dangling, bus width mismatches, duplicate `refdes`, unknown pin
  names — so an AI client gets actionable feedback without needing to
  open the UI to discover its own mistakes.
- Response: the same JSON shape as `GET /api/v1/design/load` (or `POST
  /api/v1/design/save`'s body), so the client can either save it directly
  or load it into the editor for human cleanup/routing.

**Explicitly out of scope for this endpoint:** bus pin-group snap
resolution, Manhattan routing, and layout aesthetics. The output is
intended to be a valid, simulatable starting point that a human then
tidies up in the editor — not a finished schematic.

**Tradeoff.** This bypasses the Fritzing-style manual-routing UX that is
central to the editor's design philosophy (see `vision-stmt.md` §User
Interface), so the result will look like a rat's nest until someone routes
it by hand. That's an acceptable cost for "get it simulating quickly," not
for producing a reviewable/publishable schematic.

## 2. Click-to-cycle at a point

**Problem.** A straight rat's-nest (or even a routed) wire can pass
directly underneath a component body — most commonly a self-loop wire
from one of a chip's own outputs back to one of its own inputs. Once that
happens, there is no way to click that segment: the click hits the
component (for select/move) and the wire underneath is unreachable, so the
user can't add a bend point to route it out of the way.

This gets worse if the netlist-import endpoint above is adopted, since its
auto-placed, unrouted output will produce exactly this kind of overlap
routinely rather than as a rare accident.

**Proposal.** Standard CAD click-to-cycle behavior: when a click (or
right-click) lands on a screen point where more than one selectable object
is present — a component body, a wire segment, a bus segment, a bend
point — the editor cycles through the candidates at that point in a stable
z-order on repeated clicks, rather than always resolving to the topmost
object. A right-click alternative — a small context menu listing "Wire
U1.Y→U2.A", "Component U1", etc. — is a reasonable variant if cycling
proves confusing in practice.

**Tradeoff.** This is UI-only (no routing-engine changes) and fixes the
whole class of "something is hidden under something else" problems, not
just the same-chip self-loop case — so it's the more general and cheaper
fix of the two. It doesn't improve the *look* of a design with hidden
wires, only the ability to select and then reroute them; a complementary
auto-detour heuristic (routing self-loop wires around a chip's own body by
default) was discussed and rejected as first-pass scope in favor of this
simpler fix.
