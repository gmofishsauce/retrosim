# Transmission gates and relay contacts — feasibility notes

*Question: could the simulator support a built-in bidirectional switch
component (transmission gate, mechanical relay contact)? No analog voltage
simulation required, but the drivers on the two sides of the switch can change
arbitrarily, so there is no fixed input side and output side. How difficult?
Would supporting it only in the slow simulator help?*

Assessment as of 2026-07-06 (Claude Fable 5).

## Verdict

Feasible, and the codebase is better positioned for it than most digital
simulators would be. The engine change itself is modest; the clean design is
**dynamic net merging**, not a pair of conditional drivers.

## Why the architecture is friendly to this

Both engines — the slow JS engine and the generated-C fast path — already use
the same evaluation model: every step, each component deposits *contributions*
`(net, value, weak)` computed from the previous step's net values, then each
net is independently resolved from its contribution pool. Strong drivers beat
weak pulls, 0-vs-1 conflict → U, no contribution → Z (`resolveNet` in
`web/js/engine/sim.js`, `resolve_net` in `web/cgen/runtime.c`). Four-state
logic and weak/strong drive strength — the two prerequisites for switches —
already exist.

Note how the 74245 dodges the problem today: its `DIR` pin tells the behavior
which side is the input, so each direction is just a tri-state driver with a
mutually exclusive enable (`srv/components/74245.yaml`). A transmission gate
or relay contact has no `DIR` — which is exactly the difficulty.

## The right approach, and the trap to avoid

The tempting encoding — model the switch as two back-to-back conditional
buffers (drive B with `curr[A]` and A with `curr[B]` when closed) — is subtly
wrong. Once both sides carry a value, the switch's own reflection sustains it:
release the external driver and the net latches its old value forever, an
unintended charge-storage artifact. Fixing that requires "resolve the net
excluding my own contribution," which contorts the model.

The standard and clean solution is **dynamic net merging**: a closed switch
doesn't drive anything — it makes its two nets *the same net* for resolution
purposes. Each step:

1. Evaluate every switch's control (its enable pin, or a relay's coil net)
   against `curr` — this keeps the one-unit delay from control to contact.
2. Union-find over nets connected by closed contacts.
3. Bucket contributions by component root instead of by net index; run the
   existing `resolveNet` once per connected component; assign the result to
   every member net.

Everything else falls out for free:

- Chains of pass gates work (union-find handles transitive connection).
- A pull-up seen through a closed relay contact stays weak — physically
  correct.
- Conflicts across a closed switch are caught by the existing conflict
  machinery (FR-082).
- `valueOfPin`, display, and probing need no change — every member net of a
  merged component carries the resolved value.
- Oscillating switch feedback (a switch whose control depends on nets it
  merges) is caught by the existing `SETTLE_BOUND` (FR-085).
- "Drivers on both sides changing arbitrarily" is a non-issue: resolution is
  recomputed from scratch every step with no input/output notion.

Relays layer on top trivially: the coil is just a control net (optionally with
an N-unit pick/drop delay, which fits the unit-delay model as a small counter
in the entity), and an SPDT/changeover contact is two switch elements with
complementary enables.

## Difficulty

**Slow simulator: modest.** The engine change is localized to the step loop in
`buildSimulation` — a union-find pass and bucketing by root, maybe 60–100
lines — plus a new entity kind (`kind: "switch"`, since a pass element doesn't
fit the `behave() → contributions` interface of builtins). The larger half is
the usual product surface: symbol rendering, the builtin/YAML type definition,
spec updates (new FR plus design §6.13 text), and tests. A comfortable single
work session for engine + tests; more with the full editor surface.

**Fast simulator: roughly doubles it.** `runtime.c` would need the same
union-find in C plus per-component resolution, and `cgen.js` would need to
emit the switch tables — same algorithm, second implementation, plus parity
coverage (FR-107). Not architecturally hard (the C runtime already has the
per-net contribution pool), just a second full pass.

## Would slow-only support help?

Yes, and it's a clean incremental line. The test-vector runner (§6.16) uses
the slow engine, so vectors over switch circuits would still work; only the C
export / FR-107 fast path would be affected, and `cgen.js` can simply refuse a
design containing a switch with a clear "not supported by the fast simulator"
message. Fast support can be added later without revisiting the slow-side
design, since both engines deliberately share the same net-resolution
semantics.

## One semantic decision to make up front

Real transmission-gate circuits sometimes rely on charge storage — an isolated
node holding its last value (dynamic latches, precharged buses). The
net-merging model deliberately gives Z (and U downstream) on an isolated net
instead. That is the right call for a "no analog" simulator, but it should be
stated in the FR as an explicit non-goal; designs needing retention should add
a weak keeper/pull, which the weak-drive model already supports. A rule is
also needed for U on the control pin — forcing the merged component's nets to
U is the conservative, easily explained choice.
