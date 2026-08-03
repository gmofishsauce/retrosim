// Store: the single source of truth and the only mutation path (§6.10). Every
// design-modifying action is a Command { apply(design), revert(design), label }
// dispatched here; the store records it for undo/redo, tracks the dirty flag,
// and notifies subscribers. This central pipeline makes undo/redo total and
// reliable (FR-024, NFR-006).

// UNDO_CAP bounds the undo history; well above the NFR-006 minimum of 50.
export const UNDO_CAP = 100;

// sameRef compares two selection refs by kind and identity (refdes for
// components, id for wires/buses, id+segIndex for segments) — FR-016a/FR-031.
export function sameRef(a, b) {
  return (
    a.kind === b.kind &&
    a.refdes === b.refdes &&
    a.id === b.id &&
    a.segIndex === b.segIndex
  );
}

function sameRefIn(list, ref) {
  return list.some((s) => sameRef(s, ref));
}

// snapshotDesign/restoreDesign back the atomic-failure guarantee (FR-024a):
// dispatch/undo/redo capture the design's connectivity collections and id
// counters before mutating and restore them in place if the command throws, so
// a failed action leaves the design, the history, and the dirty flag exactly
// as they were. Local to the store (which stays dependency-free) and tolerant
// of the toy designs the store tests use — only fields actually present are
// captured and restored; restore preserves design object identity (§6.10).
// DOCK_FLAG names the open flag behind each tab of the docked panel area
// (§6.16a, FR-123). It is the store's whole knowledge of tab kinds: a new tab
// adds a flag to the state and an entry here, and setTabOpen/setDockActive/
// markDockUnread need no change. The labels, hosts, and strip live in
// chrome/dock.js. The `drc` row (FR-124g, 2026-08-02) is the first tab added
// after that claim was written, and it cost exactly this line plus its flag.
const DOCK_FLAG = {
  vec: "vectorPanelOpen",
  console: "consolePanelOpen",
  drc: "drcPanelOpen",
};

const DESIGN_COLLECTIONS = ["components", "wires", "buses", "vertices"];
const DESIGN_COUNTERS = ["nextWireId", "nextBusId", "nextVertexId"];

function snapshotDesign(design) {
  const snap = {};
  for (const k of DESIGN_COLLECTIONS) {
    if (Array.isArray(design?.[k])) snap[k] = structuredClone(design[k]);
  }
  for (const k of DESIGN_COUNTERS) {
    if (design?.[k] !== undefined) snap[k] = design[k];
  }
  return snap;
}

function restoreDesign(design, snap) {
  for (const k of DESIGN_COLLECTIONS) {
    if (!snap[k]) continue;
    design[k].length = 0;
    design[k].push(...snap[k]);
  }
  for (const k of DESIGN_COUNTERS) {
    if (snap[k] !== undefined) design[k] = snap[k];
  }
}

