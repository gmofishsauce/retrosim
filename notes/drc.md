# Design Rule Checker — requirements working notes

**Status:** interview **complete** (2026-08-02), pending the residual items in §7.
This is a scratch/working document, *not* a spec. Nothing here has been written
into `specs/requirements.md` or `specs/design.md` yet. The decisions below get
folded into the specs per the `CLAUDE.md` workflow (edit FRs/design sections in
place, append a `CHANGELOG.md` line, then implement). §8 lists the anticipated
spec impact.

**History:** paused at question 4 (navigating from a finding to the offending
object) while the user made an unrelated change expected to simplify it. That
change landed as FR-123 — the docked bottom panels (test vectors, Console) are
now **tabs of one docked panel area** (`specs/requirements.md` FR-123,
`design.md` §6.16a), explicitly so a further surface becomes another tab. The
interview resumed from there and ran to completion.

---

## 1. The ask, in the user's words

Add a design rule checker to the editor. It checks for the kinds of mistakes
humans typically make: undriven inputs, non-bussed (control) inputs driven from
3-state drivers, bus drivers enabled by the same signal, output fights, and
whatever else the interview turns up. The **Simulate** menu is renamed **Tools**
and the checker goes in it. It runs in the foreground and produces a report.

*Two elements of the original phrasing did not survive the interview, both
deliberately:* the report is a **tab**, not a dialog box (D12), and the check
does **not** require a saved design (D2, revised).

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
  editing-time checking out of scope and bring on-demand DRC in.
- The bullet already anticipates this: pin `direction` was captured (FR-062a)
  precisely so this could be added later **without a model change**. That
  prediction held — every rule agreed below is computable from the existing
  model.

Supersession should be noted in the `design.md` §8 style. Per D24 the rewritten
bullet keeps the word *ERC* only where it names the thing still excluded
(editing-time checking); everything being added is *DRC*.

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
into theorem-proving. Decision D3 draws the line deliberately.

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

### D2 — **No save requirement** *(revised 2026-08-02; supersedes the original D2)*
The check reads the **live in-memory design, unsaved edits included**. There is
no save prompt and no cancellation path.

*Rationale:* this matches the established policy of every other artifact-
producing item in the editor — FR-119 (Export…) says outright that it exports
"the live in-memory design (unsaved edits included)", and FR-116 (Generate C…)
is "read-only with respect to the design (it never mutates it, marks it
modified…)". Save-first would have made the DRC the only item in that menu
demanding a save.

*What the original D2 said:* the check ran on a saved design; a dirty design
prompted to save and **declining cancelled the check**, so that a finding could
be cited against a real file on disk. Its own note conceded this was "a
deliberate policy choice, not a technical necessity" — the netlist is built from
the in-memory model either way.

*Why it was reversed.* Three things changed under it after it was taken:
1. **The fix loop.** As a modal dialog run once, one save prompt cost nothing.
   As a modeless tab (D12) whose whole purpose is read → fix → re-run, every
   iteration hits a save prompt — and the fix is what dirtied the design.
2. **`designRev` does the real job.** The rationale was that a finding should
   cite a known artifact. The stale banner (D14) anchors the report to an exact
   design revision, which is *more* precise than "some file was on disk at check
   time" — that file can be overwritten five minutes later.
3. **Waivers dirty the design** (D17/D18). Run → waive → dirty → re-run → save
   prompt, caused entirely by the checker's own feature.

*Consequence:* the purge-timing problem (what to do when a check auto-purges
waivers from a design just saved to satisfy the check) disappears entirely —
see D20.
*Rejected:* keeping the original rule; a soft prompt that still runs when
declined (a prompt on every re-run that the user learns to dismiss — the worst
of both); silent auto-save (a menu item that writes your file without asking,
unlike every other read-only item in the menu).

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

*Resolved:* a port whose `target` (FR-101) does not resolve is now its own
finding — see R10 and D5a.

### D5a — Unresolvable port targets are reported, at info level
A port carrying a `target` (FR-101) naming a file that does not resolve is
reported as R10, **info**. The DRC becomes the one place to look before a
review: a broken off-sheet link means the circuit is not what the schematic
appears to show.

*Note:* FR-099a already reports a broken **sub-design** link through the message
tray. The two coexist deliberately — the tray message is transient, the report
persists, and R10 covers ports (FR-101) rather than sub-design instances.
*Rejected:* out of scope (leaves the pre-flight check blind to the one defect
most likely to invalidate everything else in the report); warning severity (an
unresolved link is a project-file problem, not an electrical one).

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
Confirmed as a feature; detailed in D15.

