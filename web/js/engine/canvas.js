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
  PIN_RADIUS,
} from "../model/design.js";
import { drawSymbol, pinHasOwnBubble, pinLabelEdge } from "./symbols.js";
import { V0, V1 } from "./galasm.js";

// Bubble radius (grid units) for the state-indicator built-in, sized to sit
// comfortably inside its 2x2 footprint (FR-068).
const INDICATOR_RADIUS = 0.85;
const PIN_FONT = "10px system-ui, sans-serif";
const LABEL_FONT = "bold 11px system-ui, sans-serif";
// Conflicted nets stroke red while the conflict persists (FR-082).
const CONFLICT_COLOR = "#b00020";

// initCanvas attaches a renderer to a <canvas> bound to a store. Returns a small
// controller (§6.8 interface).
export function initCanvas(canvasEl, store) {
  const ctx = canvasEl.getContext("2d");
  let dirty = true;
  let frame = null;
  let preview = null; // transient {points: [{x,y}, …]} in world coords

  function requestRender() {
    dirty = true;
    if (frame == null) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(canvasEl.clientWidth * dpr);
    canvasEl.height = Math.round(canvasEl.clientHeight * dpr);
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
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, vp);
    drawBuses(ctx, store.design, vp, store.state.selection, conflicts);
    drawWires(ctx, store.design, vp, store.state.selection, conflicts);
    drawVertices(ctx, store.design, vp);
    drawComponents(ctx, store.design, vp, store.state.selection, store.state.hover, sim);
    if (preview) drawPreview(ctx, preview, vp);
    ctx.restore();
  }

  const unsubscribe = store.subscribe(requestRender);
  window.addEventListener("resize", resize);
  resize();

  return {
    requestRender,
    setPreview(p) {
      preview = p;
      requestRender();
    },
    setViewport(viewport) {
      store.state.viewport = viewport;
      requestRender();
    },
    destroy() {
      unsubscribe();
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

function drawComponents(ctx, design, vp, selection, hover, sim) {
  if (!design) return;
  for (const inst of design.components) {
    const selected =
      selection?.kind === "component" && selection.refdes === inst.refdes;
    const hovered = hover === inst.refdes;
    drawComponent(ctx, inst, vp, selected, hovered, sim);
  }
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
    if (v?.kind === "pin") {
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
    const selected = selection?.kind === "wire" && selection.id === w.id;
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
    const selected = selection?.kind === "bus" && selection.id === b.id;
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
  if (!pts || pts.length < 2) return;
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

// drawVertices marks junctions (filled dots) and dangling free ends (hollow
// squares) so connectivity is visible.
function drawVertices(ctx, design, vp) {
  if (!design) return;
  for (const v of design.vertices) {
    if (v.kind === "junction") {
      const s = worldToScreen(vertexWorld(design, v), vp);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#000";
      ctx.fill();
    } else if (v.kind === "free") {
      const s = worldToScreen(vertexWorld(design, v), vp);
      ctx.strokeStyle = "#b00020";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x - 2.5, s.y - 2.5, 5, 5);
    }
  }
}

function drawComponent(ctx, inst, vp, selected, hovered, sim) {
  const td = inst.typeData;
  if (!td) return;

  // Body: a schematic symbol for subunit components (§6.8a), else the outline
  // rectangle. Both rotate about the instance origin and share the pin path below.
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  if (td.renderType === "subunit") {
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
    // top of the glyph).
    if (!td.builtin) {
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
    ctx.fillText(inst.refdes, center.x, center.y);
  } else if (td.builtin) {
    // Refdes above the symbol so it clears the glyph; the upper bound on any
    // 90°-rotation's vertical extent is max(width,height).
    const off = (Math.max(td.width, td.height) / 2) * scaleFor(vp) + 7;
    ctx.fillText(inst.refdes, center.x, center.y - off);
  } else {
    ctx.fillText(inst.refdes, center.x, center.y - 6);
    ctx.fillText(inst.type, center.x, center.y + 6);
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

// (sideOutward now lives in model/design.js, shared with pinVisualPos.)
