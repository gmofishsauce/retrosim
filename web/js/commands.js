// Concrete commands: reversible mutations dispatched through the store (§6.10).
// Each factory returns { apply(design), revert(design), label }. Commands capture
// enough pre-state in closures to revert exactly, including on redo.

import {
  addInstance,
  addSubunitPackage,
  packageSiblings,
  addWire,
  deleteWire,
  deleteInstance,
  branchWire,
  insertBend,
  moveBend,
  deleteBend,
  addBus,
  deleteBus,
  setBusWidth,
  snapBusGroup,
  breakoutBit,
  setBusBitNames,
  setOverride,
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
  const snap = {
    nextWireId: design.nextWireId,
    nextBusId: design.nextBusId,
    nextVertexId: design.nextVertexId,
  };
  for (const k of CONNECTIVITY_KEYS) snap[k] = structuredClone(design[k]);
  return snap;
}

function restoreConnectivity(design, snap) {
  for (const k of CONNECTIVITY_KEYS) {
    design[k].length = 0;
    design[k].push(...structuredClone(snap[k]));
  }
  design.nextWireId = snap.nextWireId;
  design.nextBusId = snap.nextBusId;
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
    const host =
      design.wires.find((w) => w.id === spec.wireId) ??
      design.buses.find((b) => b.id === spec.wireId);
    if (!host) throw new Error(`no such conductor ${spec.wireId}`);
    const j = branchWire(design, host, spec.segIndex, spec.x, spec.y);
    return { kind: "vertex", id: j.id };
  }
  return spec;
}

// placeComponent adds a new instance (FR-008/009/011). The instance is created
// on first apply and re-used on redo so its reference designator is stable.
export function placeComponent(type, x, y, rotation = 0) {
  let created = null; // instances made on first apply, re-used on redo
  return {
    label: `Place ${type.name}`,
    apply(design) {
      if (created === null) {
        // A subunit package drops all of its units at once (FR-013a); a unit
        // component drops a single instance.
        created =
          type.renderType === "subunit"
            ? addSubunitPackage(design, type, x, y)
            : [addInstance(design, type, x, y, rotation)];
      } else {
        for (const inst of created) design.components.push(inst);
      }
    },
    revert(design) {
      for (const inst of created) {
        const i = design.components.indexOf(inst);
        if (i >= 0) design.components.splice(i, 1);
      }
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
  return snapshotCommand(`Delete ${refdes}`, (design) => {
    // Deleting a subunit deletes its whole package (FR-018b); a unit deletes only
    // itself. The user confirmation is a chrome-layer concern (interaction.js).
    for (const r of packageSiblings(design, refdes)) deleteInstance(design, r);
  });
}

// setOverrideCmd sets or clears a per-instance propagation-delay override
// (FR-020a/FR-058). It captures the prior value once so undo restores it (null
// meaning "no override"). value === null clears the override.
export function setOverrideCmd(refdes, key, value) {
  let captured = false;
  let old = null;
  return {
    label: "Set override",
    apply(design) {
      const inst = findInstance(design, refdes);
      if (!captured) {
        const cur = inst.overrides.delays?.[key];
        old = cur === undefined ? null : cur;
        captured = true;
      }
      setOverride(design, refdes, key, value);
    },
    revert(design) {
      setOverride(design, refdes, key, old);
    },
  };
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

// deleteBendCmd removes an interior bend, merging the two adjoining segments
// (FR-033), capturing the removed point so undo re-inserts it at the same index.
export function deleteBendCmd(wireId, bendIndex) {
  let removed = null;
  return {
    label: "Delete bend",
    apply(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      removed = { ...w.path[bendIndex] };
      deleteBend(w, bendIndex);
    },
    revert(design) {
      const w = design.wires.find((wr) => wr.id === wireId);
      w.path.splice(bendIndex, 0, removed);
    },
  };
}

// addBusCmd adds a bus between two endpoint specs at the given width (FR-035).
// snaps optionally group-snaps an endpoint to a component at creation time
// (FR-041a/042): each entry is { end:"a"|"b", refdes, group }. Folding the snap
// into this command keeps the whole drop gesture a single undo step; the snapshot
// revert already covers the added groupConnection and adopted bit names.
export function addBusCmd(specA, specB, width, snaps = []) {
  return snapshotCommand("Add bus", (design) => {
    const a = resolveSpec(design, specA);
    const b = resolveSpec(design, specB);
    const bus = addBus(design, a, b, width);
    for (const s of snaps) {
      const last = bus.path.length - 1;
      const vid = s.end === "a" ? bus.path[0].v : bus.path[last].v;
      snapBusGroup(design, bus.id, vid, s.refdes, s.group);
    }
  });
}

// deleteBusCmd removes a bus and runs the connectivity cleanup (FR-033a).
export function deleteBusCmd(busId) {
  return snapshotCommand(`Delete bus ${busId}`, (design) =>
    deleteBus(design, busId),
  );
}

// setBusWidthCmd changes a bus's width (FR-038), capturing the old width and bit
// names so undo restores them.
export function setBusWidthCmd(busId, width) {
  let old = null;
  return {
    label: "Set bus width",
    apply(design) {
      const bus = design.buses.find((b) => b.id === busId);
      if (old === null) old = { width: bus.width, bitNames: bus.bitNames };
      setBusWidth(design, busId, width);
    },
    revert(design) {
      const bus = design.buses.find((b) => b.id === busId);
      bus.width = old.width;
      bus.bitNames = old.bitNames;
    },
  };
}

// snapBusGroupCmd connects a bus endpoint to a component pin group (FR-042). It
// adds a group connection and may adopt bit names (FR-037b); undo drops the added
// connection and restores the prior bit names. No connectivity cascade, so a
// snapshot is unnecessary.
export function snapBusGroupCmd(busId, vertexId, instanceRefdes, groupName) {
  let old = null;
  return {
    label: "Snap bus to group",
    apply(design) {
      const bus = design.buses.find((b) => b.id === busId);
      if (old === null) {
        old = { connCount: bus.groupConnections.length, bitNames: bus.bitNames };
      }
      snapBusGroup(design, busId, vertexId, instanceRefdes, groupName);
    },
    revert(design) {
      const bus = design.buses.find((b) => b.id === busId);
      bus.groupConnections.length = old.connCount;
      bus.bitNames = old.bitNames;
    },
  };
}

// breakoutBitCmd taps one bus bit onto a new single-bit wire (FR-043a). Like a
// branch, it creates a junction vertex and a wire, so it is snapshot-based.
export function breakoutBitCmd(busId, segIndex, x, y, bit, dest) {
  return snapshotCommand("Break out bus bit", (design) =>
    breakoutBit(design, busId, segIndex, x, y, bit, dest),
  );
}

// setBusBitNamesCmd sets a bus's per-bit names (FR-037b), capturing the old names
// so undo restores them.
export function setBusBitNamesCmd(busId, names) {
  let old = null;
  return {
    label: "Set bus bit names",
    apply(design) {
      const bus = design.buses.find((b) => b.id === busId);
      if (old === null) old = { bitNames: bus.bitNames };
      setBusBitNames(design, busId, names);
    },
    revert(design) {
      const bus = design.buses.find((b) => b.id === busId);
      bus.bitNames = old.bitNames;
    },
  };
}
