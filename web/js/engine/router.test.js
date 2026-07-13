// Tests for the Manhattan route proposal (§6.9a, FR-027c; §11.1).
import { test } from "node:test";
import assert from "node:assert/strict";

import { proposeRoute, rerouteAttachedWires } from "./router.js";
import { componentBBox } from "./hittest.js";
import { rotateOffset } from "../geometry.js";

// comp builds a minimal component instance; only the outline matters here.
function comp(x, y, width, height, rotation = 0, refdes = "U1") {
  return { refdes, x, y, rotation, typeData: { width, height, pins: [] } };
}

function design(...components) {
  return { components, wires: [], buses: [], vertices: [] };
}

// sgn normalizes Math.sign's -0 to +0 for strict equality.
const sgn = (v) => Math.sign(v) + 0;

// pointsAlong yields every integer grid point on the polyline, asserting each
// segment is axis-aligned (Manhattan) on the way.
function* pointsAlong(path) {
  yield path[0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    assert.ok(a.x === b.x || a.y === b.y, `segment ${i} not Manhattan`);
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    let { x, y } = a;
    while (x !== b.x || y !== b.y) {
      x += dx;
      y += dy;
      yield { x, y };
    }
  }
}

// assertValid checks the route contract: endpoints in place, Manhattan
// segments, corners-only interior (collinear merged), and no point on or
// inside any component outline except the endpoints themselves.
function assertValid(path, from, to, d) {
  assert.ok(path, "expected a route");
  assert.deepEqual({ x: path[0].x, y: path[0].y }, { x: from.x, y: from.y });
  const last = path[path.length - 1];
  assert.deepEqual({ x: last.x, y: last.y }, { x: to.x, y: to.y });
  for (let i = 2; i < path.length; i++) {
    const [a, b, c] = [path[i - 2], path[i - 1], path[i]];
    assert.ok(
      !((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)),
      `collinear interior point at index ${i - 1}`,
    );
  }
  const boxes = d.components.map(componentBBox);
  for (const p of pointsAlong(path)) {
    if ((p.x === from.x && p.y === from.y) || (p.x === to.x && p.y === to.y)) continue;
    for (const b of boxes) {
      assert.ok(
        p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY,
        `route point (${p.x},${p.y}) on a component outline`,
      );
    }
  }
}

test("open field: aligned endpoints route straight (FR-027c)", () => {
  const d = design();
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.deepEqual(path, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
});

test("open field: diagonal endpoints route as a single L, not a staircase", () => {
  const d = design();
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 7, y: 5 });
  assertValid(path, { x: 0, y: 0 }, { x: 7, y: 5 }, d);
  assert.equal(path.length, 3, "expected exactly one corner");
});

test("detour: route avoids a component between the endpoints", () => {
  const d = design(comp(3, -3, 4, 6)); // bbox x 3..7, y -3..3
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
});

test("same-component loop: output back to an input routes around the body", () => {
  const c = comp(0, 0, 4, 4);
  const d = design(c);
  const from = { x: 4, y: 2, escape: { x: 1, y: 0 } }; // right-side pin
  const to = { x: 0, y: 2, escape: { x: -1, y: 0 } }; // left-side pin
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  // First and last steps honor the pin escapes: the route leaves `from` along
  // its escape (+x) and enters `to` from its escape side (traveling -escape,
  // i.e. +x from the cell at (-1,2)).
  assert.equal(sgn(path[1].x - path[0].x), 1);
  assert.equal(path[1].y, path[0].y);
  const a = path[path.length - 2];
  const b = path[path.length - 1];
  assert.equal(sgn(b.x - a.x), -to.escape.x);
  assert.equal(b.y, a.y);
});

test("pin escape: first step follows the facing direction for all rotations", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const c = comp(0, 0, 4, 4, rotation);
    const d = design(c);
    // Unrotated right-side pin at offset (4,2), facing (1,0).
    const off = rotateOffset(4, 2, rotation);
    const esc = rotateOffset(1, 0, rotation);
    const from = { x: c.x + off.x, y: c.y + off.y, escape: { x: esc.x, y: esc.y } };
    const to = { x: 20, y: 20 };
    const path = proposeRoute(d, from, to);
    assertValid(path, from, to, d);
    assert.equal(sgn(path[1].x - path[0].x), sgn(esc.x), `rotation ${rotation}`);
    assert.equal(sgn(path[1].y - path[0].y), sgn(esc.y), `rotation ${rotation}`);
  }
});