### D11 — Menu rename
**Simulate** → **Tools**, with the checker added to it. Existing items (Test
Vectors…, Generate C…) stay. "Simulate" was already a poor fit for "Generate C…".

### D12 — The report is a **tab**, not a dialog, and imposes no lock
The report is a tab of the docked panel area (FR-123), a peer of the test-vector
and Console tabs. It imposes **no** read-only editing lock — it is a pure output
view like the Console, not a locking surface like the test-vector tab used to be.

*Rationale:* a tab is modeless, so the report stays open while the user fixes the
design and re-runs — which is the whole point of a checker, and what a modal
dialog cannot do. It also makes D13 (navigate from finding to object) an ordinary
selection command against a visible canvas. Locking would force close-fix-reopen-
rerun on every finding.
*Cost:* one `TABS` row in `dock.js`, one host element, one store open flag. The
strip, height, divider, MRU selection, and unread marking come free from §6.16a.
*Consequence:* the report can go stale as the design changes — see D14. This is
the same trade FR-115h took for the test-vector tab, and in the same direction.
*Rejected:* the dialog box of the original ask; a read-only lock.

### D13 — Clicking a finding selects **and reveals** its objects
Clicking a finding selects every object the finding names — R1 selects both
fighting pins' instances, R5 both pulls — and then pans **and zooms** the view so
their combined bounding box fills the viewport (~90%), with the zoom clamped so a
single pin does not magnify absurdly. This happens on every click, whether or not
the objects were already visible.

*Model basis:* `interaction.js` already has `designBBox` and `centerViewportOn`,
and `fitToScreen` (FR-022a) is the same arithmetic against the whole design; the
reveal is that arithmetic against a smaller box plus a zoom clamp.
*Rejected:* text-only report (no coupling to the canvas, but the user hunts for
every object by hand); select-only (an off-screen object makes the click appear to
do nothing); pan-without-zoom and pan-only-when-off-screen (less disruptive, but
a finding on a two-pin net in a large design lands you centered at a zoom where
you still cannot see which pins are meant).

### D14 — A stale report is **marked**, not cleared
The report records `store.state.designRev` at check time. On any subsequent design
mutation it shows a visible "stale — the design has changed since this check"
banner, and keeps every finding, clickable, until the next run.

*Model basis:* `state.designRev` already exists (added for FR-115h's live
columns), bumped by `dispatch`, `undo`, `redo`, `applyLive`, and `replaceDesign`.
The report needs no new store state — record the value, compare on notify.
*Rejected:* clearing on the first edit (destroys the work list mid-fix — you fix
one finding and lose the other nine); auto re-running on every change (re-checks
on every keystroke-scale command); doing nothing (the user chases findings they
already fixed).

### D15 — Three severity levels; no summary verdict
**error**, **warning**, **info**. The report orders by them (D22) and colours by
them, and nothing else acts on them: there is no "check passed / failed" verdict
line, and no severity gates anything.

*Rejected:* two levels (loses the FYI category that keeps R7/R8/R9 tolerable
against the §6 noise budget); a pass/fail verdict (with waivers and info-level
rules in play, any single verdict would need a rule about which severities count,
and nothing consumes the answer).

### D16 — MVP is the whole rule catalog
All of R1–R10 ship in the first version. Once the check framework, the report tab,
and the finding→object navigation exist, each rule is a small pure function over
the netlist; R2 is the only one reaching past `buildNets` (into compiled GALasm
enable terms, §6.13).

*Rejected:* deferring R2 (the tier-2 rule, and the one the user named explicitly
in the original ask); deferring the info-level rules.

### D17 — Waivers are persisted, **in the design file**
A finding can be waived; waivers survive across runs and sessions, stored in the
design as a top-level `drcWaivers` array.

*No format version bump is required.* `serializeDesign` already writes
additive-optional fields (`primaryClock`, `defaultRender`) only when present, so
an absent `drcWaivers` simply means "no waivers" and every existing file loads
unchanged. No entry in `MIGRATIONS`.
*Rationale for the design file over a sidecar:* waivers travel with the design
automatically — one file to copy, rename, or duplicate (FR-121f), and no
association logic of the kind `.tv` needed (FR-115a/FR-115m).
*Cost accepted:* waiving is therefore a design mutation — see D18 and D20.
*Rejected:* a `<base>.drc` sidecar on the `.tv` precedent (never dirties the
design, but adds a second file that every copy/rename/duplicate path must carry);
a project-level waiver file (refdes are unique only *within* a design, so every
key would need a design-name qualifier, and the file becomes shared mutable state
across peer sheets).

