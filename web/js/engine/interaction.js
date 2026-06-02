// Interaction: translates pointer/keyboard events into Commands (§6.9). This
// slice implements SELECT, PLACE, and WIRE tools. The FSM never mutates the
// model directly except for transient drag previews; committed changes go
// through the store as Commands.

import { snapToGrid, screenToWorld } from "../geometry.js";
import { hitComponent, hitPin, hitSegment, hitBend } from "./hittest.js";
import {
  placeComponent,
  moveComponent,
  rotateComponent,
  deleteComponent,
  addWireCmd,
  deleteWireCmd,
  insertBendCmd,
  moveBendCmd,
} from "../commands.js";
import { insertBend, moveBend } from "../model/design.js";

export function initInteraction({ canvas, palette, store, renderer, library }) {
  let placeType = null; // ComponentType when tool === "place"
  let wireSource = null; // pending WIRE source spec
  let drag = null; // transient drag state for SELECT gestures

  const findType = (name) => library.find((c) => c.name === name);
  const findWire = (id) => store.design.wires.find((w) => w.id === id);

  function setTool(tool, type = null) {
    store.state.tool = tool;
    placeType = type;
    wireSource = null;
    const label = document.getElementById("tool-mode");
    if (label) label.textContent = tool === "place" ? `place ${type.name}` : tool;
    canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  }

  function select(sel) {
    store.state.selection = sel;
    renderer.requestRender();
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const worldOf = (e) => screenToWorld(canvasPoint(e), store.state.viewport);
  const gridOf = (e) => snapToGrid(canvasPoint(e), store.state.viewport);

  function placeAt(screenPt) {
    const g = snapToGrid(screenPt, store.state.viewport);
    store.dispatch(placeComponent(placeType, g.x, g.y, 0));
    const placed = store.design.components[store.design.components.length - 1];
    setTool("select");
    select({ kind: "component", refdes: placed.refdes });
  }

  // wireTargetAt returns a wire endpoint spec for a click: a pin, or a branch on
  // an existing segment, or null (empty space — ignored).
  function wireTargetAt(e) {
    const world = worldOf(e);
    const ph = hitPin(store.design, world, 0.5);
    if (ph) return { kind: "pin", refdes: ph.refdes, pin: ph.pin };
    const sh = hitSegment(store.design, world, 0.4);
    if (sh) {
      const g = gridOf(e);
      return { kind: "branch", wireId: sh.wire.id, segIndex: sh.segIndex, x: g.x, y: g.y };
    }
    return null;
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

    if (store.state.tool === "wire") {
      const target = wireTargetAt(e);
      if (!target) return; // ignore empty-space clicks (no partial wire)
      if (!wireSource) {
        wireSource = target;
        return;
      }
      store.dispatch(addWireCmd(wireSource, target));
      setTool("select"); // one-shot (FR-028)
      return;
    }

    // SELECT tool.
    const world = worldOf(e);
    const bend = hitBend(store.design, world, 0.5);
    if (bend) {
      select({ kind: "wire", id: bend.wire.id });
      drag = { type: "bend", wireId: bend.wire.id, bendIndex: bend.bendIndex, moved: false };
      return;
    }
    const seg = hitSegment(store.design, world, 0.4);
    if (seg) {
      select({ kind: "wire", id: seg.wire.id });
      // A plain click selects; a drag inserts a bend here (decided on move).
      drag = { type: "segment", wireId: seg.wire.id, segIndex: seg.segIndex, tempIndex: -1, moved: false };
      return;
    }
    const comp = hitComponent(store.design, world);
    if (comp) {
      select({ kind: "component", refdes: comp.refdes });
      drag = { type: "component", refdes: comp.refdes, origX: comp.x, origY: comp.y, moved: false };
      return;
    }
    select(null);
  });

  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const g = gridOf(e);

    if (drag.type === "component") {
      const inst = store.design.components.find((c) => c.refdes === drag.refdes);
      if (inst && (inst.x !== g.x || inst.y !== g.y)) {
        inst.x = g.x;
        inst.y = g.y;
        drag.moved = true;
        renderer.requestRender();
      }
      return;
    }

    if (drag.type === "bend") {
      const w = findWire(drag.wireId);
      if (w) {
        moveBend(w, drag.bendIndex, g.x, g.y);
        drag.moved = true;
        renderer.requestRender();
      }
      return;
    }

    if (drag.type === "segment") {
      const w = findWire(drag.wireId);
      if (!w) return;
      if (drag.tempIndex < 0) {
        drag.tempIndex = insertBend(w, drag.segIndex, g.x, g.y); // live preview
      } else {
        moveBend(w, drag.tempIndex, g.x, g.y);
      }
      drag.moved = true;
      renderer.requestRender();
    }
  });

  window.addEventListener("mouseup", () => {
    if (!drag) return;

    if (drag.type === "component" && drag.moved) {
      const inst = store.design.components.find((c) => c.refdes === drag.refdes);
      const fx = inst.x;
      const fy = inst.y;
      inst.x = drag.origX;
      inst.y = drag.origY;
      store.dispatch(moveComponent(drag.refdes, fx, fy));
    } else if (drag.type === "bend" && drag.moved) {
      const w = findWire(drag.wireId);
      const p = w.path[drag.bendIndex];
      const fx = p.x;
      const fy = p.y;
      // The live preview already moved it; the command captures old via a rewind.
      store.dispatch(moveBendCmd(drag.wireId, drag.bendIndex, fx, fy));
    } else if (drag.type === "segment" && drag.moved && drag.tempIndex >= 0) {
      const w = findWire(drag.wireId);
      const p = w.path[drag.tempIndex];
      const fx = p.x;
      const fy = p.y;
      w.path.splice(drag.tempIndex, 1); // remove the preview bend
      store.dispatch(insertBendCmd(drag.wireId, drag.segIndex, fx, fy));
    }
    drag = null;
  });

  // --- keyboard ---
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (store.state.tool !== "select") setTool("select");
      else select(null);
      return;
    }
    if (e.key.toLowerCase() === "w" && store.state.tool === "select") {
      setTool("wire");
      return;
    }

    const sel = store.state.selection;
    if (!sel) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (sel.kind === "component") store.dispatch(deleteComponent(sel.refdes));
      else if (sel.kind === "wire") store.dispatch(deleteWireCmd(sel.id));
      select(null);
    } else if (e.key.toLowerCase() === "r" && sel.kind === "component") {
      e.preventDefault();
      store.dispatch(rotateComponent(sel.refdes, e.shiftKey ? -90 : 90));
    }
  });
}
