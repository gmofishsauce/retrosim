// Docked, modeless design-notes editor (§6.23, FR-125/FR-125b) — the free-form
// prose a design carries about itself: why it is built this way, what is
// provisional, what the next change should be. Structurally the simplest of the
// docked panels (§6.16a): one <textarea> over one string, `design.notes`.
//
// The whole feature is that string. There is no notes *document*, no associated
// path, and no second modified flag — which is exactly why replacing the design
// REBINDS this tab rather than closing it (FR-125). The test-vector panel needs a
// guarded close because its `.tv` is a second document a replacement can leave
// pointing at the design it is no longer showing (FR-115m, OQ-002); notes have no
// existence apart from the design, so there is nothing left over to be wrong
// about, and `fileops.guardReplace` is deliberately not extended here.
//
// The one piece of state beyond that string is the `subject` (FR-125b): the pane
// can also *show* — read-only, never edit — the notes of a GAL part or a child
// design placed on the current sheet, reached by "View notes" on the component's
// context menu (FR-033b). A borrowed subject is session state: never saved, never
// restored, and dropped the moment its owner stops existing.
//
// The panel does NOT own its host's `hidden`: the dock does (FR-123), so an open
// Notes tab sitting behind the Console keeps its open flag. isOpen() therefore
// reads the flag, not the DOM.

// notesOf reads a design's notes as the empty string when absent — the value a
// textarea shows for "no notes". Pure, and the single place the `?? ""`
// normalization lives, so the sync comparison below and the store's own
// idempotence check cannot disagree about what "unset" means.
export function notesOf(design) {
  return design?.notes ?? "";
}

// needsSync reports whether the textarea should be overwritten with `text`.
//
// This predicate is the panel's one subtlety. The panel subscribes to the store,
// and the store notifies *because of* the keystroke the user just typed here — so
// a subscriber that blindly assigned `el.value` would reset the caret to the end
// on every character. Writing only when the two actually differ makes the write
// happen exactly when the change came from somewhere OTHER than this textarea (a
// design load, a replacement, a project switch, a subject change), which is
// precisely the case that needs it. The same guard makes the subscriber
// idempotent under the dock's apply-on-every-notification policy (§6.16a). Pure,
// so it is unit-testable.
export function needsSync(current, text) {
  return current !== text;
}

// subjectName is what the title line and the empty-notes placeholder call the
// pane's subject: the design's own name, or "<refdes> — <part or file name>" for
// a borrowed one (FR-125b). Pure.
export function subjectName(subject, design) {
  if (!subject) return design?.name ?? "";
  return `${subject.refdes} — ${subject.name}`;
}

// resolveSubject decides what a borrowed subject currently shows, and whether it
// still exists at all (FR-125b). It returns the text, or null meaning "this
// subject is gone — fall back to the design".
//
// A `type` subject is resolved from the LIVE library by type id on every refresh,
// never from the instance's placement-time copy (FR-057) — the same rule
// `editableGalType` follows — so a part corrected in the GAL dialog while its
// notes are on screen updates in place. A `child` subject carries its own text:
// it is a snapshot of one read of a file the editor does not have open, and
// nothing would notify us if it changed (re-choosing the menu item is the
// refresh). Either way the subject dies with the component that named it, so a
// refdes no longer on the sheet resolves to null. Pure.
export function resolveSubject(subject, design, findType) {
  if (!subject) return null;
  const onSheet = (design?.components ?? []).some((c) => c.refdes === subject.refdes);
  if (!onSheet) return null;
  if (subject.kind === "child") return subject.text ?? "";
  const type = findType(subject.typeId);
  return type ? (type.notes ?? "") : null;
}

// createNotesPanel wires the #notes-panel textarea to store.design.notes
// (FR-125) and its header to whichever notes are on show (FR-125b). Returns
// { open, requestClose, isOpen, syncToDesign, showSubject } — open and
// requestClose are the panel handle the dock is given (§6.16a), and are just the
// store flag: there is nothing to guard on close, the notes being already in the
// design and covered by its own dirty flag.
//
// `findType(id)` resolves a library type by its id (FR-066e); the panel needs it
// only for a borrowed type subject.
export function createNotesPanel({ store, findType = () => null }) {
  const host = document.getElementById("notes-panel");
  const body = host.querySelector(".notes-body");
  const title = host.querySelector(".notes-title");
  const readonlyMark = host.querySelector(".notes-readonly");
  const ownPlaceholder = body.getAttribute("placeholder") ?? "";

  // The borrowed subject (FR-125b), or null for the open design's own notes.
  let subject = null;

  // Every keystroke writes straight through — no debounce. A keystroke costs one
  // string assignment plus one notify(), which is what a mouse-move-driven hover
  // already costs (§6.10), and a debounce would open a window in which the design
  // is modified and the store does not know it (FR-049a). A borrowed subject's
  // textarea is disabled, so this cannot fire for one; the guard says so anyway,
  // because "read-only" must not depend on a DOM attribute alone.
  body.addEventListener("input", () => {
    if (!subject) store.setDesignNotes(body.value);
  });

  // syncToDesign pulls the notes on show into the textarea when they differ, and
  // reflects the read-only state. FR-125 keeps the tab open and its text readable
  // during a run; only editing stops, and the run is on screen as the visible
  // cause — not the invisible mode FR-115h removed. A borrowed subject is
  // read-only unconditionally (FR-125b), so the simulation lock adds nothing.
  function syncToDesign() {
    const design = store.state.design;
    // A subject whose component left the sheet, or whose type left the library,
    // silently becomes the design's own notes: the title changing is the notice.
    let text = resolveSubject(subject, design, findType);
    if (subject && text === null) subject = null;
    if (!subject) text = notesOf(design);

    if (needsSync(body.value, text)) body.value = text;
    body.disabled = !!subject || store.isReadonly();
    const name = subjectName(subject, design);
    title.textContent = `Notes for ${name}`;
    readonlyMark.hidden = !subject;
    body.placeholder = subject ? `${name} has no notes.` : ownPlaceholder;
  }

  store.subscribe(syncToDesign);
  syncToDesign();

  return {
    // open opens the Notes tab (FR-123); the store makes it frontmost and the
    // dock reveals the area. Called by the dock for View ▸ Notes on a closed tab.
    // Opening always returns to the design's own notes: View ▸ Notes means "my
    // notes", which is why the pane needs no return control of its own (FR-125b).
    open() {
      subject = null;
      store.setNotesPanelOpen(true);
      syncToDesign(); // the tab may have been closed across a design replacement
      body.focus();
    },
    // requestClose closes the tab — the ✕ and the menu item on an already-
    // frontmost tab. Unguarded: closing discards nothing, since the notes are in
    // the design, not in the panel. It also drops the borrowed subject, so the
    // next View ▸ Notes cannot reopen onto someone else's prose.
    requestClose() {
      subject = null;
      store.setNotesPanelOpen(false);
    },
    isOpen: () => !!store.state.notesPanelOpen,
    syncToDesign,
    // showSubject binds the pane to a placed component's notes, read-only
    // (FR-125b). `subj` is { kind: "type", refdes, name, typeId } or
    // { kind: "child", refdes, name, text }; null returns to the design's notes.
    // The caller opens/fronts the tab (dock.menuInvoke), which is the dock's job,
    // not the panel's.
    showSubject(subj) {
      subject = subj ?? null;
      syncToDesign();
    },
  };
}
