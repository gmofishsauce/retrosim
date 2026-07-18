// Clipboard: extract a self-contained fragment of a design (components plus the
// wiring interior to them) and instantiate it elsewhere with fresh designators
// and ids (§6.15, FR-111/FR-112). Pure data operations — the session clipboard
// itself and the paste interaction live in the interaction layer (§6.9).

import { packageSiblings, allocRefNum, getVertex } from "./design.js";

// interiorConductors returns the whole wires and buses whose conductor network's
// component connections are *all* to components in `refSet` (the FR-018c interior
// test), excluding any network that touches a non-copied component or has no
// component connection at all. It mirrors the union-find network walk of
// rigidWiring (§6.6), but returns the conductors themselves rather than their
// interior bends/vertices.
export function interiorConductors(design, refSet) {
  const conductors = [...design.wires, ...design.buses];

  // A group-snapped bus endpoint is a `free` vertex bound to its component
  // (FR-042); map its vertex id → instance so it counts as a component connection.
  const snapInst = new Map();
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) snapInst.set(gc.vertex, gc.instance);
  }

  // Union-find over conductor indices, joined where two share a vertex.
  const parent = conductors.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byVertex = new Map();
  conductors.forEach((c, i) => {
    for (const p of c.path) {
      if (p.t !== "node") continue;
      if (!byVertex.has(p.v)) byVertex.set(p.v, []);
      byVertex.get(p.v).push(i);
    }
  });
  for (const list of byVertex.values())
    for (let k = 1; k < list.length; k++) parent[find(list[k])] = find(list[0]);

  const nets = new Map();
  conductors.forEach((_, i) => {
    const r = find(i);
    if (!nets.has(r)) nets.set(r, []);
    nets.get(r).push(i);
  });

  const wires = [];
  const buses = [];
  for (const idxs of nets.values()) {
    let conns = 0;
    let allInside = true;
    for (const i of idxs)
      for (const p of conductors[i].path) {
        if (p.t !== "node") continue;
        const v = getVertex(design, p.v);
        const ref =
          v.kind === "pin" || v.kind === "connector" ? v.ref : snapInst.get(v.id);
        if (ref != null) {
          conns++;
          if (!refSet.has(ref)) allInside = false;
        }
      }
    if (conns === 0 || !allInside) continue; // boundary or free-floating: skip
    for (const i of idxs) {
      const c = conductors[i];
      (design.wires.includes(c) ? wires : buses).push(c);
    }
  }
  return { wires, buses };
}

// extractFragment captures the copy fragment (FR-111): the selected components
// (each expanded to its whole subunit package, FR-018b), the conductors interior
// to that set (interiorConductors), and the vertices those conductors reference.
// The result is a deep clone detached from `design`. An empty or component-less
// selection yields an empty fragment.
export function extractFragment(design, refdeses) {
  const refSet = new Set();
  for (const r of refdeses)
    for (const sib of packageSiblings(design, r)) refSet.add(sib);

  const { wires, buses } = interiorConductors(design, refSet);

  const vids = new Set();
  for (const c of [...wires, ...buses]) {
    for (const p of c.path) if (p.t === "node") vids.add(p.v);
    for (const gc of c.groupConnections ?? []) vids.add(gc.vertex);
  }

  const components = design.components.filter((c) => refSet.has(c.refdes));
  const vertices = design.vertices.filter((v) => vids.has(v.id));
  return structuredClone({ components, wires, buses, vertices });
}

// translatePathPoint rewrites one conductor path point during paste: a node's
// vertex id through `vMap`, a bend's coordinate by the paste offset (dx,dy).
function translatePathPoint(p, vMap, dx, dy) {
  if (p.t === "node") p.v = vMap.get(p.v);
  else if (p.t === "bend") {
    p.x += dx;
    p.y += dy;
  }
}

