// Canvas renderer: draws the whole scene and owns the render loop (§6.8). It is
// read-only over the model and re-renders only when something requests it, to
// stay responsive without busy-spinning (NFR-005).

import {
  worldToScreen,
  screenToWorld,
  scaleFor,
  rotateOffset,
} from "../geometry.js";
import { pinWorldPos, getVertex, vertexWorld } from "../model/design.js";

// Pin bubble radius in grid units. The bubble is drawn tangent to the body edge
// (center one radius outside the pin point), so its far edge is 2*PIN_RADIUS from
// the pin point; keeping that <= the 0.5-unit pin hit tolerance makes the whole
// bubble clickable while staying clear of adjacent pins 1 unit away (FR-013).
const PIN_RADIUS = 0.25;
const PIN_FONT = "10px system-ui, sans-serif";
const LABEL_FONT = "bold 11px system-ui, sans-serif";

// initCanvas attaches a renderer to a <canvas> bound to a store. Returns a small
// controller (§6.8 interface).
export function initCanvas(canvasEl, store) {
  const ctx = canvasEl.getContext("2d");
  let dirty = true;
  let frame = null;
  let preview = null; // transient {from:{x,y}, to:{x,y}} in world coords

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

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, vp);
    drawBuses(ctx, store.design, vp, store.state.selection);
    drawWires(ctx, store.design, vp, store.state.selection);
    drawVertices(ctx, store.design, vp);
    drawComponents(ctx, store.design, vp, store.state.selection);
    if (preview) drawPreview(ctx, preview, vp);
    ctx.restore();
  }

  const unsubscribe = store.subscribe(requestRender);
  window.addEventListener("resize", resize);
  resize();

  return {
    requestRender,
    setPreview(seg) {
      preview = seg;
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

function drawComponents(ctx, design, vp, selection) {
  if (!design) return;
  for (const inst of design.components) {
    const selected =
      selection?.kind === "component" && selection.refdes === inst.refdes;
    drawComponent(ctx, inst, vp, selected);
  }
}

// pathPointWorld returns a wire path point's world coordinate (node via vertex,
// bend via its own coords).
function pathPointWorld(design, p) {
  if (p.t === "node") return vertexWorld(design, getVertex(design, p.v));
  return { x: p.x, y: p.y };
}

// drawWires draws wires as thin black polylines (FR-036), highlighting the
// selected one.
function drawWires(ctx, design, vp, selection) {
  if (!design) return;
  for (const w of design.wires) {
    const pts = w.path.map((p) => worldToScreen(pathPointWorld(design, p), vp));
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    const selected = selection?.kind === "wire" && selection.id === w.id;
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.strokeStyle = selected ? "#4a90d9" : "#000";
    ctx.stroke();
  }
}

// drawBuses draws buses as thick blue polylines with a "/n" width annotation
// (FR-036/037), highlighting the selected one.
function drawBuses(ctx, design, vp, selection) {
  if (!design) return;
  for (const b of design.buses) {
    const pts = b.path.map((p) => worldToScreen(pathPointWorld(design, p), vp));
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    const selected = selection?.kind === "bus" && selection.id === b.id;
    ctx.lineWidth = selected ? 5 : 3;
    ctx.strokeStyle = selected ? "#4a90d9" : "#1565c0";
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

// drawPreview strokes the transient rubber-band line from the wire/bus source to
// the cursor while a draw gesture is in progress (FR-027a).
function drawPreview(ctx, seg, vp) {
  const a = worldToScreen(seg.from, vp);
  const b = worldToScreen(seg.to, vp);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#888";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
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

function drawComponent(ctx, inst, vp, selected) {
  const td = inst.typeData;
  if (!td) return;

  // Outline rectangle, rotated about the instance origin.
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
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? "#4a90d9" : "#333";
  ctx.stroke();

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

    // Bubble sits just outside the body, tangent to the edge: center is one
    // radius outward from the pin point (which stays the connection target, FR-013).
    const bc = worldToScreen(
      { x: pw.x + outR.x * PIN_RADIUS, y: pw.y + outR.y * PIN_RADIUS },
      vp,
    );
    ctx.beginPath();
    ctx.arc(bc.x, bc.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label sits just inside the body (opposite the outward direction), drawn
    // in screen space so it stays upright regardless of rotation (FR-015).
    ctx.fillStyle = "#333";
    ctx.fillText(pin.name, ps.x - Math.sign(outR.x) * 8, ps.y - Math.sign(outR.y) * 8);
  }

  // Refdes + type labels at the body center, upright (FR-012).
  const cr = rotateOffset(td.width / 2, td.height / 2, inst.rotation);
  const center = worldToScreen({ x: inst.x + cr.x, y: inst.y + cr.y }, vp);
  ctx.fillStyle = "#111";
  ctx.font = LABEL_FONT;
  ctx.fillText(inst.refdes, center.x, center.y - 6);
  ctx.fillText(inst.type, center.x, center.y + 6);
}

// sideOutward is the unit vector pointing away from the body for a pin's side,
// in the component's unrotated frame.
function sideOutward(side) {
  switch (side) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}
