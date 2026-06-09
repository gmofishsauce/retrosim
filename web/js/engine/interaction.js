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
  setBusBitNamesCmd,
  breakoutBitCmd,
  deleteBendCmd,
} from "../commands.js";
import {
  insertBend,
  moveBend,
  matchingGroups,
  pinWorldPos,
  packageSiblings,
} from "../model/design.js";
import {
  chooseGroupDialog,
  chooseBitDialog,
  promptWidthDialog,
  promptBitNamesDialog,
} from "../chrome/dialogs.js";
import { openContextMenu } from "../chrome/contextmenu.js";

const DEFAULT_BUS_WIDTH = 8;

// WIRE_CURSOR is the wire-drawing cursor (FR-025): a short lower-right→upper-left
// diagonal line, supplied inline as an SVG data-URI so no asset file or server
// MIME mapping is required. Hotspot is the line's upper-left endpoint (5,5);
// `crosshair` is the fallback.
const WIRE_CURSOR =
  "url('data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">' +
      '<line x1="5" y1="5" x2="17" y2="17" stroke="black" stroke-width="2.5" stroke-linecap="round"/></svg>',
  ) +
  "') 5 5, crosshair";

// planBusEndpoint converts a bus endpoint target into an addBus endpoint spec, an
// optional snap directive, and the list of width-matching pin groups. A component
// target with exactly one match auto-snaps (FR-041a); with zero it is left
// unconnected (FR-043); with two-or-more it stays free here and the caller opens
// the disambiguation dialog (FR-041b). Non-component
// targets pass through unchanged. Exported for testing.
export function planBusEndpoint(target, width) {
  if (target.kind === "component") {
    const spec = { kind: "free", x: target.x, y: target.y };
    const groups = matchingGroups(target.type, width);
    const snap =
      groups.length === 1 ? { refdes: target.refdes, group: groups[0].name } : null;
    return { spec, snap, groups, refdes: target.refdes };
  }
  return { spec: target, snap: null, groups: [] };
}

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
    canvas.style.cursor =
      tool === "select" ? "default" : tool === "wire" ? WIRE_CURSOR : "crosshair";
    renderer.setPreview(null); // clear any in-progress rubber-band
    store.setTool(tool, type ? type.name : null); // notifies subscribers (toolbar highlight, armed tile)
  }

  // previewAnchorWorld returns the world-space start point of an in-progress
  // wire/bus, used for the rubber-band preview (FR-027a).
  function previewAnchorWorld(src) {
    if (src.kind === "pin") {
      const inst = store.design.components.find((c) => c.refdes === src.refdes);
      return inst ? pinWorldPos(inst, src.pin) : null;
    }
    return { x: src.x, y: src.y };
  }

  function select(sel) {
    store.setSelection(sel); // notifies → canvas re-renders + properties panel updates
  }

  // deleteComponentConfirmed deletes a component, warning first before removing a
  // whole subunit package (FR-018b). Returns true if the delete was dispatched.
  function deleteComponentConfirmed(refdes) {
    const inst = store.design.components.find((c) => c.refdes === refdes);
    if (inst?.typeData?.renderType === "subunit") {
      const n = packageSiblings(store.design, refdes).length;
      if (!window.confirm(`Delete all ${n} units of package ${refdes}?`)) return false;
    }
    store.dispatch(deleteComponent(refdes));
    return true;
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const worldOf = (e) => screenToWorld(canvasPoint(e), store.state.viewport);
  const gridOf = (e) => snapToGrid(canvasPoint(e), store.state.viewport);

  // setHover records the refdes under the cursor (transient UI state) so the
  // renderer can show subunit connection ticks (FR-013c); re-renders only on
  // change, outside the command/undo path.
  function setHover(comp) {
    const refdes = comp ? comp.refdes : null;
    if (store.state.hover !== refdes) {
      store.state.hover = refdes;
      renderer.requestRender();
    }
  }

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

  // busTargetAt returns a bus endpoint spec: a branch on an existing bus, a
  // component (for snap-connect, FR-041), or a free grid point. Bus segments take
  // priority over component bodies (§6.9).
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
    const comp = hitComponent(store.design, world);
    if (comp) {
      return { kind: "component", refdes: comp.refdes, type: comp.typeData, x: g.x, y: g.y };
    }
    return { kind: "free", x: g.x, y: g.y };
  }

  // commitBus resolves both endpoints and dispatches one AddBus command with the
  // chosen snaps. For any endpoint matching two or more pin groups it opens the
  // disambiguation dialog (FR-041b); the bus is still created with that endpoint
  // unconnected if the user cancels. Async because the dialog is awaited.
  async function commitBus(srcTarget, dstTarget, width) {
    const a = planBusEndpoint(srcTarget, width);
    const b = planBusEndpoint(dstTarget, width);
    const snaps = [];
    for (const [end, plan] of [
      ["a", a],
      ["b", b],
    ]) {
      let snap = plan.snap;
      if (!snap && plan.groups.length >= 2) {
        const chosen = await chooseGroupDialog(plan.groups);
        if (chosen) snap = { refdes: plan.refdes, group: chosen };
      }
      if (snap) snaps.push({ end, ...snap });
    }
    store.dispatch(addBusCmd(a.spec, b.spec, width, snaps));
  }

  // startBreakout begins a single-bit tap off a bus (FR-043a): it picks the bit
  // (a dialog over the bus's bits/names) and, unless cancelled, arms a "breakout"
  // wire source. The destination is taken on the next click. Async for the dialog.
  async function startBreakout(busHit, e) {
    const g = gridOf(e);
    const bit = await chooseBitDialog(busHit.bus);
    if (bit === null) return; // cancelled — no partial wire
    wireSource = {
      kind: "breakout",
      busId: busHit.bus.id,
      segIndex: busHit.segIndex,
      x: g.x,
      y: g.y,
      bit,
    };
  }

  // breakoutDestAt returns the destination spec for a breakout wire's second
  // click: a component pin, or a free grid point (a dangling end is allowed,
  // FR-029). Branching onto another wire is not a breakout destination.
  function breakoutDestAt(e) {
    const ph = hitPin(store.design, worldOf(e), 0.5);
    if (ph) return { kind: "pin", refdes: ph.refdes, pin: ph.pin };
    const g = gridOf(e);
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
      if (!wireSource) {
        const world = worldOf(e);
        // Priority: pin > bus (breakout) > wire segment (branch). Empty space is
        // ignored (no partial wire).
        const ph = hitPin(store.design, world, 0.5);
        if (ph) {
          wireSource = { kind: "pin", refdes: ph.refdes, pin: ph.pin };
          return;
        }
        const bh = hitBusSegment(store.design, world, 0.4);
        if (bh) {
          startBreakout(bh, e); // async: pick bit, then await the destination click
          return;
        }
        const sh = hitSegment(store.design, world, 0.4);
        if (sh) {
          const g = gridOf(e);
          wireSource = { kind: "branch", wireId: sh.wire.id, segIndex: sh.segIndex, x: g.x, y: g.y };
        }
        return;
      }
      if (wireSource.kind === "breakout") {
        store.dispatch(
          breakoutBitCmd(
            wireSource.busId,
            wireSource.segIndex,
            wireSource.x,
            wireSource.y,
            wireSource.bit,
            breakoutDestAt(e),
          ),
        );
        setTool("select"); // one-shot (FR-028)
        return;
      }
      const target = wireTargetAt(e);
      if (!target) return; // ignore empty-space clicks (no partial wire)
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
      commitBus(wireSource, target, width);
      setTool("select"); // one-shot (FR-040)
      return;
    }

    // SELECT tool.
    const world = worldOf(e);
    // A pin is a wire hotspot (FR-027b): clicking one arms WIRE from that pin
    // (pins take priority over the component body, so this doesn't select/drag
    // the component) and reuses the WIRE machinery for preview/completion.
    const pinHit = hitPin(store.design, world, 0.5);
    if (pinHit) {
      setTool("wire"); // clears wireSource, sets wire cursor, highlights toolbar
      wireSource = { kind: "pin", refdes: pinHit.refdes, pin: pinHit.pin };
      return;
    }
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
    // Empty canvas: deselect now; a drag pans, a plain click just deselects
    // (FR-023a).
    select(null);
    startPan(e);
  });

  // Right-click context menu (FR-033b): hit-test the cursor and offer the actions
  // for the item under it. Priority mirrors select-mode: bend > wire > bus >
  // component. interaction.js builds the items; contextmenu.js renders them.
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const world = worldOf(e);
    const items = [];
    const bend = hitBend(store.design, world, 0.5);
    const seg = bend ? null : hitSegment(store.design, world, 0.4);
    const busSeg = bend || seg ? null : hitBusSegment(store.design, world, 0.4);
    const comp = bend || seg || busSeg ? null : hitComponent(store.design, world);

    if (bend) {
      items.push({
        label: "Delete bend point",
        onClick: () => store.dispatch(deleteBendCmd(bend.wire.id, bend.bendIndex)),
      });
    } else if (seg) {
      items.push({
        label: "Delete wire",
        danger: true,
        onClick: () => store.dispatch(deleteWireCmd(seg.wire.id)),
      });
    } else if (busSeg) {
      const bus = busSeg.bus;
      items.push({
        label: "Set width…",
        onClick: async () => {
          const width = await promptWidthDialog(bus.width);
          if (width != null) store.dispatch(setBusWidthCmd(bus.id, width));
        },
      });
      items.push({
        label: "Edit bit names…",
        onClick: async () => {
          const r = await promptBitNamesDialog(bus);
          if (r) store.dispatch(setBusBitNamesCmd(bus.id, r.names));
        },
      });
      items.push({ separator: true });
      items.push({
        label: "Delete bus",
        danger: true,
        onClick: () => store.dispatch(deleteBusCmd(bus.id)),
      });
    } else if (comp) {
      items.push({
        label: "Delete component",
        danger: true,
        onClick: () => deleteComponentConfirmed(comp.refdes),
      });
    }

    if (items.length) openContextMenu(e.clientX, e.clientY, items);
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
    if (wireSource) {
      const anchor = previewAnchorWorld(wireSource);
      if (anchor) {
        const g = gridOf(e);
        renderer.setPreview({ from: anchor, to: { x: g.x, y: g.y } });
      }
      return;
    }
    if (!drag) {
      const world = worldOf(e);
      setHover(hitComponent(store.design, world));
      // In select mode a pin is a wire hotspot (FR-027b): show the wire cursor
      // while hovering one, else the default pointer.
      if (store.state.tool === "select") {
        const overPin = !!hitPin(store.design, world, 0.5);
        canvas.style.cursor = overPin ? WIRE_CURSOR : "default";
      }
      return;
    }
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
      if (sel.kind === "component") {
        if (deleteComponentConfirmed(sel.refdes)) select(null);
      } else {
        if (sel.kind === "wire") store.dispatch(deleteWireCmd(sel.id));
        else if (sel.kind === "bus") store.dispatch(deleteBusCmd(sel.id));
        select(null);
      }
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
