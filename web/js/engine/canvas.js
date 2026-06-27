// Canvas renderer: draws the whole scene and owns the render loop (§6.8). It is
// read-only over the model and re-renders only when something requests it, to
// stay responsive without busy-spinning (NFR-005).

import {
  worldToScreen,
  screenToWorld,
  scaleFor,
  rotateOffset,
} from "../geometry.js";
import {
  pinWorldPos,
  pinVisualPos,
  sideOutward,
  getVertex,
  vertexWorld,
  busGroupBrace,
  PIN_RADIUS,
  NOTE_PAD,
  NOTE_LINE,
  NOTE_FONT,
} from "../model/design.js";
import { drawSymbol, pinHasOwnBubble, pinLabelEdge } from "./symbols.js";
import { V0, V1 } from "./galasm.js";
import { sameRef } from "../store.js";

// Bubble radius (grid units) for the state-indicator built-in, sized to sit
// comfortably inside its 2x2 footprint (FR-068).
const INDICATOR_RADIUS = 0.85;
const PIN_FONT = "10px system-ui, sans-serif";
const LABEL_FONT = "bold 11px system-ui, sans-serif";
// Zoom-based label culling (FR-012a): apparent on-screen symbol size, in CSS px
// (min footprint dimension × scale), below which pin labels (T1) then the type
// display-name line (T2) stop being drawn. The U-number is always drawn.
const LABEL_T1 = 40;
const LABEL_T2 = 22;
// Conflicted nets stroke red while the conflict persists (FR-082).
const CONFLICT_COLOR = "#b00020";

// Text-note dotted-outline color (FR-071f), matching the palette tile. The
// note's layout constants (NOTE_PAD/NOTE_LINE/NOTE_FONT) are imported from the
// model so the drawn text matches the auto-sized box; text scales with the grid
// (font size ∝ scale) so the box tracks it at every zoom.
const NOTE_BLUE = "#1565c0";

// initCanvas attaches a renderer to a <canvas> bound to a store. Returns a small
// controller (§6.8 interface).
export function initCanvas(canvasEl, store) {
  const ctx = canvasEl.getContext("2d");
  let dirty = true;
  let frame = null;
  let preview = null; // transient {points: [{x,y}, …]} in world coords
  let marquee = null; // transient rubber-band {a, b (world), mode} (FR-016b)
  let ghost = null; // transient paste ghost {fragment, dx, dy} (FR-113)
  let editing = null; // refdes of the note being edited; hidden so the textarea overlay shows (FR-071f)
  let lastW = 0; // last applied CSS size / DPR, so resize() is idempotent and a
  let lastH = 0; // ResizeObserver tick that didn't change the box is a no-op.
  let lastDpr = 0;

  function requestRender() {
    dirty = true;
    if (frame == null) frame = requestAnimationFrame(draw);
  }

  // resize keeps the device-pixel backing store matched to the element's CSS
  // box. Driven by a ResizeObserver (below), not the window resize event alone:
  // the canvas shrinks whenever sibling chrome grows (e.g. the status bar
  // populating its trays after init) with no window resize, which would leave
  // the backing store taller than the cleared area — an uncleared bottom strip.
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    if (w === lastW && h === lastH && dpr === lastDpr) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    requestRender();
  }

  function draw() {
    frame = null;
    if (!dirty) return;
    dirty = false;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasEl.clientWidth;
    const h = canvasEl.clientHeight;
    const vp = store.state.viewport;

    // Simulation display view (§6.13): present while running and retained
    // after a run until the next design edit (FR-085).
    const sim = store.state.sim;
    const conflicts = sim ? sim.conflictedConductors() : null;

    ctx.save();
    // Clear the whole backing store in device pixels (identity transform) so a
    // round() sub-pixel sliver, or a momentarily stale size, cannot leave an
    // uncleared bottom strip; then apply the DPR scale for CSS-pixel drawing.
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.scale(dpr, dpr);
    drawGrid(ctx, w, h, vp);
    drawBuses(ctx, store.design, vp, store.state.selection, conflicts);
    drawWires(ctx, store.design, vp, store.state.selection, conflicts);
    drawComponents(ctx, store.design, vp, store.state.selection, store.state.hover, sim, editing);
    // Vertex marks and group-snap braces last, so a component body never hides a
    // connection/dangling indicator that sits on or under it (§6.8).
    drawVertices(ctx, store.design, vp);
    drawBusBraces(ctx, store.design, vp);
    if (preview) drawPreview(ctx, preview, vp);
    // Paste ghost above the design, below the marquee (FR-113).
    if (ghost) drawGhost(ctx, ghost.fragment, ghost.dx, ghost.dy, vp);
    if (marquee) drawMarquee(ctx, marquee, vp);
    ctx.restore();
  }

  const unsubscribe = store.subscribe(requestRender);
  // Track the element's box directly: catches layout-driven size changes (the
  // status bar populating, the properties panel toggling) that fire no window
  // resize. The window listener still covers devicePixelRatio-only changes
  // (e.g. dragging the window between monitors of different scaling).
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasEl);
  window.addEventListener("resize", resize);
  resize();

  return {
    requestRender,
    setPreview(p) {
      preview = p;
      requestRender();
    },
    setMarquee(m) {
      marquee = m;
      requestRender();
    },
    setGhost(g) {
      ghost = g;
      requestRender();
    },
    setEditingNote(e) {
      editing = e;
      requestRender();
    },
    setViewport(viewport) {
      store.state.viewport = viewport;
      requestRender();
    },
    destroy() {
      unsubscribe();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      if (frame != null) cancelAnimationFrame(frame);
    },
  };
}