test("endpoint on a body edge is traversable without an escape", () => {
  const d = design(comp(0, 0, 4, 4));
  const from = { x: 4, y: 2 }; // on the outline, no escape given
  const to = { x: 10, y: 2 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
});

test("boxed-in: escape cell inside another body yields null (fallback)", () => {
  // to's escape cell (9,2) lies inside the second component (bbox 5..9, 0..4).
  const d = design(comp(10, 0, 4, 4), comp(5, 0, 4, 4, 0, "U2"));
  const from = { x: 0, y: 6 };
  const to = { x: 10, y: 2, escape: { x: -1, y: 0 } };
  assert.equal(proposeRoute(d, from, to), null);
});

test("turn penalty: a longer 2-corner route beats a shorter slalom", () => {
  // Staggered teeth: T1 spans y -3..0 at x 3..4, T2 spans y 0..3 at x 6..7.
  // Slaloming between them (under T1 at y=1, over T2 at y=-1) is length 14
  // with 5 corners (cost 39); looping around at y=±4 is length 18 with 2
  // corners (cost 28). The turn penalty must pick the longer loop.
  const d = design(comp(3, -3, 1, 3), comp(6, 0, 1, 3, 0, "U2"));
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  assert.equal(path.length, 4, "expected exactly two corners");
});

test("degenerate input returns null, never throws", () => {
  const d = design();
  assert.equal(proposeRoute(d, { x: 3, y: 3 }, { x: 3, y: 3 }), null);
  assert.equal(proposeRoute(d, { x: NaN, y: 0 }, { x: 5, y: 0 }), null);
  assert.equal(proposeRoute(d, null, { x: 5, y: 0 }), null);
});

test("adjacent pins facing each other route as the direct segment", () => {
  const d = design();
  const from = { x: 0, y: 0, escape: { x: 1, y: 0 } };
  const to = { x: 1, y: 0, escape: { x: -1, y: 0 } };
  // A = (1,0) = T: the escape step alone reaches the destination.
  assert.deepEqual(proposeRoute(d, from, to), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]);
});

// --- FR-027d: routed wires must not overlap existing conductors ---

// wire builds a test conductor whose path is bare bend points (no vertices
// needed); occupiedEdges reads its world points directly.
function wire(...pts) {
  return { path: pts.map((p) => ({ t: "bend", x: p.x, y: p.y })) };
}

// edgeKey canonicalizes a unit edge the same way the router does.
function edgeKey(a, b) {
  return a.y === b.y
    ? "H" + Math.min(a.x, b.x) + "," + a.y
    : "V" + a.x + "," + Math.min(a.y, b.y);
}

// assertNoOverlap walks the route's unit edges and asserts none coincide with
// an existing conductor's edge (crossings, which share only a vertex, are fine).
// `exempt` lists edge keys allowed to overlap (e.g. a permitted escape edge).
function assertNoOverlap(path, d, exempt = []) {
  const occ = new Set();
  for (const c of [...d.wires, ...d.buses]) {
    const pts = c.path.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      let { x, y } = a;
      while (x !== b.x || y !== b.y) {
        const nx = x + dx;
        const ny = y + dy;
        occ.add(edgeKey({ x, y }, { x: nx, y: ny }));
        x = nx;
        y = ny;
      }
    }
  }
  let prev = path[0];
  for (const p of pointsAlong(path)) {
    if (p.x !== prev.x || p.y !== prev.y) {
      const k = edgeKey(prev, p);
      assert.ok(
        !occ.has(k) || exempt.includes(k),
        `route edge ${prev.x},${prev.y}->${p.x},${p.y} overlaps a conductor`,
      );
      prev = p;
    }
  }
}

test("a collinear wire forces the route to detour off it (FR-027d)", () => {
  // An existing wire runs along y=0 from x=2..8. A straight (0,0)->(10,0) route
  // would lie on top of it; the router must step off y=0 in between.
  const d = design();
  d.wires.push(wire({ x: 2, y: 0 }, { x: 8, y: 0 }));
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  assertNoOverlap(path, d);
  assert.ok(path.length > 2, "expected a detour, not the straight overlap");
});

test("a route does not turn where an existing conductor already turns (FR-027d)", () => {
  // Existing wire has a corner at P=(5,0): arms west (x2..5,y0) and north (x5,y0..3).
  const d = design();
  d.wires.push(wire({ x: 2, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }));
  // A component blocks the alternative single-L corner at (8,-3), so the cheapest
  // route is the single L that turns at P — which the router must now refuse,
  // detouring to turn elsewhere (coincident corners read as a false junction).
  d.components.push(comp(7, -4, 2, 2)); // bbox x7..9, y-4..-2
  const from = { x: 5, y: -3 };
  const to = { x: 8, y: 0 };
  const path = proposeRoute(d, from, to);
  assertValid(path, from, to, d);
  assertNoOverlap(path, d);
  // The key assertion: no bend lands on the existing corner P=(5,0).
  for (const p of path.slice(1, -1)) {
    assert.ok(!(p.x === 5 && p.y === 0), "route turns at the existing corner (5,0)");
  }
});

