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
    selection: initial.selection ?? null,
    viewport: initial.viewport ?? { pan: { x: 0, y: 0 }, zoom: 1.6 },
    dirty: false,
    savePath: initial.savePath ?? null,
    designName: initial.designName ?? initial.design?.name ?? null,
  };

  const undoStack = [];
  const redoStack = [];
  const subscribers = new Set();

  function notify() {
    for (const fn of subscribers) fn(state);
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
      cmd.apply(state.design);
      undoStack.push(cmd);
      if (undoStack.length > UNDO_CAP) undoStack.shift();
      redoStack.length = 0;
      state.dirty = true;
      notify();
    },

    undo() {
      const cmd = undoStack.pop();
      if (!cmd) return;
      cmd.revert(state.design);
      redoStack.push(cmd);
      state.dirty = true;
      notify();
    },

    redo() {
      const cmd = redoStack.pop();
      if (!cmd) return;
      cmd.apply(state.design);
      undoStack.push(cmd);
      state.dirty = true;
      notify();
    },

    // setTool changes the active tool and notifies (so chrome can reflect it).
    setTool(tool) {
      state.tool = tool;
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

    // markSaved clears the dirty flag after a successful save, recording the path
    // if given (FR-046/048/049a).
    markSaved(path) {
      if (path !== undefined) state.savePath = path;
      state.dirty = false;
      notify();
    },
  };
}
