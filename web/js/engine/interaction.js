// Interaction: translates pointer/keyboard events into Commands (§6.9). This
// slice implements SELECT, PLACE, and WIRE tools. The FSM never mutates the
// model directly except for transient drag previews; committed changes go
// through the store as Commands.

import { snapToGrid, screenToWorld, scaleFor, zoomAbout } from "../geometry.js";
import {
  hitComponent,
  hitPin,
  hitSegment,
  hitBend,
  hitBusSegment,
} from "./hittest.js";
import {
  placeComponent,
  moveComponent,
  rotateComponent,
  deleteComponent,
  addWireCmd,
  deleteWireCmd,
  insertBendCmd,
  moveBendCmd,
  addBusCmd,
  deleteBusCmd,
  setBusWidthCmd,
} from "../commands.js";
import { insertBend, moveBend } from "../model/design.js";

const DEFAULT_BUS_WIDTH = 8;

// showToast surfaces a brief non-fatal message (e.g., a rejected connection).
function showToast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

export function initInteraction({ canvas, palette, store, renderer, library }) {
  let placeType = null; // ComponentType when tool === "place"
  let wireSource = null; // pending WIRE source spec
  let drag = null; // transient drag state for SELECT gestures
  let pan = null; // transient pan state { sx, sy, pan0 }
  let spaceDown = false; // space held -> left-drag pans

  const findType = (name) => library.find((c) => c.name === name);
  const findWire = (id) => store.design.wires.find((w) => w.id === id);

  function setTool(tool, type = null) {
    placeType = type;
    wireSource = null;
    const label = document.getElementById("tool-mode");
    if (label) label.textContent = tool === "place" ? `place ${type.name}` : tool;
    canvas.style.cursor = tool === "select" ? "default" : "crosshair";
    store.setTool(tool); // notifies subscribers (toolbar highlight)
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

  // busTargetAt returns a bus endpoint spec: a branch on an existing bus, or a
  // free grid point (buses connect to components via snap-connect in a later
  // slice).
  function busTargetAt(e) {
    const world = worldOf(e);
    const bh = hitBusSegment(store.design, world, 0.4);
    const g = gridOf(e);
    if (bh) {
      return {
        kind: "branch",
        wireId: bh.bus.id,
        segIndex: bh.segIndex,
        x: g.x,
        y: g.y,
        busWidth: bh.bus.width,
      };
    }
    return { kind: "free", x: g.x, y: g.y };
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
  // Pan with the middle button or space + left drag (§6.11).
  function startPan(e) {
    pan = { sx: e.clientX, sy: e.clientY, pan0: { ...store.state.viewport.pan } };
    e.preventDefault();
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      startPan(e);
      return;
    }
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

    if (store.state.tool === "bus") {
      const target = busTargetAt(e);
      if (!wireSource) {
        wireSource = target;
        return;
      }
      // Reject joining two buses of unequal width (FR-039a).
      if (
        wireSource.kind === "branch" &&
        target.kind === "branch" &&
        wireSource.busWidth !== target.busWidth
      ) {
        showToast(
          `cannot join buses of width ${wireSource.busWidth} and ${target.busWidth}`,
        );
        setTool("select");
        return;
      }
      const width = wireSource.busWidth ?? target.busWidth ?? DEFAULT_BUS_WIDTH;
      store.dispatch(addBusCmd(wireSource, target, width));
      setTool("select"); // one-shot (FR-040)
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
    const busSeg = hitBusSegment(store.design, world, 0.4);
    if (busSeg) {
      select({ kind: "bus", id: busSeg.bus.id });
      drag = null; // bus bend editing is wired up with the context-menu slice
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
    if (pan) {
      const scale = scaleFor(store.state.viewport);
      renderer.setViewport({
        pan: {
          x: pan.pan0.x - (e.clientX - pan.sx) / scale,
          y: pan.pan0.y - (e.clientY - pan.sy) / scale,
        },
        zoom: store.state.viewport.zoom,
      });
      return;
    }
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

  // Zoom to cursor with the wheel (FR-022).
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      renderer.setViewport(zoomAbout(store.state.viewport, canvasPoint(e), factor));
    },
    { passive: false },
  );

  window.addEventListener("mouseup", () => {
    if (pan) {
      pan = null;
      return;
    }
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
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });

  window.addEventListener("keydown", (e) => {
    // Ignore shortcuts while typing in a field (e.g., the save dialog).
    if (e.target instanceof HTMLInputElement || e.target.isContentEditable) return;

    if (e.code === "Space") {
      spaceDown = true;
      e.preventDefault(); // don't scroll the page
      return;
    }

    if (e.key === "Escape") {
      if (store.state.tool !== "select") setTool("select");
      else select(null);
      return;
    }

    // Undo/redo: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y (FR-024).
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      store.redo();
      return;
    }

    if (store.state.tool === "select" && e.key.toLowerCase() === "w") {
      setTool("wire");
      return;
    }
    if (store.state.tool === "select" && e.key.toLowerCase() === "b") {
      setTool("bus");
      return;
    }

    const sel = store.state.selection;
    if (!sel) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (sel.kind === "component") store.dispatch(deleteComponent(sel.refdes));
      else if (sel.kind === "wire") store.dispatch(deleteWireCmd(sel.id));
      else if (sel.kind === "bus") store.dispatch(deleteBusCmd(sel.id));
      select(null);
    } else if (e.key.toLowerCase() === "r" && sel.kind === "component") {
      e.preventDefault();
      store.dispatch(rotateComponent(sel.refdes, e.shiftKey ? -90 : 90));
    } else if (sel.kind === "bus" && (e.key === "+" || e.key === "=" || e.key === "-")) {
      // Stopgap width control until the right-click context menu (FR-038, S20).
      e.preventDefault();
      const bus = store.design.buses.find((b) => b.id === sel.id);
      const delta = e.key === "-" ? -1 : 1;
      store.dispatch(setBusWidthCmd(sel.id, Math.max(1, bus.width + delta)));
    }
  });

  // zoomBy zooms about the canvas center (toolbar +/- buttons).
  function zoomBy(factor) {
    const rect = canvas.getBoundingClientRect();
    renderer.setViewport(
      zoomAbout(store.state.viewport, { x: rect.width / 2, y: rect.height / 2 }, factor),
    );
  }

  return { setTool, zoomBy };
}
