# Composite components: the nesting problem and a way out

**Status: discussion only.** Nothing here has been agreed, and no requirement or
design section has been changed. If a direction is chosen, it starts as an edit
to `specs/requirements.md` and `specs/design.md` per the process in `CLAUDE.md`
— this file is background, not a record of intended behavior.

Written 2026-08-06.

---

## 1. The observation

A component definition (a YAML file in the component library) cannot reference
other components as subcomponents. It looks as though supporting that would
force component directories to nest — a component's children living in a
`components/` subdirectory *inside* the component, whose children need their own
`components/`, without end. That regress is unacceptable, so the feature looks
blocked.

The conclusion is right that the regress must not be built. The premise is
worth examining, though: **the regress comes from naming children by path, not
from composition itself.** The rest of this note works through why, and what to
do instead.

## 2. How the system composes things today

Two tiers exist, and they resolve references in completely different ways.

### 2.1 Component types — leaves, resolved by id

A component type (`ComponentType`, `srv/server/types.go`) is a **leaf** by
construction. Its YAML carries pin geometry, pin groups, propagation delays,
GALasm behavior text, an optional clock pin, buried internal nodes, an optional
`mem` block for generated memory devices, and presentation-only documentation.
There is no field by which one type names another. There never has been.

Types live in two flat directories and are merged into one namespace keyed by
**`id`** (FR-002, FR-121i):

| Tier | Location | Loaded |
|---|---|---|
| Shared library | `--components-dir`, in practice `srv/components/` | once at server startup (`LoadLibrary`) |
| Project-local | `<project>/components/` | when the project becomes current, and on Refresh Types (`ScanProjectComponents`) |

Project-local types layer *over* the shared library, so a project can shadow a
shared part by id. Only top-level `.yaml` files are read in either tier —
subdirectories are skipped. The create endpoint (FR-007a) refuses an id or
filename that collides in either tier, so the merged namespace stays
unambiguous.

The important property: **a type never says where another type lives.** It
couldn't, because it never names another type at all. Everything is resolved by
id against a flat namespace assembled by the resolver.

### 2.2 Designs — composites, resolved by relative path

Composition is not missing from the system. It lives one tier up, in designs.

A **sub-design instance** (FR-098) embeds a separately-saved design into a
parent design as a single component. It stores a path to the child design file
— relative to the parent's directory on disk, absolute in memory — plus a
render style. It stores no copy of the child: the reference is live, and the
child's **interface** is re-derived on every load from the child's ports
(FR-095), each distinct 1-wide port label contributing one interface pin and
each multi-bit port a pin group. The instance draws as an IC rectangle or a
connector strip (FR-096).

The design.md §8 decision row for the FR-094–FR-103 group records this as a
deliberate choice: the child's derived interface is presented to the rest of the
system as a *synthetic in-memory `ComponentType`*, which is why the whole
pin/vertex/wire/netlist/render pipeline serves hierarchy unchanged. Only render
style, navigation, and flatten-at-Run are new machinery. Two other §8 rows name
"compose as a sub-design of primitive built-ins" as the standing escape hatch
for behavior GALasm cannot express.

So a sub-design already **is** a component built from other components. It is
just not a *library* object:

- its reference is a **path**, not an id;
- the path must resolve **inside the current project directory** (FR-121d) —
  the embed dialog refuses a child outside it, though a legacy design carrying
  such a reference still loads and simulates with a warning;
- the project layout is **flat** (FR-121): designs sit at the project root, and
  designs inside subdirectories — along with nested projects — are explicitly
  out of scope;
- it is placed by picking a **file** through the ADD dialog (FR-097a), not by
  clicking a **tile** in the palette.

## 3. Where the regress actually comes from

Put the two tiers side by side and the asymmetry is the whole story.

A component type says, in effect, *"my children are named `74163` and
`7474`"* — except it says nothing at all, because it has no children. If it
did, those names would be **ids**, and ids resolve against a namespace the
resolver assembles: shared library ∪ current project. Nothing about that
requires a directory to contain anything. A flat directory of composites, each
naming its children by id, resolves perfectly well with zero nesting.

A sub-design says *"my child is the file `./alu.json`"*. That is a **location**.
The moment you try to move a path-referenced composite into `components/`, its
children have to be found somewhere relative to it — and the only place that
generalizes is a `components/` inside the component. That is the regress, and it
is caused entirely by the reference being a path.

So the real question is not "can components have subcomponents?" — they could,
by id, without nesting. The real question is:

> **Why do composites use paths?** Because they are *designs*, and designs are
> project-local files. Which means the actual missing capability is not
> composition. It is **reuse of a composite outside the project that defines
> it.**

That is the thing that hurts. Today, to use a block you built in project A
inside project B, you copy the file by hand and hope you also copied whatever it
depends on.

## 4. The trade being made

There is a genuine tension, and it is worth stating plainly because every option
below is a position on it:

- **Path-referenced composites are self-contained.** The child is right there,
  at a known location relative to the parent. Copy the project and everything
  comes with it — which is exactly why Duplicate Project (FR-121f) can promise a
  self-contained copy, warning only about absolute *data* paths that escape.
- **Id-referenced composites are not self-contained.** They have a **dependency
  closure** — the set of types and blocks they reference, transitively — that
  must be present wherever they are used. Nothing in the file says where those
  dependencies come from.

