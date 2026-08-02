# Handoff: implement the tabbed docked panel area (FR-123)

You are acting as the **software architect** for `sim`, the TTL circuit design
editor in this repository. A requirements interview has just completed and the
specs have been updated; no code has been written yet. Your job is to take it
from specified to working.

Read `CLAUDE.md` first — its rules (specs are the source of truth, changelog
discipline, `./runtests.sh`, no branches, `/Users/jeff/tmp` for temp files, and
the rule about `docs/user.md`) govern everything below.

---

## 1. What was asked for

The editor's two docked bottom panels — the **test-vector panel** and the
**Console panel** — currently *stack* when both are open. They become **tabs in a
single tabbed bottom panel area**, so that future surfaces (a design rule
checker; see `drc.md`) are added as tabs rather than as more stacked panels.

## 2. What is already done

Committed to the specs (working tree, uncommitted at handoff time):

- **`specs/requirements.md`** — new **§3.27 / FR-123** (the tabbed panel area),
  plus in-place edits to **FR-004a, FR-115b, FR-115h, FR-115m, FR-115n,
  FR-122c**.
- **`specs/design.md`** — **§6.16a rewritten** ("the docked panel area — tabs,
  layout, and the divider"), plus edits to §2 (FR digest), §6.11 (store state and
  toolbar menus), §6.16, §6.20, §8 (two new decision rows), §9 (file plan), §10
  (traceability), §11 (unit-test list and manual-verification checklist).
- **`specs/CHANGELOG.md`** — one entry on top, dated 2026-08-02.
- **`drc.md`** — a note that FR-123 changes two of its parked assumptions (the
  DRC report should be a tab, not a dialog).

**Nothing under `web/` has been touched.** `docs/user.md` has deliberately *not*
been touched — per `CLAUDE.md` it is updated only after the user has manually
verified the feature.

## 3. Your job

1. **Validate the design in §6.16a against the actual code.** It was written from
   the specs and a reading of the modules, not from a full implementation pass.
   Where reality disagrees with it, **the design is what changes** — edit
   `specs/design.md` in place (and `requirements.md` if a *requirement* turns out
   to be wrong, which would need the user's agreement first), append a
   `CHANGELOG.md` line, and only then write code. Do not implement around a spec
   you believe is wrong.
2. **Implement it**, in the order `CLAUDE.md` prescribes.
3. **Test it.** `./runtests.sh` (or `--quick` while iterating) must pass. §11 of
   `design.md` lists the unit-test expectations added for this change: the
   collapsed one-fraction `dock` geometry, and the store's tab bookkeeping
   (`setTabOpen`, `setDockActive`, `markDockUnread`) as pure state transitions.
   `web/js/chrome/dock.test.js` currently tests the two-fraction stacking
   geometry that this change deletes — it needs rewriting, not patching around.
4. **Stop before `docs/user.md`** and hand back for manual verification. The
   manual-verification checklist in `design.md` §11 ("Tabbed panel area
   (FR-123)" and the reworked "Panel-area divider (FR-115n)") is written to be
   run by the user in the browser; use it to tell them what to check.

## 4. Decisions already made — do not re-litigate

These came out of the interview with the user and are now in FR-123. If one of
them turns out to be expensive to build, say so and ask; do not quietly choose
differently.

| Question | Decision |
|---|---|
| Tab lifecycle | Tabs open and close individually; the strip shows only open tabs, each with its own ✕; the area is absent entirely when no tab is open (never an empty strip). |
| Menu items | `Simulate ▸ Test Vectors` and `View ▸ Console` **open** a closed tab, **select** an open-but-background one, and **close** it only when it is already frontmost. |
| Test-vector read-only lock | Follows the **tab being open**, not visible. TV tab open behind the Console ⇒ design still read-only, held run still held. `isReadonly()` is unchanged. |
| Height | One divider above the tab strip, one session-remembered fraction shared by all tabs; default bottom third; tab switching never resizes. |
| Background activity | Unread dot on a non-frontmost tab that gains content; cleared on select; focus is **never** stolen. Console only (any byte appended while not frontmost, including before the tab was ever opened); the TV tab never marks. |
| Selection after close | Most-recently-used remaining tab. |
| Tab order | Order opened, appended right. |
| Tab labels | The kind ("Test Vectors", "Console"). The `.tv` filename and its `*` stay on the panel's own header row inside the tab. |
| Hidden tabs | Hidden, not discarded — rows, results, row selection, held run, console text, and scroll position all survive. |
| Persistence | Which tabs are open, which is frontmost, and the height are all session-only; a reload starts with no tab open. |
| Keyboard | Pointer selection only. No new shortcuts, no arrow-key tab cycling (the same restraint FR-115n takes toward resizing). |
| Scope | The container plus the two existing tabs. **No DRC tab now.** |

## 5. Code facts you will need

Verified at handoff:

- `web/index.html` — `#canvas-area` contains `#canvas-host`, then `#vec-panel`
  and `#console-panel` as siblings (both `hidden`). §6.16a moves the two panel
  hosts inside a new `#dock` (tab strip + `.dock-body`); the grip stays an
  absolutely-positioned child of `#canvas-area`.
- `web/js/app.js:394` — `const onTestVectors = () => (vecPanel.isOpen() ?
  vecPanel.close() : vecPanel.open());` — the plain toggle that FR-123 replaces
  with `dock.menuInvoke("vec")`. `createDock({ store })` is already constructed
  at `app.js:400`, after both panels exist; it now needs the panel handles.
- `web/js/store.js` — `setVectorPanelOpen` (feeds `isReadonly()`) and
  `setConsolePanelOpen` (deliberately does not). Both are to route through the
  new shared `setTabOpen` helper.
- `web/js/chrome/console.js` — `createConsolePanel({ store })` returns
  `{ write, clear, setOpen, isOpen }`; needs `requestClose()` added. Its rAF
  repaint is where the unread mark is raised (once per frame, never per byte).
- `web/js/chrome/dialogs.js` — `testVectorsPanel(...)` owns the guarded close
  (FR-115m). The dock must call *its* close path (`requestClose()`), never touch
  the open flag itself, so a cancelled close leaves the strip unchanged.
- `web/js/chrome/dock.js` + `dock.test.js` — currently the two-fraction stacking
  layout. `web/js/chrome/toolbar.js` — the View and Simulate menus.

## 6. Known loose ends

- **CSS for the strip** is described but not specified in detail (tab shape,
  selected/hover states, the unread dot, the ✕). Design it to match the existing
  chrome vocabulary in `web/css/style.css` — accent `#4a90d9`, the dialog/tray
  primitives, the `.vec-*` and `.console-*` classes — and note the colour rule in
  §6.16a about staying clear of the pass/fail result palette.
- **The panels' own ✕ controls** must be removed from `.vec-header` and
  `.console-header`; the tab's ✕ replaces them.
- **`dockMru` vs `dockOrder`** are separate lists on purpose (position vs
  selection history). Keep them consistent in one place — the store setters.
- **`drc.md`** stays a scratch document; its interview is paused at question 4
  and is not your task. Do not fold it into the specs.
