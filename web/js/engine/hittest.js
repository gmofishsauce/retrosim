// Hit-testing in world coordinates (§6.9). Works on grid units, independent of
// zoom/pan, so it is testable without a canvas. Pins take priority over bodies
// when both are hit (the caller decides ordering).

import { rotateOffset } from "../geometry.js";
import { pinVisualPos, getVertex, vertexWorld } from "../model/design.js";

// componentBBox returns the axis-aligned world bounding box of an instance's
// outline. Since rotation is a multiple of 90 degrees the rotated rectangle is
// still axis-aligned, so the bbox is exact. Exported for the router (§6.9a),
// which uses these same rectangles as its obstacles.
export function componentBBox(inst) {
  const td = inst.typeData;
  const corners = [
    [0, 0],
    [td.width, 0],
    [td.width, td.height],
    [0, td.height],
  ].map(([dx, dy]) => {
    const r = rotateOffset(dx, dy, inst.rotation);
    return { x: inst.x + r.x, y: inst.y + r.y };
  });
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// hitComponent returns the topmost (last-added) instance whose outline contains
// the world point, or null.
export function hitComponent(design, pt) {
  for (let i = design.components.length - 1; i >= 0; i--) {
    const inst = design.components[i];
    const b = componentBBox(inst);
    if (pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY) {
      return inst;
    }
  }
  return null;
}

// PIN_HIT_TOL is the pin hot-region radius in grid units (FR-013d), centered
// on the pin's visual attachment point (pinVisualPos). Adjacent pins sit one
// grid unit apart, so any tolerance > 0.5 overlaps a neighbor — hitPin
// therefore returns the nearest pin, not the first found within tolerance.
export const PIN_HIT_TOL = 0.7;

// hitPin returns { refdes, pin } for the nearest pin whose hot region
// (FR-013d) contains the world point, or null.
export function hitPin(design, pt, tol = PIN_HIT_TOL) {
  const tol2 = tol * tol;
  let best = null;
  let bestD2 = Infinity;
  for (let i = design.components.length - 1; i >= 0; i--) {
    const inst = design.components[i];
    for (const pin of inst.typeData.pins) {
      const w = pinVisualPos(inst, pin.name);
      const dx = w.x - pt.x;
      const dy = w.y - pt.y;
      const d2 = dx * dx + dy * dy;
      // Strict < keeps the topmost (first-visited) pin on exact ties.
      if (d2 <= tol2 && d2 < bestD2) {
        best = { refdes: inst.refdes, pin: pin.name };
        bestD2 = d2;
      }
    }
  }
  return best;
}

// pathPointWorld returns the world coordinate of a wire/bus path point: a node's
// position comes from its vertex (derived for pins), a bend carries its own.
function pathPointWorld(design, p) {
  if (p.t === "node") return vertexWorld(design, getVertex(design, p.v));
  return { x: p.x, y: p.y };
}

// distToSegment returns the distance from point p to segment a-b.
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

// hitBusSegment returns { bus, segIndex, dist } for the nearest bus segment
// within tol grid units of the world point, or null.
export function hitBusSegment(design, pt, tol = 0.5) {
  let best = null;
  for (const b of design.buses) {
    for (let i = 0; i < b.path.length - 1; i++) {
      const a = pathPointWorld(design, b.path[i]);
      const c = pathPointWorld(design, b.path[i + 1]);
      const d = distToSegment(pt, a, c);
      if (d <= tol && (best === null || d < best.dist)) {
        best = { bus: b, segIndex: i, dist: d };
      }
    }
  }
  return best;
}

// hitBend returns { wire, bendIndex } for an interior bend point within tol grid
// units of the world point, or null. Buses carry bends under the same path model
// (FR-039), so both conductor kinds are searched; `wire` may be a bus.
export function hitBend(design, pt, tol = 0.5) {
  const tol2 = tol * tol;
  for (const w of [...design.wires, ...design.buses]) {
    for (let i = 1; i < w.path.length - 1; i++) {
      const p = w.path[i];
      if (p.t !== "bend") continue;
      const dx = p.x - pt.x;
      const dy = p.y - pt.y;
      if (dx * dx + dy * dy <= tol2) return { wire: w, bendIndex: i };
    }
  }
  return null;
}

// hitSegment returns { wire, segIndex, dist } for the nearest wire segment within
// tol grid units of the world point, or null. Works in world coords (zoom-free).
export function hitSegment(design, pt, tol = 0.5) {
  let best = null;
  for (const w of design.wires) {
    for (let i = 0; i < w.path.length - 1; i++) {
      const a = pathPointWorld(design, w.path[i]);
      const b = pathPointWorld(design, w.path[i + 1]);
      const d = distToSegment(pt, a, b);
      if (d <= tol && (best === null || d < best.dist)) {
        best = { wire: w, segIndex: i, dist: d };
      }
    }
  }
  return best;
}