// drawGrid draws grid dots, coarsening the step so dot spacing stays >= ~6 px
// (FR-021), avoiding moire and cost when zoomed out.
function drawGrid(ctx, w, h, vp) {
  const scale = scaleFor(vp);
  let step = 1;
  while (step * scale < 6) step *= 2;

  const tl = screenToWorld({ x: 0, y: 0 }, vp);
  const br = screenToWorld({ x: w, y: h }, vp);
  const startX = Math.floor(tl.x / step) * step;
  const startY = Math.floor(tl.y / step) * step;

  ctx.fillStyle = "#d8d8d8";
  for (let gx = startX; gx <= br.x; gx += step) {
    for (let gy = startY; gy <= br.y; gy += step) {
      const p = worldToScreen({ x: gx, y: gy }, vp);
      ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
    }
  }
}

function drawComponents(ctx, design, vp, selection, hover, sim, editing) {
  if (!design) return;
  for (const inst of design.components) {
    // The note being edited is hidden — a DOM <textarea> overlay covers it (§6.9).
    if (editing && inst.refdes === editing) continue;
    const selected = selection.some((s) =>
      sameRef(s, { kind: "component", refdes: inst.refdes }),
    );
    const hovered = hover === inst.refdes;
    drawComponent(ctx, inst, vp, selected, hovered, sim);
  }
}

// GHOST_ALPHA dims the paste ghost so it reads as a preview, not placed (FR-113).
const GHOST_ALPHA = 0.5;

