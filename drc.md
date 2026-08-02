# Design Rule Checker — requirements working notes

**Status:** interview in progress. This is a scratch/working document, *not* a
spec. Nothing here has been written into `specs/requirements.md` or
`specs/design.md` yet. When the interview completes, the decisions below get
folded into the specs per the `CLAUDE.md` workflow (edit FRs/design sections in
place, append a `CHANGELOG.md` line, then implement).

**Paused at:** question 4 (navigating from a finding to the offending object on
the canvas). The user is making an unrelated change first that is expected to
simplify that problem. Resume at "Remaining interview topics" below.

**Update 2026-08-02 — that unrelated change landed in the specs (FR-123).** The
docked bottom panels (test vectors, Console) are now **tabs of one docked panel
area** (`specs/requirements.md` FR-123, `design.md` §6.16a), explicitly so that a
further surface becomes another tab. That changes two assumptions below:

- **The report should be a DRC *tab*, not a dialog box** (§1 says "a report
  displayed in a dialog box"). A tab is modeless, so the report can stay open
  while the user fixes the design and re-runs — which is what question 4
  (navigate from a finding to the object) needs, and what a modal dialog cannot
  do. Adding it costs a `TABS` row in `dock.js`, a host element, and a store open
  flag; the strip, height, divider, MRU selection, and unread marking come free.
- **Question 4 gets easier.** With the report in a modeless tab beside the
  schematic, "click a finding → select and reveal the offending object" is an
  ordinary selection command against a visible canvas, not a dialog that must be
  dismissed first. Decide whether the DRC tab imposes a read-only lock (like the
  test-vector tab, FR-115h) or is a pure output view (like the Console) — the
  latter looks right for a checker whose whole point is fixing what it finds, but
  note the report goes stale as the design changes and that needs a rule.

Nothing else in these notes is affected; the tier analysis and the rules below
stand.

---

## 1. The ask, in the user's words

Add a design rule checker to the editor. It runs on a **saved** design, so it
begins by prompting to save if the design has been edited. It checks for the
kinds of mistakes humans typically make: undriven inputs, non-bussed (control)
inputs driven from 3-state drivers, bus drivers enabled by the same signal,
output fights, and whatever else the interview turns up. The **Simulate** menu is
renamed **Tools** and the checker goes in it. It runs in the foreground and
produces a report displayed in a dialog box.

---

## 2. Collision with the existing specs (must be resolved)

`specs/design.md` §4.1 currently lists this as a **hard constraint**:

> Out of scope: **electrical-rule checking** (e.g., output-to-output conflicts,
> direction validation) as an *editing-time* check. Pin `direction` is captured
> (FR-062a) so ERC can be added later without a model change; the bus
> disambiguation dialog (FR-041b) does **not** filter candidates by direction
> (D2). (The simulator does detect bus conflicts at run time, FR-082.)

This work **reverses** that constraint, so the bullet must be edited in place
rather than worked around. Two things make that cheap:

- The constraint scopes itself to *editing-time* checking. An on-demand,
  user-invoked checker sits outside that wording. The rewrite should keep
  editing-time ERC out of scope and bring on-demand DRC in.
- The bullet already anticipates this: pin `direction` was captured (FR-062a)
  precisely so ERC could be added later **without a model change**. That
  prediction holds — every rule agreed below is computable from the existing
  model.

Supersession should be noted in the `design.md` §8 style.

---

## 3. How much of this is actually decidable

The requested checks are not one kind of thing. They fall into three tiers, and
keeping the tiers straight is the main design risk:

| Tier | Needs | Example | Exactness |
|---|---|---|---|
| Structural | `buildNets(design)` + `pins[].dir` | output fights, undriven inputs | exact |
| Behavioral | compiled GALasm `.T` enable expressions (§6.13) | two drivers with the same enable | exact only for simple enables |
| Dynamic | actual simulation over time | real contention | **already exists** as FR-082 |

The DRC is tiers 1 and 2. It must **not** duplicate tier 3 — the simulator
already reports run-time bus conflicts (red nets, `bus conflict: U3.Q0 vs
U7.B2`, FR-082). The DRC's value is catching what is structurally wrong
*before* a simulation is ever run.

The tier-2 cliff is real: two enables that reduce to the same net with the same
polarity is decidable; enables coming out of a decoder or through gating turns
into theorem-proving. Decision D6 below draws the line deliberately.

---

## 4. Decisions made

Each is stated with the reasoning, so a later reader can tell whether a changed
assumption invalidates it.

### D1 — Scope: top sheet only
The checker examines only the open design's own components and nets. Sub-design
instances (FR-098) are **not** expanded the way the simulator expands them
(§6.14), and off-sheet continuations (FR-101a) are not followed.

*Consequence:* a port is a sheet boundary, not a defect. See D5.
*Rejected:* full hierarchy expansion (one bad child floods the report, and it
would require every child file on disk to be current); a separate
expanded-checking mode (extra UI surface for a case not yet needed).

### D2 — Save-first: a declined save cancels the check
The checker runs on a saved design. If the design is dirty it prompts to save;
if the user declines, the check is **cancelled** and nothing runs.

*Rationale:* the report then always describes a file that exists on disk, so a
finding can be cited against a real artifact.
*Note:* technically the netlist is built from the in-memory model either way —
this is a deliberate policy choice, not a technical necessity.
*Rejected:* running on the in-memory design when the user declines; dropping the
save requirement entirely.

### D3 — Same-enable contention: same net, same enable, same polarity
Flag two or more tri-state outputs **on the same net** whose enable expressions
reduce to the **same net with the same polarity** — a guaranteed fight the
moment that signal asserts.

*Explicitly not an error:* two drivers sharing an enable while driving
*different* nets (a '245 pair sharing `/OE` is correct design).
*Rejected:* flagging enables that merely mention a common signal (would flag
one-hot decoder enables, i.e. the normal way to build a bus); flagging any two
drivers sharing an enable regardless of net.

### D4 — "Non-bussed control input" is reinterpreted as a can-float rule
The user's original phrasing was a *drawing-style* rule (a net drawn with wires
rather than a bus). It is replaced by an *electrical* rule: a net whose only
strong drivers are tri-state, with no pull-up or pull-down, has no defined level
when every driver is disabled.

This is polarity- and drawing-agnostic, and catches the real hazard.

**Narrowed (D4a):** report a can-float net **only when it is 1 bit wide**. A
floating multi-bit bus is normal TTL practice and would otherwise fire on
essentially every bus in every design; a floating lone control line is nearly
always a mistake.

*Rejected:* the literal wire-vs-bus drawing rule (would flag data signals drawn
as plain wires); flagging all can-float nets equally; flagging only when no
driver can *ever* enable (nearly zero false positives, but catches nearly
nothing).

### D5 — Ports are unconditional drivers and loads
Nothing touching a port (FR-094) is ever flagged as undriven or as load-less. A
port is presumed driven/consumed by the parent sheet.

*Still open:* whether a port whose `target` (FR-101) does not resolve to a real
file deserves a weaker, link-integrity finding. Not an electrical issue; see
open questions.

### D6 — Output fights
| Combination | Verdict |
|---|---|
| plain `out` + plain `out` | **fight** |
| plain `out` + `tristate` | **fight** (the tri-state can never win) |
| plain `out` + `bidir` | **fight** |
| `bidir` + `bidir` | **normal** — this is what a bidirectional bus looks like |

### D7 — Undriven inputs are one finding class, not two
A single "undriven input" finding covers both the pin that touches no conductor
at all and the pin that sits on a real net which nothing can drive. The user
explicitly described a completely unconnected spare gate's inputs as "undriven
inputs".

*Rejected:* splitting into "unconnected" and "undriven"; reporting only the
unconnected case.

### D8 — Unconnected outputs are judged per **package**, not per unit
"Don't flag unconnected outputs where at least one output is used" is evaluated
across the whole package. A 7400 places as four sibling instances `U5A`–`U5D`
sharing one package number (FR-013a); using any one gate silences the
unconnected-output finding for the spare gates.

*Consequence:* a partially-used counter (Q0–Q3 wired, Q4–Q7 bare) also stays
quiet, since one of its outputs is used.
*Consequence:* a package with **no** output used anywhere is still reported.

### D9 — A spare gate in a used package reports as undriven inputs
An entirely unconnected `U5C` in an otherwise-used 7400 is **not** a stray
component and **not** an unconnected-output finding. Its floating **inputs** are
what gets reported (D7), which is the genuine TTL hazard — unused inputs should
be tied to a defined level.

### D10 — Severity levels are wanted
Confirmed as a feature. The number of levels, their names, whether the report
sorts by them, and whether anything *acts* on them are still open.

### D11 — Menu rename
**Simulate** → **Tools**, with the checker added to it. Existing items (Test
Vectors…, Generate C…) stay. "Simulate" was already a poor fit for "Generate C…".

---

## 5. Agreed rule catalog

Provisional ids — these are working labels for this document, not FR numbers.
"Model basis" records what the rule reads, to confirm each is computable today.

| Id | Rule | Severity (tentative) | Model basis |
|---|---|---|---|
| R1 | Output fight: two drivers on one net per the D6 table | error | `buildNets` + `pins[].dir` |
| R2 | Same-enable contention: ≥2 tri-state drivers on one net with identical enable net and polarity (D3) | error | compiled GALasm `.T` `enable` term (§6.13) |
| R3 | Undriven input: an input pin with no driver on its net, including a pin on no net at all (D7) | warning | `buildNets` + `pins[].dir` |
| R4 | Can-float net: 1-bit net, all strong drivers tri-state, no pull (D4/D4a) | warning | `buildNets` + `pins[].dir` + pull built-ins (§6.11) |
| R5 | Opposing pulls: a pull-up and a pull-down on the same net | warning | pull built-ins on a net |
| R6 | Unconnected outputs, only where **no** output of the package is used (D8) | warning | `buildNets` + package grouping (FR-013a) |
| R7 | Dangling conductor ends: a wire or bus endpoint free in space | info | free vertices (FR-018a permits these) |
| R8 | Stray component: a placed component with zero connections on any pin | info | `buildNets`; suppressed for spare units per D9 |

### Rules considered and declined

| Rule | Why declined |
|---|---|
| Drivers with no loads (net has drivers, no input pins) | not selected; overlaps R6 at the pin level. **Worth re-confirming** — R6 is pin-and-package based while this is net based, and the two were answered in the same breath. |
| Redundant pulls (two pull-ups on one net) | harmless in this model; duplication mistake at worst |
| Unused bus bits (a lane reaching no pin) | not selected |
| Excess fan-out (> N loads on a driver) | the YAML carries **no** drive-strength data, so this could only ever be a raw load count against an arbitrary threshold, not a real electrical check |
| Wire-vs-bus drawing-style rule | superseded by D4 |

---

## 6. Cross-cutting concern: report noise

Flagged during the interview and partly addressed by D4a, D8, and D9, but not
fully settled. Real TTL designs legitimately contain spare gates, deliberately
dangling buses (FR-018a), and unused outputs. If the first run on a real design
produces forty findings, the report stops being read.

Mitigations chosen so far are all *rule narrowing* (D4a, D8, D9) plus severity
levels (D10). A suppression/waiver mechanism has **not** been discussed and
carries a real cost: it means new persisted state in the design file. To be
raised explicitly rather than defaulted into.

---

## 7. Remaining interview topics

Resume here.

1. **Navigation from a finding to the object** *(paused — user is making an
   unrelated change first that should simplify this)*. The ladder was: text only
   → clicking a finding selects the object on the canvas → clicking also scrolls
   and zooms it into view. The latter two want a non-modal dialog, which is a
   bigger change than a plain report box.
2. **Severity details** (D10 is agreed in principle): how many levels, their
   names, does the report sort or group by them, does anything act on them
   (e.g. a "check passed" verdict that ignores info-level findings).
3. **Report content and format:** what identifies a finding — `refdes.pin`, net
   name (`pickName`, FR-037b/FR-060a), rule id, human-readable message? Grouped
   by rule or by object? Ordered how?
4. **Report actions:** copy to clipboard? save to a file beside the design?
   Neither?
5. **The clean case:** what is shown when there are zero findings.
6. **Suppression/waivers** — see §6. Wanted at all? If so, persisted where?
7. **Unresolvable port `target`** (from D5): a link-integrity finding, or out of
   scope? Note FR-099a already reports a broken sub-design link via the message
   tray.
8. **Scale and performance:** largest realistic design; is a foreground check
   with no progress indication acceptable at that size?
9. **MVP scope:** which of R1–R8 must be in the first version, and which can
   follow.
10. **Terminology:** "design rule checker" vs "electrical rule check" — the
    specs currently say ERC (§4.1). Pick one term and use it consistently.
11. **User manual:** `docs/user.md` needs a section, but only *after* manual
    verification per `CLAUDE.md`.

---

## 8. Anticipated spec impact

For when the interview closes — not yet actioned.

- `specs/design.md` §4.1 — rewrite the out-of-scope ERC bullet (see §2).
- `specs/requirements.md` — new subsection for the checker with new FRs; edit
  FR-115b and FR-116 for the Simulate→Tools rename.
- `specs/design.md` §6.16/§6.17 — the same rename in the chrome-wiring prose.
- `specs/design.md` §6.6 — note the netlist as the checker's input, if the
  checker reads it directly.
- `specs/design.md` §10 — traceability rows for the new FRs.
- `specs/CHANGELOG.md` — one line naming the touched FR ids and design sections.
- `web/js/chrome/toolbar.js` — `createMenu("Simulate")` → `"Tools"`.
- `docs/user.md` — after manual verification only.
