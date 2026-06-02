// Interaction: translates pointer/keyboard events into Commands (§6.9). This
// slice implements the SELECT and PLACE tools; WIRE/BUS arrive in a later phase.
// The FSM never mutates the model directly except for transient drag previews;
// committed changes go through the store as Commands.

import { snapToGrid, screenToWorld } from "../geometry.js";
import { hitComponent } from "./hittest.js";
import {
  placeComponent,
  moveComponent,
  rotateComponent,
  deleteComponent,
} from "../commands.js";

export function initInteraction({ canvas, palette, store, renderer, library }) {
  let placeType = null; // ComponentType when tool === "place"
  let drag = null; // { refdes, origX, origY, moved }

  const findType = (name) => library.find((c) => c.name === name);

  function setTool(tool, type = null) {
    store.state.tool = tool;
    placeType = type;
    const label = document.getElementById("tool-mode");
    if (label) label.textContent = tool === "place" ? `place ${type.name}` : tool;
    canvas.style.cursor = tool === "place" ? "crosshair" : "default";
  }

  function select(refdes) {
    store.state.selection = refdes;
    renderer.requestRender();
  }

  // canvasPoint converts a mouse event to a point in the canvas's CSS pixels.
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function placeAt(screenPt) {
    const g = snapToGrid(screenPt, store.state.viewport);
    store.dispatch(placeComponent(placeType, g.x, g.y, 0));
    const placed = store.design.components[store.design.components.length - 1];
    setTool("select");
    select(placed.refdes);
  }

  // --- palette: click to arm PLACE, or drag a tile onto the canvas ---
  palette.addEventListener("click", (e) => {
    const tile = e.target.closest(".palette-tile");
    if (!tile) return;
    const type = findType(tile.dataset.type);
    if (type) setTool("place", type);
  });

  palette.addEventListener("dragstart", (e) => {
    const tile = e.target.closest(".palette-tile");
    if (tile) e.dataTransfer.setData("text/plain", tile.dataset.type);
  });

  canvas.addEventListener("dragover", (e) => e.preventDefault());
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    const type = findType(e.dataTransfer.getData("text/plain"));
    if (!type) return;
    placeType = type;
    placeAt(canvasPoint(e));
  });

  // --- canvas pointer handling ---
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const pt = canvasPoint(e);

    if (store.state.tool === "place" && placeType) {
      placeAt(pt);
      return;
    }

    const world = screenToWorld(pt, store.state.viewport);
    const hit = hitComponent(store.design, world);
    if (hit) {
      select(hit.refdes);
      drag = { refdes: hit.refdes, origX: hit.x, origY: hit.y, moved: false };
    } else {
      select(null);
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const g = snapToGrid(canvasPoint(e), store.state.viewport);
    const inst = store.design.components.find((c) => c.refdes === drag.refdes);
    if (inst && (inst.x !== g.x || inst.y !== g.y)) {
      inst.x = g.x; // transient preview; committed on mouseup
      inst.y = g.y;
      drag.moved = true;
      renderer.requestRender();
    }
  });

  window.addEventListener("mouseup", () => {
    if (!drag) return;
    const inst = store.design.components.find((c) => c.refdes === drag.refdes);
    if (inst && drag.moved) {
      const fx = inst.x;
      const fy = inst.y;
      inst.x = drag.origX; // rewind so the command captures the true old pos
      inst.y = drag.origY;
      store.dispatch(moveComponent(drag.refdes, fx, fy));
    }
    drag = null;
  });

  // --- keyboard ---
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (store.state.tool === "place") setTool("select");
      else select(null);
      return;
    }
    const sel = store.state.selection;
    if (!sel) return;

    if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      store.dispatch(rotateComponent(sel, e.shiftKey ? -90 : 90));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      store.dispatch(deleteComponent(sel));
      select(null);
    }
  });
}