test("a crossing wire does not block a straight route (FR-027d)", () => {
  // A vertical wire at x=5 crosses the path of a horizontal (0,0)->(10,0) route
  // at the single point (5,0): shared vertex, no shared edge — route stays
  // straight.
  const d = design();
  d.wires.push(wire({ x: 5, y: -3 }, { x: 5, y: 3 }));
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 10, y: 0 });
  assert.deepEqual(path, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ]);
});

test("fan-out: an occupied escape edge stays traversable (FR-027d)", () => {
  // The source pin already carries a wire leaving rightward (the escape edge
  // H0,0) that then turns up to (1,5). A new wire from the same pin must still
  // escape (escape edge exempt) and then diverge from the existing wire.
  const d = design();
  d.wires.push(wire({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 5 }));
  const from = { x: 0, y: 0, escape: { x: 1, y: 0 } };
  const to = { x: 6, y: 3 };
  const path = proposeRoute(d, from, to);
  assert.ok(path, "expected a route despite the occupied escape edge");
  // The shared escape edge (0,0)->(1,0) is permitted (exempt); the rest of the
  // route must diverge and not overlap the existing wire.
  assertNoOverlap(path, d, [edgeKey({ x: 0, y: 0 }, { x: 1, y: 0 })]);
});

test("a bus is an obstacle to wire routing just like a wire (FR-027d)", () => {
  const d = design();
  d.buses.push(wire({ x: 2, y: 0 }, { x: 8, y: 0 }));
  const path = proposeRoute(d, { x: 0, y: 0 }, { x: 10, y: 0 });
  assertValid(path, { x: 0, y: 0 }, { x: 10, y: 0 }, d);
  assertNoOverlap(path, d);
  assert.ok(path.length > 2, "expected a detour around the bus");
});

// --- rerouteAttachedWires (FR-099c) ---

// A pinned instance pair with a simple wire carrying stale dog-leg bends, as a
// re-laid-out sub-design leaves behind (§6.14).
function staleWireFixture() {
  const x1 = {
    refdes: "X1",
    x: 0,
    y: 0,
    rotation: 0,
    typeData: { width: 2, height: 2, pins: [{ name: "A", side: "right", position: 1 }] },
  };
  const u9 = {
    refdes: "U9",
    x: 10,
    y: 0,
    rotation: 0,
    typeData: { width: 2, height: 2, pins: [{ name: "B", side: "left", position: 1 }] },
  };
  const va = { id: "va", kind: "pin", ref: "X1", pin: "A", x: 0, y: 0 };
  const vb = { id: "vb", kind: "pin", ref: "U9", pin: "B", x: 0, y: 0 };
  const w = {
    id: "w1",
    path: [
      { t: "node", v: "va" },
      { t: "bend", x: 4, y: 7 }, // stale: routed to the pin's old position
      { t: "bend", x: 9, y: 7 },
      { t: "node", v: "vb" },
    ],
  };
  return { d: { components: [x1, u9], wires: [w], buses: [], vertices: [va, vb] }, w };
}

test("rerouteAttachedWires replaces a simple wire's stale bends (FR-099c)", () => {
  const { d, w } = staleWireFixture();
  const n = rerouteAttachedWires(d, ["X1"]);
  assert.equal(n, 1);
  assert.equal(w.path[0].v, "va"); // endpoint node refs preserved (connectivity)
  assert.equal(w.path[w.path.length - 1].v, "vb");
  assert.ok(w.path.slice(1, -1).every((p) => p.t === "bend"));
  assert.ok(!w.path.some((p) => p.t === "bend" && p.y === 7), "stale bends replaced");
});

test("rerouteAttachedWires skips unrelated and tapped wires; routes dangling ends (FR-099c)", () => {
  const { d, w } = staleWireFixture();
  // Unrelated: neither endpoint on a listed instance.
  assert.equal(rerouteAttachedWires(d, ["X2"]), 0);
  assert.equal(w.path.length, 4); // untouched
  // Tapped: an interior node (junction) disqualifies the wire.
  const before = JSON.stringify(w.path);
  const vj = { id: "vj", kind: "junction", x: 5, y: 3 };
  d.vertices.push(vj);
  w.path.splice(2, 0, { t: "node", v: "vj" });
  assert.equal(rerouteAttachedWires(d, ["X1"]), 0);
  w.path.splice(2, 1);
  assert.equal(JSON.stringify(w.path), before);
  // A free (dangling) far endpoint keeps its own point but the wire still
  // re-routes when its other end sits on a listed instance.
  const vf = { id: "vf", kind: "free", x: 6, y: 4 };
  d.vertices.push(vf);
  const w2 = {
    id: "w2",
    path: [{ t: "node", v: "va" }, { t: "bend", x: 1, y: 9 }, { t: "node", v: "vf" }],
  };
  d.wires.push(w2);
  assert.equal(rerouteAttachedWires(d, ["X1"]), 2); // w and w2 both qualify
  assert.ok(!w2.path.some((p) => p.t === "bend" && p.y === 9));
});