// drawGhost renders a translucent preview of a clipboard fragment offset by
// (dx,dy) while paste placement is pending (FR-113, §6.15). It is self-contained
// over the fragment — the pasted objects are not yet in the design — resolving
// each conductor path point from the fragment's own vertices/components, and
// reusing drawComponent for the bodies. Read-only; never hit-tested.
function drawGhost(ctx, fragment, dx, dy, vp) {
  const vById = new Map(fragment.vertices.map((v) => [v.id, v]));
  const cByRef = new Map(fragment.components.map((c) => [c.refdes, c]));

  const pointWorld = (p) => {
    let w;
    if (p.t === "bend") {
      w = { x: p.x, y: p.y };
    } else {
      const v = vById.get(p.v);
      const inst = v && (v.kind === "pin" || v.kind === "connector") ? cByRef.get(v.ref) : null;
      w = inst ? pinWorldPos(inst, v.pin) : { x: v.x, y: v.y };
    }
    return { x: w.x + dx, y: w.y + dy };
  };

  ctx.save();
  ctx.globalAlpha = GHOST_ALPHA;
  for (const [list, width, color] of [
    [fragment.buses, 3, "#1565c0"],
    [fragment.wires, 1, "#000"],
  ]) {
    for (const c of list) {
      if (c.path.length < 2) continue;
      const pts = c.path.map((p) => worldToScreen(pointWorld(p), vp));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  for (const inst of fragment.components) {
    drawComponent(ctx, { ...inst, x: inst.x + dx, y: inst.y + dy }, vp, false, false, null);
  }
  ctx.restore();
}

// pathPointWorld returns a wire path point's world coordinate (node via vertex,
// bend via its own coords).
function pathPointWorld(design, p) {
  if (p.t === "node") return vertexWorld(design, getVertex(design, p.v));
  return { x: p.x, y: p.y };
}

// endpointWorld is pathPointWorld for a path's first/last point, drawn to the
// pin's visual attachment point when the endpoint is a pin (FR-013d). Drawing
// only — the model keeps the on-grid coordinate.
function endpointWorld(design, p) {
  if (p.t === "node") {
    const v = getVertex(design, p.v);
    if (v?.kind === "pin" || v?.kind === "connector") {
      const inst = design.components.find((c) => c.refdes === v.ref);
      if (inst) return pinVisualPos(inst, v.pin);
    }
    return vertexWorld(design, v);
  }
  return { x: p.x, y: p.y };
}

// drawWires draws wires as thin black polylines (FR-036), highlighting the
// selected one; a conflicted conductor strokes red while the conflict
// persists (FR-082).
function drawWires(ctx, design, vp, selection, conflicts) {
  if (!design) return;
  for (const w of design.wires) {
    const pts = w.path.map((p, i) => {
      const end = i === 0 || i === w.path.length - 1;
      return worldToScreen((end ? endpointWorld : pathPointWorld)(design, p), vp);
    });
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    const selected = selection.some((s) => sameRef(s, { kind: "wire", id: w.id }));
    const conflicted = conflicts?.has(w.id) && !selected;
    ctx.lineWidth = selected ? 2.5 : conflicted ? 2 : 1;
    ctx.strokeStyle = selected ? "#4a90d9" : conflicted ? CONFLICT_COLOR : "#000";
    ctx.stroke();
  }
}

// drawBuses draws buses as thick blue polylines with a "/n" width annotation
// (FR-036/037), highlighting the selected one; a bus with a conflicted bit
// strokes red while the conflict persists (FR-082).
function drawBuses(ctx, design, vp, selection, conflicts) {
  if (!design) return;
  for (const b of design.buses) {
    const pts = b.path.map((p, i) => {
      const end = i === 0 || i === b.path.length - 1;
      return worldToScreen((end ? endpointWorld : pathPointWorld)(design, p), vp);
    });
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    const selected = selection.some((s) => sameRef(s, { kind: "bus", id: b.id }));
    const conflicted = conflicts?.has(b.id) && !selected;
    ctx.lineWidth = selected ? 5 : 3;
    ctx.strokeStyle = selected ? "#4a90d9" : conflicted ? CONFLICT_COLOR : "#1565c0";
    ctx.stroke();

    // Width annotation: a slash tick plus the bit count, at the first segment's
    // midpoint.
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    ctx.strokeStyle = "#1565c0";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mx - 4, my + 4);
    ctx.lineTo(mx + 4, my - 4);
    ctx.stroke();
    ctx.fillStyle = "#1565c0";
    ctx.font = PIN_FONT;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(b.width), mx + 5, my - 4);
  }
}

// drawPreview strokes the transient rubber-band polyline from the wire/bus
// source toward the cursor while a draw gesture is in progress: the proposed
// Manhattan route, or the straight fallback segment (FR-027a/FR-027c).
function drawPreview(ctx, preview, vp) {
  const pts = preview.points;
  if (pts && pts.length >= 2) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#888";
    ctx.beginPath();
    const a = worldToScreen(pts[0], vp);
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i++) {
      const p = worldToScreen(pts[i], vp);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Prospective group-snap brace while dragging a bus near a matching group
  // (FR-042a), and the source group's brace when the bus started on a snap
  // (FR-042b): solid bus-color so they preview how the connection will look.
  for (const br of [preview.sourceBrace, preview.brace]) {
    if (br) strokeBrace(ctx, br.a, br.b, br.apex, vp, "#1565c0", 2);
  }
}

// drawMarquee draws the rubber-band selection rectangle (FR-016b): window mode
// (drag right, enclosed-only) is a solid blue outline; crossing mode (drag left,
// touched) is a dashed green outline. Both get a faint translucent fill.
function drawMarquee(ctx, m, vp) {
  const a = worldToScreen(m.a, vp);
  const b = worldToScreen(m.b, vp);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  const win = m.mode === "window";
  ctx.save();
  ctx.lineWidth = 1;
  if (win) {
    ctx.strokeStyle = "#4a90d9";
    ctx.fillStyle = "rgba(74,144,217,0.12)";
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = "#2e9e4f";
    ctx.fillStyle = "rgba(46,158,79,0.12)";
    ctx.setLineDash([4, 3]);
  }
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// drawVertices marks junctions (filled dots) and dangling free ends (red hollow
// squares, FR-029) so connectivity is visible (§6.8). A group-snapped bus endpoint
// is also a `free` vertex but is connected (FR-042) — it draws no dangling mark;
// its curly brace (drawBusBraces) is its indicator.
function drawVertices(ctx, design, vp) {
  if (!design) return;
  // Bus endpoints named by a bus's groupConnections are connected even though
  // their vertex kind is "free" (FR-042) — same set the cleanup sweep uses (§6.6).
  const snapped = new Set();
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) snapped.add(gc.vertex);
  }
  for (const v of design.vertices) {
    if (v.kind === "junction") {
      const s = worldToScreen(vertexWorld(design, v), vp);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    } else if (v.kind === "free" && !snapped.has(v.id)) {
      // Dangling, unconnected end (FR-029): a red hollow square. (A group-snapped
      // free end draws nothing here — its brace is the indicator, FR-042a.)
      const s = worldToScreen(vertexWorld(design, v), vp);
      ctx.strokeStyle = "#b00020";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x - 2.5, s.y - 2.5, 5, 5);
    }
  }
}

