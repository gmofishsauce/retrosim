# Task: Implement transmission gates & relays (FR-071g / FR-071h / FR-083a)

You are implementing a feature in the `retrosim` repo (a localhost TTL schematic
editor: JS SPA under `web/`, Go server under `srv/`). **Read `CLAUDE.md` at the
repo root first** and follow its rules exactly.

## Status: specs are done, code is not

`specs/requirements.md` and `specs/design.md` were already updated for this
feature (see the 2026-07-07 entry at the top of `specs/CHANGELOG.md`, titled
"Transmission gates & relays"). Your job is **code and tests only**. Do not
edit the specs or the changelog unless you find a genuine discrepancy between
spec and code — in that case **stop and flag it**; the specs win.

## Read these before writing any code

Requirements (`specs/requirements.md`):
- **FR-071g** (§3.4a) — transmission gate built-in: 2×2; terminals `A`
  (left-center, bidir) / `B` (right-center, bidir), enable `EN` (top-center,
  in); tooltip "transmission gate".
- **FR-071h** (§3.4a) — SPDT relay built-in: 3×4; `COIL` (left-center, in,
  idealized one-pin logic-level coil), right edge `NO`(top)/`COM`(mid)/`NC`
  (bottom), all bidir; tooltip "relay (SPDT)". No pick/drop delay.
- **FR-083a** (§3.19) — the semantics: **dynamic net merging**. This is the
  heart of the feature; read it in full.
- **FR-116** — the "Switch elements" clause: Generate C refuses.
- **FR-119a** clause (f) — NDL export records them as virtual-comment lines.