### D17a — Waiver identity is rule id + object refs
A waiver matches a finding when the rule id matches and the finding's **object
refs** match as a set. Refs are `refdes` (`U12`), `refdes.pin` (`U5C.A`), or
conductor endpoint (`W7:end1`) — the exact same ref list that drives D13's
select-and-reveal, so the two features share one notion of "what this finding is
about".

*Why this is stable:* `refdes` is the **immutable internal identity** and is
**never reused** within a design (FR-011/FR-011c) — the same guarantee that lets
`.tv` files bind columns by refdes+pin. A waiver can therefore never silently
re-bind to an unrelated component.
*The exception:* **nets have no persistent identity** — they are derived by
`buildNets` on every run, and their display names come from `pickName`
(FR-037b/FR-060a), which changes when a label moves. Net-scoped findings (R4, R5,
R9) must therefore key on their **pin set**, not on a net name.
*Residual risk:* wire/bus internal ids are monotonic in normal operation but,
unlike refdes, are captured and restored by the FR-024a failure rollback, so R7
waivers are marginally less stable than the rest. Acceptable — R7 is info-level.

### D18 — Waiving dirties the design but is **not** undoable
Waive and un-waive go through the store's existing `applyLive` path (the precedent
is the FR-087a switch click): the design is marked dirty and subscribers notified,
but nothing enters the undo/redo stacks.

*Rationale:* a waiver is report bookkeeping, not circuit structure. Ctrl+Z after
waiving should undo your last wire, not your last waiver. Un-waive is the inverse
control and it sits right there in the waived section (D19).
*Rejected:* real `WaiveFinding`/`UnwaiveFinding` commands through `dispatch`
(consistent with "every design mutation is undoable", but interleaves report
bookkeeping with circuit edits in one history, so undoing back past a waive
replays waivers en route).

### D19 — Waived findings live in a collapsed "Waived (N)" section
Waived findings drop out of the main list into a collapsed section at the bottom
of the report. Expanding shows them greyed, each with an un-waive control and its
note (D21).

*Rationale:* the main list stays clean (the point of waiving), nothing becomes
invisible, and un-waive is discoverable in the one place a user would look for it.
*Rejected:* hidden with only a count (least discoverable un-waive); inline and
greyed (the noise the waiver was meant to remove still occupies the list).

### D20 — Unmatched waivers are dropped silently, without dirtying
A waiver that matches no finding in a run — its object was deleted — is dropped
from the in-memory design as the check runs. The drop sets **no** dirty flag and
raises no notification; the dead entries leave the file the next time the user
saves for any other reason. If the user never saves again they stay in the file,
harmlessly.

*Rationale:* a pure read of the design must not mark it modified — the same
property FR-116 and FR-119 assert for Generate C and Export. Self-cleaning without
a spurious modified flag.
*Accepted risk:* delete a gate, run the check, undo the delete — the waiver is
gone (though only from memory until the next save).
*Rejected:* dirtying when anything was dropped (honest, and harmless now that D2
no longer prompts, but "running a check modified my design" is a surprise);
keeping unmatched waivers forever (the file accumulates dead entries nothing
surfaces); surfacing a purge count with a manual purge control (a UI affordance
for a problem that self-heals).

