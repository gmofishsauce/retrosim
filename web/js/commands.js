// Concrete commands: reversible mutations dispatched through the store (§6.10).
// Each factory returns { apply(design), revert(design), label }. Commands capture
// enough pre-state in closures to revert exactly, including on redo.

import { addInstance } from "./model/design.js";

function findInstance(design, refdes) {
  const inst = design.components.find((c) => c.refdes === refdes);
  if (!inst) throw new Error(`no such component ${refdes}`);
  return inst;
}

// placeComponent adds a new instance (FR-008/009/011). The instance is created
// on first apply and re-used on redo so its reference designator is stable.
export function placeComponent(type, x, y, rotation = 0) {
  let inst = null;
  return {
    label: `Place ${type.name}`,
    apply(design) {
      if (inst === null) {
        inst = addInstance(design, type, x, y, rotation);
      } else {
        design.components.push(inst);
      }
    },
    revert(design) {
      const i = design.components.indexOf(inst);
      if (i >= 0) design.components.splice(i, 1);
    },
  };
}

// moveComponent repositions an instance (FR-017). The old position is captured
// on first apply.
export function moveComponent(refdes, x, y) {
  let old = null;
  return {
    label: `Move ${refdes}`,
    apply(design) {
      const inst = findInstance(design, refdes);
      if (old === null) old = { x: inst.x, y: inst.y };
      inst.x = x;
      inst.y = y;
    },
    revert(design) {
      const inst = findInstance(design, refdes);
      inst.x = old.x;
      inst.y = old.y;
    },
  };
}

// rotateComponent rotates an instance by a signed degree delta (FR-019). The old
// rotation is captured on first apply.
export function rotateComponent(refdes, delta) {
  let old = null;
  return {
    label: `Rotate ${refdes}`,
    apply(design) {
      const inst = findInstance(design, refdes);
      if (old === null) old = inst.rotation;
      inst.rotation = (((old + delta) % 360) + 360) % 360;
    },
    revert(design) {
      const inst = findInstance(design, refdes);
      inst.rotation = old;
    },
  };
}

// deleteComponent removes an instance (FR-018a). Its object and array index are
// captured so undo restores it exactly where it was. (Wire/bus dangling on
// delete is handled in the wiring phase.)
export function deleteComponent(refdes) {
  let removed = null;
  let index = -1;
  return {
    label: `Delete ${refdes}`,
    apply(design) {
      const inst = findInstance(design, refdes);
      index = design.components.indexOf(inst);
      removed = inst;
      design.components.splice(index, 1);
    },
    revert(design) {
      design.components.splice(index, 0, removed);
    },
  };
}
