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
    viewport: initial.viewport ?? { pan: { x: 0, y: 0 }, zoom: 1 },
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

    // markSaved clears the dirty flag after a successful save (FR-049a).
    markSaved() {
      state.dirty = false;
      notify();
    },
  };
}
