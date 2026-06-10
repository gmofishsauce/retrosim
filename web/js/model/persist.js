// Design persistence: convert the in-memory design to/from the JSON save shape
// (§7.2, FR-055/056). The saved file carries the connectivity collections plus a
// derived `nets` array for downstream tools (FR-059a); ids are authoritative and
// the counters are rebuilt on load.

import { createDesign } from "./design.js";
import { buildNets } from "./netlist.js";

// FORMAT_VERSION is the save-file version this client writes and understands
// (§7.4). Loading a newer version warns but proceeds (forward-compat).
export const FORMAT_VERSION = 1;

// serializeDesign returns the JSON-serializable save object. `nets` is recomputed
// here and treated as derived/non-authoritative (A4).
export function serializeDesign(design) {
  return {
    formatVersion: FORMAT_VERSION,
    name: design.name,
    components: design.components,
    wires: design.wires,
    buses: design.buses,
    vertices: design.vertices,
    nets: buildNets(design),
  };
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
    if (v.kind !== "pin") continue;
    const inst = d.components.find((c) => c.refdes === v.ref);
    if (!inst || !inst.typeData?.pins?.some((p) => p.name === v.pin)) {
      throw new Error(`vertex ${v.id}: references missing pin ${v.ref}.${v.pin}`);
    }
  }
}

// deserializeDesign rebuilds a live design from a parsed save object, restoring
// the id counters past the loaded ids. The derived `nets` field is ignored.
// Throws a legible Error if the file is structurally inconsistent (§7.4).
export function deserializeDesign(obj) {
  const d = createDesign(obj.name ?? "untitled");
  d.components = structuredClone(obj.components ?? []);
  d.wires = structuredClone(obj.wires ?? []);
  d.buses = structuredClone(obj.buses ?? []);
  d.vertices = structuredClone(obj.vertices ?? []);
  validateStructure(d);
  d.nextWireId = maxIdNum(d.wires, "w") + 1;
  d.nextBusId = maxIdNum(d.buses, "b") + 1;
  d.nextVertexId = maxIdNum(d.vertices, "v") + 1;
  return d;
}