export function createStore(initial = {}) {
  const state = {
    design: initial.design ?? null,
    // designRev counts DESIGN MUTATIONS, and nothing else (§6.10, FR-115h). The
    // store notifies for many reasons a subscriber cannot tell apart — a
    // selection, a tool change, a tab switch — and the test-vector panel must
    // react to design edits specifically, now that they can happen while it is
    // open. Comparing a remembered value is O(1) and can neither miss an edit nor
    // fire without one; hashing or diffing the design per notification would be
    // work proportional to the design for the same answer. Bumped by dispatch,
    // undo, redo, applyLive, and replaceDesign — see bumpDesign() — and by
    // nothing else. Session-only; no meaning beyond "different from last time".
    designRev: 0,
    tool: initial.tool ?? "select",
    placeType: initial.placeType ?? null, // type name armed for click-to-place (FR-009a)
    selection: initial.selection ?? [],
    hover: initial.hover ?? null, // refdes under the cursor; transient UI state (FR-013c)
    viewport: initial.viewport ?? { pan: { x: 0, y: 0 }, zoom: 1.6 },
    dirty: false,
    savePath: initial.savePath ?? null,
    designName: initial.designName ?? initial.design?.name ?? null,
    // Transient simulation state (§6.10, §6.13), never persisted: while
    // `simulating` the design is read-only (FR-087); `sim` is the engine's
    // display view, retained after a run ends (FR-085) and cleared on the
    // next design modification.
    simulating: false,
    sim: null,
    // While `vectorPanelOpen` the design is read-only too (FR-115h), sharing the
    // simulation lock's condition via isReadonly(); never persisted.
    vectorPanelOpen: false,
    // `probe` is the probe target descriptor (FR-087c) or null: what the user
    // clicked while probe mode was active, resolved once at click time to the
    // lane or (refdes,pin) needed to read it. Transient UI state — never
    // persisted, never undoable, never dirtying — and NOT the selection, which
    // stays locked and empty during a run (FR-087).
    probe: null,
    // `vectorHold` says the current `sim` view is a HELD vector run (FR-115l),
    // not values lingering after an interactive Stop (FR-085) — a distinction
    // `sim` alone cannot carry. It drives the "held" state tray (FR-073) and the
    // toolbar's release-Stop. Transient, never persisted.
    vectorHold: false,
    // `consolePanelOpen` toggles the docked Console panel (FR-122c). Unlike the
    // test-vector panel it is MODELESS: it deliberately does NOT feed
    // isReadonly()/blocked(), so it coexists with a running simulation and
    // imposes no edit lock. Session-only UI state, never persisted.
    consolePanelOpen: false,
    // `drcPanelOpen` toggles the docked design-rule-check report (FR-124g). Like
    // the Console it is MODELESS — it deliberately does NOT feed isReadonly()/
    // blocked(), because the whole point of a checker is that the design stays
    // editable while its findings are on screen (FR-124g). Session-only view
    // state: a report is never persisted, and reloading discards it — waivers
    // (FR-124e) are a check's only durable product, and they live in the design.
    drcPanelOpen: false,
    // Tab bookkeeping for the docked panel area (§6.16a, FR-123). The flags
    // above say which tabs are OPEN; these say which one is frontmost, where each
    // sits in the strip, which was used most recently, and which carries an
    // unseen-content dot. All session-only view state that nonetheless notifies,
    // because the toolbar's menu items branch on it (open/select/close, FR-123).
    // Maintained only by setTabOpen/setDockActive/markDockUnread below, so the
    // four members can never disagree with each other or with the open flags.
    dockActive: null, // "vec" | "console" | "drc" | null — the frontmost tab
    dockOrder: [], // strip order: appended on open (FR-123 "order opened")
    dockMru: [], // most-recently-used first; picks the successor on close
    dockUnread: {}, // { console: true } — unseen-content marks (FR-123)
    // The current project (FR-121, §6.19): null or { dir, name, manifestFile,
    // mainDesign } — the client-side mirror of the server's ProjectInfo minus
    // its warnings. Transient session state, never persisted (the server holds
    // no open-project state). While null the design is the inert FR-004
    // placeholder (§3.1 A8): every mutation path refuses via blocked().
    project: initial.project ?? null,
  };

  const undoStack = [];
  const redoStack = [];
  const subscribers = new Set();
  // Live-input listeners (FR-087b): notified after an applyLive mutation so the
  // running simulator can wake() and re-evaluate (§6.10, §6.13). Separate from
  // `subscribers` because this is an input-event signal, not a re-render.
  const liveListeners = new Set();

  // onError surfaces a command failure non-fatally (§6.6): the throwing command
  // is not recorded for undo and the event handler does not die mid-gesture.
  // The app overrides this with a toast; console.error is the headless default.
  const onError =
    initial.onError ?? ((err) => console.error("command failed:", err));

  // onBlocked reports a mutation refused because a simulation is running
  // (FR-087). The app routes this to the status-bar message tray.
  const onBlocked =
    initial.onBlocked ?? ((msg) => console.warn(msg));

  function notify() {
    for (const fn of subscribers) fn(state);
  }

  // isReadonly reports the read-only condition: a running interactive simulation
  // (FR-087), and nothing else. It formerly also reported an open test-vector
  // panel (FR-115h); that lock was removed 2026-08-02 — once the panel became a
  // TAB (FR-123) it could be open behind the Console, leaving the user with a
  // design that refuses edits for no cause they can see. The panel now keeps its
  // derived columns current instead (§6.16 "Live columns").
  function isReadonly() {
    return state.simulating;
  }

  // blocked refuses design mutations while the design is read-only
  // (FR-087/FR-115h) or while no project is current (FR-121c, §3.1 A8),
  // naming the active cause. isReadonly() deliberately does not cover the
  // no-project state: chrome reads state.project directly for enablement.
  function blocked(what) {
    if (state.project === null) {
      onBlocked(
        `${what} is disabled — no project is open (use File ▸ New Project or Open Project)`,
      );
      return true;
    }
    if (!isReadonly()) return false;
    onBlocked(`${what} is disabled while the simulator is running — press Stop first`);
    return true;
  }

  // setTabOpen opens or closes one tab of the docked panel area (§6.16a,
  // FR-123): it sets that tab's open flag AND maintains the strip bookkeeping in
  // one place, so "opening makes it frontmost" and "closing the frontmost tab
  // selects the most recently used remaining one" are single rules rather than a
  // handshake between the dock and two panel modules. Unknown keys are ignored.
  function setTabOpen(key, open) {
    const flag = DOCK_FLAG[key];
    if (!flag) return;
    state[flag] = !!open;
    // dockOrder is rebuilt by remove-then-append, so reopening a closed tab
    // lands at the RIGHT END of the strip (FR-123 "order opened").
    state.dockOrder = state.dockOrder.filter((k) => k !== key);
    state.dockMru = state.dockMru.filter((k) => k !== key);
    delete state.dockUnread[key]; // a tab arrives, and departs, unmarked
    if (open) {
      state.dockOrder.push(key);
      state.dockMru.unshift(key);
      state.dockActive = key; // opening a tab makes it frontmost (FR-123)
    } else if (state.dockActive === key) {
      // Closing the FRONTMOST tab hands the front to the most recently used
      // remaining tab, or to nothing when it was the last one — at which point
      // the whole area disappears (FR-123). Closing a BACKGROUND tab leaves the
      // selection alone, which is this branch not running.
      state.dockActive = state.dockMru[0] ?? null;
    }
    notify();
  }

  // bumpDesign records that the design just changed (§6.10, FR-115h). Called
  // only after a mutation has actually landed — a refused or thrown-and-restored
  // command must not bump, having changed nothing.
  function bumpDesign() {
    state.designRev++;
  }

  // clearSimView drops a retained simulation display view on the first design
  // modification after a run (FR-085, §6.13), and with it any probe target
  // (FR-087c) — the values it was reading are gone.
  function clearSimView() {
    state.sim = null;
    state.probe = null;
  }

  return {
    state,
    get design() {
      return state.design;
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    undoDepth() {
      return undoStack.length;
    },
    redoDepth() {
      return redoStack.length;
    },

    dispatch(cmd) {
      if (blocked(cmd.label ?? "editing")) return;
      clearSimView();
      const snap = snapshotDesign(state.design);
      try {
        cmd.apply(state.design);
      } catch (err) {
        restoreDesign(state.design, snap); // atomic failure (FR-024a)
        onError(err, cmd);
        notify(); // re-render in case the failed apply mutated transient state
        return;
      }
      undoStack.push(cmd);
      if (undoStack.length > UNDO_CAP) undoStack.shift();
      redoStack.length = 0;
      state.dirty = true;
      bumpDesign();
      notify();
    },

    undo() {
      if (blocked("undo")) return;
      const cmd = undoStack.pop();
      if (!cmd) return;
      clearSimView();
      const snap = snapshotDesign(state.design);
      try {
        cmd.revert(state.design);
      } catch (err) {
        restoreDesign(state.design, snap); // atomic failure (FR-024a)
        undoStack.push(cmd); // stacks unmoved
        onError(err, cmd);
        notify();
        return;
      }
      redoStack.push(cmd);
      state.dirty = true;
      bumpDesign();
      notify();
    },

    redo() {
      if (blocked("redo")) return;
      const cmd = redoStack.pop();
      if (!cmd) return;
      clearSimView();
      const snap = snapshotDesign(state.design);
      try {
        cmd.apply(state.design);
      } catch (err) {
        restoreDesign(state.design, snap); // atomic failure (FR-024a)
        redoStack.push(cmd); // stacks unmoved
        onError(err, cmd);
        notify();
        return;
      }
      undoStack.push(cmd);
      state.dirty = true;
      bumpDesign();
      notify();
    },

    // applyLive runs a non-undoable mutation that is permitted during a run —
    // an interactive input such as the switch click (FR-087a/FR-087b).
    // Unlike dispatch it bypasses both the simulation lock and the undo/redo
    // stacks, but still marks the design dirty and notifies so the backup
    // snapshot (FR-092) and the properties panel observe the change. The live
    // sim view is intentionally not cleared. After notifying it fires the
    // live-input channel so the running simulator re-evaluates (§6.13).
    applyLive(mutate) {
      mutate(state.design);
      state.dirty = true;
      bumpDesign();
      notify();
      for (const fn of liveListeners) fn();
    },

    // subscribeLive registers a live-input listener (FR-087b) and returns an
    // unsubscribe function. The sim engine subscribes for the duration of a run
    // so any applyLive wakes it; non-sim consumers ignore the channel.
    subscribeLive(fn) {
      liveListeners.add(fn);
      return () => liveListeners.delete(fn);
    },

    // setTool changes the active tool and notifies (so chrome can reflect it).
    // placeType (a type name) is recorded while tool === "place" so the palette
    // can show the armed tile (FR-009a); it is cleared for any other tool.
    setTool(tool, placeType = null) {
      state.tool = tool;
      state.placeType = tool === "place" ? placeType : null;
      notify();
    },

    // setSelection replaces the current selection (an array of refs) and
    // notifies, so the canvas highlight and the properties panel (FR-020a) stay
    // in sync (FR-016a).
    setSelection(sel) {
      state.selection = sel;
      // A selection change hands the properties panel back from the probe sheet
      // (FR-087c): after a Stop the first click that selects something should
      // show that thing, not the frozen probe reading.
      state.probe = null;
      notify();
    },

    // setProbe records (or clears, with null) the probe target the user clicked
    // in probe mode (FR-087c). Transient like the selection: outside the
    // command/undo path, never persisted, never dirtying.
    setProbe(target) {
      state.probe = target;
      notify();
    },

    // toggleSelection adds ref to the selection if absent, or removes it if
    // present (shift-click, FR-016a), then notifies.
    toggleSelection(ref) {
      state.selection = sameRefIn(state.selection, ref)
        ? state.selection.filter((s) => !sameRef(s, ref))
        : [...state.selection, ref];
      notify();
    },

    // isSelected reports whether ref is in the current selection (FR-016a).
    isSelected(ref) {
      return sameRefIn(state.selection, ref);
    },

    // replaceDesign swaps in a new design (New/Open), resetting undo/redo and
    // selection. `dirty` is cleared by default (FR-044/052); backup recovery
    // passes dirty: true because the recovered work is unsaved (FR-093).
    replaceDesign(newDesign, { savePath = null, dirty = false } = {}) {
      state.design = newDesign;
      state.designName = newDesign.name ?? state.designName;
      state.savePath = savePath;
      state.selection = [];
      state.dirty = dirty;
      undoStack.length = 0;
      redoStack.length = 0;
      bumpDesign(); // a wholly different design: the strongest change of all
      notify();
    },

    // setProject records the current project (FR-121, §6.19): null or
    // { dir, name, manifestFile, mainDesign }. Notifies so the top-bar
    // indicator and item enablement react (FR-121b/FR-121c).
    setProject(p) {
      state.project = p;
      notify();
    },

    // setSimulating flips the read-only simulation mode (FR-087); the sim
    // engine owns the transitions (§6.13). Notifies so chrome can react.
    setSimulating(flag) {
      state.simulating = flag;
      notify();
    },

    // setTabOpen opens or closes one tab of the docked panel area (§6.16a,
    // FR-123). The panels reach it through the two named setters below; nothing
    // else writes the four dock members.
    setTabOpen,

    // setDockActive selects an already-open tab (§6.16a, FR-123): it moves to the
    // head of the MRU list, becomes frontmost, and loses its unseen-content mark.
    // A no-op for a tab that is closed or already frontmost, so a stray call can
    // neither desync the strip nor cost a notification.
    setDockActive(key) {
      if (!DOCK_FLAG[key] || !state[DOCK_FLAG[key]]) return;
      if (state.dockActive === key && !state.dockUnread[key]) return;
      state.dockMru = [key, ...state.dockMru.filter((k) => k !== key)];
      state.dockActive = key;
      delete state.dockUnread[key];
      notify();
    },

    // markDockUnread raises a tab's unseen-content dot (§6.16a, FR-123) — content
    // arrived in a tab the user is not looking at. Deliberately a no-op for a
    // frontmost or closed tab, and idempotent once set, so its caller (the
    // Console's per-frame repaint, §6.20) needs no condition of its own and a
    // long burst of output costs one notification, not one per frame.
    markDockUnread(key) {
      if (!DOCK_FLAG[key] || !state[DOCK_FLAG[key]]) return;
      if (state.dockActive === key || state.dockUnread[key]) return;
      state.dockUnread[key] = true;
      notify();
    },

    // setVectorPanelOpen flips the read-only test-vector-panel mode (FR-115h);
    // the panel owns the transitions (§6.16). Routes through setTabOpen so the
    // tab bookkeeping (§6.16a) follows. Notifies so chrome can react.
    setVectorPanelOpen(flag) {
      setTabOpen("vec", flag);
    },

    // setVectorHold flips the held-vector-run state (FR-115l); the panel owns
    // the transitions (§6.16) and pairs every call with a setSim(). Notifies so
    // the toolbar's release-Stop and the state tray can react.
    setVectorHold(flag) {
      state.vectorHold = flag;
      notify();
    },

    // setConsolePanelOpen toggles the modeless Console panel (FR-122c); the
    // panel and the View ▸ Console item own the transitions (§6.20). It does
    // NOT feed isReadonly()/blocked() — the panel imposes no edit lock. Routes
    // through setTabOpen so the tab bookkeeping (§6.16a) follows. Notifies so
    // chrome (the tab strip, the menu check) can react.
    setConsolePanelOpen(flag) {
      setTabOpen("console", flag);
    },

    // setDrcPanelOpen toggles the modeless design-rule-check report (FR-124g).
    // The panel owns the transitions (§6.21), and running a check only ever
    // OPENS or SELECTS the tab — never closes it — so the report cannot hide its
    // own results; the tab's ✕ closes it like any other. Like the Console it does
    // NOT feed isReadonly()/blocked(). Routes through setTabOpen so the tab
    // bookkeeping (§6.16a) follows.
    setDrcPanelOpen(flag) {
      setTabOpen("drc", flag);
    },

    // isReadonly is the shared edit-lock predicate (FR-087/FR-115h): true while
    // simulating or while the test-vector panel is open.
    isReadonly,

    // setSim publishes (or clears) the simulator's display view (§6.13); the
    // view survives a stop (FR-085) until the next design modification.
    setSim(view) {
      state.sim = view;
      notify();
    },

    // markSaved clears the dirty flag after a successful save, recording the
    // path and, when given, the design's new name — a save adopts the chosen
    // file's base name (FR-047a) — then notifies (FR-046/048/049a).
    markSaved(path, name) {
      if (path !== undefined) state.savePath = path;
      if (name !== undefined) {
        state.designName = name;
        if (state.design) state.design.name = name;
      }
      state.dirty = false;
      notify();
    },
  };
}
