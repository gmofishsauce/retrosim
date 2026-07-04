// Manhattan route proposal (§6.9a, FR-027c): proposeRoute computes the
// orthogonal polyline shown as the wire/bus rubber-band preview and committed
// as the wire's initial bend points. Pure geometry over the design's component
// outlines — no store, no canvas. Every failure mode returns null; the caller
// falls back to the straight rat's-nest line.

import { hitComponent, componentBBox } from "./hittest.js";
import { getVertex, vertexWorld, pinWorldPos, sideOutward } from "../model/design.js";
import { rotateOffset } from "../geometry.js";

// Tunable constants (representative; see §6.9a).
export const TURN_PENALTY = 5; // extra cost per corner, in grid-step units
export const SEARCH_PAD = 4; // grid units of slack around the search area
const MAX_CELLS = 100000; // defensive cap on the search lattice

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// unitDir returns the index in DIRS of an escape vector, or -1 when the
// endpoint has no (valid) escape direction.
function unitDir(v) {
  if (!v) return -1;
  return DIRS.findIndex((d) => d.x === v.x && d.y === v.y);
}

// MinHeap is a binary min-heap on node.f for the A* open list.
class MinHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

// mergeCollinear drops duplicate and interior collinear points so the returned
// polyline's interior points are exactly the corners (§6.9a).
function mergeCollinear(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const b = out[out.length - 1];
    if (p.x === b.x && p.y === b.y) continue;
    const a = out[out.length - 2];
    if (a && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out.length >= 2 ? out : null;
}

// Edge keys identify a unit grid edge: a horizontal edge spans (x,y)→(x+1,y),
// a vertical edge spans (x,y)→(x,y+1). Canonicalizing on the lower endpoint
// makes a traversal and its reverse hash to the same key.
const hEdgeKey = (x, y) => "H" + x + "," + y;
const vEdgeKey = (x, y) => "V" + x + "," + y;

// conductorWorldPoints resolves a wire/bus path to its world grid polyline:
// node points dereference their vertex (pin positions are derived), bend
// points carry their own coordinates (§7.1a). Points are rounded to the grid.
function conductorWorldPoints(design, conductor) {
  const pts = [];
  for (const p of conductor.path) {
    let q;
    if (p.t === "node") {
      const v = getVertex(design, p.v);
      if (!v) continue;
      q = vertexWorld(design, v);
    } else {
      q = p;
    }
    pts.push({ x: Math.round(q.x), y: Math.round(q.y) });
  }
  return pts;
}

// occupiedEdges collects the unit grid edges spanned by every existing wire and
// bus, clipped to the search bounds (FR-027d). Only axis-aligned segments
// contribute — a diagonal rat's-nest fallback (FR-027c) occupies no orthogonal
// edge and so never blocks the search. The router refuses to traverse an edge
// in this set, which forbids running collinearly on top of another conductor
// while still allowing crossings (which share a vertex, not an edge).
function occupiedEdges(design, minX, maxX, minY, maxY) {
  const set = new Set();
  for (const c of [...design.wires, ...design.buses]) {
    const pts = conductorWorldPoints(design, c);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.y === b.y && a.x !== b.x) {
        const y = a.y;
        if (y < minY || y > maxY) continue;
        const lo = Math.max(Math.min(a.x, b.x), minX);
        const hi = Math.min(Math.max(a.x, b.x), maxX);
        for (let x = lo; x < hi; x++) set.add(hEdgeKey(x, y));
      } else if (a.x === b.x && a.y !== b.y) {
        const x = a.x;
        if (x < minX || x > maxX) continue;
        const lo = Math.max(Math.min(a.y, b.y), minY);
        const hi = Math.min(Math.max(a.y, b.y), maxY);
        for (let y = lo; y < hi; y++) set.add(vEdgeKey(x, y));
      }
    }
  }
  return set;
}

