// Schematic symbol geometry for subunit components (§6.8a, FR-013a/013b/014a).
// This is the single source of truth for where a subunit's pins sit and how its
// symbol is drawn, in grid units, so the model (pin positions), the renderer, and
// hit-testing cannot drift apart. All offsets are integers, so pins land on grid
// intersections (FR-021); the only fractional geometry is cosmetic (mux select
// stubs, inversion bubbles), never a connection point.

import { worldToScreen, scaleFor, rotateOffset } from "../geometry.js";

// Required (data, select) input counts per multiplexer (data on the left, selects
// on the top — FR-013b). Mirrors the server's muxArity validation.
const MUX_ARITY = { mux2: { data: 2, sel: 1 }, mux4: { data: 4, sel: 2 }, mux8: { data: 8, sel: 3 } };

const INVERTING = new Set(["nand", "nor", "xnor", "not"]);
const GATE_BODY_W = 4; // and/or/xor families
const NOT_BODY_W = 3;

function isMux(renderAs) {
  return Object.prototype.hasOwnProperty.call(MUX_ARITY, renderAs);
}

function bodyWidth(renderAs) {
  return renderAs === "not" ? NOT_BODY_W : GATE_BODY_W;
}

// gateInputCount returns a unit's input count = pins that are inputs entering on
// the left (for a mux this is the data-input count; selects enter on top).
export function gateInputCount(typeData) {
  let n = 0;
  for (const p of typeData.pins) {
    if (p.direction === "in" && p.side === "left") n++;
  }
  return n;
}

// pinRole classifies a subunit pin onto a symbol slot family: an output, a
// left-side input (`in`), or a top-side select (`sel`).
function pinRole(pin) {
  if (pin.direction !== "in") return "out";
  return pin.side === "top" ? "sel" : "in";
}

// pinSlot returns {role, slot} for one of a unit's pins: slot is the pin's index
// among same-role pins in YAML list order (FR-014a).
export function pinSlot(typeData, pin) {
  const role = pinRole(pin);
  let slot = 0;
  for (const p of typeData.pins) {
    if (p === pin) break;
    if (pinRole(p) === role) slot++;
  }
  return { role, slot };
}

// symbolFootprint returns the unit's grid-unit bounding box {width, height}.
export function symbolFootprint(renderAs, nIn) {
  if (isMux(renderAs)) {
    const { sel } = MUX_ARITY[renderAs];
    return { width: sel + 1, height: nIn + 1 };
  }
  const w = bodyWidth(renderAs) + (INVERTING.has(renderAs) ? 1 : 0);
  return { width: w, height: 2 * nIn };
}

// pinSlotOffset returns the unrotated integer grid offset of a pin from the
// instance origin, by symbol, input count, role, and slot.
export function pinSlotOffset(renderAs, nIn, role, slot) {
  if (isMux(renderAs)) return muxOffset(renderAs, nIn, role, slot);
  return gateOffset(renderAs, nIn, role, slot);
}

function gateOffset(renderAs, nIn, role, slot) {
  if (role === "out") {
    const w = bodyWidth(renderAs) + (INVERTING.has(renderAs) ? 1 : 0);
    return { x: w, y: nIn }; // output centered between the inputs (rows 1,3,5,…)
  }
  return { x: 0, y: 1 + 2 * slot };
}

function muxOffset(renderAs, nData, role, slot) {
  const { sel } = MUX_ARITY[renderAs];
  const W = sel + 1;
  if (role === "out") return { x: W, y: Math.round((nData + 1) / 2) };
  if (role === "sel") return { x: 1 + slot, y: 0 }; // on-grid bubble above the slope
  return { x: 0, y: 1 + slot }; // data input
}

// drawSymbol strokes the unit's symbol outline (and any cosmetic detail: inversion
// bubble, mux select stubs) using the ctx's current fill/stroke styles. Pin
// connection bubbles and labels are drawn by the common pin path in canvas.js.
export function drawSymbol(ctx, instance, vp) {
  const td = instance.typeData;
  const renderAs = td.renderAs;
  const nIn = gateInputCount(td);
  const scale = scaleFor(vp);

  // map a symbol-space grid offset to a screen point through rotation + viewport.
  const P = (dx, dy) => {
    const r = rotateOffset(dx, dy, instance.rotation);
    return worldToScreen({ x: instance.x + r.x, y: instance.y + r.y }, vp);
  };
  const ring = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = P(p[0], p[1]);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  if (isMux(renderAs)) {
    drawMux(ctx, renderAs, nIn, P, ring);
    return;
  }
  drawGate(ctx, renderAs, nIn, P, ring, scale);
}

function drawGate(ctx, renderAs, nIn, P, ring, scale) {
  const w = bodyWidth(renderAs);
  const H = 2 * nIn;
  const cy = nIn; // vertical center

  if (renderAs === "not") {
    ring([[0, 0], [w, cy], [0, H]]);
  } else if (renderAs === "and" || renderAs === "nand") {
    // flat back at x=0, semicircular front bulging to the tip (w, cy).
    const pts = [[0, 0], [w / 2, 0]];
    pushArc(pts, w / 2, cy, w / 2, cy, -Math.PI / 2, Math.PI / 2);
    pts.push([0, H]);
    ring(pts);
  } else {
    // or/nor/xor/xnor: concave back, curved sides meeting at a point (w, cy).
    const pts = [];
    pushQuad(pts, [0, 0], [w * 0.5, 0], [w, cy]); // top
    pushQuad(pts, [w, cy], [w * 0.5, H], [0, H]); // bottom
    pushQuad(pts, [0, H], [1.1, cy], [0, 0]); // concave back
    ring(pts);
    if (renderAs === "xor" || renderAs === "xnor") {
      strokeQuad(ctx, P, [-0.6, H], [0.5, cy], [-0.6, 0]); // double back line
    }
  }

  if (INVERTING.has(renderAs)) {
    drawBubble(ctx, P, w + 0.35, cy, 0.35 * scale); // inversion bubble
    const a = P(w + 0.7, cy);
    const b = P(w + 1, cy);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function drawMux(ctx, renderAs, nData, P, ring) {
  const { sel } = MUX_ARITY[renderAs];
  const W = sel + 1;
  const leftH = nData + 1;
  const slope = Math.round(W / 2);
  ring([
    [0, 0],
    [W, slope],
    [W, leftH - slope],
    [0, leftH],
  ]);
  // select stubs: short line from the sloped top edge up to the on-grid bubble.
  for (let i = 0; i < sel; i++) {
    const x = 1 + i;
    const edgeY = (slope * x) / W;
    const a = P(x, edgeY);
    const b = P(x, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// --- curve helpers: sample in symbol space so the affine map (rotate+viewport)
// renders them correctly under any rotation.

const SAMPLES = 12;

function pushArc(pts, cx, cy, rx, ry, t0, t1) {
  for (let i = 0; i <= SAMPLES; i++) {
    const t = t0 + ((t1 - t0) * i) / SAMPLES;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
}

function quadPoint(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

function pushQuad(pts, p0, p1, p2) {
  for (let i = 0; i <= SAMPLES; i++) pts.push(quadPoint(p0, p1, p2, i / SAMPLES));
}

function strokeQuad(ctx, P, p0, p1, p2) {
  ctx.beginPath();
  for (let i = 0; i <= SAMPLES; i++) {
    const q = quadPoint(p0, p1, p2, i / SAMPLES);
    const s = P(q[0], q[1]);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

function drawBubble(ctx, P, cx, cy, r) {
  const c = P(cx, cy);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