Design (`specs/design.md`):
- **§6.11** — the builtins-registry paragraph describing the `tgate`/`relay`
  entries, `drawTgate`/`drawRelay`, and why they have **no `BEHAVIORS` and no
  `INTERACTIONS` entries** (they become `kind:"pass"` sim entities, like
  memory's escape from the source-only behavior signature).
- **§6.13** — the block "**Switch elements — dynamic net merging**". This is
  your algorithm spec for `sim.js`. Follow it exactly.
- **§6.17** — the Preflight/refusals bullet (cgen refusal wording).
- **§6.18** — the Virtual built-ins bullet (NDL comment-line shape).
- **§8** — the decision row explaining why net merging was chosen and why the
  back-to-back-conditional-driver model is WRONG (it charge-latches). Do not
  implement that model.
- **§11.1** — the two new test bullets ("JS `sim` switch elements" and the
  extended cgen refusal case) are your test checklist.

Background (optional): `notes/tg-discussion.md`.

## Implementation order

1. **`web/js/builtins.js`** — add the two type entries (`id`s follow the
   existing `"type-"+name` rule → `type-tgate`, `type-relay`; renderTypes
   `"tgate"` and `"relay"` — NOT `"switch"`, which the input switch owns).
   Pins, footprints, tooltips, inline-SVG palette icons per FR-071g/h. No
   `properties`, no `BEHAVIORS` entry, no `INTERACTIONS` entry. They place via
   the normal `addInstance` path (A-series refdes) with no new per-instance
   fields — persistence, selection, move, rotate, delete, undo all come free.
2. **`web/js/engine/canvas.js`** — `drawTgate` (two overlapping
   opposite-pointing triangles between A and B, EN lead entering the top) and
   `drawRelay` (coil box inside the left edge; contact arm pivoting from COM
   drawn in the **released** position touching NC). Static glyphs — they do
   not animate with simulated state. Same image serves palette icon and
   placed object. Standard pin leads (FR-013) apply automatically.
3. **`web/js/engine/sim.js`** — the engine change, per design §6.13:
   - Route instances with renderType `tgate`/`relay` to a new entity kind
     **`"pass"`** (`makePassEntity`). Each carries its control net index and
     contact records `{a, b, closedWhen}`: tgate → `{A,B,closedWhen:1}`;
     relay → `{COM,NO,closedWhen:1}` and `{COM,NC,closedWhen:0}`.
   - Pass entities deposit **no contributions**. In the step loop, after all
     contributions are deposited and **before** resolution: read each control
     from `curr` (Z→U, same normalization as `readNet` — this preserves the
     one-unit control→contact delay); control 0/1 → `union(a,b)` for each
     matching contact in a per-step union-find over net indices; control U →
     add the contact terminals' nets to a `forceU` list (join nothing).
   - Resolve **per root**: bucket contributions by `find(net)`, run the
     existing `resolveNet` once per root over the pooled contributions, write
     the result to every member net's `next`; then overwrite every group
     containing a `forceU` terminal to U.
   - A conflict in a merged group flags **every member net's conductors** red
     and names two drivers as usual (FR-082).
   - When the design has no pass entities, skip all of this — resolution runs
     per net exactly as today (zero cost for ordinary designs).
   - Do not touch quiescence detection, the settle bound, `valueOfPin`,
     `deriveColumns`, or the vector runner — they must work unchanged.
4. **`web/js/engine/cgen.js`** — `generateC` fails (a refusal, not a warning)
   on any tgate/relay instance: message names the offending refdes(es) and
   says the element is "not supported by the fast simulator" (FR-116). The
   Generate C… flow already posts generator failures to the message tray.
5. **`web/js/engine/ndl.js`** — add `tgate`/`relay` to the virtual built-ins
   comment lines, naming the control pin's net and the contact terminals'
   nets (e.g. `# virtual: A-4 (tgate) EN=…, A=…, B=…`). Keep output
   deterministic.

## Tests (required — design §11.1 is the authoritative list)

Add `node:test` unit tests under `web/js/` (existing `.test.js` conventions).
Cover at minimum, from the §11.1 "JS `sim` switch elements" bullet:
- TG closed: driver on A observed at B (and symmetric). Open: far side Z.
- **No-charge-latch regression**: close, drive, then release the driver —
  both sides read Z on the next step (this is the bug the rejected model has).
- Chain of two closed gates joins three nets; opening the middle splits them.
- Weak pull through a closed contact: still weak (loses to a far-side strong
  0; decides the group when all strong drivers are Z).
- Strong 0 vs strong 1 across a closed switch → conflict: U, all member
  conductors flagged, two drivers named.
- EN=U forces both terminal groups U; control is one unit delayed (a change
  joins/splits on the next step).
- Relay: COIL=0 → COM–NC joined / NO isolated; COIL=1 → COM–NO / NC isolated;
  COIL=U → all three groups U; SPST (throw unwired) works.
- Merge-feedback oscillator hits the 10,000-unit bound, reports once.
- A design with no switch elements resolves identically to before.
- `deriveColumns` yields no columns for switch elements; a vector run over a
  switch circuit scores per FR-115c.
- cgen: refusal test (message contains refdes + "not supported by the fast
  simulator").

Run **`./runtests.sh`** (repo root) — all three suites must pass, including
the parity step. Use `--quick` while iterating, full suite before you finish.
Do not add a switch-bearing design to `examples/` expecting parity coverage —
the generator refuses it; if you add one, verify `parity.js` reports it as
skipped, not failed.

## Constraints

- Vanilla ES modules, no build step; match surrounding code style exactly.
- Do NOT modify `docs/user.md` — user-visible docs wait until the user has
  manually verified the feature (CLAUDE.md rule).
- Do NOT commit or push unless the user asks.
- Temp files go in `/Users/jeff/tmp`, never `/tmp`.

## Definition of done

- All items 1–5 implemented per the cited spec sections; `./runtests.sh`
  fully green; new unit tests in place.
- Tell the user how to smoke-test manually, e.g.: place a tgate, wire an
  input switch → A, an indicator on B, a second input switch → EN; Run;
  toggle EN and observe B follow A when EN=1 and read `?` (Z) when EN=0.
  Similarly a relay: switch → COIL, indicators on NO/NC paths, observe the
  changeover.
