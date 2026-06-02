// Concrete commands: reversible mutations dispatched through the store (§6.10).
// Each factory returns { apply(design), revert(design), label }. Commands capture
// enough pre-state in closures to revert exactly, including on redo.

import {
  addInstance,
  addWire,
  deleteWire,
  deleteInstance,
  branchWire,
  insertBend,
  moveBend,
} from "./model/design.js";

function findInstance(design, refdes) {
  const inst = design.components.find((c) => c.refdes === refdes);
  if (!inst) throw new Error(`no such component ${refdes}`);
  return inst;
}

// --- snapshot-based commands for connectivity cascades (§6.10, §3.3) ---
//
// Commands that delete components/wires trigger G2 junction demotion and the
// FR-030 prune, which can cascade across the design. Rather than track every
// micro-change, these capture a snapshot of the connectivity collections on
// first apply and restore it to undo — exact and simple.

const CONNECTIVITY_KEYS = [
  "components",
  "wires",
  "buses",
  "vertices",
];

function snapshotConnectivity(design) {
  const snap = { nextWireId: design.nextWireId, nextVertexId: design.nextVertexId };
  for (const k of CONNECTIVITY_KEYS) snap[k] = structuredClone(design[k]);
  return snap;
}

function restoreConnectivity(design, snap) {
  for (const k of CONNECTIVITY_KEYS) {
    design[k].length = 0;
    design[k].push(...structuredClone(snap[k]));
  }
  design.nextWireId = snap.nextWireId;
  design.nextVertexId = snap.nextVertexId;
}

function snapshotCommand(label, mutate) {
  let snap = null;
  return {
    label,
    apply(design) {
      if (snap === null) snap = snapshotConnectivity(design);
      mutate(design);
    },
    revert(design) {
      restoreConnectivity(design, snap);
    },
  };
}

// resolveSpec turns a wire-endpoint spec into an addWire endpoint, creating a
// junction first for a "branch" spec. Specs: {kind:"pin",refdes,pin} |
// {kind:"free",x,y} | {kind:"vertex",id} | {kind:"branch",wireId,segIndex,x,y}.
function resolveSpec(design, spec) {
  if (spec.kind === "branch") {
    const host = design.wires.find((w) => w.id === spec.wireId);
    if (!host) throw new Error(`no such wire ${spec.wireId}`);
    const j = branchWire(design, host, spec.segIndex, spec.x, spec.y);
    return { kind: "vertex", id: j.id };
  }
  return spec;
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

// deleteComponent removes an instance and frees its pins, leaving connected
// wires dangling and pruning any left fully disconnected (FR-018a/029/030).
// Snapshot-based so undo restores the full connectivity cascade.
export function deleteComponent(refdes) {
  return snapshotCommand(`Delete ${refdes}`, (design) =>
    deleteInstance(design, refdes),
  );
}

// addWireCmd adds a wire between two endpoint specs (FR-027/034). Branch specs
// create a junction on a host wire first (FR-034b).
export function addWireCmd(specA, specB) {
  return snapshotCommand("Add wire", (design) => {
    const a = resolveSpec(design, specA);
    const b = resolveSpec(design, specB);
    addWire(design, a, b);
  });
}

// deleteWireCmd removes a wire and runs the connectivity cleanup (FR-033a).
export function deleteWireCmd(wireId) {
  return snapshotCommand(`Delete wire ${wireId}`, (design) =>
    deleteWire(design, wireId),
  );
}

// insertBendCmd inserts a bend by splitting a segment (FR-031).
export function insertBendCmd(wireId, segIndex, x, y) {
  let bendIndex = -1;
  return {
    label: "Insert bend",
    apply(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      bendIndex = insertBend(w, segIndex, x, y);
    },
    revert(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      w.path.splice(bendIndex, 1);
    },
  };
}

// moveBendCmd repositions a bend (FR-032), capturing the old position to undo.
export function moveBendCmd(wireId, bendIndex, x, y) {
  let old = null;
  return {
    label: "Move bend",
    apply(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      if (old === null) old = { x: w.path[bendIndex].x, y: w.path[bendIndex].y };
      moveBend(w, bendIndex, x, y);
    },
    revert(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      moveBend(w, bendIndex, old.x, old.y);
    },
  };
}
