// Netlist derivation (§6.6, FR-034b/FR-059a). Connectivity is computed from
// vertex/wire ids only — never from pixel geometry — so it is stable under pan,
// zoom, and component moves. This phase handles wires; the bit-lane bus
// extension (FR-037a) is added with the bus tool.

// UnionFind over opaque string keys.
function makeUF() {
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) {
      const next = parent.get(x);
      parent.set(x, r);
      x = next;
    }
    return r;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return { find, union };
}

// buildNets returns one Net per electrical signal that has at least one connected
// pin: { pins:[ "U3.Y0", … ], members:[ wireId, … ], provenance:[], name }.
export function buildNets(design) {
  const uf = makeUF();
  const lane = (wireId) => "wire:" + wireId;

  for (const w of design.wires) uf.find(lane(w.id));

  // Map each vertex to the wires that reference it, then union wires that share
  // a vertex (a junction, or a shared pin vertex for fan-out).
  const wiresByVertex = new Map();
  for (const w of design.wires) {
    for (const p of w.path) {
      if (p.t !== "node") continue;
      if (!wiresByVertex.has(p.v)) wiresByVertex.set(p.v, []);
      wiresByVertex.get(p.v).push(w.id);
    }
  }
  for (const wids of wiresByVertex.values()) {
    for (let i = 1; i < wids.length; i++) uf.union(lane(wids[0]), lane(wids[i]));
  }

  // Attach pins to their net root.
  const pinsByRoot = new Map();
  for (const [vid, wids] of wiresByVertex) {
    const v = design.vertices.find((x) => x.id === vid);
    if (!v || v.kind !== "pin") continue;
    const root = uf.find(lane(wids[0]));
    if (!pinsByRoot.has(root)) pinsByRoot.set(root, new Set());
    pinsByRoot.get(root).add(`${v.ref}.${v.pin}`);
  }

  // Group wire members by root.
  const membersByRoot = new Map();
  for (const w of design.wires) {
    const root = uf.find(lane(w.id));
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root).push(w.id);
  }

  const nets = [];
  for (const [root, members] of membersByRoot) {
    const pins = [...(pinsByRoot.get(root) ?? [])];
    if (pins.length === 0) continue; // a net needs at least one connected pin
    nets.push({ pins, members, provenance: [], name: null });
  }
  return nets;
}
