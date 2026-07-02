// Interaction: translates pointer/keyboard events into Commands (§6.9). This
// slice implements SELECT, PLACE, and WIRE tools. The FSM never mutates the
// model directly except for transient drag previews; committed changes go
// through the store as Commands.

import {
  snapToGrid,
  screenToWorld,
  worldToScreen,
  scaleFor,
  zoomAbout,
  centerViewportOn,
  clampZoom,
  PX_PER_UNIT_DEFAULT,
  rotateOffset,
  isRedundantBend,
  pruneCollinearBends,
} from "../geometry.js";
import {
  hitComponent,
  hitPin,
  hitSegment,
  hitBend,
  hitJunction,
  hitBusSegment,
  marqueeHits,
  componentBBox,
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
  deleteSegmentCmd,
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
  pasteFragmentCmd,
  setNoteTextCmd,
} from "../commands.js";
import { extractFragment } from "../model/clipboard.js";
import {
  insertBend,
  moveBend,
  moveVertex,
  groupFreeBlock,
  groupsAcceptingBus,
  pinVisualPos,
  pinWorldPos,
  sideOutward,
  packageSiblings,
  rigidWiring,
  getVertex,
  danglingEndAt,
  busGroupBrace,
  typeIdentity,
  NOTE_PAD,
  NOTE_LINE,
  NOTE_FONT,
} from "../model/design.js";
import {
  chooseGroupDialog,
  chooseBitDialog,
  promptWidthDialog,
  promptPortWidthDialog,
  promptBitNamesDialog,
} from "../chrome/dialogs.js";
import {
  INTERACTIONS,
  portNFields,
  PORTN_MIN_WIDTH,
  PORTN_MAX_WIDTH,
  PORTN_DEFAULT_WIDTH,
} from "../builtins.js";
import { openContextMenu } from "../chrome/contextmenu.js";
import { postMessage } from "../chrome/statusbar.js";

