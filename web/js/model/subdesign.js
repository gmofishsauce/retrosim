// Sub-designs, ports & off-sheet connectors (§6.14, requirements §3.22).
//
// A separately-saved design can be embedded in a higher-level design as a single
// component (a "sub-design instance"). Its external interface is the set of its
// ports (FR-095); embedding resolves that interface into a synthetic, in-memory
// ComponentType (never saved) so the whole pin/vertex/wire/netlist/render
// pipeline serves hierarchy unchanged — only render style, navigation, and
// flattening are new. This module owns the pure interface/synthesis helpers;
// flattening for the simulator (FR-102) lands in a later step.

import { nextRefNum } from "./design.js";

// designInterface returns a child design's external interface (FR-095): one
// pin per distinct port label, carrying that label's direction and width, in a
// deterministic order (by label). The first port seen for a label wins on a
// direction/width disagreement (a malformed child); callers may warn.
export function designInterface(childDesign) {
  const byLabel = new Map();
  for (const c of childDesign.components ?? []) {
    // Identify ports by renderType, not the `type` field — the latter is now the
    // library id (FR-066e), e.g. "type-port", not the bare "port".
    if (c.typeData?.renderType !== "port") continue;
    const label = c.label;
    if (label == null || label === "") continue;
    if (!byLabel.has(label)) {
      byLabel.set(label, { label, dir: c.portDir ?? "in", width: c.width ?? 1 });
    }
  }
  return [...byLabel.values()].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
  );
}

const IC_WIDTH = 6; // grid units; wide enough for interior pin labels
const CONNECTOR_WIDTH = 3; // a tall, narrow strip (FR-099)

// synthTypeForInterface builds the in-memory synthetic ComponentType for an
// embedded sub-design (FR-099). Both render styles are plain rectangles, so the
// generic component renderer and the pin machinery work unchanged; only the pin
// layout differs:
//   "ic"        — inputs on the left, outputs on the right, bidir on the left.
//   "connector" — all interface pins ranked along the right edge, in label order.
// Each pin's `width` (>1 for a bus interface) rides along for later bus snap.
export function synthTypeForInterface(iface, render, name = "subdesign") {
  if (render === "connector") {
    const pins = iface.map((p, i) => ({
      name: p.label,
      side: "right",
      position: i + 1,
      direction: p.dir,
      width: p.width,
    }));
    return {
      name,
      renderType: "unit",
      width: CONNECTOR_WIDTH,
      height: iface.length + 1,
      pins,
    };
  }
  // "ic": inputs (and bidir) left, outputs right.
  const left = [];
  const right = [];
  for (const p of iface) (p.dir === "out" ? right : left).push(p);
  const pins = [];
  left.forEach((p, i) =>
    pins.push({ name: p.label, side: "left", position: i + 1, direction: p.dir, width: p.width }),
  );
  right.forEach((p, i) =>
    pins.push({ name: p.label, side: "right", position: i + 1, direction: p.dir, width: p.width }),
  );
  return {
    name,
    renderType: "unit",
    width: IC_WIDTH,
    height: Math.max(left.length, right.length) + 1,
    pins,
  };
}

// resolveSubDesigns fills in (or refreshes) the in-memory synthetic typeData of
// every sub-design instance from its child file (FR-098 loading). It is the async
// load-time pass run after deserialize, since the synthetic interface isn't saved
// (§6.14). `loadChild(childPath) → Promise<savedObject>` returns the child's
// parsed save object; designInterface reads its ports directly, so the child need
// not be fully deserialized. A child that fails to load yields a broken-link
// placeholder (FR-099a); a connection to an interface pin the child no longer
// exposes is left dangling and reported (FR-099b).
export async function resolveSubDesigns(design, loadChild, onReport = () => {}) {
  for (const inst of design.components) {
    if (inst.kind !== "subdesign") continue;
    try {
      const child = await loadChild(inst.childPath);
      inst.typeData = synthTypeForInterface(designInterface(child), inst.render, inst.type);
      delete inst.broken;
    } catch {
      inst.typeData = placeholderTypeFromWiring(design, inst);
      inst.broken = true;
      onReport(`sub-design ${inst.refdes}: cannot load ${inst.childPath}`);
      continue;
    }
    const have = new Set(inst.typeData.pins.map((p) => p.name));
    for (const v of design.vertices) {
      if (
        (v.kind === "pin" || v.kind === "connector") &&
        v.ref === inst.refdes &&
        !have.has(v.pin)
      ) {
        const gone = v.pin;
        v.kind = "free"; // dangling (FR-099b); v.x/v.y keep the last-known point
        delete v.ref;
        delete v.pin;
        onReport(`sub-design ${inst.refdes}: pin ${gone} is gone; left dangling`);
      }
    }
  }
}

// placeholderTypeFromWiring synthesizes a stand-in type for a sub-design whose
// interface is not (yet) resolved: its pins are exactly those the parent's wiring
// still references, so pin positions resolve and the wires render. Used both for
// a broken-link block (FR-099a, marked inst.broken) and, at load, to keep an
// as-yet-unresolved sub-design renderable (e.g. a recovered snapshot, §6.14).
export function placeholderTypeFromWiring(design, inst) {
  const names = [];
  for (const v of design.vertices) {
    if (
      (v.kind === "pin" || v.kind === "connector") &&
      v.ref === inst.refdes &&
      !names.includes(v.pin)
    ) {
      names.push(v.pin);
    }
  }
  const pins = names.map((name, i) => ({
    name,
    side: "left",
    position: i + 1,
    direction: "bidir",
  }));
  return { name: inst.type, renderType: "unit", width: 6, height: Math.max(2, pins.length + 1), pins };
}

// addSubDesignInstance embeds a child design as a sub-design instance (FR-098).
// It allocates an X-<n> refdes (a third series beside U and A, FR-098a; the same
// child may be embedded repeatedly), stores the live relative child path and the
// chosen render style, and attaches the synthetic interface type as in-memory
// typeData (recomputed on load, never saved — FR-098). `childName` is the child's
// base name, shown as the body label; `iface` is designInterface(child).
export function addSubDesignInstance(design, { childPath, render, iface, childName }, x, y) {
  const refdes = "X" + nextRefNum(design.components, /^X(\d+)$/);
  const inst = {
    refdes,
    type: childName,
    kind: "subdesign",
    childPath,
    render,
    x,
    y,
    rotation: 0,
    typeData: synthTypeForInterface(iface, render, childName),
    overrides: {},
  };
  design.components.push(inst);
  return inst;
}
