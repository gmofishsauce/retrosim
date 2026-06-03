// Netlist derivation (§6.6, FR-034b/FR-059a/FR-037a/FR-060a). Connectivity is
// computed from vertex/wire/bus ids and bit indices only — never from pixel
// geometry — so it is stable under pan, zoom, and component moves.
//
// Union-find runs over BIT-LANES, not raw conductors, so a width-w bus
// contributes up to w independent nets (A7). A lane is one electrical conductor:
// a wire is one lane; a bus B is the lanes (B, 0…w-1).

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

// pickName resolves a net's signal name (§6.6): an explicit bus bit name wins
// (FR-037b), else a connected pin name, else null.
function pickName(provenance, pins) {
  for (const p of provenance) if (p.name != null) return p.name;
  if (pins.length) {
    const first = [...pins].sort()[0];
    return first.includes(".") ? first.split(".").slice(1).join(".") : first;
  }
  return null;
}

// buildNets returns one Net per electrical signal that has at least one connected
// pin: { pins:[ "U3.Y0", … ], members:[ wireId|busId, … ],
//        provenance:[ { bus, bit, name? }, … ], name }.
export function buildNets(design) {
  const uf = makeUF();
  const wireLane = (id) => `wire:${id}`;
  const busLane = (id, i) => `bus:${id}:${i}`;

  // Pre-register every lane so isolated conductors are findable.
  for (const w of design.wires) uf.find(wireLane(w.id));
  for (const b of design.buses) {
    for (let i = 0; i < b.width; i++) uf.find(busLane(b.id, i));
  }

  const vById = new Map(design.vertices.map((v) => [v.id, v]));
  const attachments = []; // { lane, pin } applied after all unions

  // Index conductors by the vertex ids their node-points reference.
  const wiresByVertex = new Map();
  for (const w of design.wires) {
    for (const p of w.path) {
      if (p.t !== "node") continue;
      if (!wiresByVertex.has(p.v)) wiresByVertex.set(p.v, []);
      wiresByVertex.get(p.v).push(w.id);
    }
  }
  const busesByVertex = new Map();
  for (const b of design.buses) {
    for (const p of b.path) {
      if (p.t !== "node") continue;
      if (!busesByVertex.has(p.v)) busesByVertex.set(p.v, []);
      busesByVertex.get(p.v).push(b);
    }
  }

  // 1. Plain-wire connectivity: wires sharing a vertex id are one lane; a wire
  //    pin-vertex attaches its pin to that lane (fan-out is multiple wires on the
  //    same pin vertex).
  for (const [vid, wids] of wiresByVertex) {
    for (let i = 1; i < wids.length; i++) {
      uf.union(wireLane(wids[0]), wireLane(wids[i]));
    }
    const v = vById.get(vid);
    if (v && v.kind === "pin") {
      attachments.push({ lane: wireLane(wids[0]), pin: `${v.ref}.${v.pin}` });
    }
  }

  // 2. Bus group snap (FR-042): bit i ↔ group pin bitMap[i].
  for (const b of design.buses) {
    for (const gc of b.groupConnections ?? []) {
      gc.bitMap.forEach((pinName, i) => {
        attachments.push({ lane: busLane(b.id, i), pin: `${gc.instance}.${pinName}` });
      });
    }
  }

  // 3 & 4. Junctions on buses: bit==null is a full bus↔bus join (lanes aligned by
  //    index, FR-039a); bit set is a breakout tap binding wires to one bus lane
  //    (FR-043a).
  for (const v of design.vertices) {
    if (v.kind !== "junction") continue;
    const buses = busesByVertex.get(v.id) ?? [];
    if (v.bit == null) {
      for (let k = 1; k < buses.length; k++) {
        const w = Math.min(buses[0].width, buses[k].width);
        for (let i = 0; i < w; i++) {
          uf.union(busLane(buses[0].id, i), busLane(buses[k].id, i));
        }
      }
    } else {
      const wids = wiresByVertex.get(v.id) ?? [];
      for (const b of buses) {
        for (const wid of wids) uf.union(wireLane(wid), busLane(b.id, v.bit));
      }
    }
  }

  // Regroup attachments and members by their root lane.
  const pinsByRoot = new Map();
  for (const { lane, pin } of attachments) {
    const root = uf.find(lane);
    if (!pinsByRoot.has(root)) pinsByRoot.set(root, new Set());
    pinsByRoot.get(root).add(pin);
  }

  const membersByRoot = new Map();
  const provByRoot = new Map();
  const addMember = (root, id) => {
    if (!membersByRoot.has(root)) membersByRoot.set(root, new Set());
    membersByRoot.get(root).add(id);
  };
  for (const w of design.wires) addMember(uf.find(wireLane(w.id)), w.id);
  for (const b of design.buses) {
    for (let i = 0; i < b.width; i++) {
      const root = uf.find(busLane(b.id, i));
      addMember(root, b.id);
      const name = b.bitNames && b.bitNames[i] != null ? b.bitNames[i] : undefined;
      if (!provByRoot.has(root)) provByRoot.set(root, []);
      provByRoot.get(root).push({ bus: b.id, bit: i, ...(name !== undefined ? { name } : {}) });
    }
  }

  // A net needs at least one connected pin.
  const nets = [];
  for (const [root, pinSet] of pinsByRoot) {
    const pins = [...pinSet];
    const members = [...(membersByRoot.get(root) ?? [])];
    const provenance = provByRoot.get(root) ?? [];
    nets.push({ pins, members, provenance, name: pickName(provenance, pins) });
  }
  return nets;
}