// proposeRoute returns a Manhattan polyline [{x,y}, …] from `from` to `to`
// inclusive (world grid coordinates; interior points are the corners), or null
// when no route is found. `from`/`to` may carry an optional `escape` unit
// vector (a pin's outward facing direction, rotation-aware): the route's
// first/last step must leave/enter the pin along it. The search runs over grid
// cells in the bounding box of the endpoints, widened by the endpoints' own
// components' outlines (so a route can loop around them) plus SEARCH_PAD.
// Component outlines are obstacles; the search start/goal themselves are
// always traversable so a pin on a body edge can escape. Cost is one per step
// plus TURN_PENALTY per corner, so few-bend routes win over jagged ones.
export function proposeRoute(design, from, to) {
  if (!Number.isFinite(from?.x) || !Number.isFinite(from?.y)) return null;
  if (!Number.isFinite(to?.x) || !Number.isFinite(to?.y)) return null;
  const F = { x: Math.round(from.x), y: Math.round(from.y) };
  const T = { x: Math.round(to.x), y: Math.round(to.y) };
  if (F.x === T.x && F.y === T.y) return null;

  // Forced escape steps: with an escape the search runs A→B and the F→A / B→T
  // unit segments are prepended/appended afterward.
  const dF = unitDir(from.escape);
  const dT = unitDir(to.escape);
  const A = dF >= 0 ? { x: F.x + DIRS[dF].x, y: F.y + DIRS[dF].y } : F;
  const B = dT >= 0 ? { x: T.x + DIRS[dT].x, y: T.y + DIRS[dT].y } : T;

  // Degenerate adjacency: the escape step alone reaches the other endpoint.
  if (A.x === T.x && A.y === T.y) return mergeCollinear([F, T]);
  if (B.x === F.x && B.y === F.y) return mergeCollinear([F, T]);
  if (A.x === B.x && A.y === B.y) return mergeCollinear([F, A, T]);

  // Search bounds: endpoints, their escape cells, and the outlines of the
  // components the endpoints sit on (loop-around room), plus padding.
  let minX = Math.min(F.x, T.x, A.x, B.x);
  let maxX = Math.max(F.x, T.x, A.x, B.x);
  let minY = Math.min(F.y, T.y, A.y, B.y);
  let maxY = Math.max(F.y, T.y, A.y, B.y);
  for (const pt of [F, T]) {
    const inst = hitComponent(design, pt);
    if (inst) {
      const b = componentBBox(inst);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  minX -= SEARCH_PAD;
  maxX += SEARCH_PAD;
  minY -= SEARCH_PAD;
  maxY += SEARCH_PAD;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w * h > MAX_CELLS) return null;

  // Obstacles: every cell on or inside a component outline, clipped to bounds.
  const blocked = new Uint8Array(w * h);
  const idx = (x, y) => (y - minY) * w + (x - minX);
  for (const inst of design.components) {
    const b = componentBBox(inst);
    const x0 = Math.max(Math.ceil(b.minX), minX);
    const x1 = Math.min(Math.floor(b.maxX), maxX);
    const y0 = Math.max(Math.ceil(b.minY), minY);
    const y1 = Math.min(Math.floor(b.maxY), maxY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) blocked[idx(x, y)] = 1;
    }
  }
  // The search start/goal are always traversable (a pin sits on a body edge);
  // escape cells are not exempt — an escape into another body means no route.
  blocked[idx(A.x, A.y)] = 0;
  blocked[idx(B.x, B.y)] = 0;
  if (dF >= 0 && hitComponent(design, A)) return null;
  if (dT >= 0 && hitComponent(design, B)) return null;

  // Edges already occupied by existing conductors (FR-027d). The forced escape
  // steps F→A and B→T are stitched on outside the A→B search below, so they are
  // exempt — a new wire may still leave a pin that already carries one (fan-out)
  // before diverging.
  const occupied = occupiedEdges(design, minX, maxX, minY, maxY);

  // A* over (cell, incoming direction) states. h = Manhattan distance to B
  // (admissible: turn penalties only add cost). The B→T turn/reversal cost is
  // charged on entry to B so the first B pop is optimal.
  const stateId = (x, y, d) => idx(x, y) * 4 + d;
  const gScore = new Float64Array(w * h * 4).fill(Infinity);
  const cameFrom = new Int32Array(w * h * 4).fill(-1);
  const hOf = (x, y) => Math.abs(x - B.x) + Math.abs(y - B.y);
  const heap = new MinHeap();
  // With an escape the initial direction is forced; otherwise seed all four so
  // the first move is never charged a turn.
  for (const d of dF >= 0 ? [dF] : [0, 1, 2, 3]) {
    gScore[stateId(A.x, A.y, d)] = 0;
    heap.push({ x: A.x, y: A.y, d, g: 0, f: hOf(A.x, A.y) });
  }
  let goal = -1;
  while (heap.size) {
    const cur = heap.pop();
    const sid = stateId(cur.x, cur.y, cur.d);
    if (cur.g > gScore[sid]) continue; // stale heap entry
    if (cur.x === B.x && cur.y === B.y) {
      goal = sid;
      break;
    }
    for (let d = 0; d < 4; d++) {
      if (DIRS[d].x === -DIRS[cur.d].x && DIRS[d].y === -DIRS[cur.d].y) continue;
      const nx = cur.x + DIRS[d].x;
      const ny = cur.y + DIRS[d].y;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      if (blocked[idx(nx, ny)]) continue;
      // Forbid running on top of an existing conductor (FR-027d); crossing it
      // (a shared vertex, no shared edge) stays allowed.
      const ekey =
        DIRS[d].x !== 0
          ? hEdgeKey(Math.min(cur.x, nx), cur.y)
          : vEdgeKey(cur.x, Math.min(cur.y, ny));
      if (occupied.has(ekey)) continue;
      let g = cur.g + 1 + (d === cur.d ? 0 : TURN_PENALTY);
      if (nx === B.x && ny === B.y && dT >= 0) {
        if (d === dT) continue; // B→T would reverse the entering segment
        const exit = unitDir({ x: -DIRS[dT].x, y: -DIRS[dT].y }); // B→T direction
        if (d !== exit) g += TURN_PENALTY;
      }
      const ns = stateId(nx, ny, d);
      if (g < gScore[ns]) {
        gScore[ns] = g;
        cameFrom[ns] = sid;
        heap.push({ x: nx, y: ny, d, g, f: g + hOf(nx, ny) });
      }
    }
  }
  if (goal < 0) return null;

  const pts = [];
  for (let s = goal; s >= 0; s = cameFrom[s]) {
    const cell = (s / 4) | 0;
    pts.push({ x: (cell % w) + minX, y: ((cell / w) | 0) + minY });
  }
  pts.reverse();
  if (dF >= 0) pts.unshift(F);
  if (dT >= 0) pts.push(T);
  return mergeCollinear(pts);
}