### D21 — A waiver carries an optional free-text note
Waiving prompts for an optional note ("tied high on the board", "spare gate,
intentional"), stored with the waiver and shown in the waived section.

*Rationale:* costs one small prompt and one field; pays off months later when the
user rereads their own report and cannot remember why a finding was accepted.
*Rejected:* a bare one-click waive.

### D22 — Report layout: flat list, severity order
One row per finding, ordered **error → warning → info**, then stably by refdes /
net name within a severity. Each row carries the severity, the rule id, and a
human-readable message naming the objects (`Output fight on net DATA0: U3.Q0
(out) vs U7.Y2 (out)`).

*Rationale:* reads as a work list top to bottom; simplest to render and to click.
*Rejected:* grouping by rule with collapsible sections (better noise control —
"twelve undriven inputs" collapses to one line — but waivers (D17) are now the
noise mechanism, and grouping fights the severity ordering); grouping by object (a
net-vs-component grouping must pick one heading kind or interleave two).

### D23 — Report actions: copy to clipboard only
One button copies the whole report as plain text (severity, rule id, message per
line) via `navigator.clipboard.writeText` over the text the panel already renders.

*Rejected:* also saving `<base>.drc.txt` through the file-save endpoint (a durable
artifact you can diff between runs, but a second document lifecycle for a view
that is regenerated in milliseconds); no actions at all.

### D24 — Terminology: **DRC**, "design rule check"
The menu item is **Design Rule Check**, the tab is **Design Rules**, and the FR
text and design sections say DRC throughout. The word **ERC** survives only in the
rewritten §4.1 bullet, naming the editing-time checking that stays out of scope
(§2).

*Rationale:* R7 (dangling ends), R8 (stray component), and R10 (unresolvable
target) are drawing and project-integrity defects, not electrical ones; "electrical
rule check" would be wrong for a third of the catalog.

### D25 — The clean case opens the tab anyway
A run with zero findings opens/selects the DRC tab and shows "No findings" with
the design name and a timestamp.

*Rationale:* the tab is where check results live, whatever they are; an empty
result is itself information, and a check that sometimes opens nothing is a check
you cannot tell from a broken menu item.
*Rejected:* a status-bar (FR-073) or tray (FR-074) message with no tab; showing
the waived section on an otherwise-clean run (see §7 residual item 1).

### D26 — Scale: hundreds of components, so the check is plainly synchronous
The largest realistic design is ~100–1000 components. `buildNets` already runs at
that scale for every simulation, so the check is a single synchronous pass with
**no** progress indication, no chunking, and no worker.

*Consequence:* the real constraint at that scale is report **noise** (§6), not CPU
time — which is why the waiver mechanism (D17) is in the first version.

### D27 — Disabled during a run
The Design Rule Check menu item is disabled while a simulation runs and while a
test-vector run is held, exactly as Generate C (FR-116) and Export (FR-119) are.

*Rationale:* one rule for the whole menu, nothing new to explain. It also sidesteps
the fact that waiving is a design mutation (D18), which `isReadonly()` would block
while simulating — no need for a second rule disabling only the waive controls.
*Rejected:* leaving the check available because it only reads (would require
disabling waive/un-waive independently).

---

## 5. Agreed rule catalog

Provisional ids — these are working labels for this document, not FR numbers.
"Model basis" records what the rule reads, to confirm each is computable today.
All ten ship in the first version (D16).

| Id | Rule | Severity | Model basis |
|---|---|---|---|
| R1 | Output fight: two drivers on one net per the D6 table | error | `buildNets` + `pins[].dir` |
| R2 | Same-enable contention: ≥2 tri-state drivers on one net with identical enable net and polarity (D3) | error | compiled GALasm `.T` `enable` term (§6.13) |
| R3 | Undriven input: an input pin with no driver on its net, including a pin on no net at all (D7) | warning | `buildNets` + `pins[].dir` |
| R4 | Can-float net: 1-bit net, all strong drivers tri-state, no pull (D4/D4a) | warning | `buildNets` + `pins[].dir` + pull built-ins (§6.11) |
| R5 | Opposing pulls: a pull-up and a pull-down on the same net | warning | pull built-ins on a net |
| R6 | Unconnected outputs, only where **no** output of the package is used (D8) | warning | `buildNets` + package grouping (FR-013a) |
| R7 | Dangling conductor ends: a wire or bus endpoint free in space | info | free vertices (FR-018a permits these) |
| R8 | Stray component: a placed component with zero connections on any pin | info | `buildNets`; suppressed for spare units per D9 |
| R9 | No loads: a net with ≥1 driver and **zero** input pins — driving nothing | info | `buildNets` + `pins[].dir` |
| R10 | Unresolvable port target: a port whose `target` (FR-101) names a file that does not resolve (D5a) | info | `inst.target` + a file-existence probe |

**R2's applicability.** R2 is the only rule reaching past the netlist. It applies
only where both drivers have compiled GALasm behavior with an `enable` term;
built-ins (§6.11) and sub-design instances have none, so R2 is simply silent for
them rather than guessing.

**R9 vs R6** — these were originally answered in the same breath and R9 declined
with it; re-confirmed separately (2026-08-02) because R6 is pin-and-package based
while R9 is net based. R6 stays silent when an output *is* wired, so R9 is what
catches a wire to nowhere or a bus lane whose destination was deleted.

**R10 needs a file probe**, unlike every other rule. It is the one rule that
cannot be answered from the in-memory model alone — it needs `listDir` or an
equivalent existence check against the project directory. Its failure mode (probe
unavailable) must degrade to "not reported", never to a false finding.

### Rules considered and declined

| Rule | Why declined |
|---|---|
| Redundant pulls (two pull-ups on one net) | harmless in this model; duplication mistake at worst |
| Unused bus bits (a lane reaching no pin) | not selected |
| Excess fan-out (> N loads on a driver) | the YAML carries **no** drive-strength data, so this could only ever be a raw load count against an arbitrary threshold, not a real electrical check |
| Wire-vs-bus drawing-style rule | superseded by D4 |

---

## 6. Cross-cutting concern: report noise — resolved

Flagged during the interview and addressed in layers: rule narrowing (D4a, D8,
D9), severity levels (D15), and — the deciding mechanism — **persisted waivers**
(D17–D21). Real TTL designs legitimately contain spare gates, deliberately
dangling buses (FR-018a), and unused outputs; the waiver is what lets a user drive
a real design's report to zero once, and keep it there.

The cost the original notes flagged — "new persisted state in the design file" —
was raised explicitly and accepted (D17), and turned out cheaper than feared: an
additive-optional field, no format bump, no migration.

---

## 7. Residual items

The interview is otherwise complete. These are small and should be confirmed
before the specs are written.

1. **The clean case and waivers (from D25).** The user chose a plain "No findings"
   message and declined the variant that still shows the waived section on a clean
   run. Taken literally that means "No findings" can mean "no findings you have not
   already waived", with nothing on screen saying so. Confirm: is that intended, or
   should a clean run still show "Waived (N)"?
2. **User manual** — `docs/user.md` needs a DRC section, but only *after* manual
   verification, per `CLAUDE.md`.

### Settled by precedent (flagged, not asked)

Recorded here so the user can object; each follows an existing convention rather
than a new decision.

- **Menu item text:** "Design Rule Check", with **no** trailing ellipsis — the
  ellipsis convention marks an item that opens a dialog for further input, and this
  one runs immediately (D2 removed the only prompt it had).
- **Tab label:** "Design Rules" (the tab strip carries kind names, §6.16a).
- **Running the check opens and selects the DRC tab**, per the FR-123 open/select
  rule; a check run while the tab is backgrounded brings it to the front.
- **The check requires no project** — it reads the in-memory design only. (R10 is
  the exception: with no project directory there is nothing to probe against, so it
  degrades to "not reported".)
- **Staleness is `designRev`-based** (D14), needing no new store state.

---

## 8. Anticipated spec impact

For when the notes are folded into the specs — not yet actioned.

- `specs/design.md` §4.1 — rewrite the out-of-scope ERC bullet (§2, D24).
- `specs/requirements.md` — new subsection for the checker with new FRs covering:
  the Tools menu item and its disabled-during-run rule (D11, D27); the report tab
  (D12, extending FR-123); the rule catalog R1–R10 with severities (§5, D15); the
  finding→object select-and-reveal (D13); the stale banner (D14); waivers
  (D17–D21); report layout and copy action (D22, D23); the clean case (D25).
- `specs/requirements.md` — edit **FR-115b** and **FR-116** for the Simulate→Tools
  rename; edit **FR-004a**, whose menu enumeration names the **Simulate** menu and
  its items explicitly.
- `specs/requirements.md` — edit **FR-123** to name the DRC tab as a third tab kind
  (it already anticipates one: "a design-rule-check report, say").
- `specs/design.md` §6.16a — add the DRC row to the `TABS` registry, its host
  element, and its store open flag.
- `specs/design.md` §6.16/§6.17 — the Simulate→Tools rename in the chrome-wiring
  prose.
- `specs/design.md` §6.6 — note the netlist as the checker's input.
- `specs/design.md` §6.13 — note the compiled GALasm `enable` term as R2's input.
- `specs/design.md` §7.2/§7.4 — the `drcWaivers` additive-optional field (D17); state
  explicitly that no `MIGRATIONS` entry is needed.
- `specs/design.md` §8 — decision-table rows for: report-as-tab over dialog (D12),
  waivers in the design file over a sidecar (D17), non-undoable waiving (D18), and
  the D2 reversal.
- `specs/design.md` §10 — traceability rows for the new FRs.
- `specs/CHANGELOG.md` — one line naming the touched FR ids and design sections.
- `web/js/chrome/toolbar.js` — `createMenu("Simulate")` → `"Tools"`.
- `docs/user.md` — after manual verification only.
