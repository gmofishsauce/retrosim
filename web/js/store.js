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

export function createStore(initial = {}) {
  const state = {
    design: initial.design ?? null,
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

  // isReadonly reports the read-only condition shared by the interactive
  // simulator (FR-087) and the open test-vector panel (FR-115h): the design
  // cannot be edited under either.
  function isReadonly() {
    return state.simulating || state.vectorPanelOpen;
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
    const why = state.simulating
      ? "the simulator is running — press Stop first"
      : "the Test Vectors panel is open — close it first";
    onBlocked(`${what} is disabled while ${why}`);
    return true;
  }

  // clearSimView drops a retained simulation display view on the first design
  // modification after a run (FR-085, §6.13).
  function clearSimView() {
    state.sim = null;
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
      try {
        cmd.apply(state.design);
      } catch (err) {
        onError(err, cmd);
        notify(); // re-render in case the failed apply mutated transient state
        return;
      }
      undoStack.push(cmd);
      if (undoStack.length > UNDO_CAP) undoStack.shift();
      redoStack.length = 0;
      state.dirty = true;
      notify();
    },

    undo() {
      if (blocked("undo")) return;
      const cmd = undoStack.pop();
      if (!cmd) return;
      clearSimView();
      cmd.revert(state.design);
      redoStack.push(cmd);
      state.dirty = true;
      notify();
    },

    redo() {
      if (blocked("redo")) return;
      const cmd = redoStack.pop();
      if (!cmd) return;
      clearSimView();
      cmd.apply(state.design);
      undoStack.push(cmd);
      state.dirty = true;
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

    // setVectorPanelOpen flips the read-only test-vector-panel mode (FR-115h);
    // the panel owns the transitions (§6.16). Notifies so chrome can react.
    setVectorPanelOpen(flag) {
      state.vectorPanelOpen = flag;
      notify();
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