// strokeBrace strokes a curly brace whose tips are at world points `a` and `b`
// and whose middle point (beak) is at world `apex` (FR-042a). It is two cubic
// Béziers — the upper half (tip a → apex) and the lower half (apex → tip b) —
// meeting at the apex with opposing tangents so the brace comes to a **point**
// there (the bus connection point). Control points are derived from the tip→tip
// span (`al`) and the outward beak offset (`ou`), so it orients correctly for any
// pin side and component rotation.
function strokeBrace(ctx, a, b, apex, vp, color, lineWidth) {
  const A = worldToScreen(a, vp);
  const B = worldToScreen(b, vp);
  const P = worldToScreen(apex, vp);
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  let alx = B.x - A.x, aly = B.y - A.y;
  const span = Math.hypot(alx, aly) || 1;
  alx /= span;
  aly /= span; // unit along, A → B
  let oux = P.x - mid.x, ouy = P.y - mid.y;
  const depth = Math.hypot(oux, ouy) || 1;
  oux /= depth;
  ouy /= depth; // unit outward, mid → apex
  const sp = span * 0.22; // beak-flank offset along the span
  const dp = depth * 0.5; // beak-flank inset from the apex
  const tip = depth * 0.6; // how far the arcs bow out at the tips
  const c1u = { x: A.x + oux * tip, y: A.y + ouy * tip };
  const c2u = { x: P.x - alx * sp - oux * dp, y: P.y - aly * sp - ouy * dp };
  const c1l = { x: P.x + alx * sp - oux * dp, y: P.y + aly * sp - ouy * dp };
  const c2l = { x: B.x + oux * tip, y: B.y + ouy * tip };
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.bezierCurveTo(c1u.x, c1u.y, c2u.x, c2u.y, P.x, P.y);
  ctx.bezierCurveTo(c1l.x, c1l.y, c2l.x, c2l.y, B.x, B.y);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

// drawBusBraces strokes a curly brace for every group-snap bus connection
// (FR-042a), recomputed each frame from the bound instance + group, so it tracks
// component moves/rotations and the bus terminates exactly at the brace apex.
function drawBusBraces(ctx, design, vp) {
  if (!design) return;
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) {
      const inst = design.components.find((c) => c.refdes === gc.instance);
      if (!inst) continue;
      const br = busGroupBrace(inst, gc.bitMap);
      strokeBrace(ctx, br.a, br.b, br.apex, vp, "#1565c0", 2);
    }
  }
}

