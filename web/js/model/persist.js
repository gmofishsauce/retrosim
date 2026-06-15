// Design persistence: convert the in-memory design to/from the JSON save shape
// (§7.2, FR-055/056). The saved file carries the connectivity collections plus a
// derived `nets` array for downstream tools (FR-059a); ids are authoritative and
// the counters are rebuilt on load.

import { createDesign } from "./design.js";
import { buildNets } from "./netlist.js";
import { placeholderTypeFromWiring } from "./subdesign.js";

// FORMAT_VERSION is the save-file version this client writes and understands
// (§7.4). Loading a newer version warns but proceeds (forward-compat).
export const FORMAT_VERSION = 1;

// serializeDesign returns the JSON-serializable save object. `nets` is recomputed
// here and treated as derived/non-authoritative (A4).
export function serializeDesign(design) {
  return {
    formatVersion: FORMAT_VERSION,
    name: design.name,
    ...(design.defaultRender ? { defaultRender: design.defaultRender } : {}),
    components: design.components.map((c) =>
      c.kind === "subdesign" ? stripSubDesign(c) : c,
    ),
    wires: design.wires,
    buses: design.buses,
    vertices: design.vertices,
    nets: buildNets(design),
  };
}

// stripSubDesign persists only a sub-design's live link and placement, never its
// synthetic interface typeData (re-derived on load by resolveSubDesigns, FR-098).
function stripSubDesign(c) {
  const { refdes, type, kind, childPath, render, x, y, rotation } = c;
  return { refdes, type, kind, childPath, render, x, y, rotation };
}

// maxIdNum returns the highest numeric suffix among ids of the form `<prefix><n>`.
function maxIdNum(items, prefix) {
  let max = 0;
  for (const it of items) {
    if (typeof it.id === "string" && it.id.startsWith(prefix)) {
      const n = Number(it.id.slice(prefix.length));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max;
}

// validateStructure runs a cheap structural sanity pass over a loaded design
// (§7.4): the server only checks that the payload is JSON, so a truncated or
// hand-edited file must fail here with a legible error, not later as an
// `undefined` lookup deep in render/hit-test.
function validateStructure(d) {
  const vertexIds = new Set(d.vertices.map((v) => v.id));
  for (const c of [...d.wires, ...d.buses]) {
    if (!Array.isArray(c.path) || c.path.length < 2) {
      throw new Error(`conductor ${c.id}: path must have at least 2 points`);
    }
    for (const p of c.path) {
      if (p.t === "node" && !vertexIds.has(p.v)) {
        throw new Error(`conductor ${c.id}: references missing vertex ${p.v}`);
      }
    }
  }
  for (const v of d.vertices) {
    if (v.kind !== "pin" && v.kind !== "connector") continue;
    const inst = d.components.find((c) => c.refdes === v.ref);
    if (!inst) throw new Error(`vertex ${v.id}: references missing component ${v.ref}`);
    // A sub-design's interface pins are resolved after load (resolveSubDesigns,
    // §6.14), so its typeData is absent here — skip the pin-existence check.
    if (inst.kind === "subdesign") continue;
    if (!inst.typeData?.pins?.some((p) => p.name === v.pin)) {
      throw new Error(`vertex ${v.id}: references missing pin ${v.ref}.${v.pin}`);
    }
  }
}

// deserializeDesign rebuilds a live design from a parsed save object, restoring
// the id counters past the loaded ids. The derived `nets` field is ignored.
// Throws a legible Error if the file is structurally inconsistent (§7.4).
export function deserializeDesign(obj) {
  const d = createDesign(obj.name ?? "untitled");
  if (obj.defaultRender) d.defaultRender = obj.defaultRender; // FR-096
  d.components = structuredClone(obj.components ?? []);
  d.wires = structuredClone(obj.wires ?? []);
  d.buses = structuredClone(obj.buses ?? []);
  d.vertices = structuredClone(obj.vertices ?? []);
  validateStructure(d);
  // Sub-designs persist no typeData (live reference, FR-098). Give each a
  // wiring-derived placeholder so the design is always renderable; the load
  // flow's resolveSubDesigns (§6.14) then refines it from the child file (or
  // marks it broken). This also keeps a recovered snapshot renderable.
  for (const inst of d.components) {
    if (inst.kind === "subdesign" && !inst.typeData) {
      inst.typeData = placeholderTypeFromWiring(d, inst);
    }
  }
  d.nextWireId = maxIdNum(d.wires, "w") + 1;
  d.nextBusId = maxIdNum(d.buses, "b") + 1;
  d.nextVertexId = maxIdNum(d.vertices, "v") + 1;
  return d;
}
