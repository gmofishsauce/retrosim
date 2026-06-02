// Design persistence: convert the in-memory design to/from the JSON save shape
// (§7.2, FR-055/056). The saved file carries the connectivity collections plus a
// derived `nets` array for downstream tools (FR-059a); ids are authoritative and
// the counters are rebuilt on load.

import { createDesign } from "./design.js";
import { buildNets } from "./netlist.js";

// serializeDesign returns the JSON-serializable save object. `nets` is recomputed
// here and treated as derived/non-authoritative (A4).
export function serializeDesign(design) {
  return {
    formatVersion: 1,
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

// deserializeDesign rebuilds a live design from a parsed save object, restoring
// the id counters past the loaded ids. The derived `nets` field is ignored.
export function deserializeDesign(obj) {
  const d = createDesign(obj.name ?? "untitled");
  d.components = structuredClone(obj.components ?? []);
  d.wires = structuredClone(obj.wires ?? []);
  d.buses = structuredClone(obj.buses ?? []);
  d.vertices = structuredClone(obj.vertices ?? []);
  d.nextWireId = maxIdNum(d.wires, "w") + 1;
  d.nextBusId = maxIdNum(d.buses, "b") + 1;
  d.nextVertexId = maxIdNum(d.vertices, "v") + 1;
  return d;
}
