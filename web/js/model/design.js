// In-browser canonical design model and pure operations on it (§6.6, §7.5).
// Mutations are normally driven by Command objects (store.js), but the low-level
// operations live here so they are unit-testable in isolation.

import { rotateOffset } from "../geometry.js";

// createDesign returns an empty design (FR-004/FR-045). It mirrors the save
// shape (§7.2) plus non-persisted id counters.
export function createDesign(name) {
  return {
    formatVersion: 1,
    name,
    components: [],
    wires: [],
    buses: [],
    vertices: [],
    nextWireId: 1,
    nextVertexId: 1,
  };
}

// nextRefNum returns one more than the highest U-number currently in use, so
// reference designators increment past gaps left by deletions (FR-011).
function nextRefNum(components) {
  let max = 0;
  for (const c of components) {
    const m = /^U(\d+)$/.exec(c.refdes);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// addInstance places a component instance, assigning it a unique reference
// designator and a private copy of the type data (FR-011, FR-057).
export function addInstance(design, type, x, y, rotation) {
  const inst = {
    refdes: "U" + nextRefNum(design.components),
    type: type.name,
    x,
    y,
    rotation,
    typeData: structuredClone(type),
    overrides: {},
  };
  design.components.push(inst);
  return inst;
}

// pinOffset returns a pin's unrotated offset (grid units) from the instance
// origin, derived from its side and position along that side (§6.7).
function pinOffset(typeData, pin) {
  switch (pin.side) {
    case "left":
      return { x: 0, y: pin.position };
    case "right":
      return { x: typeData.width, y: pin.position };
    case "top":
      return { x: pin.position, y: 0 };
    case "bottom":
      return { x: pin.position, y: typeData.height };
    default:
      throw new Error(`pin ${pin.name}: invalid side ${pin.side}`);
  }
}

// pinWorldPos returns a pin's world (grid) coordinate, applying the instance's
// rotation. Wires reference the pin's vertex, which is recomputed from this when
// the instance moves or rotates, so connected segments stretch (FR-018, §7.1a).
export function pinWorldPos(instance, pinName) {
  const pin = instance.typeData.pins.find((p) => p.name === pinName);
  if (!pin) {
    throw new Error(`unknown pin ${pinName} on ${instance.refdes}`);
  }
  const off = pinOffset(instance.typeData, pin);
  const r = rotateOffset(off.x, off.y, instance.rotation);
  return { x: instance.x + r.x, y: instance.y + r.y };
}