// LOCKED_MSG is posted when a click attempts to select an item while the
// simulator is running (FR-087): editing — including selection — is locked.
const LOCKED_MSG = "Editor is locked while the simulator is running";
// VEC_LOCKED_MSG is the same notice for the open test-vector panel (FR-115h).
const VEC_LOCKED_MSG = "Editor is locked while the Test Vectors panel is open";

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
// optional snap directive, and the list of accepting pin groups (FR-041/FR-041c).
// A component target with exactly one accepting group auto-snaps (FR-041a); with
// zero it is left unconnected (FR-043); with two-or-more it stays free here and the
// caller opens the disambiguation dialog (FR-041b). Non-component targets pass
// through unchanged. Exported for testing.
export function planBusEndpoint(design, target, width) {
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
    const inst = design.components.find((c) => c.refdes === target.refdes);
    const accepting = inst ? groupsAcceptingBus(design, inst, width) : [];
    const groups = accepting.map((a) => a.group);
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

export function initInteraction({ canvas, palette, store, renderer, library, fileops, onAddSubDesign, onOpenSubDesign, onNewGalPart, onNewMemDevice }) {
  let placeType = null; // ComponentType when tool === "place"
  let wireSource = null; // pending WIRE source spec
  let wireWaypoints = []; // locked intermediate waypoints for the in-progress wire/bus (FR-027e)
  let lastMove = null; // last mousemove event, for refreshing the preview after a Backspace pop
  let drag = null; // transient drag state for SELECT gestures
  let pan = null; // transient pan state { sx, sy, pan0 }
  let pendingZoomAnchor = null; // {x,y} screen pt to anchor the next zoom after a right-click recenter (FR-023b); cleared on pointer move
  let spaceDown = false; // space held -> left-drag pans
  let clipboard = null; // session copy fragment (FR-111); survives New/Open
  let pasteFrag = null; // fragment armed for placement while tool === "paste"
  let pasteAnchor = null; // {x,y} fragment anchor that tracks the cursor (FR-113)
  let lastPointer = null; // last mousemove event, to seat the ghost on paste start
  let editingNote = null; // active note text-entry { refdes, el (textarea) } (FR-071f)

  const findType = (id) => library.find((c) => typeIdentity(c) === id);
  // Resolves a wire or bus id: bend drags apply to both (FR-039).
  const findWire = (id) =>
    store.design.wires.find((w) => w.id === id) ??
    store.design.buses.find((b) => b.id === id);

  // pathPointXY resolves a conductor path point's grid coordinate: a bend carries
  // its own (x,y); a node defers to its vertex. Null if the vertex is missing.
  function pathPointXY(conductor, index) {
    const pt = conductor.path[index];
    if (!pt) return null;
    if (pt.t === "bend") return { x: pt.x, y: pt.y };
    const v = getVertex(store.design, pt.v);
    return v ? { x: v.x, y: v.y } : null;
  }

  function setTool(tool, type = null) {
    commitNoteEdit(); // leaving for any tool commits an in-progress note (FR-071f)
    placeType = type;
    wireSource = null;
    wireWaypoints = []; // discard any in-progress waypoints (FR-027e)
    // Leaving paste mode cancels a pending paste (FR-113); entering it keeps it.
    if (tool !== "paste") {
      pasteFrag = null;
      pasteAnchor = null;
      renderer.setGhost?.(null);
    }
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
  function previewRoute(srcSpec, anchor, g, world) {
    // Breakout taps (FR-043a) keep the straight preview: they also commit
    // straight (breakoutBitCmd carries no bends), and the preview must not
    // promise a route the commit won't produce (§6.9).
    if (srcSpec.kind === "breakout") return [anchor, { x: g.x, y: g.y }];
    const from = routerEndpoint(srcSpec);
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

  // waypointSpecs turns the locked waypoint coords (FR-027e) into free endpoint
  // specs the router/leg helpers can consume.
  const waypointSpecs = () => wireWaypoints.map((p) => ({ kind: "free", x: p.x, y: p.y }));

  // legBends concatenates the interior corners of every leg between consecutive
  // stops (source, locked waypoints, destination), inserting each waypoint coord
  // between legs (FR-027e). The result is the committing conductor's full bend
  // list; with no waypoints it equals routeBends. Waypoints become ordinary,
  // draggable bend points — nothing marks them special after commit.
  function legBends(stops) {
    const bends = [];
    for (let i = 0; i < stops.length - 1; i++) {
      bends.push(...routeBends(stops[i], stops[i + 1]));
      if (i < stops.length - 2) bends.push({ x: stops[i + 1].x, y: stops[i + 1].y });
    }
    return bends;
  }

  // prunedLegBends is legBends with non-bending (collinear) bend points removed
  // (FR-033c). It rebuilds the committing conductor's full polyline — the resolved
  // source/target coordinates around the leg bends — prunes it, and returns the
  // surviving interior bends. When an endpoint coordinate cannot be resolved it
  // falls back to the unpruned bends rather than guess.
  function prunedLegBends(stops) {
    const a = routerEndpoint(stops[0]);
    const b = routerEndpoint(stops[stops.length - 1]);
    const bends = legBends(stops);
    if (!a || !b) return bends;
    return pruneCollinearBends([a, ...bends, b]).slice(1, -1);
  }

  // legPolyline returns one leg's grid-point polyline for the preview: the routed
  // corners (endpoints forced to the leg's grid points) or the straight fallback.
  function legPolyline(srcSpec, dstSpec) {
    const from = routerEndpoint(srcSpec);
    const to = routerEndpoint(dstSpec);
    const route = from && to ? proposeRoute(store.design, from, to) : null;
    if (route) {
      route[0] = { x: from.x, y: from.y };
      route[route.length - 1] = { x: to.x, y: to.y };
      return route;
    }
    return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  }

  // concatDedup appends b to a, dropping b's first point when it coincides with
  // a's last (legs share their waypoint endpoint).
  function concatDedup(a, b) {
    if (!a.length) return [...b];
    const last = a[a.length - 1];
    const start = b[0] && Math.abs(b[0].x - last.x) < 1e-9 && Math.abs(b[0].y - last.y) < 1e-9 ? 1 : 0;
    return [...a, ...b.slice(start)];
  }

  // lockedLegPoints returns the fixed polyline through source→waypoint₁→…→last
  // waypoint (FR-027e), the first point drawn from the visual anchor (FR-013d).
  // With no waypoints it is just [anchor], so the live leg supplies the whole
  // preview.
  function lockedLegPoints(anchor) {
    const stops = [wireSource, ...waypointSpecs()];
    if (stops.length === 1) return [anchor];
    let pts = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = legPolyline(stops[i], stops[i + 1]);
      if (i === 0) seg[0] = anchor;
      pts = concatDedup(pts, seg);
    }
    return pts;
  }

  // updateWirePreview renders the in-progress conductor (FR-027a/FR-027e): the
  // fixed locked legs followed by the live leg from the last waypoint (or the
  // source) to the cursor — or to a hovered pin / pin-group brace. Called on
  // mousemove and again after a Backspace pop so the picture refreshes at once.
  function updateWirePreview(e) {
    const anchor = previewAnchorWorld(wireSource);
    if (!anchor) return;
    const locked = lockedLegPoints(anchor);
    const specs = waypointSpecs();
    const liveSrc = specs.length ? specs[specs.length - 1] : wireSource;
    const liveAnchor = locked[locked.length - 1];
    const gp = busGroupHoverPreview(liveSrc, liveAnchor, e);
    const live = gp ? gp.points : previewRoute(liveSrc, liveAnchor, gridOf(e), worldOf(e));
    const points = concatDedup(locked, live);
    // A bus started on a pin-group snap keeps that source brace shown for the whole
    // drag, regardless of where the cursor is (FR-042b).
    const sourceBrace =
      wireSource && wireSource.kind === "group"
        ? busBrace(wireSource.refdes, wireSource.group, wireSource.busWidth)
        : null;
    renderer.setPreview({ points, brace: gp ? gp.brace : null, sourceBrace });
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
    // Group segment selections (FR-033d) by conductor: a single selected segment
    // deletes just that leg; several of the same conductor delete the whole
    // conductor, since each split invalidates the others' indices.
    const segByCond = new Map();
    for (const ref of store.state.selection) {
      if (ref.kind !== "segment") continue;
      if (!segByCond.has(ref.id)) segByCond.set(ref.id, []);
      segByCond.get(ref.id).push(ref.segIndex);
    }
    for (const [id, idxs] of segByCond) {
      if (idxs.length === 1) cmds.push(deleteSegmentCmd(id, idxs[0]));
      else if (store.design.wires.some((w) => w.id === id)) cmds.push(deleteWireCmd(id));
      else cmds.push(deleteBusCmd(id));
    }
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

  async function placeAt(screenPt) {
    const g = snapToGrid(screenPt, store.state.viewport);
    // The ADD tile is not a component: it opens the Add sub-component flow
    // (§6.14), which runs its own dialog and dispatches placeSubDesign.
    if (placeType?.isAdd) {
      setTool("select");
      if (onAddSubDesign) onAddSubDesign(g.x, g.y);
      return;
    }
    let type = placeType;
    // A multi-bit port's bit width is chosen at placement (FR-071e): prompt for
    // it, then bake the width-driven pins/group/footprint into the type. Cancel
    // (or out-of-range input) places nothing.
    if (placeType.renderType === "portN") {
      const width = await promptPortWidthDialog(
        PORTN_DEFAULT_WIDTH,
        PORTN_MIN_WIDTH,
        PORTN_MAX_WIDTH,
      );
      if (width == null) {
        setTool("select");
        return;
      }
      type = { ...placeType, ...portNFields(width) };
    }
    store.dispatch(placeComponent(type, g.x, g.y, 0));
    const placed = store.design.components[store.design.components.length - 1];
    setTool("select");
    select({ kind: "component", refdes: placed.refdes });
    // A freshly placed note opens straight into text-entry (FR-071f).
    if (placed.typeData.renderType === "note") startNoteEdit(placed);
  }

  // startNoteEdit opens text-entry on a note by overlaying a real DOM <textarea>
  // over it (FR-071f, OQ-011): the browser owns the caret, selection, and
  // clipboard. The canvas note is hidden (renderer.setEditingNote) so only the
  // overlay shows. The overlay is unrotated regardless of the note's rotation.
  function startNoteEdit(inst) {
    if (store.isReadonly()) return; // editing is locked (FR-087/FR-115h)
    commitNoteEdit(); // close any prior edit first
    select({ kind: "component", refdes: inst.refdes });

    const ta = document.createElement("textarea");
    ta.className = "note-editor";
    ta.value = inst.text || "";
    ta.wrap = "off";
    ta.spellcheck = false;
    positionNoteEditor(ta, inst);

    ta.addEventListener("keydown", (e) => {
      // Enter commits (Shift+Enter falls through to insert a newline natively);
      // Escape commits. Both are swallowed so they don't bubble to the canvas.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitNoteEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        commitNoteEdit();
      }
      e.stopPropagation();
    });
    ta.addEventListener("blur", () => commitNoteEdit());
    // Grow the box to fit as the user types (approximate, unrotated).
    ta.addEventListener("input", () => sizeNoteEditor(ta));

    document.body.appendChild(ta);
    editingNote = { refdes: inst.refdes, el: ta };
    renderer.setEditingNote?.(inst.refdes); // hide the canvas note while editing
    // Defer focus to the next frame so the placing/double-click mousedown's own
    // default focus handling can't steal it back.
    requestAnimationFrame(() => {
      if (editingNote?.el !== ta) return; // edit already ended
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length); // caret at end
    });
  }

  // positionNoteEditor places and styles the overlay over the note, approximating
  // the canvas text metrics (NOTE_* constants × scale). Position is viewport-fixed
  // from the note's screen point plus the canvas's client rect.
  function positionNoteEditor(ta, inst) {
    const vp = store.state.viewport;
    const scale = scaleFor(vp);
    const rect = canvas.getBoundingClientRect();
    const s = worldToScreen({ x: inst.x, y: inst.y }, vp);
    const pad = NOTE_PAD * scale;
    Object.assign(ta.style, {
      position: "fixed",
      left: rect.left + s.x + "px",
      top: rect.top + s.y + "px",
      font: Math.round(NOTE_FONT * scale) + "px system-ui, sans-serif",
      lineHeight: NOTE_LINE * scale + "px",
      padding: pad + "px",
      margin: "0",
      boxSizing: "border-box",
      border: "2px solid #4a90d9",
      background: "#fff",
      resize: "none",
      overflow: "hidden",
      whiteSpace: "pre",
      zIndex: "1000",
    });
    sizeNoteEditor(ta);
  }

  // sizeNoteEditor grows the overlay to fit its content (approximate).
  function sizeNoteEditor(ta) {
    const scale = scaleFor(store.state.viewport);
    ta.style.width = "auto";
    ta.style.height = "auto";
    ta.style.width = Math.max(ta.scrollWidth, 4 * scale) + "px";
    ta.style.height = Math.max(ta.scrollHeight, 2 * scale) + "px";
  }

  // commitNoteEdit ends text-entry: it removes the overlay, un-hides the canvas
  // note, and dispatches one undoable setNoteText command only when the text
  // actually changed (FR-071f). Idempotent — a no-op when not editing — so blur,
  // Enter, and an outside click can all call it safely.
  function commitNoteEdit() {
    if (!editingNote) return;
    const { refdes, el } = editingNote;
    const text = el.value;
    editingNote = null;
    el.remove();
    renderer.setEditingNote?.(null);
    const inst = store.design.components.find((c) => c.refdes === refdes);
    if (inst && text !== (inst.text ?? "")) store.dispatch(setNoteTextCmd(refdes, text));
  }

  // copySelection captures the selected components and their interior wiring into
  // the session clipboard (FR-111). Read-only: no design mutation, allowed even
  // while simulating. A selection with no components is a no-op.
  function copySelection() {
    const refdeses = store.state.selection
      .filter((r) => r.kind === "component")
      .map((r) => r.refdes);
    if (refdeses.length === 0) return;
    const frag = extractFragment(store.design, refdeses);
    if (frag.components.length > 0) clipboard = frag;
  }

  // fragmentAnchor is the grid point the cursor tracks during paste placement
  // (FR-113): the top-left of the fragment components' origins (all on grid).
  function fragmentAnchor(frag) {
    let x = Infinity;
    let y = Infinity;
    for (const c of frag.components) {
      x = Math.min(x, c.x);
      y = Math.min(y, c.y);
    }
    return { x, y };
  }

  // ghostOffset is the (dx,dy) that maps the fragment anchor to grid point g.
  function ghostOffset(g) {
    return { dx: g.x - pasteAnchor.x, dy: g.y - pasteAnchor.y };
  }

  // startPaste arms the clipboard fragment for at-cursor placement (FR-113): a
  // floating ghost follows the pointer until a click drops it. Disabled while
  // simulating (FR-087); a no-op when the clipboard is empty.
  function startPaste() {
    if (store.isReadonly()) return;
    if (!clipboard) return;
    pasteFrag = clipboard;
    pasteAnchor = fragmentAnchor(pasteFrag);
    setTool("paste");
    // Seat the ghost at the last known pointer, else the canvas center until the
    // pointer enters (FR-113).
    const g = lastPointer
      ? gridOf(lastPointer)
      : snapToGrid(
          { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 },
          store.state.viewport,
        );
    const { dx, dy } = ghostOffset(g);
    renderer.setGhost?.({ fragment: pasteFrag, dx, dy });
  }

  // updatePasteGhost re-seats the ghost as the cursor moves (FR-113).
  function updatePasteGhost(e) {
    const { dx, dy } = ghostOffset(gridOf(e));
    renderer.setGhost?.({ fragment: pasteFrag, dx, dy });
  }

  // commitPaste drops the fragment at the cursor (FR-112/FR-113): one undoable
  // paste, then return to select with the pasted objects selected.
  function commitPaste(e) {
    const { dx, dy } = ghostOffset(gridOf(e));
    const cmd = pasteFragmentCmd(pasteFrag, dx, dy);
    store.dispatch(cmd);
    const created = cmd.created.map((refdes) => ({ kind: "component", refdes }));
    setTool("select"); // clears the ghost and disarms paste
    store.setSelection(created);
  }

  // wireTargetAt returns a wire endpoint spec for a click: a pin, or a branch on
  // an existing segment, or null (empty space — ignored).
  function wireTargetAt(e) {
    const world = worldOf(e);
    const ph = hitPin(store.design, world);
    if (ph) return { kind: "pin", refdes: ph.refdes, pin: ph.pin };
    // A dangling wire end joins instead of branching a junction (FR-034c); checked
    // before the segment hit, which would otherwise see the host wire's last leg.
    const de = danglingEndAt(store.design, world, bendTol());
    if (de && !de.isBus) return { kind: "vertex", id: de.vertex.id, x: de.vertex.x, y: de.vertex.y };
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
  // the brace is shown terminates the bus at that group (FR-042a). A null width
  // means "any width" — every group is a candidate, used for the first endpoint
  // before the bus has a committed width so a fresh bus adopts the group's width
  // (FR-042c).
  function busGroupAt(world, width) {
    let best = null;
    let bestD = GROUP_SNAP_RANGE;
    for (const inst of store.design.components) {
      for (const { group, block } of groupsAcceptingBus(store.design, inst, width)) {
        const brace = busGroupBrace(inst, block);
        const d = Math.min(
          distToSegment(world, brace.a, brace.b),
          Math.hypot(brace.apex.x - world.x, brace.apex.y - world.y),
        );
        if (d < bestD) {
          bestD = d;
          best = { inst, group, block, brace };
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
    // A dangling bus end of matching width joins instead of branching (FR-034c);
    // checked before the segment hit. A width mismatch falls through to the branch
    // path, where the FR-039a check rejects it. (width == null = first endpoint.)
    const de = danglingEndAt(store.design, world, bendTol());
    if (de && de.isBus && (width == null || de.width === width)) {
      return { kind: "vertex", id: de.vertex.id, x: de.vertex.x, y: de.vertex.y, busWidth: de.width };
    }
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
      // Proximity already chose the group and its pack-low block; the endpoint is
      // the block's apex and the bus takes the block's width (FR-041c/FR-042c).
      return {
        kind: "group",
        refdes: near.inst.refdes,
        group: near.group.name,
        x: near.brace.apex.x,
        y: near.brace.apex.y,
        busWidth: near.block.length,
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
    const a = planBusEndpoint(store.design, srcTarget, width);
    const b = planBusEndpoint(store.design, dstTarget, width);
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
        const apex = busApex(snap.refdes, snap.group, width);
        if (apex) specs[end] = { kind: "free", x: apex.x, y: apex.y };
      }
    }
    store.dispatch(
      addBusCmd(specs.a, specs.b, width, snaps, prunedLegBends([specs.a, ...waypointSpecs(), specs.b])),
    );
  }

  // busApex returns the brace apex (FR-042a) of the pack-low block a width-`width`
  // bus would claim on a component's pin group — the attachment point the snapped
  // bus endpoint is placed at. Recomputed from current design state to match the
  // block snapBusGroup will claim (FR-041c).
  function busApex(refdes, groupName, width) {
    const brace = busBrace(refdes, groupName, width);
    return brace ? brace.apex : null;
  }

  // busBrace returns the full group-snap brace ({a, b, apex}, FR-042a) of the
  // pack-low block a width-`width` bus would claim on a component's pin group, or
  // null if the group is gone or has no free block. Recomputed from current design
  // state. Drives both busApex and the in-progress source-brace preview (FR-042b).
  function busBrace(refdes, groupName, width) {
    const inst = store.design.components.find((c) => c.refdes === refdes);
    const group = inst && (inst.typeData.pinGroups ?? []).find((g) => g.name === groupName);
    if (!group) return null;
    const block = groupFreeBlock(store.design, refdes, group, width);
    return block ? busGroupBrace(inst, block) : null;
  }

  // busGroupHoverPreview returns the bus-drag feedback when the cursor nears a
  // width-matching pin group (FR-042a): the nearest group's brace, plus — when a
  // bus is already in progress (`anchor` set) — the in-progress bus routed to the
  // brace apex. Returns null when not near any group (caller falls back to the
  // normal route preview, or clears the preview before the first click).
  // The live leg routes from `srcSpec`/`anchor` (the in-progress bus's source or
  // its last locked waypoint, FR-027e) to the apex; the caller prepends any
  // locked legs.
  function busGroupHoverPreview(srcSpec, anchor, e) {
    if (store.state.tool !== "bus") return null;
    // No in-progress bus → no committed width yet, so match any-width group (FR-042c).
    const width = wireSource ? wireSource.busWidth ?? DEFAULT_BUS_WIDTH : null;
    const near = busGroupAt(worldOf(e), width);
    if (!near) return null;
    const apex = near.brace.apex;
    if (!anchor) return { brace: near.brace }; // before the first click: brace only
    const from = routerEndpoint(srcSpec);
    const route = from ? proposeRoute(store.design, from, apex) : null;
    const points = route ? [...route] : [anchor, apex];
    points[0] = anchor; // draw from the live leg's (visual) anchor (FR-013d)
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

  // finishWireOnBus terminates an in-progress wire on a bus as a single-bit
  // breakout (FR-043b): it pops the same bit-choice dialog as startBreakout, then
  // commits a breakout whose far endpoint is the wire's source and whose junction
  // is at the clicked bus point. The wire follows the route already drawn — its
  // bends are legBends in source→bus order, reversed because breakoutBit builds
  // the path junction→dest. Cancelling the dialog leaves the wire in progress.
  async function finishWireOnBus(busHit, e) {
    const g = gridOf(e);
    const bit = await chooseBitDialog(busHit.bus);
    if (bit === null) return; // cancelled — keep drawing the wire
    const busPoint = { kind: "free", x: g.x, y: g.y };
    const bends = prunedLegBends([wireSource, ...waypointSpecs(), busPoint]).reverse();
    store.dispatch(breakoutBitCmd(busHit.bus.id, busHit.segIndex, g.x, g.y, bit, wireSource, bends));
    setTool("select"); // one-shot (FR-028)
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
    if (store.isReadonly()) return; // placement disabled (FR-087/FR-115h)
    const tile = e.target.closest(".palette-tile");
    if (!tile) return;
    if (tile.dataset.type === "add") return setTool("place", ADD_TYPE); // §6.14
    if (tile.dataset.type === "newgal") return void onNewGalPart?.(); // FR-066c
    if (tile.dataset.type === "mem") return void onNewMemDevice?.(); // FR-114
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
    if (store.isReadonly()) return; // placement disabled (FR-087/FR-115h)
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
    if (store.isReadonly()) {
      const world = worldOf(e);
      const comp = hitComponent(store.design, world);
      // The live-sim switch-click (FR-087a) requires a running simulation; under
      // the panel lock (FR-115h, not simulating) it does not apply.
      if (comp && store.state.simulating) {
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
      if (onItem) postMessage(store.state.simulating ? LOCKED_MSG : VEC_LOCKED_MSG);
      return;
    }

    // A left click anywhere commits an in-progress note edit first (FR-071f); the
    // click then proceeds with its normal select/draw meaning.
    if (editingNote) commitNoteEdit();

    if (store.state.tool === "paste" && pasteFrag) {
      commitPaste(e);
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
        // Starting on a dangling wire end extends/joins it rather than branching a
        // junction (FR-034c), mirroring the completion path (wireTargetAt).
        const de = danglingEndAt(store.design, world, bendTol());
        if (de && !de.isBus) {
          wireSource = { kind: "vertex", id: de.vertex.id, x: de.vertex.x, y: de.vertex.y };
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
      // Terminating the wire on a bus taps a single bit (FR-043b) — the same
      // dialog as a breakout started on a bus (FR-043a). A pin still wins over a
      // bus; a bus wins over a wire-branch and over empty space (which would
      // otherwise lock a waypoint), so this runs before those cases. wireTargetAt
      // never returns a pin that is also on a bus, so guarding on a non-pin target
      // preserves the pin > bus priority.
      if (!target || target.kind === "branch") {
        const bh = hitBusSegment(store.design, worldOf(e), segTol());
        if (bh) {
          finishWireOnBus(bh, e); // async: pick bit, then commit the breakout
          return;
        }
      }
      if (!target) {
        // Empty-canvas click → lock an intermediate waypoint (FR-027e); the
        // router re-inits from it for the live leg. A wire completes only on a
        // real target, so empty space never ends the wire.
        const g = gridOf(e);
        wireWaypoints.push({ x: g.x, y: g.y });
        return;
      }
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
      store.dispatch(
        addWireCmd(wireSource, target, prunedLegBends([wireSource, ...waypointSpecs(), target])),
      );
      setTool("select"); // one-shot (FR-028)
      return;
    }

    if (store.state.tool === "bus") {
      // The first endpoint has no committed width, so it matches a group of any
      // width and adopts it (FR-042c); the second endpoint's group proximity is
      // then judged at the bus's actual width (FR-042a).
      const width = wireSource ? wireSource.busWidth ?? DEFAULT_BUS_WIDTH : null;
      const target = busTargetAt(e, width);
      if (!wireSource) {
        wireSource = target;
        return;
      }
      // Empty-canvas click → lock an intermediate waypoint (FR-027e). A bus now
      // completes only on a real target (pin group, bus segment, or component),
      // so an empty click no longer ends it at a free point. (It may still start
      // free, handled above.)
      if (target.kind === "free") {
        wireWaypoints.push({ x: target.x, y: target.y });
        return;
      }
      // Reject joining two buses of unequal width (FR-039a) — whether the target
      // is a branch onto another bus or a join onto a dangling bus end (FR-034c).
      const joinsBus = (s) => s.kind === "branch" || s.kind === "vertex";
      if (
        joinsBus(wireSource) &&
        joinsBus(target) &&
        wireSource.busWidth != null &&
        target.busWidth != null &&
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
      // A plain click selects just this segment (FR-031); a drag inserts a bend
      // here instead (decided on move).
      select({ kind: "segment", id: seg.wire.id, segIndex: seg.segIndex }, e.shiftKey);
      drag = { type: "segment", wireId: seg.wire.id, segIndex: seg.segIndex, tempIndex: -1, moved: false };
      return;
    }
    const busSeg = hitBusSegment(store.design, world, segTol());
    if (busSeg) {
      // Same as wires (FR-039/FR-031): a plain click selects the segment; a drag
      // inserts a bend.
      select({ kind: "segment", id: busSeg.bus.id, segIndex: busSeg.segIndex }, e.shiftKey);
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
    if (store.isReadonly()) return;
    const world = worldOf(e);
    const sub = subDesignAt(world);
    if (sub && onOpenSubDesign) {
      onOpenSubDesign(sub.childPath);
      return;
    }
    // Double-clicking a text note re-opens text-entry mode (FR-071f).
    const comp = hitComponent(store.design, world);
    const inst = comp && store.design.components.find((c) => c.refdes === comp.refdes);
    if (inst?.typeData.renderType === "note") startNoteEdit(inst);
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
      // A browser can't warp the cursor to the new center; instead anchor the
      // next zoom at the canvas center so the recentered point stays fixed
      // until the pointer moves (FR-023b).
      pendingZoomAnchor = { x: rect.width / 2, y: rect.height / 2 };
      return;
    }
    if (store.isReadonly()) return; // menu actions mutate (FR-087/FR-115h)
    const items = [];

    if (bend) {
      items.push({
        label: "Delete bend point",
        onClick: () => store.dispatch(deleteBendCmd(bend.wire.id, bend.bendIndex)),
      });
    } else if (seg) {
      items.push({
        label: "Delete segment",
        danger: true,
        onClick: () => store.dispatch(deleteSegmentCmd(seg.wire.id, seg.segIndex)),
      });
      items.push({
        label: "Delete wire",
        danger: true,
        onClick: () => store.dispatch(deleteWireCmd(seg.wire.id)),
      });
    } else if (busSeg) {
      const bus = busSeg.bus;
      items.push({
        label: "Delete segment",
        danger: true,
        onClick: () => store.dispatch(deleteSegmentCmd(bus.id, busSeg.segIndex)),
      });
      items.push({ separator: true });
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
    lastPointer = e; // remembered so a menu-invoked paste can seat its ghost
    pendingZoomAnchor = null; // the cursor moved; resume zoom-to-cursor (FR-023b)
    if (store.state.tool === "paste" && pasteFrag) {
      updatePasteGhost(e);
      return;
    }
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
      lastMove = e; // remember the pointer so Backspace can refresh the preview
      updateWirePreview(e);
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
        const gp = busGroupHoverPreview(null, null, e);
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
      const anchor = pendingZoomAnchor ?? canvasPoint(e);
      renderer.setViewport(zoomAbout(store.state.viewport, anchor, factor));
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
      const prev = pathPointXY(w, drag.bendIndex - 1);
      const next = pathPointXY(w, drag.bendIndex + 1);
      // Rewind the live preview to the pre-drag position so the command
      // captures the true old state for undo (FR-024/FR-032).
      moveBend(w, drag.bendIndex, drag.origX, drag.origY);
      // A bend dragged onto the straight line through its neighbours no longer
      // bends the wire, so delete it rather than move it (FR-033c).
      if (prev && next && isRedundantBend(prev, { x: fx, y: fy }, next)) {
        store.dispatch(deleteBendCmd(drag.wireId, drag.bendIndex));
      } else {
        store.dispatch(moveBendCmd(drag.wireId, drag.bendIndex, fx, fy));
      }
    } else if (drag.type === "segment" && drag.moved && drag.tempIndex >= 0) {
      const w = findWire(drag.wireId);
      const p = w.path[drag.tempIndex];
      const fx = p.x;
      const fy = p.y;
      const prev = pathPointXY(w, drag.tempIndex - 1);
      const next = pathPointXY(w, drag.tempIndex + 1);
      w.path.splice(drag.tempIndex, 1); // remove the preview bend
      // Dragging a straight segment back onto its own line creates no real bend,
      // so commit nothing (FR-033c).
      if (!(prev && next && isRedundantBend(prev, { x: fx, y: fy }, next))) {
        store.dispatch(insertBendCmd(drag.wireId, drag.segIndex, fx, fy));
      }
    }
    drag = null;
  });

  // --- keyboard ---
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });

  window.addEventListener("keydown", (e) => {
    // Ignore shortcuts while typing in a field (e.g., the save dialog or the note
    // text-entry overlay, FR-071f), so editor shortcuts never fire mid-edit.
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target.isContentEditable
    )
      return;

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

    const mod = e.metaKey || e.ctrlKey;

    // Copy (Ctrl/Cmd+C) is read-only, so it is allowed even while simulating
    // (FR-111) — handled above the simulation lock below.
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection();
      return;
    }

    // File/View accelerators that stay live while simulating (FR-004b/FR-087):
    // Save, Save As, and zoom — matching their menu items, which are not locked.
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      fileops.save(e.shiftKey ? { saveAs: true } : undefined);
      return;
    }
    if (mod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomBy(1.25);
      return;
    }
    if (mod && e.key === "-") {
      e.preventDefault();
      zoomBy(0.8);
      return;
    }

    // Read-only lock (FR-087/FR-115h): Space (pan) and Escape stay; every
    // shortcut below mutates the design or arms a mutating tool. Save (Ctrl/Cmd+S,
    // above) stays enabled under both locks.
    if (store.isReadonly()) return;

    // Open (Ctrl/Cmd+O) is below the lock, so it is disabled while simulating
    // (FR-004b), matching its menu item.
    if (mod && e.key.toLowerCase() === "o") {
      e.preventDefault();
      fileops.open();
      return;
    }

    // Backspace while drawing pops the most-recent locked waypoint (FR-027e),
    // re-routing the live leg; Esc (above) cancels the whole conductor. Swallow
    // it whether or not a waypoint remains, so it never deletes the lingering
    // selection mid-draw.
    if (e.key === "Backspace" && wireSource) {
      if (wireWaypoints.length) {
        wireWaypoints.pop();
        if (lastMove) updateWirePreview(lastMove);
      }
      e.preventDefault();
      return;
    }

    // Undo/redo: Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z or Ctrl/Cmd+Y (FR-024).
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
    // Paste (Ctrl/Cmd+V): arm at-cursor placement (FR-112/FR-113).
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      startPaste();
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
      (sel[0].kind === "bus" || sel[0].kind === "segment")
    ) {
      // Stopgap width control until the right-click context menu (FR-038, S20).
      // A bus click now selects a segment (FR-031), so resolve its parent bus.
      const bus = store.design.buses.find((b) => b.id === sel[0].id);
      if (bus) {
        e.preventDefault();
        const delta = e.key === "-" ? -1 : 1;
        store.dispatch(setBusWidthCmd(bus.id, Math.max(1, bus.width + delta)));
      }
    }
  });

  // zoomBy zooms about the canvas center (toolbar +/- buttons).
  function zoomBy(factor) {
    const rect = canvas.getBoundingClientRect();
    renderer.setViewport(
      zoomAbout(store.state.viewport, { x: rect.width / 2, y: rect.height / 2 }, factor),
    );
  }

  // designBBox returns the world-space bounding box spanning every component,
  // vertex, and conductor bend, or null when the design has no geometry (FR-022a).
  function designBBox() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (x, y) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const inst of store.design.components) {
      const b = componentBBox(inst);
      grow(b.minX, b.minY);
      grow(b.maxX, b.maxY);
    }
    for (const v of store.design.vertices) grow(v.x, v.y);
    for (const c of [...store.design.wires, ...store.design.buses]) {
      for (const pt of c.path) if (pt.t === "bend") grow(pt.x, pt.y);
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  // fitToScreen sets zoom and pan so the whole design fits the canvas, centered
  // with a small margin (FR-022a). No-op on an empty design.
  function fitToScreen() {
    const box = designBBox();
    if (!box) return;
    const rect = canvas.getBoundingClientRect();
    const margin = 0.9; // fraction of the canvas the design may occupy
    const spanX = Math.max(box.maxX - box.minX, 1);
    const spanY = Math.max(box.maxY - box.minY, 1);
    const zoom = clampZoom(
      Math.min(
        (rect.width * margin) / (spanX * PX_PER_UNIT_DEFAULT),
        (rect.height * margin) / (spanY * PX_PER_UNIT_DEFAULT),
      ),
    );
    const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    renderer.setViewport(
      centerViewportOn({ pan: { x: 0, y: 0 }, zoom }, center, rect.width, rect.height),
    );
  }

  return {
    setTool,
    zoomBy,
    fitToScreen,
    copySelection,
    startPaste,
    hasClipboard: () => !!clipboard,
  };
}
