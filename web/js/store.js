// Store: the single source of truth and the only mutation path (§6.10). Every
// design-modifying action is a Command { apply(design), revert(design), label }
// dispatched here; the store records it for undo/redo, tracks the dirty flag,
// and notifies subscribers. This central pipeline makes undo/redo total and
// reliable (FR-024, NFR-006).

// UNDO_CAP bounds the undo history; well above the NFR-006 minimum of 50.
export const UNDO_CAP = 100;

export function createStore(initial = {}) {
  const state = {
    design: initial.design ?? null,
    tool: initial.tool ?? "select",
    placeType: initial.placeType ?? null, // type name armed for click-to-place (FR-009a)
    selection: initial.selection ?? null,
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
  };

  const undoStack = [];
  const redoStack = [];
  const subscribers = new Set();

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

  // blocked refuses design mutations while simulating (FR-087).
  function blocked(what) {
    if (!state.simulating) return false;
    onBlocked(`${what} is disabled while simulating — press Stop first`);
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

    // setTool changes the active tool and notifies (so chrome can reflect it).
    // placeType (a type name) is recorded while tool === "place" so the palette
    // can show the armed tile (FR-009a); it is cleared for any other tool.
    setTool(tool, placeType = null) {
      state.tool = tool;
      state.placeType = tool === "place" ? placeType : null;
      notify();
    },

    // setSelection updates the current selection and notifies, so the canvas
    // highlight and the properties panel (FR-020a) stay in sync.
    setSelection(sel) {
      state.selection = sel;
      notify();
    },

    // replaceDesign swaps in a new design (New/Open), resetting undo/redo,
    // selection, and the dirty flag (FR-044/052).
    replaceDesign(newDesign, { savePath = null } = {}) {
      state.design = newDesign;
      state.designName = newDesign.name ?? state.designName;
      state.savePath = savePath;
      state.selection = null;
      state.dirty = false;
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },

    // setSimulating flips the read-only simulation mode (FR-087); the sim
    // engine owns the transitions (§6.13). Notifies so chrome can react.
    setSimulating(flag) {
      state.simulating = flag;
      notify();
    },

    // setSim publishes (or clears) the simulator's display view (§6.13); the
    // view survives a stop (FR-085) until the next design modification.
    setSim(view) {
      state.sim = view;
      notify();
    },

    // markSaved clears the dirty flag after a successful save, recording the path
    // if given (FR-046/048/049a).
    markSaved(path) {
      if (path !== undefined) state.savePath = path;
      state.dirty = false;
      notify();
    },
  };
}