Self-containment is what the nesting scheme was reaching for. The cost of
getting it by nesting is the infinite regress. The cost of giving it up is
managing a dependency closure.

**Give it up.** Every serious EDA tool makes this trade in the same direction:
KiCad symbol and footprint libraries are flat, resolved by `nickname:name`
through a library table, with dependency management handled by an explicit
"copy to project" step — never by nesting libraries inside libraries. The
closure is a real cost, but it is a *bounded* one, and it buys a namespace that
stays flat forever.

## 5. Options

### Option A — do nothing; composites stay project-local

Reuse remains a manual file copy. Cheap, and honest about what the system does
today. Fails exactly when a block becomes genuinely reusable, which is the point
at which someone reaches for this feature. Listed for completeness and as the
baseline the others are measured against.

### Option B — closure-aware import (recommended first step)

Add `File ▸ Import Block…`: pick a design file in *another* project; the app
copies it into the current project along with its **dependency closure** —
the child designs it embeds, transitively, plus any project-local
`components/*.yaml` referenced by instances in any of them — refusing on an id
or filename collision the way the create endpoint already does (FR-007a).

- **No new reference kind.** Copies land as ordinary project-root design files
  and ordinary `components/` entries. The save format is untouched, FR-121d is
  untouched, flatten and the C generator are untouched.
- **Reuse becomes a copy**, which is what a user would do by hand today — made
  safe, because the closure comes too.
- **Cost: drift.** A copy has no link to its source. Fix a bug in the original
  and the copies stay broken; there is no single source of truth.
- **Side benefit:** it forces the code to compute a dependency closure, which
  Option C needs anyway. Building B first is not wasted work if C follows.

### Option C — a flat shared block library, resolved by id

Introduce a shared **block** directory beside the shared component directory —
flat, holding design files, e.g. `srv/blocks/*.json` behind a `--blocks-dir`
flag — and let a sub-design instance store **either** a project-relative path
(as today) **or** a library reference such as `lib:<id>`.

The invariant that kills the regress, and the whole reason this works:

> **A library block may reference only other library blocks and library
> component types — never a project-relative path.**

That makes the block library a closed, flat, self-consistent namespace with
exactly the shape the component library already has. A block's children resolve
in the *resolver's* namespace, not inside the block's own folder, so no
directory ever needs to contain another. The rule is checkable at load and is
the thing a reviewer should look for first in any implementation.

What it costs — a second reference kind threaded through most of the hierarchy
machinery:

- the save format (FR-060b) grows a library-reference form beside the relative
  child path, with a migration;
- the embed dialog (FR-097a) gains a library-browse path beside file-picking;
- the project-boundary rule (FR-121d) needs an explicit exemption — a library
  reference is legally outside the project, which is currently the definition of
  a violation;
- cycle detection (FR-102a) must span both reference kinds, including a mixed
  cycle through a library block and back;
- flatten-at-Run, the DRC (FR-124), and the fast-C generator (FR-116/FR-117)
  each need to resolve the new kind;
- Duplicate Project (FR-121f) loses part of its self-containment guarantee and
  should probably warn about library dependencies the way it warns about
  absolute data paths.

That is a substantial change, and it should not be started on the strength of an
intuition that copies will drift.

### Option D — make component YAML itself composable

Give `ComponentType` an implementation section naming child **type ids** and the
connections among them. Since ids resolve flatly, this too has no directory
regress — worth noting, because it shows once more that nesting was never the
real constraint.

Reject it anyway:

- it builds a **second** composition mechanism alongside sub-designs, with
  different semantics, to be maintained in parallel;
- the implementation would be a hand-written netlist **in YAML**, with no
  schematic, no canvas, no visual review — for a schematic editor this is a
  strictly worse authoring surface than the one that already exists;
- the §8 hierarchy decision deliberately chose a *live reference* over an
  embedded copy, on the grounds that a copy creates a second source of truth;
  YAML composition walks that back.

If a composite ought to be library-installable, the answer is to make **designs**
library-installable (Option C), not to teach YAML to be a schematic.

## 6. Recommendation

1. **Do Option B now.** It is small, it is useful on its own, it changes no
   format and no boundary rule, and it produces the closure computation that any
   later work needs.
2. **Hold Option C** until copies have actually been observed to drift. If they
   do, the invariant in §5 is the design; the cost is the list beside it.
3. **Do not do Option D.**
4. **Never nest `components/`.** The original instinct is right, and the reason
   is worth recording: nesting is what you resort to when references are paths.
   Keep every library reference an **id** against a flat namespace and the
   question does not arise.

## 7. Open questions

Two things would change the shape of the work and are worth settling before any
of it is written up as requirements:

- **Cross-project reuse, or palette presence?** These are separable. Everything
  above addresses reuse — using a block from another project. A different
  complaint is that a composite is placed by picking a *file* through the ADD
  dialog rather than by clicking a *tile* in the palette like a 7400. That one
  is a much smaller change — give a design an optional library id and a palette
  tile — and it needs neither B nor C. If both are wanted, they should be
  separate FRs.
- **Does a library block need to be editable in place?** If yes, Option C needs
  a story for editing a design that lives outside any project, which collides
  with the project-first rule (FR-121c) — a design always belongs to a project.
  The cheapest answer is that library blocks are edited by opening the library
  as an ordinary project, which keeps FR-121c intact and costs nothing.
