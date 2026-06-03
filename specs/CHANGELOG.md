# Changelog: TTL Circuit Design Editor

Chronological index of change requests. **History and rationale only** — this
file is *not* needed to determine current behavior. `requirements.md` and
`design.md` are the single source of truth for the system's intended state and
are always kept current.

Each entry records what was requested, when, why, and which requirement IDs and
design sections it touched. Newest entries at the top.

## Format

```
## YYYY-MM-DD — Short title
What: one-line description of the change requested.
Why: rationale (optional if obvious).
Touches: FR-0xx, FR-0yy; design §6.x, §8
```

---

## 2026-06-03 — Establish changelog process
What: Added this CHANGELOG and a header note to `requirements.md` and
`design.md` declaring them the single source of truth and this file a
history-only index. Added `sim/CLAUDE.md` documenting the change-tracking
workflow for future sessions.
Why: Set up a change-tracking process before a series of upcoming changes.
Touches: requirements.md (header), design.md (header), CLAUDE.md (new)