function drawComponent(ctx, inst, vp, selected, hovered, sim) {
  const td = inst.typeData;
  if (!td) return;

  // Apparent on-screen symbol size, for label culling (FR-012a).
  const symPx = Math.min(td.width, td.height) * scaleFor(vp);

  // A text note (FR-071f) owns its whole rendering: text that rotates with it,
  // a dotted box when selected, and no pins or refdes/type label. Drawn and done.
  if (td.renderType === "note") {
    drawNote(ctx, inst, vp, selected);
    return;
  }

  // Body: a schematic symbol for subunit components (§6.8a), else the outline
  // rectangle. Both rotate about the instance origin and share the pin path below.
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  if (inst.broken) {
    drawBrokenBox(ctx, inst, vp, selected);
  } else if (td.renderType === "subunit") {
    drawSymbol(ctx, inst, vp);
  } else if (td.renderType === "indicator") {
    drawIndicator(ctx, inst, vp, selected, sim);
  } else if (td.renderType === "pullup") {
    drawPullup(ctx, inst, vp, selected);
  } else if (td.renderType === "pulldown") {
    drawPulldown(ctx, inst, vp, selected);
  } else if (td.renderType === "clock") {
    drawLabelBox(ctx, inst, vp, selected, "CLK");
  } else if (td.renderType === "reset") {
    drawLabelBox(ctx, inst, vp, selected, "RST");
  } else if (td.renderType === "switch") {
    drawSwitch(ctx, inst, vp, selected);
  } else if (td.renderType === "indicator8") {
    drawIndicator8(ctx, inst, vp, selected, sim);
  } else if (td.renderType === "portN") {
    drawPortN(ctx, inst, vp, selected);
  } else if (td.renderType === "port") {
    drawPort(ctx, inst, vp, selected);
  } else {
    const corners = [
      [0, 0],
      [td.width, 0],
      [td.width, td.height],
      [0, td.height],
    ].map(([dx, dy]) => {
      const r = rotateOffset(dx, dy, inst.rotation);
      return worldToScreen({ x: inst.x + r.x, y: inst.y + r.y }, vp);
    });
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Pin connection bubbles + upright pin name labels.
  ctx.font = PIN_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const r = PIN_RADIUS * scaleFor(vp);
  for (const pin of td.pins) {
    const pw = pinWorldPos(inst, pin.name);
    const ps = worldToScreen(pw, vp);
    const out = sideOutward(pin.side);
    const outR = rotateOffset(out.x, out.y, inst.rotation);

    // Connection mark at the pin point (which stays the connection target, FR-013).
    // Unit components draw the FR-013 bubble, tangent to the body one radius
    // outward. Subunit symbols draw no resting bubble — the circle is reserved for
    // logic negation (FR-013c) — and instead get a short perpendicular tick on the
    // pin point, shown only while the symbol is hovered or selected. Inverting-gate
    // outputs are exempt in both cases: the symbol's inversion bubble is their mark.
    if (td.renderType === "subunit") {
      if (!pinHasOwnBubble(td, pin) && (selected || hovered)) {
        // Short tick along the pin axis (an outward lead from the grid point), so
        // it reads as a connection stub and never hides inside a body edge.
        const a = worldToScreen(pw, vp);
        const b = worldToScreen(
          { x: pw.x + outR.x * 2 * PIN_RADIUS, y: pw.y + outR.y * 2 * PIN_RADIUS },
          vp,
        );
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      const bc = worldToScreen(pinVisualPos(inst, pin.name), vp);
      ctx.beginPath();
      ctx.arc(bc.x, bc.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Label sits just inside the body (opposite the outward direction), drawn
    // in screen space so it stays upright regardless of rotation (FR-015). For
    // subunit symbols it hangs from the body outline rather than the pin point,
    // so stubs (mux selects, inverting outputs, concave OR inputs) never bisect it.
    let lref = ps;
    if (td.renderType === "subunit") {
      const e = pinLabelEdge(td, pin);
      const er = rotateOffset(e.x, e.y, inst.rotation);
      lref = worldToScreen({ x: inst.x + er.x, y: inst.y + er.y }, vp);
    }
    // A built-in's glyph owns its body, so skip the pin name (it would land on
    // top of the glyph). Pin labels are also culled once the symbol is small on
    // screen (FR-012a).
    if (!td.builtin && symPx >= LABEL_T1) {
      ctx.fillStyle = "#333";
      ctx.fillText(pin.name, lref.x - Math.sign(outR.x) * 8, lref.y - Math.sign(outR.y) * 8);
    }
  }

  // Center labels, upright (FR-012). A subunit shows just its refdes (e.g. U5A);
  // a unit component shows refdes + type name.
  const cr = rotateOffset(td.width / 2, td.height / 2, inst.rotation);
  const center = worldToScreen({ x: inst.x + cr.x, y: inst.y + cr.y }, vp);
  ctx.fillStyle = "#111";
  ctx.font = LABEL_FONT;
  if (td.renderType === "subunit") {
    ctx.fillText(inst.label ?? inst.refdes, center.x, center.y);
  } else if (td.builtin) {
    // Designator label above the symbol so it clears the glyph; the upper bound
    // on any 90°-rotation's vertical extent is max(width,height).
    const off = (Math.max(td.width, td.height) / 2) * scaleFor(vp) + 7;
    ctx.fillText(inst.label ?? inst.refdes, center.x, center.y - off);
  } else if (symPx >= LABEL_T2) {
    // Designator (the editable label, falling back to the refdes) above the
    // type's display name (FR-012). The type name comes from typeData — not
    // inst.type, which is the internal library id (FR-066e).
    ctx.fillText(inst.label ?? inst.refdes, center.x, center.y - 6);
    ctx.fillText(td.partnumber || td.name, center.x, center.y + 6);
  } else {
    // Symbol too small for two lines: drop the type name, center the U-number
    // (FR-012a).
    ctx.fillText(inst.label ?? inst.refdes, center.x, center.y);
  }
}

// drawIndicator renders the state-indicator bubble (FR-068). The indicator is
// not stateful — it reflects the attached wire's simulated state when a sim
// view is present (white bubble/black "1", black bubble/white "0"), and the
// undriven gray "?" otherwise (U and Z both display as "?").
function drawIndicator(ctx, inst, vp, selected, sim) {
  const td = inst.typeData;
  const cr = rotateOffset(td.width / 2, td.height / 2, inst.rotation);
  const center = worldToScreen({ x: inst.x + cr.x, y: inst.y + cr.y }, vp);
  const r = INDICATOR_RADIUS * scaleFor(vp);

  const state = indicatorState(inst, sim);
  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.fillStyle = state.bg;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  ctx.stroke();

  ctx.fillStyle = state.fg;
  ctx.font = "bold " + Math.round(r * 1.2) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(state.glyph, center.x, center.y);
}

// indicatorState maps an indicator instance to its bubble colors and glyph
// (FR-068): the simulated value of its IN pin when a sim view is present,
// else the undriven state. U and Z both render as the gray "?".
function indicatorState(inst, sim) {
  if (sim) {
    const v = sim.valueOfPin(inst.refdes, "IN");
    if (v === V1) return { bg: "#ffffff", fg: "#000", glyph: "1" };
    if (v === V0) return { bg: "#000000", fg: "#fff", glyph: "0" };
  }
  return { bg: "#9a9a9a", fg: "#000", glyph: "?" };
}

// fillLocalPoly fills (and optionally strokes) a polygon whose points are given
// in the instance's unrotated local grid frame ([dx,dy] from the origin),
// applying the instance rotation and the viewport. Used by the 8-wide built-ins.
function fillLocalPoly(ctx, inst, vp, pts2d, fill, stroke) {
  const pts = pts2d.map(([dx, dy]) => {
    const r = rotateOffset(dx, dy, inst.rotation);
    return worldToScreen({ x: inst.x + r.x, y: inst.y + r.y }, vp);
  });
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// bit8Fill maps one bit of an 8-wide indicator to its stripe color (FR-071d),
// the same white-1 / black-0 / gray-undriven mapping as the 1-wide indicator
// (indicatorState): the bit's simulated value when a sim view is present, else
// the undriven gray (U and Z also gray).
function bit8Fill(sim, refdes, pin) {
  if (sim) {
    const v = sim.valueOfPin(refdes, pin);
    if (v === V1) return "#ffffff";
    if (v === V0) return "#000000";
  }
  return "#9a9a9a";
}

// drawIndicator8 renders the 8-wide state indicator as an LED bar-graph (FR-071d):
// a body rectangle with eight horizontal stripes aligned to the eight left-edge
// pins (grid rows 1..8), each stripe filled from its bit's live value. Stripes are
// stroked so a white "1" stays visible against the white body. The shared pin loop
// draws the eight connection bubbles down the left edge.
function drawIndicator8(ctx, inst, vp, selected, sim) {
  const td = inst.typeData;
  const stroke = selected ? "#4a90d9" : "#333";
  ctx.lineWidth = selected ? 2 : 1;
  fillLocalPoly(
    ctx,
    inst,
    vp,
    [[0, 0], [td.width, 0], [td.width, td.height], [0, td.height]],
    "#fff",
    stroke,
  );
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = i + 1; // pin row
    fillLocalPoly(
      ctx,
      inst,
      vp,
      [[0.8, y - 0.42], [td.width, y - 0.42], [td.width, y + 0.42], [0.8, y + 0.42]],
      bit8Fill(sim, inst.refdes, "D" + i),
      "#333",
    );
  }
}

// drawPortN renders the multi-bit port as N narrow right-pointing pentagons
// (FR-071e), one centered on each bit pin's row (BIT_PINS positions 1..N) so the
// flags line up with the connection bubbles the shared pin loop draws down the
// left edge. N is the instance's chosen width (its pin count). Each points
// off-sheet (apex right, away from the pins).
function drawPortN(ctx, inst, vp, selected) {
  const stroke = selected ? "#4a90d9" : "#333";
  ctx.lineWidth = selected ? 2 : 1;
  const n = inst.typeData.pins.length;
  for (let i = 0; i < n; i++) {
    const mid = i + 1; // pin row
    const y0 = mid - 0.42;
    const y1 = mid + 0.42;
    fillLocalPoly(
      ctx,
      inst,
      vp,
      [[0.8, y0], [2.2, y0], [2.9, mid], [2.2, y1], [0.8, y1]],
      "#fff",
      stroke,
    );
  }
}

// strokePaths strokes one or more polylines given in the instance's unrotated
// local grid frame ([dx,dy] from the origin), applying rotation and the viewport.
// Used by the line-art built-ins (pull-up, pull-down).
function strokePaths(ctx, inst, vp, paths, selected) {
  ctx.beginPath();
  for (const path of paths) {
    path.forEach(([dx, dy], i) => {
      const r = rotateOffset(dx, dy, inst.rotation);
      const p = worldToScreen({ x: inst.x + r.x, y: inst.y + r.y }, vp);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  }
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

// drawPullup renders the two-headed up-arrow (FR-069): two stacked up-chevrons
// over a vertical shaft rising from the bottom-center pin to just below them.
function drawPullup(ctx, inst, vp, selected) {
  strokePaths(
    ctx,
    inst,
    vp,
    [
      [[0.4, 0.65], [1, 0.15], [1.6, 0.65]], // upper chevron
      [[0.4, 1.1], [1, 0.6], [1.6, 1.1]], // lower chevron
      [[1, 1.25], [1, 2]], // shaft to the bottom pin
    ],
    selected,
  );
}

// drawPulldown renders the upside-down "T" (FR-070): a long stem from the
// top-center pin down to a short horizontal bar near the bottom.
function drawPulldown(ctx, inst, vp, selected) {
  strokePaths(
    ctx,
    inst,
    vp,
    [
      [[1, 0], [1, 1.6]], // stem from the top pin
      [[0.45, 1.6], [1.55, 1.6]], // short bar
    ],
    selected,
  );
}

// drawLabelBox renders a built-in's outline box with a centered label: the
// clock's "CLK" (FR-071) and the power-on reset's "RST" (FR-071b).
function drawLabelBox(ctx, inst, vp, selected, label) {
  const td = inst.typeData;
  const corners = [
    [0, 0],
    [td.width, 0],
    [td.width, td.height],
    [0, td.height],
  ].map(([dx, dy]) => {
    const r = rotateOffset(dx, dy, inst.rotation);
    return worldToScreen({ x: inst.x + r.x, y: inst.y + r.y }, vp);
  });
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  ctx.stroke();

  const cr = rotateOffset(td.width / 2, td.height / 2, inst.rotation);
  const center = worldToScreen({ x: inst.x + cr.x, y: inst.y + cr.y }, vp);
  ctx.fillStyle = "#000";
  ctx.font = "bold " + Math.round(0.6 * scaleFor(vp)) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, center.x, center.y);
}

// drawNote renders a text note (FR-071f): a blue dotted box holding multi-line
// text. Box and text rotate together as a rigid body (the text reads at the
// rotated angle, not re-uprighted), so we set up a translate+rotate frame at the
// instance origin and draw the footprint and glyphs in local grid-scaled pixels.
function drawNote(ctx, inst, vp, selected) {
  const td = inst.typeData;
  const scale = scaleFor(vp);
  const origin = worldToScreen({ x: inst.x, y: inst.y }, vp);

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate((inst.rotation * Math.PI) / 180); // CW, matching rotateOffset

  // Dotted blue outline box (white fill) only when selected (FR-071f); at rest,
  // unselected, only the text is drawn with no box. While editing the note is not
  // drawn at all — the textarea overlay (§6.9) covers it.
  if (selected) {
    ctx.beginPath();
    ctx.rect(0, 0, td.width * scale, td.height * scale);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = NOTE_BLUE;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Text, one line per embedded newline, top-left anchored inside the padding.
  ctx.fillStyle = "#111";
  ctx.font = Math.round(NOTE_FONT * scale) + "px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = (inst.text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], NOTE_PAD * scale, (NOTE_PAD + i * NOTE_LINE) * scale);
  }

  ctx.restore();
}

// drawBrokenBox renders a sub-design whose child file could not be loaded
// (FR-099a): a red-outlined, light-red box. The refdes + child name (the missing
// link's base name) come from the shared center-label path; the message tray
// reports the unresolved path. The shared pin loop still draws the interface
// stubs so any connected wires remain visible.
function drawBrokenBox(ctx, inst, vp, selected) {
  const td = inst.typeData;
  const corners = [
    [0, 0],
    [td.width, 0],
    [td.width, td.height],
    [0, td.height],
  ].map(([dx, dy]) => {
    const r = rotateOffset(dx, dy, inst.rotation);
    return worldToScreen({ x: inst.x + r.x, y: inst.y + r.y }, vp);
  });
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = "#fdeaea";
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = "#b00020";
  ctx.stroke();
}

// drawPort renders a port / off-sheet connector (FR-094/FR-094b, §6.14): a
// pentagon "flag" showing the instance's label, a "/n" width annotation when
// width>1, and a small filled apex mark when it carries an off-sheet target
// (FR-101). The flat back edge sits on the connection-pin side (into the sheet);
// the body tapers to an apex pointing off-sheet (the front), opposite the pin.
// The pentagon is built in the local grid frame and projected through
// rotateOffset, so it rotates with the instance and the apex/pin relationship
// holds (FR-020); the label is drawn upright so it stays legible (FR-015).
function drawPort(ctx, inst, vp, selected) {
  const td = inst.typeData;
  const w = td.width;
  const h = td.height;
  // Project a local grid point (origin at the instance, before rotation) to the
  // screen, following the instance rotation — same path the pin bubble takes.
  const local = (dx, dy) => {
    const o = rotateOffset(dx, dy, inst.rotation);
    return worldToScreen({ x: inst.x + o.x, y: inst.y + o.y }, vp);
  };
  const center = local(w / 2, h / 2);
  const shoulderX = w * 0.4; // where the rectangular body tapers toward the apex

  // Pentagon: flat back edge at local x=w (the pin side), apex at local x=0.
  const pts = [
    local(w, 0), // back-top
    local(w, h), // back-bottom
    local(shoulderX, h), // bottom shoulder
    local(0, h / 2), // apex (off-sheet front)
    local(shoulderX, 0), // top shoulder
  ];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  ctx.stroke();

  // Off-sheet connectors are marked with a small filled triangle at the apex
  // (FR-101) — the end that leaves the sheet.
  if (inst.target) {
    const tip = local(0, h / 2);
    const a = local(w * 0.25, h / 2 - 0.3);
    const b = local(w * 0.25, h / 2 + 0.3);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
    ctx.fillStyle = selected ? "#4a90d9" : "#333";
    ctx.fill();
  }

  const text = inst.label ?? ""; // a 1-wide port is always one bit (FR-094)
  ctx.fillStyle = "#000";
  ctx.font = Math.round(0.45 * scaleFor(vp)) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, center.x, center.y);
}

// switchFace maps the input switch's state to its value-bubble colors and glyph
// (FR-071c), mirroring the state indicator's driven look (indicatorState): a
// white bubble with a black "1", or a black bubble with a white "0". A legacy
// "U" (older saved design) and any unset value read as 0.
function switchFace(inst) {
  if (inst.switchState === "1") return { bg: "#ffffff", fg: "#000", glyph: "1" };
  return { bg: "#000000", fg: "#fff", glyph: "0" };
}

// Switch value-bubble radius (grid units): a touch smaller than the indicator's
// so the source arrow fits between the rim and the OUT pin point (grid x=2) on
// the 2×2 footprint.
const SWITCH_RADIUS = 0.7;

// drawSwitch renders the input switch (FR-071c): the same value bubble as the
// state indicator showing inst.switchState (white 1 / black 0), plus a small
// arrow off the bubble toward the OUT pin marking it a signal source. The
// glyph is drawn upright (FR-015); the arrow is built in the unrotated local
// grid frame and rotated with the instance, so it always points along the
// output pin (right when unrotated).
function drawSwitch(ctx, inst, vp, selected) {
  const cr = rotateOffset(1, 1, inst.rotation); // 2×2 center
  const center = worldToScreen({ x: inst.x + cr.x, y: inst.y + cr.y }, vp);
  const r = SWITCH_RADIUS * scaleFor(vp);
  const stroke = selected ? "#4a90d9" : "#333";

  // Value bubble (same look as the indicator).
  const face = switchFace(inst);
  ctx.beginPath();
  ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
  ctx.fillStyle = face.bg;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.fillStyle = face.fg;
  ctx.font = "bold " + Math.round(r * 1.2) + "px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(face.glyph, center.x, center.y);

  // Source arrow: a filled triangle from the bubble rim out to the OUT pin
  // point, in the unrotated local frame (origin at inst.x,inst.y; +x toward the
  // pin), then rotated and projected so it follows the instance.
  const local = (dx, dy) => {
    const o = rotateOffset(dx, dy, inst.rotation);
    return worldToScreen({ x: inst.x + o.x, y: inst.y + o.y }, vp);
  };
  const tip = local(2.0, 1); // the OUT pin grid point
  const a = local(1.72, 0.82);
  const b = local(1.72, 1.18);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.closePath();
  ctx.fillStyle = stroke;
  ctx.fill();
}

// (sideOutward now lives in model/design.js, shared with pinVisualPos.)
