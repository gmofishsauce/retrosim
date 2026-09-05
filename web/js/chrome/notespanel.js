// Docked, modeless design-notes editor (§6.23, FR-125) — the free-form prose a
// design carries about itself: why it is built this way, what is provisional,
// what the next change should be. Structurally the simplest of the docked panels
// (§6.16a): one <textarea> over one string, `design.notes`.
//
// The whole feature is that string. There is no notes *document*, no associated
// path, and no second modified flag — which is exactly why replacing the design
// REBINDS this tab rather than closing it (FR-125). The test-vector panel needs a
// guarded close because its `.tv` is a second document a replacement can leave
// pointing at the design it is no longer showing (FR-115m, OQ-002); notes have no
// existence apart from the design, so there is nothing left over to be wrong
// about, and `fileops.guardReplace` is deliberately not extended here.
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

// needsSync reports whether the textarea should be overwritten from the design.
//
// This predicate is the panel's one subtlety. The panel subscribes to the store,
// and the store notifies *because of* the keystroke the user just typed here — so
// a subscriber that blindly assigned `el.value` would reset the caret to the end
// on every character. Writing only when the two actually differ makes the write
// happen exactly when the change came from somewhere OTHER than this textarea (a
// design load, a replacement, a project switch), which is precisely the case that
// needs it. The same guard makes the subscriber idempotent under the dock's
// apply-on-every-notification policy (§6.16a). Pure, so it is unit-testable.
export function needsSync(current, design) {
  return current !== notesOf(design);
}

// createNotesPanel wires the #notes-panel textarea to store.design.notes
// (FR-125). Returns { open, requestClose, isOpen, syncToDesign } — open and
// requestClose are the panel handle the dock is given (§6.16a), and are just the
// store flag: there is nothing to guard on close, the notes being already in the
// design and covered by its own dirty flag (FR-049a).
export function createNotesPanel({ store }) {
  const host = document.getElementById("notes-panel");
  const body = host.querySelector(".notes-body");

  // Every keystroke writes straight through — no debounce. A keystroke costs one
  // string assignment plus one notify(), which is what a mouse-move-driven hover
  // already costs (§6.10), and a debounce would open a window in which the design
  // is modified and the store does not know it (FR-049a).
  body.addEventListener("input", () => store.setDesignNotes(body.value));

  // syncToDesign pulls the design's notes into the textarea when they differ, and
  // reflects the simulation lock. FR-125 keeps the tab open and its text readable
  // during a run; only editing stops, and the run is on screen as the visible
  // cause — not the invisible mode FR-115h removed.
  function syncToDesign() {
    if (needsSync(body.value, store.state.design)) body.value = notesOf(store.state.design);
    body.disabled = store.isReadonly();
  }

  store.subscribe(syncToDesign);
  syncToDesign();

  return {
    // open opens the Notes tab (FR-123); the store makes it frontmost and the
    // dock reveals the area. Called by the dock for View ▸ Notes on a closed tab.
    open() {
      store.setNotesPanelOpen(true);
      syncToDesign(); // the tab may have been closed across a design replacement
      body.focus();
    },
    // requestClose closes the tab — the ✕ and the menu item on an already-
    // frontmost tab. Unguarded: closing discards nothing, since the notes are in
    // the design, not in the panel.
    requestClose() {
      store.setNotesPanelOpen(false);
    },
    isOpen: () => !!store.state.notesPanelOpen,
    syncToDesign,
  };
}
