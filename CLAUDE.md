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

## User manual

`docs/user.md` is the end-user manual. Whenever a change adds or alters a
**user-visible** feature, update `docs/user.md` to match — but only **after the
user has manually verified** the feature works. Do not document a feature there
before that verification (the specs, not the manual, are the pre-verification
record). When in doubt whether something is user-visible, ask.

## Temp files

Always use `~/tmp` for temporary files (set `CLAUDE_CODE_TMPDIR` and any
`--tmp`/`TMPDIR` paths there); create it with `mkdir -p ~/tmp` if it does not
exist. Never use `/tmp` — it fills up constantly.

**If Bash output is lost with a bogus `ENOSPC`/"temp filesystem is full" error**
(see claude-code issue #63909): the task runner's stdout capture has wedged for
the session even though the disk has space. Direct shell writes still work, so
route around it — `cmd > ~/tmp/out.txt 2>&1` and read the file back
with the Read tool. The condition is sticky per conversation; a fresh
conversation clears it.

## Git

Single-contributor repo; GitHub is just a backup. **Never create branches** —
commit directly to `main`. Do not push; the user pushes manually.