// REFDES_SERIES maps each designator series to its pattern (number in group 1,
// optional subunit letters in group 2), its FR-011c series key, and the
// formatter for a fresh number.
const REFDES_SERIES = [
  { test: /^U(\d+)([A-Z]*)$/, series: "U", fmt: (n, suf) => `U${n}${suf}` },
  { test: /^A-(\d+)$/, series: "A", fmt: (n) => `A-${n}` },
  { test: /^N-(\d+)$/, series: "N", fmt: (n) => `N-${n}` },
  { test: /^X(\d+)$/, series: "X", fmt: (n) => `X${n}` },
];

// pasteFragment instantiates `fragment` into `design`, offset by (dx,dy) whole
// grid units (FR-112/FR-113). Every component gets a fresh designator — a new
// U/A/X number incremented past the design's maxima, with a subunit package's
// siblings sharing one new U-number and keeping their letters — and every vertex,
// wire, and bus gets a fresh id; interior connectivity (bus group connections and
// bit names included) is reproduced among the pasted objects. A pasted port whose
// label is still its original refdes (the default) adopts its new refdes. Returns
// the created { components, wires, buses } so the caller can select them. The
// input fragment is not mutated.
export function pasteFragment(design, fragment, dx, dy) {
  const f = structuredClone(fragment);

  // --- reference-designator remap: fresh numbers come from the FR-011c
  // high-water allocator, so a paste never reuses a retired designator ---
  const numByKey = new Map(); // `${seriesIndex}:${oldNum}` → new number
  const refMap = new Map(); // old refdes → new refdes
  for (const c of f.components) {
    let mapped = false;
    for (let si = 0; si < REFDES_SERIES.length; si++) {
      const m = REFDES_SERIES[si].test.exec(c.refdes);
      if (!m) continue;
      const key = si + ":" + m[1];
      let num = numByKey.get(key);
      if (num === undefined) {
        num = allocRefNum(design, REFDES_SERIES[si].series);
        numByKey.set(key, num);
      }
      refMap.set(c.refdes, REFDES_SERIES[si].fmt(num, m[2] ?? ""));
      mapped = true;
      break;
    }
    if (!mapped) throw new Error(`cannot remap reference designator ${c.refdes}`);
  }

  // --- apply to components ---
  for (const c of f.components) {
    const oldRefdes = c.refdes;
    const newRefdes = refMap.get(oldRefdes);
    // A default-labelled port (label === its own refdes) re-anchors to its new
    // refdes so it forms its own net; a custom label is kept (FR-112).
    if (c.typeData?.renderType === "port" && c.label === oldRefdes) c.label = newRefdes;
    c.refdes = newRefdes;
    c.x += dx;
    c.y += dy;
  }

  // --- vertex id + ref remap, with translation ---
  const vMap = new Map(); // old vertex id → new vertex id
  for (const v of f.vertices) {
    const oldId = v.id;
    v.id = "v" + design.nextVertexId++;
    vMap.set(oldId, v.id);
    if (v.kind === "pin" || v.kind === "connector") v.ref = refMap.get(v.ref) ?? v.ref;
    if (typeof v.x === "number") v.x += dx;
    if (typeof v.y === "number") v.y += dy;
  }

  // --- conductor id remap + path/group rewrites ---
  for (const w of f.wires) {
    w.id = "w" + design.nextWireId++;
    for (const p of w.path) translatePathPoint(p, vMap, dx, dy);
  }
  for (const b of f.buses) {
    b.id = "b" + design.nextBusId++;
    for (const p of b.path) translatePathPoint(p, vMap, dx, dy);
    for (const gc of b.groupConnections ?? []) {
      gc.vertex = vMap.get(gc.vertex) ?? gc.vertex;
      gc.instance = refMap.get(gc.instance) ?? gc.instance;
    }
  }

  design.vertices.push(...f.vertices);
  design.wires.push(...f.wires);
  design.buses.push(...f.buses);
  design.components.push(...f.components);
  return { components: f.components, wires: f.wires, buses: f.buses };
}
