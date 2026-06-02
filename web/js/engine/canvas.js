// Canvas renderer: draws the whole scene and owns the render loop (§6.8). It is
// read-only over the model and re-renders only when something requests it, to
// stay responsive without busy-spinning (NFR-005).

import {
  worldToScreen,
  screenToWorld,
  scaleFor,
  rotateOffset,
} from "../geometry.js";
import { pinWorldPos } from "../model/design.js";

const STUB_LEN = 1; // grid units
const PIN_FONT = "10px system-ui, sans-serif";
const LABEL_FONT = "bold 11px system-ui, sans-serif";

// initCanvas attaches a renderer to a <canvas> bound to a store. Returns a small
// controller (§6.8 interface).
export function initCanvas(canvasEl, store) {
  const ctx = canvasEl.getContext("2d");
  let dirty = true;
  let frame = null;

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
    drawComponents(ctx, store.design, vp, store.state.selection);
    ctx.restore();
  }

  const unsubscribe = store.subscribe(requestRender);
  window.addEventListener("resize", resize);
  resize();

  return {
    requestRender,
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
    drawComponent(ctx, inst, vp, inst.refdes === selection);
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

  // Pin stubs + upright pin name labels.
  ctx.font = PIN_FONT;
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pin of td.pins) {
    const pw = pinWorldPos(inst, pin.name);
    const ps = worldToScreen(pw, vp);
    const out = sideOutward(pin.side);
    const outR = rotateOffset(out.x, out.y, inst.rotation);
    const stub = worldToScreen(
      { x: pw.x + outR.x * STUB_LEN, y: pw.y + outR.y * STUB_LEN },
      vp,
    );

    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ps.x, ps.y);
    ctx.lineTo(stub.x, stub.y);
    ctx.stroke();

    // Label sits just inside the body (opposite the outward direction), drawn
    // in screen space so it stays upright regardless of rotation (FR-015).
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
