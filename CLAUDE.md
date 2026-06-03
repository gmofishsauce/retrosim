# sim — TTL Circuit Design Editor

A localhost-only schematic editor: JavaScript single-page app (`web/`) plus a
small Go server (`cmd/`, `server/`). See `specs/` for full context.

## Specs and change tracking (read this before changing anything)

`specs/requirements.md` and `specs/design.md` together are the **single source
of truth** for the system's intended state. They are kept current.

`specs/CHANGELOG.md` is a **chronological, history-only index** of change
requests. It is *not* needed to determine current behavior — never reconstruct
current state by replaying it.

For every change request, in order:
1. Edit the affected requirement(s) / design section(s) **in place** so the
   specs stay current. Additive change → add a new suffixed FR (e.g. FR-018a),
   never renumber. Rework → edit the FR/section text and note what it supersedes
   (see design.md §8 for the existing supersession style).
2. Append a one-line entry to `specs/CHANGELOG.md` naming the touched FR IDs and
   design sections (newest on top).
3. Then implement the code change.

If the specs and code disagree, the specs win — stop and flag the discrepancy.
