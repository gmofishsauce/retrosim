# KiCad-User Confusion Analysis: Project Support Design

An assessment (2026-07-12) of whether the proposed project-support design
(pre-spec decision record, this conversation) will confuse users whose mental
model comes from KiCad — the closest tool the app's audience (retro TTL
hobbyists) is likely to know.

**Short answer: no — the design is structurally close to KiCad's project
model — but there are five divergences worth examining, two of which warrant
action.**

## Where the design matches KiCad expectations (no confusion)

- **Project = a directory with a project file in it.** KiCad:
  `<name>.kicad_pro` in a folder. Us: `<name>-manifest.json` in a folder.
  Same shape.
- **Project-first workflow.** KiCad won't let you meaningfully edit a
  schematic without a project; New Project creates the folder and seed files
  in one gesture. Our "project first, always" is exactly this — a KiCad user
  will find it *more* natural than the current scratch-canvas flow.
- **Global vs. project libraries.** KiCad has global symbol libraries plus
  project-local ones registered in the project directory. Our global scope +
  `<project>/components/` (Phase 2) is the same two-tier model. This is the
  strongest alignment — the feature that motivated all this is precisely the
  part a KiCad user already understands.
- **Duplicate Project.** KiCad's project-manager "Save As" copies the whole
  project directory. Our Duplicate Project is the same operation under a
  clearer name.
- **Flat layout.** KiCad hierarchical sheets are loose `.kicad_sch` files
  sitting flat in the project folder next to the root — our flat-root,
  peers-and-children-in-folder rule matches what they've seen.

## The divergences

### 1. KiCad users open projects by picking the project *file*, not the folder

Double-clicking `foo.kicad_pro` *is* "open project" to them. Our Open Project
picks a directory. Cheap fix: let the Open Project dialog accept **either** a
folder or a `*-manifest.json` file (and, as already decided, any design
file). One sentence in the FR; removes the most likely first-session stumble.

### 2. In KiCad, a project has *one* root schematic, named after the project

Our project root can hold several unrelated top-level designs plus peer
sheets plus embeddable children, all as indistinguishable `.json` files. A
KiCad user opening the folder may wonder "which one is *the* design, and
which are sub-sheets?" The manifest's **main design** field already answers
the first half — Open Project goes straight to it, KiCad-style. The second
half (design vs. sub-sheet at a glance) has no cheap fix and should be
accepted; it's inherent to the more flexible model, and the breadcrumb /
back-stack makes the relationship visible once navigating.

### 3. Shared absolute RAM save-file paths after Duplicate Project

**This is the one real footgun.** A KiCad user's firm expectation is that a
duplicated/archived project is **self-contained** — KiCad even has path
variables specifically for portability. Under "loose for data," a duplicated
project's RAM instances still point at the *original's* absolute save file:
run the copy, and it silently overwrites the original project's RAM data.
That will genuinely surprise anyone, KiCad experience or not.

- Minimum fix: Duplicate Project **reports** (message tray) every absolute
  ROM/RAM path the copy still shares with the original.
- Better fix (bends "loose for data" slightly): paths *inside* the project
  directory are stored project-relative (so Duplicate rewrites nothing but
  the copies just work); absolute paths outside remain legal and are warned
  about at duplicate time.

### 4. Library edits requiring a server restart (global scope)

KiCad picks up library changes on the fly. Ours already surprises no one
*today*, and Phase 2's stateless project scope actually behaves the KiCad
way. No action.

### 5. `-manifest.json` naming

KiCad's project file extension makes it obviously "not a schematic." Ours
relies on the name pattern plus dialog filtering. Adequate — the tolerant
recognition rule (any single `*-manifest.json` at the project root; prefix
need not track a folder rename) covers the failure modes. No action.

## Recommendation

Fold two adjustments into the decision record before writing the spec:

1. **Open Project accepts folder, manifest file, or design file** (all
   resolve to the containing folder as the project).
2. **Duplicate Project handles data paths**: at minimum, warn about shared
   absolute ROM/RAM paths; optionally, store within-project data paths
   project-relative so duplicates are self-contained.

Everything else in the design either matches KiCad or diverges in a direction
that's more flexible rather than more confusing.
