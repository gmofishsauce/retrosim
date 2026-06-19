// Interaction: translates pointer/keyboard events into Commands (§6.9). This
// slice implements SELECT, PLACE, and WIRE tools. The FSM never mutates the
// model directly except for transient drag previews; committed changes go
// through the store as Commands.

import {
  snapToGrid,
  screenToWorld,
  scaleFor,
  zoomAbout,
  centerViewportOn,
  rotateOffset,
} from "../geometry.js";
import {
  hitComponent,
  hitPin,
  hitSegment,
  hitBend,
  hitJunction,
  hitBusSegment,
  marqueeHits,
} from "./hittest.js";
import { sameRef } from "../store.js";
import { proposeRoute } from "./router.js";
import {
  placeComponent,
  moveComponent,
  rotateSelectionCmd,
  deleteComponent,
  addWireCmd,
  deleteWireCmd,
  insertBendCmd,
  moveBendCmd,
  moveVertexCmd,
  addBusCmd,
  deleteBusCmd,
  setBusWidthCmd,
  setBusBitNamesCmd,
  breakoutBitCmd,
  deleteBendCmd,
  composite,
  translateWiring,
} from "../commands.js";
import {
  insertBend,
  moveBend,
  moveVertex,
  matchingGroups,
  pinVisualPos,
  pinWorldPos,
  sideOutward,
  packageSiblings,
  rigidWiring,
  getVertex,
  busGroupBrace,
  typeIdentity,
} from "../model/design.js";
import {
  chooseGroupDialog,
  chooseBitDialog,
  promptWidthDialog,
  promptBitNamesDialog,
} from "../chrome/dialogs.js";
import { INTERACTIONS } from "../builtins.js";
import { openContextMenu } from "../chrome/contextmenu.js";
import { postMessage } from "../chrome/statusbar.js";

// LOCKED_MSG is posted when a click attempts to select an item while the
// simulator is running (FR-087): editing — including selection — is locked.
const LOCKED_MSG = "Editor is locked while the simulator is running";

const DEFAULT_BUS_WIDTH = 8;

// WIRE_CURSOR is the wire-drawing cursor (FR-025): a diagonal line centered on
// the pointer, interrupted by a small open dot marking the active point; the
// hotspot is the image center (10,10). A symmetric glyph with a center hotspot
// keeps the visible aim point and the true active point coincident, including
// under cursor scaling, which preserves the center (§6.9). Supplied inline as
// an SVG data-URI so no asset file or server MIME mapping is required;
// `crosshair` is the fallback cursor.
const WIRE_CURSOR =
  "url('data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<g stroke="black" stroke-width="2" stroke-linecap="round" fill="none">' +
      '<line x1="3" y1="3" x2="7.4" y2="7.4"/>' +
      '<line x1="12.6" y1="12.6" x2="17" y2="17"/>' +
      '<circle cx="10" cy="10" r="2.2" stroke-width="1.5"/></g></svg>',
  ) +
  "') 10 10, crosshair";

