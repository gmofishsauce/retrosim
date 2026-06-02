// Hit-testing in world coordinates (§6.9). Works on grid units, independent of
// zoom/pan, so it is testable without a canvas. Pins take priority over bodies
// when both are hit (the caller decides ordering).

import { rotateOffset } from "../geometry.js";
import { pinWorldPos } from "../model/design.js";

// componentBBox returns the axis-aligned world bounding box of an instance's
// outline. Since rotation is a multiple of 90 degrees the rotated rectangle is
// still axis-aligned, so the bbox is exact.
function componentBBox(inst) {
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

// hitPin returns { refdes, pin } for the topmost pin within tol grid units of
// the world point, or null.
export function hitPin(design, pt, tol = 0.5) {
  const tol2 = tol * tol;
  for (let i = design.components.length - 1; i >= 0; i--) {
    const inst = design.components[i];
    for (const pin of inst.typeData.pins) {
      const w = pinWorldPos(inst, pin.name);
      const dx = w.x - pt.x;
      const dy = w.y - pt.y;
      if (dx * dx + dy * dy <= tol2) {
        return { refdes: inst.refdes, pin: pin.name };
      }
    }
  }
  return null;
}