// --- FR-099c: re-route wires after a sub-design interface change (§6.14) ---

// endpointFor turns a wire-endpoint vertex into a router endpoint: a pin or
// connector vertex contributes its derived world point plus the pin's outward
// escape direction (rotation-aware — the same construction as interaction's
// routerEndpoint, §6.9a); a junction/free vertex contributes its own point.
function endpointFor(design, v) {
  if (v.kind === "pin" || v.kind === "connector") {
    const inst = design.components.find((c) => c.refdes === v.ref);
    if (!inst) return null;
    const w = pinWorldPos(inst, v.pin);
    const pin = inst.typeData?.pins?.find((p) => p.name === v.pin);
    const out = sideOutward(pin?.side);
    return out.x || out.y ? { ...w, escape: rotateOffset(out.x, out.y, inst.rotation) } : w;
  }
  return { x: v.x, y: v.y };
}

// rerouteAttachedWires re-routes every **simple** wire attached to the listed
// instances (FR-099c, §6.14): a simple wire's path is node–bends–node with no
// junction/tap node along it. Each qualifying wire's interior bends are
// replaced by a freshly proposed route between its endpoints' derived world
// positions; the endpoint node refs are kept, so connectivity never changes.
// A wire the router cannot route keeps its old bends. Returns the number of
// wires re-routed. Geometry-only, caller-reported (no command/undo/dirty).
export function rerouteAttachedWires(design, refdesList) {
  const targets = new Set(refdesList);
  const vById = new Map(design.vertices.map((v) => [v.id, v]));
  let rerouted = 0;
  for (const w of design.wires) {
    const first = w.path[0];
    const last = w.path[w.path.length - 1];
    if (first.t !== "node" || last.t !== "node") continue;
    if (!w.path.slice(1, -1).every((p) => p.t === "bend")) continue; // tap along it
    const va = vById.get(first.v);
    const vb = vById.get(last.v);
    if (!va || !vb) continue;
    const onTarget = (v) => (v.kind === "pin" || v.kind === "connector") && targets.has(v.ref);
    if (!onTarget(va) && !onTarget(vb)) continue;
    const from = endpointFor(design, va);
    const to = endpointFor(design, vb);
    const route = from && to ? proposeRoute(design, from, to) : null;
    if (!route) continue; // no route found: keep the old bends
    w.path = [first, ...route.slice(1, -1).map((p) => ({ t: "bend", x: p.x, y: p.y })), last];
    rerouted++;
  }
  return rerouted;
}