// planBusEndpoint converts a bus endpoint target into an addBus endpoint spec, an
// optional snap directive, and the list of width-matching pin groups. A component
// target with exactly one match auto-snaps (FR-041a); with zero it is left
// unconnected (FR-043); with two-or-more it stays free here and the caller opens
// the disambiguation dialog (FR-041b). Non-component
// targets pass through unchanged. Exported for testing.
export function planBusEndpoint(target, width) {
  if (target.kind === "group") {
    // Proximity (FR-042a) already picked the specific group; snap directly with
    // the endpoint at the brace apex — no disambiguation needed.
    return {
      spec: { kind: "free", x: target.x, y: target.y },
      snap: { refdes: target.refdes, group: target.group },
      groups: [],
      refdes: target.refdes,
    };
  }
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

// ADD_TYPE is the sentinel "type" armed by the ADD palette tile (§6.14): instead
// of placing a component, a canvas click opens the Add sub-component flow. Its
// `name` matches the ADD tile so the armed-tile highlight (FR-009a) still works.
const ADD_TYPE = { name: "add", isAdd: true };

export function initInteraction({ canvas, palette, store, renderer, library, onAddSubDesign, onOpenSubDesign, onNewGalPart }) {
  let placeType = null; // ComponentType when tool === "place"
  let wireSource = null; // pending WIRE source spec
  let drag = null; // transient drag state for SELECT gestures
  let pan = null; // transient pan state { sx, sy, pan0 }
  let spaceDown = false; // space held -> left-drag pans

  const findType = (id) => library.find((c) => typeIdentity(c) === id);
  // Resolves a wire or bus id: bend drags apply to both (FR-039).
  const findWire = (id) =>
    store.design.wires.find((w) => w.id === id) ??
    store.design.buses.find((b) => b.id === id);

  function setTool(tool, type = null) {
    placeType = type;
    wireSource = null;
    const label = document.getElementById("tool-mode");
    if (label) label.textContent = tool === "place" ? `place ${typeIdentity(type)}` : tool;
    canvas.style.cursor =
      tool === "select" ? "default" : tool === "wire" ? WIRE_CURSOR : "crosshair";
    renderer.setPreview(null); // clear any in-progress rubber-band
    store.setTool(tool, type ? typeIdentity(type) : null); // notifies subscribers (toolbar highlight, armed tile)
  }

  // previewAnchorWorld returns the world-space start point of an in-progress
  // wire/bus, used for the rubber-band preview (FR-027a).
  function previewAnchorWorld(src) {
    if (src.kind === "pin") {
      const inst = store.design.components.find((c) => c.refdes === src.refdes);
      // Anchor the rubber band at the visual attachment point (FR-013d).
      return inst ? pinVisualPos(inst, src.pin) : null;
    }
    return { x: src.x, y: src.y };
  }

  // pinEscapeWorld returns a pin's outward facing unit vector (FR-027c pin
  // escape): the pin side's outward normal, instance-rotation aware. Null when
  // the side has no outward direction.
  function pinEscapeWorld(inst, pinName) {
    const pin = inst.typeData.pins.find((p) => p.name === pinName);
    const out = sideOutward(pin?.side);
    if (!out.x && !out.y) return null;
    return rotateOffset(out.x, out.y, inst.rotation);
  }

  // routerEndpoint turns a wire endpoint spec into a router endpoint (§6.9a):
  // a pin's on-grid point plus its escape direction; anything else its plain
  // world point.
  function routerEndpoint(src) {
    if (src.kind === "pin") {
      const inst = store.design.components.find((c) => c.refdes === src.refdes);
      if (!inst) return null;
      const w = pinWorldPos(inst, src.pin);
      const escape = pinEscapeWorld(inst, src.pin);
      return escape ? { ...w, escape } : w;
    }
    return { x: src.x, y: src.y };
  }

  // previewRoute computes the proposed-route polyline for the in-progress
  // wire/bus (FR-027a/FR-027c): from the source (with its pin escape) to the
  // snapped cursor — or to the hovered destination pin, escape and all, so the
  // preview matches what a click there would commit. Falls back to the
  // straight rubber band when the router finds no route. Endpoint *drawing*
  // positions use the FR-013d visual attachment points (the route itself runs
  // on grid points).
  function previewRoute(anchor, g, world) {
    // Breakout taps (FR-043a) keep the straight preview: they also commit
    // straight (breakoutBitCmd carries no bends), and the preview must not
    // promise a route the commit won't produce (§6.9).
    if (wireSource.kind === "breakout") return [anchor, { x: g.x, y: g.y }];
    const from = routerEndpoint(wireSource);
    let to = { x: g.x, y: g.y };
    let toVisual = null;
    const ph = hitPin(store.design, world);
    if (ph) {
      const inst = store.design.components.find((c) => c.refdes === ph.refdes);
      if (inst) {
        to = routerEndpoint({ kind: "pin", refdes: ph.refdes, pin: ph.pin });
        toVisual = pinVisualPos(inst, ph.pin);
      }
    }
    const route = from && to ? proposeRoute(store.design, from, to) : null;
    if (!route) return [anchor, { x: g.x, y: g.y }];
    route[0] = anchor;
    if (toVisual) route[route.length - 1] = toVisual;
    return route;
  }

  // routeBends returns the proposed route's interior corners for a committing
  // wire/bus, which become its initial bend points (FR-027c) — or [] for the
  // straight two-point fallback.
  function routeBends(srcSpec, dstSpec) {
    const from = routerEndpoint(srcSpec);
    const to = routerEndpoint(dstSpec);
    const route = from && to ? proposeRoute(store.design, from, to) : null;
    return route ? route.slice(1, -1) : [];
  }

  // select replaces the selection with a single object (plain click), or —
  // when additive (shift-click, FR-016a) — toggles that object's membership;
  // select(null) clears the selection. Notifies → canvas re-renders + properties
  // panel updates.
  function select(ref, additive = false) {
    if (!ref) store.setSelection([]);
    else if (additive) store.toggleSelection(ref);
    else store.setSelection([ref]);
  }

  // interactDuringSim applies an interactive built-in's input action on a
  // sim-time click (FR-087b): a non-undoable live mutation (store.applyLive)
  // that wakes the simulator to re-evaluate (§6.10/§6.13). The handler — e.g.
  // the switch's 0↔1 toggle (FR-087a) — comes from the INTERACTIONS registry,
  // so the FSM stays generic with no per-type special case.
  function interactDuringSim(inst, interact) {
    store.applyLive(() => interact(inst));
  }

  // beginMarquee starts a rubber-band selection on a bare-canvas press (FR-016b):
  // it records the press world point and screen x (for window/crossing direction),
  // the pre-drag selection (the base for Shift-add and Esc-restore), and whether
  // Shift is held. The selection is updated live during the drag (mousemove).
  function beginMarquee(e, world) {
    const pt = canvasPoint(e);
    drag = {
      type: "marquee",
      startWorld: world,
      startScreen: pt,
      base: [...store.state.selection],
      additive: e.shiftKey,
      moved: false,
    };
  }

  // mergeSel unions the marquee hits into the base selection without duplicates
  // (Shift-add, FR-016b).
  function mergeSel(base, hits) {
    return [...base, ...hits.filter((h) => !base.some((b) => sameRef(b, h)))];
  }

  // selectedComponentOrigins snapshots the pre-drag positions of every selected
  // component, so a group drag-move can offset them all together (FR-016a).
  function selectedComponentOrigins() {
    return store.state.selection
      .filter((r) => r.kind === "component")
      .map((r) => {
        const inst = store.design.components.find((c) => c.refdes === r.refdes);
        return { refdes: r.refdes, origX: inst.x, origY: inst.y };
      });
  }

  // rigidWiringSnapshot captures the interior wiring of a group move (FR-018c) —
  // the bend points and junction/free vertices that should travel with the moving
  // components — together with their pre-drag coordinates for live preview and
  // exact-revert commit. `movingRefdes` is a Set of the moving components' refdes.
  function rigidWiringSnapshot(movingRefdes) {
    const refs = rigidWiring(store.design, movingRefdes);
    const bends = refs.bends.map((b) => {
      const p = findWire(b.wireId).path[b.index];
      return { ...b, origX: p.x, origY: p.y };
    });
    const vertices = refs.vertices.map((id) => {
      const v = getVertex(store.design, id);
      return { id, origX: v.x, origY: v.y };
    });
    return { refs, bends, vertices };
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

  // deleteSelection deletes every selected object as one undoable composite
  // (FR-016a/FR-018a): wires, buses, and components — each subunit package once,
  // confirmed per FR-018b. A cancelled package confirmation aborts the whole
  // delete. Returns true if a delete was dispatched.
  function deleteSelection() {
    const cmds = [];
    const seenPkg = new Set();
    for (const ref of store.state.selection) {
      if (ref.kind === "wire") cmds.push(deleteWireCmd(ref.id));
      else if (ref.kind === "bus") cmds.push(deleteBusCmd(ref.id));
      else if (ref.kind === "component") {
        const inst = store.design.components.find((c) => c.refdes === ref.refdes);
        if (!inst) continue;
        if (inst.typeData?.renderType === "subunit") {
          const key = /^U\d+/.exec(ref.refdes)?.[0];
          if (seenPkg.has(key)) continue; // one delete per package
          seenPkg.add(key);
          const n = packageSiblings(store.design, ref.refdes).length;
          if (!window.confirm(`Delete all ${n} units of package ${ref.refdes}?`)) return false;
        }
        cmds.push(deleteComponent(ref.refdes));
      }
    }
    if (cmds.length === 0) return false;
    store.dispatch(cmds.length === 1 ? cmds[0] : composite(cmds, "Delete selection"));
    return true;
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  const worldOf = (e) => screenToWorld(canvasPoint(e), store.state.viewport);
  const gridOf = (e) => snapToGrid(canvasPoint(e), store.state.viewport);

  // Pick tolerances for thin conductors are constant in *screen pixels* and
  // converted to world units at the current zoom (§6.9), so the catch band
  // around a wire/bus segment or bend stays a comfortable, fixed size whatever
  // the zoom — a world-unit tolerance shrinks to a sub-pixel target when zoomed
  // out. Bends get a slightly larger band so they keep priority over the
  // segment they sit on.
  const SEG_PICK_PX = 6;
  const BEND_PICK_PX = 8;
  const segTol = () => SEG_PICK_PX / scaleFor(store.state.viewport);
  const bendTol = () => BEND_PICK_PX / scaleFor(store.state.viewport);

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
    // The ADD tile is not a component: it opens the Add sub-component flow
    // (§6.14), which runs its own dialog and dispatches placeSubDesign.
    if (placeType?.isAdd) {
      setTool("select");
      if (onAddSubDesign) onAddSubDesign(g.x, g.y);
      return;
    }
    store.dispatch(placeComponent(placeType, g.x, g.y, 0));
    const placed = store.design.components[store.design.components.length - 1];
    setTool("select");
    select({ kind: "component", refdes: placed.refdes });
  }

  // wireTargetAt returns a wire endpoint spec for a click: a pin, or a branch on
  // an existing segment, or null (empty space — ignored).
  function wireTargetAt(e) {
    const world = worldOf(e);
    const ph = hitPin(store.design, world);
    if (ph) return { kind: "pin", refdes: ph.refdes, pin: ph.pin };
    const sh = hitSegment(store.design, world, segTol());
    if (sh) {
      const g = gridOf(e);
      return { kind: "branch", wireId: sh.wire.id, segIndex: sh.segIndex, x: g.x, y: g.y };
    }
    return null;
  }

  // GROUP_SNAP_RANGE is how near (grid units) the cursor must come to a pin
  // group's pins (or its brace apex) for the group to become a bus termination
  // target — no click on the component body required (FR-042a).
  const GROUP_SNAP_RANGE = 2;

  // distToSegment returns the distance from point p to segment a–b.
  function distToSegment(p, a, b) {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + t * vx);
    const dy = p.y - (a.y + t * vy);
    return Math.hypot(dx, dy);
  }

  // busGroupAt returns the nearest width-matching pin group whose pins (or brace
  // apex) the cursor is within GROUP_SNAP_RANGE of, as { inst, group, brace } —
  // or null. Shared by the drag preview and the click commit so a click anywhere
  // the brace is shown terminates the bus at that group (FR-042a).
  function busGroupAt(world, width) {
    let best = null;
    let bestD = GROUP_SNAP_RANGE;
    for (const inst of store.design.components) {
      for (const group of matchingGroups(inst.typeData, width)) {
        const brace = busGroupBrace(inst, group);
        const d = Math.min(
          distToSegment(world, brace.a, brace.b),
          Math.hypot(brace.apex.x - world.x, brace.apex.y - world.y),
        );
        if (d < bestD) {
          bestD = d;
          best = { inst, group, brace };
        }
      }
    }
    return best;
  }

  // busTargetAt returns a bus endpoint spec: a branch on an existing bus, a pin
  // group the cursor is near (snap-connect at the brace apex, FR-042a), a
  // component body (FR-041, may disambiguate), or a free grid point. Priority:
  // bus segment > nearby group > component body > empty (§6.9).
  function busTargetAt(e, width) {
    const world = worldOf(e);
    const bh = hitBusSegment(store.design, world, segTol());
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
    const near = busGroupAt(world, width);
    if (near) {
      // Proximity already chose the specific group; the endpoint is the apex.
      return {
        kind: "group",
        refdes: near.inst.refdes,
        group: near.group.name,
        x: near.brace.apex.x,
        y: near.brace.apex.y,
        busWidth: near.group.pins.length,
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
    const specs = { a: a.spec, b: b.spec };
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
      if (snap) {
        snaps.push({ end, ...snap });
        // Place the snapped endpoint at the brace apex (FR-042a) so the bus
        // terminates there; the connection itself is the recorded group binding.
        const apex = busApex(snap.refdes, snap.group);
        if (apex) specs[end] = { kind: "free", x: apex.x, y: apex.y };
      }
    }
    store.dispatch(addBusCmd(specs.a, specs.b, width, snaps, routeBends(specs.a, specs.b)));
  }

  // busApex returns the group-snap brace apex (FR-042a) for a component's pin
  // group — the canonical attachment point a snapped bus endpoint is placed at.
  function busApex(refdes, groupName) {
    const inst = store.design.components.find((c) => c.refdes === refdes);
    const group = inst && (inst.typeData.pinGroups ?? []).find((g) => g.name === groupName);
    return group ? busGroupBrace(inst, group).apex : null;
  }

  // busGroupHoverPreview returns the bus-drag feedback when the cursor nears a
  // width-matching pin group (FR-042a): the nearest group's brace, plus — when a
  // bus is already in progress (`anchor` set) — the in-progress bus routed to the
  // brace apex. Returns null when not near any group (caller falls back to the
  // normal route preview, or clears the preview before the first click).
  function busGroupHoverPreview(anchor, e) {
    if (store.state.tool !== "bus") return null;
    const width = wireSource?.busWidth ?? DEFAULT_BUS_WIDTH;
    const near = busGroupAt(worldOf(e), width);
    if (!near) return null;
    const apex = near.brace.apex;
    if (!anchor) return { brace: near.brace }; // before the first click: brace only
    const from = routerEndpoint(wireSource);
    const route = from ? proposeRoute(store.design, from, apex) : null;
    const points = route ? [...route] : [anchor, apex];
    points[0] = anchor; // draw from the visual anchor (FR-013d)
    points[points.length - 1] = apex; // terminate exactly at the apex
    return { points, brace: near.brace };
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
    const ph = hitPin(store.design, worldOf(e));
    if (ph) return { kind: "pin", refdes: ph.refdes, pin: ph.pin };
    const g = gridOf(e);
    return { kind: "free", x: g.x, y: g.y };
  }

  // --- palette: click to arm PLACE, or drag a tile onto the canvas ---
  palette.addEventListener("click", (e) => {
    if (store.state.simulating) return; // placement disabled (FR-087)
    const tile = e.target.closest(".palette-tile");
    if (!tile) return;
    if (tile.dataset.type === "add") return setTool("place", ADD_TYPE); // §6.14
    if (tile.dataset.type === "newgal") return void onNewGalPart?.(); // FR-066c
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
    if (store.state.simulating) return; // placement disabled (FR-087)
    const data = e.dataTransfer.getData("text/plain");
    if (data === "add") {
      placeType = ADD_TYPE;
      placeAt(canvasPoint(e));
      return;
    }
    const type = findType(data);
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

    // Simulation lock (FR-087): pan only — no drags, no wire starts (pin
    // hotspots included), no placement, and no selection. The lone exception is
    // a click on an interactive built-in (FR-087b), which applies its input
    // action; any other click that would select an item posts the lock message.
    if (store.state.simulating) {
      const world = worldOf(e);
      const comp = hitComponent(store.design, world);
      if (comp) {
        const inst = store.design.components.find((c) => c.refdes === comp.refdes);
        const interact = inst && INTERACTIONS[inst.type];
        if (interact) return interactDuringSim(inst, interact);
      }
      // A click on a selectable item is locked: report it and change nothing. A
      // bare-canvas click is ignored silently (it was not selecting an item).
      const onItem =
        comp ||
        hitSegment(store.design, world, segTol()) ||
        hitBusSegment(store.design, world, segTol());
      if (onItem) postMessage(LOCKED_MSG);
      return;
    }

    if (store.state.tool === "place" && placeType) {
      placeAt(pt);
      return;
    }

    if (store.state.tool === "wire") {
      if (!wireSource) {
        const world = worldOf(e);
        // Priority: pin > bus (breakout) > wire segment (branch). Empty space is
        // ignored (no partial wire).
        const ph = hitPin(store.design, world);
        if (ph) {
          wireSource = { kind: "pin", refdes: ph.refdes, pin: ph.pin };
          return;
        }
        const bh = hitBusSegment(store.design, world, segTol());
        if (bh) {
          startBreakout(bh, e); // async: pick bit, then await the destination click
          return;
        }
        const sh = hitSegment(store.design, world, segTol());
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
      // Ignore a destination identical to the source (same pin clicked twice):
      // a zero-length self-wire is rejected by the model (§6.6); keep waiting
      // for a real destination instead of erroring.
      if (
        wireSource.kind === "pin" &&
        target.kind === "pin" &&
        wireSource.refdes === target.refdes &&
        wireSource.pin === target.pin
      ) {
        return;
      }
      store.dispatch(addWireCmd(wireSource, target, routeBends(wireSource, target)));
      setTool("select"); // one-shot (FR-028)
      return;
    }

    if (store.state.tool === "bus") {
      // The first endpoint sizes a fresh bus at the default width; the second
      // endpoint's group proximity is judged at the bus's actual width (FR-042a).
      const width = wireSource?.busWidth ?? DEFAULT_BUS_WIDTH;
      const target = busTargetAt(e, width);
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
      const finalWidth = wireSource.busWidth ?? target.busWidth ?? DEFAULT_BUS_WIDTH;
      commitBus(wireSource, target, finalWidth);
      setTool("select"); // one-shot (FR-040)
      return;
    }

    // SELECT tool.
    const world = worldOf(e);
    // A pin is a wire hotspot (FR-027b): clicking one arms WIRE from that pin
    // (pins take priority over the component body, so this doesn't select/drag
    // the component) and reuses the WIRE machinery for preview/completion.
    const pinHit = hitPin(store.design, world);
    if (pinHit) {
      setTool("wire"); // clears wireSource, sets wire cursor, highlights toolbar
      wireSource = { kind: "pin", refdes: pinHit.refdes, pin: pinHit.pin };
      return;
    }
    // A junction dot is draggable (FR-032a): the drag targets the shared vertex
    // so every conductor meeting there follows. Checked before bends — they
    // never coincide, but a junction node is the more specific target.
    const junction = hitJunction(store.design, world, bendTol());
    if (junction) {
      select({ kind: junction.wire.id.startsWith("b") ? "bus" : "wire", id: junction.wire.id });
      const v = getVertex(store.design, junction.vertexId);
      drag = {
        type: "junction",
        vertexId: junction.vertexId,
        origX: v.x,
        origY: v.y,
        moved: false,
      };
      return;
    }
    const bend = hitBend(store.design, world, bendTol());
    if (bend) {
      // hitBend covers wires and buses (FR-039); the id prefix carries the kind.
      select({ kind: bend.wire.id.startsWith("b") ? "bus" : "wire", id: bend.wire.id });
      const p = bend.wire.path[bend.bendIndex];
      drag = {
        type: "bend",
        wireId: bend.wire.id,
        bendIndex: bend.bendIndex,
        origX: p.x,
        origY: p.y,
        moved: false,
      };
      return;
    }
    const seg = hitSegment(store.design, world, segTol());
    if (seg) {
      select({ kind: "wire", id: seg.wire.id }, e.shiftKey);
      // A plain click selects; a drag inserts a bend here (decided on move).
      drag = { type: "segment", wireId: seg.wire.id, segIndex: seg.segIndex, tempIndex: -1, moved: false };
      return;
    }
    const busSeg = hitBusSegment(store.design, world, segTol());
    if (busSeg) {
      select({ kind: "bus", id: busSeg.bus.id }, e.shiftKey);
      // Same as wires (FR-039): a plain click selects; a drag inserts a bend.
      drag = { type: "segment", wireId: busSeg.bus.id, segIndex: busSeg.segIndex, tempIndex: -1, moved: false };
      return;
    }
    const comp = hitComponent(store.design, world);
    if (comp) {
      const ref = { kind: "component", refdes: comp.refdes };
      const already = store.isSelected(ref);
      // Shift toggles; a plain click on an unselected component selects it alone;
      // a plain press on an already-selected member keeps the whole selection so
      // the group can be dragged, collapsing to just this one only if the press
      // turns out to be a click with no drag (FR-016a).
      if (e.shiftKey) store.toggleSelection(ref);
      else if (!already) store.setSelection([ref]);
      const start = gridOf(e);
      const members = selectedComponentOrigins();
      drag = {
        type: "component",
        members,
        wiring: rigidWiringSnapshot(new Set(members.map((m) => m.refdes))),
        startX: start.x,
        startY: start.y,
        moved: false,
        collapseTo: !e.shiftKey && already ? ref : null,
      };
      return;
    }
    // Bare canvas: begin a rubber-band selection (FR-016b/FR-023a). A release
    // without dragging clears (plain) or preserves (Shift) the selection;
    // dragging selects window (drag right) or crossing (drag left).
    beginMarquee(e, world);
  });

  // subDesignAt returns the sub-design instance under a world point, or null.
  function subDesignAt(world) {
    const comp = hitComponent(store.design, world);
    if (!comp) return null;
    const inst = store.design.components.find((c) => c.refdes === comp.refdes);
    return inst?.kind === "subdesign" ? inst : null;
  }

  // Double-click descends into a sub-design instance (FR-100): navigation is a
  // save-or-lose Open, so it is suppressed while simulating (a design swap mid-
  // sim would be jarring; consistent with the menu actions below).
  canvas.addEventListener("dblclick", (e) => {
    if (store.state.simulating) return;
    const inst = subDesignAt(worldOf(e));
    if (inst && onOpenSubDesign) onOpenSubDesign(inst.childPath);
  });

  // Right-click context menu (FR-033b): hit-test the cursor and offer the actions
  // for the item under it. Priority mirrors select-mode: bend > wire > bus >
  // component. interaction.js builds the items; contextmenu.js renders them.
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const world = worldOf(e);
    const bend = hitBend(store.design, world, bendTol());
    const seg = bend ? null : hitSegment(store.design, world, segTol());
    const busSeg = bend || seg ? null : hitBusSegment(store.design, world, segTol());
    const comp = bend || seg || busSeg ? null : hitComponent(store.design, world);

    if (!bend && !seg && !busSeg && !comp) {
      // Bare canvas: recenter the view on the cursor (FR-023b); allowed even
      // while simulating (a view change, not a design mutation).
      const rect = canvas.getBoundingClientRect();
      renderer.setViewport(
        centerViewportOn(store.state.viewport, world, rect.width, rect.height),
      );
      return;
    }
    if (store.state.simulating) return; // menu actions mutate (FR-087)
    const items = [];

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
      const inst = store.design.components.find((c) => c.refdes === comp.refdes);
      if (inst?.kind === "subdesign" && onOpenSubDesign) {
        items.push({
          label: "Open sub-design",
          onClick: () => onOpenSubDesign(inst.childPath),
        });
        items.push({ separator: true });
      }
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
        // Near a width-matching pin group, preview its group-snap brace and route
        // the in-progress bus to the apex (FR-042a); else the normal route preview.
        const groupPreview = busGroupHoverPreview(anchor, e);
        renderer.setPreview(
          groupPreview ?? { points: previewRoute(anchor, gridOf(e), worldOf(e)) },
        );
      }
      return;
    }
    if (!drag) {
      const world = worldOf(e);
      setHover(hitComponent(store.design, world));
      // In select mode a pin is a wire hotspot (FR-027b): show the wire cursor
      // while hovering one, else the default pointer.
      if (store.state.tool === "select") {
        const overPin = !!hitPin(store.design, world);
        canvas.style.cursor = overPin ? WIRE_CURSOR : "default";
      } else if (store.state.tool === "bus") {
        // Before the first click, still preview a group's brace when near it, so
        // the user can see (and click to start the bus at) a termination point.
        const gp = busGroupHoverPreview(null, e);
        renderer.setPreview(gp ?? null);
      }
      return;
    }

    if (drag.type === "marquee") {
      const pt = canvasPoint(e);
      // A few pixels of slop distinguishes a click from a rubber-band drag.
      if (!drag.moved && Math.hypot(pt.x - drag.startScreen.x, pt.y - drag.startScreen.y) <= 3) {
        return;
      }
      drag.moved = true;
      const world = worldOf(e);
      const mode = pt.x >= drag.startScreen.x ? "window" : "crossing";
      const hits = marqueeHits(store.design, drag.startWorld, world, mode);
      store.setSelection(drag.additive ? mergeSel(drag.base, hits) : hits);
      renderer.setMarquee?.({ a: drag.startWorld, b: world, mode });
      return;
    }

    const g = gridOf(e);

    if (drag.type === "component") {
      const offX = g.x - drag.startX;
      const offY = g.y - drag.startY;
      let changed = false;
      for (const m of drag.members) {
        const inst = store.design.components.find((c) => c.refdes === m.refdes);
        const nx = m.origX + offX;
        const ny = m.origY + offY;
        if (inst && (inst.x !== nx || inst.y !== ny)) {
          inst.x = nx;
          inst.y = ny;
          changed = true;
        }
      }
      if (changed) {
        // The interior wiring travels rigidly with the components (FR-018c).
        for (const b of drag.wiring.bends) {
          const p = findWire(b.wireId).path[b.index];
          p.x = b.origX + offX;
          p.y = b.origY + offY;
        }
        for (const v of drag.wiring.vertices) {
          const vx = getVertex(store.design, v.id);
          vx.x = v.origX + offX;
          vx.y = v.origY + offY;
        }
        drag.moved = true;
        renderer.requestRender();
      }
      return;
    }

    if (drag.type === "junction") {
      // Move the shared vertex (FR-032a); every conductor at the junction
      // rubber-bands with it.
      moveVertex(store.design, drag.vertexId, g.x, g.y);
      drag.moved = true;
      renderer.requestRender();
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

    if (drag.type === "marquee") {
      if (!drag.moved && !drag.additive) {
        // A plain click on bare canvas clears the selection (FR-023a); a Shift
        // click preserves it. A dragged rubber-band already set the selection live.
        store.setSelection([]);
      }
      renderer.setMarquee?.(null);
      drag = null;
      return;
    }

    if (drag.type === "component") {
      if (drag.moved) {
        // The whole group moved by one offset; read it off any member before rewind.
        const m0 = drag.members[0];
        const inst0 = store.design.components.find((c) => c.refdes === m0.refdes);
        const off = { x: inst0.x - m0.origX, y: inst0.y - m0.origY };
        // Rewind each member to its pre-drag position so the commands capture the
        // true old positions for undo, then dispatch as one step (FR-016a/FR-024).
        const cmds = drag.members.map((m) => {
          const inst = store.design.components.find((c) => c.refdes === m.refdes);
          const fx = inst.x;
          const fy = inst.y;
          inst.x = m.origX;
          inst.y = m.origY;
          return moveComponent(m.refdes, fx, fy);
        });
        // Rewind the interior wiring and re-apply it through a command (FR-018c).
        if (drag.wiring.refs.bends.length || drag.wiring.refs.vertices.length) {
          for (const b of drag.wiring.bends) {
            const p = findWire(b.wireId).path[b.index];
            p.x = b.origX;
            p.y = b.origY;
          }
          for (const v of drag.wiring.vertices) {
            const vx = getVertex(store.design, v.id);
            vx.x = v.origX;
            vx.y = v.origY;
          }
          cmds.push(translateWiring(drag.wiring.refs, off.x, off.y));
        }
        store.dispatch(cmds.length === 1 ? cmds[0] : composite(cmds, "Move selection"));
      } else if (drag.collapseTo) {
        store.setSelection([drag.collapseTo]); // plain click on a member collapses
      }
      drag = null;
      return;
    }

    if (drag.type === "junction" && drag.moved) {
      const v = getVertex(store.design, drag.vertexId);
      const fx = v.x;
      const fy = v.y;
      // Rewind the live preview so the command captures the true old position
      // for undo (FR-024/FR-032a).
      moveVertex(store.design, drag.vertexId, drag.origX, drag.origY);
      store.dispatch(moveVertexCmd(drag.vertexId, fx, fy));
    } else if (drag.type === "bend" && drag.moved) {
      const w = findWire(drag.wireId);
      const p = w.path[drag.bendIndex];
      const fx = p.x;
      const fy = p.y;
      // Rewind the live preview to the pre-drag position so the command
      // captures the true old position for undo (FR-024/FR-032).
      moveBend(w, drag.bendIndex, drag.origX, drag.origY);
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
      if (drag?.type === "marquee") {
        // Cancel the rubber-band, restoring the pre-drag selection (FR-016b).
        store.setSelection(drag.base);
        renderer.setMarquee?.(null);
        drag = null;
        return;
      }
      if (store.state.tool !== "select") setTool("select");
      else select(null);
      return;
    }

    // Simulation lock (FR-087): Space (pan) and Escape stay; every shortcut
    // below mutates the design or arms a mutating tool.
    if (store.state.simulating) return;

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
    if (sel.length === 0) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (deleteSelection()) select(null);
    } else if (e.key.toLowerCase() === "r") {
      e.preventDefault();
      const delta = e.shiftKey ? -90 : 90;
      // Rotate the selection as one rigid group about a single pivot, carrying
      // interior bends/junctions (FR-019/FR-018c).
      const refdeses = sel.filter((r) => r.kind === "component").map((r) => r.refdes);
      if (refdeses.length > 0) {
        store.dispatch(rotateSelectionCmd(refdeses, delta));
      }
    } else if (
      (e.key === "+" || e.key === "=" || e.key === "-") &&
      sel.length === 1 &&
      sel[0].kind === "bus"
    ) {
      // Stopgap width control until the right-click context menu (FR-038, S20).
      e.preventDefault();
      const bus = store.design.buses.find((b) => b.id === sel[0].id);
      const delta = e.key === "-" ? -1 : 1;
      store.dispatch(setBusWidthCmd(sel[0].id, Math.max(1, bus.width + delta)));
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
